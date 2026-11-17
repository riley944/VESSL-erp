import { DUTY_SPLIT_AT } from '@/lib/quoteRow';
import { freightChanged } from '@/lib/v2QuotePricing';

const FIELDS = ['quote_date', 'notes', 'client_contact', 'client_email', 'client_phone', 'client_address', 'factory', 'factory_company_id', 'factory_contact', 'factory_email', 'factory_phone', 'country', 'lead_time', 'hts', 'units_per_carton', 'carton_l', 'carton_w', 'carton_h', 'carton_weight', 'mold_fee', 'sample_fee', 'client_details', 'client_color'];
const NUMBERS = new Set(['units_per_carton', 'carton_l', 'carton_w', 'carton_h', 'carton_weight', 'mold_fee', 'sample_fee']);
const TIER_NUMBERS = ['qty', 'landed', 'freightAir', 'freightOcean', 'duty', 'client'];

export const emptyTier = () => ({ qty: '', landed: '', ship: 'ocean', freightAir: '', freightOcean: '', duty: '', client: '' });

export function initialQuoteForm(quote) {
  const fields = Object.fromEntries(FIELDS.map(key => [key, quote?.[key] == null ? '' : String(quote[key])]));
  if (!quote) fields.quote_date = new Date().toISOString().slice(0, 10);
  let tiers = quote?.tiers;
  let invalidTiers = false;
  if (typeof tiers === 'string') { try { tiers = JSON.parse(tiers); } catch { invalidTiers = true; tiers = null; } }
  if (tiers != null && (!Array.isArray(tiers) || tiers.some(tier => !tier || typeof tier !== 'object' || Array.isArray(tier)))) invalidTiers = true;
  if (invalidTiers) return { ...fields, tiers: [], invalidTiers: true };
  if (!Array.isArray(tiers) || !tiers.length) {
    tiers = quote && (quote.qty != null || quote.landed != null)
      ? [{ ...emptyTier(), qty: quote.qty ?? '', landed: quote.landed ?? '', freightOcean: quote.freight_duty ?? '' }]
      : [];
  }
  const savedAt = Date.parse(quote?.freight_duty_updated_at || quote?.updated_at || '');
  tiers = tiers.map((tier, index) => {
    const hasFreight = [tier.freightAir, tier.freightOcean, tier.freightDuty].some(value => value !== '' && value != null);
    const legacyDuty = savedAt < DUTY_SPLIT_AT && (tier.duty === '' || tier.duty == null) && hasFreight;
    const result = { ...tier, __v2TierKey: `stored-${index}`, __v2LegacyDuty: legacyDuty };
    const activeFreight = tier.ship === 'air' ? 'freightAir' : 'freightOcean';
    if (tier.freightDuty != null && tier.freightDuty !== '' && (tier[activeFreight] == null || tier[activeFreight] === '')) {
      result[activeFreight] = tier.freightDuty;
    }
    return result;
  });
  return { ...fields, tiers, invalidTiers: false };
}

export function quoteChanges(form, original, savedQuote, selectedProduct) {
  const payload = {};
  for (const key of FIELDS) {
    if (savedQuote && form[key] === original[key]) continue;
    const value = form[key];
    payload[key] = value === '' ? null : NUMBERS.has(key) ? Number(value) : value;
  }
  const tiersChanged = JSON.stringify(form.tiers) !== JSON.stringify(original.tiers);
  if (tiersChanged || !savedQuote) {
    const tiers = form.tiers.map(tier => {
      const result = { ...tier };
      delete result.__v2TierKey;
      delete result.__v2LegacyDuty;
      TIER_NUMBERS.forEach(key => { if (key in result) result[key] = result[key] === '' || result[key] == null ? null : Number(result[key]); });
      return result;
    });
    payload.tiers = tiers;
    const first = tiers[0] || {};
    payload.qty = first.qty ?? null;
    payload.landed = first.landed ?? null;
    payload.freight_duty = (first.ship === 'air' ? first.freightAir : first.freightOcean) ?? null;
  }
  if (!savedQuote) Object.assign(payload, {
    product_id: selectedProduct.productId, client_company_id: selectedProduct.clientId || null,
    product: selectedProduct.product || null, client: selectedProduct.client || null, sku: selectedProduct.sku || null,
  });
  return {
    payload,
    changedFreight: tiersChanged && freightChanged(form.tiers, original.tiers),
    legacyRemains: form.tiers.some(tier => tier.__v2LegacyDuty),
  };
}
