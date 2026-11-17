import { expect, it } from 'vitest';
import { factoryProductIds } from '@/lib/factoryProducts';

it('deduplicates quote and order products, prefers IDs and only matches unique legacy names', () => {
  const result = factoryProductIds([
    { id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' },
    { id: 'c', name: 'Twin' }, { id: 'd', name: 'twin' },
  ], [
    { factory_company_id: 'a', factory: 'Beta', product_id: 'p1' },
    { factory: ' ALPHA ', product_id: 'p1' },
    { factory: 'Twin', product_id: 'p2' },
    { factory: 'Beta', product_id: 'p3' },
  ], [{ product_id: 'p1', purchase_orders: { factory_company_id: 'a' } }, { product_id: 'p4', purchase_orders: { factory_company_id: 'a' } }]);
  expect([...result.get('a')]).toEqual(['p1', 'p4']);
  expect([...result.get('b')]).toEqual(['p3']);
  expect(result.has('c')).toBe(false);
  expect(result.has('d')).toBe(false);
});
