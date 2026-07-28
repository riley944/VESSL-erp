'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── FilterSelect (shared dropdown for client / status filters) ───────────────
// The panel is portalled to <body> rather than absolutely positioned: .filters
// becomes an overflow-x:auto scroll container on narrow screens (globals.css,
// mobile media query), which would clip an in-flow panel.
let fsSeq = 0;
export function FilterSelect({ label, value, onChange, options = [] }){
  const [open,   setOpen]   = useState(false);
  const [active, setActive] = useState(-1);
  const [pos,    setPos]    = useState(null);
  const btnRef   = useRef(null);
  const panelRef = useRef(null);
  const idRef    = useRef(null);
  if (idRef.current === null) idRef.current = 'fs-' + (++fsSeq);
  const listId = idRef.current;

  const selected = options.find(o => o.value === value) || null;
  // options carrying `bg` render as tinted status pills; the selected one inverts to a solid fill
  const selTinted = !!(selected && selected.bg);

  const place = useCallback(()=>{
    const el = btnRef.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const gutter = 8;
    const width  = Math.max(r.width, 200);
    const left   = Math.max(gutter, Math.min(r.left, window.innerWidth - width - gutter));
    const below  = window.innerHeight - r.bottom - 12;
    const above  = r.top - 12;
    const flip   = below < 180 && above > below;
    setPos({
      left, width,
      top:    flip ? null : r.bottom + 6,
      bottom: flip ? window.innerHeight - r.top + 6 : null,
      maxH:   Math.max(140, Math.min(320, flip ? above : below)),
    });
  },[]);

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

  const openPanel = ()=>{ setActive(options.findIndex(o=>o.value===value)); setOpen(true); };
  const pick = v=>{ onChange(v); setOpen(false); if (btnRef.current) btnRef.current.focus(); };

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
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? listId + '-' + active : undefined}
        onClick={()=>open ? setOpen(false) : openPanel()} onKeyDown={onKeyDown}>
        {!selTinted && selected && selected.color && <span className="chip-dot" style={{background:selected.color}} />}
        <span className="fs-btn-label">{selected ? selected.label : label}</span>
        <svg className="fs-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && pos && createPortal(
        <div ref={panelRef} id={listId} role="listbox" className="fs-panel"
          style={{ left:pos.left+'px', width:pos.width+'px', maxHeight:pos.maxH+'px',
                   ...(pos.top != null ? { top:pos.top+'px' } : { bottom:pos.bottom+'px' }) }}>
          {options.map((o,i)=>(
            <div key={o.value} id={listId+'-'+i} data-idx={i} role="option" aria-selected={o.value === value}
              className={'fs-opt' + (o.value === value ? ' sel' : '') + (i === active ? ' active' : '') + (o.bg ? ' tint' : '')}
              style={o.bg ? (o.value === value ? { background:o.color, color:'#fff' } : { background:o.bg, color:o.color }) : undefined}
              onMouseDown={e=>e.preventDefault()}
              onMouseEnter={()=>setActive(i)}
              onClick={()=>pick(o.value)}>
              {!o.bg && (o.color ? <span className="chip-dot" style={{background:o.color}} /> : <span className="fs-nodot" />)}
              <span className="fs-opt-label">{o.label}</span>
              {o.count != null && <span className="chip-count">{o.count}</span>}
              {o.value === value && <svg className="fs-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
            </div>
          ))}
        </div>, document.body)}
    </>
  );
}
