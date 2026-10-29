// ── ONE-RECORD EXPORTS SNAPSHOT ─────────────────────────────────────────────
// The per-card exports of the Sales Orders, Purchase Orders and Shipments
// pages (the 8 Oct work) -- XLSX, each CSV file and the PDF page's HTML -- for
// two real records of each, written under tmp/ (gitignored), so moving the
// file-building code out of app/page.jsx can be checked byte for byte:
//
//   node scripts/record-snapshot.mjs tmp/record-snapshot/before
//   ...move...
//   node scripts/record-snapshot.mjs tmp/record-snapshot/after
//   node scripts/sheet-snapshot.mjs --compare tmp/record-snapshot/before tmp/record-snapshot/after
//
// Before lib/recordExport.js exists, the files are built the way page.jsx's
// deliverExport (orders) and Shipments' deliver build them inline; after, by
// lib/recordExport.js. Orders run with money shown and hidden. The rows come
// from tmp/record-snapshot/fixture.json, copied read-only from the database in
// the shape the pages' selects return; the letterhead settings there carry no
// bank fields. The date and the exporting person are pinned.
import { register } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(join(ROOT, 'scripts/esm-alias-loader.mjs')).href);
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const NOW = new Date('2026-10-29T12:00:00');
const DAY = '2026-10-29';
const WHO = 'Matt Dillon (mattdillon@kinguniversal.com)';

const outDir = resolve(ROOT, process.argv[2] || 'tmp/record-snapshot/run');
mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(readFileSync(join(ROOT, 'tmp/record-snapshot/fixture.json'), 'utf8'));

const { buildSoRecordSheets, buildPoRecordSheets, orderFileName, orderPdfMeta } = await imp('lib/ordersExport.js');
const { buildRecordSheets, recordFileName, recordPdfMeta } = await imp('lib/shipmentsExport.js');
const { etaDaysAt } = await imp('lib/shipmentsView.js');
const { sheetsToCsvFiles, sheetsToPdfHtml } = await imp('lib/exportFormats.js');
const { buildWorkbook } = await imp('lib/workbook.js');
const ExcelJS = (await import('exceljs')).default;

const logo = 'data:image/png;base64,' + readFileSync(join(ROOT, 'public/logo.png')).toString('base64');
const brand = { settings: fx.settings, logo };

// lib/recordExport.js imports the app's Supabase client, which wants a URL at
// import. Nothing here calls it -- the letterhead comes from the fixture -- so
// a placeholder is enough.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'snapshot';
const libMode = existsSync(join(ROOT, 'lib/recordExport.js'));
console.log('mode:', libMode ? 'lib (after the move)' : 'inline (before the move)');
const X = libMode ? await imp('lib/recordExport.js') : null;

// The three formats of one `out` ({ sheets, xlsxName, csvName, pdfMeta }).
async function files(out) {
  if (libMode) {
    const xlsx = await X.buildExportFiles('xlsx', out, { brand, loadExcel: async () => ExcelJS });
    const csv = await X.buildExportFiles('csv', out, { brand });
    const pdf = await X.buildExportFiles('pdf', out, { brand });
    return { xlsx: xlsx.files, csv: csv.files, html: pdf.html };
  }
  // As page.jsx deliverExport / Shipments deliver.
  const buf = await buildWorkbook(ExcelJS, out.sheets).xlsx.writeBuffer();
  const xlsx = [{ blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name: out.xlsxName }];
  const csv = sheetsToCsvFiles(out.sheets, out.csvName).map((f) => ({ blob: new Blob([f.text], { type: 'text/csv;charset=utf-8' }), name: f.name }));
  return { xlsx, csv, html: sheetsToPdfHtml(out.sheets, brand, out.pdfMeta) };
}

async function write(label, out) {
  const dir = join(outDir, label);
  mkdirSync(dir, { recursive: true });
  const f = await files(out);
  const names = [];
  for (const [k, list] of [['xlsx', f.xlsx], ['csv', f.csv]]) {
    for (let i = 0; i < list.length; i++) {
      writeFileSync(join(dir, k + '-' + i + '.' + k), Buffer.from(await list[i].blob.arrayBuffer()));
      names.push(k + ' ' + i + ': ' + list[i].name + ' (' + list[i].blob.type + ')');
    }
  }
  writeFileSync(join(dir, 'pdf.html'), f.html);
  writeFileSync(join(dir, 'names.txt'), names.join('\n'));
}

for (const showMoney of [true, false]) {
  const ctx = { exportedAt: NOW, user: WHO, showMoney };
  for (const so of fx.so) {
    await write('so-' + so.id.slice(0, 8) + (showMoney ? '-money' : '-nomoney'), {
      sheets: buildSoRecordSheets(so, ctx), xlsxName: orderFileName('so', so, DAY, 'xlsx'),
      csvName: (sh, t, i) => orderFileName('so', so, DAY, 'csv', t, i), pdfMeta: orderPdfMeta('so', so, ctx) });
  }
  for (const p of fx.po) {
    await write('po-' + p.id.slice(0, 8) + (showMoney ? '-money' : '-nomoney'), {
      sheets: buildPoRecordSheets(p, ctx), xlsxName: orderFileName('po', p, DAY, 'xlsx'),
      csvName: (sh, t, i) => orderFileName('po', p, DAY, 'csv', t, i), pdfMeta: orderPdfMeta('po', p, ctx) });
  }
}
for (const s of fx.shipments) {
  const ctx = { exportedAt: NOW, user: WHO, coNames: fx.coNames, V: { etaDays: (eta) => etaDaysAt(eta, NOW) } };
  await write('ship-' + s.id.slice(0, 8), {
    sheets: buildRecordSheets('shipment', s, ctx), xlsxName: recordFileName('shipment', s, DAY, 'xlsx'),
    csvName: (sh, t, i) => recordFileName('shipment', s, DAY, 'csv', t, i), pdfMeta: recordPdfMeta('shipment', s, ctx) });
}
console.log('written to', relative(ROOT, outDir));
