import { SB } from '@/lib/supabase';

// ── One definition of "which product is this?" ───────────────────────────────
// This rule lived in five places -- page.jsx prodKey, page.jsx productByKey,
// quotes.jsx productByKey, RenameSkuModal keyOf, and the backfill predicate in
// script 18 (file lost, see sql/README.md). They agreed by convention rather
// than by construction, which is exactly how the double space in BUC-157
// survived three screens. One home now.
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
// ── THE PRODUCT OPTION SETS ─────────────────────────────────────────────────
// They live in lib/productOptions.js, a file with no imports, so the scheduled
// testing email can print the same labels without loading the browser client
// this file imports. Re-exported here so every existing import is unchanged.
export {
  COMPLIANCE_OPTS, STAGE_OPTS, CATALOGUE_OPTS, catalogueKey, catalogueValue,
} from '@/lib/productOptions';

// ── How a product name is written ───────────────────────────────────────────
// Every save of products.name or quotes.product goes through this: the ends
// trimmed, any run of whitespace one space, then Title Case word by word
// (titleWord) -- "blue  coaster/bottle with lid " becomes "Blue Coaster/Bottle
// with Lid". '' for blank. Scripts 119 and 120 put the stored names into this
// shape; this keeps them there. SKUs and order line descriptions never go
// through it.
//
// THE WORD RULE IS SCRIPT 120's pg_temp.t120_word, line for line -- the two
// must agree, or the next save of an old name would change it again.
//   The first word has its first character uppercased if it is a-z.
//   A later small word (TITLE_SMALL) is left exactly as typed, never raised or
//   lowered; it is recognised ignoring case, a leading ( and trailing , . ; ! ? ).
//   A word with a digit (480ml, 1/4) or letters but no lowercase (VIP, XL) is
//   left as is.
//   Any other word: its first letter, and any a-z right after / or -, uppercased;
//   the rest as typed (bag-same to Bag-Same, mens to Mens).
const TITLE_SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or',
  'the', 'to', 'with', 'vs', 'w/', 'w/o']);
const titleWord = (w, first) => {
  if (w === '') return w;
  if (first && /^[a-z]/.test(w)) w = w[0].toUpperCase() + w.slice(1);
  const k = w.replace(/^\(+/, '').replace(/[,.;!?)]+$/, '').toLowerCase();
  if (!first && TITLE_SMALL.has(k)) return w;
  if (/[0-9]/.test(w) || (/[A-Za-z]/.test(w) && !/[a-z]/.test(w))) return w;
  let res = '', prev = '', seen = false;
  for (let c of w) {
    if (/^[a-z]$/.test(c) && (!seen || prev === '/' || prev === '-')) c = c.toUpperCase();
    if (/^[A-Za-z]$/.test(c)) seen = true;
    res += c;
    prev = c;
  }
  return res;
};
export const cleanName = s => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.split(' ').map((w, i) => titleWord(w, i === 0)).join(' ') : '';
};

// Two names are the same product name when they agree once cleaned, ignoring
// case -- so a lowercase typo finds the product it means instead of minting a
// second one beside it.
const nameLower = s => cleanName(s).toLowerCase();

// THE KEY IGNORES CASE in the name, for the same reason. Both sides of every
// comparison build it here, so it only has to agree with itself.
export const prodKey = (sku, name) => {
  const n = nameLower(name);
  return n ? (sku || '').trim() + '|' + n : null;
};

// The rows whose name matches n ignoring case and spacing. Postgres compares
// with ilike on the words joined by % (so stored double spaces still match),
// with % _ and the backslash escaped; PostgREST also reads * as a wildcard, so
// the result is filtered here on the cleaned, lowercased name, which is the
// real test. An exact-case match comes first, then active rows.
const ilikeName = n => n.split(' ').map(w => w.replace(/[\\%_]/g, c => '\\' + c)).join('%');
const pickByName = (rows, n) => (rows || [])
  .filter(r => nameLower(r.name) === n.toLowerCase())
  .sort((a, b) => ((a.name === n ? 0 : 1) - (b.name === n ? 0 : 1))
               || ((a.active === false ? 1 : 0) - (b.active === false ? 1 : 0)));

// Resolves a product from a sku|name pair, the name ignoring case. A blank sku
// is looked up with .is() rather than .eq(): PostgREST renders eq('sku', null)
// as sku=eq.null, which matches nothing -- and a caller that then inserts would
// loop forever creating rows it can never find again.
export async function productByKey(sku, name) {
  const n = cleanName(name);
  if (!n) return null;
  let qy = SB.from('products').select('id,sku,name,active,origin').ilike('name', ilikeName(n));
  qy = (sku || '').trim() ? qy.eq('sku', (sku || '').trim()) : qy.is('sku', null);
  const { data } = await qy;
  return pickByName(data, n)[0] || null;
}

// A product by name alone, any SKU, the name ignoring case. For the PO form's
// "save as products", which has always matched on name only.
export async function productByName(name) {
  const n = cleanName(name);
  if (!n) return null;
  const { data } = await SB.from('products').select('id,sku,name,active').ilike('name', ilikeName(n));
  return pickByName(data, n)[0] || null;
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
// clientCompanyId IS WRITTEN ONLY BY THE INSERT, and that is the whole of the
// rule. A product this function ADOPTS is returned untouched, so a client
// somebody set by hand -- or one that disagrees with this quote -- is never
// overwritten, and neither is a null that was left deliberately. The only row
// that gets a client here is one that did not exist a moment ago, where there is
// nothing to overwrite.
//
// NULL IS A REAL ARGUMENT and is passed through as no column at all rather than
// as an explicit null, so the insert keeps whatever the table defaults to. A
// quote whose client the catalogue cannot name mints a product with no client,
// which is the state the backfill and the Products list already read.
export async function ensureProductForQuote(sku, name, { origin = 'quote-save', updatedBy = null, clientCompanyId = null } = {}) {
  const s = (sku || '').trim();
  const n = cleanName(name);
  if (!s || !n) return null;

  const existing = await productByKey(s, n);
  if (existing) return existing.active === false ? null : existing;

  // No exact match, so this would insert. Refuse if the SKU exists and every row
  // carrying it is retired -- inserting here would mint a duplicate of a SKU
  // somebody deliberately took out of service.
  const activity = await skuActivity(s);
  if (activity.inactiveOnly) return null;

  const ins = await SB.from('products')
    .insert({ sku: s, name: n, origin, ...(clientCompanyId ? { client_company_id: clientCompanyId } : {}) })
    .select('id,sku,name,active,origin,client_company_id').single();
  if (!ins.error && ins.data) return ins.data;

  // Lost the race, or some other constraint. Re-read before giving up: only a
  // genuine absence is a failure. The same inactive rule applies to whatever the
  // re-read finds -- losing a race is not a reason to adopt a retired row.
  const raced = await productByKey(s, n);
  return raced && raced.active === false ? null : raced;
}
