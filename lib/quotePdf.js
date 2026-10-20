// Factory quote PDFs: where they are stored and how big they may be. Shared by the
// quote form (which uploads) and /api/quotes/extract (which reads), so the two
// cannot disagree about a path or a limit.
//
// The bucket and its policies are script 129. The INSERT policy accepts only the
// path shape below -- PDF_PATH_RE is the same pattern, so a path this builds is
// one the database will take.

export const PDF_BUCKET = 'quote-pdfs';

// The bucket refuses anything larger (script 129, file_size_limit).
export const PDF_MAX_BYTES = 25 * 1024 * 1024;

// Vercel caps a function request body at 4.5 MB. A PDF up to this size goes to
// the route in the request; a larger one goes by its path in the bucket, and the
// route downloads it.
export const PDF_DIRECT_MAX_BYTES = 4 * 1024 * 1024;

export const PDF_PATH_RE = /^(draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9]+-[^/]+[.]pdf$/i;

// <quote id or 'draft'>/<timestamp>-<name>.pdf, the name cut down to letters,
// digits, dots, dashes and underscores so it is safe in a storage key.
export function pdfPathFor(quoteId, fileName) {
  const base = String(fileName || 'quote').replace(/[.]pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'quote';
  return (quoteId || 'draft') + '/' + Date.now() + '-' + base + '.pdf';
}
