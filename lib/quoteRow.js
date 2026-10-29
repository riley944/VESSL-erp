// ── QUOTE ROWS <-> THE QUOTE FORM, AND THE MARKUP RULE ──────────────────────
// Moved verbatim from app/quotes.jsx so a second screen (the iPad view, app/m)
// reads a stored quote exactly as the desktop does: rowToForm and the size-map
// pairs it needs, the writers formToRow uses, and the KUI markup rule behind
// a suggested client price. Pure -- no React, no Supabase.
import { toScaleList, sizeKey, sizesForSelection, storedQtyToMap as qtyMapFrom } from '@/app/components/SizeGrid';
import { sizeCostFrom } from '@/lib/quoteTiers';

// ---------- KUI margin logic ----------
export function suggestedMarkup(landed) {
  const c = Number(landed) || 0;
  if (c < 5) return 60;
  if (c < 10) return 50;
  if (c < 20) return 40;
  if (c < 40) return 30;
  return 25;
}
export function roundToPricePoint(value, on) {
  if (!on) return Math.round(value * 100) / 100;
  const dollars = Math.floor(value);
  if (value <= dollars + 0.99) return dollars + 0.99;
  return dollars + 1.99;
}
export function suggestClientPrice(landed) {
  const c = Number(landed) || 0;
  if (!c) return "";
  const m = suggestedMarkup(c);
  return roundToPricePoint(c * (1 + m / 100), true);
}
// ---------- DB <-> form mapping ----------
// size_price_deltas rides on the quote, not the tier — one set applies across every
// tier. Stored as an array of records, non-zero entries only ([{size,delta}]); held
// in form state as a keyed map of STRINGS ({"2XL":"1.5"}) because coercing to Number
// on each keystroke makes "1.50" untypeable, the same reason SizeGrid holds strings.
//
// NO LONGER EDITED. The adjustment row is gone: a size row in each tier takes its
// own client price instead. The column is still read, because a size with no price
// of its own is priced at the tier's plus its adjustment (sizeUnit in tierCost) --
// that is what keeps a quote saved before the change pricing as it did -- and still
// written back as loaded, pruned only when its scale is unticked.
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ THESE FOUR FUNCTIONS ARE TWO PAIRS, AND EACH PAIR MUST AGREE EXACTLY.     │
// │                                                                           │
// │ formToRow's whitelist is destructive -- anything it does not name is      │
// │ dropped on every save, silently. So if a reader and its writer disagree   │
// │ about a key by so much as a character, quantities compute on screen, look │
// │ right, and vanish when the quote is saved. Nothing reports it.            │
// │                                                                           │
// │ deltasToMap  <-> mapToDeltas   both speak [{scale,size,delta}]            │
// │ qtyMapFrom   <-> qtyMapToRow   both speak [{scale,size,qty}]              │
// │                                                                           │
// │ In form state both are ONE flat map keyed by sizeKey(scale,size), so the  │
// │ helpers above index them the same way whatever is selected.               │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Stored entries carry their scale. Entries written BEFORE that -- 2 quotes, both
// 'bag' -- carry only a size, and are attributed to the row's single scale. That
// is deterministic rather than a guess precisely because a legacy row has exactly
// one: the migration turned every scalar into a one-element array. A row that
// somehow held several scales and scale-less entries is unresolvable, so those
// entries are DROPPED rather than assigned to the first scale, which would invent
// a fact. No such row exists today.
export function deltasToMap(v, scales) {
  let arr = [];
  try { arr = Array.isArray(v) ? v : (v ? JSON.parse(v) : []); } catch { arr = []; }
  const list = toScaleList(scales);
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach((d) => {
    if (!d || d.size == null) return;
    const n = Number(d.delta);
    if (!isFinite(n) || n === 0) return;
    const scale = d.scale != null ? String(d.scale) : (list.length === 1 ? list[0] : null);
    if (!scale) return;
    map[sizeKey(scale, String(d.size))] = String(n);
  });
  return map;
}
// Sizes outside the current selection are dropped here as well as on scale change,
// so a stale delta can never reach the column. No scale (a flat product) stores [].
export function mapToDeltas(map, scales) {
  return sizesForSelection(scales)
    .map((e) => ({ scale: e.scale, size: e.size, delta: Number((map || {})[e.key]) }))
    .filter((d) => isFinite(d.delta) && d.delta !== 0);
}

// ── Per-size plate fees ──────────────────────────────────────────────────────
// A THIRD PAIR ON THE SAME PATTERN as deltasToMap/mapToDeltas above, deliberately
// written out rather than generalised: the boxed note further up says each pair
// must agree exactly, and a shared helper parameterised by field name would make
// the two halves agree by construction while making it much harder to see that
// they do. Three explicit pairs read better than one clever one.
//
// Same attribution rule: a record with no scale is adopted by the only scale on
// the quote and refused when there are several, because guessing which Adult-or-
// Youth L a bare "L" meant is exactly the ambiguity the composite key removed.
// Strings in form state, for the reason the deltas are: coercing to Number on each
// keystroke makes "1.50" untypeable.
export function platesToMap(v, scales) {
  let arr = [];
  try { arr = Array.isArray(v) ? v : (v ? JSON.parse(v) : []); } catch { arr = []; }
  const list = toScaleList(scales);
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach((d) => {
    if (!d || d.size == null) return;
    const n = Number(d.fee);
    if (!isFinite(n) || n === 0) return;
    const scale = d.scale != null ? String(d.scale) : (list.length === 1 ? list[0] : null);
    if (!scale) return;
    map[sizeKey(scale, String(d.size))] = String(n);
  });
  return map;
}
export function mapToPlates(map, scales) {
  return sizesForSelection(scales)
    .map((e) => ({ scale: e.scale, size: e.size, fee: Number((map || {})[e.key]) }))
    .filter((d) => isFinite(d.fee) && d.fee !== 0);
}

// ── Per-size carton dimensions ───────────────────────────────────────────────
// DIMENSIONS ONLY -- no units-per-carton and no weight, confirmed with Loren that
// only the dimensions vary by bag size. Those two stay quote level, which is also
// what keeps ApplyBidModal's reading of them meaningful.
//
// SPARSE AND PARTIAL. A size appears only when it overrides something, and it may
// override one dimension without the other two -- so unlike the deltas, the filter
// keeps a record when ANY of l/w/h is a real number rather than requiring all
// three. Anything still missing falls back to the quote-level carton_l/w/h at the
// point of use, never here: filling the gaps at load time would freeze today's
// quote-level value into the row and stop it tracking later edits.
export function cartonsToMap(v, scales) {
  let arr = [];
  try { arr = Array.isArray(v) ? v : (v ? JSON.parse(v) : []); } catch { arr = []; }
  const list = toScaleList(scales);
  const map = {};
  (Array.isArray(arr) ? arr : []).forEach((d) => {
    if (!d || d.size == null) return;
    const scale = d.scale != null ? String(d.scale) : (list.length === 1 ? list[0] : null);
    if (!scale) return;
    const cell = {};
    ["l", "w", "h"].forEach((k) => {
      const n = Number(d[k]);
      if (isFinite(n) && n > 0) cell[k] = String(n);
    });
    if (Object.keys(cell).length) map[sizeKey(scale, String(d.size))] = cell;
  });
  return map;
}
export function mapToCartons(map, scales) {
  return sizesForSelection(scales)
    .map((e) => {
      const cell = (map || {})[e.key] || {};
      const out = { scale: e.scale, size: e.size };
      ["l", "w", "h"].forEach((k) => {
        const n = Number(cell[k]);
        if (isFinite(n) && n > 0) out[k] = n;
      });
      return out;
    })
    .filter((d) => d.l != null || d.w != null || d.h != null);
}
// Per-size quantities ride on the TIER, not the quote — 500 units split S/M/L is a
// different split at 5,000. Stored as an object keyed by size, held in form state as
// STRINGS for the same reason the deltas are. Absent on every tier written before
// this existed, which reads back as {}.
// Two stored shapes, told apart by Array.isArray rather than by a version flag: the
// new one is a list of records, the legacy one an object keyed by bare size. Same
// attribution rule as deltasToMap, and the same refusal to guess.
// qtyMapFrom is storedQtyToMap from SizeGrid, imported under its original name so
// every call site here is unchanged. It moved because page.jsx needs the same
// conversion to prefill the order grids, and a hand-copy is how helpers drift.
// Returns null rather than {} when nothing is entered, so formToRow can leave the key
// off entirely and a tier nobody has touched keeps writing exactly the six keys it
// always has. Sizes outside the current scale are dropped here as well as on scale
// change, the same belt-and-braces mapToDeltas uses.
export function qtyMapToRow(map, scales) {
  const out = [];
  sizesForSelection(scales).forEach((e) => {
    const v = (map || {})[e.key];
    // An entered 0 is a real answer and survives; "" and null are "not filled in".
    if (v === "" || v == null) return;
    const n = Number(v);
    if (!isFinite(n)) return;
    out.push({ scale: e.scale, size: e.size, qty: n });
  });
  return out.length ? out : null;
}
// ── Per-size figures inside a tier ───────────────────────────────────────────
// sizeCostFrom and sizeCostToRow live in lib/quoteTiers, so every screen that reads
// a stored tier reads it through the same pair the form saves with.
// When freight and duty became two figures on the tier row: commit b1aded7,
// "Compute duty from the HTS code and split it from freight on the tier row",
// 12 Aug 2026 12:20 Eastern. A tier saved before this with no duty and a freight
// figure carries its duty inside that freight (dutyLegacy, below).
export const DUTY_SPLIT_AT = Date.parse("2026-08-12T16:20:05Z");
export function rowToForm(r) {
  const savedAt = Date.parse(r.freight_duty_updated_at || r.updated_at || "");
  const beforeDutySplit = isFinite(savedAt) && savedAt < DUTY_SPLIT_AT;
  // Read FIRST: both the deltas and every tier's quantities need it to attribute
  // legacy scale-less entries, so it cannot be computed at the return.
  const scales = toScaleList(r.size_scale);
  let tiers = [];
  try { tiers = Array.isArray(r.tiers) ? r.tiers : (r.tiers ? JSON.parse(r.tiers) : []); } catch { tiers = []; }
  if ((!tiers || tiers.length === 0) && (r.landed != null || r.qty != null)) {
    const landed = r.landed ?? "";
    if (landed !== "" || r.qty) {
      tiers = [{
        qty: r.qty ?? "",
        landed: landed,
        ship: "ocean",
        freightOcean: r.freight_duty ?? "",
        client: landed !== "" ? suggestClientPrice(landed) : "",
      }];
    }
  }
  tiers = (tiers || []).map((t) => {
    const ship = t.ship || "ocean";
    let air = t.freightAir ?? "";
    let ocean = t.freightOcean ?? "";
    if (t.freightDuty != null && t.freightDuty !== "" && air === "" && ocean === "") {
      if (ship === "air") air = t.freightDuty; else ocean = t.freightDuty;
    }
    // Set here and nowhere else, because rowToForm is the boundary between what was
    // STORED and what is on screen -- and the question this answers is entirely about
    // the stored row. True means the tier predates duty being split out: it carries a
    // freight figure written when freight and duty were one box, so if duty now
    // computes on top, the freight number may already contain it.
    //
    // It is a form-only flag. formToRow's whitelist does not name it, so it can never
    // be written back -- which is the point. This is a transitional concern about 19
    // tiers, and duty_only is already sitting in that jsonb as a dead key nobody
    // reads; a second one would outlive its purpose the same way.
    //
    // ONLY BEFORE THE SPLIT. A blank duty on a tier saved since freight and duty
    // became two boxes means duty was never entered, not that it sits in freight
    // (Broughton BRO-001, saved 2 Oct, freight 9 and duty blank, read "incl."). So
    // the flag needs the quote's freight-and-duty stamp -- or, without one, its
    // last save -- to fall before DUTY_SPLIT_AT; after it, a blank duty is just
    // blank and every screen shows "—".
    const legacyFreight = beforeDutySplit && (t.duty == null || t.duty === "") && (air !== "" || ocean !== "");
    return { qty: t.qty ?? "", landed: t.landed ?? "", ship, freightAir: air, freightOcean: ocean, client: t.client ?? "", fb: Array.isArray(t.fb) ? t.fb : null, duty_only: t.duty_only || false, duty: t.duty ?? "", dutyManual: !!t.dutyManual, dutyLegacy: legacyFreight, sizeQty: qtyMapFrom(t.sizeQty, scales), sizeCost: sizeCostFrom(t.sizeCost, scales) };
  });
  return {
    id: r.id,
    // The Quote ID (script 103). Read only: formToRow never sends it, and the
    // database issues it on insert and keeps it on update whatever is sent.
    quoteCode: r.quote_code || "",
    quoteDate: r.quote_date || "", product: r.product || "",
    sku: r.sku || "", sizeScales: scales, sizeDeltas: deltasToMap(r.size_price_deltas, scales), sizePlateFees: platesToMap(r.size_plate_fees, scales), sizeCartons: cartonsToMap(r.size_cartons, scales), notes: r.notes || "",
    client: r.client || "", clientContact: r.client_contact || "", clientEmail: r.client_email || "",
    clientPhone: r.client_phone || "", clientAddress: r.client_address || "",
    factory: r.factory || "", factoryContact: r.factory_contact || "", factoryEmail: r.factory_email || "",
    factoryPhone: r.factory_phone || "", country: r.country || "", leadTime: r.lead_time || "", hts: r.hts || "",
    unitsPerCarton: r.units_per_carton ?? "", cartonL: r.carton_l ?? "", cartonW: r.carton_w ?? "",
    cartonH: r.carton_h ?? "", cartonWeight: r.carton_weight ?? "",
    freightDutyUpdatedAt: r.freight_duty_updated_at || "", freightDutyUpdatedBy: r.freight_duty_updated_by || "",
    moldFee: r.mold_fee ?? "", sampleFee: r.sample_fee ?? "",
    // The client price sheet's Details and Color (script 116), in words meant for
    // the client. Set on the form or in the sheet's settings step.
    clientDetails: r.client_details || "", clientColor: r.client_color || "",
    // The factory quote PDF this quote was imported from (script 129), a path in
    // the private quote-pdfs bucket.
    pdfPath: r.pdf_path || "",
    // Which item of that PDF (script 139): { page, anchor, item_name, anchors },
    // so View PDF can open at the item's rows. Null for a quote not imported from one.
    pdfItem: r.pdf_item || null,
    tiers: tiers || [],
    updatedAt: r.updated_at || "", updatedBy: r.updated_by || "",
  };
}
