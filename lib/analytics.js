import { SHIPPING_METHOD_OPTS } from '@/lib/productOptions';

// ── KUI Vessl Analytics: every figure, as pure functions ──────────────────────
// The page fetches four lists and hands them here with the chosen filters; this
// file decides which records count and adds them up. No DOM, no database, no
// clock except the `now` passed in -- so the same code that draws the page can be
// run against a snapshot of the data and checked against SQL.
//
// ONE DEFINITION OF OPEN: a Sales Order whose status is not closed, delivered or
// invoiced. MONEY is Sales Order line quantity x client price. COST is the linked
// Purchase Orders' lines (quantity x unit price) plus the order's extra costs, so
// margin never includes freight or duty, and only orders WITH a factory cost
// count towards a margin (an order with no linked PO would read as 100%).
//
// TEST RECORDS are out of every figure and every dropdown: anything whose
// identifying name or number starts with ZZ, in any case --
//   Sales Order      SO number, client PO number or client name
//   Purchase Order   PO number, client PO number, factory name or client name
//   Shipment         shipment number, client name, or a linked PO's number
//   Freight quote    quote number or client name

export const OPEN_EXCLUDE = ['closed', 'delivered', 'invoiced'];
export const OPEN_STAGES = [['received', 'Received'], ['confirmed', 'Confirmed'], ['testing', 'Testing'], ['in_production', 'In Production'], ['shipped', 'Shipped']];
export const STAGE_FILTER_OPTS = [['open', 'All Open Stages'], ...OPEN_STAGES, ['delivered', 'Delivered'], ['invoiced', 'Invoiced']];
export const DATES_BY_OPTS = [['order', 'Order Date', 'order_date'], ['crd', 'Cargo Ready Date', 'cargo_ready_date'], ['cancel', 'Cancel Date', 'cancel_date']];
export const PERIOD_OPTS = [['month', 'This month'], ['3m', 'Last 3 months'], ['ytd', 'Year to date'], ['custom', 'Custom']];
export const BOOKED_METRIC_OPTS = [['revenue', 'Revenue'], ['units', 'Units'], ['orders', 'Orders'], ['margin', 'Margin']];
export const TOP_SORT_OPTS = [['revenue', 'By Revenue'], ['margin', 'By Margin'], ['units', 'By Units']];

// The filter state a fresh page starts from. With exactly this, every figure
// equals release 1.
export const ANALYTICS_DEFAULTS = {
  period: 'month', from: '', to: '', datesBy: 'order',
  client: '', factory: '', stage: 'open', method: '',
  bookedMetric: 'revenue', topSort: 'revenue',
};
export const isFiltered = f => !!(f.client || f.factory || f.method || f.stage !== 'open' || f.datesBy !== 'order' || f.period !== 'month');

const SO_UNSHIPPED = ['received', 'confirmed', 'testing', 'in_production'];
const PO_SHIPPED_OR_DONE = ['shipped', 'delivered', 'closed', 'cancelled'];
const SHIP_TERMINAL = ['delivered', 'cancelled', 'closed'];
const PO_TERMINAL = ['delivered', 'invoiced', 'closed', 'cancelled'];

export const isZZ = v => /^zz/i.test(String(v || '').trim());
// A stored shipping method outside the list counts under Other; no value is no method.
export const methodKey = v => { const t = String(v || '').trim(); return !t ? '' : SHIPPING_METHOD_OPTS.includes(t) ? t : 'Other'; };

// ── Dates, all as YYYY-MM-DD strings in local time ───────────────────────────
export const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthLen = (y, m0) => new Date(y, m0 + 1, 0).getDate();
// The same day number k months away, capped at that month's length.
const shiftMonths = (s, k) => { const d = parse(s); const t = new Date(d.getFullYear(), d.getMonth() + k, 1); return ymd(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), monthLen(t.getFullYear(), t.getMonth())))); };
const addDays = (s, k) => { const d = parse(s); d.setDate(d.getDate() + k); return ymd(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
const fmtDay = s => parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const monthName = s => parse(s).toLocaleDateString('en-US', { month: 'long' });

// The period's range, the equal earlier period it is compared with, and the
// words for both. Presets compare like for like on the calendar: this month
// with the same days of last month (release 1's comparison), the last 3 months
// with the 3 months before, year to date with the same days last year. A custom
// range compares with the same number of days immediately before it.
export function periodRange(period, now, customFrom, customTo) {
  const today = ymd(now);
  let from, to, prevFrom, prevTo, label, prevLabel;
  if (period === '3m') {
    from = ymd(new Date(now.getFullYear(), now.getMonth() - 2, 1)); to = today;
    prevFrom = shiftMonths(from, -3); prevTo = shiftMonths(to, -3);
    label = 'last 3 months'; prevLabel = fmtDay(prevFrom) + ' – ' + fmtDay(prevTo);
  } else if (period === 'ytd') {
    from = now.getFullYear() + '-01-01'; to = today;
    prevFrom = shiftMonths(from, -12); prevTo = shiftMonths(to, -12);
    label = 'year to date'; prevLabel = 'the same days of ' + (now.getFullYear() - 1);
  } else if (period === 'custom' && customFrom && customTo) {
    from = customFrom <= customTo ? customFrom : customTo; to = customFrom <= customTo ? customTo : customFrom;
    const n = daysBetween(from, to) + 1;
    prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(n - 1));
    label = fmtDay(from) + ' – ' + fmtDay(to); prevLabel = 'the previous ' + n + ' day' + (n === 1 ? '' : 's');
  } else {
    from = today.slice(0, 8) + '01'; to = today;
    prevFrom = shiftMonths(from, -1); prevTo = shiftMonths(to, -1);
    label = 'this month'; prevLabel = 'same days of ' + monthName(prevFrom);
  }
  return { from, to, prevFrom, prevTo, label, prevLabel };
}

// ── The page ─────────────────────────────────────────────────────────────────
export function buildAnalytics(raw, f, now) {
  const today = ymd(now);
  const range = periodRange(f.period, now, f.from, f.to);
  const dateBy = DATES_BY_OPTS.find(o => o[0] === f.datesBy) || DATES_BY_OPTS[0];
  const dateField = dateBy[2], dateName = dateBy[1].toLowerCase();

  // Sales Orders, with the money worked out once.
  const sosAll = (raw.sos || [])
    .filter(so => !(isZZ(so.so_number) || isZZ(so.client_po_number) || isZZ(so.client?.name)))
    .map(so => {
      const items = so.sales_order_items || [];
      const links = (so.sales_order_pos || []).map(l => l.purchase_orders).filter(Boolean);
      const rev = items.reduce((a, i) => a + (Number(i.quantity) || 0) * (Number(i.client_price) || 0), 0);
      const units = items.reduce((a, i) => a + (Number(i.quantity) || 0), 0);
      const factoryCost = links.reduce((a, p) => a + (p.purchase_order_items || []).reduce((b, i) => b + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0), 0);
      const extra = (so.order_costs || []).reduce((a, c) => a + (Number(c.amount) || 0), 0);
      return { ...so, rev, units, factoryCost, cost: factoryCost + extra, open: !OPEN_EXCLUDE.includes(so.status),
        factoryIds: links.map(p => p.factory_company_id).filter(Boolean) };
    });
  // Client, factory (through the linked POs) and the SO's own shipping method.
  const soSel = so => (!f.client || so.client_company_id === f.client)
    && (!f.factory || so.factoryIds.includes(f.factory))
    && (!f.method || methodKey(so.shipping_method) === f.method);
  const sos = sosAll.filter(soSel);
  const stageOk = so => f.stage === 'open' || so.status === f.stage;

  // ── Current state, as of today ────────────────────────────────────────────
  // The pipeline set: open orders, or with one stage chosen, that stage's orders
  // -- Delivered and Invoiced included, which the page then says.
  const single = f.stage !== 'open';
  const stageLabel = (STAGE_FILTER_OPTS.find(o => o[0] === f.stage) || [])[1] || '';
  const pipe = sos.filter(so => single ? so.status === f.stage : so.open);
  const pipeValue = pipe.reduce((a, so) => a + so.rev, 0);
  const pipeUnits = pipe.reduce((a, so) => a + so.units, 0);
  const activeClients = new Set(pipe.map(so => so.client?.name).filter(Boolean)).size;
  const costed = pipe.filter(so => so.factoryCost > 0);
  const costedRev = costed.reduce((a, so) => a + so.rev, 0);
  const blended = costedRev > 0 ? (costedRev - costed.reduce((a, so) => a + so.cost, 0)) / costedRev * 100 : null;
  let stages;
  if (single) {
    stages = [{ key: f.stage, label: stageLabel, count: pipe.length, value: pipeValue }];
  } else {
    stages = OPEN_STAGES.map(([key, label]) => { const r = pipe.filter(so => so.status === key); return { key, label, count: r.length, value: r.reduce((a, so) => a + so.rev, 0) }; });
    const known = OPEN_STAGES.map(s => s[0]);
    const other = pipe.filter(so => !known.includes(so.status));
    if (other.length) stages.push({ key: 'other', label: 'Other status', count: other.length, value: other.reduce((a, so) => a + so.rev, 0) });
  }
  const done = sos.filter(so => so.status === 'delivered' || so.status === 'invoiced');
  const completed = { count: done.length, value: done.reduce((a, so) => a + so.rev, 0) };

  // Purchase Orders: their own client, factory and shipping method. Order stage
  // is a Sales Order status, so it does not apply to them.
  const posAll = (raw.pos || []).filter(po => !(isZZ(po.order_number) || isZZ(po.client_po_number) || isZZ(po.factory?.name) || isZZ(po.client?.name)));
  const pos = posAll.filter(po => (!f.client || po.client_company_id === f.client) && (!f.factory || po.factory_company_id === f.factory) && (!f.method || methodKey(po.shipping_method) === f.method));
  const poUnshipped = pos.filter(po => !PO_SHIPPED_OR_DONE.includes(po.status));
  const facMap = {};
  pos.filter(po => po.status === 'in_production').forEach(po => {
    const n = po.factory?.name || 'No factory';
    const x = facMap[n] || (facMap[n] = { name: n, count: 0, late: 0 });
    x.count++; if (po.cargo_ready_date && po.cargo_ready_date < today) x.late++;
  });
  const byFactory = Object.values(facMap).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Shipments: their own client; factory and shipping method through the linked
  // Purchase Orders (a shipment has neither of its own). Order stage does not
  // apply. Active = not delivered, cancelled or closed, no actual arrival, and
  // no linked PO delivered, invoiced, closed or cancelled.
  const linkedPOs = s => (s.shipment_pos || []).map(l => l.purchase_orders).filter(Boolean);
  const ships = (raw.ships || [])
    .filter(s => !(isZZ(s.shipment_number) || isZZ(s.client?.name) || linkedPOs(s).some(p => isZZ(p.order_number) || isZZ(p.client_po_number))))
    .filter(s => !SHIP_TERMINAL.includes(String(s.status || '').toLowerCase()) && !s.actual_arrival
      && !linkedPOs(s).some(p => PO_TERMINAL.includes(String(p.status || '').toLowerCase())))
    .filter(s => (!f.client || s.client_company_id === f.client)
      && (!f.factory || linkedPOs(s).some(p => p.factory_company_id === f.factory))
      && (!f.method || linkedPOs(s).some(p => methodKey(p.shipping_method) === f.method)));
  const nowMs = now.getTime();
  const overdue = ships.filter(s => s.estimated_arrival && new Date(s.estimated_arrival).getTime() < nowMs)
    .sort((a, b) => new Date(a.estimated_arrival) - new Date(b.estimated_arrival));
  const noEta = ships.filter(s => !s.estimated_arrival);
  const horizon = nowMs + 56 * 86400000;
  const arriving = ships.filter(s => { const t = s.estimated_arrival && new Date(s.estimated_arrival).getTime(); return t && t >= nowMs && t <= horizon; })
    .sort((a, b) => new Date(a.estimated_arrival) - new Date(b.estimated_arrival));

  // Freight quotes have a client and nothing else the filters know about.
  const fqs = (raw.fqs || []).filter(q => !(isZZ(q.quote_number) || isZZ(q.client?.name)))
    .filter(q => q.status === 'sent' && (!f.client || q.client_company_id === f.client));
  const oldestSent = fqs.filter(q => q.sent_at).sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at))[0] || null;

  // ── Booked: the period, by the chosen date ────────────────────────────────
  // With All Open Stages the booked figures cover every status, as release 1
  // did; with one stage chosen, only that stage's orders.
  const bookBase = sos.filter(so => f.stage === 'open' || so.status === f.stage);
  const dated = bookBase.filter(so => so[dateField]);
  const missingDate = bookBase.length - dated.length;
  const within = (so, a, b) => so[dateField] >= a && so[dateField] <= b;
  const booked = dated.filter(so => within(so, range.from, range.to));
  const prevBooked = dated.filter(so => within(so, range.prevFrom, range.prevTo));
  const sumRev = list => list.reduce((a, so) => a + so.rev, 0);
  const bookedRev = sumRev(booked), prevRev = sumRev(prevBooked);
  const bookedDelta = prevRev > 0 ? (bookedRev - prevRev) / prevRev * 100 : null;
  const marginOf = list => { const c = list.filter(so => so.factoryCost > 0); const r = sumRev(c); return r > 0 ? (r - c.reduce((a, so) => a + so.cost, 0)) / r * 100 : null; };

  // Monthly bars: every month the period touches, and at least the six months
  // ending with its last month, for context. A month inside the period counts
  // only its in-period days; a context month counts the whole month up to today.
  const toM = range.to.slice(0, 7), fromM = range.from.slice(0, 7);
  const toD = parse(toM + '-01');
  let start = new Date(toD.getFullYear(), toD.getMonth() - 5, 1);
  const fromD = parse(fromM + '-01');
  if (fromD < start) start = fromD;
  const monthsCount = Math.min(24, (toD.getFullYear() - start.getFullYear()) * 12 + toD.getMonth() - start.getMonth() + 1);
  start = new Date(toD.getFullYear(), toD.getMonth() - (monthsCount - 1), 1);
  const curM = today.slice(0, 7);
  const months = [];
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = ymd(d).slice(0, 7);
    const inPeriod = key >= fromM && key <= toM;
    const list = dated.filter(so => so[dateField].slice(0, 7) === key && (inPeriod ? within(so, range.from, range.to) : so[dateField] <= today));
    months.push({ key, inPeriod, current: key === curM,
      label: d.toLocaleDateString('en-US', { month: 'short' }) + (d.getMonth() === 0 || i === 0 ? ' ' + d.getFullYear() : ''),
      revenue: sumRev(list), units: list.reduce((a, so) => a + so.units, 0), orders: list.length, margin: marginOf(list) });
  }

  // Top clients in the period.
  const byClient = {};
  booked.forEach(so => {
    const n = so.client?.name || 'No client';
    const c = byClient[n] || (byClient[n] = { name: n, rev: 0, units: 0, list: [] });
    c.rev += so.rev; c.units += so.units; c.list.push(so);
  });
  const sortKey = { revenue: c => c.rev, units: c => c.units, margin: c => (c.margin == null ? -Infinity : c.margin) }[f.topSort] || (c => c.rev);
  const topClients = Object.values(byClient).map(c => ({ name: c.name, rev: c.rev, units: c.units, margin: marginOf(c.list) }))
    .sort((a, b) => sortKey(b) - sortKey(a) || b.rev - a.rev).slice(0, 6);

  return {
    today, range, dateName, single, stageLabel, filtered: isFiltered(f),
    pipeCount: pipe.length, pipeValue, pipeUnits, activeClients, blended, costedCount: costed.length,
    stages, completed,
    bookedRev, bookedCount: booked.length, bookedDelta, missingDate, months, topClients,
    byFactory, overdue, noEta, arriving, fqSent: fqs.length, oldestSent,
    soPastCancel: sos.filter(so => so.open && stageOk(so) && so.cancel_date && so.cancel_date < today).length,
    poPastCancel: poUnshipped.filter(po => po.cancel_date && po.cancel_date < today).length,
    soPastCrd: sos.filter(so => SO_UNSHIPPED.includes(so.status) && stageOk(so) && so.cargo_ready_date && so.cargo_ready_date < today).length,
    poPastCrd: poUnshipped.filter(po => po.cargo_ready_date && po.cargo_ready_date < today).length,
  };
}

// The dropdown lists: every client with a Sales Order, every factory with a
// Purchase Order, test records left out, sorted by name.
export function filterOptions(raw) {
  const clients = new Map(), factories = new Map();
  (raw.sos || []).forEach(so => {
    if (isZZ(so.so_number) || isZZ(so.client_po_number) || isZZ(so.client?.name)) return;
    if (so.client_company_id && so.client?.name) clients.set(so.client_company_id, so.client.name);
  });
  (raw.pos || []).forEach(po => {
    if (isZZ(po.order_number) || isZZ(po.client_po_number) || isZZ(po.factory?.name) || isZZ(po.client?.name)) return;
    if (po.factory_company_id && po.factory?.name) factories.set(po.factory_company_id, po.factory.name);
  });
  const sorted = m => [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  return { clients: sorted(clients), factories: sorted(factories) };
}
