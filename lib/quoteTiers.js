// ── Reading a stored quote tier, for every screen that is not the editor ──────
//
// lib/tierCost.js holds the cost model and works on a tier whose size maps are
// keyed by sizeKey: { 'bag|M': '500' }. That is the shape the quote editor holds,
// because rowToForm builds it. Everything else -- the Products page, the order
// prefills, the freight pricing page -- reads the ROW, where the same figures are
// lists of {scale,size,...} records, and handing those to tierCost silently costs
// them as nothing (effectiveQty read every list as quantity 0, which is how the
// Products page lost the mold on every sized tier).
//
// tierFromRow is the one conversion, and the editor's own load (rowToForm) goes
// through the same two functions, so no screen can read a tier differently from
// the form that wrote it.
import { sizeKey, toScaleList, sizesForSelection, storedQtyToMap } from '@/app/components/SizeGrid';
import { sizeUnit } from '@/lib/tierCost';

// THE FULL PER-SIZE TABLE IS FOR BAGS ONLY. With Bag ticked -- alone or beside
// another scale, in which case the whole table follows Bag -- each size row carries
// its own EXW, mold fee and price. With any other scale a size row carries a
// quantity and a client price and nothing else.
export function isBagMode(scales) {
  return toScaleList(scales).includes('bag');
}

// ── Per-size figures inside a tier ───────────────────────────────────────────
// A PAIR: sizeCostFrom and sizeCostToRow must agree exactly. Stored on the tier as
// sizeCost: [{scale,size,landed,client,mold}], SPARSE twice over: a size appears
// only when something was typed for it, and carries only the fields that were.
// Everything absent falls back to the tier at the point of use (sizeUnit in
// lib/tierCost), never here -- filling gaps at load would freeze today's tier
// figure into the size and stop it following later edits.
//
// A record without a scale is not one this code wrote, and is dropped. Outside Bag
// mode a size holds a client price and nothing else, so both sides read and write
// only that field there. mold is the size's own one-time mold fee, in dollars --
// not per unit like the rest. No freight or duty: those are the tier's.
export const SIZE_COST_FIELDS = ['landed', 'client', 'mold'];
export const sizeCostFields = (scales) => (isBagMode(scales) ? SIZE_COST_FIELDS : ['client']);
export function sizeCostFrom(v, scales) {
  const map = {};
  const fields = sizeCostFields(scales);
  (Array.isArray(v) ? v : []).forEach((d) => {
    if (!d || d.size == null || d.scale == null) return;
    const cell = {};
    fields.forEach((k) => {
      if (d[k] === '' || d[k] == null) return;
      const n = Number(d[k]);
      if (isFinite(n)) cell[k] = String(n);
    });
    if (!Object.keys(cell).length) return;
    map[sizeKey(String(d.scale), String(d.size))] = cell;
  });
  return map;
}
// Null when no size carries anything, so the save can leave the key off and a
// tier nobody split by size writes exactly the keys it always has.
export function sizeCostToRow(map, scales) {
  const out = [];
  const fields = sizeCostFields(scales);
  sizesForSelection(scales).forEach((e) => {
    const cell = (map || {})[e.key];
    if (!cell) return;
    const rec = { scale: e.scale, size: e.size };
    fields.forEach((k) => {
      if (cell[k] === '' || cell[k] == null) return;
      const n = Number(cell[k]);
      if (isFinite(n)) rec[k] = n;
    });
    if (Object.keys(rec).length === 2) return;
    out.push(rec);
  });
  return out.length ? out : null;
}

// A stored tier, in the shape tierCost reads. Everything else on it is untouched,
// so a caller that writes the tier back must write the ROW it read, not this.
export function tierFromRow(t, scales) {
  const raw = t || {};
  return { ...raw, sizeQty: storedQtyToMap(raw.sizeQty, scales), sizeCost: sizeCostFrom(raw.sizeCost, scales) };
}

// A tier is sized once any size carries a quantity or a figure of its own. Read on
// a tier from tierFromRow (or the editor), not on a row.
export function tierIsSized(t) {
  const q = (t && t.sizeQty) || {};
  return Object.keys(q).some((k) => q[k] !== '' && q[k] != null) || Object.keys((t && t.sizeCost) || {}).length > 0;
}

// ── The HTS rate ─────────────────────────────────────────────────────────────
// One rate or none. Rows sharing a code can disagree, and picking one arbitrarily
// would put the wrong duty on an item, so several distinct rates count as none --
// the quote editor's rule, which is this function.
export function rateFromRows(rows) {
  const rated = (rows || []).filter((r) => r.total_duty != null);
  const distinct = [...new Set(rated.map((r) => Number(r.total_duty)))];
  return distinct.length === 1 ? distinct[0] : null;
}
// codes is the active code list (useHtsCodes). Null when the quote has no code.
export function htsRateFor(code, codes) {
  if (!code) return null;
  return rateFromRows((codes || []).filter((c) => c.code === code));
}

// ── A size's price outside the editor ────────────────────────────────────────
// The size's own client price when it has one. Otherwise the tier price plus the
// old quote-level adjustment, through sizeUnit -- but only when the tier HAS a
// price: with none, an adjustment on its own is not quoted to anyone, and the
// order prefills and the printed quote have always left such a size blank. Null
// when there is no price to show.
export function sizeQuotedPrice(t, key, delta) {
  const own = ((t && t.sizeCost) || {})[key] || {};
  const hasOwn = own.client !== '' && own.client != null;
  if (!hasOwn && !(Number(t && t.client) > 0)) return null;
  return sizeUnit(t, key, delta).price;
}

// The sizes of a tier that carry a quantity, with what each is quoted at and,
// in Bag mode, its own EXW and mold fee -- and whether any of it differs from the
// tier's single figures, which is when a screen needs to show the sizes at all.
// t is a tier from tierFromRow or the editor; deltaMap is keyed by sizeKey.
export function sizeLines(t, scales, deltaMap) {
  const bag = isBagMode(scales);
  const base = Number(t.client) > 0 ? Number(t.client) : null;
  const lines = sizesForSelection(scales).map((e) => {
    const qty = Number((t.sizeQty || {})[e.key]) || 0;
    const own = (t.sizeCost || {})[e.key] || {};
    const price = sizeQuotedPrice(t, e.key, (deltaMap || {})[e.key]);
    const exw = bag && own.landed !== '' && own.landed != null ? Number(own.landed) : null;
    const mold = bag && own.mold !== '' && own.mold != null ? Number(own.mold) : null;
    return { key: e.key, label: e.label, qty, price, exw, mold, differs: price !== base || exw != null || mold != null };
  }).filter((l) => l.qty > 0);
  return { lines, differs: lines.some((l) => l.differs) };
}
