// ── Freight bid amounts ───────────────────────────────────────────────────────
// Moved out of app/page.jsx unchanged, so the Shipments export reads a bid's
// amount exactly as the cards and the bids modal do.

// An LCL bid is ONE all-in total for the shipment, kept as rates.LCL.total --
// entered by hand, or read from B22 of a returned LCL sheet. null when a bid
// carries no such total; it is never derived from a partial sum.
export function lclBidTotal(b) {
  const t = Number(b && b.rates && b.rates.LCL && b.rates.LCL.total);
  return isFinite(t) && t > 0 ? t : null;
}

export function bidEffective(b, containerType) {
  if (Number(b.effective_per_container) > 0) return Number(b.effective_per_container);
  const rates = b.rates || {};
  const r = rates[containerType] || {};
  const ocean = Number(r.ocean)||0, origin = Number(r.origin)||0;
  const dest = Number(b.dest_total)||0;
  const total = ocean + origin + dest;
  return total > 0 ? total : (Number(b.all_in_per_container)||0);
}
