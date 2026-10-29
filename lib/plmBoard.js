// ── THE SAMPLES BOARD: ITS RULES, ITS LOAD, ITS DERIVATION ──────────────────
// Moved out of app/programs.jsx as they were, so the iPad view's Samples tab
// (app/m) reads a card exactly as the desktop board does: the stages and their
// colours, health, the blocker, overdue and stale rules, the sample types and
// the round in words, the records rows, the board's eleven reads
// (loadBoardData), its two memos (buildBuckets, enrichRows) and the tile's
// facts (tileFacts). The comments came with the code and still speak from
// where it was; "this page" and "the board" are the Samples page.
//
// scripts/plm-snapshot.mjs checks the load, the derived rows and the card
// files against the code before the move.
import { SB } from '@/lib/supabase';
import { fmt, deriveEvents, currentStage, daysSince, CLIENT_OF, sampledFromStage, shipmentsOf } from '@/lib/lifecycle';
import { trackingUrl } from '@/lib/tracking';

// ── THE STAGES, AND THEY ARE SET BY A PERSON ────────────────────────────────
// ONE SAMPLING STAGE, NOT THREE RUNGS. The numbered rungs were built on the
// reasoning that a sample round is the thing that repeats at KUI and one column
// could not say whether a card had been round once or three times. In practice
// nobody used the fourth or the fifth, the board capped at three, and how many
// rounds a product has been through turned out to be something people write in
// the notes rather than record by moving a card. A stage that says sampling is
// happening is the honest shape, and script 65 narrows the CHECK to match.
//
// THIS LIST IS THE BOARD. The tiles, the sections, the drop targets, the stage
// control on the card and the tile accent colours all map over it, so a stage
// added or removed here changes every one of them together, which is why they
// cannot disagree.
//
// The one thing to know if it is ever narrowed again: counts tally whatever
// declared_stage a card holds, but sections render only from this list, so a card
// left on a removed value would count and appear in no section. Script 65 moves
// the rows before it narrows the constraint, for exactly that reason.
//
// Complete is on this list because it is a stage somebody sets -- a sales order
// does NOT move a card, on Riley decision. It lives in its own section at the
// bottom rather than among the pipeline, for the same reason Archived always did.
//
// THE COLOUR IS THE THIRD ELEMENT, on this list rather than in an object keyed
// by the same strings beside it. Two lists keyed alike is exactly how a stage
// gets added to one and forgotten in the other -- the fault the hardcoded
// six-column grid already cost this page once. Everything that destructures
// [k,l] is untouched by a third item, so no reader below had to move.
//
// THE FOURTH ELEMENT IS WHETHER THE STAGE IS ON THE BOARD, on Loren and Matt's
// 1 Oct simplification. Revision folds into Sampling, and Testing, Production and
// Shipped come off the board FOR NOW. They stay on this list -- and in the
// CHECKs -- so their labels, colours, checklist templates and every old row still
// resolve, and bringing one back is flipping its flag. Only the two things a
// person picks a stage from, the board columns and the card pills, read
// VISIBLE_STAGES; everything that has to name a stored value keeps reading this.
export const MANUAL_STAGES = [
  ['quoted',     'Quoting',    '#8E8E93', true],
  ['sampling',   'Sampling',   '#c2790b', true],
  ['revision',   'Revision',   '#7d5bd6', false],
  ['testing',    'Testing',    '#d6492f', false],
  ['production', 'Production', '#3461e0', false],
  ['shipped',    'Shipped',    '#0f9d6e', false],
  // ARCHIVED IS WHERE A CARD GOES AFTER SAMPLING (script 96), a stage and a
  // column like any other -- not Remove from board, which still means the card
  // is off the board for any reason and lives behind Show removed. It is last
  // so the visible flow reads Quoting, Sampling, Archived. A slate grey: done,
  // and quieter than any stage still being worked.
  ['archived',   'Archived',   '#636366', true],
];
// The stage the board stops watching. Health, the Waiting tiles, the blocker
// pill and the stale flag all skip it -- a finished card is not stalled.
export const ARCHIVED = 'archived';
export const VISIBLE_STAGES = MANUAL_STAGES.filter(s => s[3]);
// A card still holding a hidden stage is shown, never dropped from the board --
// see the Hidden stage column in Programs.
export const isHiddenStage = k => !!k && MANUAL_STAGES.some(s => s[0] === k && !s[3]);
// THE STORED VALUE STAYS quoted AND ONLY THE WORD CHANGES, which is the trade
// COMPLETE_LABEL used to make for In Production. Renaming the value would mean a
// script, a CHECK change and a migration for a relabelling.
//
// SHIPPED IS THE END, and it is a column like any other rather than a collapsed
// section beneath the board. A finished program is still a program, and the old
// arrangement -- pipeline above, Complete shut below -- was built when Complete
// meant something a sales order had done. It is a stage somebody sets now.
export const SHIPPED = 'shipped';
// The two stages a sample can be out during. Both the overdue flag and the card
// sample rounds ask this, so it is stated once.
export const SAMPLING_STAGES = ['sampling', 'revision'];
// THE ONE COLOUR TABLE, derived rather than typed a second time. Five of the six
// are globals.css tokens -- warn, hot, info, ok and a grey -- so the board wears
// the palette the rest of the app carries. Revision is the one invented colour,
// a purple, because it sits between amber Sampling and red Testing and needed to
// be distinct from both.
//
// Quoting keeps its grey deliberately, since a stage nobody has acted on yet
// should not be the loudest thing on the page. Production is blue and Shipped is
// green, which is where Purchase Order and In Production were.
export const STAGE_ACCENT = Object.fromEntries(MANUAL_STAGES.map(([k, , c]) => [k, c]));

// No stage set has no colour of its own and must not borrow one. It is the
// absence of an answer, and a pale grey is what says that.
export const accentOf = k => STAGE_ACCENT[k] || '#C7C7CC';

// Drag came back after the Advance button went -- see DRAGGING A TILE in
// Programs. The column under the pointer is marked with an inset ring in the
// stage's own colour rather than a tint, so no second colour table is needed.
//
// tintOf went with the drop targets. It existed only to tint a section while a
// card was over it, and there is nothing to drag any more.

// 21 days, on Riley word. One threshold rather than one per stage: a per-stage
// table would be a tuning conversation nobody has had yet, and a single number
// can be argued with, which is what makes it honest.
export const STALE_DAYS = 21;

// ── HEALTH, THE 11 AUG MODEL ────────────────────────────────────────────────
// Three states, and the left edge of every tile carries one. It answers a
// different question from the stage -- the stage says WHERE a card is, this says
// whether it is moving -- and that is why Riley had both on one tile.
//
// IT TAKES THE CARD'S TASKS, which the board reads in bulk with everything else.
// Two of the four rules below read them -- blocked on us for a week, and a task
// past its due date -- and a card with no checklist simply never trips those two.
//
// THE THRESHOLDS ARE RILEY NUMBERS -- 7 days blocked on us, 14 days in a stage --
// and they are NOT the same as STALE_DAYS, which is 21 and is what the tile pill
// says in words. Two numbers describing nearby things is a real smell; they are
// left as they are because unifying them is a decision about what the board
// should warn at, not a tidy-up, and nobody has made it.
export const HEALTH = {
  // Not a health. An archived card is outside the model, and the board export
  // says so in its Health column rather than calling it On track.
  archived: { label:'Not tracked', color:'#8E8E93' },
  on_track: { label:'On track', color:'#30D158' },
  at_risk:  { label:'At risk',  color:'#FF9F0A' },
  stalled:  { label:'Stalled',  color:'#FF375F' },
};
// ── THE CHECKLIST IS OFF, BEHIND ONE FLAG ───────────────────────────────────
// Loren's feedback, after the 1 Oct simplification: the card has no checklist.
// Nothing is deleted -- every row stays in program_tasks -- and turning this
// back to true brings back, together: the checklist on the card, seeding on
// arrival in a stage, the bulk task read, the tile's N open and blocker pills,
// the three Waiting tiles and their filter, the two task rules in health, and
// the Checklist sections, sheets and columns in the working and board exports.
// Every one of those reads this constant rather than being removed, so they
// cannot come back out of step with each other.
export const CHECKLIST_ON = false;

// ── DUE BACK IS OFF, BEHIND ONE FLAG ────────────────────────────────────────
// Same arrangement as the checklist. program_sample_rounds.due_back stays in the
// table with whatever it holds, unread and unwritten -- a round saved or edited
// now neither sets it nor clears it. With it off: no Due back field on either
// round form, no "due back" on any printed round, no Due back or Sample overdue
// column in the files, and nothing that existed only because of due dates -- the
// overdue rule in health, the overdue marks on a round and a tile, and the
// Overdue samples tile. true brings all of it back together.
export const DUE_BACK_ON = false;
// Whether anything can still make a card Stalled. Both of its rules need one of
// the two flags (an overdue sample; a task waiting on us), so with both off the
// Stalled tile would sit at zero for ever, and it is not drawn.
export const STALLED_POSSIBLE = CHECKLIST_ON || DUE_BACK_ON;

// STAGE_TASKS and seedStageTasks live in lib/programs.js since stage 4. A saved
// purchase order moves a card into Production from page.jsx, and it has to leave
// the same checklist a person moving the card here would -- one list, one rule.
// Who a task is waiting on. The four values are the CHECK script 76 put on
// program_tasks.blocker, and the colours are the 11 Aug ones.
export const BLOCKERS = {
  none:    { label:'No blocker',        dot:'transparent', text:'#8A8A8E' },
  factory: { label:'Waiting · factory', dot:'#0A84FF',     text:'#0A84FF' },
  client:  { label:'Waiting · client',  dot:'#FF9F0A',     text:'#B45309' },
  us:      { label:'Waiting · us',      dot:'#FF375F',     text:'#B91C1C' },
};
// OPEN MEANS OPEN ON THE BOARD. A task left on a stage that is off the board
// (Testing, Production, Shipped -- VISIBLE_STAGES) stays in the table but is not
// waited on: the blocker pill, the Waiting tiles, health and the checklist's
// Open elsewhere lines all skip it, so a card cannot read as stalled over work
// nobody can see.
export const openTasks = r => (CHECKLIST_ON ? (r.tasks || []) : []).filter(t => !t.done && !isHiddenStage(t.stage));
// The blocker a tile names -- us first, because that is the one this office can
// act on, then client, then factory.
export const blockerOf = r => {
  if (r.stage === ARCHIVED) return null;
  const open = openTasks(r);
  return ['us', 'client', 'factory'].find(b => open.some(t => t.blocker === b)) || null;
};
// ── THE LATEST SAMPLE ROUND ─────────────────────────────────────────────────
// Rounds are saved entries on program_sample_rounds, script 80, and the board
// reads them in bulk, highest round first. The latest round is the highest
// number -- not the newest saved -- because a round 1 corrected after round 3
// is still round 1. Its due back is the one the overdue flag, the tile pill and
// the Stalled and Overdue samples tiles read. The four programs columns script
// 77 added are still in the table and nothing reads or writes them.
export const latestRound = r => (r.rounds || [])[0] || null;
export const sampleOverdue = r => {
  if (!DUE_BACK_ON) return false;
  const due = (latestRound(r) || {}).due_back;
  return !!due && daysSince(due) > 0 && SAMPLING_STAGES.includes(r.stage);
};
export const healthOf = (r, tasks = []) => {
  if (r.stage === ARCHIVED) return 'archived';
  // The two task rules below need tasks; with the checklist off there are none
  // to read, so health is the overdue sample and days in stage alone.
  const open = (CHECKLIST_ON ? (tasks || []) : []).filter(t => !t.done && !isHiddenStage(t.stage));
  const days = r.days || 0;
  if (sampleOverdue(r)) return 'stalled';
  if (open.some(t => t.blocker === 'us') && days > 7) return 'stalled';
  if (days > 14) return 'at_risk';
  if (open.some(t => t.due_date && daysSince(t.due_date) > 0)) return 'at_risk';
  return 'on_track';
};

// compliance_status = 'not_required' is a DELIBERATE STATEMENT, and rare: 17 of
// 352 products carry it, against 291 still sitting at 'tbd'. Somebody decided
// testing does not apply to this product, which is a different thing from nobody
// having got to it yet -- and the ladder cannot show the difference by greying a
// rung, because grey already means "not done".
//
// So the rung is REMOVED rather than marked n/a. An n/a rung still occupies a
// step and still reads as an unmet gate; four rungs where one can never be
// reached is a ladder that can never be finished. Three rungs that can all be
// reached is the honest shape. The badge and the note say why it is missing, so
// the absence is never a silent one.
export const testingNotRequired = product => (product || {}).compliance_status === 'not_required';

// ── THE CARD'S FACTORY, FROM QUOTES ALREADY IN HAND ─────────────────────────
// useCardFactory's rule, applied to the board's bulk quote fetch for the board
// export: the latest quote for this product and client by quote date, newest
// first with undated quotes last, then by created_at -- and that quote's factory,
// blank if it names none. The card reads its own copy when it opens; this is the
// same answer without a query per card.
export const factoryOfQuotes = quotes => {
  const sorted = [...(quotes || [])].sort((a, b) => {
    const ad = a.quote_date || '', bd = b.quote_date || '';
    if (ad !== bd) { if (!ad) return 1; if (!bd) return -1; return ad < bd ? 1 : -1; }
    const ac = a.created_at || '', bc = b.created_at || '';
    return ac < bc ? 1 : ac > bc ? -1 : 0;
  });
  return (sorted[0] || {}).factory || '';
};

// ── THE SAMPLE TYPE, ON EVERY ROUND ─────────────────────────────────────────
// program_sample_rounds.sample_type (script 97), replacing the Master sample
// Yes or No, on the 1 Oct simplification. The keys are the CHECK; the labels are
// what the dropdown, the saved line and the files say. master_sample is still in
// the table and nothing reads or writes it.
//
// THE THIRD ELEMENT IS WHETHER THE DROPDOWN OFFERS IT. Testing came off the
// dropdown after Loren's feedback; it stays here so a round already holding it
// still reads Testing, and an Edit of that round still shows it selected rather
// than blanking it. The CHECK still allows it.
export const SAMPLE_TYPES = [
  ['first',              'First Sample',              true],
  ['pre_production',     'Pre-Production Sample',     true],
  ['production',         'Production Sample',         true],
  ['testing_production', 'Testing Production Sample', true],
  ['testing',            'Testing',                   false],
];
// ── THE LIVE LIST (script 102) ──────────────────────────────────────────────
// vessl.sample_types is the list now; SAMPLE_TYPES above is only what the page
// shows if the table cannot be read. The board load writes the rows here, so the
// plain functions that print a round -- roundText, workingRounds, the board file
// -- read the same labels the dropdown does without being handed them. A key
// the list does not know prints as itself rather than as nothing.
let liveSampleTypes = null;
export const setLiveSampleTypes = list => { liveSampleTypes = list; };
export const sampleTypeLabel = k => {
  if (!k) return '';
  const hit = (liveSampleTypes || []).find(t => t.key === k);
  if (hit) return hit.label;
  return (SAMPLE_TYPES.find(([v]) => v === k) || [null, k])[1];
};
// The dropdown: active types, seeded ones in their order, added ones after them
// alphabetically -- plus the value the round already holds when that one is
// retired, so an Edit never blanks it.
export const sampleTypeOptions = (types, current) => {
  const list = types && types.length ? types
    : SAMPLE_TYPES.map(([key, label, active], i) => ({ key, label, active, sort_order: (i + 1) * 10 }));
  return list
    .filter(t => t.active || t.key === current)
    .sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || a.label.localeCompare(b.label));
};
// What a new type is saved as -- trimmed, every run of white space one space --
// so the CHECK on sample_types (single spaces, no tabs) corrects rather than
// refuses somebody who typed two spaces.
export const cleanTypeLabel = v => String(v || '').replace(/\s+/g, ' ').trim();

// ── WHO SENT THE PACKAGE (script 112) ───────────────────────────────────────
// program_sample_rounds.sent_by and sent_by_2 -- us or them, NULL for Not set,
// which is what every round saved before 112 reads. Anything else, and a value
// read before the column exists (undefined), is Not set too.
//
// STORED us IS KUI AND STORED them IS THE LAB -- the testing lab the sample went
// to or came from, NOT the factory and NOT the client. Only the words changed
// (12 Oct); the stored values did not, so scripts 112 and 113 still read us and
// them. The dropdowns and the files say KUI or Lab; the card says Sent by KUI or
// Sent by Lab.
export const SENT_BY_OPTS = [['us', 'KUI'], ['them', 'Lab']];
export const sentByLabel = v => (SENT_BY_OPTS.find(([k]) => k === v) || [null, ''])[1];
export const sentByWords = v => sentByLabel(v) ? 'Sent by ' + sentByLabel(v) : '';

// ── TWO PACKAGES A ROUND (script 113) ───────────────────────────────────────
// Package 1 is sent_by, carrier and tracking_number; package 2 is sent_by_2,
// carrier_2 and tracking_number_2, the same three again. Either may be empty,
// and a column read before its script ran (undefined) is empty too. Every
// reader goes through packagesOf, so the two are always shown in order.
export const packagesOf = x => [
  { sentBy: x.sent_by,   carrier: x.carrier || '',   number: x.tracking_number || '' },
  { sentBy: x.sent_by_2, carrier: x.carrier_2 || '', number: x.tracking_number_2 || '' },
];
// A package names a shipment when it has a carrier or a number; it is worth
// showing when it has that or a Sent by.
export const pkgShips = k => !!(k.carrier || k.number);
export const pkgAny = k => !!sentByWords(k.sentBy) || pkgShips(k);
export const hasShipment = x => packagesOf(x).some(pkgShips);
// "Sent by KUI · FedEx 1Z…" -- the entry line's words for one package. A carrier
// alone reads FedEx, a number alone "tracking 1Z…".
export const pkgText = k => [sentByWords(k.sentBy),
  k.carrier && k.number ? k.carrier + ' ' + k.number : k.carrier || (k.number ? 'tracking ' + k.number : '')]
  .filter(Boolean).join(' · ');

// ── ONE ROUND IN ONE LINE ───────────────────────────────────────────────────
// "Round 2 · Pre-Production Sample · sent Jan 1, 2026 · due back Oct 1, 2026".
// Only the parts somebody set, so a round saved with a due date alone does not
// print three Not sets. The entry on the card, the Sampling row on the Card tab
// and the files all read this.
//
// withTracking adds the shipment -- "· FedEx 1Z…", carrier then number, on the
// entry line only. A carrier alone reads "· FedEx", a number alone "· tracking
// 1Z…" so a bare number is not left unlabelled. The Sampling row and the board's
// Latest round column leave it off, because the Sample tracking row beside them
// already says it. Who sent it comes first -- "· Sent by KUI · FedEx 1Z…" -- and
// a second package follows the first in the same words (script 113).
export const roundText = (x, withTracking = false) => {
  if (!x) return null;
  const parts = ['Round ' + x.round];
  if (x.sample_type) parts.push(sampleTypeLabel(x.sample_type));
  if (x.sent_date) parts.push('sent ' + fmt(x.sent_date));
  if (DUE_BACK_ON && x.due_back) parts.push('due back ' + fmt(x.due_back));
  if (withTracking) packagesOf(x).filter(pkgAny).forEach(k => parts.push(pkgText(k)));
  return parts.join(' · ');
};

// ── TRACKING, ON THE CARD TAB ───────────────────────────────────────────────
// ONE ROW, Sample tracking (1 Oct). It replaced Sampling tracking (round 1) and
// Revision tracking (round 2 up) when the two stages became one. It names the
// shipment on the HIGHEST round that records one -- a carrier or a number -- so
// it is always the newest shipment somebody recorded, and a round saved with
// neither does not blank the one before it. "FedEx · 1Z… · round 3".
// Who sent it leads when that round says -- "Sent by KUI · FedEx · 1Z… · round 3".
// TWO PACKAGES (script 113). A round counts when EITHER package has a carrier or
// a number, and the row then shows every package of that round with anything
// set, in order -- "Sent by Lab · FedEx · 1Z… · Sent by KUI · UPS · 1Z… · round 3".
// A round with only a Sent by names no shipment, so it is not the one picked.
export const pkgCardText = k => [sentByWords(k.sentBy), k.carrier, k.number].filter(Boolean).join(' · ');
// ── THE SOURCE QUOTE (script 104) ───────────────────────────────────────────
// The quote a card was created from, as { code, url } or null. The url is the
// Quotes page's own deep link (?quote=id), which opens the quote's client and
// expands it; it opens in a new tab so the board stays where it is.
export const sourceQuoteOf = r => {
  const q = r.source_quote;
  if (!q || !q.id) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return { code: q.quote_code || 'the quote', url: origin + '/?quote=' + q.id + '#quotes' };
};

// The shipment a Card row names, with its links -- null when the row names none.
// Each package's url comes from its own carrier, and is null when trackingUrl
// cannot tell whose number it is; that number is then plain text everywhere.
// url on the whole is the first package's link that exists -- a workbook cell
// or a PDF value carries one link, and the screen links each number.
export const shipOf = (x, withRound, carriers) => {
  if (!x || !hasShipment(x)) return null;
  const packages = packagesOf(x).filter(pkgAny).map(k => ({
    sentBy: sentByWords(k.sentBy), carrier: k.carrier, number: k.number,
    url: k.number ? trackingUrl(k.carrier, k.number, carriers) : null,
  }));
  return { packages, round: withRound ? x.round : null,
           url: (packages.find(k => k.url) || {}).url || null };
};

export const trackedRound = r => [...(r.rounds || [])].sort((a, b) => b.round - a.round).find(hasShipment) || null;
export const sampleTracking = r => {
  const hit = trackedRound(r);
  return hit ? packagesOf(hit).filter(pkgAny).map(pkgCardText).join(' · ') + ' · round ' + hit.round : 'Not recorded';
};

// Every round column the board reads but the Sent by and second-package ones,
// which load() adds and drops again if the database refuses them (script 112
// or 113 not yet run).
export const ROUND_SELECT = 'id,program_id,stage,round,sample_type,master_sample,sent_date,due_back,carrier,tracking_number,comment,created_by,created_at,updated_by,updated_at';
export const ROUND_SELECT_112 = ',sent_by';
export const ROUND_SELECT_113 = ',sent_by_2,carrier_2,tracking_number_2';
// The client leg of the shuttle (script 114): arrived at KUI, sent on to the
// client, how that leg tracks, when they had it, what they said.
export const ROUND_SELECT_114 = ',received_date,client_sent_date,client_carrier,client_tracking_number,client_received_date,client_feedback,client_feedback_at';

// A date the database will take and a person meant. A date input passes
// through 0002 and 0020 while the year is typed, and one saved mid-typing is a
// sample due back two thousand years ago.
export const okDate = s => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 2000);

// ── ONE FIELD LIST, FOUR READERS ────────────────────────────────────────────
// Until the export existed there was one reader and these values lived inline in
// SystemKnows, which was right for one reader. There are four now -- the card,
// the PDF, the workbook and the CSV -- and four hand-mirrored copies of "what
// does the Shipping row say" is precisely the shape that had the awarded tile
// disagreeing with the awarded filter. So the values move here and every reader
// maps over them.
//
// A TRIPLE, NOT A PAIR. The third element is whether the value is a blank: the
// screen greys those and the files do not, so that has to travel WITH the value
// rather than be recomputed by whoever happens to be rendering it.
export const STAGE_HINT = { quoted:'Quoted', sampling:'Sampling (product stage)', tested:'Tested (report or compliance)' };

export const STAGE_LABEL = Object.fromEntries(MANUAL_STAGES.map(([k, l]) => [k, l]));
export const stageLabel = s => s ? (STAGE_LABEL[s] || s) : 'No stage set';
// The word a select would show for a stored value, read from the same option list
// the select is built from -- so a file and a dropdown cannot offer two different
// words for one value. That is the whole reason lib/products.js holds the lists.
export const optLabel = (opts, v) => (opts.find(o => o[0] === (v || '')) || [null, '—'])[1];

// ── THE LATEST ROUND IN ONE LINE ────────────────────────────────────────────
// The Sampling row on the Card tab, and so the records file: the highest saved
// round, in roundText's words, flagged when it is overdue. null when no round is
// saved, so the row can fall back to the product's own stage rather than print
// an empty line.
export const sampleStripText = r => {
  const x = latestRound(r);
  return x ? roundText(x) + (sampleOverdue(r) ? ' · overdue' : '') : null;
};

export const recordRows = r => {
  const p = r.products || {};
  const ev = r.events || {};
  // The same test currentStage uses, imported rather than repeated -- production
  // implies sampling happened, and that rule lives in lib/lifecycle.js.
  const sampled = sampledFromStage(p);
  const none = 'Nothing recorded';
  // ── THE ORDER ROWS SHOW THE LATEST, NOT THE FIRST ─────────────────────────
  // A product is reordered, so Purchase order, Sales order and Shipping name the
  // MOST RECENT record for this product and client -- its number and date --
  // with a count when there is more than one. They were the earliest date and
  // nothing else, which answered when the relationship started rather than
  // where it stands. Read live from the board fetch every time, so a reorder
  // shows on the next load whether the card is active, moved or removed. The
  // other rows are one-time lifecycle facts and stay as they were.
  const ofN = n => (n > 1 ? ' · latest of ' + n : '');
  const po = r.latestPO, so = r.latestSO, sh = r.latestShip;
  return [
    ['Quoted', ev.quoted ? fmt(ev.quoted.on) + (ev.quoted.n > 1 ? ' · ' + ev.quoted.n + ' quotes' : '') : none, !ev.quoted],
    // THE CARD'S LATEST SAVED SAMPLE ROUND when there is one, because it says
    // which round and when, for this client. The product-stage flag is the
    // fallback and says only that sampling happened -- product_stage records
    // what a product IS, not when it became that. Production counts, because
    // production implies sampling happened.
    ...(() => {
      const strip = sampleStripText(r);
      return [['Sampling', strip ? strip
               : sampled === 'production' ? 'Product marked Production'
               : sampled === 'sample' ? 'Product marked Sample'
               : 'Not recorded', !strip && !sampled]];
    })(),
    // The newest round that records a shipment. The 4th element is the shipment
    // the row names, so the screen can link its number and the workbooks can
    // make the cell a hyperlink. Text readers take the first two and never see it.
    ['Sample tracking', sampleTracking(r), sampleTracking(r) === 'Not recorded',
      shipOf(trackedRound(r), true, r.carriers)],
    ['Purchase order', po ? po.num + (po.on ? ' · ' + fmt(po.on) : '') + ofN(po.n) : none, !po],
    ['Sales order', so ? so.num + (so.on ? ' · ' + fmt(so.on) : '') + ofN(so.n) : none, !so],
    // The quote the card was created from (script 104). The 4th element is the
    // link -- url as for a tracking number, so the workbook makes it a hyperlink.
    ...(() => {
      const sq = sourceQuoteOf(r);
      return [['Source quote', sq ? sq.code : 'None recorded', !sq, sq ? { quote: true, ...sq } : null]];
    })(),
    // AN ETD IS A PLAN AND SAYS SO. Departed is what actually happened and wins
    // whenever it exists; the estimate only speaks when nothing has moved.
    //
    // NO SHIPMENT ON ITS POs, rather than Nothing recorded, when this product
    // has purchase orders and none of them is on a shipment -- a missing link
    // must not read as never shipped. Shipments reach a product through its
    // PO lines, so a PO line not linked to the product is invisible here.
    ['Shipping', sh ? sh.num + (sh.on ? ' · ' + (sh.kind === 'departed' ? 'Departed ' : 'ETD ') + fmt(sh.on) : ' · no date')
                      + ofN(sh.n)
               : po ? 'No shipment on its POs' : none, !sh],
    ['Test report', ev.tested ? fmt(ev.tested.on) : none, !ev.tested],
    // Typed on the first tab while the card is in Testing (script 83).
    ['Testing lab', r.testing_lab || 'Not recorded', !r.testing_lab],
  ];
};
// What the OLD board would have called this card. Its own function rather than a
// seventh entry above, because on screen it sits BELOW two of the edit controls
// and the six above it are contiguous.
export const suggestRow = r => ['Records suggest',
  r.derivedStage ? (STAGE_HINT[r.derivedStage] || r.derivedStage) : 'Nothing yet', !r.derivedStage];

// programs.updated_by holds an ADDRESS, deliberately -- an audit crumb has to stay
// readable after a colleague leaves and their profile goes. This turns it into a
// full name when a profile still matches, and shows the address itself when none
// does, so the card never renders a blank where a person should be.
export const staffName = (staff, email) => {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const hit = (staff || []).find(s => (s.email || '').trim().toLowerCase() === e);
  return (hit && (hit.full_name || hit.email)) || email;
};


// ── THE BOARD'S LOAD ────────────────────────────────────────────────────────
// Programs.load's reads, moved here so the iPad view's Samples tab (app/m)
// reads the board exactly as the desktop does. Returns what load() puts in
// state, and throws on the first refused read, as load() did. It hands the
// sample types to sampleTypeLabel (setLiveSampleTypes) itself, so every
// reader of a round's label gets them.
export async function loadBoardData() {
  const [p, nt, q, poi, soi, tr, st, tk, srTry, pc, stp] = await Promise.all([
    // declared_stage and declared_stage_at are the board now -- the stage a
    // person set, and when they set it. owner_id joins staff_profiles for the
    // name on the card and the owner filter.
    SB.from('programs')
      .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
            + 'created_at,created_by,updated_at,updated_by,testing_lab,source_quote_id,'
            // The quote the card came from (script 104), for "From quote Q-...".
            + 'source_quote:quotes!programs_source_quote_id_fkey(id,quote_code),'
            + 'products(id,sku,name,active,product_stage,compliance_status,kui_ior),client:companies!client_company_id(id,name,kui_ior),'
            + 'owner:staff_profiles!owner_id(id,email,full_name)')
      .order('created_at', { ascending:true }),
    // NOTE COUNTS IN BULK, because the expanded tile shows one. NotesPanel
    // still fetches the notes themselves when a modal opens -- this is the
    // count only, and fetching it per card would be one query per row.
    SB.from('program_notes').select('program_id'),
    // factory for the board export, picked below by useCardFactory's own rule.
    SB.from('quotes').select('product_id,client_company_id,quote_date,created_at,factory').not('product_id','is',null),
    SB.from('purchase_order_items')
      // estimated_departure joins the embed for the Shipping row, which falls
      // back to an ETD when nothing has actually left yet. shipmentsOf returns
      // whole shipment rows, so adding the column here is the entire data
      // change -- no second derivation.
      // id, number and created_at on the PO and the shipment, so the order
      // rows can name the latest one, count distinct ones and break a tie.
      .select('product_id,purchase_orders(id,order_number,created_at,order_date,issued_at,client_company_id,client:companies!client_company_id(name),shipment_pos(shipments(id,shipment_number,created_at,actual_departure,estimated_departure,actual_arrival)))')
      .not('product_id','is',null),
    SB.from('sales_order_items')
      // so_number is the number the app shows for a sales order everywhere;
      // order_number is empty on every SO.
      .select('product_id,sales_orders(id,so_number,created_at,order_date,client_company_id,client:companies!client_company_id(name))')
      .not('product_id','is',null),
    // Product-wide on purpose -- a test report has no client, and testing is
    // not repeated per client. The panel says the same thing on screen.
    SB.from('test_reports').select('product_id,test_date,issue_date,overall_result').not('product_id','is',null),
    // Every colleague -- for the owner select on the card, the checklist
    // owners and the names on the tile and the notes.
    SB.from('staff_profiles').select('id,email,full_name').order('full_name', { nullsFirst:false }),
    // EVERY CHECKLIST, IN BULK. The tile's blocker pill, its health edge and
    // the three waiting tiles all read tasks, so they arrive with the board
    // rather than when a card opens -- the trade the note counts make.
    // Not read at all while the checklist is off -- nothing on the board or
    // in the files would use it.
    // Read whatever CHECKLIST_ON says: the company view's Open questions
    // (14 Oct) are program_tasks, and they show there even while the card's
    // own checklist stays off.
    SB.from('program_tasks')
      .select('id,program_id,stage,task,owner_id,assigned_by,due_date,blocker,done,done_at,sort_order,created_at')
      .order('sort_order').order('created_at'),
    // EVERY SAMPLE ROUND, IN BULK, highest round first per card -- the tile
    // pill and the Stalled and Overdue samples tiles read the latest one's
    // due back, so they have to arrive with the board.
    SB.from('program_sample_rounds')
      .select(ROUND_SELECT + ROUND_SELECT_112 + ROUND_SELECT_113 + ROUND_SELECT_114)
      .order('round', { ascending:false }),
    // THE CARRIERS ARE COMPANIES of type carrier (script 85), with the tracking
    // page pattern on companies.tracking_url. They are managed on Companies ->
    // Carriers; the round form lists every one, there being no retire column.
    SB.from('companies').select('id,name,tracking_url').eq('type', 'carrier').order('name'),
    // THE SAMPLE TYPES (script 102), every one including retired, so a round
    // on a retired type still reads its label.
    SB.from('sample_types').select('key,label,active,sort_order,created_at'),
  ]);
  // BEFORE SCRIPTS 112 AND 113. Naming a column that is not there fails the
  // whole read, so a refusal that names one of them is read again without
  // package 2's columns, then without sent_by too, and what is missing reads
  // Not set. Any other error is reported as before.
  const missingCol = res => !!res.error && /sent_by|carrier_2|tracking_number_2|received_date|client_/.test(res.error.message || '');
  let sr = srTry, live = true, live2 = true;
  // Before script 114: read again without the client leg, which then reads empty.
  if (missingCol(sr)) {
    sr = await SB.from('program_sample_rounds').select(ROUND_SELECT + ROUND_SELECT_112 + ROUND_SELECT_113).order('round', { ascending:false });
  }
  if (missingCol(sr)) {
    live2 = false;
    sr = await SB.from('program_sample_rounds').select(ROUND_SELECT + ROUND_SELECT_112).order('round', { ascending:false });
  }
  if (missingCol(sr)) {
    live = false;
    sr = await SB.from('program_sample_rounds').select(ROUND_SELECT).order('round', { ascending:false });
  }
  const e = [p,nt,q,poi,soi,tr,st,tk,sr,pc,stp].find(r => r.error);
  if (e) throw new Error(e.error.message);
  setLiveSampleTypes(stp.data || []);
  return {
    rows: p.data || [],
    staff: st.data || [],
    tasks: (tk.data || []).reduce((m, t) => { (m[t.program_id] = m[t.program_id] || []).push(t); return m; }, {}),
    rounds: (sr.data || []).reduce((m, x) => { (m[x.program_id] = m[x.program_id] || []).push(x); return m; }, {}),
    carriers: pc.data || [],
    sentByLive: live,
    pkg2Live: live2,
    sampleTypes: stp.data || [],
    noteCounts: (nt.data || []).reduce((m, n) => { m[n.program_id] = (m[n.program_id] || 0) + 1; return m; }, {}),
    ev: { quotes:q.data||[], poItems:poi.data||[], soItems:soi.data||[], reports:tr.data||[] },
  };
}

// ── THE BOARD'S DERIVATION ──────────────────────────────────────────────────
// Programs' buckets and enriched memos, as functions of what loadBoardData
// returns, so the board and the iPad view derive a card one way.
export const buildBuckets = ev => {
  if (!ev) return null;
  const key = (pid, cid) => String(pid) + '|' + String(cid);
  const add = (m, k, v) => { if (!m[k]) m[k] = []; m[k].push(v); };
  const quotes = {}, poItems = {}, soItems = {}, reports = {};
  ev.quotes.forEach(r  => { const c = CLIENT_OF.quote(r);  if (c) add(quotes,  key(r.product_id, c), r); });
  ev.poItems.forEach(r => { const c = CLIENT_OF.poLine(r); if (c) add(poItems, key(r.product_id, c), r); });
  ev.soItems.forEach(r => { const c = CLIENT_OF.soLine(r); if (c) add(soItems, key(r.product_id, c), r); });
  ev.reports.forEach(r => add(reports, String(r.product_id), r));

  // firstOrder went with the derived completion below. What survives here is
  // what SystemKnows reports on a card -- the quotes, order lines and reports
  // for this pair -- fetched once for every program rather than per card.
  return { key, quotes, poItems, soItems, reports };
};

export const enrichRows = (rows, buckets, { staff, noteCounts, tasks, rounds, carriers, sentByLive, pkg2Live, sampleTypes }) => {
  if (!buckets) return [];
  return rows.map(r => {
    const k = buckets.key(r.product_id, r.client_company_id);
    const events = deriveEvents({
      quotes:  buckets.quotes[k]  || [],
      poItems: buckets.poItems[k] || [],
      soItems: buckets.soItems[k] || [],
      reports: buckets.reports[String(r.product_id)] || [],
    });
    // ── THE LATEST ORDER, THE LATEST PO, THE LATEST SHIPMENT ───────────────
    // For the order rows on the card. DISTINCT RECORDS, not lines -- one SO with
    // three sizes is three lines and one order -- so each list is folded by id
    // before it is counted. Newest by its date, and by created_at when two share
    // a date: four of BG03R's five SOs are dated the same day, and the tiebreak
    // is what makes "latest" one answer rather than whichever arrived first.
    const newest = (items, dateOf) => {
      const byId = new Map();
      items.forEach(x => { if (x && x.id && !byId.has(x.id)) byId.set(x.id, x); });
      const list = [...byId.values()];
      if (!list.length) return null;
      const key = x => String(dateOf(x) || '') + ' ' + String(x.created_at || '');
      list.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
      return { top: list[0], n: list.length };
    };
    const soL = newest((buckets.soItems[k] || []).map(i => i.sales_orders), o => o.order_date);
    const poL = newest((buckets.poItems[k] || []).map(i => i.purchase_orders), o => o.issued_at || o.order_date);
    // A real departure outranks an estimate, and either outranks a shipment with
    // no date at all, which falls back to when it was created.
    const shL = newest(shipmentsOf(buckets.poItems[k] || []),
                       x => x.actual_departure || x.estimated_departure || x.created_at);
    // COMPLETION IS NOT DERIVED ANY MORE. This is where the old board worked out
    // whether an order had finished a program -- its own client, or the product
    // ordered for anyone -- and which order to name. All of it is gone, because
    // Complete is a stage somebody sets, on Riley decision. A sales order arriving
    // is reported on the card and moves nothing.
    // ── THE STAGE IS WHAT SOMEBODY SET ──────────────────────────────────
    // declared_stage, and nothing else. currentStage still runs below, but only
    // to fill the read-only block on the card -- what the records happen to say
    // is information, not a mover of cards. A card with no stage is a real
    // state, not a bug, and gets its own column rather than being hidden.
    const stage = r.declared_stage || null;
    // declared_stage_at is stamped by trg_programs_declared_stage_at on every
    // change, so this is genuinely when the card entered the stage it is in --
    // which the derived board could never say for Sampling.
    const since = r.declared_stage_at || null;
    const derivedStage = currentStage(events, r.products);
    // Retired products never sit on the board, however incomplete they are --
    // nobody is going to quote a product that is out of the catalogue.
    const retired = (r.products || {}).active === false;
    const days = daysSince(since);
    return { ...r, events,
             stage, since, days, retired, derivedStage,
             // STALE IS ABOUT THE CARD, NOT THE PRODUCT. It counts days since the
             // stage was set, so a card nobody has moved in three weeks says so
             // whatever the records are doing underneath.
             stale: stage !== SHIPPED && stage !== ARCHIVED && days !== null && days >= STALE_DAYS,
             ownerName: (r.owner || {}).full_name || (r.owner || {}).email || null,
             // LAST TOUCH, which is a different question from the stage date.
             // declared_stage_at answers when the card last MOVED; updated_at
             // answers when anybody last changed anything about it, including an
             // owner swap or a note. Both are on the expanded card because they
             // disagree usefully.
             lastTouchAt: r.updated_at || null,
             lastTouchBy: staffName(staff, r.updated_by),
             // CREATED AND LAST EDITED, for the tile's two foot lines. A card
             // last touched within a minute of being created has never been
             // edited -- createProgram stamps updated_at on insert, a few
             // milliseconds from created_at -- so it shows the Created line only.
             createdByName: staffName(staff, r.created_by),
             edited: !!(r.updated_at && r.created_at
                        && (new Date(r.updated_at) - new Date(r.created_at)) > 60000),
             noteCount: noteCounts[r.id] || 0,
             tasks: tasks[r.id] || [],
             rounds: rounds[r.id] || [],
             // The same array on every card -- the links and the dropdown read it.
             carriers,
             // Whether a round save may write sent_by (script 112), and
             // package 2 (script 113).
             sentByLive, pkg2Live,
             // Likewise the sample types, for the round form's dropdown.
             sampleTypes,
             factoryName: factoryOfQuotes(buckets.quotes[k] || []),
             // The order rows read these three. null when there is none.
             latestSO: soL ? { num: soL.top.so_number || 'Sales order', on: soL.top.order_date || null, n: soL.n } : null,
             latestPO: poL ? { num: poL.top.order_number || 'Purchase order',
                               on: poL.top.issued_at || poL.top.order_date || null, n: poL.n } : null,
             latestShip: shL ? { num: shL.top.shipment_number || 'Shipment',
                                 kind: shL.top.actual_departure ? 'departed' : 'etd',
                                 on: shL.top.actual_departure || shL.top.estimated_departure || null,
                                 n: shL.n } : null };
  });
};

// ── THE TILE'S FACTS ────────────────────────────────────────────────────────
// What the board's tile (Programs' Card) flags, for the tile and the iPad view.
export const tileFacts = r => {
  const p = r.products || {};
  const h = healthOf(r, r.tasks);
  const notReq = testingNotRequired(p);
  const late = sampleOverdue(r);
  // Open tasks in the stage the card is IN -- the count the checklist heading
  // shows. The blocker reads every open task, because a card waiting on the
  // client for something left in Sampling is still waiting.
  const openHere = openTasks(r).filter(t => t.stage === r.stage).length;
  const blk = blockerOf(r);
  return { h, notReq, late, openHere, blk };
};
