import { figureWords, headlineTiles, attentionCards, shipmentRef, daysFromNow, ymd, OPEN_STAGES, STAGE_FILTER_OPTS, DATES_BY_OPTS, PERIOD_OPTS, BOOKED_METRIC_OPTS, TOP_SORT_OPTS } from '@/lib/analytics';
import { excelDate } from '@/lib/excel';

// ── KUI Vessl Analytics: the Excel export ─────────────────────────────────────
// Downloads only. Nothing here reads the database: every sheet is built from the
// buildAnalytics result the page is drawing, with the same filters, period,
// Dates By and card dropdowns, so a sheet cannot disagree with the page.
//
// Two steps, so the second can run in node against a snapshot:
//   buildSheets   the result -> plain sheet descriptions (no ExcelJS, no DOM)
//   buildWorkbook the descriptions -> an ExcelJS workbook
//
// A sheet is a heading, a few notes, the section's TOTALS exactly as the page
// shows them, then the DETAIL rows behind them, one per record. Cell formats
// are named: usd, pct (a percentage number such as 25.3), int, date
// ('YYYY-MM-DD'), datetime (a Date), text. A cell may be { v, fmt } to override
// its column.
//
// Test records stay out because every list here comes from buildAnalytics,
// which has already removed them.

export const EXPORT_SECTIONS = [
  { id: 'attention', title: 'Needs Attention', file: 'Needs-Attention' },
  { id: 'headline', title: 'Headline Numbers', file: 'Headline-Numbers' },
  { id: 'pipeline', title: 'Pipeline by Stage', file: 'Pipeline-by-Stage' },
  { id: 'booked', title: 'Booked per Month', file: 'Booked-per-Month' },
  { id: 'clients', title: 'Top Clients', file: 'Top-Clients' },
  { id: 'factory', title: 'Production by Factory', file: 'Production-by-Factory' },
  { id: 'arrivals', title: 'Arrivals', file: 'Arrivals' },
];
// Export all: Summary first, then these, in this order. Headline numbers are
// on the Summary, so they have a sheet of their own only in their card's export.
export const EXPORT_ALL = ['attention', 'pipeline', 'booked', 'clients', 'factory', 'arrivals'];

export const exportFileName = (section, day) =>
  'KUI-Vessl-Analytics-' + (section ? (EXPORT_SECTIONS.find(s => s.id === section) || {}).file + '-' : '') + day + '.xlsx';

const label = (opts, v) => ((opts.find(o => o[0] === v) || [])[1]) || '';
const STAGE_NAMES = { ...Object.fromEntries(OPEN_STAGES), delivered: 'Delivered', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled' };
const stageName = s => STAGE_NAMES[s] || (s ? String(s).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : '');
const parseDay = s => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
// Whole days from a 'YYYY-MM-DD' date to today, by the calendar.
const daysSince = (s, today) => (s ? Math.round((parseDay(today) - parseDay(s)) / 86400000) : null);
const etaDay = s => (s ? String(s).slice(0, 10) : null);
const marginPct = so => (so.factoryCost > 0 && so.rev > 0 ? (so.rev - so.cost) / so.rev * 100 : null);
const byNumber = (a, b) => String(a.so_number || '').localeCompare(String(b.so_number || ''));

// ── One Sales Order per row: the same columns on every sheet that lists them ──
const SO_COLS = [
  { h: 'Sales Order' }, { h: 'Client PO' }, { h: 'Client' }, { h: 'Factory' }, { h: 'Stage' },
  { h: 'Order date', fmt: 'date' }, { h: 'Cargo ready date', fmt: 'date' }, { h: 'Cancel date', fmt: 'date' },
  { h: 'Shipping method' }, { h: 'Units', fmt: 'int' }, { h: 'Revenue', fmt: 'usd' },
  { h: 'Factory cost', fmt: 'usd' }, { h: 'Other costs', fmt: 'usd' }, { h: 'Margin', fmt: 'pct' }, { h: 'Has factory cost' },
];
const soCells = so => [
  so.so_number || '', so.client_po_number || '', so.client?.name || '', (so.factoryNames || []).join(', '), stageName(so.status),
  so.order_date, so.cargo_ready_date, so.cancel_date, so.shipping_method || '', so.units, so.rev,
  so.factoryCost, so.extraCost, marginPct(so), so.factoryCost > 0 ? 'Yes' : 'No',
];

// ── The sections ──────────────────────────────────────────────────────────────
function attentionSheet(d) {
  const cards = attentionCards(d);
  const totals = [];
  cards.forEach(c => { totals.push([c.k, c.n, c.line]); if (c.also) totals.push([c.also.k, c.also.n, '']); });
  const rows = [];
  const shipRow = (reason, s, days) => [reason, 'Shipment', shipmentRef(s), s.client?.name || '', (s.factoryNames || []).join(', '), stageName(String(s.status || '').toLowerCase()), etaDay(s.estimated_arrival), days, null, null];
  const soRow = (reason, so, date) => [reason, 'Sales Order', so.so_number || '', so.client?.name || '', (so.factoryNames || []).join(', '), stageName(so.status), so[date], daysSince(so[date], d.today), so.units, so.rev];
  const poRow = (reason, po, date) => [reason, 'Purchase Order', po.order_number || '', po.client?.name || '', po.factory?.name || '', stageName(po.status), po[date], daysSince(po[date], d.today), po.units, po.value];
  const byDate = k => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''));
  d.overdue.forEach(s => rows.push(shipRow(cards[0].k, s, Math.abs(daysFromNow(s.estimated_arrival, d.now)))));
  d.noEta.forEach(s => rows.push(shipRow(cards[1].k, s, null)));
  [...d.lists.soPastCancel].sort(byDate('cancel_date')).forEach(so => rows.push(soRow(cards[2].k, so, 'cancel_date')));
  [...d.lists.poPastCancel].sort(byDate('cancel_date')).forEach(po => rows.push(poRow(cards[2].also.k, po, 'cancel_date')));
  [...d.lists.soPastCrd].sort(byDate('cargo_ready_date')).forEach(so => rows.push(soRow(cards[3].k, so, 'cargo_ready_date')));
  [...d.lists.poPastCrd].sort(byDate('cargo_ready_date')).forEach(po => rows.push(poRow(cards[3].also.k, po, 'cargo_ready_date')));
  [...d.lists.fqs].sort(byDate('sent_at')).forEach(q => rows.push([cards[4].k, 'Freight quote', q.quote_number || '', q.client?.name || '', '', 'Sent',
    q.sent_at ? ymd(new Date(q.sent_at)) : null, q.sent_at ? Math.abs(daysFromNow(q.sent_at, d.now)) : null, null, null]));
  return {
    name: 'Needs Attention',
    notes: ['As of today · client, factory and shipping method apply; order stage applies to the Sales Order cards; freight quotes follow the client only',
      'One row per flagged record and reason. A Sales Order past both its cancel and cargo ready dates is listed under each. Days is days past the date, or days since the quote was sent.'],
    totals: { cols: [{ h: 'Card' }, { h: 'Count', fmt: 'int' }, { h: 'As shown on the card' }], rows: totals },
    detail: { cols: [{ h: 'Reason' }, { h: 'Record' }, { h: 'Number' }, { h: 'Client' }, { h: 'Factory' }, { h: 'Status' }, { h: 'Date', fmt: 'date' }, { h: 'Days', fmt: 'int' }, { h: 'Units', fmt: 'int' }, { h: 'Value', fmt: 'usd' }], rows },
  };
}

function headlineSheet(d, f) {
  const tiles = headlineTiles(d, f);
  const booked = new Set(d.lists.booked), pipe = new Set(d.lists.pipe), costed = new Set(d.lists.costed);
  const all = [...new Set([...d.lists.booked, ...d.lists.pipe])].sort(byNumber);
  return {
    name: 'Headline Numbers',
    notes: ['Each Sales Order once. Revenue tile = Revenue of rows In revenue tile. Pipeline value and units = rows In pipeline. Blended margin = rows In margin: (Revenue - Factory cost - Other costs) / Revenue.'],
    totals: { cols: [{ h: 'Figure' }, { h: 'Value' }, { h: 'Comparison' }, { h: 'Definition' }],
      rows: tiles.map(t => [t.k, { v: t.value, fmt: t.fmt }, t.extra ? t.extra.t : '', t.def]) },
    detail: { cols: [{ h: 'In revenue tile' }, { h: 'In pipeline' }, { h: 'In margin' }, ...SO_COLS],
      rows: all.map(so => [booked.has(so) ? 'Yes' : 'No', pipe.has(so) ? 'Yes' : 'No', costed.has(so) ? 'Yes' : 'No', ...soCells(so)]) },
  };
}

function pipelineSheet(d, f) {
  const w = figureWords(d, f);
  const order = OPEN_STAGES.map(s => s[0]);
  const rowOf = so => (d.single ? d.stageLabel : (STAGE_NAMES[so.status] && order.includes(so.status) ? STAGE_NAMES[so.status] : 'Other status'));
  const rank = so => (order.includes(so.status) ? order.indexOf(so.status) : 99);
  const totals = d.stages.map(s => [s.label, s.count, s.value]);
  totals.push([!d.single ? 'Total open' : 'Total', d.pipeCount, d.pipeValue]);
  if (!d.single) totals.push(['Completed, not in the total: Delivered and Invoiced', d.completed.count, d.completed.value]);
  const rows = [...d.lists.pipe].sort((a, b) => rank(a) - rank(b) || byNumber(a, b)).map(so => [rowOf(so), 'Yes', ...soCells(so)]);
  if (!d.single) [...d.lists.done].sort(byNumber).forEach(so => rows.push(['Completed', 'No', ...soCells(so)]));
  return {
    name: 'Pipeline by Stage',
    notes: [(!d.single ? 'Open pipeline by stage' : d.stageLabel + ' orders') + ' · ' + w.asOf + ' · Sales Orders · ' + w.filterNote],
    totals: { cols: [{ h: 'Stage' }, { h: 'Orders', fmt: 'int' }, { h: 'Value', fmt: 'usd' }], rows: totals },
    detail: { cols: [{ h: 'Row on the card' }, { h: 'In the total' }, ...SO_COLS], rows },
  };
}

const monthText = key => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

function bookedSheet(d, f) {
  const w = figureWords(d, f);
  const notes = ['Sales Order lines ' + w.bookedBy + (d.contextBars ? '; context months outside the period are marked No under In the period' : ''),
    'The chart on the page shows: ' + label(BOOKED_METRIC_OPTS, f.bookedMetric) + '. All four measures are below.'];
  if (w.missingLine) notes.push(w.missingLine);
  if (w.chartUndatedLine) notes.push(w.chartUndatedLine);
  const ms = d.months;
  const totals = [
    ['In the period', ...ms.map(m => (m.inPeriod ? 'Yes' : 'No'))],
    ['Revenue', ...ms.map(m => ({ v: m.revenue, fmt: 'usd' }))],
    ['Units', ...ms.map(m => ({ v: m.units, fmt: 'int' }))],
    ['Orders', ...ms.map(m => ({ v: m.orders, fmt: 'int' }))],
    ['Margin', ...ms.map(m => ({ v: m.margin, fmt: 'pct' }))],
  ];
  const rows = [];
  ms.forEach(m => [...m.list].sort((a, b) => String(a[DATE_FIELD(d)] || '').localeCompare(String(b[DATE_FIELD(d)] || '')) || byNumber(a, b))
    .forEach(so => rows.push([monthText(m.key) + (m.current ? ' (to date)' : ''), m.inPeriod ? 'Yes' : 'No', ...soCells(so)])));
  return {
    name: 'Booked per Month', notes,
    totals: { cols: [{ h: 'Month' }, ...ms.map(m => ({ h: monthText(m.key) + (m.current ? ' (to date)' : '') }))], rows: totals },
    detail: { cols: [{ h: 'Month' }, { h: 'In the period' }, ...SO_COLS], rows },
  };
}
const DATE_FIELD = d => (DATES_BY_OPTS.find(o => o[0] === d.datesBy) || DATES_BY_OPTS[0])[2];

function clientsSheet(d, f) {
  const w = figureWords(d, f);
  const notes = ['Top clients, ' + d.range.label + ' · Sales Orders ' + w.bookedBy + ' · margin excludes freight and duty', 'Sorted ' + label(TOP_SORT_OPTS, f.topSort).toLowerCase() + '. The six clients shown on the page; their orders below.'];
  if (w.missingLine) notes.push(w.missingLine);
  const rows = [];
  d.topClients.forEach(c => [...c.list].sort((a, b) => String(a[DATE_FIELD(d)] || '').localeCompare(String(b[DATE_FIELD(d)] || '')) || byNumber(a, b))
    .forEach(so => rows.push([c.name, ...soCells(so)])));
  return {
    name: 'Top Clients', notes,
    totals: { cols: [{ h: 'Rank', fmt: 'int' }, { h: 'Client' }, { h: 'Revenue', fmt: 'usd' }, { h: 'Units', fmt: 'int' }, { h: 'Margin', fmt: 'pct' }, { h: 'Orders', fmt: 'int' }],
      rows: d.topClients.map((c, i) => [i + 1, c.name, c.rev, c.units, c.margin == null ? { v: 'no cost', fmt: 'text' } : c.margin, c.list.length]) },
    detail: { cols: [{ h: 'Top client' }, ...SO_COLS], rows },
  };
}

function factorySheet(d) {
  const rank = Object.fromEntries(d.byFactory.map((x, i) => [x.name, i]));
  const rows = [...d.lists.inProduction]
    .sort((a, b) => rank[a.factory?.name || 'No factory'] - rank[b.factory?.name || 'No factory'] || String(a.cargo_ready_date || '9').localeCompare(String(b.cargo_ready_date || '9')) || String(a.order_number || '').localeCompare(String(b.order_number || '')))
    .map(po => [po.factory?.name || 'No factory', po.order_number || '', po.client_po_number || '', po.client?.name || '', stageName(po.status),
      po.cargo_ready_date, po.cancel_date, po.late ? 'Yes' : 'No', po.late ? daysSince(po.cargo_ready_date, d.today) : null, po.shipping_method || '', po.units, po.value]);
  return {
    name: 'Production by Factory',
    notes: ['As of today · Purchase Orders in production · late = past cargo ready date · their own client, factory and shipping method apply; order stage does not'],
    totals: { cols: [{ h: 'Factory' }, { h: 'POs in production', fmt: 'int' }, { h: 'Late', fmt: 'int' }], rows: d.byFactory.map(x => [x.name, x.count, x.late]) },
    detail: { cols: [{ h: 'Factory' }, { h: 'Purchase Order' }, { h: 'Client PO' }, { h: 'Client' }, { h: 'Status' }, { h: 'Cargo ready date', fmt: 'date' }, { h: 'Cancel date', fmt: 'date' },
      { h: 'Late' }, { h: 'Days past cargo ready', fmt: 'int' }, { h: 'Shipping method' }, { h: 'Units', fmt: 'int' }, { h: 'PO value', fmt: 'usd' }], rows },
  };
}

function arrivalsSheet(d) {
  return {
    name: 'Arrivals',
    notes: ['Arriving in the next 8 weeks · As of today · active shipments, soonest first · client is the shipment’s own; factory and shipping method come from its linked Purchase Orders; order stage does not apply'],
    totals: { cols: [{ h: 'Figure' }, { h: 'Count', fmt: 'int' }], rows: [['Active shipments arriving in the next 8 weeks', d.arriving.length]] },
    detail: { cols: [{ h: 'Shipment' }, { h: 'Container' }, { h: 'Client' }, { h: 'Factory' }, { h: 'Purchase Orders' }, { h: 'Status' }, { h: 'ETA', fmt: 'date' }, { h: 'Days to arrival', fmt: 'int' }],
      rows: d.arriving.map(s => [shipmentRef(s), s.container_no || '', s.client?.name || 'No client', (s.factoryNames || []).join(', '), (s.poNumbers || []).join(', '),
        stageName(String(s.status || '').toLowerCase()), etaDay(s.estimated_arrival), Math.max(0, daysFromNow(s.estimated_arrival, d.now))]) },
  };
}

function summarySheet(d, f, ctx, sheetNames) {
  const tiles = headlineTiles(d, f);
  const r = d.range;
  const rows = [
    ['Exported', { v: ctx.exportedAt, fmt: 'datetime' }, ''],
    ['Exported by', ctx.user || '', ''],
    ['Figures worked out', { v: d.now, fmt: 'datetime' }, 'When the page last calculated them; the sheets match the page at that moment'],
    ['Sheets', sheetNames.join(', '), ''],
    [{ v: 'Filters', bold: true }, '', ''],
    ['Period', label(PERIOD_OPTS, f.period), r.label],
    ['From', r.from ? { v: r.from, fmt: 'date' } : 'No limit', ''],
    ['To', r.to ? { v: r.to, fmt: 'date' } : 'No limit', ''],
    ['Dates by', label(DATES_BY_OPTS, f.datesBy), ''],
    ['Client', ctx.clientName || 'All Clients', ''],
    ['Factory', ctx.factoryName || 'All Factories', ''],
    ['Order stage', label(STAGE_FILTER_OPTS, f.stage), ''],
    ['Shipping method', f.method || 'All Methods', ''],
    ['Booked per month shows', label(BOOKED_METRIC_OPTS, f.bookedMetric), ''],
    ['Top clients', label(TOP_SORT_OPTS, f.topSort), ''],
    [{ v: 'Headline numbers', bold: true }, '', ''],
    ...tiles.map(t => [t.k, { v: t.value, fmt: t.fmt }, t.def + (t.extra ? '. ' + t.extra.t : '')]),
    [{ v: 'Notes', bold: true }, '', ''],
    ['Margin', 'Excludes freight and duty', 'Cost is the linked Purchase Orders’ lines plus the order’s other costs; only orders with a factory cost count towards a margin'],
    ['Test records', 'Excluded', 'Anything whose number or name starts with ZZ is in no figure and no row'],
  ];
  return { name: 'Summary', notes: [], kv: true, totals: { cols: [{ h: 'Item' }, { h: 'Value' }, { h: 'Detail' }], rows } };
}

const BUILDERS = { attention: attentionSheet, headline: headlineSheet, pipeline: pipelineSheet, booked: bookedSheet, clients: clientsSheet, factory: factorySheet, arrivals: arrivalsSheet };

// ids: the sections to include, Summary always first. ctx: { exportedAt, user,
// clientName, factoryName }.
export function buildSheets(d, f, ctx, ids) {
  const sections = ids.map(id => BUILDERS[id](d, f));
  const summary = summarySheet(d, f, ctx, ['Summary', ...sections.map(s => s.name)]);
  return [summary, ...sections].map(s => ({ ...s, heading: 'KUI Vessl Analytics' + (s.name === 'Summary' ? '' : ' · ' + s.name) }));
}

// ── The workbook ──────────────────────────────────────────────────────────────
const NUMFMT = { usd: '"$"#,##0.00', pct: '0.0%', int: '#,##0', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm' };
// A Date written as-is lands in the cell as UTC. Shifted by the offset, the
// cell shows the local clock time the person saw.
const localStamp = dt => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);

function cellValue(raw, fmt) {
  if (raw == null || raw === '') return { value: null };
  if (fmt === 'date') return { value: excelDate(String(raw).slice(0, 10)), numFmt: NUMFMT.date, len: 10 };
  if (fmt === 'datetime') return { value: localStamp(raw), numFmt: NUMFMT.datetime, len: 16 };
  if (fmt === 'pct') return typeof raw === 'number' ? { value: raw / 100, numFmt: NUMFMT.pct, len: 7 } : { value: String(raw), len: String(raw).length };
  if (fmt === 'usd') return { value: raw, numFmt: NUMFMT.usd, len: Math.round(raw).toLocaleString('en-US').length + 4 };
  if (fmt === 'int') return { value: raw, numFmt: NUMFMT.int, len: Math.round(raw).toLocaleString('en-US').length };
  return { value: String(raw), len: String(raw).length };
}

export function buildWorkbook(ExcelJS, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL'; wb.created = new Date();
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } };
  sheets.forEach(sh => {
    const ws = wb.addWorksheet(sh.name);
    const widths = [];
    const fit = (i, n) => { widths[i] = Math.max(widths[i] || 0, n); };
    const head = cols => {
      const row = ws.addRow(cols.map(c => c.h));
      row.font = { bold: true };
      row.eachCell(c => { c.fill = HEAD_FILL; });
      cols.forEach((c, i) => fit(i, c.h.length));
      return row.number;
    };
    const body = (cols, rows) => rows.forEach(cells => {
      const row = ws.addRow([]);
      cells.forEach((raw, i) => {
        const o = raw != null && typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw };
        const cv = cellValue(o.v, o.fmt || (cols[i] || {}).fmt);
        const cell = row.getCell(i + 1);
        cell.value = cv.value;
        if (cv.numFmt) cell.numFmt = cv.numFmt;
        if (o.bold) cell.font = { bold: true };
        // Long definitions wrap rather than stretch the column.
        fit(i, Math.min(cv.len || 0, 60));
      });
    });
    const title = ws.addRow([sh.heading]);
    title.font = { bold: true, size: 14 };
    (sh.notes || []).forEach(n => { ws.addRow([n]).font = { italic: true, color: { argb: 'FF6E6E73' } }; });
    ws.addRow([]);
    let freezeAt = head(sh.totals.cols);
    body(sh.totals.cols, sh.totals.rows);
    if (sh.detail) {
      ws.addRow([]);
      ws.addRow(['Detail: the records behind the figures above']).font = { bold: true };
      freezeAt = head(sh.detail.cols);
      body(sh.detail.cols, sh.detail.rows);
      if (sh.detail.rows.length) ws.autoFilter = { from: { row: freezeAt, column: 1 }, to: { row: freezeAt, column: sh.detail.cols.length } };
    }
    // The header of the record list stays in view while the rows scroll.
    ws.views = [{ state: 'frozen', ySplit: freezeAt }];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(10, Math.min(62, w + 2)); });
    if (sh.kv) ws.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  });
  return wb;
}
