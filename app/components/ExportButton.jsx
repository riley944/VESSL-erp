'use client';
import { useState, useEffect } from 'react';

// ── THE EXPORT CONTROL, ONCE ────────────────────────────────────────────────
//
// Testing / Products and the quote-driven Products page both export what is on
// screen, and both drew their own copy of this button. The copies had already
// started to differ -- one aligned its menu left and the other right -- and the
// styling change that prompted this would have had to be made twice. Same reason
// lib/tierCost.js and lib/products.js exist: a hand-mirrored copy is how two
// screens end up describing the same thing differently.
//
// WHAT THIS OWNS: the pill, the menu, and the open/closed state with its outside
// click and Escape handling. WHAT IT DOES NOT: building the file. Each page keeps
// its own writers, because the columns are the page's business and nothing here
// should have an opinion about them.
//
// ONE BUTTON, TWO SEGMENTS. The arrow is a painted segment inside the same
// <button>, not a control of its own: both halves open the same menu, so a second
// button would only add a tab stop and a way to miss.
//
// SIZED OFF THE SEARCH BOX, not the filter dropdowns: 9px of padding above and
// below a 16px line, inside a 1px border, is 36px -- what the search input beside it
// on Testing measures, and thinner than .fs-btn's 40px. The horizontal padding is
// wider than the vertical maths needs (20px on the label, 15px on the arrow) so the
// pill reads slightly longer rather than merely squatter. Pill ends throughout.
export function ExportButton({ count = 0, busy = false, onXlsx, onCsv, align = 'left' }) {
  const [open, setOpen] = useState(false);
  // Bound only while open, so a page is not carrying document-level listeners for a
  // menu nobody has opened.
  useEffect(()=>{
    if (!open) return;
    const onDown = e => { if (!(e.target.closest && e.target.closest('[data-export-menu]'))) setOpen(false); };
    const onKey  = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return ()=>{ document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  },[open]);

  const live = count > 0;
  return (
    <div style={{position:'relative'}} data-export-menu>
      <button onClick={()=>setOpen(v=>!v)} disabled={busy || !live}
        aria-haspopup="menu" aria-expanded={open} aria-label="Export"
        title={live ? 'Download these '+count+' rows' : 'Nothing to export'}
        style={{display:'inline-flex',alignItems:'stretch',padding:0,overflow:'hidden',
                background:live?'#1D1D1F':'#C7C7CC',color:'#fff',
                border:'1px solid transparent',borderRadius:'980px',
                cursor:live&&!busy?'pointer':'default',whiteSpace:'nowrap',fontFamily:'inherit'}}>
        <span style={{padding:'9px 20px',fontSize:'12px',lineHeight:'16px',fontWeight:600,
                      letterSpacing:'.08em',textTransform:'uppercase'}}>
          {busy ? 'Building…' : 'Export'}
        </span>
        {/* Lighter grey against the black, so the arrow reads as its own segment
            without a border drawn between them. */}
        <span style={{display:'flex',alignItems:'center',padding:'9px 15px',
                      background:live?'rgba(255,255,255,.16)':'rgba(255,255,255,.28)'}}>
          {/* The caret FilterSelect uses, so every control on a filter row points the same way. */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
               style={{display:'block',transform:open?'rotate(180deg)':'none',transition:'transform .15s'}}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        // Aligned to whichever edge the button sits against: left where it follows a
        // search box, right where it ends a filter row. Either way it stays on screen.
        <div role="menu" style={{position:'absolute',top:'calc(100% + 6px)',[align]:0,zIndex:40,background:'#fff',
                      border:'1px solid rgba(0,0,0,.08)',borderRadius:'12px',boxShadow:'0 8px 28px rgba(0,0,0,.12)',
                      minWidth:'196px',overflow:'hidden'}}>
          {[['Export as XLSX', onXlsx], ['Export as CSV', onCsv]].map(([label, run])=>(
            <button key={label} role="menuitem" onClick={()=>{ setOpen(false); if (run) run(); }}
              style={{display:'block',width:'100%',textAlign:'left',background:'none',border:'none',
                      padding:'10px 14px',fontSize:'13px',fontWeight:500,color:'#1D1D1F',
                      cursor:'pointer',fontFamily:'inherit'}}>{label}</button>
          ))}
          {/* Says what is about to be downloaded, at the moment of choosing. */}
          <div style={{padding:'8px 14px 10px',borderTop:'1px solid #F0F0F2',fontSize:'11px',color:'#8A8A8E'}}>
            {count} {count===1?'row':'rows'}, as filtered
          </div>
        </div>
      )}
    </div>
  );
}
