import { ymd } from '@/lib/analytics';
import { shipmentStatusLabel } from '@/lib/shipmentStatus';
import { isLCL } from '@/lib/rfqSheet';
import { lclBidTotal, bidEffective } from '@/lib/freightBids';
import { shipClient, rfqPill, QF_DEFAULT, QF_LABEL } from '@/lib/shipmentsView';

// ── The Shipments page: the Excel export ──────────────────────────────────────
// Downloads only. Nothing here reads the database: every sheet is built from
// the lists shipmentsView gives the page -- the client filter, the search box,
// the freight quote status filter and the In transit / Delivered / All buttons
// already applied -- so a sheet lists exactly the rows on screen. Test records
// are NOT left out: the page shows them, so the export does too.
//
// Laid out by lib/workbook.js, the writer the Analytics export uses.

export const SHIPMENT_TABS = [
  { id: 'quotes', title: 'Freight Quotes', file: 'Freight-Quotes' },
  { id: 'shipments', title: 'Shipments', file: 'Shipments' },
  { id: 'delivery', title: 'Delivery Requests', file: 'Delivery-Requests' },
];
export const SHIPMENTS_ALL = ['quotes', 'shipments', 'delivery'];

export const shipmentsFileName = (tab, day) =>
  'KUI-Vessl-Shipments-' + (tab ? (SHIPMENT_TABS.find(t => t.id === tab) || {}).file + '-' : '') + day + '.xlsx';

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
        rows, freeze: true, emptyText: 'No freight quotes match' },
      { title: 'Bids on these quotes', cols: [{ h: 'Quote' }, { h: 'Client' }, { h: 'Forwarder' }, { h: 'Carrier' }, { h: 'Rate', fmt: 'usd' }, { h: 'Rate basis' }, { h: 'Shipment total', fmt: 'usd' },
        { h: 'Transit days', fmt: 'int' }, { h: 'Free days', fmt: 'int' }, { h: 'Valid until' }, { h: 'Selected' }, { h: 'Received', fmt: 'date' }],
        rows: bidRows, emptyText: 'No bids on these quotes' },
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
      rows, emptyText: 'No shipments match' }],
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
      rows, emptyText: 'No delivery requests' }],
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
