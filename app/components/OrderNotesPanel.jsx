'use client';
import { useState, useEffect, useCallback } from 'react';
import { SB } from '@/lib/supabase';
import { postOrderNote, noteOutcome } from '@/lib/orderNotes';
import { personName, peopleNames, peopleFromStaff, isEveryone } from '@/lib/people';
import { companyColor, initials, fmtDateTime } from '@/lib/display';
import { PeoplePills } from '@/app/components/PeoplePills';
import { useStaff } from '@/app/components/OrderNoteDraft';

// ── NOTES & ACTIVITY on an order ────────────────────────────────────────────
// One self-contained card for the record it is given -- purchaseOrderId,
// salesOrderId, shipmentId, or quoteId for a freight quote (scripts 122, 123).
// It loads the record's notes and the staff list, posts a note, and asks
// /api/orders/notify to email the people picked.
//
// A FREIGHT QUOTE sent to several forwarders is several shipment_quotes rows
// sharing rfq_group_id. A note is posted on quoteId, the row open; quoteIds
// lists every row in its group, and the card shows all their notes together.
//
// compact: inside a modal -- a tighter card, the list scrolls in place. The
// note box is data-noguard everywhere: posting saves it, so a modal's
// unsaved-changes guard has nothing to keep.
//
// THE PEOPLE PILLS are every staff_profiles row by full name, with an All
// shortcut that picks everyone. Nothing is picked to start with:
//   nothing picked -- "Post note": saved, no email (notify_to NULL, a quiet note)
//   All            -- "Post & notify everyone": saved as the full list of emails
//   some people    -- "Post & notify A & B": saved as that list
// The route mails the picks minus the author, or the author alone when they are
// the only pick (script 122 gave NULL its quiet meaning).
export function OrderNotesPanel({ purchaseOrderId = null, salesOrderId = null, shipmentId = null,
                                  quoteId = null, quoteIds = null, compact = false }) {
  const [col, orderId] = quoteId ? ['shipment_quote_id', quoteId]
    : shipmentId ? ['shipment_id', shipmentId]
    : salesOrderId ? ['sales_order_id', salesOrderId]
    : ['purchase_order_id', purchaseOrderId];
  // The rows whose notes are shown: the whole group for a freight quote.
  const readIds = quoteId ? [...new Set([quoteId, ...(quoteIds || [])])] : [orderId];
  const readKey = readIds.join(',');
  const [notes, setNotes] = useState([]);
  const staff = useStaff();
  const [noteText, setNoteText] = useState('');
  const [noteTo, setNoteTo] = useState([]);
  const [posting, setPosting] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');

  const load = useCallback(async () => {
    if (!orderId) return;
    const ids = readKey.split(',');
    const { data: ns } = await SB.from('order_notes').select('*').in(col, ids).order('created_at', { ascending:false });
    setNotes(ns || []);
  }, [col, orderId, readKey]);
  useEffect(() => { load(); }, [load]);

  const people = peopleFromStaff(staff);
  const names = emails => peopleNames(staff, emails);
  const everyone = isEveryone(staff, noteTo);

  const postNote = async () => {
    if (!(noteText || '').trim() || !orderId) return;
    setPosting(true);
    const picked = noteTo;
    // lib/orderNotes: the insert, then the email when anyone was picked -- the
    // same path the Create PO / SO modals take.
    const res = await postOrderNote({ column: col, orderId, body: noteText, picked });
    if (!res.saved) { setPosting(false); alert('Couldn’t post note: ' + res.error); return; }
    setNotes(prev => [res.note, ...prev]); setNoteText(''); setNoteTo([]);
    setNoteMsg(noteOutcome(res, staff, picked));
    setTimeout(() => setNoteMsg(''), 3000);
    setPosting(false);
  };

  const btnLabel = posting ? 'Posting...'
    : !noteTo.length ? 'Post note'
    : everyone ? 'Post & notify everyone'
    : 'Post & notify ' + names(noteTo);

  return (
    <div className="section-card" style={{marginTop: compact ? '16px' : '20px', marginBottom: compact ? 0 : undefined}}>
      <div className="section-head"><h3>Notes &amp; Activity</h3></div>
      <div className="note-composer">
        <div style={{marginBottom:'10px'}}>
          <div style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)',marginBottom:'6px'}}>Notify</div>
          <PeoplePills people={people} value={noteTo} onChange={setNoteTo} showAll disabled={posting} label="Notify" />
          {!noteTo.length && <div style={{fontSize:'11.5px',color:'var(--muted)',marginTop:'6px'}}>Nobody picked — the note is saved without an email.</div>}
        </div>
        <textarea className="form-input" data-noguard rows={compact ? 2 : 3} placeholder="Add a note or task..." value={noteText} onChange={e => setNoteText(e.target.value)} />
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'10px'}}>
          <button className="btn btn-dark btn-sm" onClick={postNote} disabled={posting || !noteText.trim()}>{btnLabel}</button>
          {noteMsg && <span style={{fontSize:'12.5px',color:'var(--accent)'}}>{noteMsg}</span>}
        </div>
      </div>
      <div className="note-list" style={compact ? { maxHeight:'220px', overflowY:'auto' } : undefined}>
        {notes.length > 0 ? notes.map(n => {
          // notify_to, or a note from before script 121 with its one assigned_to.
          const to = n.notify_to && n.notify_to.length ? n.notify_to : (n.assigned_to && n.assigned_to !== 'all' ? [n.assigned_to] : []);
          const toLabel = !to.length ? null : isEveryone(staff, to) ? 'everyone' : names(to);
          return (
            <div key={n.id} className="note-item">
              <div className="note-avatar" style={{background:companyColor(n.author_email || '?')}}>{initials(n.author_email || '?')}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="note-body">{n.body}</div>
                <div className="note-meta">
                  {n.author_email ? personName(staff, n.author_email) : 'unknown'}
                  {toLabel && <span style={{color:'var(--accent)'}}> {'→'} {toLabel}</span>}
                  {' · '}{fmtDateTime(n.created_at)}
                </div>
              </div>
            </div>
          );
        }) : <div style={{padding:'8px 18px 18px',fontSize:'13px',color:'var(--muted)'}}>No notes yet.</div>}
      </div>
    </div>
  );
}
