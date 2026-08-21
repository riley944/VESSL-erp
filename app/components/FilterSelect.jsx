'use client';
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── FilterSelect (shared dropdown for client / status filters) ───────────────
// The panel is portalled to <body> rather than absolutely positioned: .filters
// becomes an overflow-x:auto scroll container on narrow screens (globals.css,
// mobile media query), which would clip an in-flow panel.
let fsSeq = 0;
// Panel is content-sized in CSS (width:max-content). This cap must stay in sync with
// the max-width on .fs-panel in globals.css — it is what the viewport clamp measures against.
const PANEL_MAX = 380;
// `multiple` turns the same control into a membership picker. It is a prop rather
// than a second component because everything expensive here -- place(), the portal,
// the capture-phase scroll/resize re-placement, outside-click, arrow/Home/End, the
// scrollIntoView -- is identical either way, and a sibling would be a second copy of
// the clamp-and-flip logic to keep in sync. That is the five-Overlay mistake.
//
// MULTI CONTRACT. `value` is an array and onChange hands back an array. An EMPTY
// array is All: no narrowing, and what the control falls back to when the last
// option is unticked. The All row is an ordinary option with value '' -- picking it
// clears to []. So "All" is never a member of the selection, only the absence of one.
//
// Single-select is untouched by all of it: multiple defaults false, and the Client
// filter still passes a string and gets a string back.
export function FilterSelect({ label, value, onChange, options = [], multiple = false }){
  const [open,   setOpen]   = useState(false);
  const [active, setActive] = useState(-1);
  const [pos,    setPos]    = useState(null);
  const btnRef   = useRef(null);
  const panelRef = useRef(null);
  const idRef    = useRef(null);
  if (idRef.current === null) idRef.current = 'fs-' + (++fsSeq);
  const listId = idRef.current;

  const sel = multiple ? (Array.isArray(value) ? value : []) : null;
  // The All row reads as chosen exactly when nothing else is.
  const isSel = o => multiple ? (o.value === '' ? sel.length === 0 : sel.includes(o.value))
                              : o.value === value;
  const selected = multiple ? null : (options.find(o => o.value === value) || null);
  // options carrying `bg` render as tinted status pills; the selected one inverts to a solid fill.
  // Never in multi: a button cannot take the colour of four different options at once.
  const selTinted = !!(selected && selected.bg);
  const chosen = multiple ? options.filter(o => o.value !== '' && sel.includes(o.value)) : [];
  // One selection names itself; several would not fit, so they count instead.
  const btnLabel = !multiple ? (selected ? selected.label : label)
                 : chosen.length === 0 ? label
                 : chosen.length === 1 ? chosen[0].label
                 : chosen.length + ' selected';

  const place = useCallback(()=>{
    const el = btnRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const gutter = 8;
    // Once the panel is mounted, clamp against its real width. On the first frame it does
    // not exist yet, so fall back to the cap — the widest it can possibly be — which errs
    // toward keeping it on screen. The layout effect below re-places with the measurement.
    const cap    = Math.min(PANEL_MAX, window.innerWidth - gutter*2);
    const width  = panelRef.current ? panelRef.current.offsetWidth : cap;
    const left   = Math.max(gutter, Math.min(r.left, window.innerWidth - width - gutter));
    const below  = window.innerHeight - r.bottom - 12;
    const above  = r.top - 12;
    const flip   = below < 180 && above > below;
    const next   = {
      left, minW: r.width,
      top:    flip ? null : r.bottom + 6,
      bottom: flip ? window.innerHeight - r.top + 6 : null,
      maxH:   Math.max(140, Math.min(320, flip ? above : below)),
    };
    // Returning the same object when nothing moved lets React bail out of the re-render,
    // so the measure pass settles after one extra frame instead of looping.
    setPos(p => (p && p.left === next.left && p.minW === next.minW && p.top === next.top
              && p.bottom === next.bottom && p.maxH === next.maxH) ? p : next);
  },[]);

  // Re-place as soon as the panel exists, now that its width can be measured. useLayoutEffect
  // so the correction is applied before paint rather than showing as a visible jump.
  useLayoutEffect(()=>{
    if (open && pos) place();
  },[open, pos, place]);

  useEffect(()=>{
    if (!open) return;
    place();
    const onMove = ()=>place();
    window.addEventListener('scroll', onMove, true);  // capture: .main-area scrolls, not window
    window.addEventListener('resize', onMove);
    return ()=>{ window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  },[open, place]);

  useEffect(()=>{
    if (!open) return;
    const onDown = e=>{
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return ()=>document.removeEventListener('mousedown', onDown);
  },[open]);

  useEffect(()=>{
    if (!open || active < 0 || !panelRef.current) return;
    const row = panelRef.current.querySelector('[data-idx="'+active+'"]');
    if (row) row.scrollIntoView({ block:'nearest' });
  },[open, active]);

  const openPanel = ()=>{ setActive(options.findIndex(isSel)); setOpen(true); };
  // Multi does NOT close on pick: the whole point is choosing several, and closing
  // after each one would make a three-option selection three round trips.
  const pick = v=>{
    if (!multiple){ onChange(v); setOpen(false); if (btnRef.current) btnRef.current.focus(); return; }
    if (v === ''){ onChange([]); return; }                       // All clears the set
    onChange(sel.includes(v) ? sel.filter(x=>x!==v) : sel.concat(v));
  };

  const onKeyDown = e=>{
    if (e.key === 'Escape'){ if (open){ e.preventDefault(); setOpen(false); } return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      if (!open){ openPanel(); return; }
      const n = options.length; if (!n) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive(i => i < 0 ? (d > 0 ? 0 : n-1) : (i + d + n) % n);
      return;
    }
    if (open && (e.key === 'Home' || e.key === 'End')){ e.preventDefault(); setActive(e.key === 'Home' ? 0 : options.length-1); return; }
    if (open && (e.key === 'Enter' || e.key === ' ')){
      if (active >= 0 && options[active]){ e.preventDefault(); pick(options[active].value); }
    }
    // when closed, Enter/Space fall through to the native button click → openPanel
  };

  return (
    <>
      <button ref={btnRef} type="button" className={'fs-btn' + (open ? ' open' : '') + (selTinted ? ' tint' : '')}
        style={selTinted ? { background:selected.color, borderColor:selected.color, color:'#fff' } : undefined}
        aria-haspopup="listbox" aria-expanded={open}
        aria-multiselectable={multiple ? true : undefined}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? listId + '-' + active : undefined}
        onClick={()=>open ? setOpen(false) : openPanel()} onKeyDown={onKeyDown}>
        {!selTinted && selected && selected.color && <span className="chip-dot" style={{background:selected.color}} />}
        <span className="fs-btn-label">{btnLabel}</span>
        <svg className="fs-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} id={listId} role="listbox" className="fs-panel"
          style={{ left:pos.left+'px', minWidth:pos.minW+'px', maxHeight:pos.maxH+'px',
                   ...(pos.top != null ? { top:pos.top+'px' } : { bottom:pos.bottom+'px' }) }}>
          {options.map((o,i)=>(
            <div key={o.value} id={listId+'-'+i} data-idx={i} role="option" aria-selected={isSel(o)}
              className={'fs-opt' + (isSel(o) ? ' sel' : '') + (i === active ? ' active' : '') + (o.bg ? ' tint' : '')}
              style={o.bg ? (isSel(o) ? { background:o.color, color:'#fff' } : { background:o.bg, color:o.color }) : undefined}
              onMouseDown={e=>e.preventDefault()}
              onMouseEnter={()=>setActive(i)}
              onClick={()=>pick(o.value)}>
              {!o.bg && (o.color ? <span className="chip-dot" style={{background:o.color}} /> : <span className="fs-nodot" />)}
              <span className="fs-opt-label">{o.label}</span>
              {o.count != null && <span className="chip-count">{o.count}</span>}
              {isSel(o) && <svg className="fs-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
          ))}
        </div>, document.body)}
    </>
  );
}
