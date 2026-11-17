// Quotes created before factory IDs were introduced can still carry a name only.
// Use it only when it identifies one factory, and never override a saved ID.
export function factoryProductIds(factories, quotes, items) {
  const names = new Map();
  factories.forEach(factory => {
    const key = (factory.name || '').trim().toLowerCase();
    if (key) names.set(key, names.has(key) ? null : factory.id);
  });
  const result = new Map();
  const add = (factoryId, productId) => {
    if (!factoryId || !productId) return;
    if (!result.has(factoryId)) result.set(factoryId, new Set());
    result.get(factoryId).add(productId);
  };
  quotes.forEach(quote => add(quote.factory_company_id || names.get((quote.factory || '').trim().toLowerCase()), quote.product_id));
  items.forEach(item => add(item.purchase_orders?.factory_company_id, item.product_id));
  return result;
}
