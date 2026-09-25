'use client';
// useRef went with the drag guard, and FilterSelect with the owner dropdown the
// chips replaced. Neither would have errored if left -- an unused import resolves
// perfectly well -- which is why they are removed by hand.
import { useState, useEffect, useMemo, useRef } from 'react';
import { SB } from '@/lib/supabase';
// Overlay, not a hand-rolled backdrop. It carries useDirtyGuard, so a typed note
// is protected from a backdrop click by importing this and nothing else -- which
// is precisely why the guard was put there rather than in each modal.
import { Overlay, useGuardedClose, useDirtySource } from '@/app/components/ModalGuard';
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
  currentStage, daysSince, CLIENT_OF, sampledFromStage, shipmentsOf,
} from '@/lib/lifecycle';
// The three product option sets, shared with the Testing product modal so the two
// screens cannot offer different words for the same stored value.
import { COMPLIANCE_OPTS, STAGE_OPTS, CATALOGUE_OPTS, catalogueKey } from '@/lib/products';
// The export control Testing, Products and Codes already use. It owns the pill,
// the menu and the dismissal; the writers below are this page's business, which
// is the split that file states at the top of itself.
import { ExportButton } from '@/app/components/ExportButton';
// lib/excel.js, not an import of exceljs. The package is ~900KB and this file
// once carried its own copy of the loader -- see the note at the top of that
// file, which names programs.jsx as one of the two places it was written twice.
import { loadExcelJS, excelDate } from '@/lib/excel';
import { seedStageTasks as seedTasksFor, syncProductStage } from '@/lib/programs';
// Sync from records is gone with the derived board -- nothing here creates a
// program any more. The quote-form tick is the only door.
// Tab, search, stage filter and the retired toggle survive going into a program and
// coming back, and are gone on reload. See the note at the top of lib/pageState.js.
import { usePageState } from '@/lib/pageState';
// COL, the per-stage colour table, went with the derived tiles and columns it
// dressed, and for a long time the BOARD was deliberately ONE INK -- a single
// dark dot on every heading and every card -- so that no colour competed with
// the stale flag, which was the only colour down there that meant anything.
//
// THAT DECISION IS NOW REVERSED, on request. The board is colour-coded by stage,
// from one table that hangs off MANUAL_STAGES itself, so a stage carries its
// colour to its dot, its drop target, its count tile and the stripe along the
// bottom of every card sitting in it. Dragging a tile to another section
// repaints it, which is the point -- a card visibly becomes where it was put.
//
// THE COST THE OLD RULE WAS PROTECTING IS REAL, AND IT IS THIS. Testing is red
// and the stale flag is red, so on the Testing section a stripe and a warning
// now share a colour. Stale is still WORDED on the tile -- "stale past 21" next
// to the day count, not colour alone -- so the information survives the
// collision. If the two do start being confused in practice, this note is why,
// and the table below is the single place to change.


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
//
// THE COLOUR IS THE THIRD ELEMENT, on this list rather than in an object keyed
// by the same strings beside it. Two lists keyed alike is exactly how a stage
// gets added to one and forgotten in the other -- the fault the hardcoded
// six-column grid already cost this page once. Everything that destructures
// [k,l] is untouched by a third item, so no reader below had to move.
const MANUAL_STAGES = [
  ['quoted',     'Quoting',    '#8E8E93'],
  ['sampling',   'Sampling',   '#c2790b'],
  ['revision',   'Revision',   '#7d5bd6'],
  ['testing',    'Testing',    '#d6492f'],
  ['production', 'Production', '#3461e0'],
  ['shipped',    'Shipped',    '#0f9d6e'],
];
// THE STORED VALUE STAYS quoted AND ONLY THE WORD CHANGES, which is the trade
// COMPLETE_LABEL used to make for In Production. Renaming the value would mean a
// script, a CHECK change and a migration for a relabelling.
//
// SHIPPED IS THE END, and it is a column like any other rather than a collapsed
// section beneath the board. A finished program is still a program, and the old
// arrangement -- pipeline above, Complete shut below -- was built when Complete
// meant something a sales order had done. It is a stage somebody sets now.
const SHIPPED = 'shipped';
// The two stages a sample can be out during. Both the overdue flag and the card
// sample rounds ask this, so it is stated once.
const SAMPLING_STAGES = ['sampling', 'revision'];
// THE ONE COLOUR TABLE, derived rather than typed a second time. Five of the six
// are globals.css tokens -- warn, hot, info, ok and a grey -- so the board wears
// the palette the rest of the app carries. Revision is the one invented colour,
// a purple, because it sits between amber Sampling and red Testing and needed to
// be distinct from both.
//
// Quoting keeps its grey deliberately, since a stage nobody has acted on yet
// should not be the loudest thing on the page. Production is blue and Shipped is
// green, which is where Purchase Order and In Production were.
const STAGE_ACCENT = Object.fromEntries(MANUAL_STAGES.map(([k, , c]) => [k, c]));

// No stage set has no colour of its own and must not borrow one. It is the
// absence of an answer, and a pale grey is what says that.
const accentOf = k => STAGE_ACCENT[k] || '#C7C7CC';

// Drag came back after the Advance button went -- see DRAGGING A TILE in
// Programs. The column under the pointer is marked with an inset ring in the
// stage's own colour rather than a tint, so no second colour table is needed.
//
// tintOf went with the drop targets. It existed only to tint a section while a
// card was over it, and there is nothing to drag any more.

// 21 days, on Riley word. One threshold rather than one per stage: a per-stage
// table would be a tuning conversation nobody has had yet, and a single number
// can be argued with, which is what makes it honest.
const STALE_DAYS = 21;

// ── HEALTH, THE 11 AUG MODEL ────────────────────────────────────────────────
// Three states, and the left edge of every tile carries one. It answers a
// different question from the stage -- the stage says WHERE a card is, this says
// whether it is moving -- and that is why Riley had both on one tile.
//
// IT TAKES THE CARD'S TASKS, which the board reads in bulk with everything else.
// Two of the four rules below read them -- blocked on us for a week, and a task
// past its due date -- and a card with no checklist simply never trips those two.
//
// THE THRESHOLDS ARE RILEY NUMBERS -- 7 days blocked on us, 14 days in a stage --
// and they are NOT the same as STALE_DAYS, which is 21 and is what the tile pill
// says in words. Two numbers describing nearby things is a real smell; they are
// left as they are because unifying them is a decision about what the board
// should warn at, not a tidy-up, and nobody has made it.
const HEALTH = {
  on_track: { label:'On track', color:'#30D158' },
  at_risk:  { label:'At risk',  color:'#FF9F0A' },
  stalled:  { label:'Stalled',  color:'#FF375F' },
};
// STAGE_TASKS and seedStageTasks live in lib/programs.js since stage 4. A saved
// purchase order moves a card into Production from page.jsx, and it has to leave
// the same checklist a person moving the card here would -- one list, one rule.
// Who a task is waiting on. The four values are the CHECK script 76 put on
// program_tasks.blocker, and the colours are the 11 Aug ones.
const BLOCKERS = {
  none:    { label:'No blocker',        dot:'transparent', text:'#8A8A8E' },
  factory: { label:'Waiting · factory', dot:'#0A84FF',     text:'#0A84FF' },
  client:  { label:'Waiting · client',  dot:'#FF9F0A',     text:'#B45309' },
  us:      { label:'Waiting · us',      dot:'#FF375F',     text:'#B91C1C' },
};
const openTasks = r => (r.tasks || []).filter(t => !t.done);
// The blocker a tile names -- us first, because that is the one this office can
// act on, then client, then factory.
const blockerOf = r => {
  const open = openTasks(r);
  return ['us', 'client', 'factory'].find(b => open.some(t => t.blocker === b)) || null;
};
// ── THE LATEST SAMPLE ROUND ─────────────────────────────────────────────────
// Rounds are saved entries on program_sample_rounds, script 80, and the board
// reads them in bulk, highest round first. The latest round is the highest
// number -- not the newest saved -- because a round 1 corrected after round 3
// is still round 1. Its due back is the one the overdue flag, the tile pill and
// the Stalled and Overdue samples tiles read. The four programs columns script
// 77 added are still in the table and nothing reads or writes them.
const latestRound = r => (r.rounds || [])[0] || null;
const sampleOverdue = r => {
  const due = (latestRound(r) || {}).due_back;
  return !!due && daysSince(due) > 0 && SAMPLING_STAGES.includes(r.stage);
};
const healthOf = (r, tasks = []) => {
  const open = (tasks || []).filter(t => !t.done);
  const days = r.days || 0;
  if (sampleOverdue(r)) return 'stalled';
  if (open.some(t => t.blocker === 'us') && days > 7) return 'stalled';
  if (days > 14) return 'at_risk';
  if (open.some(t => t.due_date && daysSince(t.due_date) > 0)) return 'at_risk';
  return 'on_track';
};

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
// ── ONE NOTES PANEL, TWO TABLES ─────────────────────────────────────────────
// Card Notes belong to the program; General Notes belong to the product and
// are shared by every card for that SKU (product_notes, kind still 'sampling'). The add, edit and delete behaviour is
// identical, and so is the author rule the database enforces -- so this takes the
// table, the key column and the key value rather than existing twice. Two copies
// would be two places for the mine-means-mine test to drift from the policy that
// actually permits the write.
//
// programId is separate from keyId on purpose. Whichever table a note lands in,
// the PROGRAM is what gets stamped -- the card in front of somebody reports one
// last touch and typing on it must move that.
// ── MINE MEANS MINE, IN ONE PLACE ───────────────────────────────────────────
// The notes panel and the sample log both offer Edit and Delete on your own rows
// only, and the database refuses the write for anybody else through a RESTRICTIVE
// policy. The button that OFFERS the edit therefore has to match the rule that
// PERMITS it, or a control appears and the write behind it is refused -- so the
// comparison is written once, the way scripts 63 and 64 wrote it, lowercased and
// trimmed on both sides.
const authorIsMe = (author, email) => {
  const a = (author || '').trim().toLowerCase();
  const me = (email || '').trim().toLowerCase();
  return !!me && a === me;
};

// A NOTE IS A TOUCH, and so is a task, an edit and a delete. The tile reports
// Last edited by, and it would be a lie if working on a card left it reading
// from last week. Stamped after the write lands; a failure here leaves the
// record correct and the stamp stale, which is the better way round.
//
// IT SAYS SO WHEN IT FAILS. Returns null on success and a message otherwise,
// and the note and checklist callers toast it -- a stale Last edited line with
// nothing said is exactly the silent drift the tile exists to prevent. A
// success that updated no row counts as a failure: RLS filtering the row away
// returns no error and changes nothing.
const touchProgram = async (programId, userEmail) => {
  try {
    const { data, error } = await SB.from('programs')
      .update({ updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', programId)
      .select('id');
    if (error) return error.message;
    if (!data || !data.length) return 'no card row was updated';
    return null;
  } catch (e) {
    return (e && e.message) || String(e);
  }
};
const touchFailedToast = msg =>
  window._toast?.('Saved, but the card’s Last edited stamp could not be updated — ' + msg, 'err');

// staff is the board's staff_profiles list, for showing the author by NAME.
// author itself stays the email -- the edit and delete policies compare it to
// the email in the caller's token, so a name stored there would lock the
// writer out of their own note. The name is looked up for display only.
// ── CARD NOTES ARE PER STAGE (script 79) ────────────────────────────────────
// stageScoped turns it on, for program_notes only; General Notes (product_notes)
// pass nothing and behave exactly as before. A scoped panel lists the notes
// written in the card's current stage -- plus any with no stage, which belong
// everywhere -- and folds the rest into a muted "N notes in other stages" line
// that opens to them grouped by stage, the way Open elsewhere does for tasks.
// The stage a note was written in comes from insertExtra, which the card fills
// with its current stage; it is never edited afterwards, and the grant agrees.
function NotesPanel({ staff = [], table, keyCol, keyId, insertExtra = {}, extraCol, extraDefault,
                      filter = null, title, subtitle, programId, userEmail, onTouched,
                      stageScoped = false, stage = null }) {
  const [notes, setNotes] = useState(null);
  // Per card-open, not remembered -- the same rule as Open elsewhere.
  const [showOther, setShowOther] = useState(false);
  const [text, setText]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  // Which note is open in the editor, and the text being edited. One at a time --
  // two open editors would be two unsaved drafts with no way to say which one the
  // modal dirty guard is protecting.
  const [editId, setEditId] = useState(null);
  const [draft, setDraft]   = useState('');

  // ── WHAT THE CLOSE GUARD SEES ─────────────────────────────────────────────
  // The same arrangement as the sample rounds. Both boxes below are
  // data-noguard, and the panel reports for itself: a new note with words in it,
  // or an open edit whose text differs from the saved note. Add note empties the
  // box and Save closes the editor, so the card then closes without asking; words
  // typed and not added still ask. Trimmed, because the panel saves trimmed text
  // and treats a whitespace-only change as no change.
  const editingNote = editId && notes ? notes.find(n => n.id === editId) : null;
  useDirtySource(!!text.trim() || (!!editingNote && draft.trim() !== (editingNote.note || '').trim()));

  // No deleted_at filter any more, and no deleted_at in the select -- 64 drops the
  // column. A deleted note is gone from the table, so there is nothing to exclude.
  //
  // THE FILTER EXISTS BECAUSE ONE TABLE NOW HOLDS TWO THINGS. Script 67 put
  // sample events in product_notes beside the free-text sampling notes, keyed on
  // the same product. Without narrowing on kind this panel would list every
  // sample event as though somebody had typed it as a note -- which looks like
  // data rather than like a bug, and is the worse kind of wrong.
  const load = async () => {
    let qy = SB.from(table)
      .select('id,author,note,created_at,edited_at' + (extraCol ? ',' + extraCol : '') + (stageScoped ? ',stage' : ''))
      .eq(keyCol, keyId);
    if (filter) qy = qy.eq(filter.col, filter.val);
    const { data, error } = await qy.order('created_at', { ascending:false });
    if (error) { setErr(error.message); setNotes([]); return; }
    setNotes(data || []);
  };
  // Keyed on the row the notes belong to, not on the program -- the sampling panel
  // reloads when the product changes and the general one when the card does.
  useEffect(()=>{ setNotes(null); setEditId(null); load(); }, [table, keyId]);

  // A NOTE IS A TOUCH, and so is editing one or deleting one. The card reports a
  // single last-touch line and it would be a lie if working on a card left it
  // reading from last week. Stamped after the write lands; a failure here leaves
  // the note correct and the stamp stale, which is the better way round -- the
  // same trade the owner note makes.
  const stampProgram = () => touchProgram(programId, userEmail);

  // Every write ends the same way, so it is written once: stamp the program, read
  // the notes back, and tell the board to re-read so the card behind this modal
  // matches what was just written rather than waiting for the next visit.
  const settle = async () => {
    const failed = await stampProgram();
    if (failed) touchFailedToast(failed);
    await load();
    if (onTouched) onTouched();
  };

  // MINE MEANS MINE, matched the way the database will match it. The policy 63
  // adds compares lower(author) to lower(the caller email from the token), so the
  // button that offers the edit has to agree with the rule that permits it --
  // otherwise a control appears and the write behind it is refused.
  const isMine = n => authorIsMe(n.author, userEmail);

  const add = async () => {
    const body = text.trim();
    if (!body) return;
    setBusy(true); setErr('');
    const { error } = await SB.from(table).insert({
      [keyCol]: keyId,
      author: userEmail || null,
      // source on a program note, kind on a product note. Both distinguish a
      // person typing from anything a later import might write.
      ...insertExtra,
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
    const { error } = await SB.from(table)
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
    const { error } = await SB.from(table)
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

  // One note as a card -- who and when, Edit and Delete on your own, the text or
  // its editor. Lifted out of the list so the current stage and the other
  // stages render notes identically.
  const renderNote = n => {
            const mine = isMine(n);
            const editing = editId === n.id;
            return (
              <div key={n.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
                {/* WHO AND WHEN, ABOVE THE WORDS. The name comes from staff_profiles
                    by the stored email, falling back to the email itself when no
                    profile matches -- so a colleague who has left still reads as
                    somebody rather than as a blank. */}
                <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginBottom:'5px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11px',color:'#A0A0A4'}}>
                    <span style={{fontWeight:600,color:'#5A5A5E'}}>{staffName(staff, n.author) || 'unknown'}</span> · {when(n.created_at)}
                    {/* Said once and plainly. The edit time itself is on the row if
                        anybody needs it; what the reader needs here is to know the
                        words changed after they were first written. */}
                    {n.edited_at ? ' · edited' : ''}
                    {extraCol && n[extraCol] && n[extraCol] !== extraDefault ? ' · ' + n[extraCol] : ''}
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
                {editing ? (
                  <>
                    <textarea data-noguard value={draft} onChange={e=>setDraft(e.target.value)} rows={3}
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
              </div>
            );
  };

  return (
    <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:subtitle?'3px':'9px'}}>{title}</div>
      {subtitle && (
        <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'9px'}}>{subtitle}</div>
      )}

      <textarea data-noguard value={text} onChange={e=>setText(e.target.value)} rows={2}
        placeholder="Add a note — you can edit or delete your own notes later"
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
      ) : (() => {
        // This stage's notes, and notes with no stage; everything else is folded.
        const here  = stageScoped ? notes.filter(n => !n.stage || n.stage === stage) : notes;
        const other = stageScoped ? notes.filter(n => n.stage && n.stage !== stage) : [];
        const link = (label, onClick) => (
          <button onClick={onClick}
            style={{background:'none',border:'none',padding:0,fontSize:'11px',fontWeight:500,color:'#A0A0A4',
                    cursor:'pointer',fontFamily:'inherit',textDecoration:'underline',textUnderlineOffset:'2px'}}>{label}</button>
        );
        return (
          <>
            {here.length === 0 ? (
              <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>
                {other.length ? 'No notes in this stage.' : 'No notes yet.'}
              </div>
            ) : (
              <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'9px'}}>
                {here.map(renderNote)}
              </div>
            )}
            {other.length > 0 && !showOther && (
              <div style={{marginTop:'12px',fontSize:'11.5px',color:'#B0B0B4'}}>
                {other.length} note{other.length === 1 ? '' : 's'} in other stages · {link('Show all', () => setShowOther(true))}
              </div>
            )}
            {other.length > 0 && showOther && (
              <div style={{marginTop:'14px'}}>
                <div style={{display:'flex',alignItems:'baseline',gap:'8px'}}>
                  <span style={{fontSize:'11px',fontWeight:600,color:'#B0B0B4',textTransform:'uppercase',letterSpacing:'.06em'}}>
                    Other stages · {other.length}
                  </span>
                  {link('Show this stage only', () => setShowOther(false))}
                </div>
                {/* In ladder order, each stage named, the way the working file prints them. */}
                {MANUAL_STAGES.filter(([k]) => other.some(n => n.stage === k)).map(([k, l]) => (
                  <div key={k} style={{marginTop:'10px'}}>
                    <div style={{fontSize:'11.5px',fontWeight:600,color:'#86868B',marginBottom:'6px'}}>{l}</div>
                    <div style={{display:'flex',flexDirection:'column',gap:'9px'}}>
                      {other.filter(n => n.stage === k).map(renderNote)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        );
      })()}
    </div>
  );
}
// ── THE SAMPLE LOG IS GONE FROM THE CARD ────────────────────────────────────
// Script 67's product_notes rows of kind sample_event are still in the table,
// untouched; nothing on this page reads or writes them any more. Sampling is
// recorded per card as saved sample rounds (script 80), and the Sampling row in
// What the system knows reads the latest one -- see SampleRounds and roundText.

// ── QUICK EMAILS ARE GONE ───────────────────────────────────────────────────
// The per-stage templates, the composer and its recipient chips were removed in
// every stage, on request. What survived is below: shortDate, which the
// checklist uses for due dates, and the card's factory name (useCardFactory).

// "Sep 18". A plain date is read as local noon so no timezone moves it a day.
// ── THE CARD'S FACTORY, FROM QUOTES ALREADY IN HAND ─────────────────────────
// useCardFactory's rule, applied to the board's bulk quote fetch for the board
// export: the latest quote for this product and client by quote date, newest
// first with undated quotes last, then by created_at -- and that quote's factory,
// blank if it names none. The card reads its own copy when it opens; this is the
// same answer without a query per card.
const factoryOfQuotes = quotes => {
  const sorted = [...(quotes || [])].sort((a, b) => {
    const ad = a.quote_date || '', bd = b.quote_date || '';
    if (ad !== bd) { if (!ad) return 1; if (!bd) return -1; return ad < bd ? 1 : -1; }
    const ac = a.created_at || '', bc = b.created_at || '';
    return ac < bc ? 1 : ac > bc ? -1 : 0;
  });
  return (sorted[0] || {}).factory || '';
};

const shortDate = s => {
  if (!s) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
};

// ── THE CARD'S FACTORY ──────────────────────────────────────────────────────
// programs has no factory column, so the factory the card names -- in its
// header and in the working export -- is the one written on the latest quote
// for this product and client. Read when the card opens, not in the board's
// bulk fetch.
//
// This is the factory half of what was useCardContacts. The rest of that hook
// looked up client and factory contacts -- the latest quote first, then the
// company directory, primary first -- for the quick emails' recipients; it went
// with them, and this is the part that still has readers.
function useCardFactory(r) {
  const [factoryName, setFactoryName] = useState('');
  useEffect(() => {
    let dead = false;
    setFactoryName('');
    (async () => {
      let name = '';
      try {
        if (r.product_id && r.client_company_id) {
          const { data } = await SB.from('quotes')
            .select('factory')
            .eq('product_id', r.product_id).eq('client_company_id', r.client_company_id)
            .order('quote_date', { ascending:false, nullsFirst:false })
            .order('created_at', { ascending:false })
            .limit(1);
          name = ((data || [])[0] || {}).factory || '';
        }
      } catch (e) {}
      if (!dead) setFactoryName(name);
    })();
    return () => { dead = true; };
  }, [r.id, r.product_id, r.client_company_id]);
  return factoryName;
}

// ── ONE ROUND IN ONE LINE ───────────────────────────────────────────────────
// "Round 2 · master sample included · sent Jan 1, 2026 · due back Oct 1, 2026".
// Only the parts somebody set, so a round saved with a due date alone does not
// print three Not sets. The entry on the card, the Sampling row on the Card tab
// and the files all read this.
//
// withTracking adds the shipment -- "· FedEx 1Z…", carrier then number, on the
// entry line only. A carrier alone reads "· FedEx", a number alone "· tracking
// 1Z…" so a bare number is not left unlabelled. The Sampling row and the board's
// Latest round column leave it off, because the Sampling tracking and Revision
// tracking rows beside them already say it.
const roundText = (x, withTracking = false) => {
  if (!x) return null;
  const parts = ['Round ' + x.round];
  if (x.master_sample === true) parts.push('master sample included');
  if (x.master_sample === false) parts.push('no master sample');
  if (x.sent_date) parts.push('sent ' + fmt(x.sent_date));
  if (x.due_back) parts.push('due back ' + fmt(x.due_back));
  if (withTracking && (x.carrier || x.tracking_number)) {
    parts.push(x.carrier && x.tracking_number ? x.carrier + ' ' + x.tracking_number
             : x.carrier || 'tracking ' + x.tracking_number);
  }
  return parts.join(' · ');
};

// ── TRACKING, ON THE CARD TAB ───────────────────────────────────────────────
// Sampling tracking is round 1's shipment. Revision tracking is the shipment on
// the HIGHEST revision round that records one -- a carrier or a number -- so it
// always names the newest shipment somebody recorded, and a round saved with
// neither does not blank the one before it. "FedEx · 1Z… · round 3". A dash when
// there is no revision round at all.
const shipLine = x => [x.carrier, x.tracking_number].filter(Boolean).join(' · ');
const samplingTracking = r => {
  const x = (r.rounds || []).find(y => y.round === 1);
  return (x && shipLine(x)) || 'Not recorded';
};
const revisionTracking = r => {
  const rev = (r.rounds || []).filter(y => y.round >= 2);
  if (!rev.length) return '—';
  const hit = [...rev].sort((a, b) => b.round - a.round).find(y => shipLine(y));
  return hit ? shipLine(hit) + ' · round ' + hit.round : 'Not recorded';
};

// A date the database will take and a person meant. A date input passes
// through 0002 and 0020 while the year is typed, and one saved mid-typing is a
// sample due back two thousand years ago.
const okDate = s => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 2000);

// ── SAMPLE ROUNDS ───────────────────────────────────────────────────────────
// SAVED ENTRIES, NOT LIVE FIELDS, on program_sample_rounds (script 80). The
// strip that wrote four programs columns on every change is gone; a round is
// filled in and saved, and then it is a record with who saved it and when.
//
// SAMPLING RECORDS ROUND 1 ONLY. The form is fixed at round 1, and once round 1
// is saved the form goes and the entry stays -- one round 1 per card, which the
// unique (program_id, round) constraint holds as well.
//
// REVISION RECORDS 2 AND UP. The form offers the next round -- one past the
// highest saved, and never below 2 -- and every Save is a new entry, newest
// first. Round 1 sits at the bottom, muted and labelled Sampling, because it is
// where the revision started. The CHECK ties round 1 to sampling and 2 and up to
// revision, so the stage written is the one the round belongs to, not merely
// the card stage of the moment.
//
// ANYBODY ON STAFF CAN EDIT ANY ROUND, as with the checklist -- a round is shared
// logistics, not somebody own words -- and the entry says who saved it and who
// last edited it. DELETE is in the Edit form, behind a confirm, for any staff
// too (script 82 granted it). Numbers do not close up -- deleting round 3 of 4
// leaves 1, 2 and 4, and the next round is still one past the highest. Deleting
// round 1 brings the Sampling form back.
//
// Two people saving the same round number at once is refused by the unique
// constraint; the second is told so and the list reloads with the first one.
function SampleRounds({ r, staff, userEmail, onTouched }) {
  const rounds = r.rounds || [];
  const inRevision = r.stage === 'revision';
  const round1 = rounds.find(x => x.round === 1) || null;
  const later = rounds.filter(x => x.round >= 2);
  const nextRound = inRevision ? Math.max(2, ...rounds.map(x => x.round + 1)) : 1;
  const showForm = inRevision || !round1;

  // lab is the CARD'S testing lab, programs.testing_lab -- one per card, not per
  // round. It rides in the round form so it can be set while the card is being
  // worked in Sampling or Revision, prefilled with the card's value, and it is
  // written only when it changed. Every round form shows the same card value.
  const blank = { master: null, sent: '', due: '', carrier: '', tracking: '', comment: '', lab: r.testing_lab || '' };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // A new form for a card that moved stage, so a half-filled round 1 does not
  // turn up as round 2.
  useEffect(() => { setForm(blank); setEditId(null); setErr(''); }, [r.id, r.stage]);
  // The card's lab changed -- saved from here, from the Testing section, or by
  // somebody else -- so every form shows the stored value again.
  useEffect(() => {
    setForm(f => ({ ...f, lab: r.testing_lab || '' }));
    setEdit(f => ({ ...f, lab: r.testing_lab || '' }));
  }, [r.testing_lab]);

  const settle = async () => {
    const failed = await touchProgram(r.id, userEmail);
    if (failed) touchFailedToast(failed);
    if (onTouched) await onTouched();
  };
  const hasAny = f => f.master !== null || f.sent || f.due || f.carrier.trim() || f.tracking.trim() || f.comment.trim();
  const datesOk = f => okDate(f.sent) && okDate(f.due);
  const values = f => ({
    master_sample: f.master, sent_date: f.sent || null, due_back: f.due || null,
    carrier: f.carrier.trim() || null, tracking_number: f.tracking.trim() || null,
    comment: f.comment.trim() || null,
  });
  const unchanged = (x, f) => {
    const v = values(f);
    return v.master_sample === (x.master_sample ?? null) && v.sent_date === (x.sent_date || null)
        && v.due_back === (x.due_back || null) && v.comment === (x.comment || null)
        && v.tracking_number === (x.tracking_number || null) && v.carrier === (x.carrier || null);
  };
  // The lab is compared trimmed, as it is stored.
  const labChanged = f => f.lab.trim() !== (r.testing_lab || '');
  // Written on its own row, the card's, and only when it changed. The card's
  // Last edited stamp follows from settle, as for every other write here.
  const saveLab = async f => {
    const { error } = await SB.from('programs')
      .update({ testing_lab: f.lab.trim() || null }).eq('id', r.id);
    return error ? error.message : null;
  };

  // ── WHAT THE CLOSE GUARD SEES ─────────────────────────────────────────────
  // The fields below are data-noguard, and this is what the guard asks instead:
  // a new round with anything filled in, or an open edit that differs from the
  // saved round. A successful save empties the form or closes the edit, so the
  // card closes without asking; input left unsaved still asks. Master sample is
  // a pair of buttons the guard could never see, and is covered here too.
  const editing = editId ? rounds.find(x => x.id === editId) : null;
  useDirtySource((showForm && (!!hasAny(form) || labChanged(form)))
              || (!!editing && (!unchanged(editing, edit) || labChanged(edit))));

  // THE NEW-ROUND FORM SAVES A ROUND, THE LAB, OR BOTH. A round needs one of its
  // own fields; the lab alone does not make a round, so a form holding only a
  // changed lab saves just the lab and says so on its button (Save testing lab).
  // The round goes first, and the lab only once the round has landed.
  const save = async () => {
    const withRound = !!hasAny(form), withLab = labChanged(form);
    if (!withRound && !withLab) return;
    if (withRound && !datesOk(form)) { setErr('Check the dates — each needs a full year from 2000 on.'); return; }
    setBusy(true); setErr('');
    if (withRound) {
      const { error } = await SB.from('program_sample_rounds').insert({
        program_id: r.id, stage: inRevision ? 'revision' : 'sampling', round: nextRound,
        ...values(form), created_by: userEmail || null,
      });
      if (error) {
        setBusy(false);
        if (error.code === '23505') {
          setErr('Round ' + nextRound + ' was just saved by somebody else. The list has been refreshed — check it before saving again.');
          if (onTouched) await onTouched();
        } else setErr(error.message);
        return;
      }
    }
    if (withLab) {
      const labErr = await saveLab(form);
      if (labErr) {
        setErr((withRound ? 'Round ' + nextRound + ' was saved, but the testing lab was not — ' : 'Could not save the testing lab — ') + labErr);
        await settle(); setBusy(false); return;
      }
    }
    setForm({ ...blank, lab: form.lab.trim() });
    await settle();
    setBusy(false);
  };

  const startEdit = x => {
    setEditId(x.id); setErr('');
    setEdit({ master: x.master_sample === undefined ? null : x.master_sample,
              sent: x.sent_date || '', due: x.due_back || '', carrier: x.carrier || '',
              tracking: x.tracking_number || '',
              comment: x.comment || '', lab: r.testing_lab || '' });
  };

  // Asked once, in the words agreed, and there is no undo -- the row is gone.
  const removeRound = async x => {
    if (!window.confirm("Delete round " + x.round + "? This can't be undone.")) return;
    setBusy(true); setErr('');
    const { error } = await SB.from('program_sample_rounds').delete().eq('id', x.id);
    if (error) { setBusy(false); setErr(error.message); return; }
    setEditId(null);
    await settle();
    setBusy(false);
  };
  const saveEdit = async x => {
    if (!datesOk(edit)) { setErr('Check the dates — each needs a full year from 2000 on.'); return; }
    const v = values(edit);
    // Nothing changed is a cancel, not a write -- an edited stamp for an edit
    // that changed nothing would be a false record. A changed lab alone writes
    // the card and leaves the round, and its edited stamp, untouched.
    const roundChanged = !unchanged(x, edit), withLab = labChanged(edit);
    if (!roundChanged && !withLab) { setEditId(null); return; }
    setBusy(true); setErr('');
    if (roundChanged) {
      const { error } = await SB.from('program_sample_rounds')
        .update({ ...v, updated_by: userEmail || null, updated_at: new Date().toISOString() })
        .eq('id', x.id);
      if (error) { setBusy(false); setErr(error.message); return; }
    }
    if (withLab) {
      const labErr = await saveLab(edit);
      if (labErr) {
        setErr((roundChanged ? 'Round ' + x.round + ' was saved, but the testing lab was not — ' : 'Could not save the testing lab — ') + labErr);
        await settle(); setBusy(false); return;
      }
    }
    setEditId(null);
    await settle();
    setBusy(false);
  };

  const inp = { width:'100%', border:'1px solid rgba(0,0,0,.1)', borderRadius:'10px', padding:'8px 10px',
                fontSize:'13px', outline:'none', fontFamily:'inherit', boxSizing:'border-box', background:'#fff' };
  const lbl = { display:'block', fontSize:'10px', fontWeight:600, textTransform:'uppercase',
                letterSpacing:'.06em', color:'#86868B', marginBottom:'5px' };
  // The height of the Yes and No buttons, measured at 32px, which the round
  // number is centred against so the two sit on one line.
  const ROW_H = '32px';
  const lblMid = { ...lbl, textAlign:'center' };
  const pillBtn = (on, disabled) => ({ fontSize:'11.5px', fontWeight:600, borderRadius:'980px', padding:'5px 13px',
                border:'none', fontFamily:'inherit', cursor:disabled?'default':'pointer',
                background:on?'#1D1D1F':'#E5E5EA', color:on?'#fff':'#A0A0A4' });
  const when = iso => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-US',
      { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
    catch { return String(iso); }
  };
  const latest = latestRound(r);
  const late = sampleOverdue(r);

  // The four fields, for a new round and for an edit alike.
  const fields = (f, set, roundNo) => (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'14px'}}>
      <div style={{textAlign:'center'}}>
        <span style={lblMid}>Sample round</span>
        {/* Fixed. Sampling is round 1; Revision counts on from the last saved.
            The caption and the number are both centred in the column, and the
            number sits in a box as tall as the Yes and No buttons, so it is on
            their line rather than at the top. */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:ROW_H,
                     fontSize:'16px',fontWeight:600,color:'#1D1D1F',
                     fontVariantNumeric:'tabular-nums'}}>{roundNo}</div>
      </div>
      <div>
        {/* Centred over the Yes and No pair, which fills the column. */}
        <span style={lblMid}>Master sample</span>
        <div style={{display:'flex',gap:'6px'}}>
          {[['Yes', true], ['No', false]].map(([l, v]) => {
            const on = f.master === v;
            return (
              // A second click on the chosen one clears it -- null is not said,
              // and it has to be reachable again after a mis-click.
              <button key={l} disabled={busy} onClick={()=>set({ ...f, master: on ? null : v })}
                style={{...inp,flex:1,padding:'7px 0',textAlign:'center',cursor:busy?'default':'pointer',fontWeight:600,
                        background:on?'#1D1D1F':'#fff',color:on?'#fff':'#86868B',
                        border:'1px solid '+(on?'#1D1D1F':'rgba(0,0,0,.1)')}}>{l}</button>
            );
          })}
        </div>
      </div>
      <div>
        <span style={lbl}>Sent</span>
        <input type="date" data-noguard value={f.sent} disabled={busy} style={inp} aria-label="Sent"
          onChange={e=>set({ ...f, sent: e.target.value })} />
      </div>
      <div>
        <span style={lbl}>Due back</span>
        <input type="date" data-noguard value={f.due} disabled={busy} style={inp} aria-label="Due back"
          onChange={e=>set({ ...f, due: e.target.value })} />
      </div>
      {/* Carrier and number on one row, carrier first, the way the entry line
          reads them. Both free text -- FedEx, UPS or anything else, as it is on
          the label. */}
      <div style={{gridColumn:'1 / -1',display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,2fr)',gap:'14px'}}>
        <div>
          <span style={lbl}>Carrier</span>
          <input data-noguard value={f.carrier} disabled={busy} style={inp} aria-label="Carrier"
            placeholder="e.g. FedEx" onChange={e=>set({ ...f, carrier: e.target.value })} />
        </div>
        <div>
          <span style={lbl}>Tracking #</span>
          <input data-noguard value={f.tracking} disabled={busy} style={inp} aria-label="Tracking number"
            placeholder="Optional" onChange={e=>set({ ...f, tracking: e.target.value })} />
        </div>
      </div>
      {/* The CARD'S lab, not this round's -- the caption says so, because a field
          inside a round form reads as part of the round otherwise. */}
      <div style={{gridColumn:'1 / -1'}}>
        <span style={lbl}>Testing lab <span style={{textTransform:'none',letterSpacing:0,fontWeight:500,color:'#A0A0A4'}}>· for this card</span></span>
        <input data-noguard value={f.lab} disabled={busy} style={inp} aria-label="Testing lab"
          placeholder="Optional" onChange={e=>set({ ...f, lab: e.target.value })} />
      </div>
      <div style={{gridColumn:'1 / -1'}}>
        <span style={lbl}>Comment</span>
        <textarea data-noguard value={f.comment} disabled={busy} rows={2} placeholder="Optional"
          onChange={e=>set({ ...f, comment: e.target.value })}
          style={{...inp,resize:'vertical'}} />
      </div>
    </div>
  );

  const entry = (x, muted) => {
    const editing = editId === x.id;
    const isLatestLate = late && latest && latest.id === x.id;
    return (
      <div key={x.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px',
                              opacity: muted && !editing ? 0.6 : 1}}>
        <div style={{display:'flex',alignItems:'baseline',gap:'8px',flexWrap:'wrap'}}>
          {muted && (
            <span style={{fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',
                          color:'#86868B'}}>Sampling</span>
          )}
          {!editing && (
            <span style={{fontSize:'13px',fontWeight:500,color:'#1D1D1F'}}>
              {roundText(x, true)}
              {isLatestLate && <span style={{color:'#FF375F'}}> · overdue {daysSince(x.due_back)} day{daysSince(x.due_back) === 1 ? '' : 's'}</span>}
            </span>
          )}
          {!editing && (
            <button onClick={()=>startEdit(x)} disabled={busy || editId !== null}
              style={{fontSize:'11px',background:'none',border:'none',padding:0,color:'#0A84FF',marginLeft:'auto',
                      fontFamily:'inherit',cursor:busy||editId!==null?'default':'pointer'}}>Edit</button>
          )}
        </div>
        {editing ? (
          <div style={{marginTop:'6px'}}>
            {fields(edit, setEdit, x.round)}
            <div style={{display:'flex',gap:'7px',marginTop:'10px'}}>
              <button onClick={()=>saveEdit(x)} disabled={busy} style={pillBtn(true, busy)}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button onClick={()=>{ setEditId(null); setErr(''); }} disabled={busy}
                style={{...pillBtn(false, busy),background:'#fff',border:'1px solid #E5E5EA',color:'#5A5A5E'}}>Cancel</button>
              {/* The quiet red link the card uses for Delete card, at the far end
                  so it is not the button a hand lands on after Save. */}
              <button onClick={()=>removeRound(x)} disabled={busy}
                style={{marginLeft:'auto',fontSize:'11.5px',background:'none',border:'none',padding:0,
                        color:'var(--hot)',fontFamily:'inherit',cursor:busy?'default':'pointer'}}>Delete</button>
            </div>
          </div>
        ) : (
          <>
            {x.comment && (
              <div style={{fontSize:'13px',color:'#1D1D1F',lineHeight:1.5,whiteSpace:'pre-wrap',marginTop:'4px'}}>{x.comment}</div>
            )}
            <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'5px'}}>
              Saved by <span style={{fontWeight:600,color:'#5A5A5E'}}>{staffName(staff, x.created_by) || 'unknown'}</span> · {when(x.created_at)}
              {x.updated_at && <> · edited by <span style={{fontWeight:600,color:'#5A5A5E'}}>{staffName(staff, x.updated_by) || 'unknown'}</span> · {when(x.updated_at)}</>}
            </div>
          </>
        )}
      </div>
    );
  };

  const list = inRevision ? later : (round1 ? [round1] : []);
  return (
    <div style={{background:'#F5F5F7',borderRadius:'16px',padding:'16px 18px',marginTop:'16px'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'10px',textAlign:'center'}}>Sample rounds</div>
      {showForm && (
        <>
          {fields(form, setForm, nextRound)}
          <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'10px'}}>
            <button onClick={save} disabled={busy || !(hasAny(form) || labChanged(form)) || editId !== null}
              style={pillBtn((hasAny(form) || labChanged(form)) && editId === null,
                             busy || !(hasAny(form) || labChanged(form)) || editId !== null)}>
              {busy && editId === null ? 'Saving…'
                : !hasAny(form) && labChanged(form) ? 'Save testing lab' : 'Save round ' + nextRound}
            </button>
          </div>
        </>
      )}
      {err && <div style={{fontSize:'11.5px',color:'var(--hot)',marginTop:'8px'}}>{err}</div>}
      {(list.length > 0 || (inRevision && round1)) && (
        <div style={{marginTop:showForm?'14px':0,display:'flex',flexDirection:'column',gap:'8px'}}>
          {list.map(x => entry(x, false))}
          {inRevision && round1 && entry(round1, true)}
        </div>
      )}
      {inRevision && !later.length && (
        <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'10px'}}>No revision rounds saved yet.</div>
      )}
    </div>
  );
}

// ── THE TESTING LAB ─────────────────────────────────────────────────────────
// One free-text field, programs.testing_lab (script 83). In Sampling and
// Revision it is set from the round form (SampleRounds). Testing has no round
// form, so this section is where it is set in Testing; it is shown read-only in
// Production and Shipped, which is when the lab's report tends to be chased.
// The Card tab reports it in every stage.
//
// SAVES ITSELF, like the owner select: on leaving the field or on Enter, and
// only when the text changed. data-noguard for the same reason the owner select
// carries it -- there is nothing unsaved for the close guard to protect, since
// leaving the field is what happens first when anything else is clicked. A
// failed save says so and puts the stored value back.
function TestingLab({ r, busy, onLab }) {
  const editable = r.stage === 'testing';
  const [v, setV] = useState(r.testing_lab || '');
  useEffect(() => { setV(r.testing_lab || ''); }, [r.id, r.testing_lab]);
  const commit = async () => {
    const next = v.trim();
    if (next === (r.testing_lab || '')) { setV(r.testing_lab || ''); return; }
    const ok = await onLab(r, next);
    if (!ok) setV(r.testing_lab || '');
  };
  const lbl = { display:'block', fontSize:'10px', fontWeight:600, textTransform:'uppercase',
                letterSpacing:'.06em', color:'#86868B', marginBottom:'5px' };
  return (
    <div style={{background:'#F5F5F7',borderRadius:'16px',padding:'14px 18px',marginTop:'16px'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'10px',textAlign:'center'}}>Testing</div>
      <span style={lbl}>Testing lab</span>
      {editable ? (
        <input data-noguard value={v} disabled={busy} aria-label="Testing lab" placeholder="e.g. the lab's name"
          onChange={e=>setV(e.target.value)} onBlur={commit}
          onKeyDown={e=>{ if (e.key === 'Enter') e.currentTarget.blur(); }}
          style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'8px 10px',
                  fontSize:'13px',outline:'none',fontFamily:'inherit',boxSizing:'border-box',background:'#fff'}} />
      ) : (
        <div style={{fontSize:'13px',color:r.testing_lab?'#1D1D1F':'#A0A0A4'}}>{r.testing_lab || 'Not recorded'}</div>
      )}
    </div>
  );
}

// ── THE CHECKLIST ───────────────────────────────────────────────────────────
// The 11 Aug checklist on program_tasks, script 76. The stage the card is in
// gets the list; open tasks left behind in other stages sit under it as "Open
// elsewhere", so moving a card never hides work that was not finished.
//
// SHARED WORK, NO AUTHOR RULE. Anybody on staff can tick, block or delete
// anybody's task -- script 76 gives program_tasks one permissive staff policy
// and deliberately no restrictive one, unlike the notes. A checklist is the
// team's, not the writer's.
//
// Every write stamps the program and re-reads the board, because the tile's
// open count, its blocker pill and the waiting tiles all read these rows.
function TaskRow({ t, staff, dim, pending, onToggle, onBlocker, onDel }) {
  const overdue = !!t.due_date && !t.done && daysSince(t.due_date) > 0;
  const b = BLOCKERS[t.blocker] || BLOCKERS.none;
  // A task with no owner is a real state -- a card nobody owned when it moved
  // seeds its list unowned -- so it says so rather than rendering a blank.
  const owner = t.owner_id ? ((staff.find(s => s.id === t.owner_id) || {}).full_name
                              || (staff.find(s => s.id === t.owner_id) || {}).email || 'Unknown') : 'Unassigned';
  return (
    <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',
                 borderBottom:'1px solid rgba(0,0,0,.05)',opacity:(dim && t.done) || pending ? 0.5 : 1}}>
      <button onClick={()=>onToggle(t)} disabled={pending} aria-label={t.done ? 'Mark not done' : 'Mark done'}
        style={{background:'none',border:'none',cursor:pending?'default':'pointer',padding:0,flexShrink:0,display:'flex'}}>
        {t.done
          ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
          : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/></svg>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        <div title={t.task}
          style={{fontSize:'13.5px',color:t.done?'#B0B0B4':'#1D1D1F',textDecoration:t.done?'line-through':'none',
                  fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.task}</div>
        <div style={{fontSize:'11px',color:overdue?'#FF375F':'#B0B0B4',marginTop:'1px'}}>
          {owner}
          {dim ? ' · ' + stageLabel(t.stage) : ''}
          {t.due_date ? ' · due ' + shortDate(t.due_date) : ''}
          {overdue ? ' · overdue' : ''}
        </div>
      </div>
      {/* data-noguard: it saves the moment it changes. */}
      {!t.done && (
        <select data-noguard value={t.blocker || 'none'} disabled={pending} aria-label="Blocker"
          onChange={e=>onBlocker(t, e.target.value)}
          style={{fontSize:'11px',border:'none',borderRadius:'980px',padding:'5px 9px',color:b.text,fontWeight:600,
                  cursor:pending?'default':'pointer',background:'#F5F5F7',flexShrink:0,fontFamily:'inherit'}}>
          {Object.entries(BLOCKERS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      )}
      <button onClick={()=>onDel(t)} disabled={pending} aria-label="Delete task"
        style={{background:'none',border:'none',color:'#C7C7CC',cursor:pending?'default':'pointer',
                fontSize:'16px',flexShrink:0,fontFamily:'inherit'}}>×</button>
    </div>
  );
}

function Checklist({ r, staff = [], userEmail, onTouched }) {
  const tasks = r.tasks || [];
  const here = tasks.filter(t => t.stage === r.stage);
  const elsewhere = tasks.filter(t => t.stage !== r.stage && !t.done);
  const [text, setText] = useState('');
  // The new task's owner starts as the card's owner, which is who the seeded
  // tasks went to -- the 11 Aug default was the stage owner, which is gone.
  const [who, setWho] = useState(r.owner_id || '');
  const [due, setDue] = useState('');
  const [pending, setPending] = useState(null);
  const [adding, setAdding] = useState(false);
  // ── OPEN ELSEWHERE SHOWS WHAT IS WAITING ──────────────────────────────────
  // A card that has been through four stages carries every task it left
  // behind, and nineteen rows under the checklist buried the few that matter:
  // the ones somebody is waiting on. So the section lists only tasks with a
  // blocker, and Show all opens the rest. Collapsed on every opening -- per
  // card-open, not remembered. A blocker cleared here drops the row out of the
  // waiting list on the next render, which is the point of clearing it.
  //
  // Display only. The tile pill, the Waiting tiles and the Stalled edge read
  // every task on the card, not this list.
  const [showAllElsewhere, setShowAllElsewhere] = useState(false);
  const [err, setErr] = useState('');

  const settle = async () => {
    const failed = await touchProgram(r.id, userEmail);
    if (failed) touchFailedToast(failed);
    if (onTouched) await onTouched();
  };
  const write = async (t, fn) => {
    setPending(t.id); setErr('');
    const { error } = await fn();
    if (error) { setErr(error.message); setPending(null); return; }
    await settle();
    setPending(null);
  };
  const stamp = () => ({ updated_at: new Date().toISOString() });

  const toggle = t => write(t, () => SB.from('program_tasks')
    .update({ done: !t.done, done_at: !t.done ? new Date().toISOString() : null, ...stamp() }).eq('id', t.id));
  const setBlocker = (t, b) => write(t, () => SB.from('program_tasks')
    .update({ blocker: b, ...stamp() }).eq('id', t.id));
  // ASKED, where 11 Aug did not ask. The × sits a thumb's width from the
  // blocker, and a deleted task is gone -- there is no archive for tasks.
  const del = t => {
    if (!window.confirm('Delete the task "' + t.task + '"? This cannot be undone.')) return;
    return write(t, () => SB.from('program_tasks').delete().eq('id', t.id));
  };

  const add = async () => {
    const body = text.trim();
    if (!body || !r.stage) return;
    setAdding(true); setErr('');
    const nextOrder = here.reduce((m, t) => Math.max(m, t.sort_order || 0), -1) + 1;
    const { error } = await SB.from('program_tasks').insert({
      program_id: r.id, stage: r.stage, task: body, owner_id: who || null,
      assigned_by: userEmail || null, due_date: due || null, blocker: 'none', sort_order: nextOrder,
    });
    if (error) { setErr(error.message); setAdding(false); return; }
    setText(''); setDue('');
    await settle();
    setAdding(false);
  };

  const inp = { border:'1px solid rgba(0,0,0,.1)', borderRadius:'10px', padding:'8px 10px', fontSize:'13px',
                outline:'none', fontFamily:'inherit', boxSizing:'border-box', background:'#fff' };
  const doneHere = here.filter(t => t.done).length;

  return (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginBottom:'6px'}}>
        <span style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',color:'#86868B'}}>
          {r.stage ? stageLabel(r.stage) + ' checklist' : 'Checklist'}
        </span>
        {here.length > 0 && (
          <span style={{fontSize:'11.5px',color:'#A0A0A4',fontVariantNumeric:'tabular-nums'}}>{doneHere} of {here.length} done</span>
        )}
      </div>

      {!r.stage ? (
        // stage is NOT NULL on program_tasks, so a card with no stage has
        // nowhere to file a task. Said, rather than offering a box that fails.
        <div style={{fontSize:'13px',color:'#B0B0B4',marginBottom:'4px'}}>Set a stage to start a checklist.</div>
      ) : (
        <>
          {here.length === 0 && <div style={{fontSize:'13px',color:'#B0B0B4',marginBottom:'6px'}}>No tasks in this stage.</div>}
          {here.map(t => (
            <TaskRow key={t.id} t={t} staff={staff} pending={pending === t.id}
                     onToggle={toggle} onBlocker={setBlocker} onDel={del} />
          ))}
          <div style={{display:'flex',gap:'6px',marginTop:'10px',flexWrap:'wrap'}}>
            <select value={who} onChange={e=>setWho(e.target.value)} disabled={adding} aria-label="Task owner"
              style={{...inp,flex:'0 0 130px',cursor:'pointer'}}>
              <option value="">Unassigned</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
            </select>
            <input value={text} onChange={e=>setText(e.target.value)} disabled={adding}
              onKeyDown={e=>{ if (e.key === 'Enter') add(); }} placeholder="Add a task…"
              style={{...inp,flex:'1 1 160px'}} />
            <input type="date" value={due} onChange={e=>setDue(e.target.value)} disabled={adding}
              aria-label="Due date" style={{...inp,flex:'0 0 140px'}} />
            <button onClick={add} disabled={adding || !text.trim()}
              style={{background:text.trim()?'#1D1D1F':'#E5E5EA',color:text.trim()?'#fff':'#A0A0A4',border:'none',
                      borderRadius:'10px',padding:'8px 15px',fontSize:'13px',fontWeight:600,fontFamily:'inherit',
                      cursor:(adding || !text.trim())?'default':'pointer'}}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </div>
        </>
      )}
      {err && <div style={{fontSize:'11.5px',color:'var(--hot)',marginTop:'7px'}}>{err}</div>}

      {elsewhere.length > 0 && (() => {
        const waiting = elsewhere.filter(t => t.blocker && t.blocker !== 'none');
        const link = (label, onClick) => (
          <button onClick={onClick}
            style={{background:'none',border:'none',padding:0,fontSize:'11px',fontWeight:500,color:'#A0A0A4',
                    textTransform:'none',letterSpacing:0,cursor:'pointer',fontFamily:'inherit',
                    textDecoration:'underline',textUnderlineOffset:'2px'}}>{label}</button>
        );
        // Nothing waiting and not expanded: one muted line rather than an empty
        // heading, so the section says how much is there without listing it.
        if (!waiting.length && !showAllElsewhere) {
          return (
            <div style={{marginTop:'16px',fontSize:'11.5px',color:'#B0B0B4'}}>
              {elsewhere.length} open elsewhere · {link('Show all', () => setShowAllElsewhere(true))}
            </div>
          );
        }
        const rows = showAllElsewhere ? elsewhere : waiting;
        return (
          <div style={{marginTop:'16px'}}>
            <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginBottom:'5px'}}>
              <span style={{fontSize:'11px',fontWeight:600,color:'#B0B0B4',textTransform:'uppercase',letterSpacing:'.06em'}}>
                Open elsewhere · {waiting.length ? waiting.length + ' waiting' : elsewhere.length}
              </span>
              {showAllElsewhere
                ? link('Show waiting only', () => setShowAllElsewhere(false))
                : link('Show all ' + elsewhere.length, () => setShowAllElsewhere(true))}
            </div>
            {rows.map(t => (
              <TaskRow key={t.id} t={t} staff={staff} dim pending={pending === t.id}
                       onToggle={toggle} onBlocker={setBlocker} onDel={del} />
            ))}
          </div>
        );
      })()}
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
// confirm instead of a dismissal. The notes and the sample rounds save themselves
// and empty their boxes, so they report their own unsaved text through
// useDirtySource instead -- otherwise a note already added would still ask.
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onLab, onArchive, onDelete, onClose, onTouched }) {
  return (
    // Wider than it was, because the card carries two tabs now. Still inside the
    // range the other modals in this app use, 420 through 640.
    <Overlay onClose={onClose} maxWidth={720}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy}
                   onStage={onStage} onOwner={onOwner} onLab={onLab}
                   onArchive={onArchive} onDelete={onDelete} onTouched={onTouched} />
    </Overlay>
  );
}

// ── ONE FIELD LIST, FOUR READERS ────────────────────────────────────────────
// Until the export existed there was one reader and these values lived inline in
// SystemKnows, which was right for one reader. There are four now -- the card,
// the PDF, the workbook and the CSV -- and four hand-mirrored copies of "what
// does the Shipping row say" is precisely the shape that had the awarded tile
// disagreeing with the awarded filter. So the values move here and every reader
// maps over them.
//
// A TRIPLE, NOT A PAIR. The third element is whether the value is a blank: the
// screen greys those and the files do not, so that has to travel WITH the value
// rather than be recomputed by whoever happens to be rendering it.
const STAGE_HINT = { quoted:'Quoted', sampling:'Sampling (product stage)', tested:'Tested (report or compliance)' };

const STAGE_LABEL = Object.fromEntries(MANUAL_STAGES.map(([k, l]) => [k, l]));
const stageLabel = s => s ? (STAGE_LABEL[s] || s) : 'No stage set';
// The word a select would show for a stored value, read from the same option list
// the select is built from -- so a file and a dropdown cannot offer two different
// words for one value. That is the whole reason lib/products.js holds the lists.
const optLabel = (opts, v) => (opts.find(o => o[0] === (v || '')) || [null, '—'])[1];

// ── THE LATEST ROUND IN ONE LINE ────────────────────────────────────────────
// The Sampling row on the Card tab, and so the records file: the highest saved
// round, in roundText's words, flagged when it is overdue. null when no round is
// saved, so the row can fall back to the product's own stage rather than print
// an empty line.
const sampleStripText = r => {
  const x = latestRound(r);
  return x ? roundText(x) + (sampleOverdue(r) ? ' · overdue' : '') : null;
};

const recordRows = r => {
  const p = r.products || {};
  const ev = r.events || {};
  // The same test currentStage uses, imported rather than repeated -- production
  // implies sampling happened, and that rule lives in lib/lifecycle.js.
  const sampled = sampledFromStage(p);
  const none = 'Nothing recorded';
  // ── THE ORDER ROWS SHOW THE LATEST, NOT THE FIRST ─────────────────────────
  // A product is reordered, so Purchase order, Sales order and Shipping name the
  // MOST RECENT record for this product and client -- its number and date --
  // with a count when there is more than one. They were the earliest date and
  // nothing else, which answered when the relationship started rather than
  // where it stands. Read live from the board fetch every time, so a reorder
  // shows on the next load whether the card is active, moved or removed. The
  // other rows are one-time lifecycle facts and stay as they were.
  const ofN = n => (n > 1 ? ' · latest of ' + n : '');
  const po = r.latestPO, so = r.latestSO, sh = r.latestShip;
  return [
    ['Quoted', ev.quoted ? fmt(ev.quoted.on) + (ev.quoted.n > 1 ? ' · ' + ev.quoted.n + ' quotes' : '') : none, !ev.quoted],
    // THE CARD'S LATEST SAVED SAMPLE ROUND when there is one, because it says
    // which round and when, for this client. The product-stage flag is the
    // fallback and says only that sampling happened -- product_stage records
    // what a product IS, not when it became that. Production counts, because
    // production implies sampling happened.
    ...(() => {
      const strip = sampleStripText(r);
      return [['Sampling', strip ? strip
               : sampled === 'production' ? 'Product marked Production'
               : sampled === 'sample' ? 'Product marked Sample'
               : 'Not recorded', !strip && !sampled]];
    })(),
    // Round 1's tracking number, and the newest revision round's that has one.
    ['Sampling tracking', samplingTracking(r), samplingTracking(r) === 'Not recorded'],
    ['Revision tracking', revisionTracking(r), ['—', 'Not recorded'].includes(revisionTracking(r))],
    ['Purchase order', po ? po.num + (po.on ? ' · ' + fmt(po.on) : '') + ofN(po.n) : none, !po],
    ['Sales order', so ? so.num + (so.on ? ' · ' + fmt(so.on) : '') + ofN(so.n) : none, !so],
    // AN ETD IS A PLAN AND SAYS SO. Departed is what actually happened and wins
    // whenever it exists; the estimate only speaks when nothing has moved.
    //
    // NO SHIPMENT ON ITS POs, rather than Nothing recorded, when this product
    // has purchase orders and none of them is on a shipment -- a missing link
    // must not read as never shipped. Shipments reach a product through its
    // PO lines, so a PO line not linked to the product is invisible here.
    ['Shipping', sh ? sh.num + (sh.on ? ' · ' + (sh.kind === 'departed' ? 'Departed ' : 'ETD ') + fmt(sh.on) : ' · no date')
                      + ofN(sh.n)
               : po ? 'No shipment on its POs' : none, !sh],
    ['Test report', ev.tested ? fmt(ev.tested.on) : none, !ev.tested],
    // Typed on the first tab while the card is in Testing (script 83).
    ['Testing lab', r.testing_lab || 'Not recorded', !r.testing_lab],
  ];
};
// What the OLD board would have called this card. Its own function rather than a
// seventh entry above, because on screen it sits BELOW two of the edit controls
// and the six above it are contiguous.
const suggestRow = r => ['Records suggest',
  r.derivedStage ? (STAGE_HINT[r.derivedStage] || r.derivedStage) : 'Nothing yet', !r.derivedStage];

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
  // ev, sampled, ship and the 'Nothing recorded' fallback all moved into
  // recordRows, which this block and all three exports now read from.
  //
  // The key is on the row itself because these arrive as an array now.
  const row = (label, value, muted) => (
    <div key={label} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>{value}</span>
    </div>
  );
  // ── NOTHING HERE IS EDITED ON THE CARD ANY MORE ───────────────────────────
  // Product stage, compliance and catalogue used to be selects writing straight
  // to products. Each now has one home, and the card only reports it:
  //   Product stage -- the CARD'S OWN STAGE by name, in the pills' words, so the
  //                    row always reads the column the card sits in. The
  //                    product's two-value Sample / Production field is not shown
  //                    here; it mirrors this stage (syncProductStage) and is what
  //                    the Testing page and its Stage filter read.
  //   Compliance    -- the Testing page.
  //   Catalogue     -- the Products list.
  // Three places able to write one field is how a value ends up saying whatever
  // was touched last; one writer each is the fix.
  const muted = v => !v || v === '— Not set —' || v === '—';
  const stageV = r.stage ? stageLabel(r.stage) : '— Not set —';
  const compV  = optLabel(COMPLIANCE_OPTS, p.compliance_status);
  const catV   = optLabel(CATALOGUE_OPTS, catalogueKey(p));
  return (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'4px'}}>What the system knows</div>
      <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'7px'}}>
        Read-only. The dates come from the records. Product stage is this card&rsquo;s stage; the
        product&rsquo;s Sample / Production status on Testing follows it &mdash; Sample in Sampling,
        Revision and Testing, Production in Production and Shipped, Not set in Quoting. Compliance
        is set on Testing; catalogue status on the Products list.
      </div>
      {/* THE SIX REPORTED ROWS, from the list the exports read too. One source
          and four readers, so a file and the screen cannot describe the same
          record differently. */}
      {recordRows(r).map(([label, value, m]) => row(label, value, m))}
      {row('Product stage', stageV, muted(stageV))}
      {row('Compliance', compV, muted(compV))}
      {/* What the OLD board would have called this card, kept because it is a
          useful second opinion and labelled so nobody mistakes it for the stage. */}
      {row(...suggestRow(r))}
      {/* Three-state, and only false is Inactive -- NULL is undecided, not
          retired. */}
      {row('Catalogue', catV, muted(catV))}
    </div>
  );
}

// STAGE_HINT moved up beside recordRows and suggestRow, which are the only
// things that read it now that the card and the three exports share one list.
// Its words are unchanged: the three stages the old derived board could infer,
// phrased so the line reads as a second opinion rather than as a manual stage.

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

// ── THE CARD AS A FILE ──────────────────────────────────────────────────────
// Three formats, one description of the card. cardGroups is the shape the
// printed document wants -- a details grid, then the reported block -- and
// cardFields flattens the same thing to one row per field for the workbook and
// the CSV. Neither builds its own list, so a field added here reaches all three.
const cardGroups = r => {
  const p = r.products || {};
  const sug = suggestRow(r);
  return {
    head: [
      ['Stage', stageLabel(r.stage)],
      ['Owner', r.ownerName || 'Unowned'],
      ['Stage set', r.since ? fmt(r.since) : 'Not recorded'],
      ['Days in this stage', (r.days === null || r.days === undefined) ? '—'
        : String(r.days) + (r.stale ? ' · stale past ' + STALE_DAYS : '')],
      ['Last touch', r.lastTouchAt
        ? fmt(r.lastTouchAt) + (r.lastTouchBy ? ' · ' + r.lastTouchBy : '') : 'Not recorded'],
      // Latest sample was here and went with the sample log. The card's sample
      // strip is reported on the Sampling row under What the system knows.
    ],
    knows: [
      ...recordRows(r).map(([label, value]) => [label, value]),
      // THE PRODUCT'S OWN FIELD, labelled as such. The card's screen row called
      // Product stage shows the card's stage by name; this line is
      // products.product_stage, which mirrors it as Sample or Production, and
      // the file's own Stage line above already names the card's stage.
      ['Sample / Production', optLabel(STAGE_OPTS, p.product_stage)],
      ['Compliance', optLabel(COMPLIANCE_OPTS, p.compliance_status)],
      [sug[0], sug[1]],
      ['Catalogue', optLabel(CATALOGUE_OPTS, catalogueKey(p))],
    ],
  };
};
const cardFields = r => {
  const p = r.products || {};
  const g = cardGroups(r);
  // SKU, product and client are the letterhead on the printed card; in a flat
  // file they are three fields like any other, and leaving them out would make
  // a sheet that cannot say which card it came from.
  return [
    ['SKU', p.sku || '—'],
    ['Product', p.name || '—'],
    ['Client', (r.client || {}).name || '—'],
    ...g.head, ...g.knows,
  ];
};

const stampToday = () => {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
};
// A note carries a real timestamp and keeps its minute. Two notes written the
// same afternoon, printed with the date alone, would read in an order nobody can
// check -- and the notes are the part of this card people argue about.
const stampText = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')
       +' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
};
// <SKU>-plm-records-<date> or <SKU>-plm-working-<date>, with anything a
// filesystem would argue about replaced. The kind tells the two files apart --
// records from the Card tab, working from the first tab. A SKU is not guaranteed
// to be tame -- BUC-157 has a sibling with a double space in its name -- and a
// slash in a download name is a silent failure.
const fileBase = (r, kind = 'records') => {
  const raw = (r.products || {}).sku || 'no-sku';
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || 'no-sku') + '-plm-' + kind + '-' + stampToday();
};
const downloadBlob = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
};

// BOTH NOTE SETS, FETCHED HERE rather than lifted out of NotesPanel. The panel
// owns its own list and only ONE of the two is mounted at a time -- General
// Notes lives on the Card tab and Card Notes on the Sampling tab. Reading from
// the panel would mean an export from one tab wrote an empty section for the
// other purely because nobody had clicked it, which is the kind of wrong that
// looks right.
//
// THE NAMES MATCH THE SCREEN. card is program_notes -- this card's own notes,
// "Card Notes" on the Sampling tab. general is product_notes of kind sampling --
// the product's notes, shared by every card for the SKU, "General Notes" on the
// Card tab. The kind value in the table is still 'sampling'; only the label
// changed. The sample log is no longer exported; its rows stay in the table.
// ── ONE NOTE, AS EVERY FILE WRITES IT ───────────────────────────────────────
// Shared by the card files (fetchCardNotes) and the board file, so a note reads
// the same in both.
//
// kind on a product note, source on a program note. Both answer the same
// question in the file -- what sort of note is this -- so both land in one
// column and the two tables' column names stop mattering past this line.
// The default kind is left blank, as the screen hides it: a product note's
// kind is still 'sampling' in the table, and printing that under "General
// notes" would contradict the heading it sits under. program_id and product_id
// ride along for the board file, which has to say which card a note is on.
const shapeNotes = (list, kindCol, dflt, staff = []) => (list || []).map(n => ({
  // The author by name, as on screen -- staffName falls back to the email.
  kind: (n[kindCol] && n[kindCol] !== dflt) ? n[kindCol] : '', author: staffName(staff, n.author) || 'unknown',
  date: n.created_at, edited: !!n.edited_at, text: n.note || '', stage: n.stage || null,
  programId: n.program_id || null, productId: n.product_id || null,
}));

const fetchCardNotes = async (r, staff = []) => {
  const own = await SB.from('program_notes')
    .select('author,note,created_at,edited_at,source,stage')
    .eq('program_id', r.id).order('created_at', { ascending:false });
  if (own.error) throw new Error(own.error.message);
  // A card with no product has no product notes to ask for. product_id is the
  // key, and .eq on null matches nothing -- a round trip to learn what is already
  // known here.
  let prod = { data: [] };
  if (r.product_id) {
    // NARROWED ON kind. One table holds these notes and the old sample log, so
    // a select on product_id alone would put every sample event in the file.
    prod = await SB.from('product_notes')
      .select('author,note,created_at,edited_at,kind')
      .eq('product_id', r.product_id).eq('kind', 'sampling')
      .order('created_at', { ascending:false });
    if (prod.error) throw new Error(prod.error.message);
  }
  return { card: shapeNotes(own.data, 'source', 'manual', staff),
           general: shapeNotes(prod.data, 'kind', 'sampling', staff) };
};

// ── THE PRINTED CARD ────────────────────────────────────────────────────────
// The house print model, and the parts of it that earn their place on a card:
// @page margin 0 so Chrome prints no URL or date of its own, the sheet's own
// padding standing in for the page margin, the logo travelling as bytes, and
// esc() on every interpolated value -- a client named with an ampersand printed
// &amp; on the document this pattern replaced.
//
// NO JS PAGINATOR, on Riley word. buildSODoc measures blocks into fixed-height
// sheets because it has a line-item table that must split with its header
// repeated on each continuation. A card has one unbounded section -- the notes --
// and letting it flow the way the browser would is the honest simple thing. What
// that costs is the "Page n of m" stamp, which cannot be written without the
// measuring pass it pays for.
// ── THE PRINT KIT, SHARED BY BOTH FILES ─────────────────────────────────────
// The records file and the working file are two documents on one letterhead, so
// the pieces they share are written once here rather than twice inside each
// builder. Moved out of buildCardDoc verbatim -- the records PDF is the same
// markup it always was.
const docEsc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const DOC_LBL = 'font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;';
const docCell = (l, v) => '<div style="border-right:2px solid #6b7280;border-bottom:2px solid #6b7280;padding:11px 13px;">'
  +'<div style="'+DOC_LBL+'">'+docEsc(l)+'</div>'
  +'<div style="font-size:13.5px;color:#111827;margin-top:5px;line-height:1.3;">'+docEsc(v)+'</div></div>';
const docKv = (l, v) => '<div style="display:flex;gap:14px;padding:7px 0;border-top:1px solid #e5e7eb;">'
  +'<div style="'+DOC_LBL+'flex:0 0 164px;padding-top:2px;">'+docEsc(l)+'</div>'
  +'<div style="font-size:13.5px;color:#111827;line-height:1.45;">'+docEsc(v)+'</div></div>';
// pre-wrap rather than turning newlines into <br>. The note is stored with its
// own line breaks and the screen renders it the same way, so the paper matches
// what the person typed.
const docNoteBlock = (heading, list, blank) => '<div style="margin-top:26px;">'
  +'<div style="'+DOC_LBL+'margin-bottom:8px;">'+docEsc(heading)+'</div>'
  +(list.length
    ? list.map(n => '<div style="border-top:1px solid #e5e7eb;padding:9px 0;">'
        +'<div style="font-size:13.5px;color:#111827;line-height:1.55;white-space:pre-wrap;">'+docEsc(n.text)+'</div>'
        +'<div class="mono" style="font-size:10.5px;color:#6b7280;margin-top:5px;">'
          +docEsc(n.author)+' · '+docEsc(stampText(n.date))
          +(n.edited ? ' · edited' : '')
          +(n.kind ? ' · ' + docEsc(n.kind) : '')
        +'</div></div>').join('')
    : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">'+docEsc(blank)+'</div>')
  +'</div>';
// The logo, the kicker ("PLM card") and the SKU across the top, the rule, then
// the product and the client -- the same head on both files.
const docLetterhead = (logo, kicker, r) => {
  const p = r.products || {};
  return '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:28px;">'
      +'<div style="min-width:0;">'
        +(logo
          ? '<img src="'+logo+'" alt="King Universal" style="height:46px;width:auto;display:block;">'
          : '<div style="font-size:21px;font-weight:700;letter-spacing:-.015em;color:#0c1322;line-height:1.1;">King Universal Inc.</div>')
      +'</div>'
      +'<div style="text-align:right;white-space:nowrap;">'
        +'<div style="font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0c1322;line-height:1.1;">'+docEsc(kicker)+'</div>'
        +'<div class="mono" style="font-size:15px;color:#374151;margin-top:8px;">'+docEsc(p.sku || '—')+'</div>'
      +'</div>'
    +'</div>'
    +'<div style="height:2px;background:#0c1322;margin-top:18px;"></div>'
    +'<div style="margin-top:26px;">'
      +'<div style="font-size:22px;font-weight:600;letter-spacing:-.015em;color:#111827;line-height:1.25;">'+docEsc(p.name || '—')+'</div>'
      +'<div style="font-size:14px;color:#4b5563;margin-top:5px;">'+docEsc((r.client || {}).name || '—')+'</div>'
    +'</div>';
};
// Three across. Empty values already carry their own words -- 'Not recorded'
// rather than a blank, so a gap reads as a fact about the card instead of as a
// rendering fault. Padded to a full row of three, so the grid's right and
// bottom rules close rather than leaving a notch.
const docGrid = pairs => '<div style="margin-top:28px;border-top:2px solid #6b7280;border-left:2px solid #6b7280;display:grid;grid-template-columns:repeat(3,1fr);">'
    +pairs.map(([l, v]) => docCell(l, v)).join('')
    +Array.from({ length: (3 - pairs.length % 3) % 3 }, () => docCell('', '')).join('')
  +'</div>';
const docFooter = label => '<div style="margin-top:34px;padding-top:9px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:9.5px;color:#6b7280;">'
    +'<span>King Universal Inc. · '+docEsc(label)+' · internal</span>'
    +'<span>Generated '+docEsc(stampText(new Date().toISOString()))+'</span>'
  +'</div>';
const docShell = (title, flow) => '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
+'<meta name="viewport" content="width=device-width,initial-scale=1">'
+'<title>'+docEsc(title)+'</title>'
+'<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">'
+'<style>'
+'*{box-sizing:border-box;margin:0;padding:0;}'
+"html,body{font-family:'Inter',system-ui,sans-serif;color:#111827;background:#eef1f5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
+".mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;}"
// 816px = 8.5in at 96dpi, and the 48px padding IS the page margin, because
// @page has none. min-height rather than height: the notes decide the length.
+'.sheet{width:816px;min-height:1056px;background:#fff;margin:0 auto;padding:48px;}'
+'@media screen{.sheet{box-shadow:0 1px 5px rgba(15,23,42,.16);margin:20px auto;}}'
+'@media print{@page{size:letter;margin:0;}html,body{background:#fff;}'
  +'.sheet{box-shadow:none;margin:0;min-height:0;}}'
+'</style></head><body><div class="sheet">'+flow+'</div>'
// Fonts first. Inter arriving after the print dialog opens would paper over
// metrics the preview was built from.
+'<script>(function(){function go(){setTimeout(function(){try{window.focus();window.print();}catch(e){}},150);}'
+'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(go).catch(go);}else{window.onload=go;}})();<\/script>'
+'</body></html>';

// ── THE RECORDS FILE, exported from the Card tab ────────────────────────────
const buildCardDoc = ({ r, card, general, logo }) => {
  const p = r.products || {};
  const g = cardGroups(r);
  const flow = docLetterhead(logo, 'PLM card', r)
    +docGrid(g.head)
    +'<div style="margin-top:30px;">'
      +'<div style="'+DOC_LBL+'margin-bottom:2px;">What the system knows</div>'
      +'<div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:6px;">'
        +'Reported from the records. None of it moved this card.</div>'
      +g.knows.map(([l, v]) => docKv(l, v)).join('')
    +'</div>'
    // The sample log went with the card's log UI; the rows are still in the table.
    +docNoteBlock('Card notes', card, 'No notes.')
    +docNoteBlock('General notes', general,
               r.product_id ? 'No notes.' : 'No product linked, so there are no product notes.')
    +docFooter('PLM card');
  return docShell('PLM Card — '+(p.sku || p.name || 'Program'), flow);
};

// ── THE WORKING FILE, exported from the first (stage-named) tab ─────────────
// What that tab holds and nothing from the records view, which has its own
// file: who and where the card is, the sample rounds, the checklist grouped by
// stage in ladder order, and the card's own notes.
//
// DONE CARRIES ITS DATE when there is one. program_tasks.done_at is written when
// a task is ticked and cleared when it is unticked, so a Yes with no date is a
// task ticked before anything recorded when.
const workingHead = (r, factoryName) => {
  const p = r.products || {};
  return [
    ['SKU', p.sku || '—'],
    ['Product', p.name || '—'],
    ['Client', (r.client || {}).name || '—'],
    ['Factory', factoryName || 'Not recorded'],
    ['Stage', stageLabel(r.stage)],
    ['Owner', r.ownerName || 'Unowned'],
    ['Days in this stage', (r.days === null || r.days === undefined) ? '—'
      : String(r.days) + (r.stale ? ' · stale past ' + STALE_DAYS : '')],
    ['Created', [r.createdByName ? 'by ' + r.createdByName : null, r.created_at ? fmt(r.created_at) : null]
                  .filter(Boolean).join(' · ') || 'Not recorded'],
    ['Last edited', r.edited
      ? [r.lastTouchBy ? 'by ' + r.lastTouchBy : null, fmt(r.updated_at)].filter(Boolean).join(' · ')
      : 'Not edited since it was created'],
  ];
};
// The latest round in one line, for the grid and the Working sheet; every
// round follows in its own table (workingRounds).
const workingStrip = r => [
  ['Latest sample round', sampleStripText(r) || 'None saved'],
];
// EVERY SAVED ROUND, round 1 first, so the file reads as the history it is --
// the card lists newest first because that is what somebody working it needs.
const workingRounds = (r, staff) => [...(r.rounds || [])].sort((a, b) => a.round - b.round).map(x => ({
  round: String(x.round),
  stage: stageLabel(x.stage),
  master: x.master_sample === true ? 'Included' : x.master_sample === false ? 'Not included' : '',
  sent: x.sent_date || null,
  due: x.due_back || null,
  carrier: x.carrier || '',
  tracking: x.tracking_number || '',
  comment: x.comment || '',
  savedBy: staffName(staff, x.created_by) || 'unknown',
  savedAt: x.created_at || null,
  editedBy: x.updated_at ? (staffName(staff, x.updated_by) || 'unknown') : '',
  editedAt: x.updated_at || null,
}));
const ROUND_COLS = ['Round', 'Stage', 'Master sample', 'Sent', 'Due back', 'Carrier', 'Tracking #', 'Comment', 'Saved by', 'Saved at', 'Edited by', 'Edited at'];
// Every task, in ladder order, stages with no tasks left out. Within a stage
// the order the board loaded them in -- sort_order, then created_at.
const workingTasks = (r, staff) => MANUAL_STAGES.map(([k, l]) => ({
  label: l,
  tasks: (r.tasks || []).filter(t => t.stage === k).map(t => {
    const who = t.owner_id ? (staff.find(s => s.id === t.owner_id) || {}) : null;
    return {
      task: t.task || '',
      done: t.done ? 'Yes' : 'No',
      doneAt: t.done && t.done_at ? t.done_at : null,
      owner: who ? (who.full_name || who.email || 'Unknown') : 'Unassigned',
      due: t.due_date || null,
      blocker: t.blocker && t.blocker !== 'none' ? (BLOCKERS[t.blocker] || {}).label || t.blocker : '',
    };
  }),
})).filter(g => g.tasks.length);

// ALL card notes, grouped by the stage they were written in, ladder order, the
// stage named; notes with no stage last. The card shows one stage at a time;
// the file is the whole history.
const workingNoteGroups = card => {
  const groups = MANUAL_STAGES.map(([k, l]) => ({ label: l, list: card.filter(n => n.stage === k) }));
  groups.push({ label: 'No stage', list: card.filter(n => !n.stage || STAGE_LABEL[n.stage] === undefined) });
  return groups.filter(g => g.list.length);
};

// ── THE BOARD AS A FILE ─────────────────────────────────────────────────────
// Every card on the board in one workbook or one CSV, built from the SAME
// pieces the card files use -- workingRounds, workingTasks, workingNoteGroups,
// cardGroups, sampleStripText, healthOf, blockerOf -- so a card reads the same
// in the board file as in its own. Six tables, each keyed by SKU and client so
// any row says which card it belongs to:
//   Board          one row per card, the tile and its header facts
//   Rounds         one row per saved sample round
//   Checklist      one row per task
//   Card notes     one row per card note
//   Records        one row per card, a column per What the system knows line
//   General notes  one row per product note, with the clients whose cards show it
// Separate sheets rather than tables stacked on one, because Excel sorts,
// filters and freezes a header per sheet, and a stacked sheet can only do that
// for the first table on it.
//
// Each column is [header, kind]. kind decides how a value is written: 'date'
// is a plain yyyy-mm-dd, 'stamp' a timestamp, 'num' a number, anything else
// text. The workbook turns dates into real dates; the CSV writes them as text,
// the same split the card files make.
const BOARD_STAGE_ORDER = Object.fromEntries(MANUAL_STAGES.map(([k], i) => [k, i]));
const buildBoardTables = (cards, staff, cardNotes, generalNotes) => {
  // Ladder order, then SKU, so the file reads down the board left to right.
  const list = [...cards].sort((a, b) => {
    const sa = a.stage in BOARD_STAGE_ORDER ? BOARD_STAGE_ORDER[a.stage] : 99;
    const sb = b.stage in BOARD_STAGE_ORDER ? BOARD_STAGE_ORDER[b.stage] : 99;
    if (sa !== sb) return sa - sb;
    return String((a.products || {}).sku || '').localeCompare(String((b.products || {}).sku || ''));
  });
  const skuOf = r => (r.products || {}).sku || '';
  const clientOf = r => (r.client || {}).name || '';
  const key = r => [skuOf(r), clientOf(r)];

  const board = {
    name: 'Board',
    cols: [['SKU'], ['Product'], ['Client'], ['Factory'], ['Stage'], ['Days in stage', 'num'], ['Owner'],
           ['Health'], ['Blocker'], ['Sample overdue'], ['Open tasks', 'num'], ['Latest round'], ['Testing lab'],
           ['Created by'], ['Created at', 'stamp'], ['Last edited by'], ['Last edited at', 'stamp'], ['Removed']],
    rows: list.map(r => {
      const blk = blockerOf(r);
      return [
        skuOf(r), (r.products || {}).name || '', clientOf(r), r.factoryName || '',
        stageLabel(r.stage), (r.days === null || r.days === undefined) ? null : r.days,
        r.ownerName || 'Unowned', HEALTH[healthOf(r, r.tasks)].label,
        blk ? BLOCKERS[blk].label : '', sampleOverdue(r) ? 'Yes' : 'No',
        // The tile count -- open tasks in the stage the card is in.
        openTasks(r).filter(t => t.stage === r.stage).length,
        sampleStripText(r) || '', r.testing_lab || '',
        r.createdByName || '', r.created_at || null,
        r.edited ? (r.lastTouchBy || '') : '', r.edited ? (r.updated_at || null) : null,
        r.archived ? 'Yes' : 'No',
      ];
    }),
  };

  const rounds = {
    name: 'Rounds',
    cols: [['SKU'], ['Client'], ['Round', 'num'], ['Stage'], ['Master sample'], ['Sent', 'date'], ['Due back', 'date'],
           ['Carrier'], ['Tracking #'], ['Comment'], ['Saved by'], ['Saved at', 'stamp'], ['Edited by'], ['Edited at', 'stamp']],
    rows: list.flatMap(r => workingRounds(r, staff).map(x => [
      ...key(r), Number(x.round), x.stage, x.master, x.sent, x.due, x.carrier, x.tracking, x.comment,
      x.savedBy, x.savedAt, x.editedBy, x.editedAt,
    ])),
  };

  const checklist = {
    name: 'Checklist',
    cols: [['SKU'], ['Client'], ['Stage'], ['Task'], ['Done'], ['Done at', 'stamp'], ['Owner'], ['Due', 'date'], ['Blocker']],
    rows: list.flatMap(r => workingTasks(r, staff).flatMap(g => g.tasks.map(t => [
      ...key(r), g.label, t.task, t.done, t.doneAt, t.owner, t.due, t.blocker,
    ]))),
  };

  const notesOn = r => cardNotes.filter(n => n.programId === r.id);
  const cardNoteTable = {
    name: 'Card notes',
    cols: [['SKU'], ['Client'], ['Stage'], ['Kind'], ['Author'], ['Date', 'stamp'], ['Edited'], ['Note']],
    rows: list.flatMap(r => workingNoteGroups(notesOn(r)).flatMap(g => g.list.map(n => [
      ...key(r), g.label, n.kind, n.author, n.date, n.edited ? 'Yes' : '', n.text,
    ]))),
  };

  // The labels come from cardGroups itself, so a line added to the card's
  // records reaches this sheet as a new column without anybody editing it.
  const knowsLabels = list.length ? cardGroups(list[0]).knows.map(([l]) => l) : [];
  const records = {
    name: 'Records',
    cols: [['SKU'], ['Product'], ['Client'], ...knowsLabels.map(l => [l])],
    rows: list.map(r => {
      const byLabel = new Map(cardGroups(r).knows);
      return [skuOf(r), (r.products || {}).name || '', clientOf(r), ...knowsLabels.map(l => byLabel.get(l) || '')];
    }),
  };

  // A product note belongs to the PRODUCT, shared by every card for that SKU,
  // so it is listed once with the clients whose cards show it rather than once
  // per card.
  const productRow = new Map();
  list.forEach(r => {
    if (!r.product_id) return;
    const cur = productRow.get(r.product_id) || { sku: skuOf(r), name: (r.products || {}).name || '', clients: [] };
    if (clientOf(r) && !cur.clients.includes(clientOf(r))) cur.clients.push(clientOf(r));
    productRow.set(r.product_id, cur);
  });
  const general = {
    name: 'General notes',
    cols: [['SKU'], ['Product'], ['Clients'], ['Kind'], ['Author'], ['Date', 'stamp'], ['Edited'], ['Note']],
    rows: generalNotes.filter(n => productRow.has(n.productId)).map(n => {
      const pr = productRow.get(n.productId);
      return [pr.sku, pr.name, pr.clients.join(', '), n.kind, n.author, n.date, n.edited ? 'Yes' : '', n.text];
    }),
  };

  return [board, rounds, checklist, cardNoteTable, records, general];
};
const boardFileBase = withRemoved => 'plm-board-' + (withRemoved ? 'with-removed-' : '') + stampToday();

const buildWorkingDoc = ({ r, factoryName, staff, card, logo }) => {
  const p = r.products || {};
  // SKU, product and client are the letterhead; the grid carries the rest.
  const grid = workingHead(r, factoryName).filter(([l]) => !['SKU', 'Product', 'Client'].includes(l));
  const groups = workingTasks(r, staff);
  const th = 'text-align:left;padding:6px 8px 6px 0;'+DOC_LBL;
  const td = 'padding:7px 8px 7px 0;border-top:1px solid #e5e7eb;font-size:12.5px;color:#111827;vertical-align:top;';
  const table = g => '<div style="margin-top:14px;">'
    +'<div style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px;">'+docEsc(g.label)+'</div>'
    +'<table style="width:100%;border-collapse:collapse;">'
      +'<tr><th style="'+th+'width:40%;">Task</th><th style="'+th+'">Done</th><th style="'+th+'">Owner</th>'
      +'<th style="'+th+'">Due</th><th style="'+th+'">Blocker</th></tr>'
      +g.tasks.map(t => '<tr>'
        +'<td style="'+td+'">'+docEsc(t.task)+'</td>'
        +'<td style="'+td+'">'+docEsc(t.done + (t.doneAt ? ' · ' + stampText(t.doneAt) : ''))+'</td>'
        +'<td style="'+td+'">'+docEsc(t.owner)+'</td>'
        +'<td style="'+td+'">'+docEsc(t.due ? fmt(t.due) : '')+'</td>'
        +'<td style="'+td+'">'+docEsc(t.blocker)+'</td>'
      +'</tr>').join('')
    +'</table></div>';
  const rounds = workingRounds(r, staff);
  const flow = docLetterhead(logo, 'PLM card · working', r)
    +docGrid(grid)
    +'<div style="margin-top:30px;">'
      +'<div style="'+DOC_LBL+'margin-bottom:6px;">Sample rounds</div>'
      +(rounds.length
        ? '<table style="width:100%;border-collapse:collapse;">'
          +'<tr><th style="'+th+'">Round</th><th style="'+th+'">Master sample</th><th style="'+th+'">Sent</th>'
          +'<th style="'+th+'">Due back</th><th style="'+th+'">Carrier</th><th style="'+th+'">Tracking #</th><th style="'+th+'width:22%;">Comment</th><th style="'+th+'">Saved</th></tr>'
          +rounds.map(x => '<tr>'
            +'<td style="'+td+'">'+docEsc(x.round + ' · ' + x.stage)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.master)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.sent ? fmt(x.sent) : '')+'</td>'
            +'<td style="'+td+'">'+docEsc(x.due ? fmt(x.due) : '')+'</td>'
            +'<td style="'+td+'">'+docEsc(x.carrier)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.tracking)+'</td>'
            +'<td style="'+td+'white-space:pre-wrap;">'+docEsc(x.comment)+'</td>'
            +'<td style="'+td+'">'+docEsc(x.savedBy + ' · ' + stampText(x.savedAt))
              +(x.editedAt ? '<br>'+docEsc('edited ' + x.editedBy + ' · ' + stampText(x.editedAt)) : '')+'</td>'
          +'</tr>').join('')
          +'</table>'
        : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">No rounds saved.</div>')
    +'</div>'
    +'<div style="margin-top:26px;">'
      +'<div style="'+DOC_LBL+'margin-bottom:2px;">Checklist</div>'
      +(groups.length ? groups.map(table).join('')
        : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">No tasks.</div>')
    +'</div>'
    +(workingNoteGroups(card).length
      ? workingNoteGroups(card).map(g => docNoteBlock('Card notes · ' + g.label, g.list, '')).join('')
      : docNoteBlock('Card notes', [], 'No notes.'))
    +docFooter('PLM card · working');
  return docShell('PLM Working — '+(p.sku || p.name || 'Program'), flow);
};


// Split out so the x can read guardedClose from context. The provider lives
// INSIDE Overlay, so a hook called in ProgramDetail would sit above it and get
// the default -- the close button has to be a child to be guarded.
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner, onLab, onArchive, onDelete, onTouched }) {
  const p = r.products || {};
  const guardedClose = useGuardedClose();
  // ── TWO TABS: WORKING THE CARD, AND WHAT IS KNOWN ABOUT IT ────────────────
  // The first tab is the 11 Aug card -- where the program is and what happens
  // next: the stage pills, the owner, the sample rounds, the checklist, the notes
  // and Remove. Its label is the card's stage (below).
  // Card is what the card was before stage 2 -- what the records say, the
  // product's sampling log and notes, and the exports -- which is read far more
  // than it is changed.
  //
  // THE SAMPLING LOG AND ITS NOTES LIVE ON CARD, NOT ON SAMPLING, despite the
  // names, because they belong to the PRODUCT and are shared with every other
  // card for the same SKU. The strip on Sampling is this program's own sample;
  // the log is the product's history. Side by side, somebody would edit one
  // believing it was the other.
  //
  // Transient, and per opening. A tab remembered across cards would land somebody
  // on Card for a card they opened to move.
  //
  // THE FIRST TAB IS LABELLED WITH THE CARD'S STAGE -- Quoting, Revision,
  // Production -- in the pills' own words, because it is where the card is
  // worked in whatever stage it is in, and a tab reading Sampling on a card in
  // Production named the wrong thing. Only the label follows the stage; the key
  // stays 'sampling' and the contents are unchanged.
  const [tab, setTab] = useState('sampling');
  const CARD_TABS = [['sampling', stageLabel(r.stage)], ['card', 'Card']];
  const factoryName = useCardFactory(r);

  // ── EXPORTING THE CARD ────────────────────────────────────────────────────
  // Three writers, one description of the card -- see cardGroups above. Each
  // fetches its own notes rather than sharing a cached copy: an export is a
  // deliberate act a second apart from the last one, and reading the notes again
  // is what makes the file match the database rather than match the screen.
  const [exporting, setExporting] = useState(false);

  // THE WINDOW IS OPENED ON THE FIRST LINE, BEFORE ANY await. window.open only
  // survives a popup blocker while the user gesture is still on the stack, and an
  // await hands the stack back -- so opening it after the notes fetch would get
  // the print window blocked. The same order genSO and printQuote use, for the
  // same reason.
  // ── EXPORT FOLLOWS THE TAB ───────────────────────────────────────────────
  // The Card tab exports the records file, as it always did. The first tab
  // exports the working file -- the stage, the sample rounds, the checklist and
  // the card notes. One control in the header, two documents, and the file name
  // says which (fileBase).
  const exportKind = tab === 'card' ? 'records' : 'working';

  const exportPdf = async () => {
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating PLM card…</body>');
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      // THE LOGO HAS TO TRAVEL AS BYTES. The document is written into an
      // about:blank window, so a relative src resolves against about:blank and
      // fetches nothing. A failed fetch degrades to the company name in type,
      // which is why buildCardDoc carries that fallback rather than assuming.
      let logo = '';
      try {
        const res = await fetch('/logo.png');
        if (res.ok) {
          const blob = await res.blob();
          logo = await new Promise((ok, no)=>{
            const fr = new FileReader();
            fr.onload = ()=>ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob);
          });
        }
      } catch (e) {}
      const html = exportKind === 'records'
        ? buildCardDoc({ r, card: notes.card, general: notes.general, logo })
        : buildWorkingDoc({ r, factoryName, staff, card: notes.card, logo });
      // The document prints itself once its fonts have landed, so nothing here
      // has to guess at a delay.
      if (win) { win.document.open(); win.document.write(html); win.document.close(); }
      else {
        // Popup blocked outright. The card is still built and still leaves as a
        // file, which is the same fallback the order confirmation takes.
        const url = URL.createObjectURL(new Blob([html], { type:'text/html' }));
        const a = document.createElement('a');
        a.href = url; a.download = fileBase(r, exportKind) + '.html';
        a.click(); setTimeout(()=>URL.revokeObjectURL(url), 4000);
      }
    } catch (e) {
      if (win) { try { win.close(); } catch (x) {} }
      alert('Could not build the card: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  const exportXlsx = async () => {
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VESSL'; wb.created = new Date();

      // THE WORKING WORKBOOK -- four sheets: the card and its latest round one
      // field per row, every sample round, the checklist one task per row, and the card notes.
      if (exportKind === 'working') {
        const ws = wb.addWorksheet('Working');
        ws.addRow(['Field', 'Value']);
        [...workingHead(r, factoryName), ...workingStrip(r)].forEach(([l, v]) => ws.addRow([l, v]));
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state:'frozen', ySplit:1 }];
        ws.getColumn(1).width = 24;
        ws.getColumn(2).width = 62;

        const rs = wb.addWorksheet('Sample rounds');
        rs.addRow(ROUND_COLS);
        workingRounds(r, staff).forEach(x => rs.addRow([Number(x.round), x.stage, x.master, excelDate(x.sent), excelDate(x.due),
          x.carrier, x.tracking, x.comment, x.savedBy, excelDate(x.savedAt), x.editedBy, excelDate(x.editedAt)]));
        rs.getRow(1).font = { bold: true };
        rs.views = [{ state:'frozen', ySplit:1 }];
        [4, 5].forEach(c => { rs.getColumn(c).numFmt = 'yyyy-mm-dd'; });
        [10, 12].forEach(c => { rs.getColumn(c).numFmt = 'yyyy-mm-dd hh:mm'; });
        [8, 12, 14, 12, 12, 14, 24, 44, 22, 17, 22, 17].forEach((w, i) => { rs.getColumn(i + 1).width = w; });
        rs.getColumn(8).alignment = { wrapText: true, vertical: 'top' };

        const cs = wb.addWorksheet('Checklist');
        cs.addRow(['Stage', 'Task', 'Done', 'Done at', 'Owner', 'Due', 'Blocker']);
        workingTasks(r, staff).forEach(g => g.tasks.forEach(t =>
          cs.addRow([g.label, t.task, t.done, excelDate(t.doneAt), t.owner, excelDate(t.due), t.blocker])));
        cs.getRow(1).font = { bold: true };
        cs.views = [{ state:'frozen', ySplit:1 }];
        cs.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
        cs.getColumn(6).numFmt = 'yyyy-mm-dd';
        [13, 44, 7, 17, 22, 12, 18].forEach((w, i) => { cs.getColumn(i + 1).width = w; });

        const ns = wb.addWorksheet('Card notes');
        ns.addRow(['Stage', 'Kind', 'Author', 'Date', 'Edited', 'Note']);
        workingNoteGroups(notes.card).forEach(g => g.list.forEach(n =>
          ns.addRow([g.label, n.kind, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text])));
        ns.getRow(1).font = { bold: true };
        ns.views = [{ state:'frozen', ySplit:1 }];
        ns.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
        [13, 13, 30, 19, 9, 90].forEach((w, i) => { ns.getColumn(i + 1).width = w; });
        ns.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

        const wbuf = await wb.xlsx.writeBuffer();
        downloadBlob(new Blob([wbuf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                     fileBase(r, 'working') + '.xlsx');
        setExporting(false);
        return;
      }

      // SHEET 1, ONE ROW PER FIELD rather than one row per card with twenty
      // columns. A card is read down, not across, and a single-row sheet would be
      // a spreadsheet nobody can look at without scrolling sideways.
      const ws = wb.addWorksheet('Card');
      ws.addRow(['Field', 'Value']);
      cardFields(r).forEach(([label, value]) => ws.addRow([label, value]));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state:'frozen', ySplit:1 }];
      ws.getColumn(1).width = 24;
      ws.getColumn(2).width = 62;

      // SHEET 2, BOTH NOTE SETS IN ONE TABLE with a Set column -- Card for this
      // card's notes, General for the product's, the same words the screen uses.
      // Two sheets would make a reader sorting by date merge them by hand. The
      // sample log sheet that sat between these went with the log.
      const ns = wb.addWorksheet('Notes');
      ns.addRow(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note']);
      const push = (setName, list) => list.forEach(n =>
        // excelDate, so the cell is a real date and sorts as one. The CSV keeps
        // the text stamp -- the same split testing.jsx makes.
        ns.addRow([setName, n.kind, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text]));
      push('Card', notes.card);
      push('General', notes.general);
      ns.getRow(1).font = { bold: true };
      ns.views = [{ state:'frozen', ySplit:1 }];
      ns.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
      [13, 13, 30, 19, 9, 90].forEach((w, i) => { ns.getColumn(i + 1).width = w; });
      ns.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                   fileBase(r, 'records') + '.xlsx');
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  // No engine and no CDN -- it is string building, so it works offline and
  // returns while the workbook path would still be waiting on a script tag.
  // async only because the notes have to be read first.
  const exportCsv = async () => {
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      // EVERY field quoted, not just the ones that need it. A conditional quote
      // has to decide what "needs" means for a note holding a comma, a quote or a
      // newline, and that decision is where CSV writers go wrong.
      const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const p = r.products || {};
      const lines = [];
      // THE WORKING CSV -- four tables, a blank line between them, the CSV
      // answer to the working workbook's four sheets.
      if (exportKind === 'working') {
        lines.push(cell('# PLM card, working: ' + (p.sku || 'no SKU') + ' — ' + (p.name || '') + ' — ' + ((r.client || {}).name || '')));
        lines.push([cell('Field'), cell('Value')].join(','));
        [...workingHead(r, factoryName), ...workingStrip(r)].forEach(([l, v]) => lines.push([cell(l), cell(v)].join(',')));
        lines.push('');
        lines.push(ROUND_COLS.map(cell).join(','));
        workingRounds(r, staff).forEach(x => lines.push(
          [x.round, x.stage, x.master, x.sent || '', x.due || '', x.carrier, x.tracking, x.comment, x.savedBy, stampText(x.savedAt),
           x.editedBy, x.editedAt ? stampText(x.editedAt) : ''].map(cell).join(',')));
        lines.push('');
        lines.push(['Stage', 'Task', 'Done', 'Done at', 'Owner', 'Due', 'Blocker'].map(cell).join(','));
        workingTasks(r, staff).forEach(g => g.tasks.forEach(t => lines.push(
          [g.label, t.task, t.done, t.doneAt ? stampText(t.doneAt) : '', t.owner, t.due || '', t.blocker].map(cell).join(','))));
        lines.push('');
        lines.push(['Stage', 'Kind', 'Author', 'Date', 'Edited', 'Note'].map(cell).join(','));
        workingNoteGroups(notes.card).forEach(g => g.list.forEach(n => lines.push(
          [g.label, n.kind, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(','))));
        const wcsv = '﻿' + lines.join('\r\n') + '\r\n';
        downloadBlob(new Blob([wcsv], { type:'text/csv;charset=utf-8;' }), fileBase(r, 'working') + '.csv');
        setExporting(false);
        return;
      }
      lines.push(cell('# PLM card: ' + (p.sku || 'no SKU') + ' — ' + (p.name || '') + ' — ' + ((r.client || {}).name || '')));
      lines.push([cell('Field'), cell('Value')].join(','));
      cardFields(r).forEach(([label, value]) => lines.push([cell(label), cell(value)].join(',')));
      // ONE FILE, TWO TABLES, a blank line between them -- the CSV answer to the
      // workbook's second sheet. The sample log table went with the log.
      lines.push('');
      lines.push(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note'].map(cell).join(','));
      const push = (setName, list) => list.forEach(n => lines.push(
        [setName, n.kind, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(',')));
      push('Card', notes.card);
      push('General', notes.general);
      // CRLF and a BOM, both for Excel: without the BOM it reads the file as ANSI
      // and an accented name arrives mangled.
      const csv = '﻿' + lines.join('\r\n') + '\r\n';
      downloadBlob(new Blob([csv], { type:'text/csv;charset=utf-8;' }), fileBase(r, 'records') + '.csv');
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  // ── THE LADDER POSITION ───────────────────────────────────────────────────
  // Where the card sits, for the pills: the ones before it read as passed. There
  // is no Advance button any more -- the pills move a card to any stage, forward
  // or back, and one control for one act is simpler than two that must agree.
  const idx = MANUAL_STAGES.findIndex(([k]) => k === r.stage);
  const inSampling = SAMPLING_STAGES.includes(r.stage);

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>
            {[(r.client||{}).name, factoryName].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        {/* EXPORT SITS BESIDE THE CLOSE, above both tabs, so it is there
            whichever tab is open -- and it exports THAT tab: the records file
            from Card, the working file from the first tab (see exportKind).

            count={1} is what keeps the pill live; the note under the menu says
            what is actually leaving. Disabled while a write is in flight, so a
            file cannot be built from a card that is mid-change. */}
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
          <ExportButton count={1} busy={exporting || busy} compact align="right"
            note={exportKind === 'records' ? 'The records view, with its notes'
                                           : 'This tab: stage, sample, checklist and card notes'}
            onPdf={exportPdf} onXlsx={exportXlsx} onCsv={exportCsv} />
          <button onClick={guardedClose} aria-label="Close"
            style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                    cursor:'pointer',padding:'0 2px',fontFamily:'inherit',flexShrink:0}}>×</button>
        </div>
      </div>

      {/* ── THE STAGE PILLS ─────────────────────────────────────────────────
          The 11 Aug row: the current stage in its colour, the ones already
          passed in a darker grey than the ones ahead. Every pill is a move, to
          any stage, forward or back, and every move goes through setStage -- so
          the checklist seeding, the product stage and the Last edited stamp all
          follow a pill exactly as they follow a purchase order. */}
      <div style={{display:'flex',gap:'4px',marginTop:'16px',flexWrap:'wrap'}}>
        {MANUAL_STAGES.map(([k, l, c], i) => {
          const active = k === r.stage;
          const passed = idx >= 0 && i < idx;
          return (
            <button key={k} onClick={()=>onStage(r, k)} disabled={busy || active}
              aria-pressed={active}
              style={{fontSize:'11px',fontWeight:600,padding:'5px 10px',borderRadius:'980px',border:'none',
                      fontFamily:'inherit',cursor:(busy || active)?'default':'pointer',
                      background:active?c:passed?'#EAEAEE':'#F5F5F7',
                      color:active?'#fff':passed?'#5A5A5E':'#B0B0B4'}}>{l}</button>
          );
        })}
        {!r.stage && (
          <span style={{fontSize:'11px',color:'#A0A0A4',alignSelf:'center',marginLeft:'4px'}}>No stage set</span>
        )}
      </div>

      {/* ── OWNER, AGE ──────────────────────────────────────────────────────
          The 11 Aug row without its Advance button, which went on request; the
          pills above are the one way to move a card. The owner select is the
          staff list rather than a typed team, and changing it still writes its
          reassignment note. data-noguard because it saves the moment it
          changes -- there is nothing unsaved for the close guard to protect. */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'14px',flexWrap:'wrap'}}>
        <select data-noguard value={r.owner_id || ''} disabled={busy} aria-label="Owner"
          onChange={e=>onOwner(r, e.target.value)}
          style={{border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'8px 12px',fontSize:'13px',
                  fontFamily:'inherit',background:'#fff',color:r.owner_id?'#1D1D1F':'var(--hot)',
                  cursor:busy?'default':'pointer',outline:'none'}}>
          <option value="">Unowned</option>
          {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
        </select>
        {r.since && (
          <span style={{fontSize:'12.5px',color:r.stale?'#8a5a00':'#86868B'}}>
            {r.days === 0 ? 'Moved to ' + stageLabel(r.stage) + ' today'
                          : r.days + ' day' + (r.days === 1 ? '' : 's') + ' in ' + stageLabel(r.stage)}
            {r.stale ? ' · stale past ' + STALE_DAYS : ''}
          </span>
        )}
      </div>

      {/* The segmented control the Testing page uses, at card scale. Matching it
          rather than inventing a third tab style for one modal. */}
      <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',
                   marginTop:'16px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)'}}>
        {CARD_TABS.map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)}
            style={{padding:'7px 16px',borderRadius:'9px',border:'none',cursor:'pointer',
                    fontSize:'13px',fontWeight:600,letterSpacing:'-.01em',fontFamily:'inherit',
                    background:tab===v?'#1D1D1F':'transparent',color:tab===v?'#fff':'#5A5A5E',
                    boxShadow:tab===v?'0 1px 3px rgba(0,0,0,.18)':'none',transition:'.14s'}}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'card' ? (
        <>
          {/* Export moved to the card header, beside the close, so it is on both
              tabs; its row and caption here went with it. */}
          <SystemKnows r={r} />
          {!r.product_id ? (
            <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE',
                         fontSize:'12.5px',color:'#A0A0A4'}}>
              This card has no product linked, so there are no product notes to show.
            </div>
          ) : (
            // GENERAL NOTES ARE THE PRODUCT'S, shared by every card for this SKU.
            // Still product_notes of kind sampling -- the heading changed, the rows
            // and the filter did not. The sampling log that sat above them is
            // gone from the card; its rows are untouched in the table.
            <NotesPanel staff={staff} table="product_notes" keyCol="product_id" keyId={r.product_id}
              insertExtra={{ kind: 'sampling' }} extraCol="kind" extraDefault="sampling"
              filter={{ col:'kind', val:'sampling' }}
              title="General Notes"
              programId={r.id} userEmail={userEmail} onTouched={onTouched} />
          )}
        </>
      ) : (
      <>
      {inSampling && <SampleRounds r={r} staff={staff} userEmail={userEmail} onTouched={onTouched} />}

      {/* Above the notes, where the 11 Aug card had it. */}
      {['testing', 'production', 'shipped'].includes(r.stage) && <TestingLab r={r} busy={busy} onLab={onLab} />}

      <Checklist r={r} staff={staff} userEmail={userEmail} onTouched={onTouched} />

      {/* author is the caller's EMAIL, inside NotesPanel. The 11 Aug card wrote
          a display name, and the restrictive policies compare lower(author) to
          the email in the token -- a name would insert and then be uneditable
          and undeletable by the person who wrote it. */}
      <NotesPanel staff={staff} table="program_notes" keyCol="program_id" keyId={r.id}
        insertExtra={{ source: 'manual', stage: r.stage || null }} extraCol="source" extraDefault="manual"
        stageScoped stage={r.stage || null}
        title="Card Notes" programId={r.id} userEmail={userEmail} onTouched={onTouched} />
      {/* ── OFF THE BOARD, NOT OUT OF EXISTENCE ─────────────────────────────
          Riley's Archive, and last in the tab, which is where CodeModal and
          RegModal put the control that disposes of a record.

          NOT DRESSED AS A DELETE. Those two modals use a red border because the
          row is about to be gone for good. This one is reversible from Show
          removed, and borrowing the red would make people hesitate over a
          reversible act -- or read this as the way a card gets deleted. */}
      {onArchive && (
        <div style={{marginTop:'18px',paddingTop:'13px',borderTop:'1px solid #ECECEE',
                     display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
          <button onClick={()=>onArchive(r, !r.archived)} disabled={busy}
            style={{background:'none',border:'1px solid rgba(0,0,0,.14)',borderRadius:'10px',
                    padding:'9px 16px',fontSize:'13px',fontWeight:600,color:'#5A5A5E',
                    fontFamily:'inherit',cursor:busy?'default':'pointer',opacity:busy?0.6:1,
                    flexShrink:0}}>
            {r.archived ? 'Put back on the board' : 'Remove from board'}
          </button>
          <span style={{fontSize:'12px',color:'#A0A0A4',flex:'1 1 220px',lineHeight:1.45}}>
            {r.archived
              ? 'This card is off the board. Putting it back returns it to the stage it was in.'
              : 'Keeps the card and its notes. It moves to the Removed column, behind Show removed.'}
          </span>
          {/* ── DELETE, THE RARER ACT ───────────────────────────────────────
              A quiet red text link, not a button, at the far end of the row.
              Remove from board is the everyday way off the board and carries
              the button's weight; this one destroys the card, its notes and
              its checklist, so it is offered but not pressed on anybody. The
              typed confirm in deleteCard is the real guard. */}
          {onDelete && (
            <button onClick={()=>onDelete(r)} disabled={busy}
              style={{background:'none',border:'none',padding:0,marginLeft:'auto',flexShrink:0,
                      fontSize:'12.5px',fontWeight:500,color:'var(--hot)',fontFamily:'inherit',
                      textDecoration:'underline',textUnderlineOffset:'2px',
                      cursor:busy?'default':'pointer',opacity:busy?0.6:1}}>
              Delete card
            </button>
          )}
        </div>
      )}
      </>
      )}
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
  // showRetired and doneOpen are gone with the Complete section they belonged to.
  // Shipped is a column now, so there is nothing to open or shut, and a card on a
  // retired product sits in its own stage column like any other -- the tile says
  // so with a pill rather than the card being filed somewhere else.
  const [ui, setUi] = usePageState('programs', { search:'', showRemoved:false, blocker:'' });
  const [openId, setOpenId] = useState(null);
  const [staff, setStaff] = useState([]);
  // Set while a stage or an owner is being written, so the control can say so and
  // refuse a second click. Not in the page store -- it is in-flight, not a choice.
  const [saving, setSaving] = useState(null);
  // ── DRAGGING A TILE, THE SECOND WAY TO MOVE A CARD ─────────────────────────
  // Restored from the board Stage 1 removed (cfdadb4^), onto the six columns.
  // The pills on the card remain the first way, and the only way on a phone.
  //
  // dropTarget is which column the pointer is over, for the ring. Transient,
  // like openId -- a drag that survived navigation would be a ring on a column
  // nobody is touching.
  const [dropTarget, setDropTarget] = useState(null);
  // A CLICK MUST NOT FOLLOW A DRAG, and a drag must not swallow a real click.
  // Cleared on mousedown, which always precedes both, and set on dragstart -- so
  // the tile click can tell the two apart without a timer. A timer would be a
  // guess about how fast somebody let go.
  const dragMovedRef = useRef(false);
  // NO TOUCH DRAG. iPhone Safari does not dispatch HTML5 drag for web content
  // and iPad does it only partly, so a tile is draggable only where the primary
  // pointer is fine -- a mouse or a trackpad. False until mounted, so the server
  // render and the first client render agree; phones keep the pills.
  const [canDrag, setCanDrag] = useState(false);
  useEffect(() => {
    try { setCanDrag(!!(window.matchMedia && window.matchMedia('(pointer: fine)').matches)); } catch (e) {}
  }, []);
  // ── ENDING A DRAG IS NOT THE SAME AS dragend ────────────────────────────────
  // dragend is dispatched to the SOURCE element. A tile dropped on another column
  // is re-rendered under a different parent before that happens -- setStage
  // patches rows optimistically and the columns recompute -- so a handler on the
  // old node may never run. drop goes to the TARGET, which is still mounted, and
  // both bubble to the document. So the document keeps its own pair of listeners
  // that clear the ring and wipe the inline fade off every drag handle, from
  // outside the tree, where no remount can defeat them. Esc during a drag ends it
  // with a dragend and no drop, which lands here too -- that is the cancel.
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
  // ── DRAG IS GONE, AND SO IS EVERYTHING THAT SERVED IT ───────────────────────
  // dropTarget, dragMovedRef, endDrag, the document dragend listener and the
  // expanded-tile state all existed for dragging cards between sections. The
  // board is columns now and a tile opens the card, which is the 11 Aug gesture
  // and one fewer way to move a program by accident.
  //
  // THE EXPANSION WENT WITH IT rather than separately. A tile that expanded to
  // say what the card IS, with an Open button inside it to change the card, was
  // two answers to one click; the modal is the answer now.
  //
  // program_id -> how many notes, filled in bulk by load().
  const [noteCounts, setNoteCounts] = useState({});
  // program_id -> its checklist, every stage, filled in bulk by load().
  const [tasks, setTasks] = useState({});
  const [rounds, setRounds] = useState({});

  // QUIET AFTER THE FIRST READ. loading starts true and only the first load
  // shows the placeholder; every later one -- after a stage move, a note, a
  // sample -- swaps the rows in underneath. Setting it true again unmounted the
  // whole page, and the open card with it: the tab snapped back to Card, a
  // half-typed note elsewhere on the card was lost, and the page flashed.
  const load = async () => {
    setErr('');
    try {
      const [p, nt, q, poi, soi, tr, st, tk, sr] = await Promise.all([
        // declared_stage and declared_stage_at are the board now -- the stage a
        // person set, and when they set it. owner_id joins staff_profiles for the
        // name on the card and the owner filter.
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
                + 'created_at,created_by,updated_at,updated_by,testing_lab,'
                + 'products(id,sku,name,active,product_stage,compliance_status),client:companies!client_company_id(id,name),'
                + 'owner:staff_profiles!owner_id(id,email,full_name)')
          .order('created_at', { ascending:true }),
        // NOTE COUNTS IN BULK, because the expanded tile shows one. NotesPanel
        // still fetches the notes themselves when a modal opens -- this is the
        // count only, and fetching it per card would be one query per row.
        SB.from('program_notes').select('program_id'),
        // factory for the board export, picked below by useCardFactory's own rule.
        SB.from('quotes').select('product_id,client_company_id,quote_date,created_at,factory').not('product_id','is',null),
        SB.from('purchase_order_items')
          // estimated_departure joins the embed for the Shipping row, which falls
          // back to an ETD when nothing has actually left yet. shipmentsOf returns
          // whole shipment rows, so adding the column here is the entire data
          // change -- no second derivation.
          // id, number and created_at on the PO and the shipment, so the order
          // rows can name the latest one, count distinct ones and break a tie.
          .select('product_id,purchase_orders(id,order_number,created_at,order_date,issued_at,client_company_id,client:companies!client_company_id(name),shipment_pos(shipments(id,shipment_number,created_at,actual_departure,estimated_departure,actual_arrival)))')
          .not('product_id','is',null),
        SB.from('sales_order_items')
          // so_number is the number the app shows for a sales order everywhere;
          // order_number is empty on every SO.
          .select('product_id,sales_orders(id,so_number,created_at,order_date,client_company_id,client:companies!client_company_id(name))')
          .not('product_id','is',null),
        // Product-wide on purpose -- a test report has no client, and testing is
        // not repeated per client. The panel says the same thing on screen.
        SB.from('test_reports').select('product_id,test_date,issue_date,overall_result').not('product_id','is',null),
        // Every colleague -- for the owner select on the card, the checklist
        // owners and the names on the tile and the notes.
        SB.from('staff_profiles').select('id,email,full_name').order('full_name', { nullsFirst:false }),
        // EVERY CHECKLIST, IN BULK. The tile's blocker pill, its health edge and
        // the three waiting tiles all read tasks, so they arrive with the board
        // rather than when a card opens -- the trade the note counts make.
        SB.from('program_tasks')
          .select('id,program_id,stage,task,owner_id,assigned_by,due_date,blocker,done,done_at,sort_order,created_at')
          .order('sort_order').order('created_at'),
        // EVERY SAMPLE ROUND, IN BULK, highest round first per card -- the tile
        // pill and the Stalled and Overdue samples tiles read the latest one's
        // due back, so they have to arrive with the board.
        SB.from('program_sample_rounds')
          .select('id,program_id,stage,round,master_sample,sent_date,due_back,carrier,tracking_number,comment,created_by,created_at,updated_by,updated_at')
          .order('round', { ascending:false }),
      ]);
      const e = [p,nt,q,poi,soi,tr,st,tk,sr].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
      setStaff(st.data || []);
      setTasks((tk.data || []).reduce((m, t) => { (m[t.program_id] = m[t.program_id] || []).push(t); return m; }, {}));
      setRounds((sr.data || []).reduce((m, x) => { (m[x.program_id] = m[x.program_id] || []).push(x); return m; }, {}));
      setNoteCounts((nt.data || []).reduce((m, n) => { m[n.program_id] = (m[n.program_id] || 0) + 1; return m; }, {}));
      setEv({ quotes:q.data||[], poItems:poi.data||[], soItems:soi.data||[], reports:tr.data||[] });
    } catch (x) {
      setErr(x && x.message ? x.message : String(x));
    }
    setLoad(false);
  };
  useEffect(()=>{ load(); }, []);

  // The document-level dragend and drop listeners were here. They existed to wipe
  // a fade off a drag handle that a remount had orphaned, which is a problem only
  // a draggable board has.

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
      // ── THE LATEST ORDER, THE LATEST PO, THE LATEST SHIPMENT ───────────────
      // For the order rows on the card. DISTINCT RECORDS, not lines -- one SO with
      // three sizes is three lines and one order -- so each list is folded by id
      // before it is counted. Newest by its date, and by created_at when two share
      // a date: four of BG03R's five SOs are dated the same day, and the tiebreak
      // is what makes "latest" one answer rather than whichever arrived first.
      const newest = (items, dateOf) => {
        const byId = new Map();
        items.forEach(x => { if (x && x.id && !byId.has(x.id)) byId.set(x.id, x); });
        const list = [...byId.values()];
        if (!list.length) return null;
        const key = x => String(dateOf(x) || '') + ' ' + String(x.created_at || '');
        list.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
        return { top: list[0], n: list.length };
      };
      const soL = newest((buckets.soItems[k] || []).map(i => i.sales_orders), o => o.order_date);
      const poL = newest((buckets.poItems[k] || []).map(i => i.purchase_orders), o => o.issued_at || o.order_date);
      // A real departure outranks an estimate, and either outranks a shipment with
      // no date at all, which falls back to when it was created.
      const shL = newest(shipmentsOf(buckets.poItems[k] || []),
                         x => x.actual_departure || x.estimated_departure || x.created_at);
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
               stale: stage !== SHIPPED && days !== null && days >= STALE_DAYS,
               ownerName: (r.owner || {}).full_name || (r.owner || {}).email || null,
               // LAST TOUCH, which is a different question from the stage date.
               // declared_stage_at answers when the card last MOVED; updated_at
               // answers when anybody last changed anything about it, including an
               // owner swap or a note. Both are on the expanded card because they
               // disagree usefully.
               lastTouchAt: r.updated_at || null,
               lastTouchBy: staffName(staff, r.updated_by),
               // CREATED AND LAST EDITED, for the tile's two foot lines. A card
               // last touched within a minute of being created has never been
               // edited -- createProgram stamps updated_at on insert, a few
               // milliseconds from created_at -- so it shows the Created line only.
               createdByName: staffName(staff, r.created_by),
               edited: !!(r.updated_at && r.created_at
                          && (new Date(r.updated_at) - new Date(r.created_at)) > 60000),
               noteCount: noteCounts[r.id] || 0,
               tasks: tasks[r.id] || [],
               rounds: rounds[r.id] || [],
               factoryName: factoryOfQuotes(buckets.quotes[k] || []),
               // The order rows read these three. null when there is none.
               latestSO: soL ? { num: soL.top.so_number || 'Sales order', on: soL.top.order_date || null, n: soL.n } : null,
               latestPO: poL ? { num: poL.top.order_number || 'Purchase order',
                                 on: poL.top.issued_at || poL.top.order_date || null, n: poL.n } : null,
               latestShip: shL ? { num: shL.top.shipment_number || 'Shipment',
                                   kind: shL.top.actual_departure ? 'departed' : 'etd',
                                   on: shL.top.actual_departure || shL.top.estimated_departure || null,
                                   n: shL.n } : null };
    });
    // staff and noteCounts are dependencies now: without them a name stays
    // unresolved and a count stays zero until some other change happens to
    // recompute this.
  }, [rows, buckets, staff, noteCounts, tasks, rounds]);

  // ── WRITING A STAGE, AND WRITING AN OWNER ───────────────────────────────────
  // The only two things this page changes. Both re-read from the database after
  // the write, so what is on screen ends up being what is stored.
  //
  // A REASSIGNMENT WRITES ITS OWN NOTE, on Riley decision -- program_notes is
  // append-only by grant, so the record cannot be quietly tidied later. The note
  // is written after the update lands; a failed note leaves a correct owner and a
  // missing line, which is the better way round.

  // ONE FUNCTION, EVERY CALLER. The stage pills on the card come through here --
  // the Advance button went, and a board drag would join them if one is built --
  // so declared_stage_at is stamped by the same trigger whichever it is, a failure is
  // reported the same way, and there is no second write path to drift.
  //
  // STILL OPTIMISTIC, though the reason changed. It was written that way because a
  // dropped card had to look like it landed; the drag is gone, but a card that sits
  // in its old column for the length of a round trip still reads as a refused move.
  // So rows is patched first and the write follows; a failure puts the row back
  // exactly as it was and the toast says why. declared_stage_at is guessed locally
  // only so the age line does not flash a stale number -- the trigger owns the real
  // value and the load() below replaces the guess with it.
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
      setSaving(null);
      return;
    }
    await seedStageTasks(r, next);
    // The product's own stage mirrors the card, forward or back -- see
    // syncProductStage. After the move and never able to undo it.
    const ps = await syncProductStage(r.product_id, next);
    if (ps.error) window._toast?.('The card moved, but the product stage could not be updated — ' + (ps.error.message || String(ps.error)), 'err');
    await load();
    setSaving(null);
  };

  // ── SEEDING A STAGE'S CHECKLIST ─────────────────────────────────────────────
  // After the move lands, never before -- a refused move must not leave a
  // checklist behind for a stage the card is not in. Every stage move on the
  // board comes through setStage, so any pill seeds, forward or back; 11 Aug
  // seeded on its Advance button only, which left a card moved any other way
  // with an empty checklist.
  //
  // The rule itself -- once per stage, ever, read from the database -- is in
  // lib/programs.js, shared with the purchase-order move. This wrapper only says
  // so when it fails; a failed seed does not undo the move.
  const seedStageTasks = async (r, stage) => {
    const { error } = await seedTasksFor(r.id, stage, { ownerId: r.owner_id, byEmail: userEmail });
    if (error) window._toast?.('The card moved, but its checklist could not be added — ' + error.message, 'err');
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
        program_id: r.id, author: userEmail || null, source: 'owner-change', stage: r.stage || null,
        note: 'Reassigned from ' + (r.ownerName || 'nobody') + ' to ' + nameOf(next) + ' by ' + (userEmail || 'unknown'),
      });
    } catch (e) {}
    await load(); setSaving(null);
  };

  // ── THE TESTING LAB ─────────────────────────────────────────────────────────
  // One column, trimmed, blank written as NULL, stamping Last edited like every
  // other write to the card. Returns whether it saved, so the field can put the
  // stored value back when it did not.
  const setTestingLab = async (r, value) => {
    const next = (value || '').trim() || null;
    if (next === (r.testing_lab || null)) return true;
    setSaving(r.id);
    const { error } = await SB.from('programs')
      .update({ testing_lab: next, updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', r.id);
    if (error) { window._toast?.('Could not save the testing lab — ' + error.message, 'err'); setSaving(null); return false; }
    await load(); setSaving(null);
    return true;
  };

  // ── TAKING A CARD OFF THE BOARD, AND PUTTING IT BACK ────────────────────────
  // One function for both directions, for the same reason setStage serves the
  // select and the drag -- two write paths for one column is how they drift.
  //
  // archived, NOT a delete. Deleting exists now -- deleteCard below, behind a
  // typed confirm -- but it is not why this archives. A card is the only record that
  // a product was ever worked on for a client, and the board is kept by hand, so
  // the reversible act is the right one whatever the grant says.
  //
  // THE CONFIRM NAMES THE CARD, because the modal can be open over a board of
  // near-identical rows and "are you sure" answers a question nobody asked. It
  // also says where the card goes, since a control that makes something vanish
  // without saying where is indistinguishable from one that destroys it.
  const setArchived = async (r, next) => {
    const p = r.products || {};
    const what = (p.sku || 'no SKU') + ' — ' + (p.name || 'no name')
               + ' for ' + ((r.client || {}).name || 'no client');
    const msg = next
      ? 'Remove ' + what + ' from the board?\n\nNothing is deleted. The card and its notes are kept, and it moves to the '
        + 'Removed column behind Show removed, where it can be put back.'
      : 'Put ' + what + ' back on the board?\n\nIt returns to the stage it was in.';
    if (!window.confirm(msg)) return;
    setSaving(r.id);
    // updated_at and updated_by by hand, exactly as setStage and setOwner do --
    // there is no archived_at column on programs and this is not the script that
    // adds one. Removing a card is a touch like any other.
    const { error } = await SB.from('programs')
      .update({ archived: next, updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', r.id);
    if (error) {
      window._toast?.((next ? 'Could not remove the card — ' : 'Could not put the card back — ') + error.message, 'err');
      setSaving(null);
      return;
    }
    window._toast?.(next ? 'Removed from the board' : 'Back on the board', 'ok');
    // THE MODAL STAYS OPEN and the button flips to the other direction, so an
    // accidental removal is undone where it happened rather than hunted for
    // under a toggle somebody has to be told about first.
    await load(); setSaving(null);
  };

  // ── DELETING A CARD FOR GOOD ────────────────────────────────────────────────
  // Script 73 granted authenticated DELETE on programs (anon still has none), and
  // program_notes and program_tasks both cascade from it -- so one delete takes
  // the card, its general notes and its checklist. The product's sampling log and
  // sampling notes live on the PRODUCT and are untouched; the confirm says so, so
  // nobody declines a delete fearing the log goes with it.
  //
  // TYPED, NOT CLICKED. Remove from board is the reversible way off the board and
  // takes one confirm. This cannot be undone, so it asks for the word -- a
  // reflexive Enter on a dialog cannot delete anything.
  //
  // THE ROW COUNT IS CHECKED, not only the error. A delete that RLS filters to no
  // rows returns success and deletes nothing; select('id') makes that visible and
  // it is reported as a failure rather than toasted as done.
  const deleteCard = async (r) => {
    const p = r.products || {};
    const typed = window.prompt(
      'Delete ' + (p.sku || 'no SKU') + ' — ' + (p.name || 'no name') + ' for ' + ((r.client || {}).name || 'no client') + '?\n\n'
      + 'The card, its notes and its checklist are deleted with it. This cannot be undone.\n'
      + 'The product and its sampling log are not affected.\n\n'
      + 'To remove it from the board but keep it, cancel and use Remove from board.\n\n'
      + 'Type DELETE to confirm.');
    if (typed === null) return;
    if (typed.trim() !== 'DELETE') {
      window._toast?.('Not deleted — type DELETE, in capitals, to confirm', 'err');
      return;
    }
    setSaving(r.id);
    const { data, error } = await SB.from('programs').delete().eq('id', r.id).select('id');
    if (error || !data || !data.length) {
      window._toast?.('Could not delete the card — ' + (error ? error.message : 'nothing was deleted; you may not have permission'), 'err');
      setSaving(null);
      return;
    }
    window._toast?.('Card deleted', 'ok');
    setOpenId(null);
    await load();
    setSaving(null);
  };

  // setProductField was here. The card no longer edits product stage, compliance
  // or catalogue -- each has one home now, and product stage follows the card's
  // own moves through syncProductStage in setStage.

  // ── A COLUMN AS A DROP TARGET ───────────────────────────────────────────────
  // The six stage columns only. No stage set and Removed are places a card is
  // found, not places it can be put -- a null stage is not a value anybody sets,
  // and removal has its own control.
  //
  // THE DROP IS A PILL CLICK. It calls setStage, the one function the pills
  // call, so the optimistic move, the Last edited stamp, the checklist seeding,
  // the product stage and the failure toast all follow a drop exactly as they
  // follow a pill. Backward drops are allowed, as the pills allow them. A drop
  // back onto the card's own column writes nothing -- setStage returns early.
  //
  // PRODUCTION AND SHIPPED ASK FIRST, and only they do, because they mark the
  // product as in production. That was irreversible under the forward-only rule;
  // since the product stage mirrors the card, dragging the tile back undoes it
  // too, so the confirm now guards a visible product-wide change rather than a
  // permanent one.
  //
  // The dragleave guard is why the ring does not flicker: moving the pointer
  // from a column onto a tile INSIDE it fires dragleave on the column, so the
  // target is cleared only when the pointer has actually left the subtree.
  const DROP_CONFIRM = { production:'Production', shipped:'Shipped' };
  const dropProps = (stageKey) => ({
    onDragOver: e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
    onDragEnter: () => setDropTarget(stageKey),
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDropTarget(t => (t === stageKey ? null : t)); },
    onDrop: e => {
      e.preventDefault();
      setDropTarget(null);
      const id = e.dataTransfer.getData('text/plain');
      const row = enriched.find(x => x.id === id);
      if (!row || row.stage === stageKey || saving === row.id) return;
      if (DROP_CONFIRM[stageKey]
          && !window.confirm('Move to ' + DROP_CONFIRM[stageKey] + '? This marks the product as in production.')) return;
      setStage(row, stageKey);
    },
  });

  // dropProps was here -- the dragover, dragenter, dragleave and drop handlers a
  // section needed to be a drop target. A card changes stage from the card now.

  // ── REMOVED CARDS ARE OFF EVERY LIST, NOT JUST THE PIPELINE ────────────────
  // archived has been selected since this board was built and never once read, so
  // a card marked archived sat on screen exactly like any other. Everything below
  // derives from live rather than from enriched, so what the sections show, what
  // the tiles count, what the owner filter offers and what the heading totals
  // cannot come to disagree -- which is what happens when the filter is added in
  // one place and forgotten in the other four.
  //
  // removed is the same list inverted, and it is the only way back to a card once
  // it is off the board. Nothing is deleted, so nothing needs recovering; it needs
  // finding, which is what the toggle under the Complete section is for.
  const live    = useMemo(() => enriched.filter(r => r.archived !== true), [enriched]);
  const removed = useMemo(() => enriched.filter(r => r.archived === true), [enriched]);
  // EVERY LIVE CARD IS ON THE BOARD NOW. board used to exclude the finished ones
  // because Complete was a collapsed section beneath the pipeline rather than a
  // part of it. Shipped is a column, so a finished card sits where it finished and
  // the board is simply everything that has not been removed.
  //
  // finished, history and done went with that section. A card on a retired product
  // is no longer filed away from its own stage either -- it sits in its column with
  // a pill on the tile saying the product has left the catalogue, which is the
  // honest place for it and one fewer list to keep in step.
  const board   = live;

  const counts = useMemo(() => {
    const c = { none: 0 };
    MANUAL_STAGES.forEach(([k]) => { c[k] = 0; });
    board.forEach(r => { const k = r.stage || 'none'; c[k] = (c[k]||0) + 1; });
    return c;
  }, [board]);

  // ── THE OWNER FILTER IS GONE ────────────────────────────────────────────────
  // The Everyone / Unowned / staff chips, ownerSel, ownerCounts and ownerMatches
  // all went together, on request. Removing only the chips would have left a
  // selection already held in the page store filtering the board with nothing on
  // screen to clear it. Ownership shows inside the card now, and nowhere on the
  // board.

  // A waiting tile, pressed. Any OPEN task with that blocker qualifies, as on
  // 11 Aug -- the tile counts cards, and this shows the cards it counted.
  const blockerMatches = r => !ui.blocker || openTasks(r).some(t => t.blocker === ui.blocker);

  const matches = r => {
    if (!ui.search) return true;
    const p = r.products || {};
    return (norm(p.sku) + ' ' + norm(p.name) + ' ' + norm((r.client||{}).name)).includes(norm(ui.search));
  };

  // SEARCH AND OWNER, AND NOTHING ELSE. The stage filter went with the rail --
  // every column is on screen at once, so narrowing to one stage is what scrolling
  // does. Each column takes its own slice of this list below.
  const shownBoard   = useMemo(() => board.filter(r => matches(r) && blockerMatches(r)),
    [board, ui.search, ui.blocker]);
  // The removed column reads the same two filters, so a search narrows it too --
  // which is the point, since finding one removed card is what it is for.
  const shownRemoved = useMemo(() => removed.filter(r => matches(r) && blockerMatches(r)),
    [removed, ui.search, ui.blocker]);

  // ── EXPORTING THE BOARD ─────────────────────────────────────────────────────
  // Every card on the board, and the removed ones only while Show removed is
  // ticked. The search box and the Waiting tiles are NOT applied, on purpose: a
  // board file quietly narrowed by a search left in the box is the worse mistake,
  // and the menu note says so.
  //
  // THE NOTES ARE READ AT EXPORT TIME, like the card files -- the board holds
  // counts only. Both note tables are read whole and matched here rather than
  // asked for by a list of ids, because an id list long enough for a full board
  // would not fit in a request URL. Card notes exist only on cards, and the
  // product notes of kind sampling are the General Notes, so neither read is
  // large.
  const [boardExporting, setBoardExporting] = useState(false);
  const exportCards = ui.showRemoved ? [...board, ...removed] : board;
  const boardTables = async () => {
    const [cn, gn] = await Promise.all([
      SB.from('program_notes').select('program_id,author,note,created_at,edited_at,source,stage')
        .order('created_at', { ascending:false }),
      SB.from('product_notes').select('product_id,author,note,created_at,edited_at,kind')
        .eq('kind', 'sampling').order('created_at', { ascending:false }),
    ]);
    if (cn.error) throw new Error(cn.error.message);
    if (gn.error) throw new Error(gn.error.message);
    return buildBoardTables(exportCards, staff,
      shapeNotes(cn.data, 'source', 'manual', staff), shapeNotes(gn.data, 'kind', 'sampling', staff));
  };
  const exportBoardXlsx = async () => {
    setBoardExporting(true);
    try {
      const tables = await boardTables();
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VESSL'; wb.created = new Date();
      tables.forEach(t => {
        const ws = wb.addWorksheet(t.name);
        ws.addRow(t.cols.map(([h]) => h));
        t.rows.forEach(row => ws.addRow(row.map((v, i) => {
          const kind = t.cols[i][1];
          return (kind === 'date' || kind === 'stamp') ? excelDate(v) : v;
        })));
        ws.getRow(1).font = { bold: true };
        ws.views = [{ state:'frozen', ySplit:1 }];
        ws.autoFilter = { from: { row:1, column:1 }, to: { row:1, column:t.cols.length } };
        t.cols.forEach(([h, kind], i) => {
          const col = ws.getColumn(i + 1);
          if (kind === 'date') col.numFmt = 'yyyy-mm-dd';
          if (kind === 'stamp') col.numFmt = 'yyyy-mm-dd hh:mm';
          const long = ['Note', 'Comment', 'Task', 'Latest round'].includes(h);
          col.width = long ? 60 : kind === 'stamp' ? 17 : Math.max(12, Math.min(34, h.length + 6));
          if (long) col.alignment = { wrapText: true, vertical: 'top' };
        });
      });
      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                   boardFileBase(ui.showRemoved) + '.xlsx');
    } catch (e) {
      alert('Could not build the board export: ' + ((e && e.message) || e));
    }
    setBoardExporting(false);
  };
  // One file, the six tables in the workbook's order, each under a # title line
  // with a blank line between -- the per-card CSV's shape.
  const exportBoardCsv = async () => {
    setBoardExporting(true);
    try {
      const tables = await boardTables();
      const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const lines = [];
      tables.forEach((t, ti) => {
        if (ti) lines.push('');
        lines.push(cell('# ' + t.name));
        lines.push(t.cols.map(([h]) => cell(h)).join(','));
        t.rows.forEach(row => lines.push(row.map((v, i) =>
          cell(t.cols[i][1] === 'stamp' ? stampText(v) : v)).join(',')));
      });
      const csv = '﻿' + lines.join('\r\n') + '\r\n';
      downloadBlob(new Blob([csv], { type:'text/csv;charset=utf-8;' }), boardFileBase(ui.showRemoved) + '.csv');
    } catch (e) {
      alert('Could not build the board export: ' + ((e && e.message) || e));
    }
    setBoardExporting(false);
  };

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

  // ── THE TILE, ON THE 11 AUG MODEL ───────────────────────────────────────────
  // A left edge in the health colour, the identity, a pill row for the exceptions
  // and the owner at the foot. ONE CLICK OPENS THE CARD -- there is no expansion
  // and no second button, because a tile that both explained itself and carried an
  // Open button to the thing that explains it was two answers to one gesture.
  //
  // THE EDGE IS THE STAGE, on request -- the colour of the column the tile sits
  // in, from accentOf, the same table the pills and the column dots read. It
  // follows the card when it moves, by pill or by drag, because it is derived
  // from r.stage on every render. No stage set keeps accentOf's pale grey.
  //
  // HEALTH MOVED TO A PILL. The edge used to be health in three colours -- red
  // Stalled, amber At risk, green On track. Stalled and At risk are now pills at
  // the front of the pill row, in the same red and amber; On track shows
  // nothing, since a card that is fine should not add a word to every tile.
  const Card = ({ r }) => {
    const p = r.products || {};
    const h = healthOf(r, r.tasks);
    const notReq = testingNotRequired(p);
    const late = sampleOverdue(r);
    // Open tasks in the stage the card is IN -- the count the checklist heading
    // shows. The blocker reads every open task, because a card waiting on the
    // client for something left in Sampling is still waiting.
    const openHere = openTasks(r).filter(t => t.stage === r.stage).length;
    const blk = blockerOf(r);
    // ── THE HANDLE IS A WRAPPER, NOT THE BUTTON ─────────────────────────────
    // draggable on a form control behaves differently across browsers, and the
    // old board put it on a div for that reason. Off while this card is saving,
    // for a card that is off the board, and wherever the pointer is not fine.
    // THE FADE IS WRITTEN HERE AND WIPED HERE -- no state holds it, so a tile
    // remounted mid-drag comes back at full opacity by definition, and
    // data-plm-drag is what lets the document listener find any fade a lost
    // dragend left behind.
    const dragOn = canDrag && !r.archived && saving !== r.id;
    return (
      <div draggable={dragOn} data-plm-drag=""
        onMouseDown={()=>{ dragMovedRef.current = false; }}
        onDragStart={e=>{
          if (!dragOn) { e.preventDefault(); return; }
          e.dataTransfer.setData('text/plain', r.id);
          e.dataTransfer.effectAllowed = 'move';
          dragMovedRef.current = true;
          e.currentTarget.style.opacity = '.5';
        }}
        onDragEnd={e=>{ e.currentTarget.style.opacity = ''; setDropTarget(null); }}
        style={{cursor:dragOn ? 'grab' : 'default'}}>
      <button onClick={()=>{
          // A drag must never open the card. The flag is set on dragstart and
          // cleared on the next mousedown, so a real click still opens it.
          if (dragMovedRef.current) { dragMovedRef.current = false; return; }
          setOpenId(r.id);
        }}
        title={stageLabel(r.stage) + ' · ' + HEALTH[h].label}
        style={{background:'#fff',borderRadius:'16px',padding:'15px 16px',border:'none',
                boxShadow:'0 1px 3px rgba(0,0,0,.05)',cursor:'pointer',textAlign:'left',
                display:'block',width:'100%',borderLeft:'3px solid '+accentOf(r.stage),
                fontFamily:'inherit',boxSizing:'border-box'}}>
        <div style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:700,color:'#1A1A1C',
                     whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.sku || '—'}</div>
        {/* Two lines then cut. A product name is the one field here with no length
            discipline behind it, and one long name must not set the height of
            every tile in the column. */}
        <div style={{fontSize:'14px',fontWeight:600,color:'#1D1D1F',lineHeight:1.35,
                     letterSpacing:'-.012em',marginTop:'2px',overflow:'hidden',
                     display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
          {p.name || 'Untitled'}
        </div>
        <div style={{fontSize:'12px',color:'#86868B',marginTop:'3px',whiteSpace:'nowrap',
                     overflow:'hidden',textOverflow:'ellipsis'}}>{(r.client||{}).name || '—'}</div>

        {/* THE PILL ROW IS ABSENT RATHER THAN EMPTY when a card has nothing to
            flag, because a reserved blank strip is a row of nothing repeated down
            the whole board. */}
        {h !== 'on_track' || (r.days !== null && r.days !== undefined) || late || openHere > 0 || blk || r.noteCount > 0 || notReq || r.retired ? (
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'11px',flexWrap:'wrap'}}>
            {/* HEALTH, FIRST IN THE ROW -- what the edge used to say. The same
                healthOf the Stalled tile above the board counts, so a pill and
                that count cannot disagree. */}
            {h !== 'on_track' && (
              <span title={h === 'stalled'
                  ? 'A sample is overdue, or a task is waiting on us and the card has not moved in over 7 days'
                  : 'Over 14 days in this stage, or a task is past its due date'}
                style={{fontSize:'11px',fontWeight:600,borderRadius:'6px',padding:'2px 8px',
                        color:HEALTH[h].color,
                        background:h === 'stalled' ? 'rgba(255,55,95,.08)' : 'rgba(255,159,10,.10)'}}>
                {HEALTH[h].label}
              </span>
            )}
            {(r.days !== null && r.days !== undefined) && (
              <span title={'In this stage for ' + r.days + ' days'}
                style={{fontSize:'11px',fontWeight:500,borderRadius:'6px',padding:'2px 8px',
                        fontVariantNumeric:'tabular-nums',
                        color:r.stale?'#8a5a00':'#86868B',background:r.stale?'#FDF0DC':'#F5F5F7'}}>
                {r.days}d{r.stale ? ' · stale' : ''}
              </span>
            )}
            {late && (
              <span style={{fontSize:'11px',fontWeight:600,color:'#FF375F',
                            background:'rgba(255,55,95,.08)',borderRadius:'6px',padding:'2px 8px'}}>
                sample overdue
              </span>
            )}
            {openHere > 0 && (
              <span style={{fontSize:'11px',fontWeight:500,color:'#86868B',background:'#F5F5F7',
                            borderRadius:'6px',padding:'2px 8px'}}>
                {openHere} open
              </span>
            )}
            {blk && (
              <span style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11px',fontWeight:600,
                            color:BLOCKERS[blk].text,background:'#F5F5F7',borderRadius:'6px',padding:'2px 8px'}}>
                <span style={{width:'6px',height:'6px',borderRadius:'50%',background:BLOCKERS[blk].dot}} />
                {BLOCKERS[blk].label}
              </span>
            )}
            {r.noteCount > 0 && (
              <span style={{fontSize:'11px',fontWeight:500,color:'#86868B',background:'#F5F5F7',
                            borderRadius:'6px',padding:'2px 8px'}}>
                {r.noteCount} note{r.noteCount === 1 ? '' : 's'}
              </span>
            )}
            {notReq && (
              <span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',
                            color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 7px'}}>
                No testing
              </span>
            )}
            {/* A retired product no longer files the card away in a separate list.
                It sits in its own stage column and says so here instead. */}
            {r.retired && (
              <span title="This product has left the catalogue"
                style={{fontSize:'10px',fontWeight:700,letterSpacing:'.04em',textTransform:'uppercase',
                        color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 7px'}}>
                Retired
              </span>
            )}
          </div>
        ) : null}

        {/* ── WHO MADE IT, AND WHO LAST TOUCHED IT ─────────────────────────
            Replaces the owner line; ownership now shows only inside the card.
            Names through staffName, so an address with no profile still reads
            as somebody. A card created before created_by existed says Created
            and the date alone. Never edited since creation shows the first
            line only. Each line cuts with an ellipsis rather than wrapping.
            Dated with fmt -- Sep 23, 2026, with the year -- rather than the
            shared shortDate, which the checklist keeps. */}
        <div style={{fontSize:'11px',marginTop:'9px',color:'#B0B0B4',lineHeight:1.45}}>
          <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            Created{r.createdByName ? ' by ' + r.createdByName : ''}{r.created_at ? ' · ' + fmt(r.created_at) : ''}
          </div>
          {r.edited && (
            <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
              Last edited{r.lastTouchBy ? ' by ' + r.lastTouchBy : ''} · {fmt(r.updated_at)}
            </div>
          )}
        </div>
      </button>
      </div>
    );
  };

  const openRow = enriched.find(x => x.id === openId) || null;

  // ── THE COLUMNS, BUILT ONCE ─────────────────────────────────────────────────
  // The six stages in ladder order, then No stage set only when something is
  // actually in it, then Removed only when the toggle asks for it. Building the
  // list here rather than inline means the heading, the count and the cards in
  // every column come from one place and cannot disagree.
  //
  // NO STAGE SET IS NOT A COLUMN CARDS CAN BE PUT IN, only one they can be found
  // in -- none is a display key for a null stage, not a value the CHECK accepts.
  // Nothing drags any more, so that is no longer something the board has to
  // defend against; it is why the column has no heading dot in a stage colour.
  const columns = [
    ...MANUAL_STAGES.map(([k, l]) => ({
      key: k, label: l, color: accentOf(k), list: shownBoard.filter(r => r.stage === k),
    })),
    ...((counts.none || 0) > 0
      ? [{ key:'none', label:'No stage set', color: accentOf('none'),
           list: shownBoard.filter(r => !r.stage) }]
      : []),
    ...(ui.showRemoved
      ? [{ key:'removed', label:'Removed', color:'#C7C7CC', list: shownRemoved, muted:true }]
      : []),
  ];

  // ── THE FIVE HEALTH TILES ───────────────────────────────────────────────────
  // The 11 Aug strip whole again: stalled, overdue samples, and one each for
  // waiting on us, the client and the factory, which count cards with at least
  // one open task carrying that blocker. A card can sit in more than one.
  const stalledCards = board.filter(r => healthOf(r, r.tasks) === 'stalled');
  const overdueCards = board.filter(sampleOverdue);
  const waitingOn = b => board.filter(r => openTasks(r).some(t => t.blocker === b));

  return (
    <div style={{padding:'26px 30px 60px'}}>
      {openRow && <ProgramDetail r={openRow} userEmail={userEmail} staff={staff}
                                 busy={saving === openRow.id} onStage={setStage} onOwner={setOwner} onLab={setTestingLab}
                                 onArchive={setArchived}
                                 onDelete={deleteCard}
                                 onTouched={load}
                                 onClose={()=>setOpenId(null)} />}

      {/* THE TITLE ROW, THREE COLUMNS. The heading sits in the middle one, so it
          stays centred on the page; the board export sits at the right end of the
          row, where the page action sits on the pages that use the shared header
          (+ New on Companies). The empty left column balances the right one, and
          a grid rather than absolute positioning keeps the two from overlapping
          on a narrow screen. */}
      <div style={{display:'grid',gridTemplateColumns:'1fr auto 1fr',alignItems:'start',columnGap:'12px',marginBottom:'18px'}}>
        <div />
        <div style={{textAlign:'center'}}>
          <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
          <div style={{fontSize:'13px',color:'#86868B',marginTop:'5px'}}>
            {board.length} on the board
          </div>
        </div>
        <div style={{justifySelf:'end'}}>
          <ExportButton count={exportCards.length} busy={boardExporting} align="right"
            note={'Every card on the board (' + exportCards.length + '), filters not applied'}
            onXlsx={exportBoardXlsx} onCsv={exportBoardCsv} />
        </div>
      </div>

      {/* ── HEALTH, NOT STAGE COUNTS ─────────────────────────────────────────
          The stage counts moved into the column headings, where the 11 Aug board
          had them and where they cost no vertical space. What earns the strip
          instead is the thing a column heading cannot say -- how many cards are
          in trouble, wherever they happen to be sitting.

          These read the whole board rather than the filtered view, so narrowing
          never makes a total lie. */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',
                   gap:'12px',marginBottom:'18px'}}>
        {[
          { k:'Stalled',         v:stalledCards.length, c:HEALTH.stalled.color,
            t:'A sample is overdue, or the card has not moved and somebody is waiting on us' },
          { k:'Overdue samples', v:overdueCards.length, c:HEALTH.stalled.color,
            t:'Due back date has passed while the card is in Sampling or Revision' },
          { k:'Waiting on us',        v:waitingOn('us').length,      c:BLOCKERS.us.dot,      f:'us',
            t:'Cards with an open task waiting on us. Click to show only those' },
          { k:'Waiting on clients',   v:waitingOn('client').length,  c:BLOCKERS.client.dot,  f:'client',
            t:'Cards with an open task waiting on the client. Click to show only those' },
          { k:'Waiting on factories', v:waitingOn('factory').length, c:BLOCKERS.factory.dot, f:'factory',
            t:'Cards with an open task waiting on the factory. Click to show only those' },
        ].map(m => {
          // THE THREE WAITING TILES ARE FILTERS, as on 11 Aug; a second press
          // clears. Stalled and Overdue stay display-only -- the tile edges and
          // the overdue pill already mark those cards where they sit.
          const on = !!m.f && ui.blocker === m.f;
          const Tag = m.f ? 'button' : 'div';
          return (
            <Tag key={m.k} title={m.t}
              {...(m.f ? { onClick: () => setUi('blocker', on ? '' : m.f), 'aria-pressed': on } : {})}
              style={{background:on?'#1D1D1F':'#fff',borderRadius:'16px',padding:'14px 16px',border:'none',
                      boxShadow:'0 1px 3px rgba(0,0,0,.04)',textAlign:'left',fontFamily:'inherit',
                      cursor:m.f?'pointer':'default'}}>
              <div style={{fontSize:'24px',fontWeight:600,letterSpacing:'-.02em',lineHeight:1,
                           color:on ? '#fff' : (m.v > 0 ? m.c : '#1D1D1F'),fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
              <div style={{fontSize:'11.5px',color:on?'rgba(255,255,255,.65)':'#86868B',marginTop:'5px',
                           letterSpacing:'-.006em'}}>{m.k}</div>
            </Tag>
          );
        })}
      </div>

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'14px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'320px'}}>
          <input value={ui.search} onChange={e=>setUi('search', e.target.value)} placeholder="Search product, SKU or client…"
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',
                    fontSize:'13.5px',outline:'none',fontFamily:'inherit',background:'#fff',boxSizing:'border-box'}} />
        </div>
        <div style={{flex:1}} />
        {/* THE ONLY ROUTE BACK TO A REMOVED CARD, so it names its count even at
            zero -- a control that disappears when the list is empty is one nobody
            learns is there. */}
        <label style={{display:'inline-flex',alignItems:'center',gap:'7px',fontSize:'12.5px',
                       color:'#5A5A5E',cursor:'pointer',fontFamily:'inherit'}}>
          <input type="checkbox" checked={ui.showRemoved}
            onChange={e=>setUi('showRemoved', e.target.checked)} style={{cursor:'pointer'}} />
          Show {removed.length} removed
        </label>
      </div>

      {/* The owner chip row was here. The one thing it carried that still has a
          job is the N shown hint, which now follows only the Waiting tile
          filter. */}
      {ui.blocker && (
        <div style={{fontSize:'12px',color:'#86868B',margin:'-4px 0 14px'}}>{shownBoard.length} shown</div>
      )}

      {/* ── THE COLUMNS ARE THE BOARD ────────────────────────────────────────
          Fixed 272px columns scrolling sideways, which is the 11 Aug layout. The
          stacked full-width sections it replaces were built for dragging -- a
          drop target wants to be wide -- and nothing drags now.

          An empty column keeps its place and says so, because a ladder with a
          missing rung reads as a bug rather than as an empty stage. */}
      {board.length === 0 && removed.length === 0 ? (
        <div style={{background:'#fff',borderRadius:'20px',padding:'64px 32px',textAlign:'center',
                     boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',marginBottom:'8px',
                       letterSpacing:'-.018em'}}>The board is clear</div>
          <div style={{color:'#86868B',fontSize:'14px',maxWidth:'440px',margin:'0 auto',lineHeight:1.6}}>
            A card appears when somebody presses Create PLM Card on a quote. Nothing else makes one.
          </div>
        </div>
      ) : (
        <div style={{display:'flex',gap:'14px',overflowX:'auto',paddingBottom:'14px'}}>
          {columns.map(col => {
            // Only the six stage columns take a drop; see dropProps.
            const droppable = STAGE_LABEL[col.key] !== undefined;
            const over = droppable && dropTarget === col.key;
            return (
            <div key={col.key} {...(droppable ? dropProps(col.key) : {})}
              style={{flex:'0 0 272px',minWidth:'272px',borderRadius:'18px',
                      boxShadow:over ? 'inset 0 0 0 2px ' + col.color : 'none',
                      background:over ? 'rgba(0,0,0,.025)' : 'transparent',
                      transition:'box-shadow .1s, background .1s'}}>
              <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'2px 6px 12px'}}>
                <span style={{width:'9px',height:'9px',borderRadius:'50%',flexShrink:0,background:col.color}} />
                <span style={{fontSize:'13.5px',fontWeight:600,letterSpacing:'-.01em',
                              color:col.muted ? '#86868B' : '#1D1D1F'}}>{col.label}</span>
                <span style={{fontSize:'12px',color:'#86868B',fontVariantNumeric:'tabular-nums'}}>{col.list.length}</span>
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                {col.list.map(r => <Card key={r.id} r={r} />)}
                {col.list.length === 0 && (
                  <div style={{border:'1.5px dashed rgba(0,0,0,.08)',borderRadius:'16px',padding:'22px 0',
                               textAlign:'center',fontSize:'12px',color:'#C0C0C4'}}>empty</div>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}

      <p style={{margin:'18px 0 0',fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.55,maxWidth:'720px'}}>
        Open a card to change its stage, change its owner or add a note. A card appears
        only when somebody presses Create PLM Card on a quote. Nothing here moves on its
        own &mdash; an order, a test report or a change on Testing is reported on the card
        and never acts on it.
      </p>
    </div>
  );
}
