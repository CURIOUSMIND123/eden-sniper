'use strict';
// Munimo Field — site PWA. Talks to the live ConstructPro cloud API.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

let CSRF = '';
let SITES = [];
let WORKERS = [];
let ATT = {};        // worker_id -> status (P/H/OT/A)
let OT_HRS = {};     // worker_id -> overtime hours (only meaningful when status==='OT')
let HEADS = [];      // cash heads (income/expense/asset/liability) — money in/out
let BANKS = [];      // bank/cash accounts
let PARTIES = [];    // clients + vendors, for the optional "who" tag
let CAN_CASH = false;// whether this role may read the books (heads/banks/summary)
let MONEY_TYPE = 'debit'; // current money form direction

// ── API client (cookie session + CSRF double-submit) ───────────────────────
async function api(op, body) {
  if (window.__DEMO_API) return await window.__DEMO_API(op, body);
  let r;
  try {
    r = await fetch('/api/' + op, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, CSRF ? { 'X-CSRF-Token': CSRF } : {}),
      body: JSON.stringify(body == null ? {} : body),
    });
  } catch (e) {
    return { offline: true, success: false, error: 'No connection' };
  }
  if (r.status === 401) { CSRF = ''; showLogin(); return { success: false, error: 'Session expired' }; }
  let data; try { data = await r.json(); } catch (_) { data = { success: false, error: 'Bad response' }; }
  return Object.assign({ status: r.status }, data);
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2200);
}

// ── screens / views ─────────────────────────────────────────────────────────
function showLogin() { $('#login').classList.add('active'); $('#app').classList.remove('active'); document.body.classList.remove('app-open'); }
function showApp() { $('#login').classList.remove('active'); $('#app').classList.add('active'); document.body.classList.add('app-open'); }
function go(view) {
  $$('.view').forEach(v => v.classList.toggle('active', v.dataset.view === view));
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.go === view));
  if (view === 'attendance') renderAttendance();
  if (view === 'home') refreshHome();
  if (view === 'grn' && !$('#grnItems').children.length) addGrnItem();
}

// Open the money in/out form, configured for the chosen direction.
function openMoney(type) {
  MONEY_TYPE = type === 'credit' ? 'credit' : 'debit';
  $('#moneyTitle').textContent = MONEY_TYPE === 'credit' ? '⬇️ Money In' : '⬆️ Money Out';
  const btn = $('#moneySubmit'); btn.className = 'btn primary ' + (MONEY_TYPE === 'credit' ? 'in' : 'out');
  $('#moneyForm').reset();
  $('#mDate').value = today();
  fillHeads(MONEY_TYPE === 'credit' ? 'income' : 'expense');
  go('money');
}

// ── login ────────────────────────────────────────────────────────────────────
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').hidden = true;
  const r = await api('login', { username: $('#username').value.trim(), password: $('#password').value });
  if (r.success) { CSRF = r.data.csrf; await boot(r.data); }
  else { $('#loginErr').textContent = r.error || 'Login failed'; $('#loginErr').hidden = false; }
});

$('#logoutBtn').addEventListener('click', async () => { await api('logout'); CSRF = ''; showLogin(); });

// ── boot: load context ────────────────────────────────────────────────────────
async function boot(user) {
  showApp();
  $('#whoName').textContent = user.name || user.username;
  $('#whoSite').textContent = (user.role === 'site_manager' ? 'Site Manager' : user.role) || 'Field';
  $('#todayDate').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
  await loadData();
  go('home');
  flushQueue();
}

async function loadData() {
  const [s, w] = await Promise.all([api('get-sites', {}), api('get-labour-workers', {})]);
  SITES = (s.success && s.data) ? s.data : [];
  WORKERS = (w.success && w.data) ? w.data.filter(x => (x.status || 'active') !== 'inactive') : [];
  fillSites('#attSite'); fillSites('#wkSite'); fillSites('#exSite'); fillSites('#grnSite'); fillSites('#mSite');
  fillWorkers('#advWorker');
  await loadCashMasters();
}

// Cash-book masters (heads / banks / parties). Reading these needs accountant+,
// so for a plain site-manager login they 403 — we degrade gracefully: the money
// form still works with a free-typed head and "Cash" (no bank), and the cash
// summary card stays hidden.
async function loadCashMasters() {
  const [h, b, cl, ve] = await Promise.all([
    api('get-cash-heads', {}), api('get-banks', {}), api('get-clients', {}), api('get-vendors', {}),
  ]);
  CAN_CASH = h.success !== false && Array.isArray(h.data);
  HEADS = CAN_CASH ? h.data : [];
  BANKS = (b.success && Array.isArray(b.data)) ? b.data : [];
  const clients = (cl.success && Array.isArray(cl.data)) ? cl.data : [];
  const vendors = (ve.success && Array.isArray(ve.data)) ? ve.data : [];
  PARTIES = [
    ...clients.map(c => ({ id: c.id, name: c.name, kind: 'client' })),
    ...vendors.map(v => ({ id: v.id, name: v.name, kind: 'vendor' })),
  ];
  fillBanks(); fillParties(); smartShow();
}

function fillSites(sel) {
  const el = $(sel); if (!el) return;
  el.innerHTML = '<option value="">— Select site —</option>' +
    SITES.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
}
function fillWorkers(sel) {
  const el = $(sel); if (!el) return;
  el.innerHTML = '<option value="">— Select worker —</option>' +
    WORKERS.map(w => `<option value="${w.id}">${esc(w.name)} (${esc(w.trade || w.skill || 'Worker')})</option>`).join('');
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

// Heads for the money form. Show the income/expense heads matching the
// direction, then a single clean "🏦 Loan / EMI" option (which reveals a
// which-loan picker — no flood of loan accounts), then a "new head" fallback.
function fillHeads(kind) {
  const el = $('#mHead'); if (!el) return;
  const mine = HEADS.filter(h => h.kind === kind).map(h => h.name);
  const names = Array.from(new Set(mine));
  const hasLoans = HEADS.some(h => h.kind === 'liability' || h.kind === 'asset');
  el.innerHTML = names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('') +
    (hasLoans ? '<option value="__loan">🏦 Loan / EMI…</option>' : '') +
    '<option value="__new">＋ Type a new head…</option>';
  fillLoanPicker();
  $('#mLoanWrap').style.display = 'none';
}
// The which-loan picker: liability loans (we owe) and money lent out (asset).
function fillLoanPicker() {
  const el = $('#mLoan'); if (!el) return;
  const loans = HEADS.filter(h => h.kind === 'liability' || h.kind === 'asset');
  el.innerHTML = '<option value="">— Select a loan —</option>' +
    loans.map(l => `<option value="${esc(l.name)}">${esc(l.name.replace(/^Loan(?: Given)?:\s*/i, ''))}${l.kind === 'asset' ? ' (lent)' : ''}</option>`).join('');
}
function fillBanks() {
  const el = $('#mBank'); if (!el) return;
  if (!BANKS.length) { $('#mBankWrap').hidden = true; el.innerHTML = '<option value="">Cash</option>'; return; }
  $('#mBankWrap').hidden = false;
  el.innerHTML = '<option value="">— Cash in hand —</option>' +
    BANKS.map(b => `<option value="${b.id}">${esc(b.account_name)}</option>`).join('');
}
function fillParties() {
  const el = $('#partyList'); if (!el) return;
  el.innerHTML = PARTIES.map(p => `<option value="${esc(p.name)}">`).join('');
}

// ── home stats ────────────────────────────────────────────────────────────────
// Present/Absent here reflect the official, office-approved attendance for
// today -- not what was just tapped. A submission only becomes part of those
// counts once it shows up in "Your recent entries" as Approved.
async function refreshHome() {
  $('#stWorkers').textContent = WORKERS.length;
  const r = await api('get-attendance', { date: today() });
  const recs = (r.success && r.data) ? r.data : [];
  const present = recs.filter(x => x.status !== 'A').length;
  $('#stPresent').textContent = present;
  $('#stAbsent').textContent = recs.filter(x => x.status === 'A').length;
  const q = queue();
  $('#queueNote').hidden = q.length === 0;
  if (q.length) $('#queueNote').textContent = q.length + ' change(s) waiting to sync — will upload when back online.';
  await refreshSubmissions();
  await refreshCash();
}

// Cash position card — only for roles allowed to read the books. Reflects the
// official, office-approved figures (pending money entries are NOT counted here).
async function refreshCash() {
  if (!CAN_CASH) { $('#cashCard').hidden = true; return; }
  const r = await api('get-lite-summary', { today: today() });
  if (!r.success || !r.data) { $('#cashCard').hidden = true; return; }
  const d = r.data;
  $('#cashInHand').textContent = inr(d.cash && d.cash.total);
  $('#cashIn').textContent = inr(d.flow && d.flow.month_in);
  $('#cashOut').textContent = inr(d.flow && d.flow.month_out);
  $('#cashCard').hidden = false;
}

// ── field submission queue (attendance / expense / advance pending office approval) ──
function summarizeSubmission(row) {
  let parsed = {}; try { parsed = JSON.parse(row.payload); } catch (_) {}
  const p = parsed.payload;
  if (row.op === 'bulk-save-attendance') {
    const n = Array.isArray(p) ? p.length : 0;
    return { title: 'Attendance', detail: n + ' worker(s)' + (p && p[0] && p[0].date ? ' — ' + p[0].date : '') };
  }
  if (row.op === 'save-expense') {
    return { title: 'Site Expense', detail: (p && p.description || '') + ' — ₹' + Math.round((p && p.total_amount) || 0).toLocaleString('en-IN') };
  }
  if (row.op === 'save-advance') {
    return { title: 'Advance', detail: (p && p.party_name || 'Worker') + ' — ₹' + Math.round((p && p.amount) || 0).toLocaleString('en-IN') };
  }
  if (row.op === 'save-labour-advance') {
    const w = p && WORKERS.find(x => String(x.id) === String(p.worker_id));
    return { title: 'Wage Advance', detail: (w ? w.name : 'Worker') + ' — ₹' + Math.round((p && p.amount) || 0).toLocaleString('en-IN') };
  }
  if (row.op === 'save-grn') {
    const n = p && Array.isArray(p.items) ? p.items.length : 0;
    return { title: 'Material Received', detail: (p && p.vendor_name || 'Vendor') + ' — ' + n + ' item(s)' };
  }
  if (row.op === 'save-transaction') {
    const inOut = p && p.type === 'credit' ? 'Money In' : 'Money Out';
    return { title: inOut, detail: (p && p.category || '') + ' — ' + inr(p && p.amount) };
  }
  if (row.op === 'save-cash-head') {
    return { title: 'New Head', detail: (p && p.name || '') + (p && p.kind === 'income' ? ' (money in)' : ' (money out)') };
  }
  return { title: row.op, detail: '' };
}
async function refreshSubmissions() {
  const r = await api('get-field-submissions', {});
  const rows = (r.success && r.data) ? r.data : [];
  $('#stPending').textContent = rows.filter(x => x.status === 'pending').length;
  const recent = rows.slice(0, 6);
  $('#subList').innerHTML = recent.length ? recent.map(row => {
    const s = summarizeSubmission(row);
    const when = row.submitted_at ? String(row.submitted_at).slice(0, 16).replace('T', ' ') : '';
    const note = row.status === 'rejected' && row.review_note ? `<div class="sub-note">⚠ ${esc(row.review_note)}</div>` : '';
    return `<div class="sub-row">
      <div class="sub-top"><b>${esc(s.title)}</b><span class="sub-status ${esc(row.status)}">${esc(row.status)}</span></div>
      <small>${esc(s.detail)} · ${esc(when)}</small>
      ${note}
    </div>`;
  }).join('') : '<p class="empty-sub">No entries yet.</p>';
}

// ── attendance ────────────────────────────────────────────────────────────────
const NEXT = { P: 'H', H: 'OT', OT: 'A', A: 'P' };
async function renderAttendance() {
  const siteId = $('#attSite').value;
  const list = WORKERS.filter(w => !siteId || String(w.site_id) === String(siteId));
  // prefill from saved attendance for today
  const r = await api('get-attendance', { date: today(), site_id: siteId || undefined });
  if (r.success && r.data) r.data.forEach(rec => {
    ATT[rec.worker_id] = rec.status || 'P';
    if (rec.status === 'OT') OT_HRS[rec.worker_id] = rec.ot_hours || 2;
  });
  $('#attList').innerHTML = list.map(w => {
    const st = ATT[w.id] || 'P';
    return `<div class="worker-row" data-wid="${w.id}">
      <div class="nm"><b>${esc(w.name)}</b><small>${esc(w.trade || w.skill || 'Worker')} · ₹${w.daily_rate || w.daily_wage || 0}/day</small></div>
      <span class="badge ${st}">${attLabel(w.id, st)}</span></div>`;
  }).join('') || '<p class="muted">No workers for this site. Add one from Home.</p>';
}
// An OT worker is present the full day PLUS overtime hours — show the actual
// hours on the badge so the supervisor sees what they entered, and so it is
// not silently booked as a fixed 2h (which is what happened before).
function attLabel(wid, st) { return st === 'OT' ? ('OT ' + (OT_HRS[wid] || 2) + 'h') : st; }
$('#attSite').addEventListener('change', renderAttendance);
$('#attList').addEventListener('click', (e) => {
  const row = e.target.closest('.worker-row'); if (!row) return;
  const wid = row.dataset.wid;
  const cur = ATT[wid] || 'P';
  const next = NEXT[cur];
  if (next === 'OT') {
    // Capture the ACTUAL overtime hours instead of silently assuming 2h.
    const v = prompt('Overtime hours worked (on top of a full present day):', OT_HRS[wid] || 2);
    if (v === null) return; // cancelled — leave the worker as they were
    const n = parseFloat(v);
    if (!(n > 0)) { toast('Enter a positive number of OT hours'); return; }
    OT_HRS[wid] = n;
  }
  ATT[wid] = next;
  const b = $('.badge', row); b.className = 'badge ' + ATT[wid]; b.textContent = attLabel(wid, ATT[wid]);
});
$('#saveAtt').addEventListener('click', async () => {
  const siteId = $('#attSite').value || null;
  const list = WORKERS.filter(w => !siteId || String(w.site_id) === String(siteId));
  const records = list.map(w => ({
    worker_id: w.id, site_id: siteId ? Number(siteId) : (w.site_id || null),
    date: today(), status: ATT[w.id] || 'P', daily_wage: w.daily_rate || w.daily_wage || 0,
    ot_hours: ATT[w.id] === 'OT' ? (OT_HRS[w.id] || 2) : 0,
  }));
  if (!records.length) return toast('No workers to save');
  const body = { op: 'bulk-save-attendance', payload: records, site_id: siteId ? Number(siteId) : null };
  const r = await api('submit-field-entry', body);
  if (r.success) { toast('Attendance submitted — pending office approval ✓'); refreshHome(); }
  else if (r.offline) { enqueue('submit-field-entry', body); toast('Saved offline — will sync'); refreshHome(); }
  else toast(r.error || 'Could not save');
});

// ── add worker ────────────────────────────────────────────────────────────────
$('#workerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const data = { name: f.name.value.trim(), trade: f.trade.value.trim(), mobile: f.mobile.value.trim(),
    daily_rate: Number(f.daily_rate.value || 0), site_id: f.site_id.value ? Number(f.site_id.value) : null,
    worker_type: 'labour' };
  if (!data.name) return toast('Name required');
  const r = await api('save-labour-worker', data);
  if (r.success) { toast('Worker added ✓'); f.reset(); await loadData(); go('home'); }
  else toast(r.error || 'Could not save (need connection)');
});

// ── site expense (with bill photo) ──────────────────────────────────────────────
let EXP_PHOTO = null;
$('#expPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) { EXP_PHOTO = null; return; }
  EXP_PHOTO = await downscale(file, 1000, 0.7);
  const img = $('#expPreview'); img.src = EXP_PHOTO; img.hidden = false;
});
$('#expenseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const amount = Number(f.amount.value || 0);
  if (!f.description.value.trim() || !amount) return toast('Description and amount required');
  const data = {
    vendor_name: f.vendor_name.value.trim() || f.description.value.trim(),
    description: f.description.value.trim(), category: f.category.value,
    site_id: f.site_id.value ? Number(f.site_id.value) : null,
    bill_date: today(), subtotal: amount, total_amount: amount,
    paid_amount: amount, balance_amount: 0, status: 'paid',
  };
  const r = await api('submit-field-entry', { op: 'save-expense', payload: data, site_id: data.site_id, photo: EXP_PHOTO || null });
  if (!r.success) return toast(r.error || 'Could not save (need connection)');
  toast('Expense submitted — pending office approval ✓'); f.reset(); EXP_PHOTO = null; $('#expPreview').hidden = true; go('home');
});

// Downscale + compress an image file to a JPEG data URL (keeps payload small).
function downscale(file, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const c = document.createElement('canvas'); c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(null);
    const fr = new FileReader();
    fr.onload = () => { img.src = fr.result; };
    fr.readAsDataURL(file);
  });
}

// ── advance ────────────────────────────────────────────────────────────────────
$('#advanceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const wid = f.worker_id.value;
  const amount = Number(f.amount.value || 0);
  if (!wid || !amount) return toast('Worker and amount required');
  const w = WORKERS.find(x => String(x.id) === String(wid));
  // Route into the labour kharchi ledger (labour_advances) so the office's next
  // wage payment auto-recovers it — NOT the generic advance_ledger, which wages
  // never look at (an on-site advance must behave the same as an office one).
  const data = { worker_id: Number(wid), site_id: w ? w.site_id : null,
    advance_date: today(), amount, notes: f.notes.value.trim() || 'Site advance', payment_mode: 'cash' };
  const r = await api('submit-field-entry', { op: 'save-labour-advance', payload: data, site_id: w ? w.site_id : null });
  if (r.success) { toast('Advance submitted — pending office approval ✓'); f.reset(); go('home'); }
  else toast(r.error || 'Could not save (need connection)');
});

// ── smart entry: speak or type one line → draft → office approval ──────────────
// "diesel 500 ka" / "loan diya Akash ko 1 lakh" — the server parses it into a
// draft (deterministic, on your own server), you confirm, and it joins the same
// approval queue as every other field entry. Voice uses the phone's built-in
// speech recognition (hi-IN), so Hindi/Hinglish speech works on Android Chrome.
let SMART_DRAFT = null;
let SMART_PENDING = null;   // a one-question follow-up in progress
function smartShow() { const el = $('#smartBox'); if (el) el.hidden = !CAN_CASH; }
async function smartParse() {
  const text = $('#smartText').value.trim();
  if (!text) return;
  const prev = $('#smartPrev');
  prev.hidden = false; prev.innerHTML = '<div class="sp-sub">Reading…</div>';
  let r;
  if (SMART_PENDING) {          // this text answers the question we asked
    const p = SMART_PENDING; SMART_PENDING = null;
    r = await api('parse-quick-entry', { fill: { draft: p.draft, slot: p.slot, dir: p.dir, text } });
  } else {
    r = await api('parse-quick-entry', { text });
  }
  if (r.success && r.data && r.data.ask) {
    // one thing missing — ask it and wait for the next line
    SMART_PENDING = { draft: r.data.draft, slot: r.data.ask.slot, dir: r.data.ask.dir || null };
    SMART_DRAFT = null;
    prev.innerHTML = '<div class="sp-line">' + esc(r.data.ask.question) + '</div><div class="sp-sub">Reply below — the entry will be ready.</div>';
    $('#smartText').value = ''; $('#smartText').focus();
    return;
  }
  if (!r.success || !r.data || !r.data.draft) {
    SMART_DRAFT = null;
    prev.innerHTML = '<div class="sp-sub">' + esc((r && r.error) || 'Could not read that — try like: “diesel 500” or “loan given to Akash 100000”.') + '</div>';
    return;
  }
  SMART_DRAFT = r.data.draft;
  const d = SMART_DRAFT;
  prev.innerHTML = '<div class="sp-line">' + (d.type === 'credit' ? '⬇️ IN ' : '⬆️ OUT ') + inr(d.amount) + ' — ' + esc(d.category) + '</div>' +
    '<div class="sp-sub">' + esc(d.txn_date) + ' · ' + esc(d.payment_mode) + ' · "' + esc(d.description) + '" · posts after office approval</div>' +
    '<div class="sp-actions"><button class="sp-save" id="spSave">✓ Send</button><button class="sp-cancel" id="spCancel">Cancel</button></div>';
  $('#spSave').onclick = smartSubmit;
  $('#spCancel').onclick = () => { SMART_DRAFT = null; prev.hidden = true; $('#smartText').value = ''; };
}
async function smartSubmit() {
  if (!SMART_DRAFT) return;
  const btn = $('#spSave'); btn.disabled = true; btn.textContent = 'Sending…';
  const body = { op: 'save-transaction', payload: SMART_DRAFT, site_id: SMART_DRAFT.site_id || null };
  const r = await api('submit-field-entry', body);
  if (r.success) { toast('Sent — it posts after office approval ✓'); }
  else if (r.offline) { enqueue('submit-field-entry', body); toast('Saved offline — will sync'); }
  else { toast(r.error || 'Could not send'); btn.disabled = false; btn.textContent = '✓ Send'; return; }
  SMART_DRAFT = null; $('#smartPrev').hidden = true; $('#smartText').value = '';
  refreshHome();
}
// the form's Go button / mobile-keyboard "Go" key both submit reliably
// (mobile keyboards often don't deliver a plain Enter keydown inside a PWA)
$('#smartForm').addEventListener('submit', (e) => { e.preventDefault(); smartParse(); });

// Rubber-banding on the money form: pick a party → their usual head/site/bank
// fill themselves (only fields the user hasn't already set).
$('#mParty').addEventListener('change', async () => {
  const name = ($('#mParty').value || '').trim().toLowerCase();
  const party = PARTIES.find(p => p.name.toLowerCase() === name);
  if (!party) return;
  const r = await api('get-entry-defaults', party.kind === 'client' ? { client_id: party.id } : { vendor_id: party.id });
  if (!r.success || !r.data) return;
  const d = r.data;
  const head = $('#mHead'), site = $('#mSite'), bank = $('#mBank');
  if (d.category && head && [...head.options].some(o => o.value === d.category)) head.value = d.category;
  if (d.site_id && site && !site.value) site.value = String(d.site_id);
  if (d.bank_account_id && bank && !bank.value) bank.value = String(d.bank_account_id);
});

// ── money in / out (cashbook) ──────────────────────────────────────────────────
// Every money entry is STAGED for office approval (op 'save-transaction'); on
// approval it posts through the exact same engine the office Cash Flow screen
// uses, so the books always tie back. Nothing posts to the ledger from here.
$('#mHead').addEventListener('change', (e) => {
  // "Loan / EMI" reveals the which-loan picker; everything else hides it.
  $('#mLoanWrap').style.display = e.target.value === '__loan' ? '' : 'none';
  if (e.target.value !== '__new') return;
  const name = (prompt('Name the new head (e.g. Diesel, Rent, Brokerage):') || '').trim();
  if (!name) { e.target.value = e.target.options[0] ? e.target.options[0].value : ''; return; }
  // add it as the selected option; it is created on the office side at approval
  const opt = document.createElement('option');
  opt.value = name; opt.textContent = name + ' (new)';
  e.target.insertBefore(opt, e.target.querySelector('option[value="__new"]'));
  e.target.value = name;
});
$('#moneyForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = Number($('#mAmt').value || 0);
  let head = $('#mHead').value;
  if (head === '__loan') {                       // a loan repayment / drawdown
    head = $('#mLoan').value;
    if (!head) return toast('Pick which loan');
  }
  if (head === '__new' || !head) return toast('Pick or type a head');
  if (!(amount > 0)) return toast('Enter an amount');
  const bankId = $('#mBank').value ? Number($('#mBank').value) : null;
  const siteId = $('#mSite').value ? Number($('#mSite').value) : null;
  const partyName = $('#mParty').value.trim();
  const party = PARTIES.find(p => p.name.toLowerCase() === partyName.toLowerCase());
  const payload = {
    txn_date: $('#mDate').value || today(),
    type: MONEY_TYPE,
    category: head,
    amount,
    bank_account_id: bankId,
    client_id: party && party.kind === 'client' ? party.id : null,
    vendor_id: party && party.kind === 'vendor' ? party.id : null,
    site_id: siteId,
    description: $('#mNote').value.trim() || (partyName || head),
    payment_mode: bankId ? 'bank' : 'cash',
  };
  const r = await api('submit-field-entry', { op: 'save-transaction', payload, site_id: siteId });
  if (r.success) { toast((MONEY_TYPE === 'credit' ? 'Money in' : 'Money out') + ' submitted — pending approval ✓'); go('home'); }
  else if (r.offline) { enqueue('submit-field-entry', { op: 'save-transaction', payload, site_id: siteId }); toast('Saved offline — will sync'); go('home'); }
  else toast(r.error || 'Could not save');
});

// ── create a new head (Dr / Cr) ──────────────────────────────────────────────────
$('#headForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#hName').value.trim();
  if (!name) return toast('Head name required');
  const payload = { name, kind: $('#hKind').value === 'income' ? 'income' : 'expense' };
  const r = await api('submit-field-entry', { op: 'save-cash-head', payload });
  if (r.success) { toast('Head submitted — pending approval ✓'); e.target.reset(); go('home'); }
  else if (r.offline) { enqueue('submit-field-entry', { op: 'save-cash-head', payload }); toast('Saved offline — will sync'); go('home'); }
  else toast(r.error || 'Could not save');
});

// ── material received (GRN, with optional challan photo) ───────────────────────
function addGrnItem() {
  const row = document.createElement('div');
  row.className = 'grn-item-row';
  row.innerHTML = `<input class="gi-desc" placeholder="Material (e.g. Cement bags)">
    <input class="gi-qty" type="number" inputmode="decimal" min="0" placeholder="Qty">
    <input class="gi-unit" placeholder="Unit" value="Bags">
    <button type="button" class="gi-remove">✕</button>`;
  $('#grnItems').appendChild(row);
}
$('#grnAddItem').addEventListener('click', addGrnItem);
$('#grnItems').addEventListener('click', (e) => {
  if (!e.target.classList.contains('gi-remove')) return;
  const rows = $$('.grn-item-row', $('#grnItems'));
  if (rows.length > 1) e.target.closest('.grn-item-row').remove();
});
let GRN_PHOTO = null;
$('#grnPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) { GRN_PHOTO = null; return; }
  GRN_PHOTO = await downscale(file, 1000, 0.7);
  const img = $('#grnPreview'); img.src = GRN_PHOTO; img.hidden = false;
});
$('#grnForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const vendor = f.vendor_name.value.trim();
  if (!vendor) return toast('Vendor name required');
  const items = $$('.grn-item-row', $('#grnItems')).map(row => ({
    description: $('.gi-desc', row).value.trim(),
    received_qty: Number($('.gi-qty', row).value || 0),
    unit: $('.gi-unit', row).value.trim() || 'Nos',
  })).filter(it => it.description && it.received_qty > 0);
  if (!items.length) return toast('Add at least one item with a quantity');
  const siteId = f.site_id.value ? Number(f.site_id.value) : null;
  const data = { vendor_name: vendor, site_id: siteId, grn_date: today(), bill_no: f.bill_no.value.trim() || null, items };
  const r = await api('submit-field-entry', { op: 'save-grn', payload: data, site_id: siteId, photo: GRN_PHOTO || null });
  if (!r.success) return toast(r.error || 'Could not save (need connection)');
  toast('Material receipt submitted — pending office approval ✓');
  f.reset(); GRN_PHOTO = null; $('#grnPreview').hidden = true;
  $('#grnItems').innerHTML = ''; addGrnItem();
  go('home');
});

// ── offline queue (attendance only). Each retry creates a fresh pending
// submission, but the underlying attendance write is INSERT OR REPLACE keyed
// by worker+date, so even a duplicate submission getting approved twice does
// not corrupt the books -- it just shows office two entries to approve.
function queue() { try { return JSON.parse(localStorage.getItem('munimo_q') || '[]'); } catch (_) { return []; } }
function setQueue(q) { localStorage.setItem('munimo_q', JSON.stringify(q)); }
function enqueue(op, body) { const q = queue(); q.push({ op, body }); setQueue(q); }
let _FLUSHING = false;   // init() and boot() both call this — never run two flushes
async function flushQueue() {
  if (_FLUSHING) return;
  _FLUSHING = true;
  try {
    let q = queue(); if (!q.length) return;
    setQueue([]);                       // claim the batch atomically
    const remaining = []; let dropped = 0;
    for (const item of q) {
      const r = await api(item.op, item.body);
      if (r.success) continue;
      if (r.offline || r.status === 401 || r.status === 429) remaining.push(item);  // keep & retry later
      else { dropped++; }               // rejected by the server — tell the user, don't vanish
    }
    setQueue(remaining.concat(queue()));  // keep anything queued while we ran
    if (dropped) toast(dropped + ' saved entr' + (dropped === 1 ? 'y was' : 'ies were') + ' rejected by the server — please re-enter');
    else if (q.length && !remaining.length) toast('Synced offline changes ✓');
    refreshHome();
  } finally { _FLUSHING = false; }
}

// ── nav wiring ────────────────────────────────────────────────────────────────
$$('[data-go]').forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
$$('[data-money]').forEach(b => b.addEventListener('click', () => openMoney(b.dataset.money)));
$$('[data-back]').forEach(b => b.addEventListener('click', () => go('home')));

// ── connectivity indicator ──────────────────────────────────────────────────────
function netState() { $('#netDot').classList.toggle('off', !navigator.onLine); if (navigator.onLine) flushQueue(); }
window.addEventListener('online', netState);
window.addEventListener('offline', netState);

// ── install prompt (Add to Home Screen) ───────────────────────────────────────
// Chrome/Edge (Android + desktop) fire 'beforeinstallprompt' when the PWA is
// installable — we stash it and show our own banner so the user gets a clear,
// branded "Install" button instead of the easily-missed browser menu. iOS Safari
// has no such event, so there we show the Share → Add to Home Screen hint.
let DEFERRED_INSTALL = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
function installDismissed() { try { return localStorage.getItem('munimo_install_dismissed') === '1'; } catch (_) { return false; } }
function showInstallBanner(sub) {
  if (isStandalone() || installDismissed()) return;
  if (sub) $('#ibSub').textContent = sub;
  $('#installBanner').hidden = false;
}
function hideInstallBanner() { $('#installBanner').hidden = true; }

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();           // stop the mini-infobar; we drive our own button
  DEFERRED_INSTALL = e;
  $('#ibInstall').hidden = false;
  showInstallBanner('Add to your phone — opens like an app, works offline.');
});
window.addEventListener('appinstalled', () => { DEFERRED_INSTALL = null; hideInstallBanner(); toast('Installed ✓ — open Munimo Lite from your home screen'); });

$('#ibInstall').addEventListener('click', async () => {
  if (!DEFERRED_INSTALL) return;
  DEFERRED_INSTALL.prompt();
  try { await DEFERRED_INSTALL.userChoice; } catch (_) {}
  DEFERRED_INSTALL = null; hideInstallBanner();
});
$('#ibClose').addEventListener('click', () => {
  hideInstallBanner();
  try { localStorage.setItem('munimo_install_dismissed', '1'); } catch (_) {}
});

// On iOS there is no install event — guide the user to the Share-sheet flow.
if (isIOS() && !isStandalone() && !installDismissed()) {
  $('#ibInstall').hidden = true;
  showInstallBanner('Tap the Share button, then “Add to Home Screen”.');
}

// ── "open on your phone" helper (desktop) ─────────────────────────────────────
// The install banner only helps once the page is open ON a phone. On a desktop
// browser we instead give the user the app link to send to a phone (Copy or
// WhatsApp), so they can get it installed without already being on mobile.
const APP_LINK = location.origin + '/field/';
function copyAppLink() {
  const done = () => toast('Link copied — open it on your phone');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(APP_LINK).then(done, () => fallbackCopy());
  else fallbackCopy();
  function fallbackCopy() {
    const i = document.createElement('input'); i.value = APP_LINK; document.body.appendChild(i);
    i.select(); try { document.execCommand('copy'); } catch (_) {} i.remove(); done();
  }
}
(function setupPhoneCta() {
  const u = document.getElementById('pcUrl'); if (u) u.textContent = APP_LINK;
  const wa = document.getElementById('pcWa');
  if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent('Install our Munimo Lite app — open this on your phone and add it to your home screen: ' + APP_LINK);
})();

// ── universal company connect ────────────────────────────────────────────────
// One installed app / one link serves every company: if this host has no
// tenant behind it, ask for the company code once and jump to
// <code>.<base-domain>/field/. The code is remembered for next time.
function tenantMissing(r) {
  return r && (r.status === 404 || (typeof r.error === 'string' && /tenant|company/i.test(r.error) && /not|unknown|found/i.test(r.error)));
}
function targetHostFor(code) {
  const labels = location.hostname.split('.');
  if (labels.length >= 3) { labels[0] = code; return labels.join('.'); }
  return code + '.' + location.hostname;
}
function showConnect() {
  const box = $('#connectBox'); if (!box) return;
  box.hidden = false; $('#loginForm').style.display = 'none';
  const saved = (() => { try { return localStorage.getItem('munimo_company') || ''; } catch (e) { return ''; } })();
  if (saved) $('#companyCode').value = saved;
  $('#connectBtn').onclick = () => {
    const code = ($('#companyCode').value || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    if (!code) { $('#connectErr').textContent = 'Enter your company code.'; $('#connectErr').hidden = false; return; }
    try { localStorage.setItem('munimo_company', code); } catch (e) {}
    location.href = location.protocol + '//' + targetHostFor(code) + '/field/';
  };
}

// ── startup: restore session if any ──────────────────────────────────────────────
(async function init() {
  netState();
  const s = await api('get-session');
  if (s.success && s.data) { CSRF = s.data.csrf; await boot(s.data); }
  else { showLogin(); if (tenantMissing(s)) showConnect(); }
  if (!window.__DEMO_API && 'serviceWorker' in navigator) { try { await navigator.serviceWorker.register('sw.js', { scope: './' }); } catch (_) {} }
})();
