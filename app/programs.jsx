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
import { fmt, daysSince } from '@/lib/lifecycle';
// The three product option sets, shared with the Testing product modal so the two
// screens cannot offer different words for the same stored value.
import { COMPLIANCE_OPTS, CATALOGUE_OPTS, catalogueKey } from '@/lib/products';
import { resolveKuiIor, iorLabel } from '@/lib/ior';
// The export control Testing, Products and Codes already use. It owns the pill,
// the menu and the dismissal; the writers below are this page's business, which
// is the split that file states at the top of itself.
import { ExportButton } from '@/app/components/ExportButton';
// lib/excel.js, not an import of exceljs. The package is ~900KB and this file
// once carried its own copy of the loader -- see the note at the top of that
// file, which names programs.jsx as one of the two places it was written twice.
import { loadExcelJS, excelDate } from '@/lib/excel';
import { trackingUrl, findCarrier } from '@/lib/tracking';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';
import { seedStageTasks as seedTasksFor, syncProductStage, createProgram } from '@/lib/programs';
import { resolveQuoteLinks, existingCardFor, missingWords, existingCardMessage } from '@/lib/quoteCard';
import { CardOwnerPopup } from '@/app/components/CardOwnerPopup';
import { ownerIdForEmail } from '@/app/components/OwnerSelect';
// Sync from records is gone with the derived board -- nothing here creates a
// program any more. The quote-form tick is the only door.
// Tab, search, stage filter and the retired toggle survive going into a program and
// coming back, and are gone on reload. See the note at the top of lib/pageState.js.
import { usePageState } from '@/lib/pageState';
// The Testing tab reads a product by the Testing page's own rules (lib/testingStatus.js).
import { fmtDate, daysUntil, EXPIRY_WINDOW_DAYS, efilingKey, EFILING_LABEL,
         latestTestDateByProduct, testingDateOf } from '@/lib/testingStatus';
import { materialLabel } from '@/lib/materialLabel';
// The board's rules, its load and its derivation (lib/plmBoard.js), and a card
// as a file (lib/plmFiles.js), moved out of this file so the iPad view reads
// and exports a card exactly as this page does.
import { MANUAL_STAGES, ARCHIVED, VISIBLE_STAGES, isHiddenStage, SAMPLING_STAGES, accentOf,
         STALE_DAYS, HEALTH, CHECKLIST_ON, DUE_BACK_ON, STALLED_POSSIBLE, BLOCKERS, openTasks,
         latestRound, sampleOverdue, healthOf, sampleTypeLabel, sampleTypeOptions, cleanTypeLabel,
         SENT_BY_OPTS, sentByWords, packagesOf, pkgShips, pkgAny, roundText, sourceQuoteOf, okDate,
         STAGE_LABEL, stageLabel, optLabel, recordRows, suggestRow, staffName, loadBoardData, buildBuckets,
         enrichRows, tileFacts } from '@/lib/plmBoard';
import { stampText, fileBase, downloadBlob, shapeNotes, fetchCardNotes, cellText, styleLinks,
         buildBoardTables, boardFileBase, cardLogo, cardFileHtml, cardFileXlsx, cardFileCsv } from '@/lib/plmFiles';
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
//
// CARD NOTES ARE NO LONGER SCOPED (1 Oct). With the board down to Quoting,
// Sampling and Archived, folding a Sampling note away once a card is archived
// hid the record people most wanted. Card Notes pass labelOf instead, and every
// note says the stage it was written in. stageScoped is kept, unused, for a
// longer ladder.
//
// FOUR PROPS FOR ROUND NOTES (script 98), all optional, so General Notes pass
// nothing and behave as before.
//   nullCol      -- a column that must be NULL. Card Notes pass round_id, so a
//                   note on a live round shows under its round and not here.
//   selectExtra  -- more columns to read, comma-separated.
//   labelOf      -- a word or two after the date, from the note. Card Notes
//                   say the stage, or Round N for a note whose round was
//                   deleted (round_no stays when round_id is set to NULL).
//   reloadKey    -- re-read when it changes. Card Notes pass the round ids, so
//                   a deleted round's notes appear here at once.
//   quietExtras  -- values of extraCol not worth saying, extraDefault by default.
//   compact      -- the smaller form used inside a sample round.
function NotesPanel({ staff = [], table, keyCol, keyId, insertExtra = {}, extraCol, extraDefault,
                      filter = null, title, subtitle, programId, userEmail, onTouched,
                      stageScoped = false, stage = null,
                      nullCol = null, selectExtra = '', labelOf = null, reloadKey = '',
                      quietExtras = null, compact = false, newDraft, onNewDraft }) {
  const [notes, setNotes] = useState(null);
  // Per card-open, not remembered -- the same rule as Open elsewhere.
  const [showOther, setShowOther] = useState(false);
  // THE NEW-NOTE TEXT CAN BE HELD BY THE CALLER (newDraft, onNewDraft), so a round's
  // Save can add what is typed here and its Cancel can ask before dropping it.
  // Without them the panel keeps its own, as every other panel does.
  const [ownText, setOwnText] = useState('');
  const held = typeof onNewDraft === 'function';
  const text = held ? (newDraft || '') : ownText;
  const setText = held ? onNewDraft : setOwnText;
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
      .select('id,author,note,created_at,edited_at' + (extraCol ? ',' + extraCol : '') + (stageScoped ? ',stage' : '')
              + (selectExtra ? ',' + selectExtra : ''))
      .eq(keyCol, keyId);
    if (filter) qy = qy.eq(filter.col, filter.val);
    if (nullCol) qy = qy.is(nullCol, null);
    // NEWEST FIRST, always -- by when a note was written, so an edit never moves
    // it, and id breaks a tie between two notes stamped the same instant so they
    // keep one order. Every add, edit and delete re-reads through here (settle).
    const { data, error } = await qy.order('created_at', { ascending:false }).order('id', { ascending:false });
    if (error) { setErr(error.message); setNotes([]); return; }
    setNotes(data || []);
  };
  // Keyed on the row the notes belong to, not on the program -- the sampling panel
  // reloads when the product changes and the general one when the card does.
  useEffect(()=>{ setNotes(null); setEditId(null); load(); }, [table, keyId]);
  // A quiet re-read, without blanking the list, when the caller says the rows
  // behind it may have changed -- a round deleted, its notes now Card Notes.
  // The first value is the one the mount effect above already read for.
  const seenKey = useRef(reloadKey);
  useEffect(()=>{
    if (reloadKey === seenKey.current) return;
    seenKey.current = reloadKey;
    load();
  }, [reloadKey]);

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
                    {labelOf && labelOf(n) ? ' · ' + labelOf(n) : ''}
                    {extraCol && n[extraCol] && !(quietExtras || [extraDefault]).includes(n[extraCol]) ? ' · ' + n[extraCol] : ''}
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
    <div style={compact ? {marginTop:'10px',paddingTop:'9px',borderTop:'1px solid #F0F0F2'}
                        : {marginTop:'16px',paddingTop:'14px',borderTop:'1px solid #ECECEE'}}>
      <div style={{fontSize:compact?'10px':'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:subtitle?'3px':(compact?'6px':'9px')}}>{title}</div>
      {subtitle && (
        <div style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5,marginBottom:'9px'}}>{subtitle}</div>
      )}

      {/* SAVED NOTES FIRST, THEN THE BOX (12 Oct). Top to bottom: the label, the
          notes as listed (newest first, as load() orders them), any folded other
          stages, then the box and Add note. With nothing saved yet the box sits
          straight under the label, and the empty-state and Reading notes lines
          go under the box. On a round, the Edit form's Save, Cancel and Delete
          row stays below all of this -- SampleRounds renders it after the panel. */}
      {(() => {
        // This stage's notes, and notes with no stage; everything else is folded.
        const here  = !notes ? [] : stageScoped ? notes.filter(n => !n.stage || n.stage === stage) : notes;
        const other = !notes ? [] : stageScoped ? notes.filter(n => n.stage && n.stage !== stage) : [];
        const link = (label, onClick) => (
          <button onClick={onClick}
            style={{background:'none',border:'none',padding:0,fontSize:'11px',fontWeight:500,color:'#A0A0A4',
                    cursor:'pointer',fontFamily:'inherit',textDecoration:'underline',textUnderlineOffset:'2px'}}>{label}</button>
        );
        const above = here.length > 0 || other.length > 0;
        return (
          <>
            {here.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:'9px'}}>
                {here.map(renderNote)}
              </div>
            )}
            {other.length > 0 && !showOther && (
              <div style={{marginTop:here.length ? '12px' : 0,fontSize:'11.5px',color:'#B0B0B4'}}>
                {other.length} note{other.length === 1 ? '' : 's'} in other stages · {link('Show all', () => setShowOther(true))}
              </div>
            )}
            {other.length > 0 && showOther && (
              <div style={{marginTop:here.length ? '14px' : 0}}>
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

            <textarea data-noguard value={text} onChange={e=>setText(e.target.value)} rows={compact ? 1 : 2}
              placeholder={compact ? 'Add a note on this round' : 'Add a note — you can edit or delete your own notes later'}
              style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 11px',
                      fontSize:'13px',fontFamily:'inherit',outline:'none',resize:'vertical',
                      background:'#fff',boxSizing:'border-box',display:'block',marginTop:above ? '12px' : 0}} />
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
            ) : here.length === 0 && (
              <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'12px'}}>
                {other.length ? 'No notes in this stage.' : 'No notes yet.'}
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

function QuoteLinkValue({ link }) {
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      title="Open this quote on the Quotes page"
      style={{color:'#0A84FF',textDecoration:'underline',textUnderlineOffset:'2px',fontFamily:'var(--mono)'}}>{link.code}</a>
  );
}

// ── A TRACKING NUMBER, LINKED WHEN IT CAN BE ────────────────────────────────
// A new tab, noopener, and the click stops here so it never opens or closes
// the card behind it. Plain text when there is no url.
function TrackingLink({ number, url }) {
  if (!url) return <>{number}</>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
      title="Open the carrier's tracking page"
      style={{color:'#0A84FF',textDecoration:'underline',textUnderlineOffset:'2px'}}>{number}</a>
  );
}
// "FedEx · 1Z… · round 3" with each number linked -- the Card rows' words.
const ShipValue = ({ ship }) => (
  <>
    {ship.packages.map((k, i) => (
      <span key={i}>
        {i ? ' · ' : ''}{k.sentBy ? k.sentBy + (k.carrier || k.number ? ' · ' : '') : ''}
        {k.carrier}{k.carrier && k.number ? ' · ' : ''}
        {k.number ? <TrackingLink number={k.number} url={k.url} /> : null}
      </span>
    ))}
    {ship.round ? ' · round ' + ship.round : ''}
  </>
);

// ── SAMPLE ROUNDS ───────────────────────────────────────────────────────────
// SAVED ENTRIES, NOT LIVE FIELDS, on program_sample_rounds (script 80). The
// strip that wrote four programs columns on every change is gone; a round is
// filled in and saved, and then it is a record with who saved it and when.
//
// EVERY ROUND IS A SAMPLING ROUND (1 Oct, script 97). Revision folded into
// Sampling, so the one tab holds them all, newest first, and the form always
// offers the next round -- one past the highest saved, round 1 on a card with
// none. Every round is written with stage sampling; the CHECK still allows
// revision, which old rows were and the reverse script puts back.
//
// EACH ROUND IS ITS OWN SAVED ENTRY with its own Edit. An Archived card shows
// its rounds and lets them be corrected, but offers no new round -- sampling is
// over. Comment and Master sample came off the form; the columns stay in the
// table, unread. A round says what was sent with its sample type instead.
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
  const nextRound = Math.max(1, ...rounds.map(x => x.round + 1));
  const showForm = r.stage !== ARCHIVED;
  // ── THE ROUND NUMBER IS PICKED, NOT FIXED ─────────────────────────────────
  // The stepper starts at the next number and moves either way -- down to 1, up
  // with no ceiling -- stepping over any number a saved round on this card
  // already holds, so a missed round can be back-filled. roundPick is null until
  // somebody touches the arrows, and then the form uses it. The saved list
  // sorts by round number, so a back-filled round lands in its place.
  //
  // ON THE EDIT FORM TOO. A saved round can be renumbered, stepping over the
  // numbers the card's OTHER rounds hold. Its notes follow in the database --
  // trg_round_note_numbers (script 100) rewrites their round_no, which staff
  // could not do from here. Notes from a deleted round keep their number.
  const used = new Set(rounds.map(x => x.round));
  const [roundPick, setRoundPick] = useState(null);
  const chosen = roundPick ?? nextRound;
  // From n, the nearest free number below (null if none down to 1) and above.
  // taken is the set to step over -- every round for a new one, every round
  // but the one being edited for an edit.
  const freeBelow = (n, taken) => { for (let k = n - 1; k >= 1; k--) if (!taken.has(k)) return k; return null; };
  const freeAbove = (n, taken) => { let k = n + 1; while (taken.has(k)) k++; return k; };
  const takenBesides = id => new Set(rounds.filter(x => x.id !== id).map(x => x.round));

  // lab is the CARD'S testing lab, programs.testing_lab -- one per card, not per
  // round. It rides in the round form so it can be set while the card is being
  // worked in Sampling or Revision, prefilled with the card's value, and it is
  // written only when it changed. Every round form shows the same card value.
  // note is the new-round form only -- saved as the round's first round note.
  // sentBy2, carrier2 and tracking2 are package 2 (script 113).
  const blank = { type: '', sent: '', due: '', sentBy: '', carrier: '', tracking: '',
                  sentBy2: '', carrier2: '', tracking2: '', lab: r.testing_lab || '', note: '' };
  const [form, setForm] = useState(blank);
  const [editId, setEditId] = useState(null);
  const [edit, setEdit] = useState(blank);
  // The note typed under each round and not yet added, by round id, and a
  // counter per round that makes its notes panel re-read after Save adds one.
  const [noteDrafts, setNoteDrafts] = useState({});
  const [noteReads, setNoteReads] = useState({});
  const draftOf = id => noteDrafts[id] || '';
  const setDraftOf = (id, v) => setNoteDrafts(d => ({ ...d, [id]: v }));
  // The + Add New Sample Type form -- which round form opened it, and its text.
  const [typeFor, setTypeFor] = useState(null);     // 'form' | 'edit' | null
  const [typeName, setTypeName] = useState('');
  const [typeMsg, setTypeMsg] = useState('');
  const [typeBusy, setTypeBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // A new form for a card that moved stage, so a round half filled in before an
  // archive does not reappear when the card comes back.
  useEffect(() => { setForm(blank); setRoundPick(null); setEditId(null); setErr(''); setTypeFor(null); }, [r.id, r.stage]);
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
  // A note alone makes a round too -- somebody who wrote what was sent meant it
  // to be saved. The edit form has no note field, so it reads as empty there.
  const pkg2Any = f => !!(f.sentBy2 || f.carrier2.trim() || f.tracking2.trim());
  const hasAny = f => f.type || f.sent || (DUE_BACK_ON && f.due) || f.sentBy || f.carrier.trim() || f.tracking.trim()
                   || pkg2Any(f) || (f.note || '').trim();
  const datesOk = f => okDate(f.sent) && okDate(f.due);
  // master_sample and comment are not written -- an edit leaves whatever an old
  // round held in them exactly as it was.
  // due_back is written only while it is on. Off, it is left out of the payload
  // altogether, so an edit keeps whatever an old round held there.
  // sent_by is written only while the board found the column (script 112) --
  // before it is run, leaving it out lets every other field still save, and
  // sentByBlocked below refuses a save that would drop a Sent by somebody chose.
  // Package 2 likewise, on script 113 -- written only while the board found its
  // three columns, and pkg2Blocked refuses a save that would drop any of them.
  const values = f => ({
    sample_type: f.type || null, sent_date: f.sent || null,
    ...(DUE_BACK_ON ? { due_back: f.due || null } : {}),
    ...(r.sentByLive ? { sent_by: f.sentBy || null } : {}),
    carrier: f.carrier.trim() || null, tracking_number: f.tracking.trim() || null,
    ...(r.pkg2Live ? { sent_by_2: f.sentBy2 || null, carrier_2: f.carrier2.trim() || null,
                       tracking_number_2: f.tracking2.trim() || null } : {}),
  });
  const SENT_BY_NOT_YET = 'Sent by cannot be saved yet: the database does not have it (script 112 has not been run). Set Sent by back to — to save the rest.';
  const sentByBlocked = f => !r.sentByLive && !!f.sentBy;
  const PKG2_NOT_YET = 'The second row cannot be saved yet: the database does not have it (script 113 has not been run). Clear the second row to save the rest.';
  const pkg2Blocked = f => !r.pkg2Live && pkg2Any(f);
  const unchanged = (x, f) => {
    const v = values(f);
    return (f.round === undefined || f.round === x.round)
        && v.sample_type === (x.sample_type || null) && v.sent_date === (x.sent_date || null)
        && (!DUE_BACK_ON || v.due_back === (x.due_back || null))
        && (f.sentBy || null) === (x.sent_by || null)
        && v.tracking_number === (x.tracking_number || null)
        && (v.carrier || '').toLowerCase() === (x.carrier || '').toLowerCase()
        && (f.sentBy2 || null) === (x.sent_by_2 || null)
        && (f.tracking2.trim() || null) === (x.tracking_number_2 || null)
        && f.carrier2.trim().toLowerCase() === (x.carrier_2 || '').toLowerCase();
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
  // card closes without asking; input left unsaved still asks. The note counts
  // through hasAny, and a round number moved off its default counts too.
  const editing = editId ? rounds.find(x => x.id === editId) : null;
  useDirtySource((!!typeFor && !!cleanTypeLabel(typeName))
              || (showForm && (!!hasAny(form) || labChanged(form) || (roundPick !== null && roundPick !== nextRound)))
              || (!!editing && (!unchanged(editing, edit) || labChanged(edit))));

  // THE NEW-ROUND FORM SAVES A ROUND, THE LAB, OR BOTH. A round needs one of its
  // own fields; the lab alone does not make a round, so a form holding only a
  // changed lab saves just the lab and says so on its button (Save testing lab).
  // The round goes first, then its note, then the lab, each only once the one
  // before has landed.
  //
  // THE NOTE IS THE ROUND'S FIRST ROUND NOTE, written exactly as the round's own
  // notes panel writes one -- round_id and round_no of the round just saved,
  // stage sampling, source round, the caller as author. If the round lands and
  // the note does not, the round stands, the toast says so, and the note text
  // stays in the box rather than being lost with the rest of the form.
  const save = async () => {
    const withRound = !!hasAny(form), withLab = labChanged(form);
    if (!withRound && !withLab) return;
    if (withRound && !datesOk(form)) { setErr('Check the dates — each needs a full year from 2000 on.'); return; }
    if (withRound && sentByBlocked(form)) { setErr(SENT_BY_NOT_YET); return; }
    if (withRound && pkg2Blocked(form)) { setErr(PKG2_NOT_YET); return; }
    // Said plainly here rather than left to the unique constraint's error.
    if (withRound && used.has(chosen)) {
      setErr('Round ' + chosen + ' is already saved on this card. Pick another number with the arrows.');
      return;
    }
    const roundNo = chosen;
    const noteText = (form.note || '').trim();
    setBusy(true); setErr('');
    let noteKept = '';
    if (withRound) {
      const { data: made, error } = await SB.from('program_sample_rounds').insert({
        program_id: r.id, stage: 'sampling', round: roundNo,
        ...values(form), created_by: userEmail || null,
      }).select('id').single();
      if (error) {
        setBusy(false);
        if (error.code === '23505') {
          setErr('Round ' + roundNo + ' was just saved by somebody else. The list has been refreshed — check it before saving again.');
          if (onTouched) await onTouched();
        } else setErr(error.message);
        return;
      }
      if (noteText) {
        const { error: ne } = await SB.from('program_notes').insert({
          program_id: r.id, author: userEmail || null, source: 'round', stage: 'sampling',
          round_id: made.id, round_no: roundNo, note: noteText,
        });
        if (ne) {
          noteKept = noteText;
          window._toast?.('Round ' + roundNo + ' was saved, but its note was not — ' + ne.message, 'err');
          setErr('Round ' + roundNo + ' was saved, but its note was not. The note is still in the box — add it under round ' + roundNo + '.');
        }
      }
    }
    if (withLab) {
      const labErr = await saveLab(form);
      if (labErr) {
        setErr((withRound ? 'Round ' + roundNo + ' was saved, but the testing lab was not — ' : 'Could not save the testing lab — ') + labErr);
        await settle(); setBusy(false); return;
      }
    }
    setForm({ ...blank, lab: form.lab.trim(), note: noteKept });
    if (withRound) setRoundPick(null);
    await settle();
    setBusy(false);
  };

  const startEdit = x => {
    setEditId(x.id); setErr('');
    setEdit({ round: x.round, type: x.sample_type || '',
              sent: x.sent_date || '', due: x.due_back || '', sentBy: x.sent_by || '', carrier: x.carrier || '',
              tracking: x.tracking_number || '', sentBy2: x.sent_by_2 || '', carrier2: x.carrier_2 || '',
              tracking2: x.tracking_number_2 || '', lab: r.testing_lab || '' });
  };

  // Asked once, and there is no undo -- the round row is gone. ITS NOTES ARE NOT
  // (script 98). The foreign key sets their round_id to NULL and they keep
  // round_no, so they move to Card Notes labelled Round N. The confirm counts
  // them first so it can say so; a failed count just leaves the number out.
  const removeRound = async x => {
    const { count } = await SB.from('program_notes')
      .select('id', { count: 'exact', head: true }).eq('round_id', x.id);
    const kept = count > 0
      ? ' Its ' + count + ' note' + (count === 1 ? '' : 's') + ' will be kept as Card Notes, labelled Round ' + x.round + '.'
      : ' Any notes on it will be kept as Card Notes.';
    if (!window.confirm('Delete round ' + x.round + '?' + kept + " The round itself can't be brought back.")) return;
    setBusy(true); setErr('');
    const { error } = await SB.from('program_sample_rounds').delete().eq('id', x.id);
    if (error) { setBusy(false); setErr(error.message); return; }
    setEditId(null);
    await settle();
    setBusy(false);
  };
  // ── SAVE ADDS THE NOTE TOO ────────────────────────────────────────────────
  // Text left in the round's note box when Save is pressed is meant to be kept,
  // so it is added as a round note in the same action, under the round's number
  // as saved -- the new one if this Save renumbers it. The round goes first; if
  // it lands and the note does not, the round stands, the toast says so and the
  // text stays in the box. Add note on its own is unchanged.
  const addDraftNote = async (x, roundNo) => {
    const body = draftOf(x.id).trim();
    if (!body) return true;
    const { error } = await SB.from('program_notes').insert({
      program_id: r.id, author: userEmail || null, source: 'round', stage: 'sampling',
      round_id: x.id, round_no: roundNo, note: body,
    });
    if (error) {
      window._toast?.('Round ' + roundNo + ' was saved, but its note was not — ' + error.message, 'err');
      return false;
    }
    setDraftOf(x.id, '');
    setNoteReads(m => ({ ...m, [x.id]: (m[x.id] || 0) + 1 }));
    return true;
  };

  // CANCEL ASKS when the note box still holds text, in the words the close
  // guard uses, and clears it if told to go ahead.
  const cancelEdit = x => {
    if (draftOf(x.id).trim()
        && !window.confirm('You have unsaved changes in this form.\n\nDiscard them and close?')) return;
    setDraftOf(x.id, '');
    setEditId(null); setErr('');
  };

  const saveEdit = async x => {
    if (!datesOk(edit)) { setErr('Check the dates — each needs a full year from 2000 on.'); return; }
    if (sentByBlocked(edit)) { setErr(SENT_BY_NOT_YET); return; }
    if (pkg2Blocked(edit)) { setErr(PKG2_NOT_YET); return; }
    const renumbered = edit.round !== x.round;
    // The same plain words as the new-round form, before the unique constraint
    // would refuse it.
    if (renumbered && takenBesides(x.id).has(edit.round)) {
      setErr('Round ' + edit.round + ' is already saved on this card. Pick another number with the arrows.');
      return;
    }
    const v = { ...values(edit), ...(renumbered ? { round: edit.round } : {}) };
    // Nothing changed is a cancel, not a write -- an edited stamp for an edit
    // that changed nothing would be a false record. A changed lab alone writes
    // the card and leaves the round, and its edited stamp, untouched.
    const roundChanged = !unchanged(x, edit), withLab = labChanged(edit);
    const withNote = !!draftOf(x.id).trim();
    if (!roundChanged && !withLab && !withNote) { setEditId(null); return; }
    setBusy(true); setErr('');
    if (roundChanged) {
      const { error } = await SB.from('program_sample_rounds')
        .update({ ...v, updated_by: userEmail || null, updated_at: new Date().toISOString() })
        .eq('id', x.id);
      if (error) {
        setBusy(false);
        if (error.code === '23505') {
          setErr('Round ' + edit.round + ' was just saved by somebody else. The list has been refreshed — pick another number.');
          if (onTouched) await onTouched();
        } else setErr(error.message);
        return;
      }
    }
    if (withLab) {
      const labErr = await saveLab(edit);
      if (labErr) {
        setErr((roundChanged ? 'Round ' + edit.round + ' was saved, but the testing lab was not — ' : 'Could not save the testing lab — ') + labErr);
        await settle(); setBusy(false); return;
      }
    }
    await addDraftNote(x, renumbered ? edit.round : x.round);
    setEditId(null);
    await settle();
    setBusy(false);
  };

  const inp = { width:'100%', border:'1px solid rgba(0,0,0,.1)', borderRadius:'10px', padding:'8px 10px',
                fontSize:'13px', outline:'none', fontFamily:'inherit', boxSizing:'border-box', background:'#fff' };
  const lbl = { display:'block', fontSize:'10px', fontWeight:600, textTransform:'uppercase',
                letterSpacing:'.06em', color:'#86868B', marginBottom:'5px' };
  // The height of the Sample type select, which the round number is centred
  // against so the two sit on one line.
  const ROW_H = '34px';
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
  // ── THE CARRIER DROPDOWN ─────────────────────────────────────────────────
  // Every carrier company by name, a dash for none, and + Add new carrier… at
  // the foot, which opens the New Company form set to Carrier -- the quote
  // form's + Add new factory pattern. A stored carrier that is not on the list
  // -- typed before carriers were companies -- stays selected as an extra option
  // marked not in list, so opening a round never blanks it. A stored name
  // matching a carrier in another case (Fedex) selects that carrier and is not
  // counted as a change.
  const activeCarriers = [...(r.carriers || [])].sort((a, b) => a.name.localeCompare(b.name));
  // addFor is the form AND the package -- form, edit, form2 or edit2 -- so the
  // carrier made through + Add new carrier… lands in the row that asked.
  const [addFor, setAddFor] = useState(null);   // 'form' | 'edit' | 'form2' | 'edit2' | null
  const pick = (tag, name) => (tag.startsWith('form') ? setForm : setEdit)(f =>
    ({ ...f, [tag.endsWith('2') ? 'carrier2' : 'carrier']: name }));
  // The company form reports the row it saved, always a carrier -- it opens
  // with the type fixed to Carrier -- and that carrier is selected.
  const onCarrierCreated = async (type, co) => {
    const which = addFor;
    setAddFor(null);
    if (!co) return;
    pick(which, co.name);
    if (onTouched) await onTouched();
  };
  // slot is '' for package 1 and '2' for package 2.
  const carrierSelect = (f, which, slot = '') => {
    const tag = which + slot;
    const val = f['carrier' + slot];
    const hit = findCarrier(activeCarriers, val);
    const unlisted = val.trim() && !hit;
    return (
      <>
        <select data-noguard value={hit ? hit.name : val} disabled={busy}
          aria-label={slot ? 'Carrier, second package' : 'Carrier, first package'}
          onChange={e => {
            if (e.target.value === '__add__') { setAddFor(tag); return; }
            pick(tag, e.target.value);
          }}
          style={{...inp,cursor:busy?'default':'pointer'}}>
          <option value="">—</option>
          {activeCarriers.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          {unlisted && <option value={val}>{val} (not in list)</option>}
          <option value="__add__">+ Add new carrier…</option>
        </select>
        {/* THE NEW COMPANY FORM, set to Carrier. It is a modal of its own and
            marks its own card, so this card's close guard leaves its fields
            alone; the wrapper stops its clicks reaching the card behind. */}
        {addFor === tag && (
          <div onClick={e => e.stopPropagation()}>
            <CreateCompanyModal initialType="carrier"
              onClose={() => setAddFor(null)} onCreated={onCarrierCreated} />
          </div>
        )}
      </>
    );
  };

  // ── + ADD NEW SAMPLE TYPE ─────────────────────────────────────────────────
  // (Shown as "+ Add New Sample Type…", title case, on both round forms.)
  // The last option in the dropdown opens a one-field form under it. The name is
  // cleaned (cleanTypeLabel) and checked against the list ignoring case first:
  // a name already there is simply selected, and says so. Otherwise it is
  // inserted -- label and created_by, all staff may (script 102) -- and the new
  // type is selected in the form that asked for it, then the board re-reads so
  // every card offers it. The database refuses the same name in another case
  // too (unique on lower(label)); if a colleague added it a moment earlier, the
  // list is re-read and that one is selected. Nothing is saved on the ROUND
  // until the round itself is saved.
  const openAddType = which => { setTypeFor(which); setTypeName(''); setTypeMsg(''); };
  const pickType = (which, key) => (which === 'form' ? setForm : setEdit)(f => ({ ...f, type: key }));
  const addType = async () => {
    const which = typeFor;
    const label = cleanTypeLabel(typeName);
    if (!label) { setTypeMsg('Type a name first.'); return; }
    if (label.length > 60) { setTypeMsg('Keep it to 60 characters.'); return; }
    const same = (r.sampleTypes || []).find(t => t.label.toLowerCase() === label.toLowerCase());
    if (same) {
      pickType(which, same.key);
      setTypeFor(null);
      window._toast?.(same.active ? '“' + same.label + '” is already in the list — selected it'
                                  : '“' + same.label + '” exists but is retired, so it was not added again', same.active ? 'ok' : 'err');
      return;
    }
    setTypeBusy(true); setTypeMsg('');
    const { data, error } = await SB.from('sample_types')
      .insert({ label, created_by: userEmail || null })
      .select('key,label').single();
    if (error) {
      if (error.code === '23505') {
        if (onTouched) await onTouched();
        setTypeBusy(false);
        setTypeMsg('“' + label + '” was just added by somebody else — pick it from the list.');
        return;
      }
      setTypeBusy(false);
      setTypeMsg(error.message);
      return;
    }
    pickType(which, data.key);
    setTypeFor(null);
    setTypeBusy(false);
    window._toast?.('Sample Type “' + data.label + '” added', 'ok');
    if (onTouched) await onTouched();
  };

  const fields = (f, set, roundNo, which) => (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'14px'}}>
      <div style={{textAlign:'center'}}>
        <span style={lblMid}>Sample round</span>
        {/* A stepper on both forms. The new-round form steps over every saved
            number and keeps its pick in roundPick; an edit steps over the
            card's other rounds and keeps it in the edit state. The number sits
            in a box as tall as the Sample type select, so it is on that line. */}
        {(() => {
          const taken = which === 'form' ? used : takenBesides(editId);
          const setNo = which === 'form' ? setRoundPick : (n => set({ ...f, round: n }));
          const down = freeBelow(roundNo, taken);
          const arrow = on => ({ background:'none', border:'none', padding:'0 8px', fontSize:'16px',
                                 lineHeight:1, fontFamily:'inherit', color:on ? '#1D1D1F' : '#D1D1D6',
                                 cursor:on && !busy ? 'pointer' : 'default' });
          return (
            <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:ROW_H}}>
              <button type="button" aria-label="Lower round number" disabled={busy || down === null}
                onClick={()=>{ if (down !== null) setNo(down); }} style={arrow(down !== null)}>‹</button>
              <span style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',fontVariantNumeric:'tabular-nums',
                            minWidth:'22px',textAlign:'center'}}>{roundNo}</span>
              <button type="button" aria-label="Higher round number" disabled={busy}
                onClick={()=>setNo(freeAbove(roundNo, taken))} style={arrow(true)}>›</button>
            </div>
          );
        })()}
      </div>
      <div style={{gridColumn:'span 2'}}>
        {/* A dash is Not set, which is what every round saved before script 97
            reads, and choosing it again clears a type picked by mistake. */}
        <span style={lbl}>Sample type</span>
        <select data-noguard value={f.type} disabled={busy} aria-label="Sample type"
          onChange={e=>{
            if (e.target.value === '__add_type__') { openAddType(which); return; }
            set({ ...f, type: e.target.value });
          }}
          style={{...inp,height:ROW_H,cursor:busy?'default':'pointer',color:f.type?'#1D1D1F':'#86868B'}}>
          <option value="">—</option>
          {sampleTypeOptions(r.sampleTypes, f.type).map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          <option value="__add_type__">+ Add New Sample Type…</option>
        </select>
        {typeFor === which && (
          <div style={{marginTop:'6px'}}>
            <span style={lbl}>Add New Sample Type</span>
            <div style={{display:'flex',gap:'6px'}}>
              <input data-noguard autoFocus value={typeName} disabled={typeBusy} aria-label="New Sample Type name"
                placeholder="New Sample Type" maxLength={80}
                onChange={e=>{ setTypeName(e.target.value); if (typeMsg) setTypeMsg(''); }}
                onKeyDown={e=>{ if (e.key === 'Enter') { e.preventDefault(); addType(); }
                                if (e.key === 'Escape') { e.preventDefault(); setTypeFor(null); } }}
                style={{...inp,flex:1}} />
              <button type="button" onClick={addType} disabled={typeBusy || !cleanTypeLabel(typeName)}
                style={pillBtn(!!cleanTypeLabel(typeName), typeBusy || !cleanTypeLabel(typeName))}>
                {typeBusy ? 'Adding…' : 'Add Sample Type'}</button>
              <button type="button" onClick={()=>setTypeFor(null)} disabled={typeBusy}
                style={{...pillBtn(false, typeBusy),background:'#fff',border:'1px solid #E5E5EA',color:'#5A5A5E'}}>Cancel</button>
            </div>
            {typeMsg && <div style={{fontSize:'11.5px',color:'var(--hot)',marginTop:'5px'}}>{typeMsg}</div>}
          </div>
        )}
      </div>
      <div>
        <span style={lbl}>Sent</span>
        <input type="date" data-noguard value={f.sent} disabled={busy} style={inp} aria-label="Sent"
          onChange={e=>set({ ...f, sent: e.target.value })} />
      </div>
      {/* Off with DUE_BACK_ON; the grid is auto-fit, so the fields after it
          close up with no gap. */}
      {DUE_BACK_ON && (
        <div>
          <span style={lbl}>Due back</span>
          <input type="date" data-noguard value={f.due} disabled={busy} style={inp} aria-label="Due back"
            onChange={e=>set({ ...f, due: e.target.value })} />
        </div>
      )}
      {/* Two packages, each a row of Sent by, carrier and number in the order
          the entry line reads them, one under the other with no caption (script
          113) -- the aria-labels say first and second package. Sent by is a
          dash for Not set (script 112), KUI or Lab, in black like Carrier.
          The carrier is picked from the list; the number is free text, as it is
          on the label. Both rows are optional. */}
      {['', '2'].map(slot => (
        <div key={slot || '1'} style={{gridColumn:'1 / -1'}}>
          <div style={{display:'grid',gridTemplateColumns:'minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)',gap:'14px'}}>
            <div>
              <span style={lbl}>Sent by</span>
              <select data-noguard value={f['sentBy' + slot]} disabled={busy}
                aria-label={slot ? 'Sent by, second package' : 'Sent by, first package'}
                onChange={e=>set({ ...f, ['sentBy' + slot]: e.target.value })}
                style={{...inp,cursor:busy?'default':'pointer'}}>
                <option value="">—</option>
                {SENT_BY_OPTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </div>
            <div>
              <span style={lbl}>Carrier</span>
              {carrierSelect(f, which, slot)}
            </div>
            <div>
              <span style={lbl}>Tracking #</span>
              <input data-noguard value={f['tracking' + slot]} disabled={busy} style={inp}
                aria-label={slot ? 'Tracking number, second package' : 'Tracking number, first package'}
                placeholder="Optional" onChange={e=>set({ ...f, ['tracking' + slot]: e.target.value })} />
            </div>
          </div>
        </div>
      ))}
      {/* The CARD'S lab, not this round's -- the caption says so, because a field
          inside a round form reads as part of the round otherwise. */}
      <div style={{gridColumn:'1 / -1'}}>
        <span style={lbl}>Testing lab <span style={{textTransform:'none',letterSpacing:0,fontWeight:500,color:'#A0A0A4'}}>· for this card</span></span>
        <input data-noguard value={f.lab} disabled={busy} style={inp} aria-label="Testing lab"
          placeholder="Optional" onChange={e=>set({ ...f, lab: e.target.value })} />
      </div>
      {/* Saved as this round's first round note. The box the round notes panel
          uses, so the note looks the same before and after it is saved. */}
      {which === 'form' && (
        <div style={{gridColumn:'1 / -1'}}>
          <span style={lbl}>Note</span>
          <textarea data-noguard value={f.note} disabled={busy} rows={1} aria-label="Note"
            placeholder="Optional — saved as this round's first note"
            onChange={e=>set({ ...f, note: e.target.value })}
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 11px',
                    fontSize:'13px',fontFamily:'inherit',outline:'none',resize:'vertical',
                    background:'#fff',boxSizing:'border-box'}} />
        </div>
      )}
    </div>
  );

  const entry = x => {
    const editing = editId === x.id;
    const isLatestLate = late && latest && latest.id === x.id;
    return (
      <div key={x.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
        <div style={{display:'flex',alignItems:'baseline',gap:'8px',flexWrap:'wrap'}}>
          {!editing && (
            <span style={{fontSize:'13px',fontWeight:500,color:'#1D1D1F'}}>
              {/* The round in words, then its shipment with the number linked --
                  the same order roundText(x, true) writes in text. Who sent it
                  leads each package, and says nothing when not set. Each package
                  with anything set, in order, its number linked through its own
                  carrier (script 113). */}
              {roundText(x)}
              {packagesOf(x).filter(pkgAny).map((k, i) => (
                <span key={i}>
                  {' · '}{sentByWords(k.sentBy)}{sentByWords(k.sentBy) && pkgShips(k) ? ' · ' : ''}
                  {pkgShips(k) && <>{k.carrier ? k.carrier + (k.number ? ' ' : '') : 'tracking '}
                    {k.number ? <TrackingLink number={k.number}
                                  url={trackingUrl(k.carrier, k.number, r.carriers)} /> : null}</>}
                </span>
              ))}
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
            {fields(edit, setEdit, edit.round ?? x.round, 'edit')}
          </div>
        ) : (
          <>
            <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'5px'}}>
              Saved by <span style={{fontWeight:600,color:'#5A5A5E'}}>{staffName(staff, x.created_by) || 'unknown'}</span> · {when(x.created_at)}
              {x.updated_at && <> · edited by <span style={{fontWeight:600,color:'#5A5A5E'}}>{staffName(staff, x.updated_by) || 'unknown'}</span> · {when(x.updated_at)}</>}
            </div>
          </>
        )}
        {/* THE ROUND'S OWN NOTES (script 98) -- Card Notes in shape, keyed on the
            round. Each carries the card, the stage and the round number, so it
            still reads as this round if the round is deleted.

            OUTSIDE THE EDIT SWITCH, so it stays mounted and on screen while the
            round's Edit form is open: adding a note there neither closes the
            form nor loses what is typed in it. The edit state lives in
            SampleRounds and survives the board reload a note triggers. The
            number is the SAVED one -- an unsaved renumber is not the round's
            number yet, and script 100 moves the note if the renumber is saved. */}
        <NotesPanel staff={staff} table="program_notes" keyCol="round_id" keyId={x.id}
          insertExtra={{ program_id: r.id, source: 'round', stage: 'sampling', round_no: x.round }}
          extraCol="source" extraDefault="round" compact
          newDraft={draftOf(x.id)} onNewDraft={v => setDraftOf(x.id, v)}
          reloadKey={noteReads[x.id] ? x.id + '-' + noteReads[x.id] : ''}
          title={'Round ' + x.round + ' notes'} programId={r.id} userEmail={userEmail} onTouched={onTouched} />
        {/* SAVE, CANCEL AND DELETE CLOSE THE ROUND'S BOX while it is being
            edited -- under the fields and under its notes, so Save is the last
            thing and takes a typed note with it (saveEdit). */}
        {editing && (
          <div style={{display:'flex',gap:'7px',marginTop:'12px'}}>
            <button onClick={()=>saveEdit(x)} disabled={busy} style={pillBtn(true, busy)}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button onClick={()=>cancelEdit(x)} disabled={busy}
              style={{...pillBtn(false, busy),background:'#fff',border:'1px solid #E5E5EA',color:'#5A5A5E'}}>Cancel</button>
            {/* The quiet red link the card uses for Delete card, at the far end
                so it is not the button a hand lands on after Save. */}
            <button onClick={()=>removeRound(x)} disabled={busy}
              style={{marginLeft:'auto',fontSize:'11.5px',background:'none',border:'none',padding:0,
                      color:'var(--hot)',fontFamily:'inherit',cursor:busy?'default':'pointer'}}>Delete</button>
          </div>
        )}
      </div>
    );
  };

  // Newest first. The board reads rounds highest round first, and the order is
  // stated again here so the list does not depend on how it was fetched.
  const list = [...rounds].sort((a, b) => b.round - a.round);
  return (
    <div style={{background:'#F5F5F7',borderRadius:'16px',padding:'16px 18px',marginTop:'16px'}}>
      <div style={{fontSize:'11px',fontWeight:600,letterSpacing:'.08em',textTransform:'uppercase',
                   color:'#86868B',marginBottom:'10px',textAlign:'center'}}>Sample rounds</div>
      {showForm && (
        <>
          {fields(form, setForm, chosen, 'form')}
          <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'10px'}}>
            <button onClick={save} disabled={busy || !(hasAny(form) || labChanged(form)) || editId !== null}
              style={pillBtn((hasAny(form) || labChanged(form)) && editId === null,
                             busy || !(hasAny(form) || labChanged(form)) || editId !== null)}>
              {busy && editId === null ? 'Saving…'
                : !hasAny(form) && labChanged(form) ? 'Save testing lab' : 'Save round ' + chosen}
            </button>
          </div>
        </>
      )}
      {err && <div style={{fontSize:'11.5px',color:'var(--hot)',marginTop:'8px'}}>{err}</div>}
      {list.length > 0 && (
        <div style={{marginTop:showForm?'14px':0,display:'flex',flexDirection:'column',gap:'8px'}}>
          {list.map(entry)}
        </div>
      )}
      {!list.length && !showForm && (
        <div style={{fontSize:'12px',color:'#A0A0A4'}}>No sample rounds were saved.</div>
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
  const elsewhere = tasks.filter(t => t.stage !== r.stage && !t.done && !isHiddenStage(t.stage));
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
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onLab, onArchive, onDelete, onClose, onTouched, canOpenTesting }) {
  return (
    // Wider than it was, because the card carries two tabs now. Still inside the
    // range the other modals in this app use, 420 through 640.
    <Overlay onClose={onClose} maxWidth={720}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy}
                   onStage={onStage} onOwner={onOwner} onLab={onLab}
                   onArchive={onArchive} onDelete={onDelete} onTouched={onTouched}
                   canOpenTesting={canOpenTesting} />
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
  // ev, sampled, ship and the 'Nothing recorded' fallback all moved into
  // recordRows, which this block and all three exports now read from.
  //
  // The key is on the row itself because these arrive as an array now.
  const row = (label, value, muted, ship) => (
    <div key={label} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>
        {ship ? (ship.quote ? <QuoteLinkValue link={ship} /> : <ShipValue ship={ship} />) : value}
      </span>
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
      {recordRows(r).map(([label, value, m, ship]) => row(label, value, m, ship))}
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




// ── THE TESTING TAB (12 Oct) ────────────────────────────────────────────────
// What the Testing page knows about this card's PRODUCT, read-only. Nothing is
// typed or saved here and nothing is copied onto the card: the tab mounts each
// time it is chosen and reads the product's live rows, so whatever Jenn changes
// on the Testing page shows the next time the tab is opened.
//
// THE RULES ARE THE TESTING PAGE'S, imported from lib/testingStatus.js rather
// than restated -- fmtDate, daysUntil, EXPIRY_WINDOW_DAYS, the four eFiling
// readings, and the latest-test-date rule (newest test_date among reports linked
// to the product, else manual_test_date).
//
// EXPIRY IS THE LATEST REPORT'S. The basis is the report with the newest
// test_date; its expiry_date is the expiry. No expiry on that report reads so,
// and does NOT fall back to an older report. With no dated report there is no
// basis, and expiry reads None recorded, manual_test_date or not.
//
// Only reports carrying the product's id count, as on the Testing page and in
// the weekly email; a report linked to a material alone is not this product's.
const TT_LBL = { fontSize:'10px', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#86868B' };
const TT_HEAD = { fontSize:'11px', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase',
                  color:'#86868B', marginBottom:'6px' };
const TT_NONE = 'None recorded';
// The Testing page's pill colours for an expiry: past, inside the window, and
// clear of it.
const EXPIRY_TONE = {
  expired:  { label:'Expired',  color:'#B91C1C', bg:'#FEE2E2' },
  expiring: { label:'Expiring', color:'#B45309', bg:'#FEF3C7' },
  ok:       { label:'OK',       color:'#15803D', bg:'#DCFCE7' },
};
const expiryTone = d => d === null ? null : d < 0 ? 'expired' : d <= EXPIRY_WINDOW_DAYS ? 'expiring' : 'ok';
const RESULT_LABEL = { pass:'Pass', fail:'Fail', pending:'Pending' };
// A stored status in the Testing page's words -- untested, in_progress, passed,
// failed, expired read Untested, In Progress, Passed, Failed, Expired there.
const statusWords = v => String(v || '').split('_').filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

function TestingTab({ r, canOpenTesting = false }) {
  const pid = r.product_id;
  const [data, setData] = useState(null);   // { product, reports, materials, rules }
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!pid) return;
    let dead = false;
    setData(null); setErr('');
    (async () => {
      const [pr, rp, pm, rg] = await Promise.all([
        SB.from('products').select('id,sku,name,efiling_required,efiled_date,manual_test_date').eq('id', pid).maybeSingle(),
        // Newest first, an undated report last, id breaking a tie.
        SB.from('test_reports')
          .select('id,product_id,report_number,test_date,expiry_date,overall_result,pdf_url,lab:labs(name)')
          .eq('product_id', pid)
          .order('test_date', { ascending:false, nullsFirst:false }).order('id', { ascending:false }),
        SB.from('product_materials').select('id,material:materials(id,name,status,material_code)').eq('product_id', pid),
        // The links, then the rules by id -- two plain reads, the way
        // useProductCpscRules reads them, rather than an embed nothing else uses.
        SB.from('product_regulations').select('id,regulation_id').eq('product_id', pid),
      ]);
      if (dead) return;
      const e = [pr, rp, pm, rg].find(x => x.error);
      if (e) { setErr(e.error.message); return; }
      const ids = [...new Set((rg.data || []).map(l => l.regulation_id).filter(Boolean))];
      const rr = ids.length ? await SB.from('regulations').select('id,code,name,citation,active').in('id', ids)
                            : { data: [], error: null };
      if (dead) return;
      if (rr.error) { setErr(rr.error.message); return; }
      const byId = Object.fromEntries((rr.data || []).map(g => [g.id, g]));
      const rules = (rg.data || []).map(l => ({ id: l.id, regulation: byId[l.regulation_id] || null }))
        .sort((a, b) => String((a.regulation || {}).code || '').localeCompare(String((b.regulation || {}).code || '')));
      setData({ product: pr.data || {}, reports: rp.data || [], materials: pm.data || [], rules });
    })();
    return () => { dead = true; };
  }, [pid]);

  const openLink = canOpenTesting && (
    <a href="/#testing" target="_blank" rel="noopener noreferrer"
      style={{fontSize:'12px',fontWeight:600,color:'#0A84FF',textDecoration:'none'}}>Open in Testing →</a>
  );
  const shell = body => (
    <div style={{marginTop:'16px'}}>
      {openLink && <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>{openLink}</div>}
      {body}
    </div>
  );
  const quiet = text => <div style={{fontSize:'12.5px',color:'#A0A0A4'}}>{text}</div>;

  if (!pid) return shell(quiet('No product linked to this card yet. Testing details appear once a product is linked.'));
  if (err) return shell(<div style={{fontSize:'12.5px',color:'var(--hot)'}}>Could not read the testing details — {err}</div>);
  if (!data) return shell(quiet('Reading testing details…'));

  const { product: p, reports, materials, rules } = data;
  // The latest report date by the Testing page's own rule, and the report that
  // carries it -- the first in the newest-first list with that date.
  const latestDate = latestTestDateByProduct(reports)[pid] || null;
  const basis = latestDate ? reports.find(x => x.test_date === latestDate) : null;
  const testDate = testingDateOf({ ...p, id: pid }, latestDate ? { [pid]: latestDate } : {});
  const manual = !latestDate && !!p.manual_test_date;
  const expiry = basis ? basis.expiry_date || null : null;
  const days = daysUntil(expiry);
  const tone = expiryTone(days);
  const efKey = efilingKey(p);
  const efText = EFILING_LABEL[efKey] + (efKey === 'filed' ? ' ' + fmtDate(p.efiled_date) : '');
  const expiryNote = !basis ? TT_NONE : !expiry ? 'No expiry recorded on the latest report' : null;

  const tile = (label, value, sub, color) => (
    <div style={{background:'#F5F5F7',borderRadius:'12px',padding:'10px 12px',minWidth:0}}>
      <div style={TT_LBL}>{label}</div>
      <div style={{fontSize:'15px',fontWeight:600,color:color || '#1D1D1F',marginTop:'4px',lineHeight:1.25}}>{value}</div>
      {sub && <div style={{fontSize:'11px',color:'#86868B',marginTop:'3px',lineHeight:1.35}}>{sub}</div>}
    </div>
  );
  const pill = (text, t) => (
    <span style={{display:'inline-flex',fontSize:'11px',fontWeight:700,borderRadius:'980px',padding:'2px 9px',
                  color:t.color,background:t.bg}}>{text}</span>
  );
  const section = (title, body) => (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={TT_HEAD}>{title}</div>
      {body}
    </div>
  );
  // The SystemKnows row, label left and value right.
  const row = (label, value, muted) => (
    <div key={label} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>{value}</span>
    </div>
  );
  const daysWords = d => d === null ? '' : d < 0 ? Math.abs(d) + ' day' + (d === -1 ? '' : 's') + ' overdue'
                                     : d === 0 ? 'today' : 'in ' + d + ' day' + (d === 1 ? '' : 's');

  return shell(
    <>
      {/* ── SUMMARY ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(118px,1fr))',gap:'8px'}}>
        {tile('eFiling', EFILING_LABEL[efKey], efKey === 'filed' ? fmtDate(p.efiled_date) : null,
              efKey === 'undecided' ? '#A0A0A4' : null)}
        {tile('Test report', testDate ? fmtDate(testDate) : TT_NONE, manual ? 'manual' : null,
              testDate ? null : '#A0A0A4')}
        {tile('Days to expiry', days === null ? '—' : String(days),
              tone ? EXPIRY_TONE[tone].label : (expiryNote === TT_NONE ? TT_NONE : 'No expiry recorded'),
              tone ? EXPIRY_TONE[tone].color : '#A0A0A4')}
        {tile('Materials', String(materials.length))}
        {tile('CPSC rules', String(rules.length))}
      </div>

      {section('Testing lab · this card',
        row('Testing lab', r.testing_lab || 'Not recorded', !r.testing_lab))}

      {/* ── 1. eFILING ── */}
      {section('eFiling', <>
        {row('Required', p.efiling_required === true ? 'Yes' : p.efiling_required === false ? 'No' : 'Not set',
             p.efiling_required !== true && p.efiling_required !== false)}
        {row('Status', efText, efKey === 'undecided')}
        {row('eFiled date', p.efiled_date ? fmtDate(p.efiled_date) : TT_NONE, !p.efiled_date)}
      </>)}

      {/* ── 2. TEST REPORTS, newest first ── */}
      {section('Test reports', reports.length === 0
        ? quiet(manual ? TT_NONE + ' — the testing date above was entered by hand.' : TT_NONE)
        : (
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {reports.map(x => {
              const d = daysUntil(x.expiry_date);
              const t = expiryTone(d);
              const isBasis = basis && basis.id === x.id;
              return (
                <div key={x.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:'8px',flexWrap:'wrap'}}>
                    <span style={{fontSize:'13px',fontWeight:600,color:'#1D1D1F'}}>
                      {/* A link only when the report has a file to open. */}
                      {x.pdf_url
                        ? <a href={x.pdf_url} target="_blank" rel="noopener noreferrer"
                            style={{color:'#0A84FF',textDecoration:'underline',textUnderlineOffset:'2px'}}>{x.report_number || 'Report'}</a>
                        : (x.report_number || 'No report number')}
                    </span>
                    {x.overall_result && <span style={{fontSize:'11.5px',color:'#86868B'}}>{RESULT_LABEL[x.overall_result] || x.overall_result}</span>}
                    {isBasis && pill('Basis for expiry', { color:'#1D1D1F', bg:'#E5E5EA' })}
                  </div>
                  <div style={{fontSize:'12px',color:'#5A5A5E',marginTop:'4px',lineHeight:1.5}}>
                    {'Report date ' + (x.test_date ? fmtDate(x.test_date) : '—')}
                    {' · Lab ' + ((x.lab || {}).name || '—')}
                    {' · Expires ' + (x.expiry_date ? fmtDate(x.expiry_date) : '—')}
                    {t && <> · {pill(daysWords(d), EXPIRY_TONE[t])}</>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* ── 3. EXPIRATION ── */}
      {section('Expiration', expiryNote ? quiet(expiryNote) : (
        <>
          {row('Expiry date', fmtDate(expiry))}
          {row('Days', <>{days === null ? '—' : daysWords(days)}{tone && <> {pill(EXPIRY_TONE[tone].label, EXPIRY_TONE[tone])}</>}</>)}
          {row('Based on', 'Latest test report' + (basis.report_number ? ' ' + basis.report_number : '')
                           + ', dated ' + fmtDate(basis.test_date))}
        </>
      ))}

      {/* ── 4. MATERIALS ── */}
      {section('Materials', materials.length === 0 ? quiet(TT_NONE) : (
        <div>
          {materials.map(l => (
            row(materialLabel(l.material) || 'Material', l.material && l.material.status ? statusWords(l.material.status) : 'Not set')
          ))}
        </div>
      ))}

      {/* ── 5. CPSC RULES, only when there are any ── */}
      {rules.length > 0 && section('CPSC rules', (
        <div>
          {rules.map(l => {
            const g = l.regulation || {};
            return (
              <div key={l.id} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
                <span style={{fontSize:'12px',fontWeight:600,fontFamily:'var(--mono)',color:'#1D1D1F',minWidth:'118px',flexShrink:0}}>{g.code || '—'}</span>
                <span style={{fontSize:'12.5px',color:'#1D1D1F',lineHeight:1.45}}>
                  {g.name || ''}{g.citation ? <span style={{color:'#86868B'}}> · {g.citation}</span> : null}
                  {g.active === false ? <span style={{color:'#A0A0A4'}}> · retired</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

// Split out so the x can read guardedClose from context. The provider lives
// INSIDE Overlay, so a hook called in ProgramDetail would sit above it and get
// the default -- the close button has to be a child to be guarded.
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner, onLab, onArchive, onDelete, onTouched, canOpenTesting = false }) {
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
  // TESTING SITS BETWEEN THEM (12 Oct) -- the product's testing, read-only. A
  // tab, not a stage: the board's stages are unchanged.
  const CARD_TABS = [['sampling', stageLabel(r.stage)], ['testing', 'Testing'], ['card', 'Card']];
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
    if (win) win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating sample card…</body>');
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      // The logo travels as bytes (lib/plmFiles.js cardLogo).
      const logo = await cardLogo();
      const html = cardFileHtml({ kind: exportKind, r, factoryName, staff, notes, logo });
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

  // The files themselves are lib/plmFiles.js, shared with the iPad view.
  const exportXlsx = async () => {
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      const ExcelJS = await loadExcelJS();
      const f = await cardFileXlsx({ kind: exportKind, r, factoryName, staff, notes, ExcelJS });
      downloadBlob(f.blob, f.name);
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const notes = await fetchCardNotes(r, staff);
      const f = cardFileCsv({ kind: exportKind, r, factoryName, staff, notes });
      downloadBlob(f.blob, f.name);
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  // ── THE LADDER POSITION ───────────────────────────────────────────────────
  // Where the card sits, for the pills: the ones before it read as passed. There
  // is no Advance button any more -- the pills move a card to any stage, forward
  // or back, and one control for one act is simpler than two that must agree.
  const idx = VISIBLE_STAGES.findIndex(([k]) => k === r.stage);
  // Rounds show while sampling and after it -- an Archived card keeps its record
  // of what was sent, and SampleRounds drops the new-round form there.
  const inSampling = SAMPLING_STAGES.includes(r.stage) || r.stage === ARCHIVED;

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          {/* Importer of record (script 136), the product's override or else the
              card's client -- which is the product's client on every card. */}
          <div style={{fontSize:'11.5px',color:'#86868B',marginTop:'1px'}}>{iorLabel(resolveKuiIor(p, r.client))}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>
            {[(r.client||{}).name, factoryName].filter(Boolean).join(' · ') || '—'}
          </div>
          {sourceQuoteOf(r) && (
            <div style={{fontSize:'12.5px',color:'#86868B',marginTop:'3px'}}>
              From quote <QuoteLinkValue link={sourceQuoteOf(r)} />
            </div>
          )}
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
                                           : CHECKLIST_ON ? 'This tab: stage, sample, checklist and card notes'
                                                          : 'This tab: stage, sample rounds and card notes'}
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
        {VISIBLE_STAGES.map(([k, l, c], i) => {
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
        {/* A stage that is off the board has no pill, so the card says where it
            is in words. Any pill moves it onto the board. */}
        {isHiddenStage(r.stage) && (
          <span style={{fontSize:'11px',color:'#A0A0A4',alignSelf:'center',marginLeft:'4px'}}>
            In {stageLabel(r.stage)}, which is off the board
          </span>
        )}
      </div>

      {/* ── OWNER, AGE ──────────────────────────────────────────────────────
          The 11 Aug row without its Advance button, which went on request; the
          pills above are the one way to move a card. The owner select is the
          staff list rather than a typed team, and changing it still writes its
          reassignment note. data-noguard because it saves the moment it
          changes -- there is nothing unsaved for the close guard to protect.

          NOT ON THE TESTING TAB (12 Oct): the whole row goes, owner and days
          alike, and the tabs close up under the stage pills. */}
      {tab !== 'testing' && (
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
      )}

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

      {tab === 'testing' ? (
        <TestingTab r={r} canOpenTesting={canOpenTesting} />
      ) : tab === 'card' ? (
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

      {CHECKLIST_ON && <Checklist r={r} staff={staff} userEmail={userEmail} onTouched={onTouched} />}

      {/* author is the caller's EMAIL, inside NotesPanel. The 11 Aug card wrote
          a display name, and the restrictive policies compare lower(author) to
          the email in the token -- a name would insert and then be uneditable
          and undeletable by the person who wrote it. */}
      {/* NOT SCOPED BY STAGE any more, and only notes with no live round --
          those sit under their round. A note whose round was deleted reads
          Round N; every other says the stage it was written in. */}
      <NotesPanel staff={staff} table="program_notes" keyCol="program_id" keyId={r.id}
        insertExtra={{ source: 'manual', stage: r.stage || null }} extraCol="source" extraDefault="manual"
        quietExtras={['manual', 'round']}
        nullCol="round_id" selectExtra="stage,round_no"
        labelOf={n => n.round_no ? 'Round ' + n.round_no : (n.stage ? stageLabel(n.stage) : null)}
        reloadKey={(r.rounds || []).map(x => x.id).join(',') || 'none'}
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

// ── CREATE A CARD FROM A QUOTE ID ───────────────────────────────────────────
// Loren types a Quote ID and gets the card for that quote. The steps are
// Create PLM Card's (lib/quoteCard.js, CardOwnerPopup): read the quote, resolve
// its product and client the same way, refuse if either is still missing, and
// otherwise ask who owns it -- defaulting to the quote's creator -- before
// anything is written. It never makes a second card for a product and client:
// programs is unique on the pair, so an existing card is opened instead, and the
// line under the box says which card it is and what state it is in.
//
// onOpen(id) opens a card on the board -- removed ones included, since the
// board's open card is found among every card, not only the visible ones.
function CardFromQuoteBox({ staff = [], userEmail, onOpen, onReload }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);      // { tone: 'ok' | 'info' | 'err', text, quote? }
  const [ask, setAsk] = useState(null);      // { quote, productId, clientId, ownerId, code }
  const [picking, setPicking] = useState(false);

  const quoteUrl = id => (typeof window !== 'undefined' ? window.location.origin : '') + '/?quote=' + id + '#quotes';
  const labelOf = q => (q.sku || 'No SKU') + ' · ' + (q.client || 'no client');

  // The quote is picked from the list (QuotePickOverlay), so there is nothing to
  // parse: the row is in hand. The checks are Create PLM Card's, unchanged.
  const go = async q => {
    setMsg(null); setPicking(false);
    const code = q.quote_code || '';
    setBusy(true);
    try {
      const res = await resolveQuoteLinks(q.id);
      if (res.error) { setMsg({ tone: 'err', text: 'Could not read ' + code + ' — ' + res.error.message }); return; }
      if (res.needsProduct || res.needsClient) {
        setMsg({ tone: 'err', quote: { code, url: quoteUrl(q.id) },
                 text: ' needs ' + missingWords(res.needsProduct, res.needsClient)
                       + ' before it can have a card — open the quote, set '
                       + (res.needsProduct && res.needsClient ? 'them' : 'it') + ', and save.' });
        return;
      }
      const ex = await existingCardFor(res.productId, res.clientId);
      if (ex.error) { setMsg({ tone: 'err', text: 'Could not check for a card — ' + ex.error.message }); return; }
      if (ex.card) {
        onOpen(ex.card.id);
        setMsg({ tone: 'info', text: existingCardMessage(ex.card, labelOf(q)) });
        return;
      }
      setAsk({ quote: q, productId: res.productId, clientId: res.clientId, code,
               ownerId: ownerIdForEmail(staff, q.updated_by) });
    } catch (e) {
      setMsg({ tone: 'err', text: 'Something went wrong — ' + ((e && e.message) || e) });
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const { error } = await createProgram(ask.productId, ask.clientId,
        { stage: 'quoted', ownerId: ask.ownerId, createdBy: userEmail, sourceQuoteId: ask.quote.id });
      if (error) { setMsg({ tone: 'err', text: 'Could not create the card — ' + error.message }); return; }
      // Read back by the pair: createProgram never says whether it inserted or
      // found a card a colleague had just made, and the card to open is the one
      // that is there either way.
      const ex = await existingCardFor(ask.productId, ask.clientId);
      if (onReload) await onReload();
      if (ex.card) onOpen(ex.card.id);
      const ours = ex.card && ex.card.source_quote && ex.card.source_quote.quote_code === ask.code;
      setMsg(ours
        ? { tone: 'ok', text: 'Sample card created from ' + ask.code + ' — ' + labelOf(ask.quote) + '.' }
        : { tone: 'info', text: 'A card for ' + labelOf(ask.quote) + ' was created by somebody else a moment ago. Opened it.' });
      setAsk(null);
    } catch (e) {
      setMsg({ tone: 'err', text: 'Something went wrong — ' + ((e && e.message) || e) });
    } finally {
      setBusy(false);
    }
  };

  const toneColor = { ok: '#1a7f4b', info: '#5A5A5E', err: 'var(--hot)' };
  return (
    <>
      <button onClick={()=>{ if (msg) setMsg(null); setPicking(true); }} disabled={busy}
        style={{display:'inline-flex',alignItems:'center',gap:'7px',border:'none',borderRadius:'10px',padding:'9px 14px',fontSize:'13px',fontWeight:600,
                fontFamily:'var(--sans)',background:'var(--ink)',color:'#fff',opacity:busy ? 0.6 : 1,cursor:busy ? 'default' : 'pointer',whiteSpace:'nowrap'}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
        {busy && !ask ? 'Checking…' : 'Create card'}
      </button>
      {msg && (
        <div style={{flexBasis:'100%',fontSize:'12.5px',color:toneColor[msg.tone] || '#5A5A5E',lineHeight:1.5}}>
          {msg.quote && <QuoteLinkValue link={msg.quote} />}{msg.text}
        </div>
      )}
      {picking && <QuotePickOverlay onPick={go} onClose={()=>setPicking(false)} />}
      {ask && (
        <CardOwnerPopup title={'Create sample card for ' + (ask.quote.sku || ask.code) + ' · ' + ask.code}
          staff={staff} ownerId={ask.ownerId} busy={busy}
          onOwner={v => setAsk(a => ({ ...a, ownerId: v }))}
          onStart={start} onCancel={() => setAsk(null)} />
      )}
    </>
  );
}

// ── PICKING THE QUOTE ───────────────────────────────────────────────────────
// The same list the sales-order and purchase-order forms open (QuotePickerModal
// in page.jsx): every quote, newest first, one search box over product, client,
// factory, SKU and quote code. Uses the qp-* classes from globals.css so it is
// the same picker to the eye. A quote that already has a card says so and opens
// it rather than making a second (go() above checks the pair).
function QuotePickOverlay({ onPick, onClose }) {
  const [quotes, setQuotes] = useState(null);
  const [search, setSearch] = useState('');
  useEffect(() => {
    SB.from('quotes').select('id,quote_code,sku,product,client,factory,product_id,client_company_id,updated_by,updated_at,created_at')
      .order('updated_at', { ascending: false }).limit(600)
      .then(({ data }) => setQuotes(data || []));
  }, []);
  const q = norm(search);
  const shown = (quotes || []).filter(x => !q || norm([x.product, x.client, x.factory, x.sku, x.quote_code].filter(Boolean).join(' ')).includes(q));
  return (
    <Overlay onClose={onClose} maxWidth={600} cardStyle={{padding:0,overflow:'hidden'}}>
      <div style={{padding:'18px 22px 14px',borderBottom:'1px solid var(--line)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontFamily:'var(--serif)',fontSize:'19px',fontWeight:600,color:'var(--ink)',letterSpacing:'-.01em'}}>Create a sample card</div>
          <div style={{fontSize:'12.5px',color:'var(--muted)',marginTop:'3px'}}>Pick the quote the sample is for.</div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{background:'none',border:'none',fontSize:'22px',color:'var(--faint)',cursor:'pointer',lineHeight:1,padding:'4px'}}>×</button>
      </div>
      <div style={{padding:'16px 22px 22px'}}>
        <div className="qp-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input data-noguard autoFocus placeholder="Search quotes — product, client, factory, SKU, Q-number" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        <div className="qp-list" style={{maxHeight:'400px'}}>
          {quotes === null && <div className="empty" style={{padding:'30px'}}><p>Loading…</p></div>}
          {quotes !== null && shown.length === 0 && <div className="empty" style={{padding:'30px'}}><p>No quotes match.</p></div>}
          {shown.map(x => (
            <button key={x.id} className="qp-card" onClick={()=>onPick(x)}>
              <span className="qp-avatar" style={{background:clientInkByName(x.client),color:'#fff'}}>{initialsOf(x.client)}</span>
              <span className="qp-meta">
                <div className="qp-prod">{x.product || 'Untitled'}</div>
                <div className="qp-sub">{x.client || '—'}{x.factory ? ' · ' + x.factory : ''}{x.sku ? ' · ' + x.sku : ''}</div>
              </span>
              <span className="qp-right">
                <div className="qp-price">{x.quote_code || ''}</div>
                <div className="qp-tiers">{shortDate(x.updated_at || x.created_at)}</div>
              </span>
            </button>
          ))}
        </div>
      </div>
    </Overlay>
  );
}

// canOpenTesting: whether this person's role may open the Testing page, for the
// card's Open in Testing link. page.jsx decides it from allowedPages.

// ═══════════════════════════════════════════════════════════════════════════
// ── THE CLIENT VIEW (14 Oct, second cut) ─────────────────────────────────────
// Riley: "we think in terms of company. What's going on for Stitch Golf?" So
// Samples opens as a register of clients on the left and the selected client's
// products on the right -- master and detail, no navigating back and forth.
//
// EACH PRODUCT IS A CONSIGNMENT. Its panel carries the stage control, the
// SHUTTLE the sample makes (left factory → at KUI → sent to client → with
// client → feedback in) drawn as a rail with the next step as the one action
// button, then action items and notes side by side. The sample is KUI's, not
// any one person's, so no owner is named on the line; names stay on notes,
// where they are the record.
//
// IT DRAWS ON THE APP'S OWN TOKENS -- globals.css: ink, muted, line, accent,
// Fraunces for the display voice, Spline Sans Mono for data. The first cut
// borrowed an Apple palette the rest of Vessl does not use, and read as a
// prototype for it.
//
// IT READS WHAT THE BOARD READS: the same enriched rows, grouped by client.
// Stage moves go through setStage, notes through NotesPanel, action items
// through program_tasks, shuttle steps through program_sample_rounds -- the
// write paths that already exist, so nothing here can drift from the card.

// The five stations, in order: label on the rail, the column that marks it
// reached, the button that reaches it, and whether that step ships something.
const SHUTTLE = [
  ['factory',  'Left factory',   'sent_date',            'Record factory shipment',    true],
  ['arrived',  'At KUI',         'received_date',        'Record arrival at KUI',      false],
  ['toclient', 'Sent to client', 'client_sent_date',     'Record shipment to client',  true],
  ['client',   'With client',    'client_received_date', 'Mark received by client',    false],
  ['feedback', 'Feedback in',    'client_feedback_at',   'Log client feedback',        false],
];
const shuttleIdx = x => { if (!x) return -1; let i = -1; SHUTTLE.forEach(([, , col], n) => { if (x[col]) i = n; }); return i; };
const todayIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

// Tokens, read once. Inline styles everywhere else in this file, so these stay
// inline too -- but they are the CSS variables, not fresh hex.
const T = {
  ink:'var(--ink)', ink2:'var(--ink-2)', muted:'var(--muted)', faint:'var(--faint)',
  line:'var(--line)', line2:'var(--line-2)', soft:'var(--soft)', soft2:'var(--soft-2)',
  accent:'var(--accent)', accentSoft:'var(--accent-soft)',
  serif:'var(--serif)', sans:'var(--sans)', mono:'var(--mono)',
  amber:'#c2790b', hot:'var(--hot)', ok:'var(--ok)',
};
const btnPrimary = { background:T.ink, color:'#fff', border:'1px solid ' + T.ink, borderRadius:'4px', padding:'8px 14px',
  fontSize:'13px', fontWeight:600, fontFamily:T.sans, cursor:'pointer', letterSpacing:'.005em' };
const btnQuiet = { background:'#fff', color:T.ink2, border:'1px solid ' + T.line, borderRadius:'4px', padding:'7px 12px',
  fontSize:'12.5px', fontWeight:500, fontFamily:T.sans, cursor:'pointer' };
const field = { border:'1px solid ' + T.line, borderRadius:'4px', padding:'8px 10px', fontSize:'13px', outline:'none',
  fontFamily:T.sans, background:'#fff', color:T.ink, boxSizing:'border-box' };

// What a client's register row says.
const clientRollup = list => {
  const open = list.filter(r => r.stage !== ARCHIVED);
  const sampling = open.filter(r => SAMPLING_STAGES.includes(r.stage));
  const quoting = open.filter(r => r.stage === 'quoted');
  const items = open.reduce((n, r) => n + (r.tasks || []).filter(t => !t.done).length, 0);
  const onUs = open.reduce((n, r) => n + (r.tasks || []).filter(t => !t.done && t.blocker === 'us').length, 0);
  const stale = open.filter(r => r.stale).length;
  const last = list.map(r => r.updated_at || r.created_at).filter(Boolean).sort().pop() || null;
  // The station most of the client's samples are waiting to reach.
  const nexts = sampling.map(r => { const i = shuttleIdx(latestRound(r)); return i < SHUTTLE.length - 1 ? SHUTTLE[i + 1][1] : null; }).filter(Boolean);
  const next = nexts.sort((a, b) => nexts.filter(v => v === b).length - nexts.filter(v => v === a).length)[0] || null;
  return { open, sampling, quoting, items, onUs, stale, last, next };
};

// ── CLIENT COLOURS ──────────────────────────────────────────────────────────
// One family -- deep blues, indigos and teals around Vessl's accent -- so the
// folders read as one set, and dealt in turn down the alphabetical list of
// clients so no two on the page share a colour until the family runs out. The
// pick is by position, not by hash: a hash handed three clients three oranges.
// Every one holds 4.5:1 against white lettering.
const CLIENT_INKS = ['#1e3a8a', '#0f766e', '#4338ca', '#1d4ed8', '#334155', '#6d28d9', '#0e7490', '#3461e0', '#5b21b6', '#1f2937', '#0369a1', '#4c1d95'];
const clientInkByName = name => {
  const n = (name || 'Unassigned').trim(); let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return CLIENT_INKS[h % CLIENT_INKS.length];
};
// names: every client on the page, so the deal is stable while the set is.
const clientInkMap = names => {
  const m = {};
  [...new Set(names)].sort((a, b) => a.localeCompare(b)).forEach((n, i) => { m[n] = CLIENT_INKS[i % CLIENT_INKS.length]; });
  return m;
};
// The leg a sample is on right now, for the glance: the client leg once it has
// a number, else the factory leg. Null when nothing has shipped.
const legOf = r => {
  const x = latestRound(r); if (!x) return null;
  if (x.client_tracking_number) return { label: 'To client', carrier: x.client_carrier, number: x.client_tracking_number, when: x.client_sent_date };
  if (x.tracking_number) return { label: 'From factory', carrier: x.carrier, number: x.tracking_number, when: x.sent_date };
  return null;
};
const initialsOf = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

// ── THE CLIENT TILE ─────────────────────────────────────────────────────────
// A folder, in the client's colour, white lettering. The mark is the initials;
// the lines under the name are what is in play and what KUI is waiting on.
function ClientTile({ name, list, ink, carriers, onOpen }) {
  const c = clientRollup(list);
  // The most recently shipped leg across the client's products.
  const leg = list.map(r => ({ r, l: legOf(r) })).filter(z => z.l).sort((a, b) => ((a.l.when || '') < (b.l.when || '') ? 1 : -1))[0] || null;
  const owe = c.onUs > 0 || c.stale > 0;
  const chips = [
    c.sampling.length ? c.sampling.length + ' sampling' : null,
    c.quoting.length ? c.quoting.length + ' quoting' : null,
    c.open.length === 0 ? 'Nothing in play' : null,
  ].filter(Boolean);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={e=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      style={{textAlign:'left',background:ink,color:'#fff',border:'none',borderRadius:'14px',padding:'18px 18px 16px',
              cursor:'pointer',fontFamily:T.sans,display:'flex',flexDirection:'column',gap:'10px',minHeight:'176px',
              boxShadow:'0 1px 2px rgba(15,23,41,.12), 0 6px 18px -8px rgba(15,23,41,.35)',position:'relative'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div style={{width:'42px',height:'42px',borderRadius:'11px',background:'rgba(255,255,255,.18)',display:'flex',alignItems:'center',
                     justifyContent:'center',fontSize:'15px',fontWeight:700,letterSpacing:'.02em'}}>{initialsOf(name)}</div>
        {owe && <span title={c.onUs ? c.onUs + ' waiting on KUI' : 'Not moved in ' + STALE_DAYS + ' days'}
                      style={{fontSize:'11px',fontWeight:700,background:'#fff',color:ink,borderRadius:'999px',padding:'3px 9px'}}>
                  {c.onUs ? c.onUs + ' on KUI' : 'Stalled'}</span>}
      </div>
      <div style={{fontSize:'19px',fontWeight:600,letterSpacing:'-.01em',lineHeight:1.15,marginTop:'2px'}}>{name}</div>
      <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
        {chips.map(t => <span key={t} style={{fontSize:'11.5px',fontWeight:600,background:'rgba(255,255,255,.2)',borderRadius:'999px',padding:'3px 9px'}}>{t}</span>)}
      </div>
      <div style={{marginTop:'auto'}}>
        {leg && (
          <div style={{fontSize:'12px',color:'rgba(255,255,255,.85)',lineHeight:1.45,marginBottom:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
            <span style={{opacity:.8}}>{leg.label}{leg.carrier ? ' · ' + leg.carrier : ''} </span>
            <a href={trackingUrl(leg.carrier, leg.number, carriers) || undefined} target="_blank" rel="noopener noreferrer"
               onClick={e=>e.stopPropagation()} title={'Track ' + leg.number}
               style={{color:'#fff',fontFamily:T.mono,fontSize:'11.5px',fontWeight:600,textDecoration:'underline',textUnderlineOffset:'3px',textDecorationColor:'rgba(255,255,255,.5)'}}>
              {leg.number} ↗</a>
          </div>
        )}
        <div style={{fontSize:'12.5px',color:'rgba(255,255,255,.85)',lineHeight:1.45}}>
          {c.next ? 'Waiting on: ' + c.next.toLowerCase() : c.items ? c.items + ' action item' + (c.items === 1 ? '' : 's') : c.last ? 'Updated ' + shortDate(c.last) : ''}
        </div>
      </div>
    </div>
  );
}

// ── RECORDING A STATION ─────────────────────────────────────────────────────
// One form under the rail: a date (today by default), carrier and number for
// the two legs that ship, text for feedback. Writes the latest round, or starts
// round 1 when the card has none -- somebody recording a shipment has a sample.
function StationForm({ r, step, carriers, userEmail, onDone, onCancel }) {
  const [, label, col, , ships] = SHUTTLE.find(s => s[0] === step);
  const x = latestRound(r);
  const isFactory = step === 'factory';
  const [date, setDate] = useState(x && x[col] && step !== 'feedback' ? String(x[col]).slice(0, 10) : todayIso());
  const [carrier, setCarrier] = useState(x ? (isFactory ? x.carrier : x.client_carrier) || '' : '');
  const [number, setNumber]   = useState(x ? (isFactory ? x.tracking_number : x.client_tracking_number) || '' : '');
  const [text, setText] = useState(x ? x.client_feedback || '' : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useDirtySource(!!number.trim() || !!text.trim());

  const save = async () => {
    setBusy(true); setErr('');
    const patch = { updated_by: userEmail || null, updated_at: new Date().toISOString() };
    if (step === 'feedback') { patch.client_feedback = text.trim() || null; patch.client_feedback_at = new Date().toISOString(); }
    else patch[col] = date || null;
    if (ships && isFactory) { patch.carrier = carrier.trim() || null; patch.tracking_number = number.trim() || null; }
    if (ships && !isFactory) { patch.client_carrier = carrier.trim() || null; patch.client_tracking_number = number.trim() || null; }
    let error = null;
    if (x) ({ error } = await SB.from('program_sample_rounds').update(patch).eq('id', x.id));
    else ({ error } = await SB.from('program_sample_rounds').insert({ program_id: r.id, stage: 'sampling', round: 1, created_by: userEmail || null, ...patch }));
    if (error) { setErr(error.message); setBusy(false); return; }
    if (step === 'feedback' && text.trim()) {
      await SB.from('program_notes').insert({ program_id: r.id, author: userEmail || null, source: 'manual', stage: r.stage || null,
        round_no: x ? x.round : 1, note: 'Client feedback: ' + text.trim() });
    }
    const t = await touchProgram(r.id, userEmail); if (t) touchFailedToast(t);
    setBusy(false); onDone();
  };
  return (
    <div style={{borderTop:'1px solid ' + T.line,marginTop:'14px',paddingTop:'14px'}}>
      <div style={{fontSize:'13.5px',fontWeight:600,color:T.ink,marginBottom:'10px'}}>{label}{x ? ', round ' + x.round : ' (starts round 1)'}</div>
      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
        {step !== 'feedback' && <input type="date" value={date} onChange={e=>setDate(e.target.value)} aria-label="Date" style={{...field,flex:'0 0 160px'}} />}
        {ships && (
          <>
            <input list={'carriers-' + r.id} value={carrier} onChange={e=>setCarrier(e.target.value)} placeholder="Carrier" style={{...field,flex:'1 1 130px'}} />
            <datalist id={'carriers-' + r.id}>{(carriers || []).map(c => <option key={c.id} value={c.name} />)}</datalist>
            <input value={number} onChange={e=>setNumber(e.target.value)} placeholder="Tracking number" style={{...field,flex:'2 1 200px',fontFamily:T.mono,fontSize:'12.5px'}} />
          </>
        )}
        {step === 'feedback' && <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="What the client said" rows={3} style={{...field,flex:'1 1 100%',resize:'vertical',lineHeight:1.5}} />}
      </div>
      {err && <div style={{fontSize:'12.5px',color:T.hot,marginTop:'8px'}}>Could not save: {err}</div>}
      <div style={{display:'flex',gap:'8px',marginTop:'12px'}}>
        <button onClick={save} disabled={busy || (step === 'feedback' && !text.trim())} style={{...btnPrimary,opacity:busy ? .6 : 1}}>{busy ? 'Saving' : 'Save'}</button>
        <button onClick={onCancel} disabled={busy} style={btnQuiet}>Cancel</button>
      </div>
    </div>
  );
}

// ── THE RAIL ────────────────────────────────────────────────────────────────
// Five stations on a track. Reached stations are filled squares joined by a
// solid line and carry their date beneath; the next one is the action button.
// The two legs that ship show the tracking number as a link under the station.
function ShuttleRail({ r, carriers, open, onOpen, onEdit }) {
  const x = latestRound(r);
  const idx = shuttleIdx(x);
  const done = idx >= SHUTTLE.length - 1;
  return (
    <div style={{marginTop:'16px'}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)'}}>
        {SHUTTLE.map(([k, label, col, , ships], i) => {
          const reached = i <= idx, next = i === idx + 1;
          const val = x ? x[col] : null;
          const carrier = k === 'factory' ? (x || {}).carrier : (x || {}).client_carrier;
          const number  = k === 'factory' ? (x || {}).tracking_number : (x || {}).client_tracking_number;
          const color = reached ? T.ink : next ? T.accent : T.line;
          return (
            <div key={k} style={{position:'relative',minWidth:0}}>
              {/* track segment to the right of this station */}
              {i < SHUTTLE.length - 1 && (
                <div style={{position:'absolute',top:'6px',left:'14px',right:'-0px',height:'3px',
                             background:i < idx ? T.ink : T.line2}} />
              )}
              {/* station marker */}
              <button onClick={()=>reached ? onEdit(k) : next ? onOpen(k) : null} disabled={!reached && !next}
                aria-label={(reached ? 'Edit ' : next ? 'Record ' : '') + label}
                style={{position:'relative',zIndex:1,width:'15px',height:'15px',padding:0,border:'2px solid ' + color,
                        background:reached ? T.ink : '#fff',borderRadius:'2px',cursor:reached || next ? 'pointer' : 'default',
                        outline:open === k ? '3px solid ' + T.accentSoft : 'none'}} />
              <div style={{fontSize:'12px',fontWeight:reached || next ? 600 : 500,color:reached ? T.ink : next ? T.accent : T.faint,
                           marginTop:'8px',paddingRight:'10px',lineHeight:1.25}}>{label}</div>
              <div style={{fontFamily:T.mono,fontSize:'11.5px',color:T.muted,marginTop:'2px',paddingRight:'10px',lineHeight:1.4,
                           overflow:'hidden',textOverflow:'ellipsis'}}>
                {reached && val ? shortDate(val) : ''}
                {reached && ships && number ? <div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>
                  <TrackingLink number={number} url={trackingUrl(carrier, number, carriers)} /></div> : null}
              </div>
            </div>
          );
        })}
      </div>
      {!done && !open && (
        <button onClick={()=>onOpen(SHUTTLE[idx + 1][0])} style={{...btnPrimary,marginTop:'12px',background:T.accent,borderColor:T.accent}}>
          {SHUTTLE[idx + 1][3]}
        </button>
      )}
    </div>
  );
}

// ── ACTION ITEMS ────────────────────────────────────────────────────────────
// "Is the UPC art approved?" -- program_tasks through TaskRow, so an item here
// is the same thing as a task on the card. The picker names who will do it;
// left on Anyone at KUI, it belongs to the office.
function ActionItems({ r, staff, userEmail, onTouched }) {
  const [text, setText] = useState('');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null);
  const [showDone, setShowDone] = useState(false);
  useDirtySource(!!text.trim());
  const all = r.tasks || [];
  const open = all.filter(t => !t.done), done = all.filter(t => t.done);
  const write = async (t, fn) => { setPending(t.id); const { error } = await fn(); if (error) window._toast?.(error.message, 'err'); await onTouched(); setPending(null); };
  const add = async () => {
    const body = text.trim(); if (!body) return;
    setBusy(true);
    const { error } = await SB.from('program_tasks').insert({ program_id: r.id, stage: r.stage || 'sampling', task: body,
      owner_id: who || null, assigned_by: userEmail || null, blocker: 'none',
      sort_order: all.reduce((m, t) => Math.max(m, t.sort_order || 0), -1) + 1 });
    if (error) window._toast?.('Could not add the item: ' + error.message, 'err'); else setText('');
    await onTouched(); setBusy(false);
  };
  return (
    <div>
      <div style={{fontSize:'13.5px',fontWeight:600,color:T.ink,marginBottom:'4px'}}>Action items{open.length ? ' (' + open.length + ')' : ''}</div>
      {open.length === 0 && <div style={{fontSize:'12.5px',color:T.faint,padding:'6px 0'}}>Nothing open.</div>}
      {open.map(t => <TaskRow key={t.id} t={t} staff={staff} pending={pending === t.id}
        onToggle={t => write(t, () => SB.from('program_tasks').update({ done: true, done_at: new Date().toISOString() }).eq('id', t.id))}
        onBlocker={(t, b) => write(t, () => SB.from('program_tasks').update({ blocker: b }).eq('id', t.id))}
        onDel={t => write(t, () => SB.from('program_tasks').delete().eq('id', t.id))} />)}
      <div style={{display:'flex',gap:'6px',marginTop:'8px'}}>
        <input value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if (e.key === 'Enter') add(); }}
          placeholder="Add an item and press Enter" style={{...field,flex:'1 1 160px'}} />
        <select data-noguard value={who} onChange={e=>setWho(e.target.value)} aria-label="Who will do it"
          style={{...field,flex:'0 1 150px',color:who ? T.ink : T.muted}}>
          <option value="">Anyone at KUI</option>
          {staff.map(p => <option key={p.id} value={p.id}>{p.full_name || p.email}</option>)}
        </select>
        <button onClick={add} disabled={busy || !text.trim()} style={btnQuiet}>Add</button>
      </div>
      {done.length > 0 && (
        <button onClick={()=>setShowDone(v=>!v)} style={{background:'none',border:'none',padding:'8px 0 0',fontSize:'12px',color:T.muted,cursor:'pointer',fontFamily:T.sans,textDecoration:'underline',textUnderlineOffset:'3px'}}>
          {showDone ? 'Hide' : 'Show'} {done.length} done
        </button>
      )}
      {showDone && done.map(t => <TaskRow key={t.id} t={t} staff={staff} dim pending={pending === t.id}
        onToggle={t => write(t, () => SB.from('program_tasks').update({ done: false, done_at: null }).eq('id', t.id))}
        onBlocker={()=>{}} onDel={t => write(t, () => SB.from('program_tasks').delete().eq('id', t.id))} />)}
    </div>
  );
}

// ── ONE CONSIGNMENT ─────────────────────────────────────────────────────────
function Consignment({ r, staff, userEmail, carriers, busy, onStage, onOpenCard, onTouched, last }) {
  const p = r.products || {};
  const x = latestRound(r);
  const leg = legOf(r);
  const [station, setStation] = useState(null);   // the station form that is open
  const inSampling = SAMPLING_STAGES.includes(r.stage);
  const roundLine = x ? 'Round ' + x.round + (x.sample_type ? ', ' + sampleTypeLabel(x.sample_type).toLowerCase() : '')
                      : inSampling ? 'No round recorded yet' : null;
  return (
    <section style={{padding:'22px 0 26px',borderBottom:last ? 'none' : '1px solid ' + T.line}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'16px',flexWrap:'wrap'}}>
        <div style={{minWidth:0,flex:'1 1 260px'}}>
          <div style={{display:'flex',alignItems:'baseline',gap:'10px',flexWrap:'wrap'}}>
            <h3 style={{fontSize:'17px',fontWeight:600,color:T.ink,margin:0,letterSpacing:'-.01em'}}>{p.name || 'Unnamed product'}</h3>
            {p.sku && <span style={{fontFamily:T.mono,fontSize:'12px',color:T.muted}}>{p.sku}</span>}
          </div>
          <div style={{fontSize:'12.5px',color:T.muted,marginTop:'4px',display:'flex',gap:'14px',flexWrap:'wrap'}}>
            {r.factoryName && <span>{r.factoryName}</span>}
            <span>{iorLabel(resolveKuiIor(p, r.client))}</span>
            {roundLine && <span>{roundLine}</span>}
            {r.days !== null && r.stage && r.stage !== ARCHIVED && <span>{r.days} day{r.days === 1 ? '' : 's'} in {stageLabel(r.stage).toLowerCase()}</span>}
          </div>
          {leg && (
            <div style={{display:'inline-flex',alignItems:'center',gap:'8px',marginTop:'8px',padding:'5px 10px',borderRadius:'6px',
                         background:T.soft,border:'1px solid ' + T.line,fontSize:'12px',color:T.muted}}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/></svg>
              <span>{leg.label}{leg.carrier ? ' · ' + leg.carrier : ''}{leg.when ? ' · ' + shortDate(leg.when) : ''}</span>
              <TrackingLink number={leg.number} url={trackingUrl(leg.carrier, leg.number, carriers)} />
            </div>
          )}
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap'}}>
          {/* stage control: a segmented row, the current stage in its colour */}
          <div role="group" aria-label="Stage" style={{display:'inline-flex',border:'1px solid ' + T.line,borderRadius:'4px',overflow:'hidden'}}>
            {VISIBLE_STAGES.map(([k, l, c], i) => {
              const active = k === r.stage;
              return <button key={k} onClick={()=>onStage(r, k)} disabled={busy || active} aria-pressed={active}
                style={{fontSize:'12px',fontWeight:600,padding:'6px 12px',border:'none',borderLeft:i ? '1px solid ' + T.line : 'none',
                        fontFamily:T.sans,cursor:(busy||active)?'default':'pointer',
                        background:active ? c : '#fff',color:active ? '#fff' : T.muted}}>{l}</button>;
            })}
          </div>
          <button onClick={onOpenCard} style={btnQuiet}>Open card</button>
        </div>
      </div>

      {(inSampling || x) && (
        <ShuttleRail r={r} carriers={carriers} open={station} onOpen={k => setStation(k)} onEdit={k => setStation(station === k ? null : k)} />
      )}
      {station && <StationForm r={r} step={station} carriers={carriers} userEmail={userEmail}
        onDone={async()=>{ setStation(null); await onTouched(); }} onCancel={()=>setStation(null)} />}
      {x && x.client_feedback && (
        <div style={{marginTop:'14px',borderLeft:'3px solid ' + T.amber,padding:'6px 12px',fontSize:'13px',color:T.ink2,lineHeight:1.5}}>
          <span style={{fontWeight:600,color:T.ink}}>Client feedback</span>
          {x.client_feedback_at && <span style={{fontFamily:T.mono,fontSize:'11.5px',color:T.muted,marginLeft:'8px'}}>{shortDate(x.client_feedback_at)}</span>}
          <div style={{marginTop:'2px'}}>{x.client_feedback}</div>
        </div>
      )}

      <div style={{display:'grid',gridTemplateColumns:'minmax(260px,1fr) minmax(300px,1.4fr)',gap:'28px',marginTop:'20px'}} className="plm-consignment-grid">
        <ActionItems r={r} staff={staff} userEmail={userEmail} onTouched={onTouched} />
        <div>
          <NotesPanel staff={staff} table="program_notes" keyCol="program_id" keyId={r.id}
            insertExtra={{ source: 'manual', stage: r.stage || null }} extraCol="source" extraDefault="manual"
            quietExtras={['manual', 'round']} selectExtra="stage,round_no"
            labelOf={n => n.round_no ? 'Round ' + n.round_no : (n.stage ? stageLabel(n.stage) : null)}
            reloadKey={(r.rounds || []).map(y => y.id).join(',') + '-' + r.noteCount}
            title={'Notes' + (r.noteCount ? ' (' + r.noteCount + ')' : '')} programId={r.id} userEmail={userEmail} onTouched={onTouched} />
        </div>
      </div>
    </section>
  );
}

// ── THE DETAIL PANE ─────────────────────────────────────────────────────────
function ClientDetail({ name, list, ink, staff, userEmail, carriers, saving, onStage, onOpenCard, onTouched, onBack }) {
  const c = clientRollup(list);
  const [showArchived, setShowArchived] = useState(false);
  const order = { sampling:0, revision:0, quoted:1, testing:2, production:3, shipped:4 };
  const sorted = [...list].sort((a, b) => ((order[a.stage] ?? 5) - (order[b.stage] ?? 5)) || ((a.updated_at || '') < (b.updated_at || '') ? 1 : -1));
  const live = sorted.filter(r => r.stage !== ARCHIVED), archived = sorted.filter(r => r.stage === ARCHIVED);
  const summary = [
    live.length + ' product' + (live.length === 1 ? '' : 's') + ' in play',
    c.sampling.length ? c.sampling.length + ' sampling' : null,
    c.quoting.length ? c.quoting.length + ' quoting' : null,
    c.onUs ? c.onUs + ' item' + (c.onUs === 1 ? '' : 's') + ' waiting on KUI' : null,
  ].filter(Boolean);
  return (
    <div style={{minWidth:0}}>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'12px'}}>
        <button type="button" onClick={onBack}
          style={{display:'inline-flex',alignItems:'center',gap:'8px',background:'#fff',color:T.ink,border:'1px solid ' + T.line,borderRadius:'10px',
                  padding:'8px 14px 8px 11px',fontSize:'13px',fontWeight:600,cursor:'pointer',fontFamily:T.sans,boxShadow:'0 1px 2px rgba(15,23,41,.04)'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          All clients
        </button>
        <span style={{fontSize:'13px',color:T.faint}}>/</span>
        <span style={{fontSize:'13px',color:T.muted,fontWeight:500}}>{name}</span>
      </div>
      <header style={{background:ink,color:'#fff',borderRadius:'14px',padding:'22px 24px',marginBottom:'6px'}}>
        <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
          <div style={{width:'46px',height:'46px',borderRadius:'12px',background:'rgba(255,255,255,.18)',display:'flex',alignItems:'center',
                       justifyContent:'center',fontSize:'16px',fontWeight:700,flexShrink:0}}>{initialsOf(name)}</div>
          <div style={{minWidth:0}}>
            <h2 style={{fontSize:'26px',fontWeight:600,margin:0,letterSpacing:'-.015em',lineHeight:1.1}}>{name}</h2>
            <div style={{fontSize:'13px',color:'rgba(255,255,255,.85)',marginTop:'6px',display:'flex',gap:'14px',flexWrap:'wrap'}}>
              {summary.map((t, i) => <span key={i} style={{fontWeight:/KUI/.test(t) ? 700 : 500}}>{t}</span>)}
            </div>
          </div>
        </div>
      </header>
      <div style={{background:'#fff',border:'1px solid ' + T.line,borderRadius:'14px',padding:'0 24px'}}>
      {live.map((r, i) => <Consignment key={r.id} r={r} staff={staff} userEmail={userEmail} carriers={carriers} busy={saving === r.id}
        onStage={onStage} onOpenCard={()=>onOpenCard(r.id)} onTouched={onTouched} last={i === live.length - 1 && !archived.length} />)}
      {live.length === 0 && (
        <div style={{padding:'36px 0',fontSize:'14px',color:T.muted,borderTop:'1px solid ' + T.line,marginTop:'10px'}}>
          Nothing in play for {name}. Everything is archived, or a card has not been created from a quote yet.
        </div>
      )}
      {archived.length > 0 && (
        <div style={{paddingTop:'16px'}}>
          <button onClick={()=>setShowArchived(v=>!v)} style={{...btnQuiet,fontSize:'12px'}}>
            {showArchived ? 'Hide' : 'Show'} {archived.length} archived
          </button>
          {showArchived && <div style={{opacity:.7}}>
            {archived.map((r, i) => <Consignment key={r.id} r={r} staff={staff} userEmail={userEmail} carriers={carriers} busy={saving === r.id}
              onStage={onStage} onOpenCard={()=>onOpenCard(r.id)} onTouched={onTouched} last={i === archived.length - 1} />)}
          </div>}
        </div>
      )}
      </div>
    </div>
  );
}

export default function Programs({ userEmail, canOpenTesting = false }) {
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
  const [ui, setUi] = usePageState('programs', { search:'', showRemoved:false, blocker:'', view:'companies', companyId:'' });
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
  const [carriers, setCarriers] = useState([]);
  // Whether the last load found program_sample_rounds.sent_by (script 112).
  const [sentByLive, setSentByLive] = useState(false);
  // And program_sample_rounds.sent_by_2, carrier_2, tracking_number_2 (script 113).
  const [pkg2Live, setPkg2Live] = useState(false);
  const [sampleTypes, setSampleTypes] = useState([]);

  // QUIET AFTER THE FIRST READ. loading starts true and only the first load
  // shows the placeholder; every later one -- after a stage move, a note, a
  // sample -- swaps the rows in underneath. Setting it true again unmounted the
  // whole page, and the open card with it: the tab snapped back to Card, a
  // half-typed note elsewhere on the card was lost, and the page flashed.
  const load = async () => {
    setErr('');
    try {
      // The reads are lib/plmBoard.js loadBoardData, shared with the iPad view.
      const d = await loadBoardData();
      setRows(d.rows);
      setStaff(d.staff);
      setTasks(d.tasks);
      setRounds(d.rounds);
      setCarriers(d.carriers);
      setSentByLive(d.sentByLive);
      setPkg2Live(d.pkg2Live);
      setSampleTypes(d.sampleTypes);
      setNoteCounts(d.noteCounts);
      setEv(d.ev);
    } catch (x) {
      setErr(x && x.message ? x.message : String(x));
    }
    setLoad(false);
  };

  useEffect(()=>{ load(); }, []);

  // The document-level dragend and drop listeners were here. They existed to wipe
  // a fade off a drag handle that a remount had orphaned, which is a problem only
  // a draggable board has.

  // The two derivations are lib/plmBoard.js, shared with the iPad view.
  const buckets = useMemo(() => buildBuckets(ev), [ev]);

  const enriched = useMemo(
    () => enrichRows(rows, buckets, { staff, noteCounts, tasks, rounds, carriers, sentByLive, pkg2Live, sampleTypes }),
    // staff and noteCounts are dependencies now: without them a name stays
    // unresolved and a count stays zero until some other change happens to
    // recompute this.
    [rows, buckets, staff, noteCounts, tasks, rounds, carriers, sampleTypes, sentByLive, pkg2Live]);

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
    // .select returns the rows the update actually changed. No error and no row
    // is a write that went nowhere -- a policy refusing it, or a card deleted
    // meanwhile -- and the optimistic move must not stand as if it had landed.
    const { data: hit, error } = await SB.from('programs')
      .update({ declared_stage: next, updated_at: new Date().toISOString(), updated_by: userEmail || null })
      .eq('id', r.id)
      .select('id');
    if (error || !hit || !hit.length) {
      if (before) setRows(prev => prev.map(x => x.id === r.id ? before : x));
      window._toast?.(error ? 'Could not move the card — ' + error.message
                            : 'Could not move the card — the change was not saved. Refresh and try again.', 'err');
      setSaving(null);
      return;
    }
    if (CHECKLIST_ON) await seedStageTasks(r, next);
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
  // A Waiting filter left in the page store from before the checklist went off
  // must not narrow the board with no tile on screen to clear it.
  const blockerMatches = r => !CHECKLIST_ON || !ui.blocker
    || (r.stage !== ARCHIVED && openTasks(r).some(t => t.blocker === ui.blocker));

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

  // ── COMPANIES (14 Oct) ──────────────────────────────────────────────────────
  // Every live card grouped by client. Search narrows the company list by name
  // and the products inside a company by SKU, name or client -- the same
  // matches() the board uses, so one search means one thing.
  const companies = useMemo(() => {
    const m = new Map();
    board.forEach(r => {
      const id = r.client_company_id || 'none';
      if (!m.has(id)) m.set(id, { id, name: (r.client || {}).name || 'No client', list: [] });
      m.get(id).list.push(r);
    });
    return [...m.values()].sort((a, b) => {
      // Companies with something in sampling first, then by most recent touch.
      const sa = a.list.some(r => SAMPLING_STAGES.includes(r.stage)) ? 0 : 1;
      const sb = b.list.some(r => SAMPLING_STAGES.includes(r.stage)) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      const la = a.list.map(r => r.updated_at || '').sort().pop() || '';
      const lb = b.list.map(r => r.updated_at || '').sort().pop() || '';
      return la < lb ? 1 : la > lb ? -1 : a.name.localeCompare(b.name);
    });
  }, [board]);
  const shownCompanies = useMemo(() => {
    if (!ui.search) return companies;
    const q = norm(ui.search);
    return companies.filter(c => norm(c.name).includes(q) || c.list.some(matches));
  }, [companies, ui.search]);
  const inkOf = useMemo(() => clientInkMap(companies.map(c => c.name)), [companies]);
  const openCompany = useMemo(() => {
    const c = ui.companyId ? companies.find(x => x.id === ui.companyId) || null : null;
    if (!c || !ui.search) return c;
    // Narrow the client's products too, unless it was the name that matched.
    const byName = norm(c.name).includes(norm(ui.search));
    return byName ? c : { ...c, list: c.list.filter(matches) };
  }, [companies, ui.companyId, ui.search]);

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
    const [cn, gn, rn] = await Promise.all([
      SB.from('program_notes').select('program_id,author,note,created_at,edited_at,source,stage,round_no')
        .is('round_id', null).order('created_at', { ascending:false }).order('id', { ascending:false }),
      SB.from('product_notes').select('product_id,author,note,created_at,edited_at,kind')
        .eq('kind', 'sampling').order('created_at', { ascending:false }).order('id', { ascending:false }),
      // Newest first like the card's own lists, id breaking a tie.
      SB.from('program_notes').select('program_id,author,note,created_at,edited_at,source,round_id,round_no')
        .not('round_id', 'is', null).order('created_at', { ascending:false }).order('id', { ascending:false }),
    ]);
    if (cn.error) throw new Error(cn.error.message);
    if (gn.error) throw new Error(gn.error.message);
    if (rn.error) throw new Error(rn.error.message);
    return buildBoardTables(exportCards, staff,
      shapeNotes(cn.data, 'source', 'manual', staff), shapeNotes(gn.data, 'kind', 'sampling', staff),
      shapeNotes(rn.data, 'source', 'round', staff));
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
        styleLinks(ws);
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
  // One file, the seven tables in the workbook's order, each under a # title line
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
          cell(t.cols[i][1] === 'stamp' ? stampText(v) : cellText(v))).join(',')));
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
    // Health, no testing, overdue, open here and the blocker (lib/plmBoard.js).
    const { h, notReq, late, openHere, blk } = tileFacts(r);
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
        {/* THE SOURCE QUOTE, small, at the right of the SKU line (script 104).
            Nothing when the card has none. A span rather than a link, because
            the tile is a button and a link may not sit inside one; it opens the
            quote in a new tab and stops the click, so the card does not open. */}
        <div style={{display:'flex',alignItems:'baseline',gap:'8px',minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:700,color:'#1A1A1C',flex:1,minWidth:0,
                       whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.sku || '—'}</div>
          {sourceQuoteOf(r) && (
            <span role="link" title={'Open quote ' + sourceQuoteOf(r).code + ' on the Quotes page'}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); e.preventDefault(); window.open(sourceQuoteOf(r).url, '_blank', 'noopener'); }}
              style={{fontFamily:'var(--mono)',fontSize:'10.5px',fontWeight:600,color:'#0A84FF',flexShrink:0,
                      cursor:'pointer',textDecoration:'underline',textUnderlineOffset:'2px'}}>
              {sourceQuoteOf(r).code}
            </span>
          )}
        </div>
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
        {(h === 'stalled' || h === 'at_risk') || (r.days !== null && r.days !== undefined) || late || openHere > 0 || blk || r.noteCount > 0 || notReq || r.retired ? (
          <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'11px',flexWrap:'wrap'}}>
            {/* HEALTH, FIRST IN THE ROW -- what the edge used to say. The same
                healthOf the Stalled tile above the board counts, so a pill and
                that count cannot disagree. */}
            {(h === 'stalled' || h === 'at_risk') && (
              <span title={h === 'stalled'
                  ? (CHECKLIST_ON ? 'A sample is overdue, or a task is waiting on us and the card has not moved in over 7 days'
                                  : 'A sample is overdue')
                  : (CHECKLIST_ON ? 'Over 14 days in this stage, or a task is past its due date'
                                  : 'Over 14 days in this stage')}
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
  //
  // HIDDEN STAGE IS THE SAME KIND OF COLUMN, for a card whose stage is off the
  // board (VISIBLE_STAGES). It appears only when such a card exists, takes no
  // drop, and its tiles keep their own stage accent, so the column says the
  // stage is hidden and the edge says which one.
  const hiddenList = shownBoard.filter(r => isHiddenStage(r.stage));
  const columns = [
    ...VISIBLE_STAGES.map(([k, l]) => ({
      key: k, label: l, color: accentOf(k), list: shownBoard.filter(r => r.stage === k),
    })),
    ...(board.some(r => isHiddenStage(r.stage))
      ? [{ key:'hidden', label:'Hidden stage', color: accentOf('none'), list: hiddenList }]
      : []),
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
  // Archived cards are skipped: a task left open on a finished card is not
  // something anybody is waiting on.
  const waitingOn = b => board.filter(r => r.stage !== ARCHIVED && openTasks(r).some(t => t.blocker === b));

  return (
    <div style={{padding:'24px 30px 60px'}}>
      {openRow && <ProgramDetail r={openRow} userEmail={userEmail} staff={staff}
                                 busy={saving === openRow.id} onStage={setStage} onOwner={setOwner} onLab={setTestingLab}
                                 onArchive={setArchived}
                                 onDelete={deleteCard}
                                 onTouched={load} canOpenTesting={canOpenTesting}
                                 onClose={()=>setOpenId(null)} />}

      {/* ── THE TOOLBAR ────────────────────────────────────────────────────
          No page title: the sidebar already says Samples. One row carries
          search, the Clients | Board switch (the Codes page's segmented control,
          with counts), the quote-ID box and the board export. On the board view
          the board's own controls follow beneath, unchanged. */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',flexWrap:'wrap',marginBottom:'18px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'380px'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round"
            style={{position:'absolute',left:'12px',top:'50%',transform:'translateY(-50%)'}}><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={ui.search} onChange={e=>setUi('search', e.target.value)} placeholder="Search clients, products, SKUs"
            aria-label="Search clients, products, SKUs"
            style={{width:'100%',border:'1px solid var(--line)',borderRadius:'10px',padding:'10px 12px 10px 34px',fontSize:'13.5px',outline:'none',
                    fontFamily:'var(--sans)',background:'#fff',color:'var(--ink)',boxSizing:'border-box',boxShadow:'0 1px 2px rgba(15,23,41,.04)'}} />
        </div>
        <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px'}}>
          {[['companies','Clients',companies.length],['board','Board',board.length]].map(([v,l,n]) => {
            const on = (ui.view||'companies') === v;
            return (
              <button key={v} onClick={()=>{ setUi('view', v); if (v === 'companies') setUi('companyId', ''); }} aria-pressed={on}
                style={{display:'inline-flex',alignItems:'center',gap:'7px',padding:'8px 15px',borderRadius:'9px',border:'none',cursor:'pointer',
                        fontSize:'13px',fontWeight:600,letterSpacing:'-.01em',fontFamily:'var(--sans)',
                        background:on ? 'var(--ink)' : 'transparent',color:on ? '#fff' : '#5A5A5E',
                        boxShadow:on ? '0 1px 3px rgba(0,0,0,.18)' : 'none',transition:'.14s'}}>
                {l}<span style={{fontSize:'11px',fontWeight:700,borderRadius:'20px',padding:'1px 7px',
                                 background:on ? 'rgba(255,255,255,.22)' : '#DCDCE0',color:on ? '#fff' : '#6A6A6E'}}>{n}</span>
              </button>
            );
          })}
        </div>
        <div style={{flex:1}} />
        <CardFromQuoteBox staff={staff} userEmail={userEmail} onOpen={id => setOpenId(id)} onReload={load} />
        <ExportButton count={exportCards.length} busy={boardExporting} align="right"
          note={'Every card (' + exportCards.length + '), filters not applied'}
          onXlsx={exportBoardXlsx} onCsv={exportBoardCsv} />
      </div>

      {(ui.view||'companies') === 'companies' && (
        openCompany ? (
          <ClientDetail key={openCompany.id} name={openCompany.name} list={openCompany.list} ink={inkOf[openCompany.name] || CLIENT_INKS[0]}
            staff={staff} userEmail={userEmail} carriers={carriers}
            saving={saving} onStage={setStage} onOpenCard={id => setOpenId(id)} onTouched={load} onBack={()=>setUi('companyId', '')} />
        ) : shownCompanies.length === 0 ? (
          <div style={{background:'#fff',border:'1px solid var(--line)',borderRadius:'14px',padding:'56px 32px',textAlign:'center'}}>
            <div style={{fontSize:'18px',fontWeight:600,color:'var(--ink)',marginBottom:'8px',letterSpacing:'-.01em'}}>
              {board.length ? 'No client matches that' : 'No samples in play'}
            </div>
            <div style={{color:'var(--muted)',fontSize:'14px',maxWidth:'460px',margin:'0 auto',lineHeight:1.6}}>
              {board.length ? 'Try another name, SKU or product.' : 'A product shows up here when someone presses Create Sample Card on a quote, or presses Create card above and picks the quote.'}
            </div>
          </div>
        ) : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(236px,1fr))',gap:'16px'}}>
            {shownCompanies.map(c => <ClientTile key={c.id} name={c.name} list={c.list} ink={inkOf[c.name] || CLIENT_INKS[0]} carriers={carriers} onOpen={()=>setUi('companyId', c.id)} />)}
          </div>
        )
      )}

      {(ui.view||'companies') === 'board' && (<>
      {(STALLED_POSSIBLE || DUE_BACK_ON || CHECKLIST_ON) && (
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',
                   gap:'12px',marginBottom:'18px'}}>
        {[
          { k:'Stalled',         v:stalledCards.length, c:HEALTH.stalled.color, on:STALLED_POSSIBLE,
            t:CHECKLIST_ON ? 'A sample is overdue, or the card has not moved and somebody is waiting on us'
                           : 'A sample is overdue' },
          { k:'Overdue samples', v:overdueCards.length, c:HEALTH.stalled.color, on:DUE_BACK_ON,
            t:'Due back date has passed while the card is in Sampling or Revision' },
          { k:'Waiting on us',        v:waitingOn('us').length,      c:BLOCKERS.us.dot,      f:'us',
            t:'Cards with an open task waiting on us. Click to show only those' },
          { k:'Waiting on clients',   v:waitingOn('client').length,  c:BLOCKERS.client.dot,  f:'client',
            t:'Cards with an open task waiting on the client. Click to show only those' },
          { k:'Waiting on factories', v:waitingOn('factory').length, c:BLOCKERS.factory.dot, f:'factory',
            t:'Cards with an open task waiting on the factory. Click to show only those' },
        ].filter(m => (CHECKLIST_ON || !m.f) && m.on !== false).map(m => {
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
      )}

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'14px'}}>
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
      {CHECKLIST_ON && ui.blocker && (
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
            A card appears when somebody presses Create Sample Card on a quote. Nothing else makes one.
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
        only when somebody presses Create Sample Card on a quote. Nothing here moves on its
        own &mdash; an order, a test report or a change on Testing is reported on the card
        and never acts on it.
      </p>
      </>)}
    </div>
  );
}
