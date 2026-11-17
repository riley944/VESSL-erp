import { describe, expect, it } from 'vitest';
import { productQuoteLinks } from '@/lib/productQuote';

describe('product-originated quote links', () => {
  it('links a new quote to the exact product and client', () => {
    expect(productQuoteLinks({ __productId: 'p1', __clientId: 'c1', __clientName: 'Acme Inc.', client: 'Acme' })).toEqual({ row: { product_id: 'p1', client_company_id: 'c1' }, clientId: 'c1' });
  });
  it('rejects a different client rather than linking mismatched records', () => {
    expect(productQuoteLinks({ __productId: 'p1', __clientId: 'c1', __clientName: 'Acme', client: 'Other' }).error).toMatch(/must match/);
  });
  it('does not change an existing quote link during a retry', () => {
    expect(productQuoteLinks({ id: 'q1', __productId: 'p1', __clientId: 'c1', __clientName: 'Acme', client: 'Acme' }).row).toEqual({});
  });
  it('leaves ordinary and unassigned quotes available to the existing save flow', () => {
    expect(productQuoteLinks({ client: 'Acme' })).toEqual({ row: {}, clientId: null });
    expect(productQuoteLinks({ __productId: 'p1' })).toEqual({ row: { product_id: 'p1', client_company_id: null }, clientId: null });
  });
});
