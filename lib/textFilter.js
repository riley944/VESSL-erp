// Shared helpers for the client-side list filters.
//
// Extracted from app/testing.jsx so the Quotes page's Codes section can reuse the
// matching logic rather than becoming a third divergent copy of it. Deliberately
// just these two functions: the state, the input markup and the empty-state copy
// are genuinely per-page — Testing and Quotes use different style systems and
// different empty-state wording — and a shared <SearchBox> would accumulate props
// until it were harder to reason about than the copies it replaced.
//
// No 'use client': these are pure functions with no hooks and no browser APIs, so
// they bundle into whichever client component imports them.

// Prepare a raw input value for matching. Callers should pass the result to
// matches() rather than normalising inline, so the two can never drift apart --
// matches() lowercases only the candidate, and a needle with different casing or
// stray whitespace would silently fail to match anything.
export const normalizeTerm = (term) => String(term ?? '').trim().toLowerCase();

// Null-safe substring match across any number of candidate fields. The needle must
// already be normalised (see above).
//
// Every candidate funnels through String(v ?? '') because callers pass values read
// through joined objects -- r.lab?.name is undefined before the field is even
// reached -- as well as numbers and nulls, none of which have .toLowerCase().
export const matches = (needle, ...fields) =>
  fields.some((v) => String(v ?? '').toLowerCase().includes(needle));
