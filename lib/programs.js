import { SB } from '@/lib/supabase';

// ── A PROGRAM IS CREATED BY THE WORK, NOT BY A FORM ─────────────────────────
// Quoting a product for a client, selling it to them, or ordering it for them
// IS the program starting. Nobody should have to remember to declare one, and
// the seed in script 48 was built from exactly these three records -- so the
// live paths have to keep doing what the seed did, or the table drifts from the
// day it was created.
//
// IDEMPOTENT BY CONSTRAINT, not by checking first. programs carries
// UNIQUE (product_id, client_company_id), so this upserts with
// ignoreDuplicates and lets the database decide what is new. No read, no race,
// no chance of two saves creating two programs for the same pair.
//
// IT NEVER UPDATES, and that is deliberate. ignoreDuplicates means an existing
// row is left completely alone -- including its archived flag and its declared
// stage. A program somebody archived by hand must not be resurrected because a
// new order line arrived, and un-retiring a product must not silently reopen
// work. Archiving stays with the retire action, per the phase 2A decision.
//
// FAILURES ARE RETURNED, NOT THROWN. Every caller is a save that has already
// succeeded -- the sales order exists, the quote is marked won -- and a program
// that did not get created is a missing row somebody can fix from the Programs
// page with one button. Interrupting a completed save with an alert about
// bookkeeping would be the wrong trade.
export async function ensurePrograms(pairs) {
  const seen = new Set();
  const rows = [];
  for (const [productId, clientId] of pairs || []) {
    if (!productId || !clientId) continue;      // an unlinked line names no program
    const k = productId + '|' + clientId;
    if (seen.has(k)) continue;                  // several lines, one program
    seen.add(k);
    rows.push({ product_id: productId, client_company_id: clientId });
  }
  if (!rows.length) return { attempted: 0, error: null };
  const { error } = await SB.from('programs')
    .upsert(rows, { onConflict: 'product_id,client_company_id', ignoreDuplicates: true });
  return { attempted: rows.length, error: error || null };
}

// Every product-and-client pair the records prove, read fresh. The same three
// sources script 48 seeded from, in the same order, so the sweep and the seed
// cannot disagree about what a program is.
export async function pairsFromRecords() {
  const [q, poi, soi] = await Promise.all([
    SB.from('quotes').select('product_id,client_company_id').not('product_id','is',null).not('client_company_id','is',null),
    SB.from('purchase_order_items').select('product_id,purchase_orders(client_company_id)').not('product_id','is',null),
    SB.from('sales_order_items').select('product_id,sales_orders(client_company_id)').not('product_id','is',null),
  ]);
  const err = [q, poi, soi].find(r => r.error);
  if (err) throw new Error(err.error.message);
  const out = [];
  (q.data   || []).forEach(r => out.push([r.product_id, r.client_company_id]));
  (poi.data || []).forEach(r => out.push([r.product_id, (r.purchase_orders || {}).client_company_id]));
  (soi.data || []).forEach(r => out.push([r.product_id, (r.sales_orders   || {}).client_company_id]));
  return out.filter(([p, c]) => p && c);
}
