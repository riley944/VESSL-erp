import { describe, expect, it } from 'vitest';
import { calculatedDuty, dutyForCode, freightChanged } from '@/lib/v2QuotePricing';

describe('V2 quote pricing', () => {
  it('calculates duty to four decimals without inventing a rate or price', () => {
    expect(calculatedDuty('1.23456', 12.5)).toBe('0.1543');
    expect(calculatedDuty('10', 0)).toBe('0');
    expect(calculatedDuty('', 10)).toBe('');
    expect(calculatedDuty('10', null)).toBe('');
    expect(calculatedDuty('10', NaN)).toBe('');
    expect(dutyForCode('10', 'A', [{ code: 'A', total_duty: 10 }, { code: 'A', total_duty: 20 }])).toBe('');
  });

  it('ignores unrelated tier additions, removals, ordering and numeric formatting', () => {
    const original = [{ __v2TierKey: 'a', freightOcean: 1, ship: 'ocean' }, { __v2TierKey: 'b', freightAir: 2, ship: 'air' }];
    expect(freightChanged([{ __v2TierKey: 'b', freightAir: '2.0', ship: 'air' }, { __v2TierKey: 'new', qty: 200, ship: 'ocean', duty: '' }], original)).toBe(false);
    expect(freightChanged([{ __v2TierKey: 'a', freightOcean: 2, ship: 'ocean' }], original)).toBe(true);
    expect(freightChanged([...original, { __v2TierKey: 'new', duty: 0 }], original)).toBe(true);
  });
});
