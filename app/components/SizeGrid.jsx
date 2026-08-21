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
  { key:'toddler', label:'Toddler',       short:'Toddler', sizes:['2T','3T','4T'] },
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

// Turns a stored key back into something readable, for the orphan hint. A key
// written before scales were composite has no '|' and is shown as it stands.
export const describeKey = k => {
  const i = String(k).indexOf('|');
  if (i < 0) return String(k);
  const sc = SIZE_SCALES.find(s => s.key === String(k).slice(0, i));
  return (sc ? sc.short + ' ' : '') + String(k).slice(i + 1);
};

// '' and null both mean "not filled in". 0 is a real value the user typed.
const isEntered = v => v !== '' && v !== null && v !== undefined;

// `scales` is a list now, and quantities/prices are keyed by sizeKey(scale,size)
// rather than by the bare label -- the same addressing the quote form uses, and
// for the same reason: Adult and Youth both have an L.
export function SizeGrid({ scales = null, onScalesChange, quantities, onQuantityChange, prices, onPriceChange, fallbackPrice = '' }) {
  const qty = quantities || {};
  const price = prices || {};
  const selected = toScaleList(scales);
  const entries = sizesForSelection(selected);
  // Holds the pending selection while its confirmation is up, not just a flag --
  // the question is now "remove which scale", so the answer has to travel with it.
  const [pendingClear, setPendingClear] = useState(null);

  // Drop a stale warning if the selection changes from outside while it is up.
  const selKey = selected.join(',');
  useEffect(() => { setPendingClear(null); }, [selKey]);

  // Only sizes in the current selection count toward the totals, so a quantity
  // left over from a scale since removed can never inflate them.
  const priceOf = k => (isEntered(price[k]) ? Number(price[k]) || 0 : Number(fallbackPrice) || 0);
  const totalUnits = entries.reduce((a, e) => a + (Number(qty[e.key]) || 0), 0);
  const totalAmount = entries.reduce((a, e) => a + (Number(qty[e.key]) || 0) * priceOf(e.key), 0);
  const liveKeys = new Set(entries.map(e => e.key));
  const orphans = Object.keys(qty).filter(k => isEntered(qty[k]) && !liveKeys.has(k));

  // Clear every entry with no home in the selection we are moving to, then hand
  // the selection up. Entries that survive are left untouched -- which is now
  // exact rather than approximate: removing Adult from Adult+Youth drops
  // 'adult|L' and keeps 'youth|L', where a bare-label key could not tell them
  // apart at all.
  const applySelection = next => {
    const keep = new Set(sizesForSelection(next).map(e => e.key));
    Object.keys(qty).forEach(k => { if (isEntered(qty[k]) && !keep.has(k)) onQuantityChange(k, ''); });
    Object.keys(price).forEach(k => { if (isEntered(price[k]) && !keep.has(k)) onPriceChange(k, ''); });
    onScalesChange(next);
  };

  const nextFor = key => toScaleList(selected.includes(key) ? selected.filter(k => k !== key) : selected.concat(key));
  const lostBy = next => {
    const keep = new Set(sizesForSelection(next).map(e => e.key));
    return Object.keys(qty).filter(k => isEntered(qty[k]) && !keep.has(k)).length;
  };

  // Confirm whenever a change would discard entered quantities, not only when
  // clearing to none -- unticking one of two scales throws away just as much.
  const onToggle = key => {
    const next = nextFor(key);
    const n = lostBy(next);
    if (n > 0) { setPendingClear({ next, n }); return; }
    applySelection(next);
  };

  // Quantities are whole units. Strip anything else rather than relying on
  // type="number", which still admits 'e' and '-' and mutates on scroll.
  const onQty = (key, raw) => {
    const digits = String(raw).replace(/[^0-9]/g, '');
    onQuantityChange(key, digits === '' ? '' : Number(digits));
  };

  // Prices are decimal, so keep the first '.' and drop any later ones. Held as a
  // string rather than a Number: coercing on each keystroke makes "12.50" untypeable,
  // because Number('12.5') renders back as '12.5' and swallows the trailing zero.
  const onPrice = (key, raw) => {
    let s = String(raw).replace(/[^0-9.]/g, '');
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
    onPriceChange(key, s);
  };

  return (
    <div className="sg">
      <div className="sg-head">
        {/* Checkboxes, not a <select multiple>: five fixed options fit at once,
            ctrl-clicking a multi-select is a trap, and a real checkbox fires a
            native change event so the modal dirty guard sees it for free.

            `short` labels, because the row lives in a line-item sub-row: "Adult"
            wraps to two lines at the narrow end where "Adult apparel" would take
            five. .sg-scales is full-width inside .sg-head, which holds nothing
            else, so no other field is squeezed by it. */}
        <div className="sg-scales">
          <span className="sg-cap">Sizes</span>
          <div className="sg-scale-opts">
            {SIZE_SCALES.map(s => (
              <label key={s.key} className="sg-scale-opt">
                <input type="checkbox" checked={selected.includes(s.key)} onChange={() => onToggle(s.key)} />
                {s.short}
              </label>
            ))}
          </div>
        </div>
      </div>

      {pendingClear && (
        <div className="sg-warn" role="alert">
          <span>
            That change clears {pendingClear.n} quantit{pendingClear.n === 1 ? 'y' : 'ies'} you have entered.
          </span>
          <span className="sg-warn-actions">
            <button type="button" className="sg-warn-btn danger" onClick={() => { const p = pendingClear; setPendingClear(null); applySelection(p.next); }}>Clear them</button>
            <button type="button" className="sg-warn-btn" onClick={() => setPendingClear(null)}>Keep sizes</button>
          </span>
        </div>
      )}

      {entries.length > 0 && (
        <>
          <div className="sg-grid">
            {entries.map(e => {
              const amt = (Number(qty[e.key]) || 0) * priceOf(e.key);
              return (
                // a div, not a label: two inputs share this caption, so each carries its own aria-label
                <div key={e.key} className="sg-field sg-size">
                  {/* e.label, so an Adult+Youth line reads "Adult L" and "Youth L"
                      rather than two boxes both captioned "L". */}
                  <span className="sg-cap">{e.label}</span>
                  <div className="sg-pair">
                    <input
                      className="sg-input"
                      type="text"
                      inputMode="numeric"
                      placeholder="Qty"
                      aria-label={e.scaleLabel + ' — size ' + e.size + ' quantity'}
                      value={isEntered(qty[e.key]) ? String(qty[e.key]) : ''}
                      onChange={ev => onQty(e.key, ev.target.value)}
                    />
                    <input
                      className="sg-input"
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      aria-label={e.scaleLabel + ' — size ' + e.size + ' unit price'}
                      value={isEntered(price[e.key]) ? String(price[e.key]) : ''}
                      onChange={ev => onPrice(e.key, ev.target.value)}
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
            // describeKey, not the raw key: 'adult|L' is storage, "Adult L" is English.
            <div className="sg-hint">
              Not in this selection, so not counted: {orphans.map(describeKey).join(', ')}.
            </div>
          )}
        </>
      )}
    </div>
  );
}
