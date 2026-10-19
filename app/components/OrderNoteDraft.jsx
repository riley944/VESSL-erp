'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';
import { peopleFromStaff } from '@/lib/people';
import { PeoplePills } from '@/app/components/PeoplePills';

// The staff list, every staff_profiles row by full name -- for the people pills
// and for the names said after a note is posted. [] until it loads.
export function useStaff() {
  const [staff, setStaff] = useState([]);
  useEffect(() => {
    let live = true;
    SB.from('staff_profiles').select('email,full_name').order('full_name', { nullsFirst:false })
      .then(({ data }) => { if (live) setStaff(data || []); });
    return () => { live = false; };
  }, []);
  return staff;
}

// ── A NOTE TO POST WITH A NEW ORDER ─────────────────────────────────────────
// The Create PO / Create SO modals' Notes & Activity section: the same people
// pills (All, nothing picked to start) and note box as the order's own card,
// held in the modal until the order is created -- then lib/orderNotes
// postNoteAfterCreate saves it and emails whoever was picked. An empty box
// posts nothing.
//
// Headed like the modals' other sections (Preproduction Samples, Fees &
// Currency): the global form-section-label -- label, rule underneath, its own
// top and bottom margin -- then the body with the same 14px foot those leave.
export function OrderNoteDraft({ staff, text, setText, to, setTo, disabled = false }) {
  return (
    <>
    <span className="form-section-label">Notes &amp; Activity</span>
    <div style={{padding:'0 0 14px'}}>
      <div style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)',margin:'0 0 6px'}}>Notify</div>
      <PeoplePills people={peopleFromStaff(staff)} value={to} onChange={setTo} showAll disabled={disabled} label="Notify" />
      <textarea className="form-textarea" rows={3} style={{marginTop:'8px'}} placeholder="Add a note or task..."
        value={text} onChange={e => setText(e.target.value)} disabled={disabled} aria-label="Note" />
      <div style={{fontSize:'11.5px',color:'var(--muted)',marginTop:'6px'}}>
        {!text.trim() ? 'Posted to the order once it is created. Leave it empty for no note.'
          : !to.length ? 'Posted once the order is created — nobody picked, so no email.'
          : 'Posted once the order is created, and emailed to the people picked.'}
      </div>
    </div>
    </>
  );
}
