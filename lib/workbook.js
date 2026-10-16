import { excelDate } from '@/lib/excel';

// ── Sheet descriptions -> an ExcelJS workbook ────────────────────────────────
// Shared by the KUI Vessl Analytics and Shipments exports, so both lay out,
// format and size their sheets one way. Nothing here knows what a sheet means.
//
// A sheet is { name, heading, notes, tables, kv }:
//   heading  bold title in A1
//   notes    one muted line each under it
//   tables   [{ title, cols, rows, freeze, emptyText }] stacked with a blank row
//            between them. cols are { h, fmt }; a row is an array of cells. The
//            header of the table marked freeze -- or else the last one -- stays
//            in view while the rows scroll, and carries an AutoFilter.
//            emptyText is written, muted, when a table has no rows.
//   kv       a three-column Item / Value / Detail sheet whose Detail wraps
// A sheet may give { totals, detail } instead of tables: the totals table, then
// the detail table under "Detail: the records behind the figures above".
//
// Cell formats are named: usd, pct (a percentage number such as 25.3), int,
// price (a per-unit rate: two to five decimals, as unitPrice() shows one),
// num (two decimals), num3 and num4 (a carton line's CBM, as the freight sheet), date ('YYYY-MM-DD'),
// datetime (a Date), text. A cell may be { v, fmt, bold }
// to override its column.

const NUMFMT = { usd: '"$"#,##0.00', pct: '0.0%', int: '#,##0', num: '#,##0.00', price: '"$"#,##0.00###', num3: '#,##0.000', num4: '0.0000', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm' };
// A Date written as-is lands in the cell as UTC. Shifted by the offset, the
// cell shows the local clock time the person saw.
const localStamp = dt => new Date(dt.getTime() - dt.getTimezoneOffset() * 60000);

function cellValue(raw, fmt) {
  if (raw == null || raw === '') return { value: null };
  if (fmt === 'date') return { value: excelDate(String(raw).slice(0, 10)), numFmt: NUMFMT.date, len: 10 };
  if (fmt === 'datetime') return { value: localStamp(raw instanceof Date ? raw : new Date(raw)), numFmt: NUMFMT.datetime, len: 16 };
  if (fmt === 'pct') return typeof raw === 'number' ? { value: raw / 100, numFmt: NUMFMT.pct, len: 7 } : { value: String(raw), len: String(raw).length };
  if (fmt === 'usd') return { value: raw, numFmt: NUMFMT.usd, len: Math.round(raw).toLocaleString('en-US').length + 4 };
  if (fmt === 'int') return { value: raw, numFmt: NUMFMT.int, len: Math.round(raw).toLocaleString('en-US').length };
  if (fmt === 'num') return { value: raw, numFmt: NUMFMT.num, len: Math.round(raw).toLocaleString('en-US').length + 3 };
  if (fmt === 'price') return { value: raw, numFmt: NUMFMT.price, len: Math.round(raw).toLocaleString('en-US').length + 6 };
  if (fmt === 'num3') return { value: raw, numFmt: NUMFMT.num3, len: Math.round(raw).toLocaleString('en-US').length + 4 };
  if (fmt === 'num4') return { value: raw, numFmt: NUMFMT.num4, len: String(Math.round(raw)).length + 5 };
  return { value: String(raw), len: String(raw).length };
}

const tablesOf = sh => sh.tables || [
  { cols: sh.totals.cols, rows: sh.totals.rows },
  ...(sh.detail ? [{ title: 'Detail: the records behind the figures above', cols: sh.detail.cols, rows: sh.detail.rows }] : []),
];

export function buildWorkbook(ExcelJS, sheets) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL'; wb.created = new Date();
  const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF1F5' } };
  const MUTED = { italic: true, color: { argb: 'FF6E6E73' } };
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
        // Long text wraps rather than stretching the column past 60.
        fit(i, Math.min(cv.len || 0, 60));
      });
    });
    const title = ws.addRow([sh.heading]);
    title.font = { bold: true, size: 14 };
    (sh.notes || []).forEach(n => { ws.addRow([n]).font = MUTED; });
    const tables = tablesOf(sh);
    const frozen = tables.find(t => t.freeze) || tables[tables.length - 1];
    let freezeAt = 0;
    tables.forEach((t, i) => {
      ws.addRow([]);
      if (t.title) ws.addRow([t.title]).font = { bold: true };
      const h = head(t.cols);
      body(t.cols, t.rows);
      if (!t.rows.length && t.emptyText) ws.addRow([t.emptyText]).font = MUTED;
      if (t === frozen) {
        freezeAt = h;
        // A filter only on a record list, and never on the Summary's key/value table.
        if (t.rows.length && !sh.kv && (tables.length === 1 || i > 0 || t.freeze)) ws.autoFilter = { from: { row: h, column: 1 }, to: { row: h, column: t.cols.length } };
      }
    });
    // The header of the record list stays in view while the rows scroll.
    ws.views = [{ state: 'frozen', ySplit: freezeAt }];
    widths.forEach((w, i) => { ws.getColumn(i + 1).width = Math.max(10, Math.min(62, w + 2)); });
    if (sh.kv) ws.getColumn(3).alignment = { wrapText: true, vertical: 'top' };
  });
  return wb;
}

// ── A price sheet (the client price sheet) ───────────────────────────────────
// One landscape sheet laid out like a printed page rather than a data dump, in
// black and white: a solid black band with the company (left), the date
// (centered) and the program (right) in white, then one or more tables, footer
// notes, a sign-off and the KUI logo under it. Send to
// Client in quotes.jsx; the model is built in lib/clientSheet.js.
//
// sheet = { name, band: { left, center, right },
//           blocks, notes, extra, signoff, logo }
//   block = { caption, cols, groups, rows }
//     cols    [{ h, w, kind }] -- kind is style | item | muted | text | price | center
//     groups  optional [{ label, from, span }] -- a merged heading row above the
//             header, over cols[from .. from + span - 1] (Breakdown's quantities)
//     caption written over the first price column to the last, merged
//     rows    arrays of cells; a cell is a number (a price), a string, or null
//   notes   muted lines under the tables; extra more muted lines (payment); signoff
//           one bold line; logo { base64 (a data URL), width, height } in pixels,
//           placed under the sign-off, or null for none.
// Columns start at B, with a narrow margin column A as on the page.
export function buildPriceSheet(ExcelJS, sheet) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL'; wb.created = new Date();
  const ws = wb.addWorksheet(sheet.name || 'Pricing', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  });
  const INK = 'FF000000', MUTED = 'FF6B6B6B', ALT = 'FFF6F6F6', WHITE = 'FFFFFFFF';
  const solid = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const rule = { style: 'thin', color: { argb: INK } };
  const hair = { style: 'thin', color: { argb: 'FFD9D9D9' } };
  const lastCol = Math.max(5, ...sheet.blocks.map(b => b.cols.length)) + 1;   // + margin column A
  // Widths: the margin, then every column the widest any block asks for there --
  // each block's own col.w, or its kind's width when it gives none. Blocks share
  // the sheet's columns, so a wider block (more quantities) sets the columns past
  // a narrower one's end, and where two blocks' columns overlap the wider wins.
  const KIND_W = { style: 12, item: 26, muted: 32, text: 18, price: 11, center: 11 };
  const colW = c => (c ? c.w || KIND_W[c.kind] || 12 : 0);
  ws.getColumn(1).width = 2;
  for (let c = 2; c <= lastCol; c++) {
    const w = Math.max(...sheet.blocks.map(b => colW(b.cols[c - 2])));
    ws.getColumn(c).width = w || 12;
  }
  ws.getColumn(lastCol + 1).width = 2;

  // THE BAND: a solid black bar, white text, where the navy band used to be --
  // the company at the left (B..D), the date centered (the middle columns), the
  // program title at the right edge (the last three columns).
  let r = 2;
  const band = ws.getRow(r); band.height = 40;
  for (let c = 2; c <= lastCol; c++) band.getCell(c).fill = solid(INK);
  const titleFrom = Math.max(6, lastCol - 2);
  ws.mergeCells(r, 2, r, 4);
  if (titleFrom - 1 > 5) ws.mergeCells(r, 5, r, titleFrom - 1);
  ws.mergeCells(r, titleFrom, r, lastCol);
  const bl = band.getCell(2);
  bl.value = sheet.band.left || ''; bl.font = { bold: true, size: 26, color: { argb: WHITE } }; bl.alignment = { vertical: 'middle' };
  const bc = band.getCell(5);
  bc.value = sheet.band.center || ''; bc.font = { size: 11, color: { argb: WHITE } }; bc.alignment = { horizontal: 'center', vertical: 'middle' };
  const br = band.getCell(titleFrom);
  br.value = sheet.band.right || ''; br.font = { bold: true, size: 12, color: { argb: WHITE } }; br.alignment = { horizontal: 'right', vertical: 'middle' };

  // The first table's caption follows one blank row below the band.
  sheet.blocks.forEach(b => {
    r += 1;
    const firstPrice = b.cols.findIndex(c => c.kind === 'price');
    const lastPrice = b.cols.length - 1 - [...b.cols].reverse().findIndex(c => c.kind === 'price');
    if (b.caption && firstPrice >= 0) {
      r += 1;
      const cap = ws.getRow(r); cap.height = 16;
      if (lastPrice > firstPrice) ws.mergeCells(r, firstPrice + 2, r, lastPrice + 2);
      const cc = cap.getCell(firstPrice + 2);
      cc.value = b.caption; cc.font = { bold: true, size: 8, color: { argb: INK } }; cc.alignment = { horizontal: 'center' };
    }
    // Header cells: black bold text over a thin black rule, no fill.
    // THE TABLE AS ONE BLOCK: a thin black outline -- the top of its first header
    // row, its left and right edges on every row, the bottom of its last row.
    const n = b.cols.length;
    const edge = (i, border) => ({ ...border, ...(i === 0 ? { left: rule } : {}), ...(i === n - 1 ? { right: rule } : {}) });
    // Header rows: solid black, white bold text.
    const headCell = (cell, v, center, i, top) => {
      cell.value = v; cell.fill = solid(INK); cell.font = { bold: true, size: 9, color: { argb: WHITE } };
      cell.border = edge(i, top ? { top: rule } : {});
      cell.alignment = { horizontal: center ? 'center' : 'left', vertical: 'middle', wrapText: true };
    };
    const hasGroups = !!(b.groups && b.groups.length);
    if (hasGroups) {
      r += 1;
      const g = ws.getRow(r); g.height = 18;
      b.cols.forEach((c, i) => headCell(g.getCell(i + 2), '', true, i, true));
      b.groups.forEach(gr => {
        headCell(g.getCell(gr.from + 2), gr.label, true, gr.from, true);
        if (gr.span > 1) ws.mergeCells(r, gr.from + 2, r, gr.from + gr.span + 1);
      });
    }
    r += 1;
    const head = ws.getRow(r); head.height = 26;
    b.cols.forEach((c, i) => headCell(head.getCell(i + 2), c.h, c.kind === 'price' || c.kind === 'center', i, !hasGroups));
    b.rows.forEach((cells, ri) => {
      r += 1;
      const row = ws.getRow(r); row.height = 34;
      const fill = solid(ri % 2 ? ALT : WHITE);
      const last = ri === b.rows.length - 1;
      b.cols.forEach((c, i) => {
        const cell = row.getCell(i + 2);
        const v = cells[i];
        cell.fill = fill;
        cell.border = edge(i, { bottom: last ? rule : hair });
        cell.alignment = { horizontal: c.kind === 'price' || c.kind === 'center' ? 'center' : 'left', vertical: 'middle', wrapText: true };
        if (c.kind === 'price' && typeof v === 'number') {
          cell.value = v; cell.numFmt = '"$"#,##0.00'; cell.font = { bold: true, size: 11, color: { argb: INK } };
        } else {
          cell.value = v == null || v === '' ? (c.kind === 'price' ? '—' : null) : v;
          cell.font = c.kind === 'style' ? { bold: true, size: 10, color: { argb: INK } }
            : c.kind === 'item' ? { bold: true, size: 10, color: { argb: INK } }
            : c.kind === 'muted' || c.kind === 'price' || c.kind === 'center' ? { size: 10, color: { argb: MUTED } }
            : { size: 10, color: { argb: INK } };
        }
      });
    });
  });

  r += 1;
  (sheet.notes || []).forEach(n => { r += 1; const c = ws.getRow(r).getCell(2); c.value = n; c.font = { size: 9, color: { argb: MUTED } }; });
  (sheet.extra || []).forEach((n, i) => { r += 1 + (i === 0 ? 1 : 0); const c = ws.getRow(r).getCell(2); c.value = n; c.font = { size: 9, color: { argb: MUTED } }; });
  if (sheet.signoff) { r += 2; const c = ws.getRow(r).getCell(2); c.value = sheet.signoff; c.font = { bold: true, size: 9, color: { argb: INK } }; }
  // The KUI logo under the sign-off, left-aligned, about 120px wide. It floats
  // over the cells, so the rows it covers are counted into the print area.
  if (sheet.logo && sheet.logo.base64) {
    // A data URL arrives; ExcelJS wants the bare base64 and the image type.
    const mime = (/^data:image\/(\w+)/.exec(sheet.logo.base64) || [])[1] || 'png';
    const id = wb.addImage({ base64: sheet.logo.base64.replace(/^data:[^,]*,/, ''), extension: mime === 'jpg' ? 'jpeg' : mime });
    ws.addImage(id, { tl: { col: 1, row: r + 0.4 }, ext: { width: sheet.logo.width, height: sheet.logo.height }, editAs: 'oneCell' });
    r += 1 + Math.ceil(sheet.logo.height / 20);
  }
  ws.pageSetup.printArea = 'A1:' + ws.getColumn(lastCol + 1).letter + r;
  return wb;
}
