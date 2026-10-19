'use client';
import { useState, useEffect, useCallback } from 'react';
import { SB } from '@/lib/supabase';
import { notifyOrderNote } from '@/lib/orderNotify';
import { personName, peopleNames, peopleFromStaff, isEveryone } from '@/lib/people';
import { companyColor, initials, fmtDateTime } from '@/lib/display';
import { PeoplePills } from '@/app/components/PeoplePills';

// ── NOTES & ACTIVITY on an order ────────────────────────────────────────────
// One self-contained card for a purchase order or a sales order -- pass
// purchaseOrderId or salesOrderId. It loads the order's notes and the staff
// list, posts a note, and asks /api/orders/notify to email the people picked.
//
// THE PEOPLE PILLS are every staff_profiles row by full name, with an All
// shortcut that picks everyone. Nothing is picked to start with:
//   nothing picked -- "Post note": saved, no email (notify_to NULL, a quiet note)
//   All            -- "Post & notify everyone": saved as the full list of emails
//   some people    -- "Post & notify A & B": saved as that list
// The route mails the picks minus the author, or the author alone when they are
// the only pick (script 122 gave NULL its quiet meaning).
export function OrderNotesPanel({ purchaseOrderId = null, salesOrderId = null }) {
  const col = salesOrderId ? 'sales_order_id' : 'purchase_order_id';
  const orderId = salesOrderId || purchaseOrderId;
  const [notes, setNotes] = useState([]);
  const [staff, setStaff] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [noteTo, setNoteTo] = useState([]);
  const [posting, setPosting] = useState(false);
  const [noteMsg, setNoteMsg] = useState('');

  const load = useCallback(async () => {
    if (!orderId) return;
    const [{ data: ns }, { data: st }] = await Promise.all([
      SB.from('order_notes').select('*').eq(col, orderId).order('created_at', { ascending:false }),
      SB.from('staff_profiles').select('email,full_name').order('full_name', { nullsFirst:false }),
    ]);
    setNotes(ns || []);
    setStaff(st || []);
  }, [col, orderId]);
  useEffect(() => { load(); }, [load]);

  const people = peopleFromStaff(staff);
  const names = emails => peopleNames(staff, emails);
  const everyone = isEveryone(staff, noteTo);

  const postNote = async () => {
    const body = (noteText || '').trim(); if (!body || !orderId) return;
    setPosting(true);
    let author = null; try { const { data } = await SB.auth.getUser(); author = data?.user?.email || null; } catch (e) {}
    const picked = noteTo;
    const { data:n, error } = await SB.from('order_notes')
      .insert({ [col]: orderId, body, author_email: author, notify_to: picked.length ? picked : null }).select().single();
    if (error) { setPosting(false); alert('Couldn’t post note: ' + error.message); return; }
    setNotes(prev => [n, ...prev]); setNoteText(''); setNoteTo([]);
    if (!picked.length) {
      setNoteMsg('Note posted.');
    } else {
      // Named from the route's reply -- who was actually mailed, the author
      // left out -- or, with the local test address on, who would have been.
      const r = await notifyOrderNote(n.id, names(picked));
      const mailed = r.wouldHaveSent || r.sent || [];
      setNoteMsg(r.skipped ? 'Note posted.'
        : r.ok ? 'Note posted & ' + (isEveryone(staff, picked) ? 'everyone' : names(mailed)) + ' notified.'
        : 'Note posted (email skipped).');
    }
    setTimeout(() => setNoteMsg(''), 3000);
    setPosting(false);
  };

  const btnLabel = posting ? 'Posting...'
    : !noteTo.length ? 'Post note'
    : everyone ? 'Post & notify everyone'
    : 'Post & notify ' + names(noteTo);

  return (
    <div className="section-card" style={{marginTop:'20px'}}>
      <div className="section-head"><h3>Notes &amp; Activity</h3></div>
      <div className="note-composer">
        <div style={{marginBottom:'10px'}}>
          <div style={{fontSize:'11px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)',marginBottom:'6px'}}>Notify</div>
          <PeoplePills people={people} value={noteTo} onChange={setNoteTo} showAll disabled={posting} label="Notify" />
          {!noteTo.length && <div style={{fontSize:'11.5px',color:'var(--muted)',marginTop:'6px'}}>Nobody picked — the note is saved without an email.</div>}
        </div>
        <textarea className="form-input" rows={3} placeholder="Add a note or task..." value={noteText} onChange={e => setNoteText(e.target.value)} />
        <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'10px'}}>
          <button className="btn btn-dark btn-sm" onClick={postNote} disabled={posting || !noteText.trim()}>{btnLabel}</button>
          {noteMsg && <span style={{fontSize:'12.5px',color:'var(--accent)'}}>{noteMsg}</span>}
        </div>
      </div>
      <div className="note-list">
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
