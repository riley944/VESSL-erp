// ── The six bank fields, in one place ────────────────────────────────────────
//
// These were defined twice for about an hour: once in app/page.jsx to build the
// Company Banking form, and again in app/quotes.jsx to print the payment block on
// a client quote sheet. Two lists holding the same column names, the same labels
// and the same order, kept in step by hand.
//
// The reason it was written that way is real and is worth recording, because it
// will come up again: page.jsx already imports from quotes.jsx, so importing back
// the other way would close an import cycle. A third module is the way out, and
// it is the same shape lib/tierCost.js used to end the last hand-maintained
// mirror -- the one where a margin on one page silently omitted duty because a
// copy had drifted from its original.
//
// ORDER IS PART OF THE CONTRACT, not incidental. It is the order these are read
// aloud down a payment instruction, and it is the order they print in. The form
// renders them top to bottom in this order; the sheet prints them in this order
// and skips the ones left blank. Reordering here reorders both, which is the
// point of there being one list.
//
// bank_address is last and is the only multi-line value -- the form gives it a
// textarea and the sheet converts its newlines to breaks. Anything consuming this
// list has to cope with a value containing newlines.
//
// The bank_ prefix is not tidiness. kui_settings already has an `address` column
// holding the COMPANY address; this one is the BANK address, and unprefixed the
// pair is impossible to keep straight in a form or a print template.
export const BANK_FIELDS = [
  ['bank_name',           'Bank name'],
  ['bank_beneficiary',    'Beneficiary'],
  ['bank_account_number', 'Account #'],
  ['bank_routing_aba',    'Routing / ABA'],
  ['bank_swift',          'SWIFT'],
  ['bank_address',        'Bank address'],
];

// Just the column names, for callers that need the keys rather than the labels --
// the form's blank-row shape, and anything checking whether a settings row holds
// any bank detail at all. Derived rather than typed out, so it cannot fall out of
// step with the list above.
export const BANK_KEYS = BANK_FIELDS.map(([k]) => k);

// True when a settings row carries at least one bank value, treating whitespace
// as empty. Shared because the form and the sheet must agree exactly: the form
// promises "a payment block will print" and the sheet decides whether to print
// one, and those two answers disagreeing is the bug this prevents.
export function hasAnyBankDetail(settings) {
  return BANK_KEYS.some(k => String(settings?.[k] ?? '').trim() !== '');
}
