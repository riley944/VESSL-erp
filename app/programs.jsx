'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import { SB } from '@/lib/supabase';
import { FilterSelect } from '@/app/components/FilterSelect';
// Overlay, not a hand-rolled backdrop. It carries useDirtyGuard, so a typed note
// is protected from a backdrop click by importing this and nothing else -- which
// is precisely why the guard was put there rather than in each modal.
import { Overlay, useGuardedClose } from '@/app/components/ModalGuard';
// ONE DERIVATION, shared with the panel. This page fetches differently -- in bulk,
// for every program at once -- but it must not DECIDE differently, which is how
// the awarded tile and the awarded filter ended up disagreeing about who won a
// shipment. lib/lifecycle.js owns the rules; this file owns the fetching.
// PIPELINE_STAGES and stageEnteredAt are gone from this list with the derived
// board. The stages are MANUAL_STAGES below, set by a person, and the date a card
// entered one is declared_stage_at rather than anything inferred from records.
// The rest stays: the card still REPORTS what the records say, it just no longer
// obeys them.
import {
  fmt, deriveEvents,
  currentStage, daysSince, CLIENT_OF, sampledFromStage,
} from '@/lib/lifecycle';
// Sync from records is gone with the derived board -- nothing here creates a
// program any more. The quote-form tick is the only door.
// Tab, search, stage filter and the retired toggle survive going into a program and
// coming back, and are gone on reload. See the note at the top of lib/pageState.js.
import { usePageState } from '@/lib/pageState';
// COL, the per-stage colour table, went with the derived tiles and columns it
// dressed, and the BOARD is still one ink -- the rail, the group headings and the
// cards all use a single dark dot, because colour competing with the stale flag
// would cost the only colour down there that means something.
//
// THE ANALYTICS TILES ARE THE ONE EXCEPTION, on Riley word. They match the
// Insights cards, and those carry a coloured dot per metric; six identical grey
// dots would read as a different component wearing the same shape. STAGE_ACCENT
// below dresses the tiles and nothing else.


const norm = t => (t || '').toLowerCase();

// ── THE STAGES, AND THEY ARE SET BY A PERSON ────────────────────────────────
// ONE SAMPLING STAGE, NOT THREE RUNGS. The numbered rungs were built on the
// reasoning that a sample round is the thing that repeats at KUI and one column
// could not say whether a card had been round once or three times. In practice
// nobody used the fourth or the fifth, the board capped at three, and how many
// rounds a product has been through turned out to be something people write in
// the notes rather than record by moving a card. A stage that says sampling is
// happening is the honest shape, and script 65 narrows the CHECK to match.
//
// THIS LIST IS THE BOARD. The tiles, the sections, the drop targets, the stage
// control on the card and the tile accent colours all map over it, so a stage
// added or removed here changes every one of them together, which is why they
// cannot disagree.
//
// The one thing to know if it is ever narrowed again: counts tally whatever
// declared_stage a card holds, but sections render only from this list, so a card
// left on a removed value would count and appear in no section. Script 65 moves
// the rows before it narrows the constraint, for exactly that reason.
//
// Complete is on this list because it is a stage somebody sets -- a sales order
// does NOT move a card, on Riley decision. It lives in its own section at the
// bottom rather than among the pipeline, for the same reason Archived always did.
const MANUAL_STAGES = [
  ['quoted',         'Quoted'],
  ['sampling',       'Sampling'],
  ['testing',        'Testing'],
  ['purchase_order', 'Purchase Order'],
];
const COMPLETE = 'complete';

// Tile dots only, and the palette is the Insights one in pipeline order, so the
// two pages read as one product rather than as two designs that both happen to
// use circles.
const STAGE_ACCENT = {
  quoted:         '#0A84FF',
  sampling:       '#5E5CE6',
  testing:        '#30B050',
  purchase_order: '#0066CC',
};

// 21 days, on Riley word. One threshold rather than one per stage: a per-stage
// table would be a tuning conversation nobody has had yet, and a single number
// can be argued with, which is what makes it honest.
const STALE_DAYS = 21;

// compliance_status = 'not_required' is a DELIBERATE STATEMENT, and rare: 17 of
// 352 products carry it, against 291 still sitting at 'tbd'. Somebody decided
// testing does not apply to this product, which is a different thing from nobody
// having got to it yet -- and the ladder cannot show the difference by greying a
// rung, because grey already means "not done".
//
// So the rung is REMOVED rather than marked n/a. An n/a rung still occupies a
// step and still reads as an unmet gate; four rungs where one can never be
// reached is a ladder that can never be finished. Three rungs that can all be
// reached is the honest shape. The badge and the note say why it is missing, so
// the absence is never a silent one.
const testingNotRequired = product => (product || {}).compliance_status === 'not_required';

// ── NOTES ON A PROGRAM ──────────────────────────────────────────────────────
// APPEND ONLY WAS THE RULE UNTIL SCRIPT 63, and the rule was enforced by grants
// rather than by convention -- authenticated held SELECT and INSERT on
// vessl.program_notes and nothing else, so an edit control would have failed at
// the database even if somebody built one.
//
// 63 REVERSED THAT, NARROWLY. authenticated gained UPDATE on note and edited_at,
// with a RESTRICTIVE policy limiting those updates to rows whose author is the
// caller. Somebody else notes stay read-only here and unwritable at the database,
// which is the same guarantee as before pointed at a smaller set of rows.
//
// 64 MAKES DELETE MEAN DELETE. 63 had shipped a soft delete -- a deleted_at stamp
// and a filter that hid the row -- and it lasted one round, because a note nobody
// can see and nobody can remove is a row that only ever accumulates. The column is
// dropped, DELETE is granted, and a second RESTRICTIVE policy confines it to the
// author exactly as the update one does.
//
// SO A DELETE IS PERMANENT NOW, and the confirm says so. The protection is that it
// is yours to delete and nobody else can.
//
// Newest first, because the last thing said is the thing being caught up on.
function ProgramNotes({ programId, userEmail, onTouched }) {
  const [notes, setNotes] = useState(null);
  const [text, setText]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  // Which note is open in the editor, and the text being edited. One at a time --
  // two open editors would be two unsaved drafts with no way to say which one the
  // modal dirty guard is protecting.
  const [editId, setEditId] = useState(null);
  const [draft, setDraft]   = useState('');

  // No deleted_at filter any more, and no deleted_at in the select -- 64 drops the
  // column. A deleted note is gone from the table, so there is nothing to exclude.
  const load = async () => {
    const { data, error } = await SB.from('program_notes')
      .select('id,author,source,note,created_at,edited_at')
      .eq('program_id', programId)
      .order('created_at', { ascending:false });
    if (error) { setErr(error.message); setNotes([]); return; }
    setNotes(data || []);
  };
  useEffect(()=>{ setNotes(null); setEditId(null); load(); }, [programId]);

  // A NOTE IS A TOUCH, and so is editing one or deleting one. The card reports a
  // single last-touch line and it would be a lie if working on a card left it
  // reading from last week. Stamped after the write lands; a failure here leaves
  // the note correct and the stamp stale, which is the better way round -- the
  // same trade the owner note makes.
  const stampProgram = async () => {
    try {
      await SB.from('programs')
        .update({ updated_at: new Date().toISOString(), updated_by: userEmail || null })
        .eq('id', programId);
    } catch (e) {}
  };

  // Every write ends the same way, so it is written once: stamp the program, read
  // the notes back, and tell the board to re-read so the card behind this modal
  // matches what was just written rather than waiting for the next visit.
  const settle = async () => {
    await stampProgram();
    await load();
    if (onTouched) onTouched();
  };

  // MINE MEANS MINE, matched the way the database will match it. The policy 63
  // adds compares lower(author) to lower(the caller email from the token), so the
  // button that offers the edit has to agree with the rule that permits it --
  // otherwise a control appears and the write behind it is refused.
  const isMine = n => {
    const a = (n.author || '').trim().toLowerCase();
    const me = (userEmail || '').trim().toLowerCase();
    return !!me && a === me;
  };

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setErr('');
    const { error } = await SB.from('program_notes').insert({
      program_id: programId,
      author: userEmail || null,
      // Distinguishes a person typing from anything a later import might write.
      source: 'manual',
      note: body,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setText('');
    await settle();
  };

  const saveEdit = async (n) => {
    const body = draft.trim();
    // Nothing typed, or nothing changed, is a cancel rather than a write. An
    // edited_at stamp for an edit that changed no text would be a false record.
    if (!body || body === n.note) { setEditId(null); return; }
    setBusy(true); setErr('');
    const { error } = await SB.from('program_notes')
      .update({ note: body, edited_at: new Date().toISOString() })
      .eq('id', n.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setEditId(null);
    await settle();
  };

  // NAMED FOR WHAT IT DOES. It was hide, because it wrote a stamp and the list
  // looked away; it removes the row now, so it says so. Asked once, and the
  // wording does not soften it -- there is no undo and nothing keeps a copy.
  //
  // The restrictive policy 64 adds is what makes this safe to offer: the delete is
  // refused at the database for any row the caller did not write, so the button
  // and the rule agree rather than the button being the only guard.
  const removeNote = async (n) => {
    if (!window.confirm('Delete this note? This cannot be undone.')) return;
    setBusy(true); setErr('');
    const { error } = await SB.from('program_notes')
      .delete()
      .eq('id', n.id);
    setBusy(false);
    if (error) { setErr(error.message); return; }
    await settle();
  };

  const when = iso => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-US',
      { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
    catch { return String(iso); }
  };

  return (
    <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'9px'}}>Notes</div>

      <textarea value={text} onChange={e=>setText(e.target.value)} rows={2}
        placeholder="Add a note — you can edit or hide your own notes later"
        style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 11px',
                fontSize:'13px',fontFamily:'inherit',outline:'none',resize:'vertical',
                background:'#fff',boxSizing:'border-box'}} />
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'7px'}}>
        <button onClick={add} disabled={busy || !text.trim()}
          style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 14px',border:'none',
                  fontFamily:'inherit',cursor:busy||!text.trim()?'default':'pointer',
                  background:text.trim()?'#1D1D1F':'#E5E5EA',color:text.trim()?'#fff':'#A0A0A4'}}>
          {busy ? 'Adding…' : 'Add note'}
        </button>
        {err && <span style={{fontSize:'11.5px',color:'var(--hot)'}}>{err}</span>}
      </div>

      {notes === null ? (
        <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>Reading notes…</div>
      ) : notes.length === 0 ? (
        <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>No notes yet.</div>
      ) : (
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'9px'}}>
          {notes.map(n => {
            const mine = isMine(n);
            const editing = editId === n.id;
            return (
              <div key={n.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
                {editing ? (
                  <>
                    <textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={3}
                      style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'8px',padding:'8px 10px',
                              fontSize:'13px',fontFamily:'inherit',outline:'none',resize:'vertical',
                              background:'#fff',boxSizing:'border-box'}} />
                    <div style={{display:'flex',gap:'7px',marginTop:'7px'}}>
                      <button onClick={()=>saveEdit(n)} disabled={busy || !draft.trim()}
                        style={{fontSize:'11.5px',fontWeight:600,borderRadius:'980px',padding:'5px 13px',border:'none',
                                fontFamily:'inherit',cursor:busy||!draft.trim()?'default':'pointer',
                                background:draft.trim()?'#1D1D1F':'#E5E5EA',color:draft.trim()?'#fff':'#A0A0A4'}}>
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={()=>setEditId(null)} disabled={busy}
                        style={{fontSize:'11.5px',fontWeight:600,borderRadius:'980px',padding:'5px 13px',
                                border:'1px solid #E5E5EA',background:'#fff',color:'#5A5A5E',
                                fontFamily:'inherit',cursor:busy?'default':'pointer'}}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{fontSize:'13px',color:'#1D1D1F',lineHeight:1.5,whiteSpace:'pre-wrap'}}>{n.note}</div>
                )}
                <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginTop:'5px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11px',color:'#A0A0A4'}}>
                    {n.author || 'unknown'} · {when(n.created_at)}
                    {/* Said once and plainly. The edit time itself is on the row if
                        anybody needs it; what the reader needs here is to know the
                        words changed after they were first written. */}
                    {n.edited_at ? ' · edited' : ''}
                    {n.source && n.source !== 'manual' ? ' · ' + n.source : ''}
                  </span>
                  {/* OFFERED ONLY ON YOUR OWN NOTES, and the database agrees --
                      the restrictive policy refuses an update to anybody else row,
                      so this is the control matching the rule rather than guarding
                      it. Hidden while an editor is open, because Edit and Cancel
                      next to each other is two ways out of one state. */}
                  {mine && !editing && (
                    <span style={{display:'inline-flex',gap:'8px',marginLeft:'auto'}}>
                      <button onClick={()=>{ setEditId(n.id); setDraft(n.note || ''); }} disabled={busy}
                        style={{fontSize:'11px',background:'none',border:'none',padding:0,color:'#0A84FF',
                                fontFamily:'inherit',cursor:busy?'default':'pointer'}}>Edit</button>
                      <button onClick={()=>removeNote(n)} disabled={busy}
                        style={{fontSize:'11px',background:'none',border:'none',padding:0,color:'var(--hot)',
                                fontFamily:'inherit',cursor:busy?'default':'pointer'}}>Delete</button>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// THE LADDER IS GONE, replaced by SystemKnows further down. It drew four rungs
// inferred from the records -- quoted, sampling, tested, and whichever order
// completed the program -- which was the right card for a board that derived its
// stages. On a manual board the rungs would have been a second opinion drawn to
// look like the state, beside a stage control that actually is it.


// A POPUP, NOT AN INLINE EXPANSION, and the notes box is why the guard matters.
//
// Overlay dismisses on a backdrop click, and every other modal in the app accepts
// that because a half-filled form is recoverable. A note is not -- it is prose
// somebody just wrote and cannot get back. useDirtyGuard watches input events
// inside the card, so typed-but-unsaved text turns the backdrop click into a
// confirm instead of a dismissal. Nothing here has to arrange that beyond using
// Overlay.
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onClose, onTouched }) {
  return (
    <Overlay onClose={onClose} maxWidth={640}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy} onStage={onStage} onOwner={onOwner} onTouched={onTouched} />
    </Overlay>
  );
}

// ── WHAT THE SYSTEM KNOWS, AND DOES NOT ACT ON ──────────────────────────────
// The records for this product and client, reported and nothing more. It exists
// because the manual board threw away a real thing the derived board had: it
// could see that a product had been quoted, sampled, tested or ordered. Throwing
// that away would have been a loss; acting on it would have been the old board.
//
// So the rule is stated on screen rather than only in a commit message -- none of
// this moves the card. Somebody reads it and decides.
//
// Everything here comes from data the board already bulk-fetched, so opening a
// card costs no query.
function SystemKnows({ r }) {
  const p = r.products || {};
  const ev = r.events || {};
  // The same test currentStage uses, imported rather than repeated -- production
  // implies sampling happened, and that rule lives in lib/lifecycle.js.
  const sampled = sampledFromStage(p);
  const row = (label, value, muted) => (
    <div style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>{value}</span>
    </div>
  );
  const none = 'Nothing recorded';
  return (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'4px'}}>What the system knows</div>
      <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'7px'}}>
        Read only. None of this moves the card &mdash; the stage above is whatever somebody set.
      </div>
      {row('Quoted', ev.quoted ? fmt(ev.quoted.on) + (ev.quoted.n > 1 ? ' · ' + ev.quoted.n + ' quotes' : '') : none, !ev.quoted)}
      {/* SAMPLING HAS NO DATE, and that is not an omission. product_stage records
          what a product IS, not when it became that, and no column anywhere
          records the change -- so this line says which flag is set and nothing
          more. Production counts because production implies sampling happened. */}
      {row('Sampling', sampled === 'production' ? 'Product marked Production'
                     : sampled === 'sample' ? 'Product marked Sample'
                     : 'Not recorded', !sampled)}
      {row('Purchase order', ev.ordered ? fmt(ev.ordered.on) : none, !ev.ordered)}
      {row('Sales order', ev.sold ? fmt(ev.sold.on) : none, !ev.sold)}
      {row('Test report', ev.tested ? fmt(ev.tested.on) : none, !ev.tested)}
      {row('Product stage', p.product_stage
        ? p.product_stage.charAt(0).toUpperCase() + p.product_stage.slice(1)
        : 'Not set', !p.product_stage)}
      {row('Compliance', p.compliance_status || 'Not set', !p.compliance_status)}
      {/* What the OLD board would have called this card, kept because it is a
          useful second opinion and labelled so nobody mistakes it for the stage. */}
      {row('Records suggest', r.derivedStage ? (STAGE_HINT[r.derivedStage] || r.derivedStage) : 'Nothing yet', !r.derivedStage)}
      {/* The catalogue status, worded as the Products list words it. A retired
          product with a live card is worth seeing rather than hiding. */}
      {row('Catalogue', p.active === false ? 'Inactive' : p.active === true ? 'Active' : 'Not set',
           p.active == null)}
    </div>
  );
}

// The three stages the old derived board could infer, in its words, so the line
// reads as a second opinion rather than as one of the nine manual stages.
const STAGE_HINT = { quoted:'Quoted', sampling:'Sampling (product stage)', tested:'Tested (report or compliance)' };

// programs.updated_by holds an ADDRESS, deliberately -- an audit crumb has to stay
// readable after a colleague leaves and their profile goes. This turns it into a
// full name when a profile still matches, and shows the address itself when none
// does, so the card never renders a blank where a person should be.
const staffName = (staff, email) => {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const hit = (staff || []).find(s => (s.email || '').trim().toLowerCase() === e);
  return (hit && (hit.full_name || hit.email)) || email;
};

// Split out so the x can read guardedClose from context. The provider lives
// INSIDE Overlay, so a hook called in ProgramDetail would sit above it and get
// the default -- the close button has to be a child to be guarded.
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner, onTouched }) {
  const p = r.products || {};
  const guardedClose = useGuardedClose();
  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>{(r.client||{}).name || '—'}</div>
        </div>
        <button onClick={guardedClose} aria-label="Close"
          style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                  cursor:'pointer',padding:'0 2px',fontFamily:'inherit'}}>×</button>
      </div>
      {/* No banners here. The testing-coverage caveat and the one-client note
          earn their place on the Testing page, where the panel is all there is;
          on a card the header already names the client, and a standing caveat
          about catalogue coverage is not what somebody opened a program to read.
          A card-view removal -- LifecyclePanel still shows both. */}
      {/* ── THE TWO CONTROLS ────────────────────────────────────────────────
          Stage and owner, the only things this page writes. Both are plain
          selects rather than anything cleverer, because a stage move is a
          deliberate act and a dropdown is the control that reads as one. */}
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',marginTop:'14px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
        <label style={{display:'flex',flexDirection:'column',gap:'4px',fontSize:'11px',fontWeight:600,
                       letterSpacing:'.08em',textTransform:'uppercase',color:'#86868B',fontFamily:'inherit'}}>
          Stage
          <select value={r.stage || ''} disabled={busy}
            onChange={e=>onStage(r, e.target.value)}
            style={{border:'1px solid rgba(0,0,0,.12)',borderRadius:'9px',padding:'7px 9px',fontSize:'13px',
                    fontFamily:'inherit',background:'#fff',color:'#1D1D1F',letterSpacing:0,textTransform:'none',
                    cursor:busy?'default':'pointer',minWidth:'165px'}}>
            {!r.stage && <option value="">No stage set</option>}
            {[...MANUAL_STAGES, [COMPLETE,'Complete']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={{display:'flex',flexDirection:'column',gap:'4px',fontSize:'11px',fontWeight:600,
                       letterSpacing:'.08em',textTransform:'uppercase',color:'#86868B',fontFamily:'inherit'}}>
          Owner
          <select value={r.owner_id || ''} disabled={busy}
            onChange={e=>onOwner(r, e.target.value)}
            style={{border:'1px solid rgba(0,0,0,.12)',borderRadius:'9px',padding:'7px 9px',fontSize:'13px',
                    fontFamily:'inherit',background:'#fff',color:'#1D1D1F',letterSpacing:0,textTransform:'none',
                    cursor:busy?'default':'pointer',minWidth:'175px'}}>
            <option value="">Unowned</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
          </select>
        </label>
        {r.since && (
          <div style={{alignSelf:'flex-end',fontSize:'11.5px',color:r.stale?'#8a5a00':'#8A8A8E',paddingBottom:'8px'}}>
            {r.days === 0 ? 'Moved today' : r.days + ' days in this stage'}
            {r.stale ? ' · stale past ' + STALE_DAYS : ''}
          </div>
        )}
      </div>
      {/* Changing the owner writes its own note, so the reassignment is on the
          record rather than only in the column. */}
      <SystemKnows r={r} />
      <ProgramNotes programId={r.id} userEmail={userEmail} onTouched={onTouched} />
    </>
  );
}

export default function Programs({ userEmail }) {
  const [rows, setRows]   = useState([]);
  const [ev, setEv]       = useState(null);
  const [loading, setLoad]= useState(true);
  const [err, setErr]     = useState('');
  // The search box, the retired toggle and whether the Complete section is open --
  // kept across navigation, so opening a program and coming back lands where it
  // left. openId stays plain below, because an expanded card is not a filter.
  //
  // THERE IS NO STAGE FILTER STATE AT ALL NOW. It was stageSel for the chips, then
  // stageF for the rail; the board shows every section at once, so there is nothing
  // to select and the key is deleted rather than kept empty. A stale key left in the
  // store by an earlier mount is harmless -- usePageState merges the store over
  // these defaults, and a name that is not here is never read.
  const [ui, setUi] = usePageState('programs', { search:'', showRetired:false, doneOpen:false, ownerSel:[] });
  const [openId, setOpenId] = useState(null);
  const [staff, setStaff] = useState([]);
  // Set while a stage or an owner is being written, so the control can say so and
  // refuse a second click. Not in the page store -- it is in-flight, not a choice.
  const [saving, setSaving] = useState(null);
  // ── DRAG STATE, ALL OF IT TRANSIENT ─────────────────────────────────────────
  // Which section the pointer is currently over, and which card is in the air.
  // Neither belongs in the page store: a drag that survived navigation would be a
  // card stuck at half opacity on a board nobody is touching.
  const [dropTarget, setDropTarget] = useState(null);
  // THERE IS NO dragId STATE ANY MORE, deliberately. The tile that is in the air
  // used to be identified in React state and faded by a style that read it, and
  // that could be left set by any path where dragend did not arrive -- which is a
  // class of bug, not one bug. The fade is now an inline style written straight
  // onto the drag handle and wiped off it, so a remounted tile starts at full
  // opacity by definition and no state can be stale.
  // Which card is showing its detail, and only ever one. Transient like openId --
  // a row left open across navigation would be somebody else's place, not yours.
  const [expandedId, setExpandedId] = useState(null);
  // program_id -> how many notes, filled in bulk by load().
  const [noteCounts, setNoteCounts] = useState({});
  // A CLICK MUST NOT FOLLOW A DRAG, and a drag must not swallow a real click.
  // Cleared on mousedown, which always precedes both, and set on dragstart -- so
  // the click handler can tell the two apart without a timer. A timer would be a
  // guess about how fast somebody let go.
  const dragMovedRef = useRef(false);

  // ── ENDING A DRAG IS NOT THE SAME AS dragend ────────────────────────────────
  // This clears the SECTION HIGHLIGHT only. The fade on the tile is an inline
  // style the handle writes and wipes itself, for the reason above.
  //
  // dragend is dispatched to the SOURCE element. A tile dropped on another section
  // is unmounted before that happens -- setStage patches rows optimistically, the
  // sections recompute, and React remounts the card under a different parent -- so
  // the handler attached to the old node never runs. That is why this is called
  // from every path that can finish a drag rather than from dragend alone, and why
  // the document listener below exists behind it. Calling it twice is free.
  const endDrag = () => setDropTarget(null);
  // showRetired is ui.showRetired, in the page store above.

  const load = async () => {
    setLoad(true); setErr('');
    try {
      const [p, nt, q, poi, soi, tr, st] = await Promise.all([
        // declared_stage and declared_stage_at are the board now -- the stage a
        // person set, and when they set it. owner_id joins staff_profiles for the
        // name on the card and the owner filter.
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
                + 'updated_at,updated_by,'
                + 'products(id,sku,name,active,product_stage,compliance_status),client:companies!client_company_id(id,name),'
                + 'owner:staff_profiles!owner_id(id,email,full_name)')
          .order('created_at', { ascending:true }),
        // NOTE COUNTS IN BULK, because the expanded card shows one. ProgramNotes
        // still fetches the notes themselves when a modal opens -- this is the
        // count only, and fetching it per card would be one query per row.
        SB.from('program_notes').select('program_id'),
        SB.from('quotes').select('product_id,client_company_id,quote_date,created_at').not('product_id','is',null),
        SB.from('purchase_order_items')
          .select('product_id,purchase_orders(order_date,issued_at,client_company_id,client:companies!client_company_id(name),shipment_pos(shipments(actual_departure,actual_arrival)))')
          .not('product_id','is',null),
        SB.from('sales_order_items')
          .select('product_id,sales_orders(order_date,client_company_id,client:companies!client_company_id(name))')
          .not('product_id','is',null),
        // Product-wide on purpose -- a test report has no client, and testing is
        // not repeated per client. The panel says the same thing on screen.
        SB.from('test_reports').select('product_id,test_date,issue_date,overall_result').not('product_id','is',null),
        // The owner filter offers every colleague, not only those who happen to
        // own a card today -- a filter that grows as work is assigned would keep
        // changing shape under whoever is using it.
        SB.from('staff_profiles').select('id,email,full_name').order('full_name', { nullsFirst:false }),
      ]);
      const e = [p,nt,q,poi,soi,tr,st].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
      setStaff(st.data || []);
      setNoteCounts((nt.data || []).reduce((m, n) => { m[n.program_id] = (m[n.program_id] || 0) + 1; return m; }, {}));
      setEv({ quotes:q.data||[], poItems:poi.data||[], soItems:soi.data||[], reports:tr.data||[] });
    } catch (x) {
      setErr(x && x.message ? x.message : String(x));
    }
    setLoad(false);
  };
  useEffect(()=>{ load(); }, []);

  // ── THE LAST RESORT, OUTSIDE THE REACT TREE ─────────────────────────────────
  // dragend goes to the source element, so a source that was unmounted mid-drag
  // never receives it and its handler never runs. drop goes to the TARGET, which
  // is still mounted, and both events bubble to the document.
  //
  // So the document keeps its own pair of listeners. They wipe the inline fade off
  // every drag handle on the board and drop the section highlight, from outside
  // the tree entirely -- which is the point, because nothing here can be defeated
  // by a remount. Wiping a handle that was never faded costs nothing.
  useEffect(() => {
    const clear = () => {
      setDropTarget(null);
      document.querySelectorAll('[data-plm-drag]').forEach(el => { el.style.opacity = ''; });
    };
    document.addEventListener('dragend', clear);
    document.addEventListener('drop', clear);
    return () => {
      document.removeEventListener('dragend', clear);
      document.removeEventListener('drop', clear);
    };
  }, []);

  const buckets = useMemo(() => {
    if (!ev) return null;
    const key = (pid, cid) => String(pid) + '|' + String(cid);
    const add = (m, k, v) => { if (!m[k]) m[k] = []; m[k].push(v); };
    const quotes = {}, poItems = {}, soItems = {}, reports = {};
    ev.quotes.forEach(r  => { const c = CLIENT_OF.quote(r);  if (c) add(quotes,  key(r.product_id, c), r); });
    ev.poItems.forEach(r => { const c = CLIENT_OF.poLine(r); if (c) add(poItems, key(r.product_id, c), r); });
    ev.soItems.forEach(r => { const c = CLIENT_OF.soLine(r); if (c) add(soItems, key(r.product_id, c), r); });
    ev.reports.forEach(r => add(reports, String(r.product_id), r));

    // firstOrder went with the derived completion below. What survives here is
    // what SystemKnows reports on a card -- the quotes, order lines and reports
    // for this pair -- fetched once for every program rather than per card.
    return { key, quotes, poItems, soItems, reports };
  }, [ev]);

  const enriched = useMemo(() => {
    if (!buckets) return [];
    return rows.map(r => {
      const k = buckets.key(r.product_id, r.client_company_id);
      const events = deriveEvents({
        quotes:  buckets.quotes[k]  || [],
        poItems: buckets.poItems[k] || [],
        soItems: buckets.soItems[k] || [],
        reports: buckets.reports[String(r.product_id)] || [],
      });
      // COMPLETION IS NOT DERIVED ANY MORE. This is where the old board worked out
      // whether an order had finished a program -- its own client, or the product
      // ordered for anyone -- and which order to name. All of it is gone, because
      // Complete is a stage somebody sets, on Riley decision. A sales order arriving
      // is reported on the card and moves nothing.
      // ── THE STAGE IS WHAT SOMEBODY SET ──────────────────────────────────
      // declared_stage, and nothing else. currentStage still runs below, but only
      // to fill the read-only block on the card -- what the records happen to say
      // is information, not a mover of cards. A card with no stage is a real
      // state, not a bug, and gets its own column rather than being hidden.
      const stage = r.declared_stage || null;
      // declared_stage_at is stamped by trg_programs_declared_stage_at on every
      // change, so this is genuinely when the card entered the stage it is in --
      // which the derived board could never say for Sampling.
      const since = r.declared_stage_at || null;
      const derivedStage = currentStage(events, r.products);
      // Retired products never sit on the board, however incomplete they are --
      // nobody is going to quote a product that is out of the catalogue.
      const retired = (r.products || {}).active === false;
      const days = daysSince(since);
      return { ...r, events,
               stage, since, days, retired, derivedStage,
               // STALE IS ABOUT THE CARD, NOT THE PRODUCT. It counts days since the
               // stage was set, so a card nobody has moved in three weeks says so
               // whatever the records are doing underneath.
               stale: stage !== COMPLETE && days !== null && days >= STALE_DAYS,
               ownerName: (r.owner || {}).full_name || (r.owner || {}).email || null,
               // LAST TOUCH, which is a different question from the stage date.
               // declared_stage_at answers when the card last MOVED; updated_at
               // answers when anybody last changed anything about it, including an
               // owner swap or a note. Both are on the expanded card because they
               // disagree usefully.
               lastTouchAt: r.updated_at || null,
               lastTouchBy: staffName(staff, r.updated_by),
               noteCount: noteCounts[r.id] || 0,
               onBoard: stage !== COMPLETE };
    });
    // staff and noteCounts are dependencies now: without them a name stays
    // unresolved and a count stays zero until some other change happens to
    // recompute this.
  }, [rows, buckets, staff, noteCounts]);

  // ── WRITING A STAGE, AND WRITING AN OWNER ───────────────────────────────────
  // The only two things this page changes. Both re-read from the database after
  // the write, so what is on screen ends up being what is stored.
  //
  // A REASSIGNMENT WRITES ITS OWN NOTE, on Riley decision -- program_notes is
  // append-only by grant, so the record cannot be quietly tidied later. The note
  // is written after the update lands; a failed note leaves a correct owner and a
  // missing line, which is the better way round.

  // ONE FUNCTION, TWO CALLERS. The select in the card modal and a card dropped on
  // a section both come through here. That is the whole reason dragging was worth
  // building: declared_stage_at is stamped by the same trigger either way, a
  // failure is reported the same way, and there is no second write path to drift.
  //
  // OPTIMISTIC, BECAUSE A DROP HAS TO LOOK LIKE IT LANDED. A card that sits in its
  // old section for the length of a round trip reads as a refused drop, and the
  // obvious response is to drag it again. So rows is patched first and the write
  // follows; if the write fails the row is put back exactly as it was and the toast
  // says why. declared_stage_at is guessed locally only so the age line does not
  // flash a stale number -- the trigger owns the real value and the load() below
  // replaces the guess with it.
  const setStage = async (r, next) => {
    if (!next || next === r.stage) return;
    const before = rows.find(x => x.id === r.id) || null;
    setSaving(r.id);
    setRows(prev => prev.map(x => x.id === r.id
      ? { ...x, declared_stage: next, declared_stage_at: new Date().toISOString(),
          updated_at: new Date().toISOString(), updated_by: userEmail || null }
      : x));
    const { error } = await SB.from('programs')
      .update({ declared_stage: next, updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', r.id);
    if (error) {
      if (before) setRows(prev => prev.map(x => x.id === r.id ? before : x));
      window._toast?.('Could not move the card — ' + error.message, 'err');
      endDrag();
      setSaving(null);
      return;
    }
    await load();
    // Both exits clear it, because both of them have already replaced the element
    // the drag began on. See the note on endDrag.
    endDrag();
    setSaving(null);
  };

  const setOwner = async (r, nextId) => {
    const next = nextId || null;
    if (next === (r.owner_id || null)) return;
    setSaving(r.id);
    const { error } = await SB.from('programs')
      .update({ owner_id: next, updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', r.id);
    if (error) { window._toast?.('Could not change the owner — ' + error.message, 'err'); setSaving(null); return; }
    const nameOf = id => { const s = staff.find(x => x.id === id); return s ? (s.full_name || s.email) : 'nobody'; };
    try {
      await SB.from('program_notes').insert({
        program_id: r.id, author: userEmail || null, source: 'owner-change',
        note: 'Reassigned from ' + (r.ownerName || 'nobody') + ' to ' + nameOf(next) + ' by ' + (userEmail || 'unknown'),
      });
    } catch (e) {}
    await load(); setSaving(null);
  };

  // ── WHAT MAKES A SECTION A DROP TARGET ──────────────────────────────────────
  // Spread onto the section wrapper. onDragOver has to preventDefault or the drop
  // never fires at all -- the default action for a dragover is to refuse it, which
  // is the one piece of HTML5 drag and drop that reads backwards.
  //
  // The dragleave guard is why the highlight does not flicker: moving the pointer
  // from a section onto a card INSIDE it fires dragleave on the section, so the
  // target is only cleared when the pointer has actually left the subtree.
  const dropProps = (stageKey) => ({
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDragEnter: () => setDropTarget(stageKey),
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(t => (t === stageKey ? null : t)); },
    onDrop: e => {
      e.preventDefault();
      // Cleared here as well as in setStage, because the drop is the last moment
      // the source element is certainly still mounted. A no-op drop -- back onto
      // the section it came from -- returns early inside setStage and would
      // otherwise leave the tile faded with nothing left to clear it.
      endDrag();
      const id = e.dataTransfer.getData('text/plain');
      const row = enriched.find(x => x.id === id);
      // setStage returns early when the stage has not changed, so a card dropped
      // back where it started writes nothing.
      if (row) setStage(row, stageKey);
    },
  });

  const board = useMemo(() => enriched.filter(r => r.onBoard), [enriched]);
  // COMPLETED MEANS COMPLETED. The tab was everything not on the board, which
  // quietly bundled 52 RETIRED PRODUCTS THAT WERE NEVER ORDERED in with 192 real
  // completions and called the total 244. A retired product that never sold is
  // not a finished program -- it is a program that stopped -- and counting the
  // two together overstates the finished work by 27 percent.
  //
  // They are still reachable, because they are the only record that the pair
  // existed at all, but behind a toggle that is off by default.
  // COMPLETE IS A STAGE SOMEBODY SET, not an order arriving. A sales order does
  // not finish a card, on Riley decision, so this reads declared_stage and never
  // the records.
  const finished = useMemo(() => enriched.filter(r => r.stage === COMPLETE), [enriched]);
  // Cards on a product that has left the catalogue. Still reachable, still off the
  // board by default, exactly as before -- the difference is that being retired no
  // longer decides anything about the stage.
  const history  = useMemo(() => enriched.filter(r => r.retired && r.stage !== COMPLETE), [enriched]);
  const done     = useMemo(() => ui.showRetired ? finished.concat(history) : finished,
                           [finished, history, ui.showRetired]);

  const counts = useMemo(() => {
    const c = { none: 0 };
    MANUAL_STAGES.forEach(([k]) => { c[k] = 0; });
    board.forEach(r => { const k = r.stage || 'none'; c[k] = (c[k]||0) + 1; });
    return c;
  }, [board]);

  // ── OWNER, INCLUDING NOBODY ─────────────────────────────────────────────────
  // Unowned is an option with a count rather than an absence, on Riley word. A
  // card with no owner is the one state worth surfacing -- it means the creator
  // resolved to no staff row -- and a filter that could not express it would hide
  // exactly the thing somebody needs to find.
  const ownerCounts = useMemo(() => {
    const c = { none: 0 };
    board.forEach(r => { const k = r.owner_id || 'none'; c[k] = (c[k]||0) + 1; });
    return c;
  }, [board]);

  const ownerOptions = useMemo(() => ([
    { value:'', label:'All owners', count:board.length },
    { value:'none', label:'Unowned', color:'var(--hot)', count:ownerCounts.none || 0 },
    ...staff.map(s => ({ value:s.id, label:s.full_name || s.email, count:ownerCounts[s.id] || 0 })),
  ]), [staff, ownerCounts, board.length]);

  const ownerMatches = r => !ui.ownerSel.length || ui.ownerSel.includes(r.owner_id || 'none');

  const matches = r => {
    if (!ui.search) return true;
    const p = r.products || {};
    return (norm(p.sku) + ' ' + norm(p.name) + ' ' + norm((r.client||{}).name)).includes(norm(ui.search));
  };

  // SEARCH AND OWNER, AND NOTHING ELSE. The stage filter went with the rail --
  // every section is on screen at once now, so narrowing to one stage is what
  // scrolling does. Each section takes its own slice of this list below.
  const shownBoard = useMemo(() => board.filter(r => matches(r) && ownerMatches(r)),
    [board, ui.search, ui.ownerSel]);
  const shownDone  = useMemo(() => done.filter(r => matches(r) && ownerMatches(r))
    .sort((a,b) => String(b.since||'').localeCompare(String(a.since||''))), [done, ui.search, ui.ownerSel]);

  // railStages was here. The sections carry their own headings and counts now, and
  // the tiles above carry the totals, so a second list of the same six labels had
  // nothing left to say.

  // The sweep that used to sit here read every quote, purchase order line and sales
  // order line and created a program for any pair the records proved but the board
  // was missing. It was the right tool for a DERIVED board. On a manual one it is a
  // button that fills the list with cards nobody chose, which is the thing this
  // rework exists to stop, so it is gone along with the five automatic call sites.

  if (loading) return <div style={{padding:'28px 30px',color:'#86868B',fontSize:'14px'}}>Reading programs…</div>;
  if (err) return <div style={{padding:'28px 30px',color:'var(--hot)',fontSize:'14px'}}>Could not read programs — {err}</div>;

  // ── A TILE, MODELLED ON THE PRODUCTION BOARD CARD ───────────────────────────
  // The surface values here are lifted from the purchase order card in
  // ProductionBoard, not invented: radius 11, padding 12 by 13, a 1px #EFEFF1
  // border, the two-layer shadow, grab cursor, and half opacity while in the air.
  // Two draggable boards in one app that dress their cards differently would be
  // two designs; the same values make them one.
  //
  // WHAT THE COLLAPSED TILE SAYS is what a scan needs and nothing else -- the
  // exceptions first as pills, then what it is, then who touched it. The pill row
  // is absent rather than empty when there is nothing to flag, because a reserved
  // blank strip is a row of nothing repeated across the whole board.
  //
  // EXPANSION AND THE MODAL ARE DIFFERENT ANSWERS. The tile expands to say what the
  // card IS; the modal is where it gets changed. Clicking does the cheap one, and
  // Open is a deliberate second step rather than the accident of a click.
  const Card = ({ r }) => {
    const p = r.products || {};
    const open = expandedId === r.id;
    const notReq = testingNotRequired(p);
    // The same guard the drag already uses: cleared on mousedown, set on
    // dragstart. A drag must not toggle the tile, and a click must not be eaten.
    const toggle = () => {
      if (dragMovedRef.current) { dragMovedRef.current = false; return; }
      setExpandedId(open ? null : r.id);
    };
    const line = (label, value, muted) => (
      <div style={{display:'flex',gap:'8px',alignItems:'baseline'}}>
        <span style={{fontSize:'11px',color:'#86868B',minWidth:'92px',flexShrink:0}}>{label}</span>
        <span style={{fontSize:'12px',color:muted?'#A0A0A4':'#1D1D1F',minWidth:0,
                      overflow:'hidden',textOverflow:'ellipsis'}}>{value}</span>
      </div>
    );
    return (
      <div style={{background:'#fff',borderRadius:'11px',border:'1px solid #EFEFF1',overflow:'hidden',
                   boxShadow:'0 1px 2px rgba(0,0,0,.05),0 1px 3px rgba(0,0,0,.04)'}}>

        {/* ── THE HANDLE IS THE COLLAPSED HEADER, AND ONLY IT ─────────────────
            draggable used to sit on the whole tile, which made the expansion a
            drag handle too -- including the Open button. Dragging a card by its
            own button is not a gesture anybody meant to offer.

            A wrapper div rather than draggable on the button itself: draggable on
            a form control behaves differently across browsers, and every other
            draggable in this app is a div. The click guard is untouched, because
            mousedown, dragstart and click all still sit in this one subtree.

            THE FADE IS WRITTEN HERE AND WIPED HERE. No state holds it, so a tile
            that gets remounted mid-drag comes back with no inline style at all,
            which is full opacity by definition. data-plm-drag is what lets the
            document listener above find any handle a lost dragend left faded. */}
        <div draggable data-plm-drag=""
          onMouseDown={()=>{ dragMovedRef.current = false; }}
          onDragStart={e=>{
            e.dataTransfer.setData('text/plain', r.id);
            e.dataTransfer.effectAllowed = 'move';
            dragMovedRef.current = true;
            e.currentTarget.style.opacity = '.5';
          }}
          onDragEnd={e=>{ e.currentTarget.style.opacity = ''; endDrag(); }}
          style={{cursor:'grab'}}>

        <button onClick={toggle}
          style={{display:'flex',flexDirection:'column',alignItems:'stretch',gap:'4px',width:'100%',
                  minHeight:'112px',textAlign:'left',background:'none',border:'none',
                  padding:'12px 13px',cursor:'pointer',fontFamily:'inherit',boxSizing:'border-box'}}>

          {(r.stale || notReq) && (
            <div style={{display:'flex',gap:'5px',flexWrap:'wrap',marginBottom:'2px'}}>
              {r.stale && (
                <span title={'Nothing has moved this card in ' + r.days + ' days'}
                  style={{fontSize:'10px',fontWeight:700,color:'#8a5a00',background:'#FDF0DC',
                          borderRadius:'980px',padding:'2px 7px',fontVariantNumeric:'tabular-nums'}}>
                  {r.days}d
                </span>
              )}
              {notReq && (
                <span style={{fontSize:'9.5px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',
                              color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 7px'}}>
                  Testing not required
                </span>
              )}
            </div>
          )}

          {/* THE THREE IDENTITY LINES ARE CENTRED, and only these three. The pills
              above and the expansion below stay left, because those are lists and a
              centred list has no edge for the eye to run down. */}
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1A1A1C',
                       textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',
                       textOverflow:'ellipsis'}}>{p.sku || '—'}</div>

          {/* Two lines, then cut. A product name is the one field here with no
              length discipline behind it, and one long name must not be allowed to
              set the height of every tile in the row. */}
          <div style={{fontSize:'12.5px',color:'#1D1D1F',lineHeight:1.35,textAlign:'center',
                       display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',
                       overflow:'hidden'}}>{p.name || '—'}</div>

          <div style={{fontSize:'11.5px',color:'#8A8A8E',textAlign:'center',whiteSpace:'nowrap',
                       overflow:'hidden',textOverflow:'ellipsis'}}>{(r.client||{}).name || '—'}</div>

          {/* marginTop auto pins this to the bottom, so the footer sits on the same
              line across a row of tiles whatever the name above it did.
              TWO LINES, because a name without a date says how recently somebody
              touched it only if you already know. The date stands even when the
              name does not -- updated_at is NOT NULL, so it is genuinely known on
              every row, including the ones that predate the updated_by stamp.
              Hiding a date this card actually has would be the worse lie. */}
          <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'auto',paddingTop:'8px',
                       lineHeight:1.4,textAlign:'center'}}>
            <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              Last touch: {r.lastTouchBy || 'not recorded'}
            </div>
            {r.lastTouchAt && (
              <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                Last touch date: {fmt(r.lastTouchAt)}
              </div>
            )}
          </div>
        </button>
        </div>

        {open && (
          <div style={{borderTop:'1px solid #F2F2F4',padding:'11px 13px 12px',
                       display:'flex',flexDirection:'column',gap:'6px'}}>
            {line('Owner', r.ownerName || 'Unowned', !r.ownerName)}
            {line('Last touch date', r.lastTouchAt ? fmt(r.lastTouchAt) : 'Not recorded', !r.lastTouchAt)}
            {line('Stage set', r.since ? fmt(r.since) : 'Not recorded', !r.since)}
            {line('Notes', r.noteCount === 1 ? '1 note' : r.noteCount + ' notes', !r.noteCount)}
            <div style={{marginTop:'5px'}}>
              <button onClick={()=>setOpenId(r.id)}
                style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 14px',border:'none',
                        background:'#1D1D1F',color:'#fff',fontFamily:'inherit',cursor:'pointer'}}>
                Open
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const openRow = enriched.find(x => x.id === openId) || null;

  return (
    <div style={{padding:'26px 30px 60px'}}>
      {openRow && <ProgramDetail r={openRow} userEmail={userEmail} staff={staff}
                                 busy={saving === openRow.id} onStage={setStage} onOwner={setOwner}
                                 onTouched={load}
                                 onClose={()=>setOpenId(null)} />}
      {/* Centred, and the count on its own line beneath. The description
          paragraph that sat here is gone -- the columns and their placeholders
          already say what the board is, and a paragraph nobody rereads after the
          first visit is a paragraph that only costs vertical space above the
          thing people came for. */}
      <div style={{textAlign:'center',marginBottom:'18px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
        <div style={{fontSize:'13px',color:'#86868B',marginTop:'5px'}}>
          {board.length} in the pipeline
        </div>
      </div>

      {/* ── LIVE COUNTS, AS ANALYTICS TILES ──────────────────────────────────
          Matching the Insights KPI cards -- one white card, a coloured dot beside
          a muted label, the number large and tabular beneath -- so the two pages
          read as one product. No sparkline: a stage count has no history to draw,
          and a flat line pretending to be a trend is worse than no line.

          DISPLAY ONLY, AND DELIBERATELY NOT BUTTONS. The rail is the filter. A
          tile that also filtered would be a second control for the same choice,
          able to disagree with the rail on screen -- which is the exact fault the
          tiles-plus-dropdown arrangement had before the rail replaced both.

          They read the WHOLE board rather than the filtered view, so narrowing
          never makes a total lie. */}
      <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',
                   overflow:'hidden',marginBottom:'18px'}}>
        {/* The column count comes from the array rather than a number typed here.
            It was a hardcoded six, and collapsing the three sample rungs into one
            Sampling stage left four tiles sitting in a six column grid with two
            empty slots on the right -- a stage list and a layout that disagreed
            because only one of them knew the stages had changed. */}
        <div style={{display:'grid',gridTemplateColumns:`repeat(${MANUAL_STAGES.length},1fr)`}}>
          {MANUAL_STAGES.map(([k,l],i)=>(
            <div key={k} style={{padding:'20px 22px',borderLeft:i>0?'1px solid rgba(0,0,0,.06)':'none'}}>
              <div style={{display:'flex',alignItems:'center',gap:'7px',marginBottom:'13px'}}>
                <span style={{width:'6px',height:'6px',borderRadius:'50%',flexShrink:0,
                              background:STAGE_ACCENT[k]||'#86868B'}} />
                <span style={{fontSize:'13px',color:'#86868B',fontWeight:400,letterSpacing:'-.006em'}}>{l}</span>
              </div>
              <div style={{fontSize:'27px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.026em',
                           lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{counts[k]||0}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'18px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'320px'}}>
          <input value={ui.search} onChange={e=>setUi('search', e.target.value)} placeholder="Search product, SKU or client…"
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',
                    fontSize:'13.5px',outline:'none',fontFamily:'inherit',background:'#fff',boxSizing:'border-box'}} />
        </div>
        {/* The All stages dropdown was here. The rail on the left of the board is
            that control now -- it selects the same thing and shows every count
            without a click, so keeping both would be two controls for one choice
            that could disagree on screen. */}
        {/* Owner narrows every view, because "what is Kristy carrying" is as fair a
            question about finished work as about live work. */}
        <FilterSelect multiple label="All owners" value={ui.ownerSel} onChange={v=>setUi('ownerSel', v)} options={ownerOptions} />
        <div style={{flex:1}} />
      </div>

      <>
          {/* ── THE SECTIONS ARE THE BOARD ────────────────────────────────────
              The rail is gone and the stage groups take its place, full width,
              Quoted through Purchase Order stacked top to bottom. The rail bought
              one thing -- a stage list always on screen -- at the price of showing
              one section at a time. The tiles above carry the counts now, so what
              is left for the board to do is BE the board.

              EVERY SECTION IS A DROP TARGET, and a card dropped on one goes through
              the same setStage the modal select calls. No stage set is deliberately
              NOT one: none is a display key for a null stage, not a value the CHECK
              accepts, so writing it would be a constraint violation dressed up as a
              move. It stays a place cards can sit and not a place they can be put. */}
          {[...MANUAL_STAGES, ...((counts.none||0) > 0 ? [['none','No stage set']] : [])].map(([k,l])=>{
            const inGroup = shownBoard.filter(r => (r.stage || 'none') === k);
            const droppable = k !== 'none';
            const over = droppable && dropTarget === k;
            return (
              <div key={k} {...(droppable ? dropProps(k) : {})}
                style={{marginBottom:'22px',borderRadius:'14px',padding:'10px 12px 6px',
                        background:over?'rgba(10,132,255,.06)':'transparent',
                        boxShadow:over?'inset 0 0 0 2px #0A84FF':'none',
                        transition:'background .12s'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'0 2px 12px'}}>
                  <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,
                                background:k==='none'?'#C7C7CC':'#1D1D1F'}} />
                  <span style={{fontSize:'14px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.01em'}}>{l}</span>
                  <span style={{fontSize:'12.5px',color:'#A0A0A4',fontVariantNumeric:'tabular-nums'}}>{inGroup.length}</span>
                </div>
                {/* ONE LINE, NOT A BOX. Six dashed placeholders down a page is
                    scaffolding pretending to be content. A sentence says the same
                    thing and lets the eye skip it. It keeps its height while a card
                    is in the air, so an empty section is still somewhere to aim. */}
                {inGroup.length === 0 ? (
                  <div style={{fontSize:'13px',color:'#A0A0A4',padding:'0 2px 10px'}}>Nothing here yet.</div>
                ) : (
                  /* TILES THAT WRAP, not a column that scrolls. A stage with a
                     hundred cards was a hundred rows and a page of scrolling; the
                     same hundred is a few rows of tiles, and the section still
                     reads as one block you can drop onto.

                     alignItems start rather than the grid default of stretch, so an
                     expanded tile grows on its own instead of dragging every tile
                     beside it to the same height. The minHeight on the tile is what
                     keeps the collapsed ones even without it. */
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(230px,1fr))',
                               gap:'10px',alignItems:'start'}}>
                    {inGroup.map(r => <Card key={r.id} r={r} />)}
                  </div>
                )}
              </div>
            );
          })}

          {/* ── COMPLETE, LAST AND SHUT ───────────────────────────────────────
              A finished program is not part of the pipeline, so it sits beneath it
              rather than among it, and it opens only when somebody asks. The header
              is the drop target as well as the toggle: a card dropped here is marked
              complete through the same setStage, open or shut, so finishing a
              program is the same gesture as any other move.

              It keeps the row layout rather than becoming cards. The catalogue dot,
              the date it was marked complete and the History badge are what this
              list is read for, and a Card carries none of them. Rows open the modal,
              whose stage control is how a completed program is reopened. */}
          <div {...dropProps(COMPLETE)}
            style={{borderRadius:'14px',padding:'12px',marginTop:'4px',
                    background:dropTarget===COMPLETE?'rgba(10,132,255,.06)':'#FAFAFA',
                    boxShadow:dropTarget===COMPLETE?'inset 0 0 0 2px #0A84FF':'none',
                    transition:'background .12s'}}>
            <button onClick={()=>setUi('doneOpen', !ui.doneOpen)}
              style={{display:'flex',alignItems:'center',gap:'8px',width:'100%',textAlign:'left',
                      background:'none',border:'none',padding:'2px',cursor:'pointer',fontFamily:'inherit'}}>
              <span style={{fontSize:'10px',color:'#86868B',width:'10px',flexShrink:0}}>{ui.doneOpen ? '▾' : '▸'}</span>
              <span style={{width:'8px',height:'8px',borderRadius:'50%',flexShrink:0,background:'#8E8E93'}} />
              <span style={{fontSize:'14px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.01em'}}>Complete</span>
              <span style={{fontSize:'12.5px',color:'#A0A0A4',fontVariantNumeric:'tabular-nums'}}>{finished.length}</span>
            </button>

            {ui.doneOpen && (
              <div style={{marginTop:'12px'}}>
                <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'9px'}}>
                  <label style={{display:'inline-flex',alignItems:'center',gap:'7px',fontSize:'12.5px',
                                 color:'#5A5A5E',cursor:'pointer',fontFamily:'inherit'}}>
                    <input type="checkbox" checked={ui.showRetired} onChange={e=>setUi('showRetired', e.target.checked)}
                      style={{cursor:'pointer'}} />
                    Include {history.length} on retired products
                  </label>
                </div>
                <div style={{background:'#fff',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',overflow:'hidden'}}>
                  {shownDone.length === 0 ? (
                    <div style={{padding:'44px 24px',textAlign:'center',fontSize:'13.5px',color:'#86868B'}}>Nothing here.</div>
                  ) : shownDone.map((r,i) => {
                    const p = r.products || {};
                    return (
                      <div key={r.id} style={{borderTop:i>0?'1px solid #F5F5F7':'none'}}>
                        <button onClick={()=>setOpenId(openId===r.id?null:r.id)}
                          style={{display:'flex',width:'100%',textAlign:'left',background:'none',border:'none',gap:'12px',
                                  padding:'13px 18px',cursor:'pointer',fontFamily:'inherit',alignItems:'center',flexWrap:'wrap'}}>
                          <span style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F',minWidth:'110px'}}>{p.sku || '—'}</span>
                          <span style={{fontSize:'14px',color:'#1D1D1F',flex:'1 1 200px'}}>{p.name || '—'}</span>
                          <span style={{fontSize:'13px',color:'#5A5A5E',minWidth:'130px'}}>{(r.client||{}).name || '—'}</span>
                          {/* CATALOGUE STATUS, worded and coloured exactly as on the
                              Products list -- green Active, red Inactive, grey Not
                              set. products.active is three-state and only false is
                              Inactive; NULL is undecided, not retired. */}
                          <span style={{fontSize:'12.5px',color:'#86868B',minWidth:'80px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                            <span style={{width:'6px',height:'6px',borderRadius:'50%',flexShrink:0,
                              background: p.active === false ? 'var(--hot)' : p.active === true ? 'var(--ok)' : 'var(--muted)'}} />
                            {p.active === false ? 'Inactive' : p.active === true ? 'Active' : 'Not set'}
                          </span>
                          <span style={{fontSize:'12.5px',color:'#8A8A8E',minWidth:'150px'}}>
                            {r.stage === COMPLETE ? 'Marked complete ' + fmt(r.since) : 'Product retired'}
                          </span>
                          <span style={{fontSize:'12.5px',minWidth:'110px',color:r.ownerName?'#8A8A8E':'var(--hot)'}}>
                            {r.ownerName || 'Unowned'}
                          </span>
                          {testingNotRequired(p) && (
                            <span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',
                                          color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 8px'}}>No testing</span>
                          )}
                          {r.retired && (
                            <span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',
                                          color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 8px'}}>History</span>
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <p style={{margin:'18px 0 0',fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.55,maxWidth:'720px'}}>
            Drag a card to move it, or open one to change its stage, change its owner or
            add a note. Nothing here moves on its own &mdash; an order, a test report or a
            change on Testing is reported on the card and never acts on it. A card appears
            only when somebody ticks Create PLM program on a quote.
          </p>
        </>
    </div>
  );
}
