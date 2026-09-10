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
