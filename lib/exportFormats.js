import { docLetterhead, letterheadLines, paginatedDocument } from '@/lib/orderDoc';

// ── One set of sheet descriptions, three formats ─────────────────────────────
// The Excel writer (lib/workbook.js), the CSV files and the PDF all read the
// SAME sheet descriptions, so the three cannot disagree with each other or with
// the page that built them. Nothing here knows what a sheet means; see
// lib/workbook.js for the description's shape. Two optional table fields are
// read only here:
//   slug     the table's name in a CSV file name ("Freight-Quotes")
//   pdfCols  the column headers the PDF prints, when a table is too wide for a
//            landscape page at a readable size; the rest are named under it.
// Pure: no DOM, no network. The page does the downloading and the window.

// A reference made safe for a file name: letters, digits, dot, dash and
// underscore; anything else becomes a dash, runs collapse, 60 characters at most.
export const safeName = s => String(s == null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60).replace(/[-.]+$/, '') || 'record';

const pad = n => String(n).padStart(2, '0');
const localYmd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const localHm = d => pad(d.getHours()) + ':' + pad(d.getMinutes());
const plain = x => String(Math.round(x * 1e6) / 1e6);

// A cell as { v, fmt } whatever shape it arrived in, its column's format filled in.
export const cellOf = (raw, col) => {
  const o = raw != null && typeof raw === 'object' && !(raw instanceof Date) ? raw : { v: raw };
  return { v: o.v, fmt: o.fmt || (col || {}).fmt || 'text', bold: !!o.bold };
};

// ── CSV ───────────────────────────────────────────────────────────────────────
// Dates YYYY-MM-DD, times YYYY-MM-DD HH:MM in the exporter's clock, numbers plain
// (no $, no thousands commas) and as stored -- the value in the Excel cell, not
// its rounded display -- trimmed only of floating-point noise; a percentage as
// its number.
export function csvValue(raw, col) {
  const { v, fmt } = cellOf(raw, col);
  if (v == null || v === '') return '';
  if (fmt === 'date') return String(v).slice(0, 10);
  if (fmt === 'datetime') { const d = v instanceof Date ? v : new Date(v); return localYmd(d) + ' ' + localHm(d); }
  if (fmt === 'int') return typeof v === 'number' ? String(Math.round(v)) : String(v);
  if (['usd', 'num', 'num3', 'num4', 'pct'].includes(fmt)) return typeof v === 'number' ? plain(v) : String(v);
  return String(v);
}
// A text cell that a spreadsheet would read as a formula is prefixed with a
// single quote: = + - @, and tab or carriage return, which some read the same
// way. Numbers are never touched -- a real -5 stays -5.
export const csvGuard = (s, isText) => (isText && /^[=+\-@\t\r]/.test(s) ? "'" + s : s);
// RFC 4180: a field with a comma, a quote or a line break goes in quotes, and
// a quote inside it is doubled.
export const csvField = s => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);

export function tableToCsv(t) {
  const line = cells => cells.map(c => csvField(c)).join(',');
  const head = line(t.cols.map(c => csvGuard(c.h, true)));
  const body = t.rows.map(r => line(t.cols.map((c, i) => {
    const cell = cellOf(r[i], c);
    const isText = cell.fmt === 'text' || typeof cell.v === 'string' && !['date', 'datetime'].includes(cell.fmt);
    return csvGuard(csvValue(r[i], c), isText);
  })));
  // UTF-8 with a byte order mark, so Excel opens accents and symbols as written.
  return '﻿' + [head, ...body].join('\r\n') + '\r\n';
}

// One file per table; a key/value Summary sheet is left out -- the filters go
// in the file names instead. nameOf(sheet, table, indexInSheet) -> file name.
export function sheetsToCsvFiles(sheets, nameOf) {
  const files = [];
  sheets.filter(sh => !sh.kv).forEach(sh => (sh.tables || []).forEach((t, i) => files.push({ name: nameOf(sh, t, i), text: tableToCsv(t) })));
  return files;
}

// Parse CSV text back into rows of strings (for checking an export, and for
// anyone who wants to read one). Handles quoted fields, doubled quotes and line
// breaks inside quotes; drops the BOM.
export function parseCsv(text) {
  const s = text.replace(/^﻿/, '');
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r' && s[i + 1] === '\n') { row.push(f); rows.push(row); row = []; f = ''; i++; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// ── PDF (a print window) ──────────────────────────────────────────────────────
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return y ? MON[m - 1] + ' ' + d + ', ' + y : String(s); };
export function pdfValue(raw, col) {
  const { v, fmt } = cellOf(raw, col);
  if (v == null || v === '') return '';
  if (fmt === 'date') return dayText(v);
  if (fmt === 'datetime') { const d = v instanceof Date ? v : new Date(v); return dayText(localYmd(d)) + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  if (typeof v !== 'number') return String(v);
  if (fmt === 'usd') return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === 'num') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (fmt === 'num3') return v.toFixed(3);
  if (fmt === 'num4') return v.toFixed(4);
  if (fmt === 'pct') return v.toFixed(1) + '%';
  if (fmt === 'int') return Math.round(v).toLocaleString('en-US');
  return String(v);
}
// The columns a table prints, and the ones it leaves to the Excel and CSV files.
export function pdfColumns(t) {
  if (!t.pdfCols) return { keep: t.cols.map((c, i) => i), dropped: [] };
  const keep = t.cols.map((c, i) => (t.pdfCols.includes(c.h) ? i : -1)).filter(i => i >= 0);
  return { keep, dropped: t.cols.filter(c => !t.pdfCols.includes(c.h)).map(c => c.h) };
}

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl = s => esc(s).replace(/\r?\n/g, '<br>');
const RIGHT = ['usd', 'num', 'num3', 'num4', 'int', 'pct'];
// Text never below 8pt: cells 8.5pt, headers 8pt.
const TH = 'text-align:left;padding:5px 7px 5px 0;font-size:8pt;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:#4b5563;border-bottom:1.5px solid #0c1322;vertical-align:bottom;';
const TD = 'padding:5px 7px 5px 0;font-size:8.5pt;color:#111827;border-bottom:1px solid #e5e7eb;vertical-align:top;overflow-wrap:anywhere;';

function pdfTable(t, heading) {
  const { keep, dropped } = pdfColumns(t);
  const cols = keep.map(i => t.cols[i]);
  const right = c => RIGHT.includes(c.fmt) ? 'text-align:right;' : '';
  // The heading is the first header row, so it repeats with the column names
  // on every page the table runs onto and is never stranded at a page foot.
  const cap = '<tr><th colspan="' + cols.length + '" style="text-align:left;padding:14px 0 6px;font-size:11pt;font-weight:600;color:#0c1322;letter-spacing:-.005em;">'
    + esc(heading) + (dropped.length ? '<div style="font-size:8pt;font-weight:400;color:#6b7280;margin-top:3px;">Not shown here, in the Excel and CSV files: ' + esc(dropped.join(', ')) + '</div>' : '') + '</th></tr>';
  const head = '<tr>' + cols.map(c => '<th style="' + TH + right(c) + '">' + esc(c.h) + '</th>').join('') + '</tr>';
  const body = t.rows.length
    ? t.rows.map(r => '<tr>' + keep.map(i => { const c = t.cols[i]; const cell = cellOf(r[i], c);
        return '<td style="' + TD + right({ fmt: cell.fmt }) + (cell.bold ? 'font-weight:600;' : '') + '">' + nl(pdfValue(r[i], c)) + '</td>'; }).join('') + '</tr>').join('')
    : '<tr><td colspan="' + cols.length + '" style="' + TD + 'color:#6b7280;font-style:italic;">' + esc(t.emptyText || 'Nothing to list') + '</td></tr>';
  return '<table data-table="1" style="width:100%;border-collapse:collapse;margin-top:6px;"><thead>' + cap + head + '</thead><tbody>' + body + '</tbody></table>';
}

// A key/value table (the Summary) prints as a compact two-column block, its
// bold rows as small headings.
function pdfKv(t) {
  const rows = t.rows.map(r => {
    const a = cellOf(r[0]), b = cellOf(r[1], t.cols[1]), c = cellOf(r[2]);
    if (a.bold) return '<tr><td colspan="3" style="padding:10px 0 3px;font-size:8pt;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">' + esc(a.v) + '</td></tr>';
    return '<tr><td style="padding:2px 14px 2px 0;font-size:9pt;color:#4b5563;white-space:nowrap;vertical-align:top;">' + esc(a.v) + '</td>'
      + '<td style="padding:2px 14px 2px 0;font-size:9pt;color:#111827;font-weight:600;vertical-align:top;">' + nl(pdfValue(r[1], t.cols[1])) + '</td>'
      + '<td style="padding:2px 0;font-size:8.5pt;color:#6b7280;vertical-align:top;">' + nl(c.v) + '</td></tr>';
  }).join('');
  return '<table style="border-collapse:collapse;margin-top:4px;"><tbody>' + rows + '</tbody></table>';
}

// brand: { settings, logo } as loadLetterhead returns it. meta: { title, ref,
// lines (plain sentences under the letterhead), footLeft }.
export function sheetsToPdfHtml(sheets, brand, meta) {
  const st = (brand && brand.settings) || {};
  const coName = (st.company_name || '').trim() || 'King Universal Inc.';
  const blocks = [];
  blocks.push(docLetterhead({ logo: (brand && brand.logo) || '', coName, headLines: letterheadLines(st, esc), title: meta.title, ref: meta.ref || '', esc }));
  blocks.push('<div style="margin-top:14px;">' + (meta.lines || []).map(l => '<div style="font-size:9.5pt;color:#374151;margin-top:3px;">' + esc(l) + '</div>').join('') + '</div>');
  sheets.forEach(sh => {
    if (sh.kv) { (sh.tables || []).forEach(t => blocks.push('<div style="margin-top:8px;">' + pdfKv(t) + '</div>')); return; }
    (sh.notes || []).length && blocks.push('<div style="margin-top:16px;font-size:8.5pt;color:#6b7280;line-height:1.45;">' + sh.notes.map(esc).join('<br>') + '</div>');
    (sh.tables || []).forEach(t => blocks.push(pdfTable(t, t.title || sh.name)));
  });
  return paginatedDocument({ titleHtml: esc(meta.title + (meta.ref ? ' ' + meta.ref : '')), flow: blocks.join(''), footLeftHtml: esc(meta.footLeft || ''), landscape: true });
}
