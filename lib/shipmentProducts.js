import { SB } from '@/lib/supabase';

// ── A SHIPMENT'S FACTORIES, AND ITS PRODUCTS WITH THEIR QUOTES ──────────────
// Read when a shipment card opens (desktop and /m); nothing is stored. A
// shipment reaches its products only through its POs (shipment_pos):
//
//   factories  the linked POs' factories, by name, each once
//   lines      one per distinct product across those POs' lines -- by product,
//              else by SKU, else by description -- with
//                sku       the line's product_sku, else the product's SKU
//                name      the product's name, else the line's description
//                noSku     the line has neither product_sku nor a product -- it
//                          is kept, by its description, and reads as such
//                quote     { code, via } or null:
//                            via 'so'     an SO line on a Sales Order this PO is
//                                         on names a quote (sales_order_items.
//                                         quote_id) for the same product
//                            via 'latest' else the product's newest quote
//                companies "client · factory" of each PO the product is on
//
// sales_order_items.quote_id has no foreign key, so an id that names no quote
// any more falls through to the product's newest quote.
export async function loadShipmentProducts(shipmentId) {
  const { data: links, error } = await SB.from('shipment_pos')
    .select('purchase_orders(id,factory:companies!factory_company_id(name),client:companies!client_company_id(name),'
      + 'purchase_order_items(product_id,product_sku,description,products(sku,name)))')
    .eq('shipment_id', shipmentId);
  if (error) return { error: error.message, factories: [], lines: [] };
  const pos = (links || []).map(l => l.purchase_orders).filter(Boolean);
  const factories = [...new Set(pos.map(p => (p.factory || {}).name).filter(Boolean))];
  const poIds = pos.map(p => p.id);
  const productIds = [...new Set(pos.flatMap(p => (p.purchase_order_items || []).map(i => i.product_id)).filter(Boolean))];

  // PO id -> product id -> the quote an SO line names.
  const soQuote = {};
  if (poIds.length && productIds.length) {
    const { data: sop } = await SB.from('sales_order_pos').select('sales_order_id,purchase_order_id').in('purchase_order_id', poIds);
    const soIds = [...new Set((sop || []).map(x => x.sales_order_id))];
    if (soIds.length) {
      const { data: soi } = await SB.from('sales_order_items').select('sales_order_id,product_id,quote_id')
        .in('sales_order_id', soIds).not('quote_id', 'is', null);
      (sop || []).forEach(x => (soi || []).forEach(l => {
        if (l.sales_order_id !== x.sales_order_id || !l.product_id) return;
        const m = soQuote[x.purchase_order_id] = soQuote[x.purchase_order_id] || {};
        if (!m[l.product_id]) m[l.product_id] = l.quote_id;
      }));
    }
  }
  const linkedIds = [...new Set(Object.values(soQuote).flatMap(m => Object.values(m)))];
  const codeById = {};
  const latestByProduct = {};
  if (linkedIds.length) {
    const { data } = await SB.from('quotes').select('id,quote_code').in('id', linkedIds);
    (data || []).forEach(q => { codeById[q.id] = q.quote_code; });
  }
  if (productIds.length) {
    const { data } = await SB.from('quotes').select('product_id,quote_code,created_at')
      .in('product_id', productIds).order('created_at', { ascending: false });
    (data || []).forEach(q => { if (!latestByProduct[q.product_id]) latestByProduct[q.product_id] = q.quote_code; });
  }

  const byKey = new Map();
  pos.forEach(p => (p.purchase_order_items || []).forEach(it => {
    const prod = it.products || {};
    const sku = String(it.product_sku || prod.sku || '').trim();
    const noSku = !sku && !it.product_id;
    const name = String(prod.name || it.description || '').trim() || (noSku ? 'No description' : '');
    const key = it.product_id ? 'p:' + it.product_id : sku ? 's:' + sku.toLowerCase() : 'd:' + name.toLowerCase();
    const linked = it.product_id && (soQuote[p.id] || {})[it.product_id];
    const quote = linked && codeById[linked] ? { code: codeById[linked], via: 'so' }
      : it.product_id && latestByProduct[it.product_id] ? { code: latestByProduct[it.product_id], via: 'latest' }
      : null;
    const company = [(p.client || {}).name, (p.factory || {}).name].filter(Boolean).join(' · ');
    const row = byKey.get(key);
    if (!row) { byKey.set(key, { key, sku, name, noSku, quote, companies: company ? [company] : [] }); return; }
    if (quote && (!row.quote || (row.quote.via === 'latest' && quote.via === 'so'))) row.quote = quote;
    if (company && !row.companies.includes(company)) row.companies.push(company);
  }));
  return { error: '', factories, lines: [...byKey.values()] };
}

// What a quote cell's tooltip says about where its code came from.
export const quoteVia = q => !q ? 'No quote for this product'
  : q.via === 'so' ? 'The quote its Sales Order line names' : 'The product’s latest quote';
