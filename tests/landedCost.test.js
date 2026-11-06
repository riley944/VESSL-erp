import { describe, expect, it } from 'vitest';
import { landedCost, parseRates, RATE_DEFAULTS } from '@/lib/landedCost';

describe('landed cost', () => {
  it('calculates fees and duty without adding the goods value to the total', () => {
    const result = landedCost({
      lines: [{ qty: 100, unitCost: 10, dutyRate: 5 }],
      freight: 200,
      rates: { mpf_rate: 1, mpf_min: 0, mpf_max: 100, hmf_rate: 1, dis_rate: 0, insurance_rate: 0 },
    });
    expect(result).toMatchObject({ ci: 1000, mpf: 10, hmf: 10, duty: 50, total: 270, perUnit: 2.7, missing: [] });
  });

  it('clamps the MPF to its configured floor and ceiling', () => {
    const rates = { mpf_rate: 1, mpf_min: 10, mpf_max: 100, insurance_rate: 0 };
    expect(landedCost({ lines: [{ qty: 1, unitCost: 100, dutyRate: 0 }], freight: 1, rates })).toMatchObject({ mpf: 10, mpfClamped: 'min' });
    expect(landedCost({ lines: [{ qty: 1, unitCost: 20000, dutyRate: 0 }], freight: 1, rates })).toMatchObject({ mpf: 100, mpfClamped: 'max' });
  });

  it('reports missing figures and treats all-in freight as the total', () => {
    expect(landedCost({ lines: [{ qty: 10 }] }).missing).toEqual([
      { line: 0, what: 'cost' }, { line: 0, what: 'duty' }, { what: 'freight' },
    ]);
    expect(landedCost({ lines: [{ qty: 10 }], freight: 500, allIn: true })).toMatchObject({ total: 500, perUnit: 50, missing: [] });
  });

  it('rejects an MPF minimum above its maximum', () => {
    expect(parseRates({ ...RATE_DEFAULTS, mpf_min: 100, mpf_max: 50 })).toEqual({ error: 'MPF minimum cannot be above the MPF maximum.' });
  });
});
