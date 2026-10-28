// Factory quote PDFs: where they are stored and how big they may be. Shared by the
// quote form (which uploads) and /api/quotes/extract (which reads), so the two
// cannot disagree about a path or a limit.
//
// The bucket and its policies are script 129. The INSERT policy accepts only the
// path shape below -- PDF_PATH_RE is the same pattern, so a path this builds is
// one the database will take.

export const PDF_BUCKET = 'quote-pdfs';

// THE QUOTE PDF IMPORT SHIPS HIDDEN. On only when NEXT_PUBLIC_QUOTE_PDF_IMPORT is
// exactly '1'. Off, the quote form renders no import bar and no View PDF -- as it
// was before the import existed -- and /api/quotes/extract answers 404 before it
// looks at the caller or the upload. NEXT_PUBLIC_, so the browser bundle sees the
// same value the route does; it is baked in at build time. The sales order PO
// import (lib/orderPdf.js, /api/orders/extract) is not behind this flag.
export const QUOTE_PDF_IMPORT = process.env.NEXT_PUBLIC_QUOTE_PDF_IMPORT === '1';

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

// The file name a stored path was uploaded as: pdfPathFor's
// <quote id or draft>/<timestamp>-<name>.pdf, without the folder and the
// timestamp. Every import uploads afresh under a new timestamp, so the same
// PDF imported twice has two paths but this one name.
export function pdfFileNameOf(path) {
  const last = String(path || '').split('/').pop() || '';
  return last.replace(/^[0-9]+-/, '');
}
// The source key the duplicate guard compares: that name, case ignored.
export const pdfSourceKey = (path) => pdfFileNameOf(path).toLowerCase();

// The import highlight amber (PdfSays XC.medium): sibling quotes of one PDF on hover,
// and a quote's own row in the PDF viewer.
export const SIBLING_OUTLINE = '#d39a2c';
