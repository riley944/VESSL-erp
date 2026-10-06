// ── THE PRODUCT OPTION SETS, IN ONE PLACE ───────────────────────────────────
// These lived as file-local consts in app/testing.jsx, which was fine while the
// Testing product modal was the only screen that could set them. The PLM card
// edits the same three fields now, and two copies of a list like this is how one
// screen ends up offering Pass while the other offers Passed.
//
// A FILE OF ITS OWN, WITH NO IMPORTS, so server code can use it. lib/products.js
// imports the browser Supabase client, which a scheduled route must not pull in
// just to read a label; the weekly testing email (lib/testingDigest.js) prints
// these same labels. lib/products.js re-exports everything here, so existing
// imports from '@/lib/products' are unchanged.
//
// VALUES ARE WHAT THE COLUMN HOLDS, LABELS ARE WHAT A PERSON READS, and the empty
// value means clear it back to NULL -- products_product_stage_check accepts NULL,
// production or sample and would reject an empty string.
//
// COMPLIANCE_OPTS has no CHECK behind it, measured: the column is free text and
// this list is convention. That is a reason to keep the list in one place rather
// than a reason to relax about it.
export const COMPLIANCE_OPTS = [
  ['', '— Not set —'], ['not_required', 'Not required'], ['tbd', 'TBD'],
  ['passed', 'Pass'], ['pending', 'Pending'], ['failed', 'Failed'],
];
export const STAGE_OPTS = [
  ['', '— Not set —'], ['production', 'Production'], ['sample', 'Sample'],
];
// products.active is three-state and only false is Inactive -- NULL is undecided,
// not retired. The values are strings here because a select carries strings; the
// caller turns them back into true, false or null.
export const CATALOGUE_OPTS = [
  ['notset', 'Not set'], ['active', 'Active'], ['inactive', 'Inactive'],
];
export const catalogueKey = p => (p && p.active === false) ? 'inactive'
                              : (p && p.active === true)  ? 'active' : 'notset';
export const catalogueValue = key => key === 'active' ? true : key === 'inactive' ? false : null;

// ── SALES ORDER PAYMENT TERMS ──────────────────────────────────────────────
// Kristy's five, in her order. THE STORED VALUE IS THE LABEL ITSELF: the column
// (sales_orders.payment_terms) stays plain text with no CHECK, and the order page,
// the order confirmation PDF and the client portal all print whatever text is
// stored -- so a value picked here reads the same everywhere with no mapping.
// "Not set" is not in the list; the forms offer it as the empty choice, saved as
// NULL. Older orders hold free text ("60", "Net60") that is NOT one of these; the
// edit form shows such a value as-is and never rewrites it.
export const PAYMENT_TERMS_OPTS = [
  'Net 30', 'Net 45', 'Net 60', 'Due at Once', '2%/10, Net 30',
];
