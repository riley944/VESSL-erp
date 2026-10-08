'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// ── Export: pick a format ─────────────────────────────────────────────────────
// One small menu for every export button: Excel, CSV or PDF. Built once, here,
// so any page can adopt it; the Shipments page uses it first.
//
//   <ExportMenu label="Export" onPick={fmt => ...} />          a labelled button
//   <ExportMenu iconOnly title="Export this quote" ... />       a download glyph
//
// KEYBOARD. The trigger is a real button (Enter or Space opens it, with focus
// on the first option); arrows, Home and End move between options; Enter or
// Space picks; Escape closes and puts focus back on the trigger; Tab closes.
// A click anywhere else closes it, and so does scrolling or resizing, since the
// menu is placed against the button's position on screen.
//
// IT NEVER REACHES THE ROW. Every click, mouse-down and key inside -- the
// trigger and the menu, which is portalled to <body> but still bubbles through
// React -- stops at this component, so a card or row with its own click does
// not open.
//
// PORTALLED, so a card with overflow hidden cannot clip it. Options are at
// least 44px tall at phone width (.xm-item in globals.css).
export const EXPORT_FORMATS = [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV (.csv)'], ['pdf', 'PDF']];

// The small download glyph every export button leads with.
export const ExportGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13.5h10" /></svg>
);

export default function ExportMenu({ label = 'Export', busyLabel = 'Exporting…', iconOnly = false, className = 'export-btn', title, busy = false, disabled = false, onPick }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const id = useId();

  const items = () => (menu.current ? [...menu.current.querySelectorAll('[role="menuitem"]')] : []);
  const close = (refocus) => { setOpen(false); if (refocus && btn.current) btn.current.focus(); };
  const place = () => {
    const r = btn.current.getBoundingClientRect();
    const w = 190, h = 3 * 46 + 12;
    const left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 6;
    const top = below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
    setPos({ left, top, width: w });
  };
  const toggle = () => { if (open) { close(false); return; } place(); setOpen(true); };

  useEffect(() => {
    if (!open) return;
    // Focus the first option once the menu is in the page.
    const t = setTimeout(() => { const f = items()[0]; if (f) f.focus(); }, 0);
    const outside = e => { if (btn.current && btn.current.contains(e.target)) return; if (menu.current && menu.current.contains(e.target)) return; close(false); };
    const away = () => close(false);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('touchstart', outside, true);
    window.addEventListener('resize', away);
    window.addEventListener('scroll', away, true);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', outside, true); document.removeEventListener('touchstart', outside, true);
      window.removeEventListener('resize', away); window.removeEventListener('scroll', away, true); };
  }, [open]);

  const onMenuKey = e => {
    e.stopPropagation();
    const list = items(); const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1].focus(); }
    else if (e.key === 'Tab') { close(false); }
  };
  const pick = fmt => { close(true); onPick && onPick(fmt); };
  const stop = e => e.stopPropagation();

  return (
    <span className="xm" onClick={stop} onMouseDown={stop} onKeyDown={stop} style={{ display: 'inline-flex' }}>
      <button ref={btn} type="button" className={iconOnly ? 'xm-icon' : className} onClick={toggle} disabled={disabled || busy}
        aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} title={title} aria-label={iconOnly ? (title || label) : undefined}
        onKeyDown={e => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); toggle(); } if (e.key === 'Escape' && open) { e.preventDefault(); close(true); } }}>
        <ExportGlyph />{!iconOnly && (busy ? busyLabel : label)}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={menu} id={id} role="menu" aria-label={(title || label) + ': choose a format'} className="xm-menu" onKeyDown={onMenuKey}
          onClick={stop} onMouseDown={stop} style={{ position: 'fixed', left: pos.left + 'px', top: pos.top + 'px', width: pos.width + 'px' }}>
          {EXPORT_FORMATS.map(([fmt, text]) => (
            <button key={fmt} type="button" role="menuitem" tabIndex={-1} className="xm-item" onClick={() => pick(fmt)}>{text}</button>
          ))}
        </div>, document.body)}
    </span>
  );
}
