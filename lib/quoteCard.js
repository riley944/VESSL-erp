import { SB } from '@/lib/supabase';
import { productByKey } from '@/lib/products';

// ── A PLM CARD FROM A QUOTE ─────────────────────────────────────────────────
// The steps Create PLM Card on a quote takes, shared so the PLM page's Quote ID
// box (and the Quotes page's "Saved as" confirmation) take exactly the same ones
// and cannot come to disagree about what a quote needs to have a card.

// What somebody typed, as a Quote ID -- or null. Forgiving on purpose: Q-0356,
// q356, Q-356, 0356 and 356 are all Q-0356. The letters, hyphens, spaces and
// leading zeros are dropped and the number is padded back to four digits, the
// way script 103 issues them.
export function parseQuoteCode(input) {
  const digits = String(input || '').replace(/[^0-9]/g, '').replace(/^0+/, '');
  if (!digits) return null;
  return 'Q-' + digits.padStart(4, '0');
}

export async function findQuoteByCode(code) {
  const { data, error } = await SB.from('quotes')
    .select('id,quote_code,sku,product,client,product_id,client_company_id,updated_by')
    .eq('quote_code', code).limit(1);
  if (error) return { error };
  return { quote: (data && data[0]) || null };
}

// ── RESOLVE BEFORE REFUSING ──────────────────────────────────────────────────
// Moved verbatim in meaning from MarkWonButton. A null link is not the same as
// an unlinkable quote: a quote saved before the links were kept, or whose
// company was added afterwards, can be resolvable and still read null. So the
// client is looked up by name (trimmed, case-insensitive, EXACTLY one hit) and
// the product by SKU and name through productByKey, never creating one and never
// adopting a retired one. What it finds it writes back to the quote, guarded by
// is(null) so a link somebody made meanwhile wins.
//
// Returns { row, productId, clientId, needsProduct, needsClient } or { error }.
export async function resolveQuoteLinks(quoteId) {
  const { data: row, error } = await SB.from('quotes')
    .select('id,quote_code,product_id,client_company_id,client,sku,product,updated_by').eq('id', quoteId).single();
  if (error) return { error };
  let productId = (row && row.product_id) || null;
  let clientId  = (row && row.client_company_id) || null;

  if (!clientId) {
    const name = ((row && row.client) || '').trim();
    if (name) {
      const { data: hits } = await SB.from('companies').select('id').ilike('name', name);
      if (hits && hits.length === 1) {
        clientId = hits[0].id;
        try { await SB.from('quotes').update({ client_company_id: clientId }).eq('id', quoteId).is('client_company_id', null); } catch (e) {}
      }
    }
  }
  if (!productId) {
    const p = await productByKey((row && row.sku) || '', (row && row.product) || '');
    if (p && p.active !== false) {
      productId = p.id;
      try { await SB.from('quotes').update({ product_id: productId }).eq('id', quoteId).is('product_id', null); } catch (e) {}
    }
  }
  return { row, productId, clientId, needsProduct: !productId, needsClient: !clientId };
}

// The card for a product and client, if there is one -- including one removed
// from the board. One at most: programs is unique on the pair.
export async function existingCardFor(productId, clientId) {
  const { data, error } = await SB.from('programs')
    .select('id,declared_stage,archived,source_quote:quotes!programs_source_quote_id_fkey(quote_code)')
    .eq('product_id', productId).eq('client_company_id', clientId).limit(1);
  if (error) return { error };
  return { card: (data && data[0]) || null };
}

// "needs a product and a client" -- the words both refusals use.
export const missingWords = (needsProduct, needsClient) =>
  needsProduct && needsClient ? 'a product and a client'
  : needsProduct ? 'a product' : 'a client';
