import { describe, expect, it } from 'vitest';
import { recordLookupColumn, recordPath } from '@/lib/v2RecordPaths';

describe('V2 record paths', () => {
  it('uses and encodes visible identifiers', () => {
    expect(recordPath('product', { id: 'p1', style_number: 'ABC/123 1' })).toBe('/v2/products/ABC%2F123%201');
    expect(recordPath('quote', { id: 'q1', quote_code: 'Q-123' })).toBe('/v2/quotes/Q-123');
    expect(recordLookupColumn('product', 'ABC-123')).toBe('style_number');
    expect(recordLookupColumn('quote', 'Q-123')).toBe('quote_code');
  });

  it('uses the database ID when an identifier is missing', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000';
    expect(recordPath('product', { id, style_number: null })).toBe(`/v2/products/${id}`);
    expect(recordPath('quote', { id, quote_code: null })).toBe(`/v2/quotes/${id}`);
    expect(recordLookupColumn('product', id)).toBe('id');
    expect(recordLookupColumn('quote', id.toUpperCase())).toBe('id');
  });
});
