// ── A QUOTE'S FIGURES, AS TEXT ──────────────────────────────────────────────
// Moved verbatim from app/quotes.jsx so the desktop card and the iPad view
// (app/m) print a tier the same way: money formats, the tier margin, the mold
// line, a tier's quantity, size lines, freight and duty cells, and the
// no-client-price wording. Pure -- no React.
import { tierFreight, tierDuty, effectiveQty, tierTotalCost, tierHasSizeMold, tierMoldFee } from '@/lib/tierCost';

export function fmt(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
// ---------- KUI margin logic ----------
// suggestedMarkup and roundToPricePoint are lib/quoteRow.js, with
// suggestClientPrice, so rowToForm there reads a quote as it always did.
// ── Unit prices on printed documents ─────────────────────────────────────────
// Tier prices are PER UNIT -- "$X at Y units" -- and quotes.tiers is jsonb, so
// they have never had a storage limit at all. fmt() is fixed at 2dp, which means
// a quote priced at $0.1778 a bag prints as $0.18 on the document the client
// keeps: a 1.2% overstatement on a line that may run to six figures of units.
//
// Minimum 2, maximum 5, trailing zeros trimmed, mirroring unitPrice() in
// page.jsx. $1.50 still prints "$1.50", so nothing on an existing quote moves.
//
// THE WHOLE TIER ROW IS ON ONE CONVENTION. All five figures in it are per-unit
// -- EXW, freight, total cost per unit, the mold amortised into that total, and
// the client price -- so all five use fmtUnit, on screen and in both print
// documents. A row where two columns tell the truth and three round is harder to
// read than either convention applied throughout.
//
// fmt() stays for genuine totals and for whole-quote fees (mold fee, sample fee
// as line items), which are amounts, not rates. It also still renders the
// size-scale tier editor further down -- a different screen, not this row.
export function fmtUnit(n) {
  const v = Number(n);
  if (!isFinite(v)) return "—";
  const trimmed = v.toFixed(5).replace(/0+$/, "");
  const decimals = Math.max(2, Math.min(5, (trimmed.split(".")[1] || "").length));
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export function tierMargin(t, client, moldFee, dutyRate = null) {
  const total = typeof t === "object" && t !== null ? tierTotalCost(t, moldFee, dutyRate) : (Number(t) || 0);
  const p = Number(client) || 0;
  if (p <= 0) return 0;
  return ((p - total) / p) * 100;
}
// ---------- tier calc helpers ----------
// The mold line under the tiers, on screen and on the printed quote. The quote's one
// fee, unless a tier carries per-size mold fees (Bag): then each tier's total, one
// amount if they agree, otherwise one per tier named by its quantity. Null when
// there is none. Returns text with the dollar sign in it, for JSX and the print.
export function moldFeeText(q) {
  const tiers = q.tiers || [];
  if (!tiers.some(tierHasSizeMold)) return Number(q.moldFee) > 0 ? "$" + fmt(q.moldFee) : null;
  const fees = tiers.map((t) => tierMoldFee(t, q.moldFee));
  if (!fees.some((v) => v > 0)) return null;
  if (fees.every((v) => v === fees[0])) return "$" + fmt(fees[0]);
  return tiers.map((t, i) => (fees[i] > 0 ? "$" + fmt(fees[i]) + " at " + effectiveQty(t).toLocaleString() : null)).filter(Boolean).join(" · ");
}
// A tier's quantity on every screen that shows one: the size mix once any size
// carries a number -- the editor's Quantity box stops being maintained then -- and
// the tier's own box otherwise. Null when there is neither.
export function tierQtyShown(t) {
  const n = effectiveQty(t);
  return n > 0 ? n : null;
}
// One size, as the detail view, the printed quotes and the CSV list it under a
// tier: its quantity and price, and -- only where asked, never on a printed quote --
// its own EXW and mold fee. Plain text; callers escape it for HTML.
export function sizeLineText(l, withCosts) {
  let s = l.label + " " + l.qty.toLocaleString() + " @ " + (l.price != null ? "$" + fmtUnit(l.price) : "—");
  if (withCosts && l.exw != null) s += " · EXW $" + fmtUnit(l.exw);
  if (withCosts && l.mold != null) s += " · mold $" + fmt(l.mold);
  return s;
}
// FREIGHT AND DUTY, APART. The card, the printed quote and the CSV showed one
// "Freight + Duty" figure (activeFreight); they now show the two halves. Freight
// is tierFreight -- the tier's own method -- and Duty is tierDuty. A tier saved
// before the two were split (dutyLegacy: no duty, a freight figure) carries duty
// inside its freight, so Freight shows that figure and Duty says "incl." --
// never $0.00, which would read as duty-free. Total Cost is unchanged either way.
export function freightCell(t) {
  const f = tierFreight(t);
  return f ? "$" + fmtUnit(f) : "—";
}
export function dutyCell(t) {
  if (t.dutyLegacy) return "incl.";
  return t.duty === "" || t.duty == null ? "—" : "$" + fmtUnit(tierDuty(t));
}
// NO CLIENT PRICE, SAID RATHER THAN DASHED. A quote with no client price on any
// tier used to show "—" under Client Price Range and Avg Margin, which reads the
// same as a figure that failed to load. It now says so, in one small muted tag;
// a quote priced on some tiers keeps its range and adds "Some tiers unpriced".
// The expanded card's tier rows use the same words where a tier has no price.
export const NO_PRICE_TEXT = "No client price entered";
export const NO_PRICE_TIP = "Client price and margin show once a client price is entered on a tier";
export const SOME_UNPRICED_TEXT = "Some tiers unpriced";
export const SOME_UNPRICED_TIP = "Some tiers have no client price yet; the range and margin cover the priced ones";
// none: tiers exist and none has a client price. some: priced on some, not all.
export function pricedState(q) {
  const tiers = q.tiers || [];
  const priced = tiers.filter((t) => Number(t.client) > 0).length;
  return { none: tiers.length > 0 && priced === 0, some: priced > 0 && priced < tiers.length };
}
// A date as the quote list shows it: "Oct 2, 2026", or "—".
export function fmtStamp(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch { return "—"; }
}
// The list row's figures: tier count, client price range, average margin and
// the shipping method across tiers.
export function quoteSummary(q, dutyRate = null) {
  const tiers = q.tiers || [];
  if (!tiers.length) return { count: 0, minClient: null, maxClient: null, avgMargin: 0, method: null };
  const prices = tiers.map((t) => Number(t.client) || 0).filter((p) => p > 0);
  const margins = tiers.map((t) => tierMargin(t, t.client, q.moldFee, dutyRate)).filter((m) => m !== 0);
  // ship lives on the tier, so a quote only has one method when every tier agrees.
  // A tier with no ship key counts as ocean -- the same default activeFreight uses,
  // so the column can never disagree with the freight the tier is actually costed on.
  const ships = new Set(tiers.map((t) => t.ship || "ocean"));
  return {
    count: tiers.length,
    minClient: prices.length ? Math.min(...prices) : null,
    maxClient: prices.length ? Math.max(...prices) : null,
    avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
    method: ships.size > 1 ? "Mixed" : (ships.has("air") ? "Air" : "Ocean"),
  };
}
