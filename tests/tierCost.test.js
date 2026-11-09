import { describe, expect, it } from 'vitest';
import { effectiveQty, tierTotalCost } from '@/lib/tierCost';

describe('quote tier costs', () => {
  it('uses the size mix instead of a stale tier quantity', () => {
    expect(effectiveQty({ qty: 999, sizeQty: { small: '20', large: '30' } })).toBe(50);
    expect(effectiveQty({ qty: '100', sizeQty: { small: '' } })).toBe(100);
  });

  it('includes freight, duty and the mold fee per unit', () => {
    expect(tierTotalCost({ qty: 100, landed: 10, freightOcean: 2, duty: 1 }, 100)).toBe(14);
  });

  it('weights size-specific costs and duty by quantity', () => {
    const tier = {
      sizeQty: { small: 75, large: 25 },
      sizeCost: { small: { landed: 10 }, large: { landed: 20 } },
      freightOcean: 1,
    };
    expect(tierTotalCost(tier, 100, 10)).toBeCloseTo(15.75);
  });
});
