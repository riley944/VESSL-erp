// Client PO PDFs: where they are stored and how big they may be. Shared by the
// sales order form (which uploads) and /api/orders/extract (which reads), so the
// two cannot disagree about a path or a limit. The quote-side twin is
// lib/quotePdf.js.
//
// The bucket and its policies are script 134. The INSERT policy accepts only the
// path shape below -- ORDER_PDF_PATH_RE is the same pattern, so a path this
// builds is one the database will take.

export const ORDER_PDF_BUCKET = 'order-pdfs';

// The bucket refuses anything larger (script 134, file_size_limit).
export const ORDER_PDF_MAX_BYTES = 25 * 1024 * 1024;

// Vercel caps a function request body at 4.5 MB. A PDF up to this size goes to
// the route in the request; a larger one goes by its path in the bucket.
export const ORDER_PDF_DIRECT_MAX_BYTES = 4 * 1024 * 1024;

export const ORDER_PDF_PATH_RE = /^(draft|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9]+-[^/]+[.]pdf$/i;

// <sales order id or 'draft'>/<timestamp>-<name>.pdf, the name cut down to
// letters, digits, dots, dashes and underscores so it is safe in a storage key.
export function orderPdfPathFor(soId, fileName) {
  const base = String(fileName || 'po').replace(/[.]pdf$/i, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'po';
  return (soId || 'draft') + '/' + Date.now() + '-' + base + '.pdf';
}
