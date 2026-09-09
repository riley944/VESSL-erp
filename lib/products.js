import { SB } from '@/lib/supabase';

// ── One definition of "which product is this?" ───────────────────────────────
// This rule lived in five places -- page.jsx prodKey, page.jsx productByKey,
// quotes.jsx productByKey, RenameSkuModal keyOf, and the backfill predicate in
// scratchpad/18. They agreed by convention rather than by construction, which is
// exactly how the double space in BUC-157 survived three screens. One home now.
//
// It lives in lib/ beside textFilter.js, the existing precedent for a pure
// helper shared by page modules and components -- and the only place that can
// hold it without an import cycle, since page.jsx imports both quotes.jsx and
// the components.

// SKU ALONE IS NOT ENOUGH. products_sku_name_key is UNIQUE (sku, name) and 30
// SKU values are carried by more than one product row, so a SKU identifies a
// family, not a product. The NAME alone IS enough to key on, so a SKU-less row
// still gets a key ('' + '|' + name) and can match a SKU-less product. Only a
// row with no name at all is unkeyable.
export const prodKey = (sku, name) => {
  const n = (name || '').trim();
  return n ? (sku || '').trim() + '|' + n : null;
};

// Resolves a product from a sku|name pair. A blank sku is looked up with .is()
// rather than .eq(): PostgREST renders eq('sku', null) as sku=eq.null, which
// matches nothing -- and a caller that then inserts would loop forever creating
// rows it can never find again.
export async function productByKey(sku, name) {
  const n = (name || '').trim();
  if (!n) return null;
  let qy = SB.from('products').select('id,sku,name,active,origin').eq('name', n);
  qy = (sku || '').trim() ? qy.eq('sku', (sku || '').trim()) : qy.is('sku', null);
  const { data } = await qy.limit(1);
  return (data && data[0]) || null;
}

// Returns the product for a (sku, name), creating it if none exists.
//
// GUARDED ON BOTH HALVES BEING PRESENT. A product with no SKU or no name is the
// half-record this exists to stop producing -- it cannot be keyed on later, so
// creating one only moves the problem. Returns null instead, and the caller
// leaves the quote unlinked, which is a visible state (a hollow ring) rather
// than a silent one.
//
// ADOPTS ON CONFLICT. products_sku_name_key firing means the product already
// exists, which is a perfectly good outcome -- so the row is re-read and
// returned rather than the write being reported as a failure. That also makes
// two people saving the same quote at once converge instead of one erroring.
//
// origin records HOW the row came to exist; see the column comment in script 19.
// updatedBy is accepted for signature symmetry with the quote writes and is not
// used here: vessl.products has no updated_by column.
// ── Is this SKU retired? ─────────────────────────────────────────────────────
// Answers, for a typed SKU, whether the catalogue knows it and whether every row
// carrying it is inactive. The quote form uses it to warn, and
// ensureProductForQuote below uses it to refuse.
//
// SKU ALONE HERE, deliberately, unlike prodKey. The question is not "which
// product is this" but "is this code still orderable", and a SKU whose every row
// is retired is not -- whatever name is typed beside it.
//
// eq rather than ilike, because a SKU may legitimately contain % or _ and ilike
// would read those as wildcards. That matches how productByKey already looks up.
export async function skuActivity(sku) {
  const s = (sku || '').trim();
  if (!s) return { known: false, inactiveOnly: false, rows: 0 };
  const { data } = await SB.from('products').select('id,active').eq('sku', s);
  const rows = data || [];
  if (!rows.length) return { known: false, inactiveOnly: false, rows: 0 };
  // Only false counts as retired. NULL means undecided, which stays orderable --
  // the three-state rule this codebase keeps everywhere.
  return { known: true, inactiveOnly: rows.every(r => r.active === false), rows: rows.length };
}

// INACTIVE MEANS NOT FOR NEW WORK, AND THIS IS WHERE THAT IS ENFORCED.
//
// Two ways a quote used to end up on a retired product, both silent, and both
// closed here:
//
//   ADOPTION. productByKey matches on (sku, name) and never looked at `active`,
//   so an exact match on a retired row was adopted and the quote linked to it.
//
//   MINTING. When the SKU matched a retired row but the NAME differed,
//   productByKey returned null and this function inserted -- and succeeded,
//   because the unique key is (sku, name) rather than sku. That produces a second
//   live product carrying a SKU that was deliberately retired, which is how
//   several of the pairs script 37 cleaned up were most likely born.
//
// Both now return null, which is the SAME outcome this function already had for
// a half-record: the caller leaves the quote unlinked, and an unlinked quote
// renders as a hollow ring on the Products page. A visible state, not a silent
// one. The quote form warns separately, which is where a person can read it.
//
// Measured before building -- 0 unlinked quotes today carry an inactive-only SKU
// or match a retired row exactly, so this refuses nothing that exists and only
// closes the door going forward.
export async function ensureProductForQuote(sku, name, { origin = 'quote-save', updatedBy = null } = {}) {
  const s = (sku || '').trim();
  const n = (name || '').trim();
  if (!s || !n) return null;

  const existing = await productByKey(s, n);
  if (existing) return existing.active === false ? null : existing;

  // No exact match, so this would insert. Refuse if the SKU exists and every row
  // carrying it is retired -- inserting here would mint a duplicate of a SKU
  // somebody deliberately took out of service.
  const activity = await skuActivity(s);
  if (activity.inactiveOnly) return null;

  const ins = await SB.from('products').insert({ sku: s, name: n, origin }).select('id,sku,name,active,origin').single();
  if (!ins.error && ins.data) return ins.data;

  // Lost the race, or some other constraint. Re-read before giving up: only a
  // genuine absence is a failure. The same inactive rule applies to whatever the
  // re-read finds -- losing a race is not a reason to adopt a retired row.
  const raced = await productByKey(s, n);
  return raced && raced.active === false ? null : raced;
}
