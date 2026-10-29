// ── SAMPLES BOARD SNAPSHOT ──────────────────────────────────────────────────
// The Samples board's load, its derived card rows and its per-card files, for
// the cards in tmp/plm-snapshot/fixture.json, written under tmp/ (gitignored),
// so moving that code out of app/programs.jsx can be checked byte for byte:
//
//   node scripts/plm-snapshot.mjs tmp/plm-snapshot/before
//   ...move...
//   node scripts/plm-snapshot.mjs tmp/plm-snapshot/after
//   node scripts/sheet-snapshot.mjs --compare tmp/plm-snapshot/before tmp/plm-snapshot/after
//
// What is written:
//   queries.json        every query the board load and the card files ask the
//                       database, in order (table, select, filters, order)
//   derived.json        each card as the board derives it -- the enriched row
//                       (stage, days in stage, stale, retired, note count,
//                       created by, last touched, latest orders...) and the
//                       tile's facts (health, overdue, open tasks, blocker,
//                       no testing), with its records rows, stage label, accent
//                       and round lines
//   board-tables.json   the board export's seven tables
//   <sku>/<records|working>/   the card's PDF page, XLSX and CSV, as the card's
//                       Export menu builds them on the Card tab and the first tab
//
// Before lib/plmBoard.js exists, the code runs where it is: app/programs.jsx
// is copied with a harness appended that holds Programs.load's body, the
// buckets and enriched memos, the tile's prelude and ProgramCard's three export
// functions, cut from the file as text -- so nothing is retyped. After, the
// lib's functions run. Either way the database is a stub over the fixture (the
// service role has no grant on vessl, by design), the date is pinned, and the
// logo fetch fails, so both files carry the typed company name.
import { register } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
register(pathToFileURL(join(ROOT, 'scripts/esm-alias-loader.mjs')).href);
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

// ── The date, pinned: days in stage, stale, the files' Generated line ───────
const NOW_MS = new Date('2026-10-29T12:00:00').getTime();
const RealDate = Date;
globalThis.Date = class extends RealDate {
  constructor(...a) { super(...(a.length ? a : [NOW_MS])); }
  static now() { return NOW_MS; }
};

const outDir = resolve(ROOT, process.argv[2] || 'tmp/plm-snapshot/run');
mkdirSync(outDir, { recursive: true });
const fx = JSON.parse(readFileSync(join(ROOT, 'tmp/plm-snapshot/fixture.json'), 'utf8'));
const ExcelJS = (await import('exceljs')).default;

// lib/supabase.js wants a URL at import; every query below goes to the stub.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'http://localhost.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= 'snapshot';
globalThis.fetch = async () => ({ ok: false });

// ── The database, a stub over the fixture ───────────────────────────────────
// Each table answers with its fixture rows (already in the order the query
// asks for), filtered by eq / is / not-is where the row has that column. A
// select with no embeds returns only the named columns, as PostgREST would.
const TABLES = {
  programs: fx.programs, program_notes: fx.program_notes, quotes: fx.quotes,
  purchase_order_items: fx.po_items, sales_order_items: fx.so_items, test_reports: fx.test_reports,
  staff_profiles: fx.staff, program_tasks: fx.tasks, program_sample_rounds: fx.rounds,
  companies: fx.carriers, sample_types: fx.sample_types, product_notes: fx.product_notes,
};
const queries = [];
function stubFrom(table) {
  const q = { table, select: null, filters: [], order: [] };
  queries.push(q);
  const keep = [];
  const b = {
    select(cols) { q.select = cols; return b; },
    eq(c, v) { q.filters.push(['eq', c, v]); keep.push((r) => !(c in r) || r[c] === v); return b; },
    is(c, v) { q.filters.push(['is', c, v]); keep.push((r) => !(c in r) || r[c] === v); return b; },
    not(c, op, v) { q.filters.push(['not', c, op, v]); keep.push((r) => !(c in r) || r[c] !== v); return b; },
    order(c, o) { q.order.push([c, o || null]); return b; },
    then(ok, no) {
      let data = (TABLES[table] || []).filter((r) => keep.every((f) => f(r)));
      if (q.select && !/[(:]/.test(q.select)) {
        const cols = q.select.split(',').map((s) => s.trim());
        data = data.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] === undefined ? null : r[c]])));
      }
      return Promise.resolve({ data: JSON.parse(JSON.stringify(data)), error: null }).then(ok, no);
    },
  };
  return b;
}
const { SB } = await imp('lib/supabase.js');
SB.from = stubFrom;

const libMode = existsSync(join(ROOT, 'lib/plmBoard.js')) && existsSync(join(ROOT, 'lib/plmFiles.js'));
console.log('mode:', libMode ? 'lib (after the move)' : 'inline (before the move)');

// ── The code under test, either way round ───────────────────────────────────
// Each mode provides: load() -> the board's state after a load; derive(state)
// -> { enriched, tile }; files(r, staff, kind, factoryName) -> the card's
// files [{ name, bytes }] and its PDF page; and the helpers the snapshot reads.
let M;
if (libMode) {
  const B = await imp('lib/plmBoard.js');
  const F = await imp('lib/plmFiles.js');
  M = {
    load: () => B.loadBoardData(),
    derive: (d) => ({ enriched: B.enrichRows(d.rows, B.buildBuckets(d.ev), d), tile: B.tileFacts }),
    // As the card's menu runs them: each format reads the notes afresh.
    files: async (r, staff, kind, factoryName) => {
      let notes = await F.fetchCardNotes(r, staff);
      const html = F.cardFileHtml({ kind, r, factoryName, staff, notes, logo: await F.cardLogo() });
      notes = await F.fetchCardNotes(r, staff);
      const x = await F.cardFileXlsx({ kind, r, factoryName, staff, notes, ExcelJS });
      notes = await F.fetchCardNotes(r, staff);
      const c = F.cardFileCsv({ kind, r, factoryName, staff, notes });
      return { html, list: [x, c] };
    },
    H: { ...B, ...F },
  };
} else {
  const src = readFileSync(join(ROOT, 'app/programs.jsx'), 'utf8').split('\n');
  const at = (text, from = 0) => {
    const i = src.findIndex((l, n) => n >= from && l.startsWith(text));
    if (i < 0) throw new Error('not found in programs.jsx: ' + text);
    return i;
  };
  const cut = (a, b) => src.slice(a, b).join('\n');
  // Programs.load, from the Promise.all to the last state it sets.
  const loadA = at('      const [p, nt, q, poi, soi, tr, st, tk, srTry, pc, stp] = await Promise.all([');
  const loadB = at('      setEv({ quotes:q.data||[]', loadA) + 1;
  const bA = at('  const buckets = useMemo(() => {') + 1, bB = at('  }, [ev]);', bA);
  const eA = at('  const enriched = useMemo(() => {') + 1, eB = at('  }, [rows, buckets, staff, noteCounts', eA);
  const tA = at('  const Card = ({ r }) => {') + 1, tB = at('    const blk = blockerOf(r);', tA) + 1;
  const xA = at("  const exportKind = tab === 'card'"), xC = at('  const exportCsv = async () => {', xA), xB = at('  };', xC) + 1;
  const harness = `
// ── SNAPSHOT HARNESS (scripts/plm-snapshot.mjs) ──
export async function __plmLoad() {
  let rows, staff, tasks, rounds, carriers, sentByLive, pkg2Live, sampleTypes, noteCounts, ev;
  const setRows = v => { rows = v; }, setStaff = v => { staff = v; }, setTasks = v => { tasks = v; },
        setRounds = v => { rounds = v; }, setCarriers = v => { carriers = v; }, setSentByLive = v => { sentByLive = v; },
        setPkg2Live = v => { pkg2Live = v; }, setSampleTypes = v => { sampleTypes = v; },
        setNoteCounts = v => { noteCounts = v; }, setEv = v => { ev = v; };
${cut(loadA, loadB)}
  return { rows, staff, tasks, rounds, carriers, sentByLive, pkg2Live, sampleTypes, noteCounts, ev };
}
export function __plmDerive({ rows, staff, tasks, rounds, carriers, sentByLive, pkg2Live, sampleTypes, noteCounts, ev }) {
  const buckets = (() => {
${cut(bA, bB)}
  })();
  const enriched = (() => {
${cut(eA, eB)}
  })();
  const tile = r => {
${cut(tA, tB)}
    return { h, notReq, late, openHere, blk };
  };
  return { enriched, tile };
}
export async function __plmFiles(r, staff, tab, factoryName, ExcelJS) {
  const list = [];
  let html = null, page = '';
  const setExporting = () => {};
  const loadExcelJS = async () => ExcelJS;
  const downloadBlob = (blob, name) => { list.push({ blob, name }); };
  const alert = m => { throw new Error(m); };
  const win = { document: { write: s => { page += s; }, open: () => { page = ''; }, close: () => { html = page; } }, close: () => {} };
  const window = { open: () => win };
${cut(xA, xB)}
  await exportPdf(); await exportXlsx(); await exportCsv();
  return { html, list };
}
export const __plmHelpers = { HEALTH, accentOf, stageLabel, cardGroups, roundText, sourceQuoteOf, buildBoardTables, shapeNotes };
`;
  const hDir = join(outDir, '_harness');
  mkdirSync(hDir, { recursive: true });
  writeFileSync(join(hDir, 'programs.jsx'), src.join('\n') + '\n' + harness);
  const P = await import(pathToFileURL(join(hDir, 'programs.jsx')).href);
  M = {
    load: () => P.__plmLoad(),
    derive: (d) => P.__plmDerive(d),
    files: async (r, staff, kind, factoryName) => {
      const out = await P.__plmFiles(r, staff, kind === 'records' ? 'card' : 'sampling', factoryName, ExcelJS);
      return { html: out.html, list: out.list };
    },
    H: P.__plmHelpers,
  };
}

// ── Run ─────────────────────────────────────────────────────────────────────
const d = await M.load();
const { enriched, tile } = M.derive(d);
const H = M.H;
const derived = enriched.map((r) => ({
  row: r,
  tile: tile(r),
  healthLabel: H.HEALTH[tile(r).h].label,
  accent: H.accentOf(r.stage),
  stageLabel: H.stageLabel(r.stage),
  sourceQuote: H.sourceQuoteOf(r),
  records: H.cardGroups(r),
  rounds: (r.rounds || []).map((x) => [H.roundText(x), H.roundText(x, true)]),
}));
writeFileSync(join(outDir, 'derived.json'), JSON.stringify(derived, null, 2));

const notesOf = (rows, kindCol, dflt) => H.shapeNotes(rows, kindCol, dflt, d.staff);
const cn = fx.program_notes.filter((n) => n.round_id === null);
const rn = fx.program_notes.filter((n) => n.round_id !== null);
const gn = fx.product_notes.filter((n) => n.kind === 'sampling');
writeFileSync(join(outDir, 'board-tables.json'), JSON.stringify(
  H.buildBoardTables(enriched, d.staff, notesOf(cn, 'source', 'manual'), notesOf(gn, 'kind', 'sampling'), notesOf(rn, 'source', 'round')), null, 2));

for (const r of enriched) {
  const sku = ((r.products || {}).sku || 'no-sku').replace(/[^A-Za-z0-9._-]+/g, '-');
  for (const kind of ['records', 'working']) {
    const dir = join(outDir, sku, kind);
    mkdirSync(dir, { recursive: true });
    const f = await M.files(r, d.staff, kind, r.factoryName);
    writeFileSync(join(dir, 'pdf.html'), f.html);
    const names = [];
    for (const x of f.list) {
      const ext = x.name.split('.').pop();
      writeFileSync(join(dir, 'file.' + ext), Buffer.from(await x.blob.arrayBuffer()));
      names.push(x.name + ' (' + x.blob.type + ')');
    }
    writeFileSync(join(dir, 'names.txt'), names.join('\n') + '\n');
  }
}
writeFileSync(join(outDir, 'queries.json'), JSON.stringify(queries, null, 2));
console.log(enriched.length + ' cards; ' + queries.length + ' queries; written to ' + outDir);
