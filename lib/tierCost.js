// ── What a quote tier costs, in one place ────────────────────────────────────
//
// These six were defined twice: once in app/quotes.jsx and again, by hand and
// not identically, inside app/page.jsx's Products view. The copies drifted in
// two ways, both invisible on screen:
//
//   1. page.jsx amortized the mold fee over `t.qty`. On a tier whose quantity
//      comes from the size grid, t.qty is not maintained -- the box stops being
//      editable the moment any size carries a number -- so the divisor was a
//      stale or absent number while quotes.jsx used the size mix.
//   2. page.jsx's activeFreight returned freight ALONE, with no duty term. The
//      Products page margin therefore understated cost on every tier carrying
//      duty, and overstated the margin by the whole duty amount.
//
// The second is the one that was actually wrong on screen. The first had not
// bitten yet only because two tiers in 491 carry a size mix -- which the
// per-size plate-fee work is about to change.
//
// WHAT IS NOT HERE: tierMargin. The two callers disagree about what a tier with
// no client price means, and both are right for their own screen -- quotes.jsx
// returns 0, page.jsx returns null so avgMargin can exclude it from an average.
// Sharing the cost and leaving the margin convention to each caller is the split
// that matches how they actually differ. Anything added here must be a fact
// about cost, not a presentation choice.

// Freight for the method this tier is set to. freightDuty is the legacy single
// field, read as a fallback for tiers written before the split.
export function tierFreight(t) {
  const ship = t.ship || "ocean";
  if (ship === "air") return Number(t.freightAir ?? t.freightDuty) || 0;
  return Number(t.freightOcean ?? t.freightDuty) || 0;
}

// Duty alone. Not ship-specific: it is a percentage of EXW, and US customs
// assesses on transaction value, so how the goods travel does not enter it.
export function tierDuty(t) { return Number(t.duty) || 0; }

// Deliberately keeps the name it had when it was the only accessor. Every
// consumer goes through this -- tierTotalCost, the detail view, the printed
// quote and the CSV -- and all of them want freight AND duty. Renaming it would
// have meant touching each one, and a miss would have dropped duty out of a
// total, an export or a customer's quote without saying anything. That is
// precisely the miss page.jsx's hand-written copy made.
export function activeFreight(t) { return tierFreight(t) + tierDuty(t); }

export function moldPerUnit(moldFee, qty) {
  const f = Number(moldFee) || 0;
  const q = Number(qty) || 0;
  if (f <= 0 || q <= 0) return 0;
  return f / q;
}

// The quantity this tier is really for. A size mix takes over from the Quantity
// box the moment any size carries a number -- the box stops being editable at
// that point -- so anything per-unit has to divide by the mix, not by a qty
// nobody is maintaining.
// Unscoped by design: sizes outside the scale are already pruned on scale change
// and again on save, and the caller here has no scale to hand.
export function effectiveQty(t) {
  const qty = t.sizeQty || {};
  const entered = Object.keys(qty).filter((s) => qty[s] !== "" && qty[s] != null);
  if (entered.length) return entered.reduce((a, s) => a + (Number(qty[s]) || 0), 0);
  return Number(t.qty) || 0;
}

export function tierTotalCost(t, moldFee) {
  const exw = Number(t.landed) || 0;
  return exw + activeFreight(t) + moldPerUnit(moldFee, effectiveQty(t));
}

// A plate is cut for ONE size, so its cost is amortized over THAT SIZE's quantity
// and not over the tier -- which is the whole point of the feature and the one way
// it differs from mold. The two therefore behave differently on the same screen:
// mold spreads thinner as the tier grows, a plate spreads thinner only as its own
// size grows.
//
// Zero when the size carries no quantity, matching moldPerUnit's guard rather than
// inventing a second convention. That makes an entered fee silently inert until a
// quantity arrives, so the editor says so in words beside it -- see the note in
// quotes.jsx. Silence here and a sentence there is the split: this function states
// a cost, and a cost of nothing is the truthful answer when nothing is being made.
export function platePerUnit(feeMap, sizeKey, sizeQty) {
  const f = Number((feeMap || {})[sizeKey]) || 0;
  const q = Number(sizeQty) || 0;
  if (f <= 0 || q <= 0) return 0;
  return f / q;
}
