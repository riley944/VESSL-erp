// ── THE ONE DERIVATION OF A PRODUCT LIFECYCLE ───────────────────────────────
// Extracted from LifecyclePanel unchanged, so that the Programs list can derive
// the same stages without owning a second copy of the rules.
//
// WHY A MODULE RATHER THAN A SECOND IMPLEMENTATION. The Programs page cannot
// reuse the panel's approach -- the panel runs four queries FOR ONE PRODUCT, and
// a list of 173 programs would be ~692 requests. It has to fetch in bulk and
// group. But "fetch differently" must not become "decide differently", and this
// codebase has paid for that mistake more than once:
//
//   awarded was derived from forwarder_bids.selected in the tiles and from
//   status in the filter, so a bid selected on a losing RFQ read as awarded.
//   The ExcelJS loader was written three times before lib/excel.js.
//   CATALOGUE records that a hand-mirrored copy is exactly what put duty in one
//   margin calculation and not the other -- lib/tierCost.js and
//   lib/bankFields.js both exist to undo it.
//
// So the CALLERS FETCH and this module DECIDES. Nothing here imports Supabase or
// React; it takes rows and returns events. That is also what makes it testable
// without a database.
//
// ── STAGE ORDER IS PRESENTATION, NOT A LADDER ───────────────────────────────
// The array below is the order stages are DISPLAYED in, and nothing more. Phase
// 2A deliberately has no ladder and no "current stage", because the sequence is
// not what it looks like -- at KUI a sales order is the CLIENT buying from us
// and a purchase order is US buying from the factory, so Sold normally precedes
// Ordered even though Ordered is listed first here.
//
// Reaching a stage is therefore a fact on its own, not a position in a queue.
// Anything filtering on these must ask "has reached" rather than "is at", and
// its counts will overlap. See PLM.md.
export const LIFECYCLE_STAGES = [
  ['quoted',    'Quoted'],
  ['tested',    'Tested'],
  ['ordered',   'Ordered'],
  ['sold',      'Sold'],
  ['shipped',   'Shipped'],
  ['delivered', 'Delivered'],
];

export const LIFECYCLE_LABELS = Object.fromEntries(LIFECYCLE_STAGES);

// A date for a person. Returns null for nothing, so callers can decide what an
// absent date should read as rather than being handed a dash.
export const fmt = d => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); }
  catch { return String(d); }
};

// ── FIRST IS THE MILESTONE, LATEST IS THE RECENCY ───────────────────────────
// The headline date on each stage is the FIRST occurrence, because that is when
// the product reached it and it never changes. The latest goes in the subtitle,
// because "quoted in March" and "quoted again last week" are different facts and
// only one of them is a milestone.
//
// ISO date strings sort lexically, so a plain sort is correct and needs no Date
// parsing -- the same reason the timeline reads dates as strings throughout.
const datesOf = (arr, pick) => arr.map(pick).filter(Boolean).sort();
const firstOf = (arr, pick) => datesOf(arr, pick)[0] || null;
const lastOf  = (arr, pick) => { const d = datesOf(arr, pick); return d.length ? d[d.length - 1] : null; };

// Appended only when there is a SECOND event AND it lands on a different day.
// Two quotes raised the same afternoon would otherwise print the headline date
// twice, which reads as a bug rather than as recency.
const withLatest = (text, arr, pick) => {
  if (arr.length < 2) return text;
  const first = firstOf(arr, pick), last = lastOf(arr, pick);
  return (last && last !== first) ? text + ' · latest ' + fmt(last) : text;
};

const uniqSorted = xs => [...new Set(xs.filter(Boolean))].sort();

// The date each source counts as its milestone. Named rather than inlined so the
// bulk caller and the panel cannot disagree about which column speaks.
export const PICK = {
  quote:  q => q.quote_date || q.created_at,
  report: r => r.test_date || r.issue_date,
  poLine: i => (i.purchase_orders || {}).issued_at || (i.purchase_orders || {}).order_date,
  soLine: i => (i.sales_orders || {}).order_date,
};

// ── SCOPING A PRODUCT LIFECYCLE TO ONE CLIENT ───────────────────────────────
// A program is product x client, so its panel must not show another client
// dates. This filters the already-fetched rows rather than narrowing the query.
//
// NO !inner EMBED FILTER, AND THE MEASUREMENT IS WHY. The plan called for
// PostgREST inner-join filters, a pattern this codebase uses nowhere -- and a
// silently ignored embed filter would show one client another client dates,
// which looks exactly like correct output. Measured first instead: the worst
// case for a single product is 2 quotes, 7 purchase order lines, 5 sales order
// lines and 5 test reports. NINETEEN ROWS. The panel already fetches all of
// them, so filtering here is exact, needs no new database behaviour, and cannot
// fail quietly.
//
// TEST REPORTS ARE NOT SCOPED, deliberately. A test report belongs to a PRODUCT
// -- there is no client on the row and testing is not repeated per client. PLM.md
// carries the same assumption for sample approval. So Tested stays product-wide
// even in a scoped panel, and the panel says so rather than letting it look like
// this client commissioned the testing.
export const CLIENT_OF = {
  quote:  q => q.client_company_id || null,
  poLine: i => (i.purchase_orders || {}).client_company_id || null,
  soLine: i => (i.sales_orders || {}).client_company_id || null,
};

export function scopeToClient(ev, clientId) {
  if (!clientId) return ev;
  return {
    quotes:  (ev.quotes  || []).filter(q => CLIENT_OF.quote(q)  === clientId),
    poItems: (ev.poItems || []).filter(i => CLIENT_OF.poLine(i) === clientId),
    soItems: (ev.soItems || []).filter(i => CLIENT_OF.soLine(i) === clientId),
    reports: ev.reports || [],
  };
}

// Every shipment a set of purchase order lines reached, through their orders.
export const shipmentsOf = poItems => poItems.flatMap(
  i => ((i.purchase_orders || {}).shipment_pos || []).map(sp => sp.shipments).filter(Boolean));

// ── THE DERIVATION ──────────────────────────────────────────────────────────
// Takes the four row sets and returns one event per stage, or null where the
// product never reached it. Shape is unchanged from Phase 1 -- { on, n, detail }
// -- because the panel renders it directly.
export function deriveEvents({ quotes = [], reports = [], poItems = [], soItems = [] } = {}) {
  const ships = shipmentsOf(poItems);
  const dep = uniqSorted(ships.map(s => s.actual_departure));
  const arr = uniqSorted(ships.map(s => s.actual_arrival));

  return {
    quoted:  quotes.length ? { on: firstOf(quotes, PICK.quote), n: quotes.length,
                               detail: withLatest(quotes.length + (quotes.length === 1 ? ' quote' : ' quotes'),
                                                  quotes, PICK.quote) } : null,
    tested:  reports.length ? { on: firstOf(reports, PICK.report), n: reports.length,
                                detail: withLatest(reports.length + (reports.length === 1 ? ' report' : ' reports')
                                        + (reports.some(r => r.overall_result === 'pass') ? ', passing' : ''),
                                        reports, PICK.report) } : null,
    ordered: poItems.length ? { on: firstOf(poItems, PICK.poLine), n: poItems.length,
                                detail: withLatest(poItems.length + ' purchase order '
                                        + (poItems.length === 1 ? 'line' : 'lines'),
                                        poItems, PICK.poLine) } : null,
    sold:    soItems.length ? { on: firstOf(soItems, PICK.soLine), n: soItems.length,
                                detail: withLatest(soItems.length + ' sales order '
                                        + (soItems.length === 1 ? 'line' : 'lines'),
                                        soItems, PICK.soLine) } : null,
    // Same rule as the four above, on DISTINCT DATES rather than rows. A product
    // with two PO lines in one shipment is one shipping event, not two, and the
    // embed returns the shipment once per line -- so counting rows here would
    // report a second departure that never happened.
    shipped:   dep.length ? { on: dep[0], n: dep.length,
                              detail: dep.length > 1 ? dep.length + ' shipments · latest ' + fmt(dep[dep.length - 1]) : null } : null,
    delivered: arr.length ? { on: arr[0], n: arr.length,
                              detail: arr.length > 1 ? arr.length + ' arrivals · latest ' + fmt(arr[arr.length - 1]) : null } : null,
  };
}

export const anyEvent = events => LIFECYCLE_STAGES.some(([k]) => events[k]);

// ── THE PRE-ORDER PIPELINE, WHICH DOES HAVE AN ORDER ────────────────────────
// This reverses the no-ladder decision of 2026-09-10, and the reason it can is
// that the scope changed underneath it.
//
// That decision was right for the SIX-stage lifecycle, because Sold and Ordered
// have no fixed order at KUI -- a sales order is the client buying from us and a
// purchase order is us buying from the factory, and either can come first.
//
// THE PIPELINE STOPS BEFORE BOTH OF THEM. Quoted, Sampling, Tested is
// unambiguous -- you sample what you have quoted, and testing follows a sample.
// The ambiguity that killed the first attempt now sits entirely on the far side
// of "complete", where this ladder never reaches.
//
// So LIFECYCLE_STAGES above is still ORDER-FREE and still renders as chips; the
// panel shows the whole history including Sold and Ordered. Only the board uses
// the short ladder, and only because the short ladder is honest.
//
// INQUIRY WAS HERE AND WAS DROPPED on 2026-09-11, before anybody declared one.
// It is not OBSERVABLE -- there is no record of a client asking about a product,
// so the stage could only ever be somebody remembering to type it, and a stage
// that depends on being remembered is a stage that will be wrong. THE QUOTE IS
// THE REAL ENTRY POINT, and a quote leaves a record.
//
// ALL THREE ARE DERIVED NOW. Sampling was the last declared stage and went the
// same way, for the same reason at one remove -- the dropdown had been available
// for a day and 0 of 335 programs had used it, while 122 selectable products
// already carried the answer on products.product_stage. A field somebody
// maintains beats a field somebody must remember.
//
// The third element names WHERE each stage comes from, which is what the board
// puts under its tiles. It is a source, not a kind -- there are no kinds left.
//
// vessl.programs still permits 'inquiry' in its CHECK, and declared_stage and
// declared_stage_at both remain, dormant and 0-valued. Nothing reads them. They
// cost nothing at rest, and if a per-client override is ever wanted the storage
// and its timestamp trigger are already there. See PLM.md.
export const PIPELINE_STAGES = [
  ['quoted',   'Quoted',   'from quotes'],
  ['sampling', 'Sampling', 'from product stage'],
  ['tested',   'Tested',   'from testing'],
];

// A program leaves the board the moment there is a purchase order or a sales
// order line for the pair. DERIVED, never a stored flag -- a flag would need
// writing at five call sites and would be wrong the first time one was missed.
export const isComplete = events => !!(events.ordered || events.sold);

// ── THE COMPLETION EVENT, NAMED ─────────────────────────────────────────────
// Which order actually completed the program, and what to call it. A program
// completes when the FIRST order names it, and at KUI either kind can be first.
//
// MEASURED, because a fixed label would have been wrong most of the time. Of 192
// completed programs:
//
//   106 are SOLD BUT NEVER ORDERED -- 55 percent. A row fixed to "Ordered" would
//       sit empty and greyed on more than half the Completed tab, on programs
//       that are finished.
//    41 have both ON THE SAME DAY, 21 percent -- too many to settle by an
//       arbitrary pick, so those name both.
//
// Which makes the final row read Sold on 110, Ordered on 41, Ordered & Sold on
// 41. Only 11 programs have the two on DIFFERENT days at all (7 PO first, 4 SO
// first), so the ordering half of this rule decides very little -- naming the
// tie is what it is really for.
//
// AND THE ORDER OF THE LADDER IS BY MEANING, NOT BY DATE. The obvious rule --
// hide whatever is dated after completion -- was written and then measured: 92
// of 192 completed programs carry a QUOTE DATED AFTER their first order, because
// quote_date moves when a quote is revised and revising after the order is
// ordinary here. A date rule would have claimed half the Completed tab was never
// quoted.
//
// COMPARED BY CALENDAR DAY, not by raw string, and that is not fussiness. The two
// sides are different types: sales_orders.order_date is a DATE and renders as
// "2026-05-15", while PICK.poLine prefers purchase_orders.issued_at, a
// TIMESTAMPTZ that renders as "2026-05-15T14:22:03+00:00". Compared as strings
// the timestamp sorts AFTER the bare date it shares a day with, so a same-day
// pair would never be equal and would always be called Sold.
//
// issued_at is null on all 67 purchase orders today, so every PO currently falls
// back to its own date column and the raw compare happens to work. The first row
// that stamps issued_at would break it silently -- no error, just the wrong word
// on the last line -- so the day is taken explicitly. The ORIGINAL value is still
// what gets returned and displayed; only the comparison is normalised.
const dayOf = v => (v ? String(v).slice(0, 10) : null);

export function completionOf(events) {
  const o = (events.ordered || {}).on || null;
  const s = (events.sold || {}).on || null;
  if (!o && !s) return null;
  const od = dayOf(o), sd = dayOf(s);
  if (o && s && od === sd) return { on: o, label: 'Ordered & Sold' };
  if (o && (!s || od < sd)) return { on: o, label: 'Ordered' };
  return { on: s, label: 'Sold' };
}

// The furthest stage reached, or null for a program with nothing yet.
//
// THE PRODUCT RECORD DRIVES TWO OF THE THREE. Jenn maintains product_stage and
// compliance_status on the Testing page, and the board now reads them rather
// than asking her to say the same thing twice in a second place.
//
// TESTED is a linked test report OR compliance_status passed. The report reaches
// 4 products in the whole catalogue -- 73 of 84 reports carry no product -- so
// on its own it would keep the column almost empty. Declared compliance is
// trusted here for the same reason the panel stopped flagging it as an
// exception: it is what KUI actually goes on.
//
// manual_test_date is deliberately NOT read. The column exists and is set on
// ZERO rows, so wiring it would be code for a signal that does not exist, and
// the board would look like it supported something it does not.
//
// SAMPLING accepts production as well as sample, because PRODUCTION IMPLIES
// SAMPLING HAPPENED. Without that, a product marked production but not yet
// passed would fall back to Quoted under furthest-reached -- moving backwards on
// the board as it moved forwards in life. There is no production column here by
// design; a program that far along is normally complete and off the board
// entirely, and the two that are not are the declared-production contradiction
// the lifecycle panel already badges.
//
// Null for a program with nothing at all -- a program created by an order rather
// than a quote. It has no column, and the board does not pretend otherwise.
export function currentStage(events, product) {
  const p = product || {};
  if (events.tested || p.compliance_status === 'passed') return 'tested';
  if (p.product_stage === 'sample' || p.product_stage === 'production') return 'sampling';
  if (events.quoted) return 'quoted';
  return null;
}

// The date a program entered the stage it is in, which is what the board ages.
// Derived stages carry their own first-occurrence date; declared ones carry
// declared_stage_at, stamped by trg_programs_declared_stage_at since script 49.
// Null means the stage was declared before that trigger existed, and the board
// says so rather than inventing a duration.
// NULL IS A REAL ANSWER HERE, and the board must not paper over it.
//
// Quoted has a date, always -- the quote carries one. Tested has one only when a
// REPORT put it there; compliance_status passed is a flag with no timestamp.
// Sampling never has one: product_stage records what a product IS, not when it
// became that, and no column anywhere records the change.
//
// Adding one would mean a new column on products plus a trigger, for a field
// edited on a different page -- decided against. So the caller gets null and is
// expected to render NOTHING rather than a dash or a zero. An age that reads
// "0d" or "since --" is worse than an absent line, because both look like a
// measurement.
export function stageEnteredAt(stage, events) {
  if (stage === 'tested' || stage === 'quoted') return (events[stage] || {}).on || null;
  return null;
}

export const daysSince = iso => {
  if (!iso) return null;
  const then = new Date(iso);
  if (isNaN(then)) return null;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
};

// The stage keys a product has actually reached, in display order. This is what
// a "has reached" filter tests membership against -- there is no single current
// stage to return, by design.
export const reachedStages = events => LIFECYCLE_STAGES.map(([k]) => k).filter(k => events[k]);

// ── EXCEPTIONS ──────────────────────────────────────────────────────────────
// Two rules, and the two that were deleted matter as much as the two that ran.
//
// COMPLIANT-WITH-NO-REPORT and eFILED-WITH-NO-REPORT are NOT exceptions at KUI,
// and both were removed rather than hidden on 2026-09-09. Declared compliance is
// trusted, and 73 of 84 reports will stay unlinked for a long time -- 71 of them
// name SKUs the catalogue does not hold. A badge firing on most of the catalogue
// for a reason nobody accepts teaches people to dismiss the two below.
//
// The sample-already-moved case is deliberately absent too. It applies to 32 of
// 185 products, and 32 badges saying one thing is noise -- the Testing page
// states it once, at page level, with a filter.
export function deriveExceptions(product, events) {
  const out = [];
  if (!product) return out;
  if (product.product_stage === 'production' && !events.ordered && !events.sold)
    out.push('Declared Production, but there is no purchase order and no sales order.');
  if ((events.ordered || events.sold) && !events.quoted)
    out.push('Has been ordered or sold, but no quote points at it.');
  return out;
}
