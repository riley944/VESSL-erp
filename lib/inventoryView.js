import { periodRange } from '@/lib/analytics';
import { SHIPPING_METHOD_OPTS } from '@/lib/productOptions';
import { statusLabel } from '@/lib/ordersView';

// ── The Inventory page: what it shows, as pure functions ─────────────────────
// The page's rows, its filters and its totals, kept out of app/page.jsx so the
// page and its export read the very same list. Nothing here writes or fetches.
//
// A ROW IS ONE PURCHASE-ORDER LINE on a live PO: one whose status is not draft,
// cancelled, closed or delivered, and none of whose shipments has arrived (an
// actual arrival, or status delivered). Its quantity is the ordered quantity.

// The PO statuses a live order can be in, in the lists' order.
export const INV_PO_STATUSES = ['received', 'confirmed', 'testing', 'in_production', 'shipped', 'invoiced'];
// "Dates by": which date the range and the timeline read. ETA is a shipment's
// estimated arrival; a PO can have none (no shipment yet) or several.
export const INV_DATES_BY = [['order', 'Order Date'], ['crd', 'Cargo Ready Date'], ['eta', 'ETA']];
export const INV_DATES_WORD = { order: 'order date', crd: 'cargo ready date', eta: 'ETA' };

// Everything the page remembers for the session (usePageState('inventory')).
// poStatusF is the PO status; catalogF is the catalog bucket the page used to
// call Status. A stored statusF from before is simply ignored.
export const INV_DEFAULTS = {
  tab: 'overview', clientF: [], factoryF: [], poStatusF: [], catalogF: [], methodF: [], search: '',
  period: 'all', from: '', to: '', datesBy: 'order',
};
const FILTER_KEYS = ['clientF', 'factoryF', 'poStatusF', 'catalogF', 'methodF', 'search', 'period', 'from', 'to', 'datesBy'];
export const clearInventoryFilters = set => FILTER_KEYS.forEach(k => set(k, INV_DEFAULTS[k]));

const inSel = (sel, v) => !Array.isArray(sel) || sel.length === 0 || sel.includes(v);
const day = s => (s ? String(s).slice(0, 10) : '');
// A shipping method as the filter names it: one of the list, Other, or "—" for none.
export const invMethod = v => { const t = String(v || '').trim(); return !t ? '—' : SHIPPING_METHOD_OPTS.includes(t) ? t : 'Other'; };

// Purchase orders, as the page reads them, to rows.
export function inventoryLines(pos) {
  const out = [];
  (pos || []).forEach(po => {
    const ships = (po.shipment_pos || []).map(sp => sp.shipments).filter(Boolean);
    if (ships.some(s => s.actual_arrival || s.status === 'delivered')) return;
    const etas = [...new Set(ships.map(s => day(s.estimated_arrival)).filter(Boolean))].sort();
    (po.purchase_order_items || []).forEach(it => {
      out.push({
        client: (po.client && po.client.name) || 'Unassigned',
        // FACTORY IS A PROPERTY OF THE PO, NOT THE LINE: a product ordered from two
        // factories belongs to both, so the factory filter narrows contributing lines.
        factory: (po.factory && po.factory.name) || 'Unassigned',
        prod: (it.products && it.products.name) || it.description || '—',
        sku: (it.products && it.products.sku) || '',
        qty: Number(it.quantity) || 0,
        po: po.client_po_number || po.order_number || String(po.id).slice(0, 8),
        poId: po.id,
        status: po.status,
        // `bucket`, the catalog state, is unrelated to the PO's status above.
        bucket: !it.products ? 'noprod' : it.products.active == null ? 'notset' : it.products.active ? 'active' : 'inactive',
        method: invMethod(po.shipping_method),
        orderDate: day(po.order_date),
        crd: day(po.cargo_ready_date),
        etas,
      });
    });
  });
  return out;
}

// The dates a line has for "Dates by": one, or for ETA every shipment's.
export const datesOf = (l, by) => (by === 'eta' ? l.etas : by === 'crd' ? (l.crd ? [l.crd] : []) : (l.orderDate ? [l.orderDate] : []));

export const isInventoryFiltered = ui => !!(['clientF', 'factoryF', 'poStatusF', 'catalogF', 'methodF'].some(k => (ui[k] || []).length)
  || (ui.search || '').trim() || ui.period !== 'all');

// The lines the filters keep. range is the period's (lib/analytics periodRange).
// noDate counts the lines that pass every other filter but have no date of the
// "Dates by" kind while the range is limited -- left out, and said so.
export function filterInventory(lines, ui, now) {
  const range = periodRange(ui.period, now, ui.from, ui.to);
  const term = (ui.search || '').trim().toLowerCase();
  let noDate = 0;
  const shown = lines.filter(l => {
    if (!inSel(ui.clientF, (l.client || '').trim() || '—')) return false;
    if (!inSel(ui.factoryF, (l.factory || '').trim() || '—')) return false;
    if (!inSel(ui.poStatusF, l.status)) return false;
    if (!inSel(ui.catalogF, l.bucket)) return false;
    if (!inSel(ui.methodF, l.method)) return false;
    if (term && !((l.prod + ' ' + l.sku).toLowerCase().includes(term))) return false;
    if (range.limited) {
      const ds = datesOf(l, ui.datesBy);
      if (!ds.length) { noDate += 1; return false; }
      if (!ds.some(d => (!range.from || d >= range.from) && (!range.to || d <= range.to))) return false;
    }
    return true;
  });
  return { shown, range, noDate };
}

// Units by a field, largest first, as [name, units].
export function sumBy(rows, key) {
  const m = {};
  rows.forEach(l => { const v = (l[key] || '').trim() || '—'; m[v] = (m[v] || 0) + l.qty; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// The three tiles. Active SKUs is distinct product + SKU across clients.
export function inventoryTiles(rows) {
  const skus = new Set(rows.map(l => l.prod + '|||' + l.sku));
  const clients = new Set(rows.map(l => l.client));
  return { units: rows.reduce((a, l) => a + l.qty, 0), skus: skus.size, clients: clients.size };
}

// ── By product ───────────────────────────────────────────────────────────────
// Every product + SKU across clients, largest first: how many clients and POs
// it is on, its units, and the lines behind them.
export function byProduct(rows) {
  const m = new Map();
  rows.forEach(l => {
    const k = l.prod + '|||' + l.sku;
    if (!m.has(k)) m.set(k, { key: k, prod: l.prod, sku: l.sku, clients: new Set(), pos: new Set(), units: 0, lines: [] });
    const g = m.get(k);
    g.clients.add(l.client); g.pos.add(l.poId); g.units += l.qty; g.lines.push(l);
  });
  return [...m.values()].map(g => ({ ...g, clients: g.clients.size, pos: g.pos.size,
    lines: g.lines.sort((a, b) => a.client.localeCompare(b.client) || a.po.localeCompare(b.po)) }))
    .sort((a, b) => b.units - a.units || a.prod.localeCompare(b.prod));
}

// ── Timeline ─────────────────────────────────────────────────────────────────
// Units by month of the "Dates by" date, months in order, the lines with no such
// date in a last bucket. A line with several ETAs counts in its earliest.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = ym => MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
export function timeline(rows, by) {
  const m = {}; let none = 0, noneLines = 0; const n = {};
  rows.forEach(l => {
    const d = datesOf(l, by)[0];
    if (!d) { none += l.qty; noneLines += 1; return; }
    const ym = d.slice(0, 7);
    m[ym] = (m[ym] || 0) + l.qty; n[ym] = (n[ym] || 0) + 1;
  });
  const out = Object.keys(m).sort().map(ym => ({ key: ym, label: monthLabel(ym), units: m[ym], lines: n[ym] }));
  if (noneLines) out.push({ key: 'none', label: 'No ' + INV_DATES_WORD[by], units: none, lines: noneLines });
  return out;
}

// ── Export ───────────────────────────────────────────────────────────────────
// The filtered view as sheet descriptions for lib/workbook.js (Excel),
// lib/exportFormats (CSV, PDF) -- the PO/SO pages' pipeline. The filters in force
// are written into every sheet as notes, so a file says what it is a cut of.

// The catalog buckets, as the page names them.
export const CATALOG_LABEL = { active: 'Active', inactive: 'Inactive', notset: 'Not Set', noprod: 'No product record' };
export const INV_TAB_TITLE = { overview: 'Overview', breakdown: 'Inventory Breakdown', product: 'By product', timeline: 'Timeline' };

const pad2 = n => String(n).padStart(2, '0');
const stamp = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
const listOr = (sel, all, label = v => v) => (Array.isArray(sel) && sel.length ? sel.map(label).join(', ') : all);

// The filters in force, as sentences.
export function inventoryFilterNotes(ui, range, noDate) {
  const notes = [
    'Client: ' + listOr(ui.clientF, 'All Clients'),
    'Factory: ' + listOr(ui.factoryF, 'All Factories'),
    'Status: ' + listOr(ui.poStatusF, 'All Statuses', statusLabel),
    'Catalog: ' + listOr(ui.catalogF, 'All Catalog', v => CATALOG_LABEL[v] || v),
    'Shipping method: ' + listOr(ui.methodF, 'All Methods'),
    'Search: ' + ((ui.search || '').trim() ? '"' + ui.search.trim() + '"' : 'None'),
    'Period: ' + range.label + (range.limited ? ', by ' + INV_DATES_WORD[ui.datesBy] : ''),
  ];
  if (range.limited && noDate) notes.push(noDate + ' line' + (noDate === 1 ? ' has' : 's have') + ' no ' + INV_DATES_WORD[ui.datesBy] + ' and ' + (noDate === 1 ? 'is' : 'are') + ' left out of this range.');
  return notes;
}

// view: { tab, ui, shown, range, noDate }. ctx: { exportedAt }.
export function buildInventorySheets(view, ctx) {
  const { tab, ui, shown, range, noDate } = view;
  const notes = ['Live purchase-order lines: ordered quantities on POs not draft, cancelled, closed or delivered, with no shipment arrived.',
    ...inventoryFilterNotes(ui, range, noDate), 'Exported ' + stamp(ctx.exportedAt)];
  const heading = 'KUI Vessl · Inventory · ' + (INV_TAB_TITLE[tab] || tab);
  const units = (title, slug, first, rows) => ({ title, slug, cols: [{ h: first }, { h: 'Units on order', fmt: 'int' }], rows, emptyText: 'Nothing on order' });
  const linesTable = () => ({ title: 'Lines on order', slug: 'Lines', freeze: true, emptyText: 'No lines match',
    cols: [{ h: 'Client' }, { h: 'Product' }, { h: 'SKU' }, { h: 'Catalog' }, { h: 'PO' }, { h: 'PO status' }, { h: 'Factory' }, { h: 'Shipping method' },
      { h: 'Order date', fmt: 'date' }, { h: 'CRD', fmt: 'date' }, { h: 'ETA' }, { h: 'Qty', fmt: 'int' }],
    rows: [...shown].sort((a, b) => a.client.localeCompare(b.client) || a.prod.localeCompare(b.prod) || a.po.localeCompare(b.po))
      .map(l => [l.client, l.prod, l.sku, CATALOG_LABEL[l.bucket] || l.bucket, l.po, statusLabel(l.status), l.factory, l.method,
        { v: l.orderDate || null, fmt: 'date' }, { v: l.crd || null, fmt: 'date' }, l.etas.join(', '), l.qty]) });
  let sheets;
  if (tab === 'breakdown') {
    sheets = [{ name: 'Lines', tables: [linesTable()] }];
  } else if (tab === 'product') {
    sheets = [
      { name: 'By product', tables: [{ title: 'Units on order by product', slug: 'By-Product', freeze: true, emptyText: 'No products match',
        cols: [{ h: 'SKU' }, { h: 'Product' }, { h: 'Clients', fmt: 'int' }, { h: 'POs', fmt: 'int' }, { h: 'Units on order', fmt: 'int' }],
        rows: byProduct(shown).map(g => [g.sku, g.prod, g.clients, g.pos, g.units]) }] },
      { name: 'Lines', tables: [linesTable()] },
    ];
  } else if (tab === 'timeline') {
    sheets = [{ name: 'Timeline', tables: [{ title: 'Units on order by month of ' + INV_DATES_WORD[ui.datesBy], slug: 'Timeline', emptyText: 'Nothing on order',
      cols: [{ h: 'Month' }, { h: 'Lines', fmt: 'int' }, { h: 'Units on order', fmt: 'int' }],
      rows: timeline(shown, ui.datesBy).map(r => [r.label, r.lines, r.units]) }] }];
  } else {
    const t = inventoryTiles(shown);
    const byStatus = INV_PO_STATUSES.map(v => [statusLabel(v), shown.filter(l => l.status === v).reduce((a, l) => a + l.qty, 0)]).filter(r => r[1] > 0);
    sheets = [
      { name: 'Summary', tables: [{ title: 'Summary', slug: 'Summary', cols: [{ h: 'Figure' }, { h: 'Value', fmt: 'int' }, { h: 'Note' }],
        rows: [['Total units on order', t.units, 'ordered quantities on live lines'], ['Active SKUs', t.skus, 'distinct products'], ['Active clients', t.clients, 'with live orders']] }] },
      { name: 'By client', tables: [units('Units on order by client', 'By-Client', 'Client', sumBy(shown, 'client'))] },
      { name: 'By factory', tables: [units('Units on order by factory', 'By-Factory', 'Factory', sumBy(shown, 'factory'))] },
      { name: 'By status', tables: [units('Units on order by status', 'By-Status', 'PO status', byStatus)] },
    ];
  }
  return sheets.map(sh => ({ ...sh, heading, notes }));
}
const INV_TAB_FILE = { overview: 'Overview', breakdown: 'Breakdown', product: 'By-Product', timeline: 'Timeline' };
export const inventoryFileName = (tab, day, ext) => 'KUI-Vessl-Inventory-' + (INV_TAB_FILE[tab] || tab) + '-' + day + '.' + ext;
export const inventoryCsvName = (tab, day) => (sh, t) => 'KUI-Vessl-Inventory-' + (t.slug || sh.name.replace(/\s+/g, '-')) + '-' + day + '.csv';
export const inventoryPdfMeta = (view, ctx) => ({ title: 'Inventory · ' + (INV_TAB_TITLE[view.tab] || view.tab), ref: '',
  lines: inventoryFilterNotes(view.ui, view.range, view.noDate), footLeft: 'KUI Vessl · Inventory · exported ' + stamp(ctx.exportedAt) });
