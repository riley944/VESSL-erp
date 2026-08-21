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

// `short` is what qualifies a colliding size label -- "Adult L" rather than "Adult
// apparel L". It is a field rather than label.replace(/ apparel$/,'') because string
// surgery on a display label breaks silently the day someone renames one.
export const SIZE_SCALES = [
  { key:'adult',   label:'Adult apparel', short:'Adult',   sizes:['S','M','L','XL','2XL','3XL'] },
  { key:'youth',   label:'Youth apparel', short:'Youth',   sizes:['XS','S','M','L','XL'] },
  { key:'toddler', label:'Toddler',       short:'Toddler', sizes:['2T','3T'] },
  { key:'bag',     label:'Bag',           short:'Bag',     sizes:['S','M','L','XL','Mega'] },
  { key:'collar',  label:'Collar',        short:'Collar',  sizes:['S/M','L/XL'] },
];

export const sizesForScale = key => (SIZE_SCALES.find(s => s.key === key) || {}).sizes || [];

// ── Selecting several scales at once ─────────────────────────────────────────
// A quote can carry more than one scale -- Legoland styles run youth and toddler
// together -- and the moment it can, the size LABEL stops being an identifier.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ THE PROBLEM THESE THREE FUNCTIONS EXIST TO SOLVE.                         │
// │                                                                           │
// │ Adult and Youth share four labels: S, M, L, XL. Bag overlaps both. Deltas │
// │ and per-tier quantities were keyed on the label alone, so an Adult L and  │
// │ a Youth L on one quote would write to the same key and silently become    │
// │ one number.                                                               │
// │                                                                           │
// │ So the KEY carries the scale, always -- 'adult|L' -- whatever is selected. │
// │ Storage is unambiguous even for a selection that does not collide, which   │
// │ is what keeps the stored shape from depending on the selection.           │
// │                                                                           │
// │ Only the DISPLAYED label is conditional: "L" when nothing else in the      │
// │ selection has an L, "Adult L" when something does. Picking Adult+Youth     │
// │ qualifies S/M/L/XL and leaves 2XL, 3XL and XS bare, because those do not   │
// │ collide and qualifying them would be noise.                               │
// └───────────────────────────────────────────────────────────────────────────┘

// '|' is safe as the separator: no size label contains one. The only punctuation
// in use is the slash in the collar scale's S/M and L/XL.
export const sizeKey = (scale, size) => scale + '|' + size;

// null | 'youth' | ['youth','toddler'] -> ['youth','toddler'].
//
// Tolerant of the scalar on purpose: vessl.quotes.size_scale is text[] only after
// the migration, and a row read either side of it has to land somewhere sane. It
// also means a legacy row's entries can be attributed to its ONE scale without
// guessing, which is what makes the stored shapes upgrade with no backfill.
//
// Unknown keys are dropped rather than kept, so a retired scale cannot conjure a
// column of boxes with no sizes behind it.
//
// Normalised to SIZE_SCALES order, not click order, so the grid does not reshuffle
// depending on which box someone ticked first.
export function toScaleList(v) {
  if (v == null) return [];
  const raw = Array.isArray(v) ? v : [v];
  const wanted = new Set();
  raw.forEach(k => { if (typeof k === 'string' && k.trim()) wanted.add(k.trim()); });
  return SIZE_SCALES.filter(s => wanted.has(s.key)).map(s => s.key);
}

// One descriptor per size across the whole selection, in scale order then size
// order. `key` is what deltas and quantities are stored under; `label` is what a
// person reads; `size` is the bare label the order row still needs.
export function sizesForSelection(scales) {
  const keys = toScaleList(scales);
  // How many SELECTED scales carry each bare label. Only a count above one
  // qualifies, so the same size reads differently on Adult+Youth than on Adult.
  const seen = {};
  keys.forEach(k => sizesForScale(k).forEach(s => { seen[s] = (seen[s] || 0) + 1; }));
  const out = [];
  keys.forEach(k => {
    const sc = SIZE_SCALES.find(x => x.key === k);
    if (!sc) return;
    sc.sizes.forEach(size => out.push({
      scale: k,
      scaleLabel: sc.short,
      size,
      key: sizeKey(k, size),
      label: seen[size] > 1 ? sc.short + ' ' + size : size,
    }));
  });
  return out;
}

// What goes into a client-facing SKU suffix on an order line.
//
// An UNQUALIFIED entry returns the bare size, byte for byte what the order save
// path already appends -- so no existing line's SKU changes shape, including the
// collar scale's S/M, which must not be scrubbed into S-M.
//
// A qualified one returns ADULT-L. Uppercased to match how sizes have always been
// baked into SKUs here (BG-101-2XL), and the scale goes BEFORE the size so the
// size stays the trailing token, which is the convention every existing SKU
// follows. SKU-L-ADULT would read as a size of "L-ADULT".
export const skuToken = entry =>
  entry.label === entry.size ? entry.size : (entry.scaleLabel + '-' + entry.size).toUpperCase();

// '' and null both mean "not filled in". 0 is a real value the user typed.
const isEntered = v => v !== '' && v !== null && v !== undefined;

export function SizeGrid({ scale = null, onScaleChange, quantities, onQuantityChange, prices, onPriceChange, fallbackPrice = '' }) {
  const qty = quantities || {};
  const price = prices || {};
  const active = SIZE_SCALES.find(s => s.key === scale) || null;
  const [pendingClear, setPendingClear] = useState(false);

  // Drop a stale warning if the scale is changed from outside while it is up.
  useEffect(() => { setPendingClear(false); }, [scale]);

  // Only sizes in the active scale count toward the total, so a quantity left
  // over from a scale the user has since moved away from can never inflate it.
  const sizes = active ? active.sizes : [];
  // A size with no price of its own is charged at the line price -- the same rule the
  // order save path applies, so this footer can never disagree with the line's Amount.
  const priceOf = s => (isEntered(price[s]) ? Number(price[s]) || 0 : Number(fallbackPrice) || 0);
  const totalUnits = sizes.reduce((a, s) => a + (Number(qty[s]) || 0), 0);
  const totalAmount = sizes.reduce((a, s) => a + (Number(qty[s]) || 0) * priceOf(s), 0);
  const orphans = Object.keys(qty).filter(s => isEntered(qty[s]) && !sizes.includes(s));

  // Clear every entered quantity that has no home in the scale we are moving to,
  // then hand the new scale up. Sizes common to both are left alone.
  const changeScale = nextKey => {
    const nextSizes = nextKey ? sizesForScale(nextKey) : [];
    Object.keys(qty).forEach(size => {
      if (isEntered(qty[size]) && !nextSizes.includes(size)) onQuantityChange(size, '');
    });
    Object.keys(price).forEach(size => {
      if (isEntered(price[size]) && !nextSizes.includes(size)) onPriceChange(size, '');
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

  // Prices are decimal, so keep the first '.' and drop any later ones. Held as a
  // string rather than a Number: coercing on each keystroke makes "12.50" untypeable,
  // because Number('12.5') renders back as '12.5' and swallows the trailing zero.
  const onPrice = (size, raw) => {
    let s = String(raw).replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    onPriceChange(size, s);
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
            {sizes.map(size => {
              const amt = (Number(qty[size]) || 0) * priceOf(size);
              return (
                // a div, not a label: two inputs share this caption, so each carries its own aria-label
                <div key={size} className="sg-field sg-size">
                  <span className="sg-cap">{size}</span>
                  <div className="sg-pair">
                    <input
                      className="sg-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Qty"
                      aria-label={active.label + ' — size ' + size + ' quantity'}
                      value={isEntered(qty[size]) ? String(qty[size]) : ''}
                      onChange={e => onQty(size, e.target.value)}
                    />
                    <input
                      className="sg-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={active.label + ' — size ' + size + ' unit price'}
                      value={isEntered(price[size]) ? String(price[size]) : ''}
                      onChange={e => onPrice(size, e.target.value)}
                    />
                  </div>
                  <span className="sg-amt">{amt > 0 ? amt.toFixed(2) : ''}</span>
                </div>
              );
            })}
          </div>
          <div className="sg-totals">
            <div className="sg-total">
              <span className="sg-total-k">Total units</span>
              <span className="sg-total-v">{totalUnits.toLocaleString()}</span>
            </div>
            <div className="sg-total">
              <span className="sg-total-k">Total amount</span>
              <span className="sg-total-v">{totalAmount.toFixed(2)}</span>
            </div>
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
