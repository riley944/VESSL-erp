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
export async function ensureProductForQuote(sku, name, { origin = 'quote-save', updatedBy = null } = {}) {
  const s = (sku || '').trim();
  const n = (name || '').trim();
  if (!s || !n) return null;

  const existing = await productByKey(s, n);
  if (existing) return existing;

  const ins = await SB.from('products').insert({ sku: s, name: n, origin }).select('id,sku,name,active,origin').single();
  if (!ins.error && ins.data) return ins.data;

  // Lost the race, or some other constraint. Re-read before giving up: only a
  // genuine absence is a failure.
  return await productByKey(s, n);
}
