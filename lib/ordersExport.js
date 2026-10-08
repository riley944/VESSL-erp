import { statusLabel, soMetrics, soUnits, poClient, poFactory } from '@/lib/ordersView';
import { poLineBlocks } from '@/lib/poLines';
import { safeName } from '@/lib/exportFormats';

// ── Sales Orders and Purchase Orders: the export, as Excel, CSV or PDF ───────
// Downloads only. The list exports are built from the rows soListView and
// poListView give the page -- its filters, search, status view and order -- and
// a single order from the record its card shows. lib/workbook.js lays the sheet
// descriptions out as Excel; lib/exportFormats.js turns the same descriptions
// into CSV files and a PDF.
//
// MONEY IS LEFT OUT AT ONE PLACE. Every money column carries money: true and
// every money row of a Field / Value table is built through kvRows with its
// money flag. finish() runs last on every set of sheets: when ctx.showMoney is
// false it drops each money column from every table, and kvRows has already
// dropped each money row, so no format can see a value the person is not shown.
// The page decides showMoney (see canSeeOrderMoney in app/page.jsx).

const D = 'date';
const ref = o => o.client_po_number || o.so_number || o.order_number || '';
const pad = n => String(n).padStart(2, '0');
const stampText = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
const num = v => (v == null || v === '' ? null : Number(v));

// Field / Value rows; a money row is left out unless money may be shown.
const KV_COLS = [{ h: 'Field' }, { h: 'Value' }];
const kvRows = (list, showMoney) => list.filter(r => showMoney || !r[3])
  .map(([k, v, fmt]) => [k, fmt ? { v: v == null || v === '' ? null : v, fmt } : (v == null ? '' : v)]);

// Drop every money column from every table, cells and all.
export function withoutMoney(sheets) {
  return sheets.map(sh => ({ ...sh, tables: (sh.tables || []).map(t => {
    const keep = t.cols.map((c, i) => (c.money ? -1 : i)).filter(i => i >= 0);
    if (keep.length === t.cols.length) return t;
    return { ...t, cols: keep.map(i => t.cols[i]), rows: t.rows.map(r => keep.map(i => r[i])) };
  }) }));
}
const finish = (sheets, ctx) => (ctx.showMoney ? sheets : withoutMoney(sheets));

const summaryRows = (rows, ctx, sheetNames) => kvRows([
  ['Exported', ctx.exportedAt, 'datetime'], ['Exported by', ctx.user || ''], ['Sheets', sheetNames.join(', ')],
  ...rows,
], ctx.showMoney).map(r => (r[0] === 'Filters' || r[0] === 'Counts' || r[0] === 'Notes' ? [{ v: r[0], bold: true }, '', ''] : [...r, '']));
const filterText = (sel, all, label = x => x) => (Array.isArray(sel) && sel.length ? sel.map(label).join(', ') : all);

// ═══ SALES ORDERS ═════════════════════════════════════════════════════════════
const SO_SORT_LABEL = { newest: 'Newest SO', oldest: 'Oldest SO', crd_asc: 'CRD earliest', crd_desc: 'CRD latest' };
const SO_CRD_LABEL = { has: 'Has CRD', none: 'No CRD' };
const linkedPos = so => (so.sales_order_pos || []).map(l => l.purchase_orders).filter(Boolean);
const poCost = po => (po.purchase_order_items || []).reduce((a, i) => a + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);

const SO_ORDER_COLS = [
  { h: 'Client PO' }, { h: 'SO number' }, { h: 'Client' }, { h: 'Status' }, { h: 'Order date', fmt: D }, { h: 'Cargo ready date', fmt: D },
  { h: 'INDC', fmt: D }, { h: 'Cancel date', fmt: D }, { h: 'Payment terms' }, { h: 'Shipping method' }, { h: 'Currency' }, { h: 'Invoice number' },
  { h: 'Linked POs' }, { h: 'Lines', fmt: 'int' }, { h: 'Units', fmt: 'int' },
  { h: 'Revenue', fmt: 'usd', money: true }, { h: 'Factory cost', fmt: 'usd', money: true }, { h: 'Other costs', fmt: 'usd', money: true },
  { h: 'Gross margin', fmt: 'usd', money: true }, { h: 'Margin %', fmt: 'pct', money: true }, { h: 'Ship-to address' }, { h: 'Notes' },
];
const soOrderRow = so => { const m = soMetrics(so);
  return [so.client_po_number || '', so.so_number || '', so.client?.name || '', statusLabel(so.status), so.order_date, so.cargo_ready_date,
    so.indc_date || so.required_ship_date, so.cancel_date, so.payment_terms || '', so.shipping_method || '', so.currency || 'USD', so.invoice_number || '',
    linkedPos(so).map(p => p.client_po_number || p.order_number).filter(Boolean).join(', '), (so.sales_order_items || []).length, soUnits(so),
    m.rev, m.factoryCost, m.addlCost, m.gross, m.mgn, so.delivery_address || '', so.notes || '']; };
const SO_LINE_COLS = [{ h: 'Description' }, { h: 'Client SKU' }, { h: 'Size' }, { h: 'Qty', fmt: 'int' }, { h: 'Unit price', fmt: 'price', money: true }, { h: 'Amount', fmt: 'usd', money: true }];
const soLineCells = it => [it.description || it.products?.name || '', it.client_sku || '', it.size || '', num(it.quantity) || 0,
  num(it.client_price) || 0, (Number(it.quantity) || 0) * (Number(it.client_price) || 0)];

// shown: soListView(...).shown. view: { ui, sortBy, crdF, totals, totalUnits }.
export function buildSoListSheets(shown, view, ctx) {
  const orders = { title: 'Orders', slug: 'Orders', cols: SO_ORDER_COLS, rows: shown.map(soOrderRow), freeze: true, emptyText: 'No sales orders match',
    pdfCols: ['Client PO', 'SO number', 'Client', 'Status', 'Order date', 'Cargo ready date', 'Cancel date', 'Payment terms', 'Shipping method', 'Units', 'Revenue', 'Gross margin', 'Margin %'] };
  const lines = { title: 'Line items', slug: 'Line-Items', cols: [{ h: 'Client PO' }, { h: 'SO number' }, { h: 'Client' }, ...SO_LINE_COLS],
    rows: shown.flatMap(so => (so.sales_order_items || []).map(it => [so.client_po_number || '', so.so_number || '', so.client?.name || '', ...soLineCells(it)])),
    emptyText: 'No line items' };
  const names = ['Summary', 'Orders', 'Line items'];
  const { ui, sortBy, crdF } = view;
  const summary = { name: 'Summary', kv: true, tables: [{ cols: [{ h: 'Item' }, { h: 'Value' }, { h: 'Detail' }], rows: summaryRows([
    ['Filters'], ['Search', ui.search ? '“' + ui.search + '”' : 'None'], ['Client', filterText(ui.clientF, 'All Clients')],
    ['Status', filterText(ui.statusF, 'All Statuses', statusLabel)], ['CRD', filterText(crdF, 'All CRD', k => SO_CRD_LABEL[k] || k)],
    ['Sort', (sortBy.length ? sortBy : ['newest']).map(k => SO_SORT_LABEL[k] || k).join(', then ')],
    ['Counts'], ['Orders', view.totals.n, 'int'], ['Pipeline revenue', view.totals.rev, 'usd', true], ['Total units', view.totalUnits, 'int'],
  ], ctx, names) }] };
  return finish([summary, { name: 'Orders', tables: [orders] }, { name: 'Line items', tables: [lines] }], ctx)
    .map(s => ({ ...s, heading: 'KUI Vessl · Sales Orders' + (s.name === 'Summary' ? '' : ' · ' + s.name) }));
}

export function buildSoRecordSheets(so, ctx) {
  const m = soMetrics(so); const sm = ctx.showMoney;
  const fields = kvRows([
    ['Client PO', so.client_po_number], ['SO number', so.so_number], ['Client', so.client?.name], ['Status', statusLabel(so.status)],
    ['Order date', so.order_date, D], ['Cargo ready date', so.cargo_ready_date, D], ['INDC', so.indc_date || so.required_ship_date, D], ['Cancel date', so.cancel_date, D],
    ['Payment terms', so.payment_terms], ['Shipping method', so.shipping_method], ['Currency', so.currency || 'USD'], ['Invoice number', so.invoice_number],
    ['Ship-to address', so.delivery_address], ['Notes', so.notes], ['Lines', (so.sales_order_items || []).length, 'int'], ['Units', soUnits(so), 'int'],
    ['Revenue', m.rev, 'usd', true], ['Factory cost', m.factoryCost, 'usd', true], ['Other costs', m.addlCost, 'usd', true],
    ['Gross margin', m.gross, 'usd', true], ['Margin %', m.mgn, 'pct', true],
  ], sm);
  const tables = [
    { title: 'The order', slug: 'Details', cols: KV_COLS, rows: fields },
    { title: 'Line items', slug: 'Line-Items', cols: SO_LINE_COLS, rows: (so.sales_order_items || []).map(soLineCells), emptyText: 'No line items', freeze: true },
    { title: 'Linked factory POs', slug: 'Linked-POs', cols: [{ h: 'Purchase Order' }, { h: 'Client PO' }, { h: 'Factory' }, { h: 'Status' }, { h: 'Factory cost', fmt: 'usd', money: true }],
      rows: linkedPos(so).map(p => [p.order_number || '', p.client_po_number || '', p.factory?.name || p.companies?.name || '', statusLabel(p.status), poCost(p)]), emptyText: 'No factory POs linked' },
  ];
  // Additional costs are money through and through: the table goes when money does.
  if (sm) tables.push({ title: 'Additional costs', slug: 'Costs', cols: [{ h: 'Kind' }, { h: 'Note' }, { h: 'Amount', fmt: 'usd', money: true }],
    rows: (so.order_costs || []).map(c => [c.kind || '', c.note || '', num(c.amount) || 0]), emptyText: 'No additional costs' });
  return finish([{ name: 'Sales Order', tables, notes: ['Exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '')] }], ctx)
    .map(s => ({ ...s, heading: 'KUI Vessl · Sales Order ' + ref(so) }));
}

// ═══ PURCHASE ORDERS ══════════════════════════════════════════════════════════
const PO_FIELDS = { description: it => it.description || it.products?.name || '', sku: it => it.product_sku || it.products?.sku || '', product: it => it.product_id || '', size: it => it.size || '' };
// A PO's lines in the order its detail page and document read them: styles
// together, sizes in scale order, with the printed size label.
function poLinesInOrder(p) {
  const blocks = poLineBlocks(p.purchase_order_items || [], PO_FIELDS);
  return blocks.flatMap(b => (b.kind === 'line' ? [{ it: b.line, size: b.line.size || '' }] : b.lines.map(l => ({ it: l, size: (b.labels && b.labels.get(l)) || l.size || '' }))));
}
const poTotals = p => { const sub = (p.purchase_order_items || []).reduce((a, i) => a + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const mold = Number(p.mold_fee || 0); const grand = sub + mold; return { sub, mold, grand, dep: p.deposit_percent ? grand * (p.deposit_percent / 100) : null }; };
const poUnits = p => (p.purchase_order_items || []).reduce((a, i) => a + (Number(i.quantity) || 0), 0);

const PO_ORDER_COLS = [
  { h: 'PO number' }, { h: 'Client PO' }, { h: 'Client' }, { h: 'Factory' }, { h: 'Status' }, { h: 'Production %', fmt: 'int' },
  { h: 'Order date', fmt: D }, { h: 'CRD', fmt: D }, { h: 'Requested ship date', fmt: D }, { h: 'Cancel date', fmt: D },
  { h: 'Payment terms' }, { h: 'Incoterm' }, { h: 'Shipping method' }, { h: 'Currency' }, { h: 'Lines', fmt: 'int' }, { h: 'Units', fmt: 'int' },
  { h: 'Goods subtotal', fmt: 'usd', money: true }, { h: 'Mold fee', fmt: 'usd', money: true }, { h: 'Total', fmt: 'usd', money: true },
  { h: 'Deposit %', fmt: 'num' }, { h: 'Deposit', fmt: 'usd', money: true }, { h: 'Sample fee', fmt: 'usd', money: true }, { h: 'Notes' },
];
const poOrderRow = p => { const t = poTotals(p);
  return [p.order_number || '', p.client_po_number || '', poClient(p), poFactory(p), statusLabel(p.status), num(p.production_pct),
    p.order_date, p.cargo_ready_date, p.requested_ship_date, p.cancel_date, p.payment_terms || '', p.incoterm || '', p.shipping_method || '', p.currency || 'USD',
    (p.purchase_order_items || []).length, poUnits(p), t.sub, t.mold || null, t.grand, num(p.deposit_percent), t.dep, num(p.sample_fee), p.notes || '']; };
const PO_LINE_COLS = [{ h: 'Description' }, { h: 'SKU' }, { h: 'Size' }, { h: 'VPN' }, { h: 'Master SKU' }, { h: 'Pack SKU' }, { h: 'Baby SKU' }, { h: 'Carton info' },
  { h: 'Qty', fmt: 'int' }, { h: 'CI value', fmt: 'usd', money: true }, { h: 'Unit cost', fmt: 'price', money: true }, { h: 'Amount', fmt: 'usd', money: true },
  { h: 'Retail price', fmt: 'usd', money: true }];
const poLineCells = ({ it, size }) => [PO_FIELDS.description(it), PO_FIELDS.sku(it), size, it.vpn || '', it.master_sku || '', it.pack_sku || '', it.baby_sku || '',
  it.carton_info || '', num(it.quantity) || 0, num(it.ci_value), num(it.unit_price) || 0, (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), num(it.retail_price)];

// onScreen: poListView(...).onScreen. view: { ui, offBoard }.
export function buildPoListSheets(onScreen, view, ctx) {
  const orders = { title: 'Orders', slug: 'Orders', cols: PO_ORDER_COLS, rows: onScreen.map(poOrderRow), freeze: true, emptyText: 'No purchase orders match',
    pdfCols: ['PO number', 'Client PO', 'Client', 'Factory', 'Status', 'Order date', 'CRD', 'Cancel date', 'Payment terms', 'Shipping method', 'Units', 'Total'] };
  const lines = { title: 'Line items', slug: 'Line-Items', cols: [{ h: 'PO number' }, { h: 'Client PO' }, { h: 'Factory' }, ...PO_LINE_COLS],
    rows: onScreen.flatMap(p => poLinesInOrder(p).map(x => [p.order_number || '', p.client_po_number || '', poFactory(p), ...poLineCells(x)])),
    emptyText: 'No line items', pdfCols: ['PO number', 'Client PO', 'Factory', 'Description', 'SKU', 'Size', 'Carton info', 'Qty', 'Unit cost', 'Amount'] };
  const names = ['Summary', 'Orders', 'Line items'];
  const { ui } = view;
  const summary = { name: 'Summary', kv: true, tables: [{ cols: [{ h: 'Item' }, { h: 'Value' }, { h: 'Detail' }], rows: summaryRows([
    ['Filters'], ['Search', ui.search ? '“' + ui.search + '”' : 'None'], ['Client', filterText(ui.client, 'All Clients')],
    ['Status', filterText(ui.status, 'All Statuses', statusLabel)], ['View', ui.view === 'board' ? 'Production Board' : 'List'],
    ['Counts'], ['Purchase orders', onScreen.length, 'int'],
    ...(view.offBoard ? [['Not on the board', view.offBoard, 'int']] : []),
  ], ctx, names) }] };
  if (view.offBoard) summary.tables[0].rows.push(['', '', view.offBoard + ' matching PO' + (view.offBoard === 1 ? ' has a status' : 's have statuses') + ' the Production Board has no column for, so ' + (view.offBoard === 1 ? 'it is' : 'they are') + ' not listed']);
  return finish([summary, { name: 'Orders', tables: [orders] }, { name: 'Line items', tables: [lines] }], ctx)
    .map(s => ({ ...s, heading: 'KUI Vessl · Purchase Orders' + (s.name === 'Summary' ? '' : ' · ' + s.name) }));
}

export function buildPoRecordSheets(p, ctx) {
  const t = poTotals(p); const sm = ctx.showMoney;
  const fields = kvRows([
    ['PO number', p.order_number], ['Client PO', p.client_po_number], ['Client', poClient(p)], ['Factory', poFactory(p)], ['Status', statusLabel(p.status)],
    ['Production %', num(p.production_pct), 'int'], ['Order date', p.order_date, D], ['CRD', p.cargo_ready_date, D], ['Requested ship date', p.requested_ship_date, D],
    ['Cancel date', p.cancel_date, D], ['Payment terms', p.payment_terms], ['Incoterm', p.incoterm], ['Shipping method', p.shipping_method], ['Currency', p.currency || 'USD'],
    ['Delivery address', p.delivery_address], ['Notes', p.notes], ['Lines', (p.purchase_order_items || []).length, 'int'], ['Units', poUnits(p), 'int'],
    ['Goods subtotal', t.sub, 'usd', true], ['Mold fee', t.mold || null, 'usd', true], ['Total', t.grand, 'usd', true],
    ['Deposit %', num(p.deposit_percent), 'num'], ['Deposit', t.dep, 'usd', true], ['Sample fee', num(p.sample_fee), 'usd', true],
  ], sm);
  const tables = [
    { title: 'The order', slug: 'Details', cols: KV_COLS, rows: fields },
    { title: 'Line items', slug: 'Line-Items', cols: PO_LINE_COLS, rows: poLinesInOrder(p).map(poLineCells), emptyText: 'No line items', freeze: true,
      pdfCols: ['Description', 'SKU', 'Size', 'VPN', 'Carton info', 'Qty', 'CI value', 'Unit cost', 'Amount', 'Retail price'] },
  ];
  return finish([{ name: 'Purchase Order', tables, notes: ['Exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '')] }], ctx)
    .map(s => ({ ...s, heading: 'KUI Vessl · Purchase Order ' + ref(p) }));
}

// ═══ FILE NAMES AND PDF HEADERS ═══════════════════════════════════════════════
// KUI-Vessl-Sales-Orders-2026-10-08.xlsx; a single order adds its reference:
// KUI-Vessl-Sales-Order-<ref>-2026-10-08.xlsx. CSV names carry the filters.
const KIND = { so: { list: 'Sales-Orders', one: 'Sales-Order', title: 'Sales Orders', oneTitle: 'Sales Order' },
               po: { list: 'Purchase-Orders', one: 'Purchase-Order', title: 'Purchase Orders', oneTitle: 'Purchase Order' } };
export const orderRef = ref;
export const ordersListFileName = (kind, day, ext = 'xlsx') => 'KUI-Vessl-' + KIND[kind].list + '-' + day + '.' + ext;
export const orderFileName = (kind, o, day, ext, table, i = 0) =>
  'KUI-Vessl-' + KIND[kind].one + '-' + safeName(ref(o)) + (i > 0 && table ? '-' + table.slug : '') + '-' + day + '.' + ext;
const many = (sel, noun) => (!Array.isArray(sel) || !sel.length ? null : sel.length === 1 ? safeName(sel[0]) : sel.length + '-' + noun);
export function ordersCsvName(kind, table, view, day) {
  const ui = view.ui; const bits = [KIND[kind].list, table.slug];
  if (kind === 'so') {
    [many(ui.clientF, 'clients'), many((ui.statusF || []).map(statusLabel), 'statuses'), many((view.crdF || []).map(k => SO_CRD_LABEL[k] || k), 'crd')].forEach(b => b && bits.push(b));
    const s = view.sortBy && view.sortBy.length ? view.sortBy : ['newest'];
    if (!(s.length === 1 && s[0] === 'newest')) bits.push('Sort-' + s.map(k => safeName(SO_SORT_LABEL[k] || k)).join('-'));
  } else {
    [many(ui.client, 'clients'), many((ui.status || []).map(statusLabel), 'statuses')].forEach(b => b && bits.push(b));
    if (ui.view === 'board') bits.push('Board');
  }
  if (ui.search) bits.push('Search-' + safeName(ui.search));
  return 'KUI-Vessl-' + bits.join('-') + '-' + day + '.csv';
}
export const ordersPdfMeta = (kind, ctx) => ({ title: KIND[kind].title, ref: '', lines: [],
  footLeft: 'KUI Vessl · ' + KIND[kind].title + ' · exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '') });
export const orderPdfMeta = (kind, o, ctx) => ({ title: KIND[kind].oneTitle, ref: ref(o), lines: ['Exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '')],
  footLeft: 'KUI Vessl · ' + KIND[kind].oneTitle + ' ' + ref(o) + ' · exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '') });
