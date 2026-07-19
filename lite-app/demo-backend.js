/* Munimo Lite — offline DEMO backend.
   Makes the REAL Lite PWA run live in the browser with dummy data and no login.
   Active only when the page URL has ?demo=1 (or when embedded). It replaces the
   app's api(op,body) with an in-memory mock seeded from real API response shapes. */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  if (params.get('demo') !== '1' && !/(^|[?&])embed=1/.test(location.search)) return;

  var today = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();

  // ── seed data (dummy — modelled on real API shapes) ──
  var SESSION = { id: 1, username: 'demo', name: 'Rajesh Kumar', role: 'owner', csrf: 'demo-csrf' };

  var SITES = [
    { id: 1, name: 'Riverfront Housing — Tower B', status: 'active' },
    { id: 2, name: 'GS Road Commercial Complex', status: 'active' },
    { id: 3, name: 'Sector-5 Warehouse', status: 'active' }
  ];

  var WORKERS = [
    { id: 8,  name: 'Akhil Tanti',   trade: 'Painter',    daily_rate: 680, site_id: 1, status: 'active', mobile: '9101010008' },
    { id: 9,  name: 'Babul Hussain', trade: 'Carpenter',  daily_rate: 780, site_id: 1, status: 'active', mobile: '9101010009' },
    { id: 10, name: 'Dinesh Yadav',  trade: 'Bar Bender', daily_rate: 700, site_id: 1, status: 'active', mobile: '9101010010' },
    { id: 11, name: 'Jiten Boro',    trade: 'Mason',      daily_rate: 750, site_id: 2, status: 'active', mobile: '9101010011' },
    { id: 12, name: 'Manoj Das',     trade: 'Helper',     daily_rate: 520, site_id: 2, status: 'active', mobile: '9101010012' },
    { id: 13, name: 'Nazrul Islam',  trade: 'Welder',     daily_rate: 820, site_id: 2, status: 'active', mobile: '9101010013' },
    { id: 14, name: 'Pankaj Nath',   trade: 'Electrician',daily_rate: 760, site_id: 3, status: 'active', mobile: '9101010014' },
    { id: 15, name: 'Rakesh Sah',    trade: 'Plumber',    daily_rate: 720, site_id: 3, status: 'active', mobile: '9101010015' },
    { id: 16, name: 'Sameer Ali',    trade: 'Helper',     daily_rate: 520, site_id: 1, status: 'active', mobile: '9101010016' },
    { id: 17, name: 'Tapan Deka',    trade: 'Mason',      daily_rate: 750, site_id: 2, status: 'active', mobile: '9101010017' }
  ];

  var HEADS = [
    { id: 1, name: 'Client Receipt',  kind: 'income' },
    { id: 2, name: 'Advance Received', kind: 'income' },
    { id: 3, name: 'Diesel',          kind: 'expense' },
    { id: 4, name: 'Material',        kind: 'expense' },
    { id: 5, name: 'Labour Wages',    kind: 'expense' },
    { id: 6, name: 'Site Expense',    kind: 'expense' },
    { id: 7, name: 'Rent',            kind: 'expense' }
  ];

  var BANKS = [
    { id: 1, account_name: 'Current A/c - SBI', bank_name: 'State Bank of India', account_type: 'current', current_balance: 4185000, is_primary: 1, status: 'active' },
    { id: 4, account_name: 'Cash in Hand',      bank_name: 'Cash',               account_type: 'cash',    current_balance: 92500,   is_primary: 0, status: 'active' },
    { id: 2, account_name: 'Current A/c - HDFC',bank_name: 'HDFC Bank',          account_type: 'current', current_balance: 1640000, is_primary: 0, status: 'active' }
  ];

  var CLIENTS = [
    { id: 3, name: 'City Municipal Council', kind: 'client' },
    { id: 4, name: 'Skyline Developers Pvt Ltd', kind: 'client' },
    { id: 6, name: 'Eastern Railway Projects', kind: 'client' }
  ];
  var VENDORS = [
    { id: 8, name: 'Assam Electricals & Wiring', kind: 'vendor' },
    { id: 9, name: 'Dalmia Cement Agency', kind: 'vendor' },
    { id: 10, name: 'IOC Fuel Station', kind: 'vendor' }
  ];

  var FLOW = { month_in: 0, month_out: 0, month_net: 0, today_in: 0, today_out: 0 };
  var CASH_TOTAL = 5357500;

  // attendance: worker_id -> {status, ot_hours} for approved (office) records
  var APPROVED_ATT = [
    { worker_id: 8, status: 'P' }, { worker_id: 9, status: 'P' }, { worker_id: 10, status: 'P' },
    { worker_id: 11, status: 'P' }, { worker_id: 12, status: 'OT', ot_hours: 2 }, { worker_id: 13, status: 'P' },
    { worker_id: 14, status: 'P' }, { worker_id: 15, status: 'A' }, { worker_id: 16, status: 'P' }
  ];

  // pending field submissions (what the office still has to approve)
  var SUBMISSIONS = [
    { op: 'save-transaction', status: 'pending', submitted_at: today + ' 09:12',
      payload: JSON.stringify({ payload: { type: 'debit', category: 'Diesel', amount: 3200, description: 'JCB diesel — IOC' } }) },
    { op: 'bulk-save-attendance', status: 'approved', submitted_at: today + ' 07:40',
      payload: JSON.stringify({ payload: [{ date: today }, {}, {}, {}, {}, {}, {}, {}] }) }
  ];

  function ok(data) { return { success: true, status: 200, data: data }; }

  // ── the mock API ──
  window.__DEMO_API = function (op, body) {
    body = body || {};
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(route(op, body)); }, 140); // tiny latency = feels real
    });
  };

  function route(op, body) {
    switch (op) {
      case 'login':       return ok(SESSION);
      case 'get-session': return ok(SESSION);
      case 'logout':      return { success: true };

      case 'get-sites':           return ok(SITES);
      case 'get-labour-workers':  return ok(WORKERS);
      case 'get-cash-heads':      return ok(HEADS);
      case 'get-banks':           return ok(BANKS);
      case 'get-clients':         return ok(CLIENTS);
      case 'get-vendors':         return ok(VENDORS);
      case 'get-entry-defaults':  return ok({});

      case 'get-lite-summary':
        return ok({ today: today, month: today.slice(0, 7),
          cash: { total: CASH_TOTAL, accounts: BANKS.map(function (b) { return { id: b.id, account_name: b.account_name, bank_name: b.bank_name, account_type: b.account_type, current_balance: b.current_balance }; }) },
          flow: FLOW, heads: [], recent: [] });

      case 'get-attendance':
        return ok(APPROVED_ATT.map(function (a) { return { worker_id: a.worker_id, status: a.status, ot_hours: a.ot_hours || 0 }; }));

      case 'get-field-submissions':
        return ok(SUBMISSIONS.slice());

      case 'save-labour-worker': {
        var id = 100 + WORKERS.length;
        WORKERS.push({ id: id, name: body.name || 'New Worker', trade: body.trade || 'Worker',
          daily_rate: body.daily_rate || 0, site_id: body.site_id || null, status: 'active', mobile: body.mobile || '' });
        return ok({ id: id });
      }

      case 'submit-field-entry': {
        var inner = body.payload;
        SUBMISSIONS.unshift({ op: body.op, status: 'pending', submitted_at: stamp(),
          payload: JSON.stringify({ payload: inner }) });
        if (body.op === 'save-transaction' && inner && inner.amount) {
          if (inner.type === 'credit') { FLOW.month_in += inner.amount; FLOW.today_in += inner.amount; }
          else { FLOW.month_out += inner.amount; FLOW.today_out += inner.amount; }
        }
        return { success: true };
      }

      case 'parse-quick-entry': {
        var text = (body.text || (body.fill && body.fill.text) || '').trim();
        var draft = parseText(text, body.fill);
        if (!draft) return { success: true, data: { error: 'Could not read that — try like: “diesel 3200 paid” or “received 50000 from Gupta”.' } };
        return { success: true, data: { draft: draft } };
      }

      default:
        // unknown read ops → empty list; unknown writes → success. Keeps the app happy.
        return { success: true, data: [] };
    }
  }

  function stamp() { var d = new Date(); return today + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // very small natural-language parser (demo). Returns a draft the app can preview.
  function parseText(t, fill) {
    if (!t) return null;
    var low = t.toLowerCase();
    var m = low.replace(/[,]/g, '').match(/(\d+(?:\.\d+)?)\s*(k|hazar|lakh)?/);
    if (!m) return null;
    var amt = parseFloat(m[1]);
    if (m[2] === 'k' || m[2] === 'hazar') amt *= 1000;
    if (m[2] === 'lakh') amt *= 100000;
    if (!(amt > 0)) return null;
    var isIn = /(received|receipt|got|mila|mile|aaye|aya|advance received|jama)/.test(low);
    var type = isIn ? 'credit' : 'debit';
    var cat = 'Site Expense';
    if (/diesel|fuel|petrol/.test(low)) cat = 'Diesel';
    else if (/cement|steel|sand|brick|material|saman/.test(low)) cat = 'Material';
    else if (/labour|mazdoor|majdoor|wage|mason|worker|kooli|kuli/.test(low)) cat = 'Labour Wages';
    else if (/rent|kiraya/.test(low)) cat = 'Rent';
    else if (isIn) cat = 'Client Receipt';
    if (fill && fill.slot === 'category' && t) cat = t.replace(/[\d,]/g, '').trim() || cat;
    return { type: type, amount: amt, category: cat, txn_date: today, payment_mode: 'cash',
      description: t, site_id: null };
  }
})();
