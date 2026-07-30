'use client';
import { useEffect, useState } from 'react';

// ── SizeGrid (optional size breakdown for one line item) ─────────────────────
// With no scale picked this renders a single small dropdown and nothing else,
// so a one-size line keeps exactly the height and behaviour it has today.
// Picking a scale expands the line into one quantity box per size.
//
// Fully controlled — the parent owns both `scale` and `quantities`. Carrying
// quantities across a scale change is therefore expressed as onQuantityChange
// calls for the sizes being dropped; sizes present in both scales are simply
// left untouched, which is what makes them carry across.

export const SIZE_SCALES = [
  { key:'adult',   label:'Adult apparel', sizes:['S','M','L','XL','2XL','3XL'] },
  { key:'youth',   label:'Youth apparel', sizes:['XS','S','M','L','XL'] },
  { key:'toddler', label:'Toddler',       sizes:['2T','3T'] },
  { key:'bag',     label:'Bag',           sizes:['S','M','L','XL','Mega'] },
  { key:'collar',  label:'Collar',        sizes:['S/M','L/XL'] },
];

export const sizesForScale = key => (SIZE_SCALES.find(s => s.key === key) || {}).sizes || [];

// '' and null both mean "not filled in". 0 is a real value the user typed.
const isEntered = v => v !== '' && v !== null && v !== undefined;

export function SizeGrid({ scale = null, onScaleChange, quantities, onQuantityChange }) {
  const qty = quantities || {};
  const active = SIZE_SCALES.find(s => s.key === scale) || null;
  const [pendingClear, setPendingClear] = useState(false);

  // Drop a stale warning if the scale is changed from outside while it is up.
  useEffect(() => { setPendingClear(false); }, [scale]);

  // Only sizes in the active scale count toward the total, so a quantity left
  // over from a scale the user has since moved away from can never inflate it.
  const sizes = active ? active.sizes : [];
  const total = sizes.reduce((a, s) => a + (Number(qty[s]) || 0), 0);
  const orphans = Object.keys(qty).filter(s => isEntered(qty[s]) && !sizes.includes(s));

  // Clear every entered quantity that has no home in the scale we are moving to,
  // then hand the new scale up. Sizes common to both are left alone.
  const changeScale = nextKey => {
    const nextSizes = nextKey ? sizesForScale(nextKey) : [];
    Object.keys(qty).forEach(size => {
      if (isEntered(qty[size]) && !nextSizes.includes(size)) onQuantityChange(size, '');
    });
    onScaleChange(nextKey || null);
  };

  const entered = Object.keys(qty).filter(s => isEntered(qty[s]));
  const onSelect = e => {
    const next = e.target.value || null;
    // Going back to "no sizes" throws away every quantity — confirm first.
    if (!next && entered.length > 0) { setPendingClear(true); return; }
    changeScale(next);
  };

  // Quantities are whole units. Strip anything else rather than relying on
  // type="number", which still admits 'e' and '-' and mutates on scroll.
  const onQty = (size, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, '');
    onQuantityChange(size, digits === '' ? '' : Number(digits));
  };

  return (
    <div className="sg">
      <div className="sg-head">
        <label className="sg-field sg-field-scale">
          <span className="sg-cap">Sizes</span>
          <select className="sg-select" value={active ? active.key : ''} onChange={onSelect}>
            <option value="">— no sizes —</option>
            {SIZE_SCALES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
      </div>

      {pendingClear && (
        <div className="sg-warn" role="alert">
          <span>
            Clearing the size scale removes {entered.length} quantit{entered.length === 1 ? 'y' : 'ies'} you have entered.
          </span>
          <span className="sg-warn-actions">
            <button type="button" className="sg-warn-btn danger" onClick={() => { setPendingClear(false); changeScale(null); }}>Clear sizes</button>
            <button type="button" className="sg-warn-btn" onClick={() => setPendingClear(false)}>Keep sizes</button>
          </span>
        </div>
      )}

      {active && (
        <>
          <div className="sg-grid">
            {sizes.map(size => (
              <label key={size} className="sg-field">
                <span className="sg-cap">{size}</span>
                <input
                  className="sg-input"
                  type="text"
                  inputMode="numeric"
                  placeholder="0"
                  aria-label={active.label + ' — size ' + size + ' quantity'}
                  value={isEntered(qty[size]) ? String(qty[size]) : ''}
                  onChange={e => onQty(size, e.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="sg-total">
            <span className="sg-total-k">Total units</span>
            <span className="sg-total-v">{total.toLocaleString()}</span>
          </div>
          {orphans.length > 0 && (
            <div className="sg-hint">
              Not in this scale, so not counted: {orphans.join(', ')}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
