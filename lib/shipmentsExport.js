import { ymd } from '@/lib/analytics';
import { shipmentStatusLabel } from '@/lib/shipmentStatus';
import { isLCL } from '@/lib/rfqSheet';
import { lclBidTotal, bidEffective } from '@/lib/freightBids';
import { shipClient, rfqPill, QF_DEFAULT, QF_LABEL } from '@/lib/shipmentsView';
import { safeName } from '@/lib/exportFormats';

// ── The Shipments page: the export, as Excel, CSV or PDF ──────────────────────
// Downloads only. Nothing here reads the database: every sheet is built from
// the lists shipmentsView gives the page -- the client filter, the search box,
// the freight quote status filter and the In transit / Delivered / All buttons
// already applied -- so a sheet lists exactly the rows on screen. Test records
// are NOT left out: the page shows them, so the export does too.
//
// These descriptions are the single source for all three formats: lib/workbook.js
// lays them out as Excel (the writer the Analytics export uses), and
// lib/exportFormats.js turns the very same ones into CSV files and a PDF.

export const SHIPMENT_TABS = [
  { id: 'quotes', title: 'Freight Quotes', file: 'Freight-Quotes' },
  { id: 'shipments', title: 'Shipments', file: 'Shipments' },
  { id: 'delivery', title: 'Delivery Requests', file: 'Delivery-Requests' },
];
export const SHIPMENTS_ALL = ['quotes', 'shipments', 'delivery'];

export const shipmentsFileName = (tab, day, ext = 'xlsx') =>
  'KUI-Vessl-Shipments-' + (tab ? (SHIPMENT_TABS.find(t => t.id === tab) || {}).file + '-' : '') + day + '.' + ext;

// A timestamp's calendar day where the exporter is, as the page shows it; a
// plain date stays as it is.
const localDay = v => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : ymd(new Date(v)));
const dateOrText = v => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).trim()) ? { v: String(v).trim(), fmt: 'date' } : { v: v || '', fmt: 'text' });
const pieces = q => (q.line_items || []).reduce((a, l) => a + (Number(l.pieces) || 0), 0);

// A bid's amount as the cards read it: an LCL bid is one all-in total for the
// shipment; anything else is per container, times the containers needed.
function bidAmounts(b, q) {
  const lcl = isLCL(q);
  const rate = lcl ? (lclBidTotal(b) || 0) : bidEffective(b, q.container_type || '40HQ');
  const ct = Math.max(1, Number(q.containers_needed) || 1);
  return { rate, basis: lcl ? 'LCL all-in' : 'Per container', total: lcl ? rate : rate * ct };
}

function quotesSheet(V, bids) {
  const shown = V.shownQuotes;
  const rows = shown.map(q => {
    const w = V.winnerOf(q.id);
    // The card names the selected bid unless the RFQ is resolved without it.
    const resolved = q.status === 'not_selected' || q.status === 'archived';
    const a = w && !resolved ? bidAmounts(w, q) : null;
    const lcl = isLCL(q);
    return [q.quote_number || '', (q.client || {}).name || '', rfqPill(q.status).label, QF_LABEL[V.qKey(q)] || '',
      q.origin || '', q.destination || '', lcl ? 'LCL' : (q.container_type || "40'HQ"), lcl ? null : (Number(q.containers_needed) || 0),
      pieces(q) || null, Number(q.total_cbm) || 0, q.ready_date, localDay(q.created_at), localDay(q.sent_at), V.bidCount(q.id),
      a ? (w.forwarder_name || 'Selected') : '', a ? a.rate : null, a ? a.basis : '', a ? a.total : null, a && w.transit_days ? Number(w.transit_days) : null];
  });
  const order = new Map(shown.map((q, i) => [q.id, i]));
  const byId = new Map(shown.map(q => [q.id, q]));
  const bidRows = bids.filter(b => order.has(b.shipment_quote_id))
    .sort((x, y) => order.get(x.shipment_quote_id) - order.get(y.shipment_quote_id) || String(x.created_at || '').localeCompare(String(y.created_at || '')))
    .map(b => { const q = byId.get(b.shipment_quote_id); const a = bidAmounts(b, q);
      return [q.quote_number || '', (q.client || {}).name || '', b.forwarder_name || '', b.carrier || '', a.rate || null, a.basis, a.rate ? a.total : null,
        b.transit_days != null && b.transit_days !== '' ? Number(b.transit_days) : null, b.free_days != null && b.free_days !== '' ? Number(b.free_days) : null,
        dateOrText(b.valid_until), b.selected ? 'Yes' : 'No', localDay(b.created_at)]; });
  return {
    name: 'Freight Quotes',
    notes: ['One row per freight quote shown on the page, then one row per bid on those quotes. Rate is per container, or the all-in total for an LCL quote; shipment total is rate times containers needed.'],
    tables: [
      { cols: [{ h: 'Quote' }, { h: 'Client' }, { h: 'Status' }, { h: 'Filter group' }, { h: 'Origin' }, { h: 'Destination' }, { h: 'Container or LCL' }, { h: 'Containers', fmt: 'int' },
        { h: 'Pieces', fmt: 'int' }, { h: 'CBM', fmt: 'num' }, { h: 'Cargo ready date', fmt: 'date' }, { h: 'Created', fmt: 'date' }, { h: 'Sent', fmt: 'date' }, { h: 'Bids', fmt: 'int' },
        { h: 'Awarded or selected forwarder' }, { h: 'Rate', fmt: 'usd' }, { h: 'Rate basis' }, { h: 'Shipment total', fmt: 'usd' }, { h: 'Transit days', fmt: 'int' }],
        rows, freeze: true, emptyText: 'No freight quotes match', tab: 'quotes', slug: 'Freight-Quotes',
        pdfCols: ['Quote', 'Client', 'Status', 'Origin', 'Destination', 'Container or LCL', 'Containers', 'CBM', 'Cargo ready date', 'Sent', 'Bids', 'Awarded or selected forwarder', 'Rate', 'Shipment total'] },
      { title: 'Bids on these quotes', cols: [{ h: 'Quote' }, { h: 'Client' }, { h: 'Forwarder' }, { h: 'Carrier' }, { h: 'Rate', fmt: 'usd' }, { h: 'Rate basis' }, { h: 'Shipment total', fmt: 'usd' },
        { h: 'Transit days', fmt: 'int' }, { h: 'Free days', fmt: 'int' }, { h: 'Valid until' }, { h: 'Selected' }, { h: 'Received', fmt: 'date' }],
        rows: bidRows, emptyText: 'No bids on these quotes', tab: 'quotes', slug: 'Freight-Quote-Bids',
        pdfCols: ['Quote', 'Client', 'Forwarder', 'Carrier', 'Rate', 'Rate basis', 'Shipment total', 'Transit days', 'Valid until', 'Selected'] },
    ],
  };
}

function shipmentsSheet(V, coNames) {
  const rows = V.shownShips.map(s => {
    const pos = (s.shipment_pos || []).map(l => l.purchase_orders).filter(Boolean);
    const po = pos[0] || {};
    const delivered = s.status === 'delivered' || !!s.actual_arrival;
    const days = s.actual_arrival ? null : V.etaDays(s.estimated_arrival);
    return [po.client_po_number || po.order_number || s.shipment_number || '', s.shipment_number || '', shipClient(s),
      pos.map(p => p.order_number).filter(Boolean).join(', '), pos.map(p => p.client_po_number).filter(Boolean).join(', '),
      coNames[s.carrier_company_id] || '', [s.vessel_name, s.voyage_no].filter(Boolean).join(' · '), s.container_no || '',
      shipmentStatusLabel(s.status), localDay(s.estimated_departure), localDay(s.estimated_arrival), localDay(s.actual_arrival),
      !delivered && days !== null && days >= 0 ? days : null, !delivered && days !== null && days < 0 ? -days : null];
  });
  return {
    name: 'Shipments',
    notes: ['One row per shipment shown on the page. Reference is what the card shows: the client PO, else the order number, else the shipment number. Days to ETA and days overdue are blank once a shipment is delivered.'],
    tables: [{ cols: [{ h: 'Reference' }, { h: 'Shipment' }, { h: 'Client' }, { h: 'Purchase Orders' }, { h: 'Client POs' }, { h: 'Carrier' }, { h: 'Vessel' }, { h: 'Container' },
      { h: 'Status' }, { h: 'ETD', fmt: 'date' }, { h: 'ETA', fmt: 'date' }, { h: 'Actual arrival', fmt: 'date' }, { h: 'Days to ETA', fmt: 'int' }, { h: 'Days overdue', fmt: 'int' }],
      rows, emptyText: 'No shipments match', tab: 'shipments', slug: 'Shipments',
      pdfCols: ['Reference', 'Client', 'Purchase Orders', 'Carrier', 'Vessel', 'Container', 'Status', 'ETD', 'ETA', 'Actual arrival', 'Days to ETA', 'Days overdue'] }],
  };
}

function deliverySheet(V, coNames, refOf) {
  const rows = V.dreqsV.map(d => {
    const hit = refOf ? refOf(d.shipment_ref) : null;
    const ship = hit ? (hit.ships[0] || null) : null;
    return [coNames[d.client_company_id] || 'Unknown client', d.shipment_ref || '',
      hit ? (hit.via === 'so' ? 'Sales order' : 'Shipment') : 'Unmatched ref', ship ? (ship.shipment_number || '') : '', ship ? shipmentStatusLabel(ship.status) : '',
      d.container_no || '', d.requested_date, d.eta, d.proposed_date, d.note || '', d.status || 'requested', d.requested_by || '',
      d.created_at ? { v: new Date(d.created_at), fmt: 'datetime' } : null, d.kui_response_note || '',
      d.responded_at ? { v: new Date(d.responded_at), fmt: 'datetime' } : null, d.responded_by || ''];
  });
  return {
    name: 'Delivery Requests',
    notes: ['Every delivery request for the client chosen, open and answered, as the tab lists them. The search box does not apply to this tab.'],
    tables: [{ cols: [{ h: 'Client' }, { h: 'Reference' }, { h: 'Refers to' }, { h: 'Shipment' }, { h: 'Shipment status' }, { h: 'Container' },
      { h: 'Requested date', fmt: 'date' }, { h: 'ETA', fmt: 'date' }, { h: 'Date we proposed', fmt: 'date' }, { h: 'Note' }, { h: 'Status' }, { h: 'Requested by' },
      { h: 'Requested at', fmt: 'datetime' }, { h: 'Our reply' }, { h: 'Answered at', fmt: 'datetime' }, { h: 'Answered by' }],
      rows, emptyText: 'No delivery requests', tab: 'delivery', slug: 'Delivery-Requests',
      pdfCols: ['Client', 'Reference', 'Refers to', 'Shipment status', 'Requested date', 'Date we proposed', 'Note', 'Status', 'Requested at', 'Our reply', 'Answered by'] }],
  };
}

const TAB_WORD = { active: 'In transit', delivered: 'Delivered', all: 'All' };

function summarySheet(V, ctx, sheetNames, searchOn) {
  const ui = ctx.ui;
  const qSel = !ui.qSel.length ? 'All statuses'
    : (ui.qSel.length === QF_DEFAULT.length && QF_DEFAULT.every(v => ui.qSel.includes(v))) ? 'Default: ' + QF_DEFAULT.map(k => QF_LABEL[k]).join(', ') + ' (not selected and archived hidden)'
    : ui.qSel.map(k => QF_LABEL[k] || k).join(', ');
  const rows = [
    ['Exported', { v: ctx.exportedAt, fmt: 'datetime' }, ''],
    ['Exported by', ctx.user || '', ''],
    ['Sheets', sheetNames.join(', '), ''],
    [{ v: 'Filters', bold: true }, '', ''],
    ['Client', V.cSel || 'All Clients', 'All three tabs'],
    ['Search', ui.search ? '“' + ui.search + '”' : 'None', ui.search ? 'Applies to the ' + searchOn + ' sheet, the tab it was typed on' : ''],
    ['Freight quote status', qSel, ''],
    ['Shipments shown', TAB_WORD[ui.tab] || ui.tab, ui.shipFilter ? 'Narrowed by the ' + (ui.shipFilter === 'arriving' ? 'Arriving ≤14d' : 'Overdue') + ' tile' : ''],
    [{ v: 'Tiles, as shown on the page', bold: true }, '', ''],
    ...V.tiles.map(t => [t.k, { v: t.v, fmt: 'int' }, '']),
    [{ v: 'Counts', bold: true }, '', ''],
    ['Freight quotes for this client', { v: V.quotesV.length, fmt: 'int' }, 'The Freight Quotes tab number'],
    ['Shipments for this client', { v: V.rowsV.length, fmt: 'int' }, 'The Shipments tab number'],
    ['Open delivery requests', { v: V.openDreqsV.length, fmt: 'int' }, 'The Delivery Requests tab number'],
    [{ v: 'Notes', bold: true }, '', ''],
    ['Test records', 'Included', 'ZZ records are listed, as the page lists them'],
    ['Money', 'Freight bids and rates', 'Rate, Shipment total and the bids table are forwarder prices'],
  ];
  return { name: 'Summary', kv: true, notes: [], tables: [{ cols: [{ h: 'Item' }, { h: 'Value' }, { h: 'Detail' }], rows }] };
}

// views: { [tab]: V } -- the list each sheet draws from. The tab on screen keeps
// the search; the others are built without it, because switching tabs on the
// page clears the search box. ctx: { exportedAt, user, ui, bids, coNames, refOf }.
export function buildShipmentsSheets(views, ctx, tabs) {
  const make = { quotes: V => quotesSheet(V, ctx.bids), shipments: V => shipmentsSheet(V, ctx.coNames), delivery: V => deliverySheet(V, ctx.coNames, ctx.refOf) };
  const sections = tabs.map(t => make[t](views[t]));
  const onScreen = (SHIPMENT_TABS.find(t => t.id === ctx.ui.view) || {}).title || '';
  const summary = summarySheet(views[ctx.ui.view] || views[tabs[0]], ctx, ['Summary', ...sections.map(s => s.name)], onScreen);
  return [summary, ...sections].map(s => ({ ...s, heading: 'KUI Vessl Shipments' + (s.name === 'Summary' ? '' : ' · ' + s.name) }));
}

// ── File names and the PDF's header, for a tab export ────────────────────────
// CSV has no Summary file, so each CSV's name carries the filters that shaped
// that table: the client, then for freight quotes a non-default status filter,
// for shipments the In transit / Delivered / All choice and a tile filter, and
// the search on the tab it was typed on.
const TAB_FILE = { active: 'In-transit', delivered: 'Delivered', all: 'All' };
export function shipmentsCsvName(table, ui, day) {
  const bits = [table.slug];
  if (ui.client) bits.push(safeName(ui.client));
  if (table.tab === 'quotes') {
    const isDefault = ui.qSel.length === QF_DEFAULT.length && QF_DEFAULT.every(v => ui.qSel.includes(v));
    if (!isDefault) bits.push(ui.qSel.length ? 'Status-' + ui.qSel.map(k => safeName(QF_LABEL[k] || k)).join('-') : 'All-statuses');
  }
  if (table.tab === 'shipments') { bits.push(TAB_FILE[ui.tab] || safeName(ui.tab)); if (ui.shipFilter) bits.push(ui.shipFilter === 'arriving' ? 'Arriving' : 'Overdue'); }
  if (ui.search && table.tab === ui.view && table.tab !== 'delivery') bits.push('Search-' + safeName(ui.search));
  return 'KUI-Vessl-Shipments-' + bits.join('-') + '-' + day + '.csv';
}

const pad = n => String(n).padStart(2, '0');
const stampText = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());

// What the PDF prints in its letterhead and footer. The filters and tile counts
// print from the Summary sheet itself, so they are the Excel file's words.
export function shipmentsPdfMeta(tab, ctx) {
  const t = SHIPMENT_TABS.find(x => x.id === tab);
  return { title: 'Shipments export', ref: t ? t.title : 'All tabs', lines: [],
    footLeft: 'KUI Vessl · Shipments' + (t ? ' · ' + t.title : '') + ' · exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '') };
}

// ── One record: a freight quote, a shipment or a delivery request ────────────
// The per-card download. Same three formats, from these descriptions. A record
// is a two-column Field / Value table, then the lists that belong to it.
export const RECORD_KINDS = {
  quote: { title: 'Freight Quote', file: 'Freight-Quote' },
  shipment: { title: 'Shipment', file: 'Shipment' },
  delivery: { title: 'Delivery Request', file: 'Delivery-Request' },
};
const shipRef = s => { const po = ((s.shipment_pos || [])[0] || {}).purchase_orders || {}; return po.client_po_number || po.order_number || s.shipment_number || ''; };
export const recordRef = (kind, r) => (kind === 'quote' ? r.quote_number : kind === 'shipment' ? shipRef(r) : r.shipment_ref) || '';

const KV_COLS = [{ h: 'Field' }, { h: 'Value' }];
const kvRows = list => list.map(([k, v, fmt]) => [k, fmt ? { v: v == null || v === '' ? null : v, fmt } : (v == null ? '' : v)]);

function quoteRecord(q, ctx) {
  const V = ctx.V;
  const mine = ctx.bids.filter(b => b.shipment_quote_id === q.id).sort((x, y) => String(x.created_at || '').localeCompare(String(y.created_at || '')));
  const w = V.winnerOf(q.id);
  const resolved = q.status === 'not_selected' || q.status === 'archived';
  const a = w && !resolved ? bidAmounts(w, q) : null;
  const lcl = isLCL(q);
  const items = q.line_items || [];
  const fields = kvRows([
    ['Quote', q.quote_number], ['Client', (q.client || {}).name], ['Status', rfqPill(q.status).label], ['Filter group', QF_LABEL[V.qKey(q)]],
    ['RFQ sent to', (q.forwarder || {}).name], ['Origin', q.origin], ['Destination', q.destination], ['Incoterm', q.incoterm],
    ['Container or LCL', lcl ? 'LCL' : (q.container_type || "40'HQ")], ['Containers needed', lcl ? null : Number(q.containers_needed) || 0, 'int'],
    ['Total cartons', Number(q.total_cartons) || 0, 'int'], ['Total pieces', pieces(q) || null, 'int'], ['Total CBM', Number(q.total_cbm) || 0, 'num'],
    ['Total weight (kg)', q.total_weight_kg == null ? null : Number(q.total_weight_kg), 'num'], ['Utilization (%)', q.utilization_pct == null ? null : Number(q.utilization_pct), 'num'],
    ['Cargo ready date', q.ready_date, 'date'], ['Created', localDay(q.created_at), 'date'], ['Sent', localDay(q.sent_at), 'date'], ['Bids', mine.length, 'int'],
    ['Awarded or selected forwarder', a ? (w.forwarder_name || 'Selected') : ''], ['Rate', a ? a.rate : null, 'usd'], ['Rate basis', a ? a.basis : ''],
    ['Shipment total', a ? a.total : null, 'usd'], ['Transit days', a && w.transit_days ? Number(w.transit_days) : null, 'int'],
    ['Notes for forwarder', q.notes || ''],
  ]);
  const cartons = items.map(l => [l.desc || '', l.upc == null || l.upc === '' ? null : Number(l.upc), Number(l.cartons) || 0, l.pieces == null || l.pieces === '' ? null : Number(l.pieces),
    Number(l.cbm_per) || 0, l.weight == null || l.weight === '' ? null : Number(l.weight), Number(l.cbm_total) || 0]);
  const bidRows = mine.map(b => { const x = bidAmounts(b, q);
    return [b.forwarder_name || '', b.carrier || '', x.rate || null, x.basis, x.rate ? x.total : null,
      b.transit_days != null && b.transit_days !== '' ? Number(b.transit_days) : null, b.free_days != null && b.free_days !== '' ? Number(b.free_days) : null,
      dateOrText(b.valid_until), b.selected ? 'Yes' : 'No', localDay(b.created_at), b.notes || '']; });
  return { name: 'Freight Quote', tables: [
    { title: 'The quote', cols: KV_COLS, rows: fields, slug: 'Details' },
    { title: 'Cartons and CBM', cols: [{ h: 'Description' }, { h: 'Pcs/Ctn', fmt: 'int' }, { h: 'Cartons', fmt: 'int' }, { h: 'Pieces', fmt: 'int' }, { h: 'CBM/ctn', fmt: 'num4' }, { h: 'Kg/ctn', fmt: 'num' }, { h: 'Total CBM', fmt: 'num3' }],
      rows: cartons, slug: 'Cartons', emptyText: 'No carton lines on this quote' },
    { title: 'Bids', cols: [{ h: 'Forwarder' }, { h: 'Carrier' }, { h: 'Rate', fmt: 'usd' }, { h: 'Rate basis' }, { h: 'Shipment total', fmt: 'usd' }, { h: 'Transit days', fmt: 'int' },
      { h: 'Free days', fmt: 'int' }, { h: 'Valid until' }, { h: 'Selected' }, { h: 'Received', fmt: 'date' }, { h: 'Bid notes' }], rows: bidRows, slug: 'Bids', emptyText: 'No bids yet', freeze: true },
  ] };
}

function shipmentRecord(s, ctx) {
  const pos = (s.shipment_pos || []).map(l => l.purchase_orders).filter(Boolean);
  const delivered = s.status === 'delivered' || !!s.actual_arrival;
  const days = s.actual_arrival ? null : ctx.V.etaDays(s.estimated_arrival);
  const fields = kvRows([
    ['Reference', shipRef(s)], ['Shipment', s.shipment_number], ['Client', shipClient(s)], ['Status', shipmentStatusLabel(s.status)],
    ['Carrier', ctx.coNames[s.carrier_company_id]], ['Vessel', s.vessel_name], ['Voyage', s.voyage_no], ['Container', s.container_no],
    ['Booking number', s.booking_number], ['Bill of lading', s.bill_of_lading], ['Incoterm', s.inco_term],
    ['ETD', localDay(s.estimated_departure), 'date'], ['ETA', localDay(s.estimated_arrival), 'date'],
    ['Actual departure', localDay(s.actual_departure), 'date'], ['Actual arrival', localDay(s.actual_arrival), 'date'],
    ['Days to ETA', !delivered && days !== null && days >= 0 ? days : null, 'int'], ['Days overdue', !delivered && days !== null && days < 0 ? -days : null, 'int'],
  ]);
  const poRows = pos.map(p => [p.order_number || '', p.client_po_number || '', ctx.coNames[p.factory_company_id] || '', (p.client || {}).name || '']);
  return { name: 'Shipment', tables: [
    { title: 'The shipment', cols: KV_COLS, rows: fields, slug: 'Details' },
    { title: 'Linked Purchase Orders', cols: [{ h: 'Purchase Order' }, { h: 'Client PO' }, { h: 'Factory' }, { h: 'Client' }], rows: poRows, slug: 'Purchase-Orders', emptyText: 'No Purchase Orders linked', freeze: true },
  ] };
}

function deliveryRecord(d, ctx) {
  const hit = ctx.refOf ? ctx.refOf(d.shipment_ref) : null;
  const ship = hit ? (hit.ships[0] || null) : null;
  const fields = kvRows([
    ['Client', ctx.coNames[d.client_company_id] || 'Unknown client'], ['Reference', d.shipment_ref],
    ['Refers to', hit ? (hit.via === 'so' ? 'Sales order' + (ship ? '' : ', no shipment yet') : 'Shipment') : 'Unmatched ref'],
    ['Shipment', ship ? ship.shipment_number : ''], ['Shipment status', ship ? shipmentStatusLabel(ship.status) : ''], ['Container', d.container_no],
    ['Requested date', d.requested_date, 'date'], ['ETA', d.eta, 'date'], ['Requested by', d.requested_by],
    ['Requested at', d.created_at ? new Date(d.created_at) : null, 'datetime'], ['Note', d.note || ''], ['Status', d.status || 'requested'],
    ['Date we proposed', d.proposed_date, 'date'], ['Our reply', d.kui_response_note || ''],
    ['Answered at', d.responded_at ? new Date(d.responded_at) : null, 'datetime'], ['Answered by', d.responded_by],
  ]);
  return { name: 'Delivery Request', tables: [{ title: 'The request', cols: KV_COLS, rows: fields, slug: 'Details', freeze: true }] };
}

// kind: 'quote' | 'shipment' | 'delivery'. ctx: { exportedAt, user, V, bids, coNames, refOf }.
export function buildRecordSheets(kind, rec, ctx) {
  const sh = (kind === 'quote' ? quoteRecord : kind === 'shipment' ? shipmentRecord : deliveryRecord)(rec, ctx);
  const ref = recordRef(kind, rec);
  return [{ ...sh, heading: 'KUI Vessl · ' + RECORD_KINDS[kind].title + (ref ? ' ' + ref : ''),
    notes: ['Exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '')] }];
}

// KUI-Vessl-Freight-Quote-FQ-3B3M3-2026-10-08.xlsx; a record's second and later
// CSV tables add their name: ...-FQ-3B3M3-Bids-2026-10-08.csv.
export const recordFileName = (kind, rec, day, ext, table, i = 0) =>
  'KUI-Vessl-' + RECORD_KINDS[kind].file + '-' + safeName(recordRef(kind, rec)) + (i > 0 && table ? '-' + table.slug : '') + '-' + day + '.' + ext;

export function recordPdfMeta(kind, rec, ctx) {
  return { title: RECORD_KINDS[kind].title, ref: recordRef(kind, rec), lines: ['Exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '')],
    footLeft: 'KUI Vessl · ' + RECORD_KINDS[kind].title + ' ' + recordRef(kind, rec) + ' · exported ' + stampText(ctx.exportedAt) + (ctx.user ? ' by ' + ctx.user : '') };
}
