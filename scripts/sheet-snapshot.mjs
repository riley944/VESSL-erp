// ── CLIENT PRICE SHEET SNAPSHOT ─────────────────────────────────────────────
// Builds the Send to Client sheet (CSV, XLSX and the PDF page's HTML) for three
// real quotes, read-only, and writes the files under tmp/ (gitignored), so a
// refactor of the export path can be checked byte for byte:
//
//   node scripts/sheet-snapshot.mjs tmp/sheet-snapshot/before
//   ...refactor...
//   node scripts/sheet-snapshot.mjs tmp/sheet-snapshot/after
//   node scripts/sheet-snapshot.mjs --compare tmp/sheet-snapshot/before tmp/sheet-snapshot/after
//
// It runs whichever code exists. Before the refactor the sheet is built the way
// SendToClientModal's exportAs builds it inline, and rowToForm is lifted out of
// app/quotes.jsx's source; after it, lib/clientSheetExport.js and
// lib/quoteRow.js are used. Everything time-dependent is pinned (the date), and
// the logo is public/logo.png at the size the browser would give it.
//
// The rows come from tmp/sheet-snapshot/fixture.json: three quotes, the
// kui_settings company name and one staff profile, copied read-only from the
// database. The service role has no grant on the vessl schema, by design, so
// this script never reads the database itself. Same fixture, every run.
import { register } from 'node:module';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(join(ROOT, 'scripts/esm-alias-loader.mjs')).href);
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const QUOTE_IDS = [
  'bfb1ec9d-7e59-472b-9ac4-1b6139856f49', // Q-0355 Minecraft, 6 tiers (3 priced), sized
  '28888626-b82c-48b9-8b5e-98766cd21766', // Q-0387 Legoland California, sized, a colour
  '4fd8f590-39af-484e-bc76-6cd5b04bbf2a', // Q-0342 Stitch Golf, 4 priced tiers, no sizes
];
const ME_EMAIL = 'mattdillon@kinguniversal.com';
const NOW = new Date('2026-10-29T12:00:00');
// Not the real bank details: the payment block's code path, with nothing real in it.
const FAKE_BANK = { company_name: '', bank_name: 'ZZ Test Bank', bank_beneficiary: 'ZZ Test Beneficiary', bank_account_number: '000000000',
                    bank_routing_aba: '000000000', bank_swift: 'ZZTESTXX', bank_address: '1 Test Street' };

// ── --compare ────────────────────────────────────────────────────────────────
if (process.argv[2] === '--compare') {
  const [a, b] = process.argv.slice(3).map((p) => resolve(ROOT, p));
  const JSZip = (await import('jszip')).default;
  const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  // Files starting _ are the run's own scaffolding (the lifted rowToForm), not output.
  const files = (d) => walk(d).map((f) => relative(d, f)).filter((f) => !/(^|[\\/])_/.test(f)).sort();
  const fa = files(a), fb = files(b);
  const diffs = [];
  for (const f of [...new Set([...fa, ...fb])]) {
    if (!fa.includes(f) || !fb.includes(f)) { diffs.push(f + ': only in ' + (fa.includes(f) ? 'first' : 'second')); continue; }
    const x = readFileSync(join(a, f)), y = readFileSync(join(b, f));
    if (!f.endsWith('.xlsx')) { if (!x.equals(y)) diffs.push(f + ': bytes differ'); continue; }
    // An .xlsx is a zip whose core.xml carries the moment it was built: every
    // part is compared, and core.xml with its two timestamps blanked.
    const za = await JSZip.loadAsync(x), zb = await JSZip.loadAsync(y);
    const parts = (z) => Object.keys(z.files).filter((n) => !z.files[n].dir).sort();
    const na = parts(za), nb = parts(zb);
    if (na.join() !== nb.join()) { diffs.push(f + ': different parts'); continue; }
    for (const n of na) {
      let ca = await za.file(n).async('string'), cb = await zb.file(n).async('string');
      if (n === 'docProps/core.xml') {
        const blank = (s) => s.replace(/(<dcterms:(created|modified)[^>]*>)[^<]*/g, '$1');
        ca = blank(ca); cb = blank(cb);
      }
      if (ca !== cb) diffs.push(f + ' / ' + n + ': differs');
    }
  }
  console.log(fa.length + ' files compared.');
  console.log(diffs.length ? 'DIFFERENCES:\n  ' + diffs.join('\n  ') : 'identical');
  process.exit(diffs.length ? 1 : 0);
}

// ── Build ────────────────────────────────────────────────────────────────────
const outDir = resolve(ROOT, process.argv[2] || 'tmp/sheet-snapshot/run');
mkdirSync(outDir, { recursive: true });

const fixture = JSON.parse(readFileSync(join(ROOT, 'tmp/sheet-snapshot/fixture.json'), 'utf8'));
const rows = fixture.quotes;
const settings = fixture.settings;
const me = fixture.me && (fixture.me.email || '').toLowerCase() === ME_EMAIL ? fixture.me : {};

const libMode = existsSync(join(ROOT, 'lib/clientSheetExport.js')) && existsSync(join(ROOT, 'lib/quoteRow.js'));
console.log('mode:', libMode ? 'lib (after the refactor)' : 'inline (before the refactor)');

// rowToForm: the lib's, or the one in app/quotes.jsx, lifted out as text.
let rowToForm;
if (libMode) ({ rowToForm } = await imp('lib/quoteRow.js'));
else {
  const src = readFileSync(join(ROOT, 'app/quotes.jsx'), 'utf8');
  const fn = (name) => {
    const i = src.indexOf('\nfunction ' + name + '(');
    if (i < 0) throw new Error('not found: ' + name);
    let depth = 0, j = src.indexOf('{', i);
    for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
    return src.slice(i + 1, j + 1);
  };
  const split = /\nconst DUTY_SPLIT_AT = [^\n]*/.exec(src)[0];
  const mod = [
    "import { toScaleList, sizeKey, storedQtyToMap as qtyMapFrom } from '@/app/components/SizeGrid';",
    "import { sizeCostFrom } from '@/lib/quoteTiers';",
    ...['suggestedMarkup', 'roundToPricePoint', 'suggestClientPrice', 'deltasToMap', 'platesToMap', 'cartonsToMap'].map(fn),
    split, fn('rowToForm'), 'export { rowToForm };',
  ].join('\n');
  const tmpMod = join(outDir, '_rowToForm.legacy.js');
  writeFileSync(tmpMod, mod);
  ({ rowToForm } = await import(pathToFileURL(tmpMod).href));
}

const { buildModel, toWorkbookSheet, toCsv, toHtml, longDate, NOTE_DDP, NOTE_APPROVAL } = await imp('lib/clientSheet.js');
const { buildPriceSheet } = await imp('lib/workbook.js');
const { safeName } = await imp('lib/exportFormats.js');
const { BANK_FIELDS } = await imp('lib/bankFields.js');
const ExcelJS = (await import('exceljs')).default;

const logoSrc = 'data:image/png;base64,' + readFileSync(join(ROOT, 'public/logo.png')).toString('base64');
const png = readFileSync(join(ROOT, 'public/logo.png'));
const nat = { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
const logoSize = { width: 160, height: Math.round(160 * nat.h / nat.w) };

const quotes = QUOTE_IDS.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map(rowToForm);
if (quotes.length !== 3) throw new Error('expected 3 quotes, got ' + quotes.length);

// One sheet: the header, edits and payment as the settings step makes them,
// then each format.
async function sheet(label, client, picked, withPayment) {
  const vendor = null;
  let head, edits, payment, base, files;
  if (libMode) {
    const X = await imp('lib/clientSheetExport.js');
    head = X.sheetHeader({ client, settings, me, now: NOW });
    edits = X.sheetEdits(picked);
    payment = X.sheetPayment({ withPayment, settings: withPayment ? FAKE_BANK : settings, vendor });
    const model = buildModel({ quotes: picked, edits, header: head, payment });
    base = X.sheetBaseName(client, NOW);
    files = {
      xlsx: await X.sheetFile({ fmt: 'xlsx', model, logoSrc, logoSize, base, loadExcel: async () => ExcelJS }),
      csv: await X.sheetFile({ fmt: 'csv', model, logoSrc: '', logoSize: null, base }),
      pdf: await X.sheetFile({ fmt: 'pdf', model, logoSrc, logoSize, base }),
    };
  } else {
    // As SendToClientModal: toSettings, then exportAs.
    const s = withPayment ? FAKE_BANK : settings;
    const co = (settings && settings.company_name) || 'King Universal Inc.';
    head = {
      company: (client || '').toUpperCase(),
      programme: 'UNIT PRICING',
      date: longDate(NOW),
      notes: [NOTE_DDP, NOTE_APPROVAL],
      signoff: { name: me.full_name || '', company: co,
                 title: (me.job_title || '').trim().toLowerCase() === (me.email || '').toLowerCase() ? '' : (me.job_title || '') },
    };
    edits = {};
    picked.forEach((q) => { if (!edits[q.id]) edits[q.id] = { item: q.product || '', details: q.clientDetails || '', color: q.clientColor || '' }; });
    payment = withPayment && s ? {
      vendor,
      bank: BANK_FIELDS.map(([k, lbl]) => [lbl, String((s || {})[k] ?? '').trim()]).filter(([, v]) => v !== ''),
    } : null;
    const model = buildModel({ quotes: picked, edits, header: head, payment });
    const day = NOW.toISOString().slice(0, 10);
    base = 'KUI-Price-Sheet-' + safeName(client || 'client') + '-' + day;
    const buf = await buildPriceSheet(ExcelJS, toWorkbookSheet(model, logoSize ? { base64: logoSrc, ...logoSize } : null)).xlsx.writeBuffer();
    files = {
      xlsx: { blob: new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: base + '.xlsx' },
      csv: { blob: new Blob(['﻿' + toCsv(model)], { type: 'text/csv;charset=utf-8' }), filename: base + '.csv' },
      pdf: { html: toHtml(model, logoSize ? logoSrc : '') },
    };
  }
  const dir = join(outDir, label);
  mkdirSync(dir, { recursive: true });
  for (const [fmt, f] of Object.entries(files)) {
    if (f.blob) {
      writeFileSync(join(dir, fmt + '.' + fmt), Buffer.from(await f.blob.arrayBuffer()));
      writeFileSync(join(dir, fmt + '.name.txt'), f.filename + '\n' + f.blob.type);
    } else writeFileSync(join(dir, 'pdf.html'), f.html);
  }
  writeFileSync(join(dir, 'header.json'), JSON.stringify({ head, edits }, null, 2));
}

for (const q of quotes) await sheet(q.quoteCode, q.client, [q], false);
await sheet('all-three', quotes[0].client, quotes, false);
await sheet('with-payment', quotes[2].client, [quotes[2]], true);
writeFileSync(join(outDir, 'forms.json'), JSON.stringify(quotes, null, 2));
console.log('written to', relative(ROOT, outDir));
