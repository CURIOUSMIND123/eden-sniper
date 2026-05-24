// ─── EDEN SNIPER · SERVICE WORKER ─────────────────────────
const CACHE_NAME   = 'eden-sniper-v6';
const SHELL_URLS   = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];
const API_BASE     = 'https://fapi.binance.com/fapi/v1';
const MIN_VOL      = 5_000_000;       // min 24h USDT volume
const ALERT_SCORE  = 8;               // notify threshold

// ── INSTALL: cache shell ──────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(c => c.addAll(SHELL_URLS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean old caches ────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

// ── FETCH: cache-first for shell, passthrough for API ─────
self.addEventListener('fetch', e => {
  if (e.request.url.includes('fapi.binance.com') || e.request.url.includes('fonts.g')) {
    return; // let API/font calls go direct
  }
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

// ── PERIODIC BG SYNC: wake every 3 min to scan market ─────
self.addEventListener('periodicsync', e => {
  if (e.tag === 'eden-bg-scan') {
    e.waitUntil(runBackgroundScan());
  }
});

// ── MESSAGE: app sends signal data → SW shows notification ─
self.addEventListener('message', e => {
  if (!e.data) return;

  if (e.data.type === 'SIGNAL_NOTIFY') {
    const s = e.data.signal;
    const dir  = s.phase === 'PUMP' ? '🚀' : s.phase === 'DUMP' ? '📉' : '↗️';
    const coin = s.sym.replace('USDT', '');
    self.registration.showNotification(
      `${dir} ${coin} · ${s.phase}  ⚡ SCORE ${s.score}`,
      {
        body:     `Hit rate: ${(s.hitRate * 100).toFixed(0)}%  ·  avg move ${s.patAvg.toFixed(1)}%\nEntry ${fmtP(s.entry)}  SL ${fmtP(s.sl)}  TP1 ${fmtP(s.tp1)}`,
        icon:     '/icon-192.png',
        badge:    '/icon-192.png',
        tag:      `signal-${coin}`,
        renotify: true,
        vibrate:  [200, 80, 200, 80, 400],
        requireInteraction: true,
        data:     { url: '/', sym: coin }
      }
    );
  }

  if (e.data.type === 'BG_SCAN_RESULT') {
    // app already open, nothing to do
  }
});

// ── NOTIFICATION CLICK: open / focus app ──────────────────
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
      if (cs.length) return cs[0].focus();
      return clients.openWindow('/');
    })
  );
});

// ── BACKGROUND SCAN (runs when app is closed) ─────────────
// Simplified: checks top 30 coins for extreme vol + price patterns
// Full analysis runs when user opens app.
async function runBackgroundScan() {
  try {
    // Fetch ticker data
    const res = await fetch(`${API_BASE}/ticker/24hr`);
    if (!res.ok) return;
    const tickers = await res.json();

    // Filter to active USD-M futures
    const active = tickers
      .filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > MIN_VOL)
      .sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume))
      .slice(0, 30);

    const alerts = [];

    for (const t of active) {
      const pct   = parseFloat(t.priceChangePercent);
      const price = parseFloat(t.lastPrice);
      const sym   = t.symbol.replace('USDT', '');

      // Quick kline check — 5m last 30 bars
      const kRes = await fetch(`${API_BASE}/klines?symbol=${t.symbol}&interval=5m&limit=30`);
      if (!kRes.ok) continue;
      const klines = await kRes.json();
      if (klines.length < 25) continue;

      const C = klines.map(k => parseFloat(k[4]));
      const H = klines.map(k => parseFloat(k[2]));
      const L = klines.map(k => parseFloat(k[3]));
      const V = klines.map(k => parseFloat(k[5]));
      const n = C.length;

      // Rolling 20-bar avg vol
      const av20 = V.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20 || 1;
      const volR  = V[n - 1] / av20;

      // Simple RSI (14)
      let g = 0, l = 0;
      for (let i = n - 14; i < n; i++) {
        const d = C[i] - C[i - 1];
        d > 0 ? (g += d) : (l += Math.abs(d));
      }
      const rsi = l === 0 ? 100 : 100 - 100 / (1 + (g / 14) / (l / 14));

      const lastRng = H[n-1] - L[n-1] || 0.0001;
      const loWick  = (Math.min(C[n-1], klines[n-1][1]) - L[n-1]) / lastRng;
      const upWick  = (H[n-1] - Math.max(C[n-1], parseFloat(klines[n-1][1]))) / lastRng;
      const h20     = Math.max(...H.slice(n - 21, n - 1));
      const l72     = Math.min(...L.slice(0, n));
      const fromL   = (price - l72) / (l72 || 1) * 100;
      const fromH   = (Math.max(...H) - price) / (Math.max(...H) || 1) * 100;

      let phase = null, confidence = 0;

      // COIL RELEASE check
      const bbSlice  = C.slice(n - 20, n);
      const bbMean   = bbSlice.reduce((a, b) => a + b, 0) / 20;
      const bbStd    = Math.sqrt(bbSlice.reduce((a, b) => a + (b - bbMean) ** 2, 0) / 20);
      const bbWidth  = (2 * bbStd) / (bbMean || 1);
      if (bbWidth < 0.022 && volR >= 3.5 && C[n-1] > h20 && C[n-1] > klines[n-1][1] && rsi < 62) {
        phase = 'PUMP'; confidence = Math.round(Math.min(9.9, volR * 1.2 + (1 - bbWidth * 30) * 2) * 10) / 10;
      }
      // REJECTION check
      if (!phase && fromH < 4 && upWick >= 0.50 && C[n-1] < parseFloat(klines[n-1][1]) && volR >= 2.5 && rsi >= 62) {
        phase = 'DUMP'; confidence = Math.round(Math.min(9.9, volR + upWick * 4 + (rsi - 60) / 10) * 10) / 10;
      }
      // FLOOR PIN check
      if (!phase && fromL < 4 && loWick >= 0.48 && (C[n-1] - L[n-1]) / lastRng > 0.38 && rsi <= 40) {
        phase = 'BOUNCE'; confidence = Math.round(Math.min(9.9, loWick * 5 + (42 - rsi) / 5 + volR * 0.5) * 10) / 10;
      }

      if (phase && confidence >= ALERT_SCORE) {
        alerts.push({ sym, phase, confidence, price, rsi, volR });
      }
    }

    if (alerts.length === 0) return;

    // Notify for highest confidence signal
    alerts.sort((a, b) => b.confidence - a.confidence);
    const best = alerts[0];
    const dir  = best.phase === 'PUMP' ? '🚀' : best.phase === 'DUMP' ? '📉' : '↗️';

    await self.registration.showNotification(
      `${dir} ${best.sym} · ${best.phase}  ⚡ ${best.confidence}/10`,
      {
        body:    `RSI ${best.rsi.toFixed(0)}  ·  Vol ${best.volR.toFixed(1)}×  ·  Open EDEN to trade`,
        icon:    '/icon-192.png',
        badge:   '/icon-192.png',
        tag:     'bg-signal',
        renotify: true,
        vibrate: [300, 100, 300, 100, 600],
        requireInteraction: true,
        data:    { url: '/' }
      }
    );

    // If more alerts, batch as second notification
    if (alerts.length > 1) {
      const others = alerts.slice(1, 4).map(a => `${a.sym} ${a.phase}`).join(' · ');
      await self.registration.showNotification(
        `⚡ ${alerts.length - 1} more signal${alerts.length > 2 ? 's' : ''} found`,
        { body: others, icon: '/icon-192.png', badge: '/icon-192.png', tag: 'bg-extra', vibrate: [100] }
      );
    }

  } catch (err) {
    // Silently fail — don't spam error notifications
  }
}

// ── HELPER ────────────────────────────────────────────────
function fmtP(p) {
  if (!p) return '—';
  if (p >= 1000) return p.toFixed(1);
  if (p >= 1)    return p.toFixed(3);
  if (p >= 0.01) return p.toFixed(5);
  return p.toFixed(7);
}
