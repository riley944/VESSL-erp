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
// date ('YYYY-MM-DD'), datetime (a Date), text. A cell may be { v, fmt, bold }
// to override its column.

const NUMFMT = { usd: '"$"#,##0.00', pct: '0.0%', int: '#,##0', num: '#,##0.00', date: 'yyyy-mm-dd', datetime: 'yyyy-mm-dd hh:mm' };
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
