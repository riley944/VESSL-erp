// ── A SAMPLE CARD AS A FILE ─────────────────────────────────────────────────
// Moved out of app/programs.jsx as it was: the records file (the Card tab),
// the working file (the first tab) and the board file -- their print kit,
// their workbook pieces, the notes they read (fetchCardNotes) -- and the
// card's Export menu as three functions (cardFileHtml, cardFileXlsx,
// cardFileCsv), so the desktop card and the iPad view build the same files.
// The comments came with the code and still speak from where it was.
import { SB } from '@/lib/supabase';
import { fmt } from '@/lib/lifecycle';
import { COMPLIANCE_OPTS, STAGE_OPTS, CATALOGUE_OPTS, catalogueKey } from '@/lib/products';
import { trackingUrl } from '@/lib/tracking';
import { excelDate } from '@/lib/excel';
import { MANUAL_STAGES, VISIBLE_STAGES, STALE_DAYS, HEALTH, CHECKLIST_ON, DUE_BACK_ON, BLOCKERS, openTasks, blockerOf, sampleOverdue, healthOf, sampleTypeLabel, sentByLabel, STAGE_LABEL, stageLabel, optLabel, sampleStripText, recordRows, suggestRow, staffName } from '@/lib/plmBoard';

// ── THE CARD AS A FILE ──────────────────────────────────────────────────────
// Three formats, one description of the card. cardGroups is the shape the
// printed document wants -- a details grid, then the reported block -- and
// cardFields flattens the same thing to one row per field for the workbook and
// the CSV. Neither builds its own list, so a field added here reaches all three.
export const cardGroups = r => {
  const p = r.products || {};
  const sug = suggestRow(r);
  return {
    head: [
      ['Stage', stageLabel(r.stage)],
      ['Owner', r.ownerName || 'Unowned'],
      ['Stage set', r.since ? fmt(r.since) : 'Not recorded'],
      ['Days in this stage', (r.days === null || r.days === undefined) ? '—'
        : String(r.days) + (r.stale ? ' · stale past ' + STALE_DAYS : '')],
      ['Last touch', r.lastTouchAt
        ? fmt(r.lastTouchAt) + (r.lastTouchBy ? ' · ' + r.lastTouchBy : '') : 'Not recorded'],
      // Latest sample was here and went with the sample log. The card's sample
      // strip is reported on the Sampling row under What the system knows.
    ],
    knows: [
      // The third element is the tracking link on the two tracking rows, and
      // undefined everywhere else. The PDF and the workbook use it; the CSV and
      // every other reader take the first two.
      ...recordRows(r).map(([label, value, , ship]) => [label, value, ship ? ship.url : null]),
      // THE PRODUCT'S OWN FIELD, labelled as such. The card's screen row called
      // Product stage shows the card's stage by name; this line is
      // products.product_stage, which mirrors it as Sample or Production, and
      // the file's own Stage line above already names the card's stage.
      ['Sample / Production', optLabel(STAGE_OPTS, p.product_stage)],
      ['Compliance', optLabel(COMPLIANCE_OPTS, p.compliance_status)],
      [sug[0], sug[1]],
      ['Catalogue', optLabel(CATALOGUE_OPTS, catalogueKey(p))],
    ],
  };
};
export const cardFields = r => {
  const p = r.products || {};
  const g = cardGroups(r);
  // SKU, product and client are the letterhead on the printed card; in a flat
  // file they are three fields like any other, and leaving them out would make
  // a sheet that cannot say which card it came from.
  return [
    ['SKU', p.sku || '—'],
    ['Product', p.name || '—'],
    ['Client', (r.client || {}).name || '—'],
    ...g.head, ...g.knows,
  ];
};

export const stampToday = () => {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
};
// A note carries a real timestamp and keeps its minute. Two notes written the
// same afternoon, printed with the date alone, would read in an order nobody can
// check -- and the notes are the part of this card people argue about.
export const stampText = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
       +' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
};
// <SKU>-sample-card-records-<date> or <SKU>-sample-card-working-<date>, with anything a
// filesystem would argue about replaced. The kind tells the two files apart --
// records from the Card tab, working from the first tab. A SKU is not guaranteed
// to be tame -- BUC-157 has a sibling with a double space in its name -- and a
// slash in a download name is a silent failure.
export const fileBase = (r, kind = 'records') => {
  const raw = (r.products || {}).sku || 'no-sku';
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || 'no-sku') + '-sample-card-' + kind + '-' + stampToday();
};
export const downloadBlob = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
};

// BOTH NOTE SETS, FETCHED HERE rather than lifted out of NotesPanel. The panel
// owns its own list and only ONE of the two is mounted at a time -- General
// Notes lives on the Card tab and Card Notes on the Sampling tab. Reading from
// the panel would mean an export from one tab wrote an empty section for the
// other purely because nobody had clicked it, which is the kind of wrong that
// looks right.
//
// THE NAMES MATCH THE SCREEN. card is program_notes -- this card's own notes,
// "Card Notes" on the Sampling tab. general is product_notes of kind sampling --
// the product's notes, shared by every card for the SKU, "General Notes" on the
// Card tab. The kind value in the table is still 'sampling'; only the label
// changed. The sample log is no longer exported; its rows stay in the table.
// ── ONE NOTE, AS EVERY FILE WRITES IT ───────────────────────────────────────
// Shared by the card files (fetchCardNotes) and the board file, so a note reads
// the same in both.
//
// kind on a product note, source on a program note. Both answer the same
// question in the file -- what sort of note is this -- so both land in one
// column and the two tables' column names stop mattering past this line.
// The default kind is left blank, as the screen hides it: a product note's
// kind is still 'sampling' in the table, and printing that under "General
// notes" would contradict the heading it sits under. program_id and product_id
// ride along for the board file, which has to say which card a note is on.
export const shapeNotes = (list, kindCol, dflt, staff = []) => (list || []).map(n => ({
  // The author by name, as on screen -- staffName falls back to the email.
  kind: (n[kindCol] && n[kindCol] !== dflt) ? n[kindCol] : '', author: staffName(staff, n.author) || 'unknown',
  date: n.created_at, edited: !!n.edited_at, text: n.note || '', stage: n.stage || null,
  programId: n.program_id || null, productId: n.product_id || null,
  roundId: n.round_id || null, roundNo: n.round_no || null,
}));

export const fetchCardNotes = async (r, staff = []) => {
  // round_id NULL: a note on a live round belongs to its round, not to Card
  // Notes (script 98). A deleted round's notes have NULL here and are included.
  const own = await SB.from('program_notes')
    .select('author,note,created_at,edited_at,source,stage,round_no')
    .eq('program_id', r.id).is('round_id', null).order('created_at', { ascending:false }).order('id', { ascending:false });
  if (own.error) throw new Error(own.error.message);
  // The notes on the card's live rounds, for the working file's Round notes.
  // Newest first within a round, as the card lists them; id breaks a tie.
  const onRounds = await SB.from('program_notes')
    .select('author,note,created_at,edited_at,source,round_id,round_no')
    .eq('program_id', r.id).not('round_id', 'is', null).order('created_at', { ascending:false }).order('id', { ascending:false });
  if (onRounds.error) throw new Error(onRounds.error.message);
  // A card with no product has no product notes to ask for. product_id is the
  // key, and .eq on null matches nothing -- a round trip to learn what is already
  // known here.
  let prod = { data: [] };
  if (r.product_id) {
    // NARROWED ON kind. One table holds these notes and the old sample log, so
    // a select on product_id alone would put every sample event in the file.
    prod = await SB.from('product_notes')
      .select('author,note,created_at,edited_at,kind')
      .eq('product_id', r.product_id).eq('kind', 'sampling')
      .order('created_at', { ascending:false }).order('id', { ascending:false });
    if (prod.error) throw new Error(prod.error.message);
  }
  return { card: shapeNotes(own.data, 'source', 'manual', staff),
           general: shapeNotes(prod.data, 'kind', 'sampling', staff),
           rounds: shapeNotes(onRounds.data, 'source', 'round', staff) };
};

// ── THE PRINTED CARD ────────────────────────────────────────────────────────
// The house print model, and the parts of it that earn their place on a card:
// @page margin 0 so Chrome prints no URL or date of its own, the sheet's own
// padding standing in for the page margin, the logo travelling as bytes, and
// esc() on every interpolated value -- a client named with an ampersand printed
// &amp; on the document this pattern replaced.
//
// NO JS PAGINATOR, on Riley word. buildSODoc measures blocks into fixed-height
// sheets because it has a line-item table that must split with its header
// repeated on each continuation. A card has one unbounded section -- the notes --
// and letting it flow the way the browser would is the honest simple thing. What
// that costs is the "Page n of m" stamp, which cannot be written without the
// measuring pass it pays for.
// ── THE PRINT KIT, SHARED BY BOTH FILES ─────────────────────────────────────
// The records file and the working file are two documents on one letterhead, so
// the pieces they share are written once here rather than twice inside each
// builder. Moved out of buildCardDoc verbatim -- the records PDF is the same
// markup it always was.
export const docEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
export const DOC_LBL = 'font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;';
export const docCell = (l, v) => '<div style="border-right:2px solid #6b7280;border-bottom:2px solid #6b7280;padding:11px 13px;">'
  +'<div style="'+DOC_LBL+'">'+docEsc(l)+'</div>'
  +'<div style="font-size:13.5px;color:#111827;margin-top:5px;line-height:1.3;">'+docEsc(v)+'</div></div>';
// link, when given, makes the whole value a link -- the tracking rows.
export const docKv = (l, v, link) => '<div style="display:flex;gap:14px;padding:7px 0;border-top:1px solid #e5e7eb;">'
  +'<div style="'+DOC_LBL+'flex:0 0 164px;padding-top:2px;">'+docEsc(l)+'</div>'
  +'<div style="font-size:13.5px;color:#111827;line-height:1.45;">'
    +(link ? '<a href="'+docEsc(link)+'" style="color:#0563c1;">'+docEsc(v)+'</a>' : docEsc(v))+'</div></div>';
// pre-wrap rather than turning newlines into <br>. The note is stored with its
// own line breaks and the screen renders it the same way, so the paper matches
// what the person typed.
export const docNoteBlock = (heading, list, blank) => '<div style="margin-top:26px;">'
  +'<div style="'+DOC_LBL+'margin-bottom:8px;">'+docEsc(heading)+'</div>'
  +(list.length
    ? list.map(n => '<div style="border-top:1px solid #e5e7eb;padding:9px 0;">'
        +'<div style="font-size:13.5px;color:#111827;line-height:1.55;white-space:pre-wrap;">'+docEsc(n.text)+'</div>'
        +'<div class="mono" style="font-size:10.5px;color:#6b7280;margin-top:5px;">'
          +docEsc(n.author)+' · '+docEsc(stampText(n.date))
          +(n.edited ? ' · edited' : '')
          +(n.kind ? ' · ' + docEsc(n.kind) : '')
        +'</div></div>').join('')
    : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">'+docEsc(blank)+'</div>')
  +'</div>';
// The logo, the kicker ("PLM card") and the SKU across the top, the rule, then
// the product and the client -- the same head on both files.
export const docLetterhead = (logo, kicker, r) => {
  const p = r.products || {};
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:28px;">'
      +'<div style="min-width:0;">'
        +(logo
          ? '<img src="'+logo+'" alt="King Universal" style="height:46px;width:auto;display:block;">'
          : '<div style="font-size:21px;font-weight:700;letter-spacing:-.015em;color:#0c1322;line-height:1.1;">King Universal Inc.</div>')
      +'</div>'
      +'<div style="text-align:right;white-space:nowrap;">'
        +'<div style="font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0c1322;line-height:1.1;">'+docEsc(kicker)+'</div>'
        +'<div class="mono" style="font-size:15px;color:#374151;margin-top:8px;">'+docEsc(p.sku || '—')+'</div>'
      +'</div>'
    +'</div>'
    +'<div style="height:2px;background:#0c1322;margin-top:18px;"></div>'
    +'<div style="margin-top:26px;">'
      +'<div style="font-size:22px;font-weight:600;letter-spacing:-.015em;color:#111827;line-height:1.25;">'+docEsc(p.name || '—')+'</div>'
      +'<div style="font-size:14px;color:#4b5563;margin-top:5px;">'+docEsc((r.client || {}).name || '—')+'</div>'
    +'</div>';
};
// Three across. Empty values already carry their own words -- 'Not recorded'
// rather than a blank, so a gap reads as a fact about the card instead of as a
// rendering fault. Padded to a full row of three, so the grid's right and
// bottom rules close rather than leaving a notch.
export const docGrid = pairs => '<div style="margin-top:28px;border-top:2px solid #6b7280;border-left:2px solid #6b7280;display:grid;grid-template-columns:repeat(3,1fr);">'
    +pairs.map(([l, v]) => docCell(l, v)).join('')
    +Array.from({ length: (3 - pairs.length % 3) % 3 }, () => docCell('', '')).join('')
  +'</div>';
export const docFooter = label => '<div style="margin-top:34px;padding-top:9px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:9.5px;color:#6b7280;">'
    +'<span>King Universal Inc. · '+docEsc(label)+' · internal</span>'
    +'<span>Generated '+docEsc(stampText(new Date().toISOString()))+'</span>'
  +'</div>';
export const docShell = (title, flow) => '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
+'<meta name="viewport" content="width=device-width,initial-scale=1">'
+'<title>'+docEsc(title)+'</title>'
+'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
+'<style>'
+'*{box-sizing:border-box;margin:0;padding:0;}'
+"html,body{font-family:'Inter',system-ui,sans-serif;color:#111827;background:#eef1f5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
+".mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;}"
// 816px = 8.5in at 96dpi, and the 48px padding IS the page margin, because
// @page has none. min-height rather than height: the notes decide the length.
+'.sheet{width:816px;min-height:1056px;background:#fff;margin:0 auto;padding:48px;}'
+'@media screen{.sheet{box-shadow:0 1px 5px rgba(15,23,42,.16);margin:20px auto;}}'
+'@media print{@page{size:letter;margin:0;}html,body{background:#fff;}'
  +'.sheet{box-shadow:none;margin:0;min-height:0;}}'
+'</style></head><body><div class="sheet">'+flow+'</div>'
// Fonts first. Inter arriving after the print dialog opens would paper over
// metrics the preview was built from.
+'<script>(function(){function go(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},150);}'
+'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go).catch(go);}else{window.onload=go;}})();<\/script>'
+'</body></html>';

// ── THE RECORDS FILE, exported from the Card tab ────────────────────────────
export const buildCardDoc = ({ r, card, general, logo }) => {
  const p = r.products || {};
  const g = cardGroups(r);
  const flow = docLetterhead(logo, 'Sample card', r)
    +docGrid(g.head)
    +'<div style="margin-top:30px;">'
      +'<div style="'+DOC_LBL+'margin-bottom:2px;">What the system knows</div>'
      +'<div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:6px;">'
        +'Reported from the records. None of it moved this card.</div>'
      +g.knows.map(([l, v, link]) => docKv(l, v, link)).join('')
    +'</div>'
    // The sample log went with the card's log UI; the rows are still in the table.
    +docNoteBlock('Card notes', card, 'No notes.')
    +docNoteBlock('General notes', general,
               r.product_id ? 'No notes.' : 'No product linked, so there are no product notes.')
    +docFooter('Sample card');
  return docShell('Sample card — '+(p.sku || p.name || 'Program'), flow);
};

// ── THE WORKING FILE, exported from the first (stage-named) tab ─────────────
// What that tab holds and nothing from the records view, which has its own
// file: who and where the card is, the sample rounds, the checklist grouped by
// stage in ladder order, and the card's own notes.
//
// DONE CARRIES ITS DATE when there is one. program_tasks.done_at is written when
// a task is ticked and cleared when it is unticked, so a Yes with no date is a
// task ticked before anything recorded when.
export const workingHead = (r, factoryName) => {
  const p = r.products || {};
  return [
    ['SKU', p.sku || '—'],
    ['Product', p.name || '—'],
    ['Client', (r.client || {}).name || '—'],
    ['Factory', factoryName || 'Not recorded'],
    ['Stage', stageLabel(r.stage)],
    ['Owner', r.ownerName || 'Unowned'],
    ['Days in this stage', (r.days === null || r.days === undefined) ? '—'
      : String(r.days) + (r.stale ? ' · stale past ' + STALE_DAYS : '')],
    ['Created', [r.createdByName ? 'by ' + r.createdByName : null, r.created_at ? fmt(r.created_at) : null]
                  .filter(Boolean).join(' · ') || 'Not recorded'],
    ['Last edited', r.edited
      ? [r.lastTouchBy ? 'by ' + r.lastTouchBy : null, fmt(r.updated_at)].filter(Boolean).join(' · ')
      : 'Not edited since it was created'],
  ];
};
// The latest round in one line, for the grid and the Working sheet; every
// round follows in its own table (workingRounds).
export const workingStrip = r => [
  ['Latest sample round', sampleStripText(r) || 'None saved'],
];
// EVERY SAVED ROUND, round 1 first, so the file reads as the history it is --
// the card lists newest first because that is what somebody working it needs.
// SAMPLE TYPE, NOT MASTER SAMPLE (script 97), and no Stage or Comment column:
// every round is a Sampling round now, and Comment folded into the round notes,
// which the files list under their round (roundNoteGroups).
export const workingRounds = (r, staff) => [...(r.rounds || [])].sort((a, b) => a.round - b.round).map(x => ({
  id: x.id,
  round: String(x.round),
  type: x.sample_type ? sampleTypeLabel(x.sample_type) : '',
  sent: x.sent_date || null,
  due: x.due_back || null,
  sentBy: sentByLabel(x.sent_by),
  carrier: x.carrier || '',
  tracking: x.tracking_number || '',
  trackingUrl: trackingUrl(x.carrier, x.tracking_number, r.carriers),
  // Package 2 (script 113), its link from its own carrier.
  sentBy2: sentByLabel(x.sent_by_2),
  carrier2: x.carrier_2 || '',
  tracking2: x.tracking_number_2 || '',
  trackingUrl2: x.tracking_number_2 ? trackingUrl(x.carrier_2, x.tracking_number_2, r.carriers) : null,
  savedBy: staffName(staff, x.created_by) || 'unknown',
  savedAt: x.created_at || null,
  editedBy: x.updated_at ? (staffName(staff, x.updated_by) || 'unknown') : '',
  editedAt: x.updated_at || null,
}));
// ── A LINK IN A WORKBOOK ────────────────────────────────────────────────────
// ExcelJS writes { text, hyperlink } as a real hyperlink cell. linkCell makes
// one only when there is a url, so a number nobody can place stays a plain
// string. styleLinks colours every hyperlink cell on a sheet the way Excel does,
// since ExcelJS leaves them unstyled. cellText is the CSV side -- the text.
export const LINK_FONT = { color: { argb: 'FF0563C1' }, underline: true };
export const linkCell = (text, url) => (url && text ? { text, hyperlink: url } : text);
export const cellText = v => (v && typeof v === 'object' && 'text' in v ? v.text : v);
export const styleLinks = ws => ws.eachRow(row => row.eachCell(c => {
  if (c.value && typeof c.value === 'object' && c.value.hyperlink) c.font = LINK_FONT;
}));
export const ROUND_COLS = ['Round', 'Sample type', 'Sent', 'Due back', 'Sent by', 'Carrier', 'Tracking #',
                    'Sent by 2', 'Carrier 2', 'Tracking # 2', 'Saved by', 'Saved at', 'Edited by', 'Edited at']
  .filter(h => DUE_BACK_ON || h !== 'Due back');
export const ROUND_NOTE_COLS = ['Round', 'Author', 'Date', 'Edited', 'Note'];
// Every task on a stage that is on the board, in ladder order, stages with no
// tasks left out. Tasks left on a hidden stage are not in the files, as they
// are not on the card (VISIBLE_STAGES). Within a stage the order the board
// loaded them in -- sort_order, then created_at.
export const workingTasks = (r, staff) => VISIBLE_STAGES.map(([k, l]) => ({
  label: l,
  tasks: (r.tasks || []).filter(t => t.stage === k).map(t => {
    const who = t.owner_id ? (staff.find(s => s.id === t.owner_id) || {}) : null;
    return {
      task: t.task || '',
      done: t.done ? 'Yes' : 'No',
      doneAt: t.done && t.done_at ? t.done_at : null,
      owner: who ? (who.full_name || who.email || 'Unknown') : 'Unassigned',
      due: t.due_date || null,
      blocker: t.blocker && t.blocker !== 'none' ? (BLOCKERS[t.blocker] || {}).label || t.blocker : '',
    };
  }),
})).filter(g => g.tasks.length);

// ALL card notes, grouped the way the card labels them: by the stage they were
// written in, ladder order, then the notes kept from deleted rounds, Round N in
// number order, then notes with no stage. Live round notes are not Card Notes
// and are not in this list (fetchCardNotes); they are in roundNoteGroups.
export const workingNoteGroups = card => {
  const fromRound = card.filter(n => n.roundNo);
  const rest = card.filter(n => !n.roundNo);
  const groups = MANUAL_STAGES.map(([k, l]) => ({ label: l, list: rest.filter(n => n.stage === k) }));
  [...new Set(fromRound.map(n => n.roundNo))].sort((a, b) => a - b).forEach(no =>
    groups.push({ label: 'Round ' + no + ' (round deleted)', list: fromRound.filter(n => n.roundNo === no) }));
  groups.push({ label: 'No stage', list: rest.filter(n => !n.stage || STAGE_LABEL[n.stage] === undefined) });
  return groups.filter(g => g.list.length);
};
// THE NOTES ON EACH LIVE ROUND, round 1 first as the rounds table reads, one
// group per round that has any. roundNotes come from fetchCardNotes (rounds) or
// the board fetch, shaped by shapeNotes, each carrying its roundId.
export const roundNoteGroups = (r, roundNotes) => [...(r.rounds || [])]
  .sort((a, b) => a.round - b.round)
  .map(x => ({ round: x.round, label: 'Round ' + x.round, list: (roundNotes || []).filter(n => n.roundId === x.id) }))
  .filter(g => g.list.length);

// ── THE BOARD AS A FILE ─────────────────────────────────────────────────────
// Every card on the board in one workbook or one CSV, built from the SAME
// pieces the card files use -- workingRounds, workingTasks, workingNoteGroups,
// cardGroups, sampleStripText, healthOf, blockerOf -- so a card reads the same
// in the board file as in its own. Seven tables, each keyed by SKU and client so
// any row says which card it belongs to:
//   Board          one row per card, the tile and its header facts
//   Rounds         one row per saved sample round
//   Round notes    one row per note on a live round
//   Checklist      one row per task on a stage that is on the board
//   Card notes     one row per card note
//   Records        one row per card, a column per What the system knows line
//   General notes  one row per product note, with the clients whose cards show it
// Separate sheets rather than tables stacked on one, because Excel sorts,
// filters and freezes a header per sheet, and a stacked sheet can only do that
// for the first table on it.
//
// Each column is [header, kind]. kind decides how a value is written: 'date'
// is a plain yyyy-mm-dd, 'stamp' a timestamp, 'num' a number, anything else
// text. The workbook turns dates into real dates; the CSV writes them as text,
// the same split the card files make.
export const BOARD_STAGE_ORDER = Object.fromEntries(MANUAL_STAGES.map(([k], i) => [k, i]));
export const buildBoardTables = (cards, staff, cardNotes, generalNotes, roundNotes = []) => {
  // Ladder order, then SKU, so the file reads down the board left to right.
  const list = [...cards].sort((a, b) => {
    const sa = a.stage in BOARD_STAGE_ORDER ? BOARD_STAGE_ORDER[a.stage] : 99;
    const sb = b.stage in BOARD_STAGE_ORDER ? BOARD_STAGE_ORDER[b.stage] : 99;
    if (sa !== sb) return sa - sb;
    return String((a.products || {}).sku || '').localeCompare(String((b.products || {}).sku || ''));
  });
  const skuOf = r => (r.products || {}).sku || '';
  const clientOf = r => (r.client || {}).name || '';
  const key = r => [skuOf(r), clientOf(r)];

  const board = {
    name: 'Board',
    // Blocker and Open tasks are columns only while the checklist is on; the
    // two lists below are filtered together so a row and its header agree.
    cols: [['SKU'], ['Product'], ['Client'], ['Factory'], ['Stage'], ['Days in stage', 'num'], ['Owner'],
           ['Health'], ['Blocker'], ['Sample overdue'], ['Open tasks', 'num'], ['Latest round'], ['Testing lab'],
           ['Created by'], ['Created at', 'stamp'], ['Last edited by'], ['Last edited at', 'stamp'], ['Removed']]
      .filter(([h]) => (CHECKLIST_ON || (h !== 'Blocker' && h !== 'Open tasks'))
                    && (DUE_BACK_ON || h !== 'Sample overdue')),
    rows: list.map(r => {
      const blk = blockerOf(r);
      return [
        skuOf(r), (r.products || {}).name || '', clientOf(r), r.factoryName || '',
        stageLabel(r.stage), (r.days === null || r.days === undefined) ? null : r.days,
        r.ownerName || 'Unowned', HEALTH[healthOf(r, r.tasks)].label,
        ...(CHECKLIST_ON ? [blk ? BLOCKERS[blk].label : ''] : []),
        ...(DUE_BACK_ON ? [sampleOverdue(r) ? 'Yes' : 'No'] : []),
        // The tile count -- open tasks in the stage the card is in.
        ...(CHECKLIST_ON ? [openTasks(r).filter(t => t.stage === r.stage).length] : []),
        sampleStripText(r) || '', r.testing_lab || '',
        r.createdByName || '', r.created_at || null,
        r.edited ? (r.lastTouchBy || '') : '', r.edited ? (r.updated_at || null) : null,
        r.archived ? 'Yes' : 'No',
      ];
    }),
  };

  const rounds = {
    name: 'Rounds',
    cols: [['SKU'], ['Client'], ['Round', 'num'], ['Sample type'], ['Sent', 'date'], ['Due back', 'date'],
           ['Sent by'], ['Carrier'], ['Tracking #'], ['Sent by 2'], ['Carrier 2'], ['Tracking # 2'], ['Saved by'], ['Saved at', 'stamp'], ['Edited by'], ['Edited at', 'stamp']]
      .filter(([h]) => DUE_BACK_ON || h !== 'Due back'),
    rows: list.flatMap(r => workingRounds(r, staff).map(x => [
      ...key(r), Number(x.round), x.type, x.sent, ...(DUE_BACK_ON ? [x.due] : []), x.sentBy, x.carrier, linkCell(x.tracking, x.trackingUrl),
      x.sentBy2, x.carrier2, linkCell(x.tracking2, x.trackingUrl2),
      x.savedBy, x.savedAt, x.editedBy, x.editedAt,
    ])),
  };

  const roundNoteTable = {
    name: 'Round notes',
    cols: [['SKU'], ['Client'], ['Round', 'num'], ['Author'], ['Date', 'stamp'], ['Edited'], ['Note']],
    rows: list.flatMap(r => roundNoteGroups(r, roundNotes.filter(n => n.programId === r.id)).flatMap(g => g.list.map(n => [
      ...key(r), g.round, n.author, n.date, n.edited ? 'Yes' : '', n.text,
    ]))),
  };

  const checklist = {
    name: 'Checklist',
    cols: [['SKU'], ['Client'], ['Stage'], ['Task'], ['Done'], ['Done at', 'stamp'], ['Owner'], ['Due', 'date'], ['Blocker']],
    rows: list.flatMap(r => workingTasks(r, staff).flatMap(g => g.tasks.map(t => [
      ...key(r), g.label, t.task, t.done, t.doneAt, t.owner, t.due, t.blocker,
    ]))),
  };

  const notesOn = r => cardNotes.filter(n => n.programId === r.id);
  const cardNoteTable = {
    name: 'Card notes',
    cols: [['SKU'], ['Client'], ['Stage'], ['Kind'], ['Author'], ['Date', 'stamp'], ['Edited'], ['Note']],
    rows: list.flatMap(r => workingNoteGroups(notesOn(r)).flatMap(g => g.list.map(n => [
      ...key(r), g.label, n.kind, n.author, n.date, n.edited ? 'Yes' : '', n.text,
    ]))),
  };

  // The labels come from cardGroups itself, so a line added to the card's
  // records reaches this sheet as a new column without anybody editing it.
  const knowsLabels = list.length ? cardGroups(list[0]).knows.map(([l]) => l) : [];
  const records = {
    name: 'Records',
    cols: [['SKU'], ['Product'], ['Client'], ...knowsLabels.map(l => [l])],
    rows: list.map(r => {
      const byLabel = new Map(cardGroups(r).knows.map(([l, v, link]) => [l, linkCell(v, link)]));
      return [skuOf(r), (r.products || {}).name || '', clientOf(r), ...knowsLabels.map(l => byLabel.get(l) || '')];
    }),
  };

  // A product note belongs to the PRODUCT, shared by every card for that SKU,
  // so it is listed once with the clients whose cards show it rather than once
  // per card.
  const productRow = new Map();
  list.forEach(r => {
    if (!r.product_id) return;
    const cur = productRow.get(r.product_id) || { sku: skuOf(r), name: (r.products || {}).name || '', clients: [] };
    if (clientOf(r) && !cur.clients.includes(clientOf(r))) cur.clients.push(clientOf(r));
    productRow.set(r.product_id, cur);
  });
  const general = {
    name: 'General notes',
    cols: [['SKU'], ['Product'], ['Clients'], ['Kind'], ['Author'], ['Date', 'stamp'], ['Edited'], ['Note']],
    rows: generalNotes.filter(n => productRow.has(n.productId)).map(n => {
      const pr = productRow.get(n.productId);
      return [pr.sku, pr.name, pr.clients.join(', '), n.kind, n.author, n.date, n.edited ? 'Yes' : '', n.text];
    }),
  };

  return [board, rounds, roundNoteTable, ...(CHECKLIST_ON ? [checklist] : []), cardNoteTable, records, general];
};
export const boardFileBase = withRemoved => 'samples-board-' + (withRemoved ? 'with-removed-' : '') + stampToday();

export const buildWorkingDoc = ({ r, factoryName, staff, card, roundNotes = [], logo }) => {
  const p = r.products || {};
  // SKU, product and client are the letterhead; the grid carries the rest.
  const grid = workingHead(r, factoryName).filter(([l]) => !['SKU', 'Product', 'Client'].includes(l));
  const groups = workingTasks(r, staff);
  const th = 'text-align:left;padding:6px 8px 6px 0;'+DOC_LBL;
  const td = 'padding:7px 8px 7px 0;border-top:1px solid #e5e7eb;font-size:12.5px;color:#111827;vertical-align:top;';
  const table = g => '<div style="margin-top:14px;">'
    +'<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">'+docEsc(g.label)+'</div>'
    +'<table style="width:100%;border-collapse:collapse;">'
      +'<tr><th style="'+th+'width:40%;">Task</th><th style="'+th+'">Done</th><th style="'+th+'">Owner</th>'
      +'<th style="'+th+'">Due</th><th style="'+th+'">Blocker</th></tr>'
      +g.tasks.map(t => '<tr>'
        +'<td style="'+td+'">'+docEsc(t.task)+'</td>'
        +'<td style="'+td+'">'+docEsc(t.done + (t.doneAt ? ' · ' + stampText(t.doneAt) : ''))+'</td>'
        +'<td style="'+td+'">'+docEsc(t.owner)+'</td>'
        +'<td style="'+td+'">'+docEsc(t.due ? fmt(t.due) : '')+'</td>'
        +'<td style="'+td+'">'+docEsc(t.blocker)+'</td>'
      +'</tr>').join('')
    +'</table></div>';
  const rounds = workingRounds(r, staff);
  const flow = docLetterhead(logo, 'Sample card · working', r)
    +docGrid(grid)
    +'<div style="margin-top:30px;">'
      +'<div style="'+DOC_LBL+'margin-bottom:6px;">Sample rounds</div>'
      +(rounds.length
        ? '<table style="width:100%;border-collapse:collapse;">'
          +'<tr><th style="'+th+'">Round</th><th style="'+th+'">Sample type</th><th style="'+th+'">Sent</th>'
          +(DUE_BACK_ON ? '<th style="'+th+'">Due back</th>' : '')
          +'<th style="'+th+'">Sent by</th><th style="'+th+'">Carrier</th><th style="'+th+'">Tracking #</th>'
          +'<th style="'+th+'">Sent by 2</th><th style="'+th+'">Carrier 2</th><th style="'+th+'">Tracking # 2</th>'
          +'<th style="'+th+'">Saved</th></tr>'
          +rounds.map(x => '<tr>'
            +'<td style="'+td+'">'+docEsc(x.round)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.type)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.sent ? fmt(x.sent) : '')+'</td>'
            +(DUE_BACK_ON ? '<td style="'+td+'">'+docEsc(x.due ? fmt(x.due) : '')+'</td>' : '')
            +'<td style="'+td+'">'+docEsc(x.sentBy)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.carrier)+'</td>'
            +'<td style="'+td+'">'+(x.trackingUrl
              ? '<a href="'+docEsc(x.trackingUrl)+'" style="color:#0563c1;">'+docEsc(x.tracking)+'</a>'
              : docEsc(x.tracking))+'</td>'
            +'<td style="'+td+'">'+docEsc(x.sentBy2)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.carrier2)+'</td>'
            +'<td style="'+td+'">'+(x.trackingUrl2
              ? '<a href="'+docEsc(x.trackingUrl2)+'" style="color:#0563c1;">'+docEsc(x.tracking2)+'</a>'
              : docEsc(x.tracking2))+'</td>'
            +'<td style="'+td+'">'+docEsc(x.savedBy + ' · ' + stampText(x.savedAt))
              +(x.editedAt ? '<br>'+docEsc('edited ' + x.editedBy + ' · ' + stampText(x.editedAt)) : '')+'</td>'
          +'</tr>').join('')
          +'</table>'
        : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">No rounds saved.</div>')
    +'</div>'
    // Each round's own notes, under the rounds table, as the card shows them.
    +roundNoteGroups(r, roundNotes).map(g => docNoteBlock(g.label + ' notes', g.list, '')).join('')
    +(CHECKLIST_ON
      ? '<div style="margin-top:26px;">'
        +'<div style="'+DOC_LBL+'margin-bottom:2px;">Checklist</div>'
        +(groups.length ? groups.map(table).join('')
          : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">No tasks.</div>')
        +'</div>'
      : '')
    +(workingNoteGroups(card).length
      ? workingNoteGroups(card).map(g => docNoteBlock('Card notes · ' + g.label, g.list, '')).join('')
      : docNoteBlock('Card notes', [], 'No notes.'))
    +docFooter('Sample card · working');
  return docShell('Sample card · working — '+(p.sku || p.name || 'Program'), flow);
};


// ── THE CARD'S THREE FILES ──────────────────────────────────────────────────
// ProgramCard's Export menu, as functions of the card and its notes, so the
// iPad view builds the same files. kind is 'records' (the Card tab) or
// 'working' (the first tab); notes is fetchCardNotes(r, staff), read afresh
// for each file. The XLSX and the CSV come back as { blob, name } for the
// caller to download or share.
export const cardLogo = async () => {
  // THE LOGO HAS TO TRAVEL AS BYTES. The document is written into an
  // about:blank window, so a relative src resolves against about:blank and
  // fetches nothing. A failed fetch degrades to the company name in type,
  // which is why buildCardDoc carries that fallback rather than assuming.
  let logo = '';
  try {
    const res = await fetch('/logo.png');
    if (res.ok) {
      const blob = await res.blob();
      logo = await new Promise((ok, no)=>{
        const fr = new FileReader();
        fr.onload = ()=>ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob);
      });
    }
  } catch (e) {}
  return logo;
};

export const cardFileHtml = ({ kind, r, factoryName, staff, notes, logo }) => kind === 'records'
  ? buildCardDoc({ r, card: notes.card, general: notes.general, logo })
  : buildWorkingDoc({ r, factoryName, staff, card: notes.card, roundNotes: notes.rounds, logo });

export const cardFileXlsx = async ({ kind, r, factoryName, staff, notes, ExcelJS }) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'VESSL'; wb.created = new Date();

  // THE WORKING WORKBOOK -- five sheets: the card and its latest round one
  // field per row, every sample round, every round note, the checklist one
  // task per row, and the card notes.
  if (kind === 'working') {
    const ws = wb.addWorksheet('Working');
    ws.addRow(['Field', 'Value']);
    [...workingHead(r, factoryName), ...workingStrip(r)].forEach(([l, v]) => ws.addRow([l, v]));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state:'frozen', ySplit:1 }];
    ws.getColumn(1).width = 24;
    ws.getColumn(2).width = 62;

    const rs = wb.addWorksheet('Sample rounds');
    rs.addRow(ROUND_COLS);
    workingRounds(r, staff).forEach(x => rs.addRow([Number(x.round), x.type, excelDate(x.sent),
      ...(DUE_BACK_ON ? [excelDate(x.due)] : []),
      x.sentBy, x.carrier, linkCell(x.tracking, x.trackingUrl),
      x.sentBy2, x.carrier2, linkCell(x.tracking2, x.trackingUrl2), x.savedBy, excelDate(x.savedAt), x.editedBy,
      excelDate(x.editedAt)]));
    styleLinks(rs);
    rs.getRow(1).font = { bold: true };
    rs.views = [{ state:'frozen', ySplit:1 }];
    // Column positions read from the header list, so they hold with Due back
    // in or out.
    ['Sent', 'Due back'].forEach(h => { const c = ROUND_COLS.indexOf(h) + 1; if (c) rs.getColumn(c).numFmt = 'yyyy-mm-dd'; });
    ['Saved at', 'Edited at'].forEach(h => { const c = ROUND_COLS.indexOf(h) + 1; if (c) rs.getColumn(c).numFmt = 'yyyy-mm-dd hh:mm'; });
    const RW = { 'Round': 8, 'Sample type': 26, 'Sent': 12, 'Due back': 12, 'Sent by': 11, 'Carrier': 14, 'Tracking #': 24,
                 'Sent by 2': 11, 'Carrier 2': 14, 'Tracking # 2': 24,
                 'Saved by': 22, 'Saved at': 17, 'Edited by': 22, 'Edited at': 17 };
    ROUND_COLS.forEach((h, i) => { rs.getColumn(i + 1).width = RW[h] || 14; });

    // Every live round's notes, one row per note, the round named.
    const rn = wb.addWorksheet('Round notes');
    rn.addRow(ROUND_NOTE_COLS);
    roundNoteGroups(r, notes.rounds).forEach(g => g.list.forEach(n =>
      rn.addRow([g.round, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text])));
    rn.getRow(1).font = { bold: true };
    rn.views = [{ state:'frozen', ySplit:1 }];
    rn.getColumn(3).numFmt = 'yyyy-mm-dd hh:mm';
    [8, 30, 19, 9, 90].forEach((w, i) => { rn.getColumn(i + 1).width = w; });
    rn.getColumn(5).alignment = { wrapText: true, vertical: 'top' };

    if (CHECKLIST_ON) {
      const cs = wb.addWorksheet('Checklist');
      cs.addRow(['Stage', 'Task', 'Done', 'Done at', 'Owner', 'Due', 'Blocker']);
      workingTasks(r, staff).forEach(g => g.tasks.forEach(t =>
        cs.addRow([g.label, t.task, t.done, excelDate(t.doneAt), t.owner, excelDate(t.due), t.blocker])));
      cs.getRow(1).font = { bold: true };
      cs.views = [{ state:'frozen', ySplit:1 }];
      cs.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
      cs.getColumn(6).numFmt = 'yyyy-mm-dd';
      [13, 44, 7, 17, 22, 12, 18].forEach((w, i) => { cs.getColumn(i + 1).width = w; });
    }

    const ns = wb.addWorksheet('Card notes');
    ns.addRow(['Stage', 'Kind', 'Author', 'Date', 'Edited', 'Note']);
    workingNoteGroups(notes.card).forEach(g => g.list.forEach(n =>
      ns.addRow([g.label, n.kind, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text])));
    ns.getRow(1).font = { bold: true };
    ns.views = [{ state:'frozen', ySplit:1 }];
    ns.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
    [13, 13, 30, 19, 9, 90].forEach((w, i) => { ns.getColumn(i + 1).width = w; });
    ns.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

    const wbuf = await wb.xlsx.writeBuffer();
    return { blob: new Blob([wbuf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
             name: fileBase(r, 'working') + '.xlsx' };
  }

  // SHEET 1, ONE ROW PER FIELD rather than one row per card with twenty
  // columns. A card is read down, not across, and a single-row sheet would be
  // a spreadsheet nobody can look at without scrolling sideways.
  const ws = wb.addWorksheet('Card');
  ws.addRow(['Field', 'Value']);
  cardFields(r).forEach(([label, value, link]) => {
    const row = ws.addRow([label, link ? { text: value, hyperlink: link } : value]);
    if (link) row.getCell(2).font = LINK_FONT;
  });
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state:'frozen', ySplit:1 }];
  ws.getColumn(1).width = 24;
  ws.getColumn(2).width = 62;

  // SHEET 2, BOTH NOTE SETS IN ONE TABLE with a Set column -- Card for this
  // card's notes, General for the product's, the same words the screen uses.
  // Two sheets would make a reader sorting by date merge them by hand. The
  // sample log sheet that sat between these went with the log.
  const ns = wb.addWorksheet('Notes');
  ns.addRow(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note']);
  const push = (setName, list) => list.forEach(n =>
    // excelDate, so the cell is a real date and sorts as one. The CSV keeps
    // the text stamp -- the same split testing.jsx makes.
    ns.addRow([setName, n.kind, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text]));
  push('Card', notes.card);
  push('General', notes.general);
  ns.getRow(1).font = { bold: true };
  ns.views = [{ state:'frozen', ySplit:1 }];
  ns.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
  [13, 13, 30, 19, 9, 90].forEach((w, i) => { ns.getColumn(i + 1).width = w; });
  ns.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

  const buf = await wb.xlsx.writeBuffer();
  return { blob: new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
           name: fileBase(r, 'records') + '.xlsx' };
};

// No engine and no CDN -- it is string building, so it works offline.
export const cardFileCsv = ({ kind, r, factoryName, staff, notes }) => {
  // EVERY field quoted, not just the ones that need it. A conditional quote
  // has to decide what "needs" means for a note holding a comma, a quote or a
  // newline, and that decision is where CSV writers go wrong.
  const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const p = r.products || {};
  const lines = [];
  // THE WORKING CSV -- five tables, a blank line between them, the CSV
  // answer to the working workbook's five sheets.
  if (kind === 'working') {
    lines.push(cell('# Sample card · working: ' + (p.sku || 'no SKU') + ' — ' + (p.name || '') + ' — ' + ((r.client || {}).name || '')));
    lines.push([cell('Field'), cell('Value')].join(','));
    [...workingHead(r, factoryName), ...workingStrip(r)].forEach(([l, v]) => lines.push([cell(l), cell(v)].join(',')));
    lines.push('');
    lines.push(ROUND_COLS.map(cell).join(','));
    workingRounds(r, staff).forEach(x => lines.push(
      [x.round, x.type, x.sent || '', ...(DUE_BACK_ON ? [x.due || ''] : []), x.sentBy, x.carrier, x.tracking,
       x.sentBy2, x.carrier2, x.tracking2, x.savedBy, stampText(x.savedAt),
       x.editedBy, x.editedAt ? stampText(x.editedAt) : ''].map(cell).join(',')));
    lines.push('');
    lines.push(ROUND_NOTE_COLS.map(cell).join(','));
    roundNoteGroups(r, notes.rounds).forEach(g => g.list.forEach(n => lines.push(
      [g.round, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(','))));
    lines.push('');
    if (CHECKLIST_ON) {
      lines.push(['Stage', 'Task', 'Done', 'Done at', 'Owner', 'Due', 'Blocker'].map(cell).join(','));
      workingTasks(r, staff).forEach(g => g.tasks.forEach(t => lines.push(
        [g.label, t.task, t.done, t.doneAt ? stampText(t.doneAt) : '', t.owner, t.due || '', t.blocker].map(cell).join(','))));
      lines.push('');
    }
    lines.push(['Stage', 'Kind', 'Author', 'Date', 'Edited', 'Note'].map(cell).join(','));
    workingNoteGroups(notes.card).forEach(g => g.list.forEach(n => lines.push(
      [g.label, n.kind, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(','))));
    const wcsv = '﻿' + lines.join('\r\n') + '\r\n';
    return { blob: new Blob([wcsv], { type:'text/csv;charset=utf-8;' }), name: fileBase(r, 'working') + '.csv' };
  }
  lines.push(cell('# Sample card: ' + (p.sku || 'no SKU') + ' — ' + (p.name || '') + ' — ' + ((r.client || {}).name || '')));
  lines.push([cell('Field'), cell('Value')].join(','));
  cardFields(r).forEach(([label, value]) => lines.push([cell(label), cell(value)].join(',')));
  // ONE FILE, TWO TABLES, a blank line between them -- the CSV answer to the
  // workbook's second sheet. The sample log table went with the log.
  lines.push('');
  lines.push(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note'].map(cell).join(','));
  const push = (setName, list) => list.forEach(n => lines.push(
    [setName, n.kind, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(',')));
  push('Card', notes.card);
  push('General', notes.general);
  // CRLF and a BOM, both for Excel: without the BOM it reads the file as ANSI
  // and an accented name arrives mangled.
  const csv = '﻿' + lines.join('\r\n') + '\r\n';
  return { blob: new Blob([csv], { type:'text/csv;charset=utf-8;' }), name: fileBase(r, 'records') + '.csv' };
};
