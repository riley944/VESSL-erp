import { effectiveQty } from '@/lib/tierCost';

// ── LANDED COST ──────────────────────────────────────────────────────────────
// What a shipment costs delivered, worked out the way Kristy's freight sheet
// does it: the commercial invoice (CI) value, the forwarder's freight, the CBP
// merchandise processing fee (MPF, clamped to its floor and ceiling), the harbor
// maintenance fee (HMF), duty per item, DIS and cargo insurance. Pure -- no DOM,
// no network.
//
// THE RATES live on vessl.kui_settings (script 133) and are edited in Settings,
// Landed cost rates. CBP resets the MPF floor and ceiling every fiscal year from
// 1 October, which is why they are settings and not constants here.

// Every rate the panel uses, in the order Settings shows them. short is the
// one-line Settings label; label names the rate in an error. min and max are the
// bounds the database CHECK enforces (kui_settings_landed_rates_check).
export const RATE_FIELDS = [
  { key: 'mpf_rate',         short: 'MPF rate %',      label: 'MPF rate',        min: 0,   max: 100 },
  { key: 'mpf_min',          short: 'MPF min $',       label: 'MPF minimum',     min: 0,   max: null },
  { key: 'mpf_max',          short: 'MPF max $',       label: 'MPF maximum',     min: 0,   max: null },
  { key: 'hmf_rate',         short: 'HMF rate %',      label: 'HMF rate',        min: 0,   max: 100 },
  { key: 'dis_rate',         short: 'DIS rate %',      label: 'DIS rate',        min: 0,   max: 100 },
  { key: 'insurance_rate',   short: 'Insurance %',     label: 'Insurance rate',  min: 0,   max: 100 },
  { key: 'insurance_uplift', short: 'Insured value %', label: 'Insured value',   min: 100, max: 200 },
];
export const RATE_KEYS = RATE_FIELDS.map(f => f.key);
// The script 133 defaults, used for any rate the row does not carry -- before
// 133 has run, or if a value is somehow unreadable.
export const RATE_DEFAULTS = {
  mpf_rate: 0.3464, mpf_min: 34.58, mpf_max: 670.86, hmf_rate: 0.125,
  dis_rate: 2.5, insurance_rate: 0.4, insurance_uplift: 110,
};

// True once script 133 has run: the settings row carries every rate column.
export const hasRateColumns = row => !!row && RATE_KEYS.every(k => k in row);

// The rates to calculate with: the saved ones, the defaults for any missing.
export function ratesFrom(row) {
  const out = { ...RATE_DEFAULTS };
  RATE_KEYS.forEach(k => {
    const raw = row ? row[k] : null;
    const v = Number(raw);
    if (raw != null && raw !== '' && isFinite(v)) out[k] = v;
  });
  return out;
}

// Typed values from the Settings form -> { values } to save, or { error }.
export function parseRates(form) {
  const values = {};
  for (const f of RATE_FIELDS) {
    const t = String(form[f.key] == null ? '' : form[f.key]).trim();
    const v = Number(t);
    if (t === '' || !isFinite(v)) return { error: f.label + ' must be a number.' };
    if (v < f.min || (f.max != null && v > f.max)) {
      return { error: f.label + ' must be ' + (f.max != null ? 'between ' + f.min + ' and ' + f.max : 'at least ' + f.min) + '.' };
    }
    values[f.key] = v;
  }
  if (values.mpf_min > values.mpf_max) return { error: 'MPF minimum cannot be above the MPF maximum.' };
  return { values };
}

// ── THE CALCULATION ─────────────────────────────────────────────────────────
// lines   [{ qty, unitCost, dutyRate }] -- dutyRate a percent (the HTS library's
//         total_duty), or null when unknown. Other keys ride along untouched.
// freight the bid's freight for the whole shipment, USD.
// rates   a kui_settings row (or anything ratesFrom accepts).
// allIn   the bid is an all-in price: it IS the landed total, and duty, the CBP
//         fees, DIS and insurance are included in it rather than added.
//
// Returns every figure the panel shows, plus missing[] -- { line, what } for a
// line with no cost ('cost') or no duty rate ('duty'), and { what:'freight' }
// for a bid with no freight figure. A result with anything missing is
// incomplete: its total leaves those pieces out and must not be read as landed.
//
//   ci        sum of qty x unitCost -- the goods value. ONLY the base the fees
//             are worked from; it is never part of total.
//   mpf       ci x mpf_rate, clamped to [mpf_min, mpf_max]; mpfClamped says which
//   hmf       ci x hmf_rate
//   duty      per line value x dutyRate, summed
//   dis       dis_rate x (mpf + hmf + duty)
//   insurance insurance_rate x uplift x (ci + freight + mpf + hmf + duty + dis)
//   total     freight + mpf + hmf + duty + dis + insurance (no ci): what landing
//             the goods adds on top of what they cost
//   perUnit   total over the units on the lines
export function landedCost({ lines = [], freight = null, rates = null, allIn = false } = {}) {
  const r = ratesFrom(rates);
  const missing = [];
  const out = lines.map((l, i) => {
    const qty = Number(l.qty), cost = Number(l.unitCost);
    const value = qty > 0 && cost > 0 ? qty * cost : null;
    const raw = l.dutyRate;
    const dutyRate = raw == null || raw === '' || !isFinite(Number(raw)) ? null : Number(raw);
    if (!allIn) {
      if (value == null) missing.push({ line: i, what: 'cost' });
      if (dutyRate == null) missing.push({ line: i, what: 'duty' });
    }
    return { ...l, value, dutyRate, duty: value != null && dutyRate != null ? value * dutyRate / 100 : null };
  });
  const units = out.reduce((a, l) => a + (Number(l.qty) > 0 ? Number(l.qty) : 0), 0);
  const f = Number(freight);
  const fr = freight != null && freight !== '' && isFinite(f) && f > 0 ? f : null;
  if (fr == null) missing.push({ what: 'freight' });
  const ci = out.reduce((a, l) => a + (l.value || 0), 0);
  if (allIn) {
    // The bid is the freight-and-fees total; nothing is added to it, and ci is
    // not either.
    return { allIn: true, included: true, lines: out, units, rates: r, ci, freight: fr,
             mpf: null, mpfClamped: null, hmf: null, duty: null, dis: null, insurance: null,
             total: fr, perUnit: fr != null && units > 0 ? fr / units : null, missing };
  }
  const mpfRaw = ci * r.mpf_rate / 100;
  const mpf = Math.min(Math.max(mpfRaw, r.mpf_min), r.mpf_max);
  const mpfClamped = mpf > mpfRaw ? 'min' : mpf < mpfRaw ? 'max' : null;
  const hmf = ci * r.hmf_rate / 100;
  const duty = out.reduce((a, l) => a + (l.duty || 0), 0);
  const dis = r.dis_rate / 100 * (mpf + hmf + duty);
  const insurance = r.insurance_rate / 100 * (r.insurance_uplift / 100) * (ci + (fr || 0) + mpf + hmf + duty + dis);
  // ci is the fee base only -- it is not summed into the total.
  const total = (fr || 0) + mpf + hmf + duty + dis + insurance;
  return { allIn: false, included: false, lines: out, units, rates: r, ci, freight: fr,
           mpf, mpfClamped, hmf, duty, dis, insurance, total,
           perUnit: units > 0 ? total / units : null, missing };
}

// A product quote's factory unit price at the tier nearest a quantity. The
// price is the tier's `landed` field, which holds the EXW price despite its name
// (lib/tierCost.js reads it the same way). null when no tier is priced.
export function tierUnitCost(tiers, qty) {
  const priced = (Array.isArray(tiers) ? tiers : []).filter(t => Number(t && t.landed) > 0);
  if (!priced.length) return null;
  const want = Number(qty) || 0;
  const best = priced.reduce((a, t) => (Math.abs(effectiveQty(t) - want) < Math.abs(effectiveQty(a) - want) ? t : a));
  return Number(best.landed);
}

// An HTS code's duty percent from the active library rows ({ code, total_duty }),
// matched on digits alone so 3924.10.0000 and 3924100000 are the same code.
// null when the code is blank, not in the library, or has no duty recorded.
export function dutyRateFor(hts, codes) {
  const d = String(hts || '').replace(/\D/g, '');
  if (!d) return null;
  const hit = (codes || []).find(c => String(c.code || '').replace(/\D/g, '') === d);
  return hit && hit.total_duty != null && isFinite(Number(hit.total_duty)) ? Number(hit.total_duty) : null;
}
