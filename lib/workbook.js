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
// One sheet laid out like a printed page rather than a data dump, in the order
// confirmation's look (buildSODoc in app/page.jsx, lib/orderDoc.js): its ink and
// rules, in Arial throughout. The greys are NEUTRAL, not the PDF's Tailwind greys
// (#6B7280 and kin), which carry enough blue to read as tinted in Excel.
// Send to Client in quotes.jsx; the model is built in lib/clientSheet.js.
//
//   LETTERHEAD  the KUI logo top left, the title bold on the right with the
//               program under it in grey uppercase, a thin dark rule beneath.
//   DETAILS     one row of cells in medium ink borders, a small grey label over
//               a dark value.
//   TABLES      no fill, a medium ink outline: grey header labels over a medium
//               ink rule, a light rule between rows, prices bold, right-aligned.
//   CLOSE       notes, the payment grid (when given), the sign-off, a centered
//               thank-you line and a footer row.
//
// sheet = { name, title, programme, company, details, blocks, notes, payment,
//           signoff, logo }
//   details  [[label, value]] -- the cells of the details grid
//   block    { caption, cols, rows }
//     cols     [{ h, w, kind }] -- kind is style | item | muted | text | price | center
//     caption  written over the first price column to the last, merged
//     rows     arrays of cells; a cell is a number (a price), a string, or null
//   notes    small grey lines under the tables
//   payment  [[label, value]] in the details grid's style, or [] for none
//   signoff  one bold line
//   logo     { base64 (a data URL), width, height } in pixels, or null for the
//            company name in type
// Columns start at B, with a narrow margin column A as on the page. Portrait
// unless a table has more than three quantity columns; one page wide.
export function buildPriceSheet(ExcelJS, sheet) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL'; wb.created = new Date();
  const qtyCols = Math.max(0, ...sheet.blocks.map(b => b.cols.filter(c => c.kind === 'price').length));
  const ws = wb.addWorksheet(sheet.name || 'Pricing', {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: qtyCols > 3 ? 'landscape' : 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
                 showGridLines: false, horizontalCentered: true,
                 margins: { left: 0.5, right: 0.5, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 } },
  });
  // Ink (the order confirmation's), body text, secondary text, label grey, the
  // light rule between rows. 8-digit ARGB.
  const INK = 'FF0C1322', TEXT = 'FF1A1A1A', SOFT = 'FF404040', GREY = 'FF6B6B6B', LIGHT = 'FFE0E0E0';
  const font = (o = {}) => ({ name: 'Arial', size: o.size || 10, bold: !!o.bold, italic: !!o.italic, color: { argb: o.color || TEXT } });
  const line = (c, style = 'thin') => ({ style, color: { argb: c } });
  const heavy = line(INK, 'medium');
  const lastCol = Math.max(5, ...sheet.blocks.map(b => b.cols.length)) + 1;   // + margin column A
  // Widths: the margin, then every column the widest any block asks for there --
  // each block's own col.w, or its kind's width when it gives none. Blocks share
  // the sheet's columns, so a wider block (more quantities) sets the columns past
  // a narrower one's end, and where two blocks' columns overlap the wider wins.
  const KIND_W = { style: 12, item: 26, muted: 32, text: 18, price: 11, center: 11 };
  const colW = c => (c ? c.w || KIND_W[c.kind] || 12 : 0);
  const widths = [];
  ws.getColumn(1).width = 2;
  for (let c = 2; c <= lastCol; c++) {
    widths[c] = Math.max(...sheet.blocks.map(b => colW(b.cols[c - 2]))) || 12;
    ws.getColumn(c).width = widths[c];
  }
  ws.getColumn(lastCol + 1).width = 2;

  // Splits B..lastCol into n runs of about equal width, for a grid of n cells
  // across the page: [[from, to], ...], each at least one column.
  const runs = n => {
    const total = widths.slice(2, lastCol + 1).reduce((a, w) => a + w, 0);
    const out = [];
    let from = 2, acc = 0;
    for (let k = 1; k <= n; k++) {
      if (k === n) { out.push([from, lastCol]); break; }
      let to = from;
      acc += widths[to];
      // Stop at the column whose running width is nearest this cell's share,
      // leaving one column for each cell still to come.
      while (to + 1 <= lastCol - (n - k) && Math.abs(acc + widths[to + 1] - total * k / n) < Math.abs(acc - total * k / n)) { to += 1; acc += widths[to]; }
      out.push([from, to]); from = to + 1;
    }
    return out;
  };
  // A grid of cells in medium ink borders, `per` to a row: the label small, grey
  // and uppercase over the value, dark. The order confirmation's details grid.
  let r = 1;
  const grid = (pairs, per) => {
    const spans = runs(per);
    for (let i = 0; i < pairs.length; i += per) {
      const lr = r + 1, vr = r + 2;
      ws.getRow(lr).height = 16; ws.getRow(vr).height = 22;
      pairs.slice(i, i + per).forEach(([label, value], j) => {
        const [a, b] = spans[j];
        for (let c = a; c <= b; c++) {
          [lr, vr].forEach(row => {
            ws.getCell(row, c).border = {
              ...(row === lr ? { top: heavy } : { bottom: heavy }),
              ...(c === a ? { left: heavy } : {}), ...(c === b ? { right: heavy } : {}),
            };
          });
        }
        if (b > a) { ws.mergeCells(lr, a, lr, b); ws.mergeCells(vr, a, vr, b); }
        const lc = ws.getCell(lr, a);
        lc.value = String(label || '').toUpperCase(); lc.font = font({ size: 7.5, bold: true, color: GREY });
        lc.alignment = { vertical: 'bottom', indent: 1 };
        const vc = ws.getCell(vr, a);
        vc.value = value == null || String(value).trim() === '' ? '—' : String(value);
        vc.font = font({ size: 10.5 }); vc.alignment = { vertical: 'top', indent: 1, wrapText: true };
      });
      r = vr;
    }
  };

  // ── LETTERHEAD ─────────────────────────────────────────────────────────────
  // Two rows: the title sits on the foot of the first and the program on the
  // head of the second, the logo floats over both at the left, and the second
  // row's bottom edge is the rule.
  const titleFrom = Math.max(4, lastCol - 2);
  const logoH = sheet.logo && sheet.logo.base64 ? sheet.logo.height : 0;
  const headPt = Math.max(44, Math.round(logoH * 0.75) + 14);
  const t1 = ws.getRow(2), t2 = ws.getRow(3);
  t1.height = Math.round(headPt * 0.55); t2.height = headPt - t1.height;
  ws.mergeCells(2, titleFrom, 2, lastCol); ws.mergeCells(3, titleFrom, 3, lastCol);
  const tc = t1.getCell(titleFrom);
  tc.value = sheet.title || 'PRICE SHEET'; tc.font = font({ size: 16, bold: true, color: INK });
  tc.alignment = { horizontal: 'right', vertical: 'bottom' };
  const pc = t2.getCell(titleFrom);
  pc.value = String(sheet.programme || '').toUpperCase(); pc.font = font({ size: 11, color: GREY });
  pc.alignment = { horizontal: 'right', vertical: 'top' };
  if (logoH) {
    // A data URL arrives; ExcelJS wants the bare base64 and the image type.
    const mime = (/^data:image\/(\w+)/.exec(sheet.logo.base64) || [])[1] || 'png';
    const id = wb.addImage({ base64: sheet.logo.base64.replace(/^data:[^,]*,/, ''), extension: mime === 'jpg' ? 'jpeg' : mime });
    // Centered down the two rows (the offset is in rows, at 20px each).
    const top = Math.max(0, (headPt / 0.75 - logoH) / 2 - 4) / 20;
    ws.addImage(id, { tl: { col: 1, row: 1 + Math.min(top, 0.9) }, ext: { width: sheet.logo.width, height: logoH }, editAs: 'oneCell' });
  } else {
    // No logo: the company name in type, as the order confirmation falls back.
    ws.mergeCells(2, 2, 3, Math.max(2, titleFrom - 1));
    const nc = t1.getCell(2);
    nc.value = 'King Universal Inc.'; nc.font = font({ size: 16, bold: true, color: INK }); nc.alignment = { vertical: 'middle' };
  }
  for (let c = 2; c <= lastCol; c++) ws.getCell(3, c).border = { bottom: line(INK) };
  r = 4;

  // ── DETAILS ────────────────────────────────────────────────────────────────
  if (sheet.details && sheet.details.length) grid(sheet.details, sheet.details.length);

  // ── TABLES ─────────────────────────────────────────────────────────────────
  sheet.blocks.forEach(b => {
    r += 1;
    const firstPrice = b.cols.findIndex(c => c.kind === 'price');
    const lastPrice = b.cols.length - 1 - [...b.cols].reverse().findIndex(c => c.kind === 'price');
    const right = c => c.kind === 'price' || c.kind === 'center';
    if (b.caption && firstPrice >= 0) {
      r += 1;
      const cap = ws.getRow(r); cap.height = 15;
      if (lastPrice > firstPrice) ws.mergeCells(r, firstPrice + 2, r, lastPrice + 2);
      const cc = cap.getCell(firstPrice + 2);
      cc.value = b.caption; cc.font = font({ size: 7.5, bold: true, color: GREY }); cc.alignment = { horizontal: 'center', vertical: 'bottom' };
    }
    // THE TABLE AS ONE BLOCK: a medium ink outline -- the top of the header row,
    // the left and right edges of every row, the bottom of the last row.
    const n = b.cols.length;
    const edge = (i, border) => ({ ...border, ...(i === 0 ? { left: heavy } : {}), ...(i === n - 1 ? { right: heavy } : {}) });
    // Header labels: small, grey, uppercase, over a medium ink rule. No fill. A
    // quantity heading ("5,000") is written as a NUMBER, formatted, so Excel
    // does not flag it as a number stored as text.
    r += 1;
    const head = ws.getRow(r); head.height = 20;
    b.cols.forEach((c, i) => {
      const cell = head.getCell(i + 2);
      const h = String(c.h || '');
      if (c.kind === 'price' && /^[\d,]+$/.test(h)) { cell.value = Number(h.replace(/,/g, '')); cell.numFmt = '#,##0'; }
      else cell.value = h.toUpperCase();
      cell.font = font({ size: 7.5, bold: true, color: GREY });
      cell.border = edge(i, { top: heavy, bottom: heavy });
      cell.alignment = { horizontal: right(c) ? 'right' : 'left', vertical: 'bottom', wrapText: true };
    });
    b.rows.forEach((cells, ri) => {
      r += 1;
      const row = ws.getRow(r); row.height = 30;
      const last = ri === b.rows.length - 1;
      b.cols.forEach((c, i) => {
        const cell = row.getCell(i + 2);
        const v = cells[i];
        cell.border = edge(i, { bottom: last ? heavy : line(LIGHT) });
        cell.alignment = { horizontal: right(c) ? 'right' : 'left', vertical: 'middle', wrapText: c.kind !== 'price' };
        if (c.kind === 'price' && typeof v === 'number') {
          cell.value = v; cell.numFmt = '"$"#,##0.00'; cell.font = font({ size: 10.5, bold: true });
        } else {
          cell.value = v == null || v === '' ? (c.kind === 'price' ? '—' : null) : v;
          cell.font = c.kind === 'style' ? font({ size: 9.5, color: GREY })
            : c.kind === 'item' ? font({ size: 10, bold: true })
            : c.kind === 'muted' ? font({ size: 9.5, color: SOFT })
            : c.kind === 'price' ? font({ size: 10.5, color: GREY })
            : c.kind === 'center' ? font({ size: 9.5, color: SOFT })
            : font({ size: 10 });
        }
      });
    });
  });

  // ── CLOSE ──────────────────────────────────────────────────────────────────
  r += 1;
  (sheet.notes || []).forEach(n => { r += 1; const c = ws.getRow(r).getCell(2); c.value = n; c.font = font({ size: 8.5, color: GREY }); });
  if (sheet.payment && sheet.payment.length) { r += 1; grid(sheet.payment, Math.min(4, sheet.payment.length)); }
  if (sheet.signoff) { r += 2; const c = ws.getRow(r).getCell(2); c.value = sheet.signoff; c.font = font({ size: 9, bold: true, color: INK }); }
  r += 2;
  ws.mergeCells(r, 2, r, lastCol);
  const ty = ws.getCell(r, 2);
  ty.value = 'Thank you for your business · King Universal Inc.'; ty.font = font({ size: 9, color: SOFT }); ty.alignment = { horizontal: 'center' };
  // The footer row: what the order confirmation prints at the foot of each sheet.
  r += 2;
  ws.mergeCells(r, 2, r, lastCol);
  const ft = ws.getCell(r, 2);
  ft.value = ['King Universal Inc.', 'Price sheet', sheet.company].filter(Boolean).join(' · ');
  ft.font = font({ size: 7.5, color: GREY });
  for (let c = 2; c <= lastCol; c++) ws.getCell(r, c).border = { top: line(LIGHT) };
  ws.pageSetup.printArea = 'A1:' + ws.getColumn(lastCol + 1).letter + (r + 1);
  return wb;
}
