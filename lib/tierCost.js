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

// moldFee is the QUOTE's fee. tierMoldFee decides whether this tier is costed on it
// or on its Bag sizes' own fees, so every caller -- the editor, the detail view, the
// printed quote, the Products page -- gets the right mold without knowing why.
// Spread over the whole tier, a tier on its sizes' fees costs their total over the
// total quantity: the quantity-weighted average of each size's own share.
export function tierTotalCost(t, moldFee) {
  const exw = Number(t.landed) || 0;
  return exw + activeFreight(t) + moldPerUnit(tierMoldFee(t, moldFee), effectiveQty(t));
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

const entered = (v) => v !== '' && v != null;

// ── Mold in Bag mode ─────────────────────────────────────────────────────────
// A Bag size may carry its own one-time mold fee, t.sizeCost[key].mold, spread over
// THAT SIZE's quantity in this tier -- the same way a plate is.
//
// A tier where any size has one is costed on those fees alone, and the quote's
// mold_fee no longer reaches it: mixing the two would charge one mold twice. A tier
// where none does takes the quote's fee over the whole tier, as every tier always
// has, so a quote nobody has edited since costs exactly as it did.
export function tierHasSizeMold(t) {
  return Object.values((t && t.sizeCost) || {}).some((c) => c && entered(c.mold));
}

// The mold dollars this tier carries. On its sizes' fees, only sizes with a
// quantity count: a fee on a size nobody is making is idle, as an idle plate is,
// and the editor says so beside it.
export function tierMoldFee(t, quoteMold) {
  if (!tierHasSizeMold(t)) return Number(quoteMold) || 0;
  const qty = t.sizeQty || {};
  return Object.keys(t.sizeCost).reduce((a, k) => {
    const c = t.sizeCost[k] || {};
    return a + (entered(c.mold) && (Number(qty[k]) || 0) > 0 ? Number(c.mold) || 0 : 0);
  }, 0);
}

// ── One size inside a tier ───────────────────────────────────────────────────
// Each size may carry its own EXW, freight (per method, like the tier), duty and
// client price, in t.sizeCost keyed by sizeKey. Any figure a size does not carry
// falls back to the tier's -- and the client price to the tier's PLUS that size's
// old quote-level adjustment, which is how a size was priced before it could hold
// a price of its own. So a quote nobody has edited since prices exactly as before.
//
// All four are per unit, the same as the tier fields they stand in for. A size's
// mold fee is not: it is one-time dollars, and sizedTierSummary spreads it.

export function sizeUnit(t, key, delta) {
  const own = (t.sizeCost || {})[key] || {};
  const fk = (t.ship || 'ocean') === 'air' ? 'freightAir' : 'freightOcean';
  const landed = entered(own.landed) ? Number(own.landed) || 0 : Number(t.landed) || 0;
  const freight = entered(own[fk]) ? Number(own[fk]) || 0 : tierFreight(t);
  const duty = entered(own.duty) ? Number(own.duty) || 0 : tierDuty(t);
  // A missing base counts as zero, so with no tier price the adjustment IS the
  // price -- the reading the size rows have always taken. Null when the result is
  // not a price at all.
  const p = entered(own.client) ? Number(own.client) || 0 : (Number(t.client) || 0) + (Number(delta) || 0);
  return { landed, freight, duty, price: p > 0 ? p : null };
}

// Every size row of a tier, plus the tier's totals in DOLLARS.
//
// entries is sizesForSelection(scales), or anything carrying the same `key`s; the
// caller has the scale and this file does not. deltaMap and plateMap are keyed by
// sizeKey as well.
//
// Per unit, a size costs its EXW + freight + duty, plus its mold, plus its own plate
// spread over its own quantity. The mold is the size's own fee over its own
// quantity when the tier has size fees, and otherwise the quote's fee over the
// whole tier quantity -- the divisor tierTotalCost uses, an equal share per unit.
//
// The totals are quantity x per-unit, summed. The margin is weighted the same way
// -- revenue less cost over revenue -- taken over the sizes that have both a
// quantity and a price, since a size with no price has no margin to contribute.
// Null when no size qualifies.
export function sizedTierSummary(t, entries, quoteMold, plateMap, deltaMap) {
  const own = tierHasSizeMold(t);
  const shared = own ? 0 : moldPerUnit(quoteMold, effectiveQty(t));
  const rows = (entries || []).map((e) => {
    const qty = Number((t.sizeQty || {})[e.key]) || 0;
    const u = sizeUnit(t, e.key, (deltaMap || {})[e.key]);
    const moldFee = own ? Number(((t.sizeCost || {})[e.key] || {}).mold) || 0 : 0;
    const mold = own ? moldPerUnit(moldFee, qty) : shared;
    const plate = platePerUnit(plateMap, e.key, qty);
    const cost = u.landed + u.freight + u.duty + mold + plate;
    const margin = u.price == null ? null : ((u.price - cost) / u.price) * 100;
    return { key: e.key, qty, ...u, moldFee, mold, plate, cost, margin };
  });
  const sum = (f) => rows.reduce((a, r) => a + r.qty * f(r), 0);
  const priced = rows.filter((r) => r.qty > 0 && r.price != null);
  const revenue = priced.reduce((a, r) => a + r.qty * r.price, 0);
  const pricedCost = priced.reduce((a, r) => a + r.qty * r.cost, 0);
  return {
    rows,
    totals: {
      qty: rows.reduce((a, r) => a + r.qty, 0),
      exw: sum((r) => r.landed),
      freight: sum((r) => r.freight),
      duty: sum((r) => r.duty),
      // Dollars, like the rest: the sizes' own fees that are in the cost, or the
      // quote's fee, which the tier's quantity absorbs whole.
      mold: sum((r) => r.mold),
      cost: sum((r) => r.cost),
      client: revenue,
      margin: revenue > 0 ? ((revenue - pricedCost) / revenue) * 100 : null,
    },
  };
}
