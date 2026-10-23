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

// Every rate the panel uses, in the order Settings shows them. min and max are
// the bounds the database CHECK enforces (kui_settings_landed_rates_check).
export const RATE_FIELDS = [
  { key: 'mpf_rate',         label: 'MPF rate',        unit: '% of CI value',              min: 0,   max: 100 },
  { key: 'mpf_min',          label: 'MPF minimum',     unit: 'USD per entry',              min: 0,   max: null },
  { key: 'mpf_max',          label: 'MPF maximum',     unit: 'USD per entry',              min: 0,   max: null },
  { key: 'hmf_rate',         label: 'HMF rate',        unit: '% of CI value',              min: 0,   max: 100 },
  { key: 'dis_rate',         label: 'DIS rate',        unit: '% of MPF + HMF + duty',      min: 0,   max: 100 },
  { key: 'insurance_rate',   label: 'Insurance rate',  unit: '% of the insured value',     min: 0,   max: 100 },
  { key: 'insurance_uplift', label: 'Insured value',   unit: '% of the landed value',      min: 100, max: 200 },
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
