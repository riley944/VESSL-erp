// POST /api/orders/extract -- read a client's purchase order PDF with Claude and
// hand the sales order form back what it says: the header fields, each with a
// confidence and the words it came from, and the lines grouped the way the form
// holds them (one line per item, with its size quantities). Script 134.
//
// It WRITES NOTHING. No sales order, company or product is created or changed
// here; the form decides what to apply, and nothing is saved until Save.
//
// Two ways in, as /api/quotes/extract: multipart `file` (up to 4 MB) or JSON
// { path } in the order-pdfs bucket, read back as the caller. The gate, the PDF
// handling and the model call are lib/pdfExtract.js; the PO prompt, schema and
// the checks against what the ERP already holds are lib/orderExtract.js.

import { runExtract, json } from '@/lib/pdfExtract';
import { SYSTEM, SCHEMA, shapeOrder } from '@/lib/orderExtract';
import { ORDER_PDF_BUCKET, ORDER_PDF_MAX_BYTES, ORDER_PDF_DIRECT_MAX_BYTES, ORDER_PDF_PATH_RE } from '@/lib/orderPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A long retail PO can take a minute or two to read.
export const maxDuration = 300;

export async function POST(req) {
  // Steps 1 to 3 -- configuration, the caller, the PDF, Claude reading it.
  const r = await runExtract(req, {
    bucket: ORDER_PDF_BUCKET, pathRe: ORDER_PDF_PATH_RE, maxBytes: ORDER_PDF_MAX_BYTES, directMaxBytes: ORDER_PDF_DIRECT_MAX_BYTES,
    system: SYSTEM, schema: SCHEMA, prompt: 'Report what this purchase order says.',
  });
  if (r.response) return r.response;
  const { sb, out, msg } = r;

  // ── 4. WHAT THE ERP HOLDS, read as the caller, and the answer checked against it.
  const [cos, cts, prods, qts] = await Promise.all([
    sb.from('companies').select('id,name,email,vendor_number').eq('type', 'client'),
    sb.from('contacts').select('company_id,email'),
    sb.from('products').select('id,sku,name,active'),
    sb.from('quotes').select('id,quote_code,sku,product,client,product_id'),
  ]);
  const shaped = shapeOrder(out, {
    companies: cos.data || [], contacts: cts.data || [], products: prods.data || [], quotes: qts.data || [],
    readErrors: { companies: cos.error ? cos.error.message : '', products: prods.error ? prods.error.message : '' },
  });
  return json({
    ok: true,
    ...shaped,
    model: msg.model,
    usage: { input: msg.usage?.input_tokens ?? null, output: msg.usage?.output_tokens ?? null },
  }, 200);
}
