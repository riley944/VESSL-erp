import { COMPLIANCE_OPTS, STAGE_OPTS } from '@/lib/productOptions';
import { excelDate } from '@/lib/excel';

// ── The weekly testing email: its sheets, its workbook and its wording ────────
// Pure, like lib/rfqSheet.js: ExcelJS is passed in rather than imported, and
// nothing here reads the database or the clock except through its arguments.
// The rows come from vessl.testing_digest_rows() (script 108), which decides
// which product is on which sheet. This file only lays them out.

// The four sheets, in the order they appear in the workbook, the subject and the
// body. key is the sheet number the function returns; subj is how the subject
// line names it.
export const TESTING_SHEETS = [
  { key:1, name:'Nothing set',     line:'Nothing set',     subj:'nothing set' },
  { key:2, name:'Compliance only', line:'Compliance only', subj:'compliance only' },
  { key:3, name:'Stage only',      line:'Stage only',      subj:'stage only' },
  { key:4, name:'Compliance TBD',  line:'Compliance TBD',  subj:'TBD' },
];

// The labels the Testing page shows. NULL reads as Not set, never as the
// '— Not set —' of the dropdown, which is a control rather than a value. A value
// outside the list prints as stored, so nothing in the column is ever hidden.
const labelFrom = opts => v => {
  if (v == null || String(v).trim() === '') return 'Not set';
  const hit = opts.find(([k]) => k === v);
  return hit ? hit[1] : String(v);
};
export const stageLabel = labelFrom(STAGE_OPTS);
export const complianceLabel = labelFrom(COMPLIANCE_OPTS);

// Created dates are printed on the calendar day KUI is on, not UTC's, so a
// product made at 9pm Eastern does not show as made the next day.
const TZ = 'America/New_York';
const dayIn = ts => ts ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts)) : null;
export const todayIn = (now = new Date()) => dayIn(now);

// Each column is [header, read, kind]. 'date' cells are real Excel dates.
const COLUMNS = [
  ['SKU',                p => p.sku || ''],
  ['Product name',       p => p.name || ''],
  ['Client',             p => p.client || ''],
  ['Created',            p => dayIn(p.created_at), 'date'],
  ['Stage',              p => stageLabel(p.product_stage)],
  ['Compliance status',  p => complianceLabel(p.compliance_status)],
  ['Test report on file', p => p.report_on_file ? 'Yes' : 'No'],
  ['Latest test date',   p => p.latest_test_date || null, 'date'],
];

// Newest first, then SKU, then id -- the order script 108 returns, applied again
// here so the workbook never depends on row order surviving the API. A missing
// date or SKU sorts last.
const cmpNullLast = (a, b, f) => (a == null) - (b == null) || (a == null ? 0 : f(a, b));
export const sortSheetRows = rows => rows.slice().sort((a, b) =>
  cmpNullLast(a.created_at, b.created_at, (x, y) => new Date(y) - new Date(x)) ||
  cmpNullLast(a.sku, b.sku, (x, y) => x.localeCompare(y, 'en')) ||
  String(a.product_id).localeCompare(String(b.product_id)));

// rows -> { 1:[...], 2:[...], 3:[...], 4:[...] }, each sorted.
export function groupBySheet(rows) {
  const out = {};
  TESTING_SHEETS.forEach(s => { out[s.key] = sortSheetRows((rows || []).filter(r => r.sheet === s.key)); });
  return out;
}

export const countsOf = bySheet => TESTING_SHEETS.map(s => ({ ...s, count: (bySheet[s.key] || []).length }));

export const testingFileName = day => 'KUI-testing-' + day + '.xlsx';

export const testingSubject = counts =>
  'Weekly testing list — ' + counts.map(c => c.count + ' ' + c.subj).join(', ');

export const TESTING_PAGE_URL = 'https://orders.vessl.io/#testing';

// One line per sheet with its count, the link, and nothing else.
export const testingText = counts =>
  counts.map(c => c.line + ': ' + c.count + '.').join('\n') +
  '\n\nThe lists are in the attached workbook, one sheet each, newest first.\n' +
  'Testing page: ' + TESTING_PAGE_URL + '\n';

export const testingHtml = counts =>
  '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f;font-size:14px;line-height:1.6">' +
  counts.map(c => '<div>' + c.line + ': <b>' + c.count + '</b>.</div>').join('') +
  '<div style="margin-top:14px;color:#86868b;font-size:13px">The lists are in the attached workbook, one sheet each, newest first.</div>' +
  '<div style="margin-top:4px;font-size:13px"><a href="' + TESTING_PAGE_URL + '">Open the Testing page</a></div>' +
  '</div>';

// The plain rows a dry run returns -- the same text the workbook prints.
export const previewRow = p => Object.fromEntries(COLUMNS.map(([h, read]) => [h, read(p)]));

// Header row bold, frozen and filterable, dates as yyyy-mm-dd -- the same shape as
// the Testing page export. An empty sheet keeps its header and says so in one line.
export async function buildTestingWorkbook(ExcelJS, bySheet) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL';
  wb.created = new Date();
  TESTING_SHEETS.forEach(s => {
    const rows = bySheet[s.key] || [];
    const ws = wb.addWorksheet(s.name);
    ws.addRow(COLUMNS.map(c => c[0]));
    if (rows.length) {
      rows.forEach(p => ws.addRow(COLUMNS.map(c => c[2] === 'date' ? excelDate(c[1](p)) : c[1](p))));
    } else {
      ws.addRow(['None this week']);
    }
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = { from: { row:1, column:1 }, to: { row:1, column:COLUMNS.length } };
    COLUMNS.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c[2] === 'date') col.numFmt = 'yyyy-mm-dd';
      let w = String(c[0]).length;
      rows.forEach(p => {
        const v = c[1](p);
        const len = v == null ? 0 : (c[2] === 'date' ? 10 : String(v).length);
        if (len > w) w = len;
      });
      col.width = Math.min(Math.max(w + 2, 10), 60);
    });
  });
  return wb.xlsx.writeBuffer();
}
