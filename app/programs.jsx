'use client';
// useRef went with the drag guard, and FilterSelect with the owner dropdown the
// chips replaced. Neither would have errored if left -- an unused import resolves
// perfectly well -- which is why they are removed by hand.
import { useState, useEffect, useMemo } from 'react';
import { SB } from '@/lib/supabase';
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
  currentStage, daysSince, CLIENT_OF, sampledFromStage, shipmentsOf,
} from '@/lib/lifecycle';
// The three product option sets, shared with the Testing product modal so the two
// screens cannot offer different words for the same stored value.
import { COMPLIANCE_OPTS, STAGE_OPTS, CATALOGUE_OPTS, catalogueKey, catalogueValue } from '@/lib/products';
// The export control Testing, Products and Codes already use. It owns the pill,
// the menu and the dismissal; the writers below are this page's business, which
// is the split that file states at the top of itself.
import { ExportButton } from '@/app/components/ExportButton';
// lib/excel.js, not an import of exceljs. The package is ~900KB and this file
// once carried its own copy of the loader -- see the note at the top of that
// file, which names programs.jsx as one of the two places it was written twice.
import { loadExcelJS, excelDate } from '@/lib/excel';
// The quote form's reading of a company's people -- primary first -- so the
// quick emails fall back to the same contact the quote form would have filled.
import { contactsOf, sameName } from '@/app/components/CompanySelect';
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
// sample strip ask this, so it is stated once.
const SAMPLING_STAGES = ['sampling', 'revision'];
// The program columns the card's sample strip may write, and nothing else.
const SAMPLE_FIELDS = ['sample_round', 'master_sample_included', 'sample_sent_date', 'sample_due_back'];
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
// ── THE CHECKLIST, RILEY'S TEMPLATES ON THE SIX-STAGE LADDER ────────────────
// Seeded the first time a card enters a stage (see seedStageTasks), and only
// then -- a card that leaves Sampling and comes back finds the list it left, not
// a second copy of it. Quoting has none, as it had none on 11 Aug.
//
// PRE-PRODUCTION FOLDED INTO PRODUCTION. Its three tasks were PO issued, the
// pre-production sample approved and the deposit paid. A saved PO is what puts
// a card in Production now, so "PO issued" is true on arrival and is dropped;
// the other two are real work that still happens after the PO, and lead the
// Production list.
//
// NO OWNER PER STAGE. The 11 Aug STAGE_OWNER table assigned every seeded task to
// a named person by stage; that went on decision, so seeded tasks belong to
// whoever owns the card when it moves, and nobody when nobody does.
const STAGE_TASKS = {
  sampling:   ['Request sample from factory', 'Sample received from factory', 'Sample sent to client', 'Client feedback received'],
  revision:   ['Log requested changes', 'Changes sent to factory', 'Revised sample received', 'Client sign-off'],
  testing:    ['Submit to lab', 'Results received', 'Compliance filed'],
  production: ['Pre-production sample approved', 'Production deposit paid', 'Production started', 'Production complete', 'QC / inspection booked'],
  shipped:    ['Freight quote issued', 'Booking confirmed', 'Docs sent to client'],
};
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
const sampleOverdue = r =>
  !!r.sample_due_back && daysSince(r.sample_due_back) > 0 && SAMPLING_STAGES.includes(r.stage);
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
// General notes belong to the program; sampling notes belong to the product and
// are shared by every card for that SKU. The add, edit and delete behaviour is
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

// A NOTE IS A TOUCH, and so is a sample event, an edit and a delete. The card
// reports a single last-touch line and it would be a lie if working on a card
// left it reading from last week. Stamped after the write lands; a failure here
// leaves the record correct and the stamp stale, which is the better way round.
const touchProgram = async (programId, userEmail) => {
  try {
    await SB.from('programs')
      .update({ updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', programId);
  } catch (e) {}
};

function NotesPanel({ table, keyCol, keyId, insertExtra = {}, extraCol, extraDefault,
                      filter = null, title, subtitle, programId, userEmail, onTouched }) {
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
  //
  // THE FILTER EXISTS BECAUSE ONE TABLE NOW HOLDS TWO THINGS. Script 67 put
  // sample events in product_notes beside the free-text sampling notes, keyed on
  // the same product. Without narrowing on kind this panel would list every
  // sample event as though somebody had typed it as a note -- which looks like
  // data rather than like a bug, and is the worse kind of wrong.
  const load = async () => {
    let qy = SB.from(table)
      .select('id,author,note,created_at,edited_at' + (extraCol ? ',' + extraCol : ''))
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
    await stampProgram();
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

  return (
    <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:subtitle?'3px':'9px'}}>{title}</div>
      {subtitle && (
        <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'9px'}}>{subtitle}</div>
      )}

      <textarea value={text} onChange={e=>setText(e.target.value)} rows={2}
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ── THE SAMPLE LOG ──────────────────────────────────────────────────────────
// A SAMPLE IS AN EVENT, NOT A FIELD. Script 66 put one sample_date on the
// product, which could describe exactly one round -- recording the second sample
// meant overwriting the first. Script 67 drops that column and gives
// product_notes a date and a round number, so every round is its own row and the
// history survives.
//
// THE ROUND AND THE DATE ARE BOTH OPTIONAL, and the CHECK requires one of them.
// That covers the three things people actually have: a numbered round with a
// date, a date for a sample nobody numbered, and a round somebody is recording
// before the date is known. What it refuses is an entry that says neither, which
// would render as a log line reporting nothing.
const SAMPLE_STAGES = [
  ['sample_1', 'Sample 1'], ['sample_2', 'Sample 2'], ['sample_3', 'Sample 3'],
  ['sample_4', 'Sample 4'], ['sample_5', 'Sample 5'],
];
const sampleStageLabel = v => (SAMPLE_STAGES.find(s => s[0] === v) || [null, null])[1];
// "Sample 2 · Sep 18, 2026" -- what the card row and the export header show. The
// comment is deliberately not in here: the card reports WHICH round and WHEN, and
// a comment of any length would push the rest of the row off.
const sampleHead = e => [sampleStageLabel(e.sample_stage), e.sample_date ? fmt(e.sample_date) : null]
  .filter(Boolean).join(' · ');
// The same line with the comment on the end, for the log itself and the files.
const sampleLine = e => {
  const c = (e.note || '').trim();
  const h = sampleHead(e);
  return c ? (h ? h + ' · ' + c : c) : h;
};
// LATEST MEANS THE SAMPLE THAT HAPPENED LAST, not the row typed last. A date
// entered for a round somebody is catching up on belongs where the date puts it,
// so sample_date leads and created_at only breaks ties or stands in when no date
// was given.
const sampleSortKey = e => (e.sample_date || String(e.created_at || '').slice(0, 10)) + ' ' + String(e.created_at || '');
const sortSamples = list => (list || []).slice().sort((a, b) => (sampleSortKey(a) < sampleSortKey(b) ? 1 : -1));
const latestSampleOf = list => sortSamples(list)[0] || null;

function SampleLog({ productId, programId, userEmail, busy = false, onTouched }) {
  const [rows, setRows]   = useState(null);
  const [stage, setStage] = useState('');
  const [date, setDate]   = useState('');
  const [text, setText]   = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState('');
  // One editor at a time, for the reason NotesPanel gives -- two open editors are
  // two unsaved drafts with no way to say which one the dirty guard is protecting.
  const [editId, setEditId] = useState(null);
  const [draft, setDraft]   = useState({ stage:'', date:'', text:'' });

  const load = async () => {
    const { data, error } = await SB.from('product_notes')
      .select('id,author,note,created_at,edited_at,sample_stage,sample_date')
      .eq('product_id', productId).eq('kind', 'sample_event');
    if (error) { setErr(error.message); setRows([]); return; }
    // Sorted here rather than in the query, because the order is by sample_date
    // with created_at standing in where there is none -- which is a rule, not a
    // column, and PostgREST cannot express it.
    setRows(sortSamples(data || []));
  };
  useEffect(()=>{ setRows(null); setEditId(null); load(); }, [productId]);

  const settle = async () => {
    await touchProgram(programId, userEmail);
    await load();
    if (onTouched) onTouched();
  };

  // STAGE OR DATE, the same rule the CHECK enforces. The button says so by being
  // dead until one of them is set, so the refusal happens before the round trip
  // rather than as a constraint error afterwards.
  const canAdd = !!(stage || date);

  const add = async () => {
    if (!canAdd) return;
    setSaving(true); setErr('');
    const { error } = await SB.from('product_notes').insert({
      product_id: productId,
      kind: 'sample_event',
      author: userEmail || null,
      sample_stage: stage || null,
      sample_date: date || null,
      // note is NOT NULL on the table and the comment is optional here, so an
      // empty comment is stored as an empty string rather than refused.
      note: text.trim(),
    });
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setStage(''); setDate(''); setText('');
    await settle();
  };

  const saveEdit = async (e) => {
    const nextStage = draft.stage || null;
    const nextDate  = draft.date || null;
    const nextText  = draft.text.trim();
    // The same rule as adding. An edit that empties both would fail the CHECK, so
    // it is refused here with the reason rather than as a database error.
    if (!nextStage && !nextDate) { setErr('A sample entry needs a round or a date.'); return; }
    const unchanged = nextStage === (e.sample_stage || null)
                   && nextDate === (e.sample_date || null)
                   && nextText === (e.note || '');
    if (unchanged) { setEditId(null); return; }
    setSaving(true); setErr('');
    const { error } = await SB.from('product_notes')
      .update({ sample_stage: nextStage, sample_date: nextDate, note: nextText,
                edited_at: new Date().toISOString() })
      .eq('id', e.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    setEditId(null);
    await settle();
  };

  const removeRow = async (e) => {
    if (!window.confirm('Delete this sample entry? This cannot be undone.')) return;
    setSaving(true); setErr('');
    const { error } = await SB.from('product_notes').delete().eq('id', e.id);
    setSaving(false);
    if (error) { setErr(error.message); return; }
    await settle();
  };

  const when = iso => {
    if (!iso) return '';
    try { return new Date(iso).toLocaleString('en-US',
      { year:'numeric', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }); }
    catch { return String(iso); }
  };

  const fieldCss = {
    border:'1px solid rgba(0,0,0,.12)', borderRadius:'9px', padding:'7px 9px', fontSize:'13px',
    fontFamily:'inherit', background:'#fff', color:'#1D1D1F', letterSpacing:0, textTransform:'none',
  };
  const lbl = {
    display:'flex', flexDirection:'column', gap:'4px', fontSize:'11px', fontWeight:600,
    letterSpacing:'.08em', textTransform:'uppercase', color:'#86868B', fontFamily:'inherit',
  };

  return (
    <div style={{marginTop:'14px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'3px'}}>Sampling log</div>
      <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'9px'}}>
        One row per sample round. On the product, so it reads the same on every card for this SKU.
      </div>

      {/* ── ADD A SAMPLE ────────────────────────────────────────────────────
          Three optional fields and a button that will not fire until the entry
          says something. Laid out on one wrapping row because it is one act. */}
      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',alignItems:'flex-end'}}>
        <label style={lbl}>
          Sample stage
          <select value={stage} onChange={e=>setStage(e.target.value)} disabled={busy || saving}
            style={{...fieldCss, minWidth:'135px', cursor:(busy||saving)?'default':'pointer'}}>
            <option value="">— Not set —</option>
            {SAMPLE_STAGES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        <label style={lbl}>
          Date
          <input type="date" value={date} onChange={e=>setDate(e.target.value)} disabled={busy || saving}
            style={{...fieldCss, minWidth:'155px'}} />
        </label>
        <label style={{...lbl, flex:'1 1 200px', minWidth:'180px'}}>
          Comment
          <input type="text" value={text} onChange={e=>setText(e.target.value)} disabled={busy || saving}
            placeholder="Optional — what happened"
            style={{...fieldCss, width:'100%', boxSizing:'border-box'}} />
        </label>
        <button onClick={add} disabled={busy || saving || !canAdd}
          title={canAdd ? 'Add this sample' : 'Set a stage or a date first'}
          style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'8px 16px',border:'none',
                  fontFamily:'inherit',cursor:(busy||saving||!canAdd)?'default':'pointer',
                  background:canAdd?'#1D1D1F':'#E5E5EA',color:canAdd?'#fff':'#A0A0A4'}}>
          {saving ? 'Adding…' : 'Add sample'}
        </button>
      </div>
      {err && <div style={{fontSize:'11.5px',color:'var(--hot)',marginTop:'7px'}}>{err}</div>}

      {rows === null ? (
        <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>Reading the log…</div>
      ) : rows.length === 0 ? (
        <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>No samples recorded yet.</div>
      ) : (
        <div style={{marginTop:'12px',display:'flex',flexDirection:'column',gap:'9px'}}>
          {rows.map(e => {
            const mine = authorIsMe(e.author, userEmail);
            const editing = editId === e.id;
            return (
              <div key={e.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
                {editing ? (
                  <>
                    <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'flex-end'}}>
                      <label style={lbl}>
                        Stage
                        <select value={draft.stage} onChange={ev=>setDraft(d=>({...d, stage:ev.target.value}))}
                          disabled={saving} style={{...fieldCss, minWidth:'128px'}}>
                          <option value="">— Not set —</option>
                          {SAMPLE_STAGES.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </label>
                      <label style={lbl}>
                        Date
                        <input type="date" value={draft.date} disabled={saving}
                          onChange={ev=>setDraft(d=>({...d, date:ev.target.value}))}
                          style={{...fieldCss, minWidth:'150px'}} />
                      </label>
                      <label style={{...lbl, flex:'1 1 180px', minWidth:'160px'}}>
                        Comment
                        <input type="text" value={draft.text} disabled={saving}
                          onChange={ev=>setDraft(d=>({...d, text:ev.target.value}))}
                          style={{...fieldCss, width:'100%', boxSizing:'border-box'}} />
                      </label>
                    </div>
                    <div style={{display:'flex',gap:'7px',marginTop:'8px'}}>
                      <button onClick={()=>saveEdit(e)} disabled={saving}
                        style={{fontSize:'11.5px',fontWeight:600,borderRadius:'980px',padding:'5px 13px',border:'none',
                                fontFamily:'inherit',cursor:saving?'default':'pointer',
                                background:'#1D1D1F',color:'#fff'}}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={()=>{ setEditId(null); setErr(''); }} disabled={saving}
                        style={{fontSize:'11.5px',fontWeight:600,borderRadius:'980px',padding:'5px 13px',
                                border:'1px solid #E5E5EA',background:'#fff',color:'#5A5A5E',
                                fontFamily:'inherit',cursor:saving?'default':'pointer'}}>
                        Cancel
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{fontSize:'13px',color:'#1D1D1F',lineHeight:1.5}}>{sampleLine(e)}</div>
                )}
                <div style={{display:'flex',alignItems:'baseline',gap:'8px',marginTop:'5px',flexWrap:'wrap'}}>
                  <span style={{fontSize:'11px',color:'#A0A0A4'}}>
                    {e.author || 'unknown'} · {when(e.created_at)}{e.edited_at ? ' · edited' : ''}
                  </span>
                  {mine && !editing && (
                    <span style={{display:'inline-flex',gap:'8px',marginLeft:'auto'}}>
                      <button onClick={()=>{ setEditId(e.id); setErr('');
                                             setDraft({ stage:e.sample_stage || '', date:e.sample_date || '', text:e.note || '' }); }}
                        disabled={busy || saving}
                        style={{fontSize:'11px',background:'none',border:'none',padding:0,color:'#0A84FF',
                                fontFamily:'inherit',cursor:(busy||saving)?'default':'pointer'}}>Edit</button>
                      <button onClick={()=>removeRow(e)} disabled={busy || saving}
                        style={{fontSize:'11px',background:'none',border:'none',padding:0,color:'var(--hot)',
                                fontFamily:'inherit',cursor:(busy||saving)?'default':'pointer'}}>Delete</button>
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

// ── QUICK EMAILS, THE 11 AUG TEMPLATES ON THE SIX-STAGE LADDER ──────────────
// Riley's words, mapped onto the stages that survive. Inquiry and Delivered are
// gone; Delivered's confirmation moves to Shipped, which is where the card ends
// now. Pre-Production's "Confirm PO with factory" is dropped rather than moved --
// a PO being saved is what puts a card in Production, so by the time a card is
// there the PO it asked about already exists.
//
// THE "EMILY" TEMPLATES ARE FACTORY EMAILS. The 11 Aug code addressed them to
// emily@kinguniversal.com, but no Emily is on staff -- Emily Chen is the Fuzhou
// factory contact. So they go to the factory contact, whoever that is for the
// card, and greet them by name.
//
// No mail is sent from here. The composer opens the person's own mail client
// with the fields filled, which is what the 11 Aug version did.
const STAGE_EMAILS = {
  quoted: [
    { label:'Send quote to client', to:'client', subject:'Quote — {product} ({sku})',
      body:'Hi {clientContact},\n\nPlease find our quote for {product} attached. Happy to walk through any of it.\n\nBest,' },
  ],
  sampling: [
    { label:'Chase factory sample', to:'factory', subject:'Sample status — {product} ({sku})',
      body:'Hi {factoryContact},\n\nChecking in on the sample for {product} ({sku}) for {client}. Sent {sent}, due back {due}. Where does it stand — and did the master sample go with it?\n\nThanks,' },
    { label:'Sample to client', to:'client', subject:'Sample on the way — {product}',
      body:'Hi {clientContact},\n\nThe {product} sample is heading your way. Let us know your thoughts and any changes.\n\nBest,' },
    { label:'Request feedback', to:'client', subject:'Sample feedback — {product}',
      body:'Hi {clientContact},\n\nFollowing up on the {product} sample (round {round}) — any feedback or approval?\n\nBest,' },
  ],
  revision: [
    { label:'Revisions to factory', to:'factory', subject:'Revisions — {product} ({sku})',
      body:'Hi {factoryContact},\n\nClient changes on {product} (round {round}):\n\n[changes]\n\nCan we get a revised sample and timeline?\n\nThanks,' },
    { label:'Request sign-off', to:'client', subject:'Revised sample — {product}',
      body:'Hi {clientContact},\n\nThe revised {product} sample (round {round}) is with you. Good to move to production, or final tweaks?\n\nBest,' },
  ],
  testing: [
    { label:'Submit to lab', to:'', subject:'Test request — {product} ({sku})',
      body:'Hello,\n\nWe would like to submit {product} ({sku}) for compliance testing. Please advise required samples and turnaround.\n\nThanks,' },
  ],
  production: [
    { label:'Production status', to:'factory', subject:'Production status — {product}',
      body:'Hi {factoryContact},\n\nCan you give us an update on {product} for {client}? Percent complete and expected finish.\n\nThanks,' },
  ],
  shipped: [
    { label:'Docs to client', to:'client', subject:'Shipping docs — {product}',
      body:'Hi {clientContact},\n\n{product} has shipped. Documents attached — we will keep you posted on arrival.\n\nBest,' },
    { label:'Delivery confirmation', to:'client', subject:'Delivered — {product}',
      body:'Hi {clientContact},\n\nConfirming {product} has been delivered. Anything you need on our end?\n\nBest,' },
  ],
};

// "Sep 18". A plain date is read as local noon so no timezone moves it a day.
const shortDate = s => {
  if (!s) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
};

const fillTemplate = (text, r, who) => {
  const p = r.products || {};
  const map = {
    product: p.name || 'the product', sku: p.sku || '', client: (r.client || {}).name || '',
    clientContact: (who.client && who.client.name) || (r.client || {}).name || 'there',
    factoryContact: (who.factory && who.factory.name) || who.factoryName || 'there',
    round: String(r.sample_round || 1),
    sent: r.sample_sent_date ? shortDate(r.sample_sent_date) : 'recently',
    due: r.sample_due_back ? shortDate(r.sample_due_back) : 'soon',
  };
  let out = text;
  Object.keys(map).forEach(k => { out = out.split('{' + k + '}').join(map[k]); });
  return out;
};

// ── WHO THE EMAILS GO TO ────────────────────────────────────────────────────
// programs has no contact columns -- the 11 Aug table carried client_email and
// factory_email on the row, and this one does not. So, on decision:
//
//   1. the latest quote for this product and client, which is where somebody
//      last wrote down who the buyer and the factory contact were;
//   2. failing that, the company's own contact, primary first -- the client from
//      client_company_id, the factory by matching the quote's factory name to a
//      factory company, the same match the quote form's select makes.
//
// A contact without an email is no use to a mail link, so each side takes the
// first answer that carries one. Read when the card opens, not in the board's
// bulk fetch -- nobody needs every card's contacts to look at the board.
function useCardContacts(r) {
  const [who, setWho] = useState({ loading:true, client:null, factory:null, factoryName:'' });
  useEffect(() => {
    let dead = false;
    (async () => {
      const out = { loading:false, client:null, factory:null, factoryName:'' };
      const firstWithEmail = list => (list || []).find(c => (c.email || '').trim()) || null;
      const fromDirectory = async companyId => {
        const { data } = await SB.from('contacts').select('company_id,full_name,email,phone,is_primary')
          .eq('company_id', companyId);
        const c = firstWithEmail(contactsOf({ id: companyId }, data || []));
        return c ? { name: c.full_name || '', email: c.email.trim(), from: 'directory' } : null;
      };
      try {
        let q = null;
        if (r.product_id && r.client_company_id) {
          const { data } = await SB.from('quotes')
            .select('client_contact,client_email,factory,factory_contact,factory_email')
            .eq('product_id', r.product_id).eq('client_company_id', r.client_company_id)
            .order('quote_date', { ascending:false, nullsFirst:false })
            .order('created_at', { ascending:false })
            .limit(1);
          q = (data || [])[0] || null;
        }
        if (q && (q.client_email || '').trim()) {
          out.client = { name: q.client_contact || '', email: q.client_email.trim(), from: 'quote' };
        } else if (r.client_company_id) {
          out.client = await fromDirectory(r.client_company_id);
        }
        out.factoryName = (q && q.factory) || '';
        if (q && (q.factory_email || '').trim()) {
          out.factory = { name: q.factory_contact || '', email: q.factory_email.trim(), from: 'quote' };
        } else if (out.factoryName) {
          const { data } = await SB.from('companies').select('id,name').eq('type', 'factory');
          const co = (data || []).find(c => sameName(c.name, out.factoryName));
          if (co) out.factory = await fromDirectory(co.id);
        }
      } catch (e) {}
      if (!dead) setWho(out);
    })();
    return () => { dead = true; };
  }, [r.id, r.product_id, r.client_company_id]);
  return who;
}

// ── THE COMPOSER ────────────────────────────────────────────────────────────
// The 11 Aug composer, with the hardcoded team replaced by staff_profiles and
// the client and factory chips filled from useCardContacts. An Overlay of its
// own above the card, so it carries its own dirty guard -- a half-written email
// is prose, the same as a note.
function EmailComposer({ tpl, r, who, staff = [], onClose }) {
  const recipient = tpl.to === 'client' ? (who.client && who.client.email)
                  : tpl.to === 'factory' ? (who.factory && who.factory.email) : '';
  const [to, setTo] = useState(recipient || '');
  const [subject, setSubject] = useState(fillTemplate(tpl.subject, r, who));
  const [body, setBody] = useState(fillTemplate(tpl.body, r, who));
  const chips = [
    who.client ? { label: (who.client.name || (r.client || {}).name || 'Client') + ' · client', email: who.client.email } : null,
    who.factory ? { label: (who.factory.name || who.factoryName || 'Factory') + ' · factory', email: who.factory.email } : null,
    ...staff.filter(s => s.email).map(s => ({ label: s.full_name || s.email, email: s.email })),
  ].filter(Boolean);
  const openMail = () => {
    window.location.href = 'mailto:' + encodeURIComponent(to || '').replace(/%40/g, '@')
      + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    onClose();
  };
  const inp = { width:'100%', border:'1px solid rgba(0,0,0,.1)', borderRadius:'10px', padding:'9px 12px',
                fontSize:'13.5px', outline:'none', fontFamily:'inherit', boxSizing:'border-box', background:'#fff' };
  const lbl = { display:'block', fontSize:'10px', fontWeight:600, textTransform:'uppercase',
                letterSpacing:'.06em', color:'#86868B', marginBottom:'5px' };
  const missing = (tpl.to === 'client' || tpl.to === 'factory') && !recipient;
  return (
    <Overlay onClose={onClose} zIndex={400} maxWidth={520}>
      <ComposerBody tpl={tpl} missing={missing} inp={inp} lbl={lbl} chips={chips}
        to={to} setTo={setTo} subject={subject} setSubject={setSubject}
        body={body} setBody={setBody} openMail={openMail} />
    </Overlay>
  );
}
// Split out so the x reads guardedClose from the composer's own Overlay, the
// same reason ProgramCard is split from ProgramDetail.
function ComposerBody({ tpl, missing, inp, lbl, chips, to, setTo, subject, setSubject, body, setBody, openMail }) {
  const guardedClose = useGuardedClose();
  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.016em'}}>{tpl.label}</div>
        <button onClick={guardedClose} aria-label="Close"
          style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                  cursor:'pointer',padding:'0 2px',fontFamily:'inherit'}}>×</button>
      </div>
      <div style={{marginTop:'14px'}}>
        <label style={lbl}>To</label>
        <input style={inp} value={to} onChange={e=>setTo(e.target.value)} placeholder="recipient@email.com" />
        {/* SAID RATHER THAN LEFT BLANK. An empty To on a client email looks like
            the composer forgot; this says the records have nobody to offer. */}
        {missing && (
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'6px'}}>
            No {tpl.to} email on the latest quote or in the company directory.
          </div>
        )}
        <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'8px',marginBottom:'14px'}}>
          {chips.map((c, i) => (
            <button key={i} onClick={()=>setTo(c.email)} title={c.email}
              style={{fontSize:'11.5px',fontWeight:500,border:'none',borderRadius:'980px',padding:'5px 12px',
                      cursor:'pointer',fontFamily:'inherit',
                      background:to===c.email?'#1D1D1F':'#F5F5F7',color:to===c.email?'#fff':'#5A5A5E'}}>
              {c.label}
            </button>
          ))}
        </div>
        <label style={lbl}>Subject</label>
        <input style={{...inp,marginBottom:'14px'}} value={subject} onChange={e=>setSubject(e.target.value)} />
        <label style={lbl}>Message</label>
        <textarea style={{...inp,minHeight:'150px',resize:'vertical',lineHeight:1.55}}
          value={body} onChange={e=>setBody(e.target.value)} />
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',marginTop:'14px'}}>
        <button onClick={openMail}
          style={{background:'#0A84FF',color:'#fff',border:'none',borderRadius:'980px',padding:'10px 20px',
                  fontSize:'13.5px',fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Open in Mail</button>
      </div>
    </>
  );
}

// ── A DATE THAT SAVES ITSELF, BUT ONLY ONCE IT IS A DATE ────────────────────
// The sample strip writes on change, as the 11 Aug one did. A date input fires
// change on every keystroke once each segment is filled, so typing 2026 into
// the year passes through 0002, 0020 and 0202 -- four writes, three of them
// nonsense. So the input keeps its own draft and commits only a full date from
// 2000 on, or a clear. data-noguard because it is saved the moment it commits
// and there is nothing for the close guard to protect.
function SampleDate({ value, onCommit, disabled, style }) {
  const [v, setV] = useState(value || '');
  useEffect(() => { setV(value || ''); }, [value]);
  return (
    <input type="date" data-noguard value={v} disabled={disabled} style={style}
      onChange={e => {
        const x = e.target.value;
        setV(x);
        if (x === '') { if (value) onCommit(null); return; }
        if (/^\d{4}-\d{2}-\d{2}$/.test(x) && Number(x.slice(0, 4)) >= 2000 && x !== value) onCommit(x);
      }} />
  );
}

// ── THE SAMPLE STRIP ────────────────────────────────────────────────────────
// Round, master sample, sent and due back -- on the PROGRAM, by script 77,
// because two clients sampling one SKU are on different rounds. The sampling
// log on the Card tab is the product's history; this is where this card's current
// sample stands. Shown in Sampling and Revision only, as it was on 11 Aug.
function SampleStrip({ r, busy, onSample }) {
  const inp = { width:'100%', border:'1px solid rgba(0,0,0,.1)', borderRadius:'10px', padding:'8px 10px',
                fontSize:'13px', outline:'none', fontFamily:'inherit', boxSizing:'border-box', background:'#fff' };
  const lbl = { display:'block', fontSize:'10px', fontWeight:600, textTransform:'uppercase',
                letterSpacing:'.06em', color:'#86868B', marginBottom:'5px' };
  const round = Number(r.sample_round) || 1;
  const late = sampleOverdue(r);
  const btn = { ...inp, width:'32px', padding:'6px 0', textAlign:'center', cursor:busy?'default':'pointer' };
  return (
    <div style={{background:'#F5F5F7',borderRadius:'16px',padding:'16px 18px',marginTop:'16px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'14px'}}>
        <div>
          <span style={lbl}>Sample round</span>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <button onClick={()=>onSample(r, { sample_round: Math.max(1, round - 1) })}
              disabled={busy || round <= 1} style={btn} aria-label="Previous round">−</button>
            {/* A null round shows 1 and is not written until somebody moves it,
                so no card claims a round nobody recorded. */}
            <span style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',minWidth:'22px',textAlign:'center',
                          fontVariantNumeric:'tabular-nums'}}>{round}</span>
            <button onClick={()=>onSample(r, { sample_round: round + 1 })}
              disabled={busy} style={btn} aria-label="Next round">+</button>
          </div>
        </div>
        <div>
          <span style={lbl}>Master sample</span>
          <div style={{display:'flex',gap:'6px'}}>
            {[['Yes', true], ['No', false]].map(([l, v]) => {
              const on = r.master_sample_included === v;
              return (
                <button key={l} disabled={busy}
                  onClick={()=>onSample(r, { master_sample_included: v })}
                  style={{...inp,flex:1,padding:'7px 0',textAlign:'center',cursor:busy?'default':'pointer',fontWeight:600,
                          background:on?'#1D1D1F':'#fff',color:on?'#fff':'#86868B',
                          border:'1px solid '+(on?'#1D1D1F':'rgba(0,0,0,.1)')}}>{l}</button>
              );
            })}
          </div>
        </div>
        <div>
          <span style={lbl}>Sent</span>
          <SampleDate value={r.sample_sent_date} disabled={busy} style={inp}
            onCommit={v=>onSample(r, { sample_sent_date: v })} />
        </div>
        <div>
          <span style={lbl}>Due back</span>
          <SampleDate value={r.sample_due_back} disabled={busy}
            style={{...inp,borderColor:late?'#FF375F':'rgba(0,0,0,.1)'}}
            onCommit={v=>onSample(r, { sample_due_back: v })} />
        </div>
      </div>
      {late && (
        <div style={{fontSize:'12.5px',color:'#FF375F',marginTop:'11px',fontWeight:500}}>
          Sample is {daysSince(r.sample_due_back)} day{daysSince(r.sample_due_back) === 1 ? '' : 's'} overdue.
        </div>
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
  const [err, setErr] = useState('');

  const settle = async () => {
    await touchProgram(r.id, userEmail);
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

      {elsewhere.length > 0 && (
        <div style={{marginTop:'16px'}}>
          <div style={{fontSize:'11px',fontWeight:600,color:'#B0B0B4',textTransform:'uppercase',
                       letterSpacing:'.06em',marginBottom:'5px'}}>Open elsewhere ({elsewhere.length})</div>
          {elsewhere.map(t => (
            <TaskRow key={t.id} t={t} staff={staff} dim pending={pending === t.id}
                     onToggle={toggle} onBlocker={setBlocker} onDel={del} />
          ))}
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
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onProduct, onSample, onArchive, onClose, onTouched }) {
  return (
    // Wider than it was, because the card carries two tabs now. Still inside the
    // range the other modals in this app use, 420 through 640.
    <Overlay onClose={onClose} maxWidth={720}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy}
                   onStage={onStage} onOwner={onOwner} onProduct={onProduct} onSample={onSample}
                   onArchive={onArchive} onTouched={onTouched} />
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

const recordRows = r => {
  const p = r.products || {};
  const ev = r.events || {};
  // The same test currentStage uses, imported rather than repeated -- production
  // implies sampling happened, and that rule lives in lib/lifecycle.js.
  const sampled = sampledFromStage(p);
  const ship = r.shipping;
  const none = 'Nothing recorded';
  return [
    ['Quoted', ev.quoted ? fmt(ev.quoted.on) + (ev.quoted.n > 1 ? ' · ' + ev.quoted.n + ' quotes' : '') : none, !ev.quoted],
    // THE SAMPLE DATE IS THE BETTER ANSWER when somebody has recorded one, because
    // it says WHEN. The product-stage flag is the fallback and says only that it
    // happened -- product_stage records what a product IS, not when it became
    // that. Production counts, because production implies sampling happened.
    ['Sampling', r.latestSample ? sampleHead(r.latestSample)
               : sampled === 'production' ? 'Product marked Production'
               : sampled === 'sample' ? 'Product marked Sample'
               : 'Not recorded', !r.latestSample && !sampled],
    ['Purchase order', ev.ordered ? fmt(ev.ordered.on) : none, !ev.ordered],
    ['Sales order', ev.sold ? fmt(ev.sold.on) : none, !ev.sold],
    // AN ETD IS A PLAN AND SAYS SO. Departed is what actually happened and wins
    // whenever it exists; the estimate only speaks when nothing has moved.
    ['Shipping', ship ? (ship.kind === 'departed' ? 'Departed ' + fmt(ship.on)
                                                  : 'ETD ' + fmt(ship.on)) : none, !ship],
    ['Test report', ev.tested ? fmt(ev.tested.on) : none, !ev.tested],
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
function SystemKnows({ r, busy = false, onProduct }) {
  const p = r.products || {};
  // ev, sampled, ship and the 'Nothing recorded' fallback all moved into
  // recordRows, which this block and all three exports now read from.
  //
  // The key is on the row itself because these arrive as an array now. Harmless
  // on the single calls that still pass through here.
  const row = (label, value, muted) => (
    <div key={label} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>{value}</span>
    </div>
  );
  // A row whose value is a control. Same geometry as row above, so the block reads
  // as one list rather than two -- what changes is that three of these lines can
  // be answered here instead of on another page.
  const editRow = (label, control) => (
    <div style={{display:'flex',gap:'10px',padding:'5px 0',borderTop:'1px solid #F2F2F4',alignItems:'center'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      {control}
    </div>
  );
  // Disabled without a product, because these write to products and a card with no
  // product_id has nothing to write to. onProduct says so too, but a control that
  // cannot work should not look like it can.
  const sel = (value, opts, onPick) => (
    <select value={value} disabled={busy || !r.product_id} onChange={e=>onPick(e.target.value)}
      style={{border:'1px solid rgba(0,0,0,.12)',borderRadius:'8px',padding:'4px 7px',fontSize:'12.5px',
              fontFamily:'inherit',background:'#fff',color:'#1D1D1F',
              cursor:(busy || !r.product_id)?'default':'pointer'}}>
      {opts.map(([v,l]) => <option key={v || 'none'} value={v}>{l}</option>)}
    </select>
  );
  return (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'4px'}}>What the system knows</div>
      <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'7px'}}>
        The dates come from the records and cannot be edited here. The product fields can
        &mdash; they belong to the product, so a change shows on every card for this SKU.
      </div>
      {/* THE SIX REPORTED ROWS, from the list the exports read too. One source
          and four readers, so a file and the screen cannot describe the same
          record differently. */}
      {recordRows(r).map(([label, value, muted]) => row(label, value, muted))}
      {editRow('Product stage', sel(p.product_stage || '', STAGE_OPTS,
        v => onProduct && onProduct(r, { product_stage: v || null })))}
      {editRow('Compliance', sel(p.compliance_status || '', COMPLIANCE_OPTS,
        v => onProduct && onProduct(r, { compliance_status: v || null })))}
      {/* What the OLD board would have called this card, kept because it is a
          useful second opinion and labelled so nobody mistakes it for the stage. */}
      {row(...suggestRow(r))}
      {/* Three-state, and only false is Inactive -- NULL is undecided, not
          retired, which is why the option set carries Not set as a real choice. */}
      {editRow('Catalogue', sel(catalogueKey(p), CATALOGUE_OPTS,
        v => onProduct && onProduct(r, { active: catalogueValue(v) })))}
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
      ['Latest sample', r.latestSample ? sampleHead(r.latestSample) : 'Not recorded'],
    ],
    knows: [
      ...recordRows(r).map(([label, value]) => [label, value]),
      ['Product stage', optLabel(STAGE_OPTS, p.product_stage)],
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
// <SKU>-plm-card-<date>, with anything a filesystem would argue about replaced.
// A SKU is not guaranteed to be tame -- BUC-157 has a sibling with a double
// space in its name -- and a slash in a download name is a silent failure.
const fileBase = r => {
  const raw = (r.products || {}).sku || 'no-sku';
  const safe = raw.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return (safe || 'no-sku') + '-plm-card-' + stampToday();
};
const downloadBlob = (blob, filename) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
};

// BOTH NOTE SETS, FETCHED HERE rather than lifted out of NotesPanel. The panel
// owns its own list and only ONE of the two is mounted at a time -- the Sampling
// panel does not exist while the Card tab is showing. Reading from the panel
// would mean an export from the Card tab wrote an empty Sampling section purely
// because nobody had clicked the other tab, which is the kind of wrong that
// looks right.
const fetchCardNotes = async r => {
  const gen = await SB.from('program_notes')
    .select('author,note,created_at,edited_at,source')
    .eq('program_id', r.id).order('created_at', { ascending:false });
  if (gen.error) throw new Error(gen.error.message);
  // A card with no product has no sampling notes to ask for. product_id is the
  // key, and .eq on null matches nothing -- a round trip to learn what is already
  // known here.
  let smp = { data: [] };
  let evt = { data: [] };
  if (r.product_id) {
    // NARROWED ON kind, both of them. One table holds the free-text notes and the
    // sample log since script 67, so a select on product_id alone would put every
    // sample event in the notes section of the file.
    smp = await SB.from('product_notes')
      .select('author,note,created_at,edited_at,kind')
      .eq('product_id', r.product_id).eq('kind', 'sampling')
      .order('created_at', { ascending:false });
    if (smp.error) throw new Error(smp.error.message);
    evt = await SB.from('product_notes')
      .select('author,note,created_at,edited_at,sample_stage,sample_date')
      .eq('product_id', r.product_id).eq('kind', 'sample_event');
    if (evt.error) throw new Error(evt.error.message);
  }
  // kind on a product note, source on a program note. Both answer the same
  // question in the file -- what sort of note is this -- so both land in one
  // column and the two tables' column names stop mattering past this line.
  const shape = (list, kindCol) => (list || []).map(n => ({
    kind: n[kindCol] || '', author: n.author || 'unknown',
    date: n.created_at, edited: !!n.edited_at, text: n.note || '',
  }));
  // The log is sorted by the rule sortSamples owns -- by when the sample happened
  // rather than by when the row was typed -- so the file reads in the same order
  // as the card.
  const samples = sortSamples(evt.data).map(e => ({
    stage: sampleStageLabel(e.sample_stage) || '', date: e.sample_date || '',
    line: sampleLine(e), comment: (e.note || '').trim(),
    author: e.author || 'unknown', recorded: e.created_at, edited: !!e.edited_at,
  }));
  return { general: shape(gen.data, 'source'), sampling: shape(smp.data, 'kind'), samples };
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
const buildCardDoc = ({ r, general, sampling, samples, logo }) => {
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const p = r.products || {};
  const g = cardGroups(r);
  const LBL = 'font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#6b7280;';

  const cell = (l, v) => '<div style="border-right:2px solid #6b7280;border-bottom:2px solid #6b7280;padding:11px 13px;">'
    +'<div style="'+LBL+'">'+esc(l)+'</div>'
    +'<div style="font-size:13.5px;color:#111827;margin-top:5px;line-height:1.3;">'+esc(v)+'</div></div>';
  const kv = (l, v) => '<div style="display:flex;gap:14px;padding:7px 0;border-top:1px solid #e5e7eb;">'
    +'<div style="'+LBL+'flex:0 0 164px;padding-top:2px;">'+esc(l)+'</div>'
    +'<div style="font-size:13.5px;color:#111827;line-height:1.45;">'+esc(v)+'</div></div>';
  // pre-wrap rather than turning newlines into <br>. The note is stored with its
  // own line breaks and the screen renders it the same way, so the paper matches
  // what the person typed.
  const noteBlock = (heading, list, blank) => '<div style="margin-top:26px;">'
    +'<div style="'+LBL+'margin-bottom:8px;">'+esc(heading)+'</div>'
    +(list.length
      ? list.map(n => '<div style="border-top:1px solid #e5e7eb;padding:9px 0;">'
          +'<div style="font-size:13.5px;color:#111827;line-height:1.55;white-space:pre-wrap;">'+esc(n.text)+'</div>'
          +'<div class="mono" style="font-size:10.5px;color:#6b7280;margin-top:5px;">'
            +esc(n.author)+' · '+esc(stampText(n.date))
            +(n.edited ? ' · edited' : '')
            +(n.kind ? ' · ' + esc(n.kind) : '')
          +'</div></div>').join('')
      : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">'+esc(blank)+'</div>')
    +'</div>';

  const flow =
     '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:28px;">'
      +'<div style="min-width:0;">'
        +(logo
          ? '<img src="'+logo+'" alt="King Universal" style="height:46px;width:auto;display:block;">'
          : '<div style="font-size:21px;font-weight:700;letter-spacing:-.015em;color:#0c1322;line-height:1.1;">King Universal Inc.</div>')
      +'</div>'
      +'<div style="text-align:right;white-space:nowrap;">'
        +'<div style="font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0c1322;line-height:1.1;">PLM card</div>'
        +'<div class="mono" style="font-size:15px;color:#374151;margin-top:8px;">'+esc(p.sku || '—')+'</div>'
      +'</div>'
    +'</div>'
    +'<div style="height:2px;background:#0c1322;margin-top:18px;"></div>'
    +'<div style="margin-top:26px;">'
      +'<div style="font-size:22px;font-weight:600;letter-spacing:-.015em;color:#111827;line-height:1.25;">'+esc(p.name || '—')+'</div>'
      +'<div style="font-size:14px;color:#4b5563;margin-top:5px;">'+esc((r.client || {}).name || '—')+'</div>'
    +'</div>'
    // Three across, two down. Empty values already carry their own words from
    // cardGroups -- 'Not recorded' rather than a blank, so a gap reads as a fact
    // about the card instead of as a rendering fault.
    +'<div style="margin-top:28px;border-top:2px solid #6b7280;border-left:2px solid #6b7280;display:grid;grid-template-columns:repeat(3,1fr);">'
      +g.head.map(([l, v]) => cell(l, v)).join('')
    +'</div>'
    +'<div style="margin-top:30px;">'
      +'<div style="'+LBL+'margin-bottom:2px;">What the system knows</div>'
      +'<div style="font-size:11px;color:#6b7280;line-height:1.5;margin-bottom:6px;">'
        +'Reported from the records. None of it moved this card.</div>'
      +g.knows.map(([l, v]) => kv(l, v)).join('')
    +'</div>'
    // THE LOG COMES BEFORE THE NOTES because it is the record and they are the
    // commentary. Each entry is one line -- round, date and comment -- with the
    // person and the moment beneath it, which is the same shape the card uses.
    +'<div style="margin-top:26px;">'
      +'<div style="'+LBL+'margin-bottom:8px;">Sample log</div>'
      +((samples || []).length
        ? samples.map(s => '<div style="border-top:1px solid #e5e7eb;padding:9px 0;">'
            +'<div style="font-size:13.5px;color:#111827;line-height:1.55;">'+esc(s.line)+'</div>'
            +'<div class="mono" style="font-size:10.5px;color:#6b7280;margin-top:5px;">'
              +esc(s.author)+' · '+esc(stampText(s.recorded))+(s.edited ? ' · edited' : '')
            +'</div></div>').join('')
        : '<div style="border-top:1px solid #e5e7eb;padding:9px 0;font-size:13px;color:#6b7280;">'
          +esc(r.product_id ? 'No samples recorded.' : 'No product linked, so there is nothing to sample against.')
          +'</div>')
    +'</div>'
    +noteBlock('General notes', general, 'No notes.')
    +noteBlock('Sampling notes', sampling,
               r.product_id ? 'No notes.' : 'No product linked, so there is nothing to sample against.')
    +'<div style="margin-top:34px;padding-top:9px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:9.5px;color:#6b7280;">'
      +'<span>King Universal Inc. · PLM card · internal</span>'
      +'<span>Generated '+esc(stampText(new Date().toISOString()))+'</span>'
    +'</div>';

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">'
+'<meta name="viewport" content="width=device-width,initial-scale=1">'
+'<title>PLM Card — '+esc(p.sku || p.name || 'Program')+'</title>'
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
};

// Split out so the x can read guardedClose from context. The provider lives
// INSIDE Overlay, so a hook called in ProgramDetail would sit above it and get
// the default -- the close button has to be a child to be guarded.
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner, onProduct, onSample, onArchive, onTouched }) {
  const p = r.products || {};
  const guardedClose = useGuardedClose();
  // ── TWO TABS: WORKING THE CARD, AND WHAT IS KNOWN ABOUT IT ────────────────
  // Sampling is the 11 Aug card -- where the program is and what happens next:
  // the stage pills, Advance, the owner, the sample strip, the quick emails, the
  // notes and Remove. Named for the work most of it serves, on Riley word.
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
  const [tab, setTab] = useState('sampling');
  const CARD_TABS = [['sampling', 'Sampling'], ['card', 'Card']];
  const who = useCardContacts(r);
  const [emailTpl, setEmailTpl] = useState(null);

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
  const exportPdf = async () => {
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating PLM card…</body>');
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r);
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
      const html = buildCardDoc({ r, general: notes.general, sampling: notes.sampling,
                                  samples: notes.samples, logo });
      // The document prints itself once its fonts have landed, so nothing here
      // has to guess at a delay.
      if (win) { win.document.open(); win.document.write(html); win.document.close(); }
      else {
        // Popup blocked outright. The card is still built and still leaves as a
        // file, which is the same fallback the order confirmation takes.
        const url = URL.createObjectURL(new Blob([html], { type:'text/html' }));
        const a = document.createElement('a');
        a.href = url; a.download = fileBase(r) + '.html';
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
      const notes = await fetchCardNotes(r);
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VESSL'; wb.created = new Date();

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

      // SHEET 2 IS THE LOG, AND IT COMES BEFORE THE NOTES. Its own sheet rather
      // than rows in the notes table, because a sample event has a round and a
      // date of its own and those are not columns a note has -- sharing the table
      // would mean two empty columns on every note.
      const ss = wb.addWorksheet('Sample log');
      ss.addRow(['Stage', 'Date', 'Comment', 'Author', 'Recorded', 'Edited']);
      notes.samples.forEach(s =>
        ss.addRow([s.stage, excelDate(s.date), s.comment, s.author, excelDate(s.recorded), s.edited ? 'Yes' : '']));
      ss.getRow(1).font = { bold: true };
      ss.views = [{ state:'frozen', ySplit:1 }];
      ss.getColumn(2).numFmt = 'yyyy-mm-dd';
      ss.getColumn(5).numFmt = 'yyyy-mm-dd hh:mm';
      [13, 13, 60, 30, 19, 9].forEach((w, i) => { ss.getColumn(i + 1).width = w; });
      ss.getColumn(3).alignment = { wrapText: true, vertical: 'top' };

      // SHEET 3, BOTH NOTE SETS IN ONE TABLE with a Set column. Two sheets would
      // make a reader sorting by date merge them by hand, and the sets are two
      // halves of one conversation about the same product.
      const ns = wb.addWorksheet('Notes');
      ns.addRow(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note']);
      const push = (setName, list) => list.forEach(n =>
        // excelDate, so the cell is a real date and sorts as one. The CSV keeps
        // the text stamp -- the same split testing.jsx makes.
        ns.addRow([setName, n.kind, n.author, excelDate(n.date), n.edited ? 'Yes' : '', n.text]));
      push('General', notes.general);
      push('Sampling', notes.sampling);
      ns.getRow(1).font = { bold: true };
      ns.views = [{ state:'frozen', ySplit:1 }];
      ns.getColumn(4).numFmt = 'yyyy-mm-dd hh:mm';
      [13, 13, 30, 19, 9, 90].forEach((w, i) => { ns.getColumn(i + 1).width = w; });
      ns.getColumn(6).alignment = { wrapText: true, vertical: 'top' };

      const buf = await wb.xlsx.writeBuffer();
      downloadBlob(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                   fileBase(r) + '.xlsx');
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
      const notes = await fetchCardNotes(r);
      // EVERY field quoted, not just the ones that need it. A conditional quote
      // has to decide what "needs" means for a note holding a comma, a quote or a
      // newline, and that decision is where CSV writers go wrong.
      const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
      const p = r.products || {};
      const lines = [];
      lines.push(cell('# PLM card: ' + (p.sku || 'no SKU') + ' — ' + (p.name || '') + ' — ' + ((r.client || {}).name || '')));
      lines.push([cell('Field'), cell('Value')].join(','));
      cardFields(r).forEach(([label, value]) => lines.push([cell(label), cell(value)].join(',')));
      // ONE FILE, THREE TABLES, a blank line between them -- the CSV answer to the
      // workbook's extra sheets. Separate files would be two more for somebody to
      // lose. The log sits before the notes, as it does everywhere else.
      lines.push('');
      lines.push(['Sample log'].map(cell).join(','));
      lines.push(['Stage', 'Date', 'Comment', 'Author', 'Recorded', 'Edited'].map(cell).join(','));
      notes.samples.forEach(s => lines.push(
        [s.stage, s.date, s.comment, s.author, stampText(s.recorded), s.edited ? 'Yes' : ''].map(cell).join(',')));
      lines.push('');
      lines.push(['Set', 'Kind', 'Author', 'Date', 'Edited', 'Note'].map(cell).join(','));
      const push = (setName, list) => list.forEach(n => lines.push(
        [setName, n.kind, n.author, stampText(n.date), n.edited ? 'Yes' : '', n.text].map(cell).join(',')));
      push('General', notes.general);
      push('Sampling', notes.sampling);
      // CRLF and a BOM, both for Excel: without the BOM it reads the file as ANSI
      // and an accented name arrives mangled.
      const csv = '﻿' + lines.join('\r\n') + '\r\n';
      downloadBlob(new Blob([csv], { type:'text/csv;charset=utf-8;' }), fileBase(r) + '.csv');
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  // ── THE LADDER POSITION ───────────────────────────────────────────────────
  // A card with no stage is before the first rung, so Advance offers Quoting --
  // the same reading the PO rule takes of a null stage. Shipped is the last rung
  // and offers nothing, because there is nowhere further to go.
  const idx = MANUAL_STAGES.findIndex(([k]) => k === r.stage);
  const next = r.stage === SHIPPED ? null : (MANUAL_STAGES[idx + 1] || null);
  const inSampling = SAMPLING_STAGES.includes(r.stage);
  const emails = STAGE_EMAILS[r.stage] || [];
  const secHead = { fontSize:'11px', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase',
                    color:'#86868B', marginBottom:'9px' };

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>
            {[(r.client||{}).name, who.factoryName].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        <button onClick={guardedClose} aria-label="Close"
          style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                  cursor:'pointer',padding:'0 2px',fontFamily:'inherit',flexShrink:0}}>×</button>
      </div>

      {/* ── THE STAGE PILLS ─────────────────────────────────────────────────
          The 11 Aug row: the current stage in its colour, the ones already
          passed in a darker grey than the ones ahead. Every pill is a move, and
          every move goes through setStage, so a pill and Advance cannot write a
          stage two different ways. */}
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

      {/* ── ADVANCE, OWNER, AGE ─────────────────────────────────────────────
          One row, as on 11 Aug. The owner select is the staff list rather than
          a typed team, and changing it still writes its reassignment note.
          data-noguard because it saves the moment it changes -- there is nothing
          unsaved for the close guard to protect. */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'14px',flexWrap:'wrap'}}>
        {next && (
          <button onClick={()=>onStage(r, next[0])} disabled={busy}
            style={{background:'#0A84FF',color:'#fff',border:'none',borderRadius:'980px',padding:'8px 16px',
                    fontSize:'13px',fontWeight:600,fontFamily:'inherit',
                    cursor:busy?'default':'pointer',opacity:busy?0.6:1}}>
            Advance to {next[1]} →
          </button>
        )}
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
          {/* EXPORT HEADS THE CARD TAB. It writes out what this tab shows -- the
              records, the log and both note sets -- so it sits with them.

              count={1} is what keeps the pill live; the note under the menu says
              what is actually leaving. Disabled while a write is in flight, so a
              file cannot be built from a card that is mid-change. */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'10px',
                       marginTop:'14px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
            <span style={{fontSize:'11.5px',color:'#A0A0A4'}}>The card as a file, with its notes and sample log.</span>
            <ExportButton count={1} busy={exporting || busy} compact align="right"
              note="This card, with its notes"
              onPdf={exportPdf} onXlsx={exportXlsx} onCsv={exportCsv} />
          </div>
          <SystemKnows r={r} busy={busy} onProduct={onProduct} />
          {!r.product_id ? (
            <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE',
                         fontSize:'12.5px',color:'#A0A0A4'}}>
              This card has no product linked, so there is no sampling log to show.
            </div>
          ) : (
            <>
              {/* THE LOG FIRST, THE NOTES UNDER IT. The log is the record of what
                  happened and the notes are what somebody wants to say about it,
                  which is the order they are read in. */}
              <SampleLog productId={r.product_id} programId={r.id} userEmail={userEmail}
                         busy={busy} onTouched={onTouched} />
              {/* filter, because one table holds both -- see the note on the
                  panel. Without it every sample event would list here as a note. */}
              <NotesPanel table="product_notes" keyCol="product_id" keyId={r.product_id}
                insertExtra={{ kind: 'sampling' }} extraCol="kind" extraDefault="sampling"
                filter={{ col:'kind', val:'sampling' }}
                title="Sampling Notes" subtitle="Shared with every card for this product."
                programId={r.id} userEmail={userEmail} onTouched={onTouched} />
            </>
          )}
        </>
      ) : (
      <>
      {inSampling && <SampleStrip r={r} busy={busy} onSample={onSample} />}

      {/* ── QUICK EMAILS ────────────────────────────────────────────────────
          The templates for the stage the card is in. Absent rather than empty
          for a card with no stage, which has no templates. */}
      {emails.length > 0 && (
        <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
          <div style={secHead}>Quick emails</div>
          <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}>
            {emails.map((tpl, i) => (
              <button key={i} onClick={()=>setEmailTpl(tpl)} disabled={who.loading}
                title={who.loading ? 'Reading contacts…' : undefined}
                style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'8px 14px',
                        fontSize:'12.5px',fontWeight:500,color:'#1D1D1F',fontFamily:'inherit',
                        cursor:who.loading?'default':'pointer',opacity:who.loading?0.6:1}}>
                ✉ {tpl.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Between the emails and the notes, where the 11 Aug card had it. */}
      <Checklist r={r} staff={staff} userEmail={userEmail} onTouched={onTouched} />

      {/* author is the caller's EMAIL, inside NotesPanel. The 11 Aug card wrote
          a display name, and the restrictive policies compare lower(author) to
          the email in the token -- a name would insert and then be uneditable
          and undeletable by the person who wrote it. */}
      <NotesPanel table="program_notes" keyCol="program_id" keyId={r.id}
        insertExtra={{ source: 'manual' }} extraCol="source" extraDefault="manual"
        title="Notes" programId={r.id} userEmail={userEmail} onTouched={onTouched} />
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
        </div>
      )}
      </>
      )}
      {emailTpl && <EmailComposer tpl={emailTpl} r={r} who={who} staff={staff} onClose={()=>setEmailTpl(null)} />}
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
  const [ui, setUi] = usePageState('programs', { search:'', showRemoved:false, ownerSel:[], blocker:'' });
  const [openId, setOpenId] = useState(null);
  const [staff, setStaff] = useState([]);
  // Set while a stage or an owner is being written, so the control can say so and
  // refuse a second click. Not in the page store -- it is in-flight, not a choice.
  const [saving, setSaving] = useState(null);
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
  // product_id -> every sample event for it, filled in bulk by load(). Reduced to
  // the latest one per card in enriched below.
  const [samples, setSamples] = useState({});
  // program_id -> its checklist, every stage, filled in bulk by load().
  const [tasks, setTasks] = useState({});

  // QUIET AFTER THE FIRST READ. loading starts true and only the first load
  // shows the placeholder; every later one -- after a stage move, a note, a
  // sample -- swaps the rows in underneath. Setting it true again unmounted the
  // whole page, and the open card with it: the tab snapped back to Card, a
  // half-typed note elsewhere on the card was lost, and the page flashed.
  const load = async () => {
    setErr('');
    try {
      const [p, nt, se, q, poi, soi, tr, st, tk] = await Promise.all([
        // declared_stage and declared_stage_at are the board now -- the stage a
        // person set, and when they set it. owner_id joins staff_profiles for the
        // name on the card and the owner filter.
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
                + 'updated_at,updated_by,'
                // The sample strip, script 77. Without these on the board read the
                // overdue flag on a tile could never fire.
                + 'sample_round,master_sample_included,sample_sent_date,sample_due_back,'
                + 'products(id,sku,name,active,product_stage,compliance_status),client:companies!client_company_id(id,name),'
                + 'owner:staff_profiles!owner_id(id,email,full_name)')
          .order('created_at', { ascending:true }),
        // NOTE COUNTS IN BULK, because the expanded tile shows one. NotesPanel
        // still fetches the notes themselves when a modal opens -- this is the
        // count only, and fetching it per card would be one query per row.
        SB.from('program_notes').select('program_id'),
        // THE SAMPLE LOG, IN BULK. The card reports the latest sample and
        // SystemKnows renders synchronously from the row it is given, so the
        // events have to arrive with the board rather than when a card opens.
        // Every event for every product, which is one query rather than one per
        // card -- the same trade the note counts above make.
        SB.from('product_notes').select('product_id,sample_stage,sample_date,note,created_at')
          .eq('kind', 'sample_event'),
        SB.from('quotes').select('product_id,client_company_id,quote_date,created_at').not('product_id','is',null),
        SB.from('purchase_order_items')
          // estimated_departure joins the embed for the Shipping row, which falls
          // back to an ETD when nothing has actually left yet. shipmentsOf returns
          // whole shipment rows, so adding the column here is the entire data
          // change -- no second derivation.
          .select('product_id,purchase_orders(order_date,issued_at,client_company_id,client:companies!client_company_id(name),shipment_pos(shipments(actual_departure,estimated_departure,actual_arrival)))')
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
        // EVERY CHECKLIST, IN BULK. The tile's blocker pill, its health edge and
        // the three waiting tiles all read tasks, so they arrive with the board
        // rather than when a card opens -- the trade the note counts make.
        SB.from('program_tasks')
          .select('id,program_id,stage,task,owner_id,assigned_by,due_date,blocker,done,done_at,sort_order,created_at')
          .order('sort_order').order('created_at'),
      ]);
      const e = [p,nt,se,q,poi,soi,tr,st,tk].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
      setStaff(st.data || []);
      setTasks((tk.data || []).reduce((m, t) => { (m[t.program_id] = m[t.program_id] || []).push(t); return m; }, {}));
      setNoteCounts((nt.data || []).reduce((m, n) => { m[n.program_id] = (m[n.program_id] || 0) + 1; return m; }, {}));
      // Grouped by product and reduced to the latest, by the rule latestSampleOf
      // owns. Keyed as a string because product_id arrives as one everywhere else
      // this file compares it.
      setSamples((se.data || []).reduce((m, row) => {
        const k = String(row.product_id);
        (m[k] = m[k] || []).push(row);
        return m;
      }, {}));
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
      // ── SHIPPING, WHICH deriveEvents DOES NOT ANSWER ────────────────────
      // Its shipped event reads actual_departure only, because a lifecycle stage
      // is a thing that happened. The card wants the next best fact when nothing
      // has left yet, so this reads the same flattened shipments and prefers a
      // real departure over an estimate -- an ETD is a plan and must never be
      // shown as though the goods moved.
      //
      // Earliest rather than latest, matching every other date on the block.
      const ships = shipmentsOf(buckets.poItems[k] || []);
      const firstStamp = col => ships.map(s => s[col]).filter(Boolean).sort()[0] || null;
      const departedOn = firstStamp('actual_departure');
      const etdOn = departedOn ? null : firstStamp('estimated_departure');
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
               noteCount: noteCounts[r.id] || 0,
               tasks: tasks[r.id] || [],
               // The most recent sample for this PRODUCT, so two cards for the
               // same SKU report the same round -- which is the point of the log
               // hanging off the product rather than the program.
               latestSample: latestSampleOf(samples[String(r.product_id)] || []),
               // null when nothing has shipped and nothing is planned.
               shipping: departedOn ? { kind:'departed', on: departedOn }
                       : etdOn      ? { kind:'etd',      on: etdOn }
                       : null };
    });
    // staff and noteCounts are dependencies now: without them a name stays
    // unresolved and a count stays zero until some other change happens to
    // recompute this.
  }, [rows, buckets, staff, noteCounts, samples, tasks]);

  // ── WRITING A STAGE, AND WRITING AN OWNER ───────────────────────────────────
  // The only two things this page changes. Both re-read from the database after
  // the write, so what is on screen ends up being what is stored.
  //
  // A REASSIGNMENT WRITES ITS OWN NOTE, on Riley decision -- program_notes is
  // append-only by grant, so the record cannot be quietly tidied later. The note
  // is written after the update lands; a failed note leaves a correct owner and a
  // missing line, which is the better way round.

  // ONE FUNCTION, EVERY CALLER. The stage pills and the Advance-to button on the
  // card both come through here -- declared_stage_at is stamped by the same trigger whichever it is, a failure is
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
    await load();
    setSaving(null);
  };

  // ── SEEDING A STAGE'S CHECKLIST ─────────────────────────────────────────────
  // After the move lands, never before -- a refused move must not leave a
  // checklist behind for a stage the card is not in. Every stage move comes
  // through setStage, so a pill and Advance seed alike; 11 Aug seeded on Advance
  // only, which left a card moved by a pill with an empty checklist.
  //
  // ONCE PER STAGE, EVER. The test is whether this card has ANY task for the
  // stage, done or not, read from the database rather than from the board -- so
  // a card coming back to Sampling finds its old list, and a board that is a
  // second stale does not seed twice.
  //
  // A failed seed does not undo the move. The card is where somebody put it; the
  // toast says the list is missing, and tasks can still be added by hand.
  const seedStageTasks = async (r, stage) => {
    const list = STAGE_TASKS[stage];
    if (!list) return;
    const { count, error: ce } = await SB.from('program_tasks')
      .select('id', { count:'exact', head:true })
      .eq('program_id', r.id).eq('stage', stage);
    if (ce) { window._toast?.('The card moved, but its checklist could not be checked — ' + ce.message, 'err'); return; }
    if ((count || 0) > 0) return;
    const { error } = await SB.from('program_tasks').insert(list.map((task, i) => ({
      program_id: r.id, stage, task, owner_id: r.owner_id || null,
      assigned_by: userEmail || null, blocker: 'none', sort_order: i,
    })));
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
        program_id: r.id, author: userEmail || null, source: 'owner-change',
        note: 'Reassigned from ' + (r.ownerName || 'nobody') + ' to ' + nameOf(next) + ' by ' + (userEmail || 'unknown'),
      });
    } catch (e) {}
    await load(); setSaving(null);
  };

  // ── THE SAMPLE STRIP ────────────────────────────────────────────────────────
  // THE FOUR COLUMNS SCRIPT 77 ADDED, AND ONLY THOSE. The 11 Aug saveField
  // forwarded whatever patch it was handed to programs; this drops anything not
  // on the list, so a caller cannot reach the stage, the owner or archived by a
  // side door that skips their own rules and notes.
  //
  // Optimistic, for the reason setStage gives: a round counter that waits a round
  // trip before changing reads as a click that did not register.
  const setSampleFields = async (r, patch) => {
    const clean = Object.fromEntries(Object.entries(patch || {}).filter(([k]) => SAMPLE_FIELDS.includes(k)));
    if (!Object.keys(clean).length) return;
    const before = rows.find(x => x.id === r.id) || null;
    const stamp = { updated_at: new Date().toISOString(), updated_by: userEmail || null };
    setSaving(r.id);
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...clean, ...stamp } : x));
    const { error } = await SB.from('programs').update({ ...clean, ...stamp }).eq('id', r.id);
    if (error) {
      if (before) setRows(prev => prev.map(x => x.id === r.id ? before : x));
      window._toast?.('Could not save the sample — ' + error.message, 'err');
      setSaving(null);
      return;
    }
    await load();
    setSaving(null);
  };

  // ── TAKING A CARD OFF THE BOARD, AND PUTTING IT BACK ────────────────────────
  // One function for both directions, for the same reason setStage serves the
  // select and the drag -- two write paths for one column is how they drift.
  //
  // archived, NOT a delete. authenticated holds no DELETE on programs (measured,
  // relacl arw), so a delete would fail with permission denied even if one were
  // written -- but that is not why this archives. A card is the only record that
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

  // ── WRITING A PRODUCT FIELD FROM THE CARD ───────────────────────────────────
  // Stage, compliance, catalogue status and the sample date live on products, not
  // on the program, so these writes reach a table this page has only ever read.
  // authenticated holds UPDATE on products, measured, so the write is permitted --
  // the reason to be careful is what it MEANS rather than whether it lands.
  //
  // IT CHANGES EVERY CARD FOR THAT PRODUCT, and that is the point of the fields
  // being on the product. The card in front of somebody is the one that must not
  // read stale afterwards, so the program is stamped and the board re-reads --
  // which refreshes every other card for the same product at the same time.
  //
  // A product edit is a touch on the card, by the same argument a note is.
  const setProductField = async (r, patch) => {
    if (!r.product_id) { window._toast?.('This card has no product to edit', 'err'); return; }
    setSaving(r.id);
    const { error } = await SB.from('products').update(patch).eq('id', r.product_id);
    if (error) { window._toast?.('Could not save — ' + error.message, 'err'); setSaving(null); return; }
    try {
      await SB.from('programs')
        .update({ updated_at: new Date().toISOString(), updated_by: userEmail || null })
        .eq('id', r.id);
    } catch (e) {}
    await load(); setSaving(null);
  };

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

  // ownerOptions was the shape FilterSelect wanted. The chips read ownerCounts
  // and staff directly, so the intermediate list had nothing left to do.

  const ownerMatches = r => !ui.ownerSel.length || ui.ownerSel.includes(r.owner_id || 'none');
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
  const shownBoard   = useMemo(() => board.filter(r => matches(r) && ownerMatches(r) && blockerMatches(r)),
    [board, ui.search, ui.ownerSel, ui.blocker]);
  // The removed column reads the same two filters, so a search narrows it too --
  // which is the point, since finding one removed card is what it is for.
  const shownRemoved = useMemo(() => removed.filter(r => matches(r) && ownerMatches(r) && blockerMatches(r)),
    [removed, ui.search, ui.ownerSel, ui.blocker]);

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
  // THE EDGE IS HEALTH, NOT STAGE. The column heading already says the stage; the
  // edge says whether the card is moving, which is what a board is scanned for.
  // The bottom stripe that used to carry the stage colour is gone with the wrapped
  // grid -- inside a column every tile is in the same stage, so a stripe repeating
  // it on each one said nothing.
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
    return (
      <button onClick={()=>setOpenId(r.id)}
        title={HEALTH[h].label}
        style={{background:'#fff',borderRadius:'16px',padding:'15px 16px',border:'none',
                boxShadow:'0 1px 3px rgba(0,0,0,.05)',cursor:'pointer',textAlign:'left',
                display:'block',width:'100%',borderLeft:'3px solid '+HEALTH[h].color,
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
        {(r.days !== null && r.days !== undefined) || late || openHere > 0 || blk || r.noteCount > 0 || notReq || r.retired ? (
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'11px',flexWrap:'wrap'}}>
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

        <div style={{fontSize:'11px',marginTop:'9px',color:r.ownerName?'#B0B0B4':'var(--hot)'}}>
          {r.ownerName || 'Unowned'}
        </div>
      </button>
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
                                 busy={saving === openRow.id} onStage={setStage} onOwner={setOwner}
                                 onProduct={setProductField}
                                 onSample={setSampleFields}
                                 onArchive={setArchived}
                                 onTouched={load}
                                 onClose={()=>setOpenId(null)} />}

      <div style={{textAlign:'center',marginBottom:'18px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
        <div style={{fontSize:'13px',color:'#86868B',marginTop:'5px'}}>
          {board.length} on the board
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

      {/* ── OWNER CHIPS, FROM staff_profiles ─────────────────────────────────
          The 11 Aug row, with the hardcoded team replaced by the staff list the
          board already fetches. Multi-select rather than Riley single-select,
          because ownerSel is an array in the page store and narrowing to two
          people is a question somebody actually asks.

          Unowned is a chip with a count rather than an absence, on Riley word --
          a card with no owner is the one state worth surfacing. */}
      <div style={{display:'flex',gap:'6px',marginBottom:'18px',flexWrap:'wrap',alignItems:'center'}}>
        {(() => {
          const toggle = v => setUi('ownerSel', ui.ownerSel.includes(v)
            ? ui.ownerSel.filter(x => x !== v) : ui.ownerSel.concat([v]));
          const chip = (key, label, active, count, hot) => (
            <button key={key} onClick={key === '' ? () => setUi('ownerSel', []) : () => toggle(key)}
              style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',
                      cursor:'pointer',fontFamily:'inherit',boxShadow:'0 1px 2px rgba(0,0,0,.05)',
                      background:active ? '#1D1D1F' : '#fff',
                      color:active ? '#fff' : (hot && !active ? 'var(--hot)' : '#5A5A5E')}}>
              {label}{count === null ? '' : ' ' + count}
            </button>
          );
          return [
            chip('', 'Everyone', ui.ownerSel.length === 0, board.length, false),
            chip('none', 'Unowned', ui.ownerSel.includes('none'), ownerCounts.none || 0, true),
            ...staff.map(s => chip(s.id, s.full_name || s.email,
                                   ui.ownerSel.includes(s.id), ownerCounts[s.id] || 0, false)),
          ];
        })()}
        {(ui.ownerSel.length > 0 || ui.blocker) && (
          <span style={{fontSize:'12px',color:'#86868B',marginLeft:'4px'}}>{shownBoard.length} shown</span>
        )}
      </div>

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
          {columns.map(col => (
            <div key={col.key} style={{flex:'0 0 272px',minWidth:'272px'}}>
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
          ))}
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
