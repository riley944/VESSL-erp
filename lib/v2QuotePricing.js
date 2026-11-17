import { htsRateFor } from '@/lib/quoteTiers';

// Matches the existing quote editor: unknown rates and blank prices are not zero.
export function calculatedDuty(price, rate) {
  const amount = Number(price);
  if (!Number.isFinite(rate) || price === '' || price == null || !Number.isFinite(amount) || amount <= 0) return '';
  return String(+(amount * rate / 100).toFixed(4));
}

export function dutyForCode(price, code, codes) {
  return calculatedDuty(price, htsRateFor(code, codes));
}

const numberOrBlank = value => value === '' || value == null ? null : Number(value);
const freightValues = tier => {
  const air = numberOrBlank(tier.freightAir);
  const ocean = numberOrBlank(tier.freightOcean);
  return [air == null && ocean == null ? null : (tier.ship || 'ocean'), air, ocean, numberOrBlank(tier.duty)];
};

// A removed tier cannot change the freight on the tiers that remain. New tiers
// count only once a freight or duty figure is entered.
export function freightChanged(current, original) {
  const before = new Map(original.map(tier => [tier.__v2TierKey, freightValues(tier)]));
  return current.some(tier => {
    const values = freightValues(tier);
    const previous = before.get(tier.__v2TierKey);
    return previous ? JSON.stringify(values) !== JSON.stringify(previous) : values.some(value => value != null);
  });
}
