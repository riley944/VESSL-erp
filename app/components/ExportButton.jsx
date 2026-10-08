'use client';
import { useState, useEffect } from 'react';
import { ExportGlyph } from '@/app/components/ExportMenu';

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
// ONE BUTTON IN THE APP'S EXPORT THEME. It was a black split pill with a caret;
// it is now the same .export-pill every page-level export wears -- white, a blue
// outline, the download glyph, "Export" -- and opens the same menu it always did,
// with the same options in the same order. The menu wears ExportMenu's look
// (.xm-menu / .xm-item). It keeps its own menu rather than using ExportMenu
// because its options are not Excel / CSV / PDF in that order: they are PDF,
// XLSX, CSV, whichever the caller supplies, with a row count beneath.
// THREE CHOICES WHERE THERE IS A DOCUMENT TO PRINT, two where there is not.
// onPdf is optional and the item only appears when a caller passes one, so the
// list pages that export a grid are untouched -- a PDF of 200 filtered rows is a
// different feature nobody has asked for. The PLM card passes one because a card
// IS a document: it has a header, a reading order and an audience.
//
// note replaces the row count under the menu. "1 row, as filtered" is the wrong
// sentence for a single card, and a caller that exports one thing should be able
// to say what that thing is.
//
// compact is the card-sized .export-btn, for a modal header, where it sits beside
// a 22px close glyph rather than on a filter row beside a 36px search box.
export function ExportButton({ count = 0, busy = false, onPdf, onXlsx, onCsv,
                               align = 'left', note, compact = false }) {
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
      <button type="button" className={compact ? 'export-btn' : 'export-pill'} onClick={()=>setOpen(v=>!v)} disabled={busy || !live}
        aria-haspopup="menu" aria-expanded={open}
        title={note || (live ? 'Download these '+count+' rows' : 'Nothing to export')}>
        <ExportGlyph />{busy ? 'Building…' : 'Export'}
      </button>
      {open && (
        // Aligned to whichever edge the button sits against: left where it follows a
        // search box, right where it ends a filter row. Either way it stays on screen.
        <div role="menu" className="xm-menu" style={{position:'absolute',top:'calc(100% + 6px)',[align]:0,minWidth:'196px'}}>
          {/* A choice appears only where the caller handed over a writer for it, so
              the grid pages keep exactly the two they always had. */}
          {[['Export as PDF', onPdf], ['Export as XLSX', onXlsx], ['Export as CSV', onCsv]]
            .filter(([, run]) => !!run).map(([label, run])=>(
            <button key={label} type="button" role="menuitem" className="xm-item" onClick={()=>{ setOpen(false); if (run) run(); }}>{label}</button>
          ))}
          {/* Says what is about to be downloaded, at the moment of choosing. */}
          <div style={{padding:'8px 12px 4px',marginTop:'2px',borderTop:'1px solid #F0F0F2',fontSize:'11px',color:'#8A8A8E'}}>
            {note || (count + ' ' + (count===1?'row':'rows') + ', as filtered')}
          </div>
        </div>
      )}
    </div>
  );
}
