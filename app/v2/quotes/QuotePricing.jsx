'use client';

import styles from './quote-modal.module.css';

const TIER_FIELDS = [['Quantity', 'qty'], ['Factory price', 'landed'], ['Air freight', 'freightAir'], ['Ocean freight', 'freightOcean'], ['Duty', 'duty'], ['Client price', 'client']];

function TierField({ label, value, onChange, onBlur }) {
  return <label>{label}<input className="form-input" type="number" step="any" value={value ?? ''} onChange={e => onChange(e.target.value)} onBlur={onBlur} /></label>;
}

export default function QuotePricing({ form, field, updateTier, finishDutyEdit, addTier, removeTier }) {
  return <>
    {field('mold_fee', 'Mold fee', 'number')}{field('sample_fee', 'Sample fee', 'number')}
    {form.invalidTiers ? <p role="alert">Pricing tiers could not be read. They will be preserved; use the original quote editor to review them.</p> : <>
      {form.tiers.map((tier, index) => <fieldset key={tier.__v2TierKey} className={styles.tier}>
        <legend>Tier {index + 1}</legend>
        <div className={styles.tierFields}>
          {TIER_FIELDS.map(([label, key]) => <TierField key={key} label={label} value={tier[key]} onChange={value => updateTier(index, key, value)} onBlur={key === 'duty' ? () => finishDutyEdit(index) : undefined} />)}
          <label>Shipping method<select className="form-select" value={tier.ship || 'ocean'} onChange={e => updateTier(index, 'ship', e.target.value)}><option value="ocean">Ocean</option><option value="air">Air</option></select></label>
        </div>
        {tier.__v2LegacyDuty && <p>Older freight includes duty. Changing the factory price or HTS code will not add duty again; updating freight will recalculate it.</p>}
        {(tier.sizeQty || tier.sizeCost) && <p>Size-specific quantities and prices are preserved. Edit them in the original quote editor for now.</p>}
        <button type="button" className="btn btn-ghost" onClick={() => removeTier(index)}>Remove tier</button>
      </fieldset>)}
      <button type="button" className="btn btn-ghost" onClick={addTier}>+ Add tier</button>
    </>}
  </>;
}
