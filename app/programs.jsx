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
// THE STORED VALUE STAYS complete, AND ONLY THE WORD CHANGES. Riley reads the end
// of the pipeline as In Production, so that is what the section, the stage control
// and the finished list say -- but renaming the value would mean a script, a CHECK
// change and a migration for a relabelling, and every row already on complete.
//
// IN PRODUCTION rather than bare Production, deliberately. products.product_stage
// has its own Production value, and the card shows both within inches of each
// other in what the system knows. Two different things called the same word on one
// screen is a question somebody has to stop and work out.
const COMPLETE_LABEL = 'In Production';

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
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onProduct, onClose, onTouched }) {
  return (
    // Wider than it was, because the card carries two tabs now. Still inside the
    // range the other modals in this app use, 420 through 640.
    <Overlay onClose={onClose} maxWidth={720}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy}
                   onStage={onStage} onOwner={onOwner} onProduct={onProduct} onTouched={onTouched} />
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

const STAGE_LABEL = Object.fromEntries([...MANUAL_STAGES, [COMPLETE, COMPLETE_LABEL]]);
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
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner, onProduct, onTouched }) {
  const p = r.products || {};
  const guardedClose = useGuardedClose();
  // ── TWO TABS, BECAUSE THEY ANSWER TO DIFFERENT OWNERS ─────────────────────
  // Card is about this program -- one product for one client. Sampling is about
  // the PRODUCT, and everything on it is shared with every other card for the
  // same SKU and with the Testing product modal. Mixing them on one surface would
  // mean somebody editing a shared note believing it was theirs alone.
  //
  // Transient, and per opening. A tab remembered across cards would land somebody
  // on Sampling for a card they opened to change an owner.
  const [tab, setTab] = useState('card');
  const CARD_TABS = [['card', 'Card'], ['sampling', 'Sampling']];

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

  return (
    <>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>{(r.client||{}).name || '—'}</div>
        </div>
        {/* EXPORT SITS BESIDE THE CLOSE, not on a toolbar of its own. It acts on
            the card in front of somebody, so it belongs in the card's own corner
            -- and aligned right, because that is the edge it ends.

            count={1} is what keeps the pill live; the note under the menu says
            what is actually leaving, since "1 row, as filtered" is the wrong
            sentence for a document. Disabled while a stage or owner write is in
            flight, so a file cannot be built from a card that is mid-change. */}
        <div style={{display:'flex',alignItems:'center',gap:'10px',flexShrink:0}}>
          <ExportButton count={1} busy={exporting || busy} compact align="right"
            note="This card, with its notes"
            onPdf={exportPdf} onXlsx={exportXlsx} onCsv={exportCsv} />
          <button onClick={guardedClose} aria-label="Close"
            style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                    cursor:'pointer',padding:'0 2px',fontFamily:'inherit'}}>×</button>
        </div>
      </div>
      {/* No banners here. The testing-coverage caveat and the one-client note
          earn their place on the Testing page, where the panel is all there is;
          on a card the header already names the client, and a standing caveat
          about catalogue coverage is not what somebody opened a program to read.
          A card-view removal -- LifecyclePanel still shows both. */}
      {/* The segmented control the Testing page uses, at card scale. Matching it
          rather than inventing a third tab style for one modal. */}
      <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',
                   marginTop:'14px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)'}}>
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

      {tab === 'sampling' ? (
        !r.product_id ? (
          <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE',
                       fontSize:'12.5px',color:'#A0A0A4'}}>
            This card has no product linked, so there is nothing to sample against.
          </div>
        ) : (
          <>
            {/* THE LOG FIRST, THE NOTES UNDER IT. The log is the record of what
                happened and the notes are what somebody wants to say about it,
                which is the order they are read in. */}
            <SampleLog productId={r.product_id} programId={r.id} userEmail={userEmail}
                       busy={busy} onTouched={onTouched} />
            {/* filter, because one table now holds both -- see the note on the
                panel. Without it every sample event would list here as a note. */}
            <NotesPanel table="product_notes" keyCol="product_id" keyId={r.product_id}
              insertExtra={{ kind: 'sampling' }} extraCol="kind" extraDefault="sampling"
              filter={{ col:'kind', val:'sampling' }}
              title="Sampling Notes" subtitle="Shared with every card for this product."
              programId={r.id} userEmail={userEmail} onTouched={onTouched} />
          </>
        )
      ) : (
      <>
      {/* ── THE TWO CONTROLS ────────────────────────────────────────────────
          Stage and owner, the only things on this tab that write to the program
          itself. Both are plain selects rather than anything cleverer, because a
          stage move is a deliberate act and a dropdown is the control that reads
          as one. */}
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
            {[...MANUAL_STAGES, [COMPLETE, COMPLETE_LABEL]].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
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
      <SystemKnows r={r} busy={busy} onProduct={onProduct} />
      <NotesPanel table="program_notes" keyCol="program_id" keyId={r.id}
        insertExtra={{ source: 'manual' }} extraCol="source" extraDefault="manual"
        title="General Notes" programId={r.id} userEmail={userEmail} onTouched={onTouched} />
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
  // product_id -> every sample event for it, filled in bulk by load(). Reduced to
  // the latest one per card in enriched below.
  const [samples, setSamples] = useState({});
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
      const [p, nt, se, q, poi, soi, tr, st] = await Promise.all([
        // declared_stage and declared_stage_at are the board now -- the stage a
        // person set, and when they set it. owner_id joins staff_profiles for the
        // name on the card and the owner filter.
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
                + 'updated_at,updated_by,'
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
      ]);
      const e = [p,nt,se,q,poi,soi,tr,st].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
      setStaff(st.data || []);
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
               // The most recent sample for this PRODUCT, so two cards for the
               // same SKU report the same round -- which is the point of the log
               // hanging off the product rather than the program.
               latestSample: latestSampleOf(samples[String(r.product_id)] || []),
               // null when nothing has shipped and nothing is planned.
               shipping: departedOn ? { kind:'departed', on: departedOn }
                       : etdOn      ? { kind:'etd',      on: etdOn }
                       : null,
               onBoard: stage !== COMPLETE };
    });
    // staff and noteCounts are dependencies now: without them a name stays
    // unresolved and a count stays zero until some other change happens to
    // recompute this.
  }, [rows, buckets, staff, noteCounts, samples]);

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
                                 onProduct={setProductField}
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
              <span style={{fontSize:'14px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.01em'}}>{COMPLETE_LABEL}</span>
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
                            {r.stage === COMPLETE ? 'In production since ' + fmt(r.since) : 'Product retired'}
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
