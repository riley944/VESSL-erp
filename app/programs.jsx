'use client';
import { useState, useEffect, useMemo } from 'react';
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
  currentStage, daysSince, CLIENT_OF,
} from '@/lib/lifecycle';
// Sync from records is gone with the derived board -- nothing here creates a
// program any more. The quote-form tick is the only door.
// Tab, search, stage filter and the retired toggle survive going into a program and
// coming back, and are gone on reload. See the note at the top of lib/pageState.js.
import { usePageState } from '@/lib/pageState';
// COL, the per-stage colour table, went with the derived tiles and columns it
// dressed. The manual board is one ink -- nine stages in nine colours would be
// decoration competing with the stale flag, which is the only colour that means
// something here.


const norm = t => (t || '').toLowerCase();

// ── THE STAGES, AND THEY ARE SET BY A PERSON ────────────────────────────────
// The nine values script 60 widened the CHECK to. Sample is five rungs rather
// than one because a sample round is the thing that actually repeats at KUI, and
// a single Sampling column could not say whether a card had been round once or
// five times.
//
// Complete is on this list because it is a stage somebody sets -- a sales order
// does NOT move a card, on Riley decision. It lives on its own tab rather than as
// a tenth column, for the same reason Archived always did.
const MANUAL_STAGES = [
  ['quoted',         'Quoted'],
  ['sample_1',       'Sample 1'],
  ['sample_2',       'Sample 2'],
  ['sample_3',       'Sample 3'],
  ['sample_4',       'Sample 4'],
  ['sample_5',       'Sample 5'],
  ['testing',        'Testing'],
  ['purchase_order', 'Purchase Order'],
];
const COMPLETE = 'complete';

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
// APPEND ONLY, and not merely by convention -- authenticated holds SELECT and
// INSERT on vessl.program_notes and nothing else. UPDATE and DELETE were never
// granted by script 48, so an edit control would fail at the database even if
// somebody built one. There is no edit control and no delete control here, and
// the grants are what make that a guarantee rather than a promise.
//
// Newest first, because the last thing said is the thing being caught up on.
function ProgramNotes({ programId, userEmail }) {
  const [notes, setNotes] = useState(null);
  const [text, setText]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  const load = async () => {
    const { data, error } = await SB.from('program_notes')
      .select('id,author,source,note,created_at')
      .eq('program_id', programId)
      .order('created_at', { ascending:false });
    if (error) { setErr(error.message); setNotes([]); return; }
    setNotes(data || []);
  };
  useEffect(()=>{ setNotes(null); load(); }, [programId]);

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
    await load();
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
        placeholder="Add a note — it cannot be edited or deleted afterwards"
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
          {notes.map(n => (
            <div key={n.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
              <div style={{fontSize:'13px',color:'#1D1D1F',lineHeight:1.5,whiteSpace:'pre-wrap'}}>{n.note}</div>
              <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'5px'}}>
                {n.author || 'unknown'} · {when(n.created_at)}
                {n.source && n.source !== 'manual' ? ' · ' + n.source : ''}
              </div>
            </div>
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
function ProgramDetail({ r, userEmail, staff, busy, onStage, onOwner, onClose }) {
  return (
    <Overlay onClose={onClose} maxWidth={640}>
      <ProgramCard r={r} userEmail={userEmail} staff={staff} busy={busy} onStage={onStage} onOwner={onOwner} />
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

// Split out so the x can read guardedClose from context. The provider lives
// INSIDE Overlay, so a hook called in ProgramDetail would sit above it and get
// the default -- the close button has to be a child to be guarded.
function ProgramCard({ r, userEmail, staff = [], busy = false, onStage, onOwner }) {
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
      <ProgramNotes programId={r.id} userEmail={userEmail} />
    </>
  );
}

export default function Programs({ userEmail }) {
  const [rows, setRows]   = useState([]);
  const [ev, setEv]       = useState(null);
  const [loading, setLoad]= useState(true);
  const [err, setErr]     = useState('');
  // Which tab, the search box, the stage filter and the retired toggle -- kept across
  // navigation, so opening a program and coming back lands where it left. openId stays
  // plain below, because an expanded card is not a filter.
  const [ui, setUi] = usePageState('programs', { tab:'board', search:'', stageSel:[], showRetired:false, ownerSel:[] });
  const [openId, setOpenId] = useState(null);
  const [staff, setStaff] = useState([]);
  // Set while a stage or an owner is being written, so the control can say so and
  // refuse a second click. Not in the page store -- it is in-flight, not a choice.
  const [saving, setSaving] = useState(null);
  // showRetired is ui.showRetired, in the page store above.

  const load = async () => {
    setLoad(true); setErr('');
    try {
      const [p, q, poi, soi, tr, st] = await Promise.all([
        // declared_stage and declared_stage_at are the board now -- the stage a
        // person set, and when they set it. owner_id joins staff_profiles for the
        // name on the card and the owner filter.
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,declared_stage,declared_stage_at,owner_id,'
                + 'products(id,sku,name,active,product_stage,compliance_status),client:companies!client_company_id(id,name),'
                + 'owner:staff_profiles!owner_id(id,email,full_name)')
          .order('created_at', { ascending:true }),
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
      const e = [p,q,poi,soi,tr,st].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
      setStaff(st.data || []);
      setEv({ quotes:q.data||[], poItems:poi.data||[], soItems:soi.data||[], reports:tr.data||[] });
    } catch (x) {
      setErr(x && x.message ? x.message : String(x));
    }
    setLoad(false);
  };
  useEffect(()=>{ load(); }, []);

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
               onBoard: stage !== COMPLETE };
    });
  }, [rows, buckets]);

  // ── WRITING A STAGE, AND WRITING AN OWNER ───────────────────────────────────
  // The only two things this page changes. Both re-read from the database after
  // the write rather than patching state, so what is on screen is what is stored.
  //
  // A REASSIGNMENT WRITES ITS OWN NOTE, on Riley decision -- program_notes is
  // append-only by grant, so the record cannot be quietly tidied later. The note
  // is written after the update lands; a failed note leaves a correct owner and a
  // missing line, which is the better way round.
  const setStage = async (r, next) => {
    if (!next || next === r.stage) return;
    setSaving(r.id);
    const { error } = await SB.from('programs').update({ declared_stage: next, updated_at: new Date().toISOString() }).eq('id', r.id);
    if (error) { window._toast?.('Could not move the card — ' + error.message, 'err'); setSaving(null); return; }
    await load(); setSaving(null);
  };

  const setOwner = async (r, nextId) => {
    const next = nextId || null;
    if (next === (r.owner_id || null)) return;
    setSaving(r.id);
    const { error } = await SB.from('programs').update({ owner_id: next, updated_at: new Date().toISOString() }).eq('id', r.id);
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

  // Membership against the ladder. Empty is All -- no narrowing -- and because
  // every program has exactly ONE current stage here, these counts partition
  // rather than overlap. That is the difference the six-stage chip filter could
  // not offer, and it is a consequence of the pipeline having an order.
  const shownBoard = useMemo(() => board.filter(r =>
    matches(r) && ownerMatches(r) && (!ui.stageSel.length || ui.stageSel.includes(r.stage || 'none'))),
    [board, ui.search, ui.stageSel, ui.ownerSel]);
  const shownDone  = useMemo(() => done.filter(r => matches(r) && ownerMatches(r))
    .sort((a,b) => String(b.since||'').localeCompare(String(a.since||''))), [done, ui.search, ui.ownerSel]);

  const stageOptions = useMemo(() => ([
    { value:'', label:'All stages', count:board.length },
    ...MANUAL_STAGES.map(([v,l]) => ({ value:v, label:l, count:counts[v]||0 })),
    // A card whose stage was cleared. Nothing creates one today -- the tick always
    // writes quoted -- but the column is nullable, so the board says so rather
    // than dropping the card out of every view.
    { value:'none', label:'No stage set', color:'var(--muted)', count:counts.none||0 },
  ]), [counts, board.length]);

  // The sweep that used to sit here read every quote, purchase order line and sales
  // order line and created a program for any pair the records proved but the board
  // was missing. It was the right tool for a DERIVED board. On a manual one it is a
  // button that fills the list with cards nobody chose, which is the thing this
  // rework exists to stop, so it is gone along with the five automatic call sites.

  if (loading) return <div style={{padding:'28px 30px',color:'#86868B',fontSize:'14px'}}>Reading programs…</div>;
  if (err) return <div style={{padding:'28px 30px',color:'var(--hot)',fontSize:'14px'}}>Could not read programs — {err}</div>;

  const Card = ({ r }) => {
    const p = r.products || {};
    return (
      <div style={{background:'#fff',borderRadius:'12px',boxShadow:'0 1px 2px rgba(0,0,0,.06)',marginBottom:'8px',overflow:'hidden'}}>
        <button onClick={()=>setOpenId(openId===r.id?null:r.id)}
          style={{display:'block',width:'100%',textAlign:'left',background:'none',border:'none',
                  padding:'11px 13px',cursor:'pointer',fontFamily:'inherit'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'12.5px',color:'#1D1D1F',marginTop:'2px',lineHeight:1.35}}>{p.name || '—'}</div>
          <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'4px'}}>{(r.client||{}).name || '—'}</div>
          {testingNotRequired(p) && (
            <div style={{marginTop:'5px'}}>
              <span style={{fontSize:'9.5px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',
                            color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 7px'}}>
                Testing not required
              </span>
            </div>
          )}
          {/* OWNER ON THE FACE OF THE CARD. Unowned is said in words and in red
              rather than left blank, because a blank reads as a layout gap and
              this is the one state somebody needs to notice. */}
          <div style={{fontSize:'11px',marginTop:'5px',color:r.ownerName?'#5A5A5E':'var(--hot)'}}>
            {r.ownerName || 'Unowned'}
          </div>
          {/* Every card has a stage date now -- declared_stage_at is stamped on
              every change -- so this line no longer disappears the way the derived
              one had to. */}
          {r.since && (
            <div style={{fontSize:'11px',color:r.stale?'#8a5a00':'#8A8A8E',marginTop:'6px',display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center'}}>
              {r.stale && <span style={{width:'6px',height:'6px',borderRadius:'50%',background:'#d97706',flexShrink:0}} />}
              <span>{r.days === 0 ? 'today' : r.days + 'd in stage'}</span>
              <span>· since {fmt(r.since)}</span>
            </div>
          )}
        </button>

      </div>
    );
  };

  const openRow = enriched.find(x => x.id === openId) || null;

  return (
    <div style={{padding:'26px 30px 60px'}}>
      {openRow && <ProgramDetail r={openRow} userEmail={userEmail} staff={staff}
                                 busy={saving === openRow.id} onStage={setStage} onOwner={setOwner}
                                 onClose={()=>setOpenId(null)} />}
      {/* Centred, and the count on its own line beneath. The description
          paragraph that sat here is gone -- the columns and their placeholders
          already say what the board is, and a paragraph nobody rereads after the
          first visit is a paragraph that only costs vertical space above the
          thing people came for. */}
      <div style={{textAlign:'center',marginBottom:'18px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
        <div style={{fontSize:'13px',color:'#86868B',marginTop:'5px'}}>
          {board.length} in the pipeline · {finished.length} archived
        </div>
      </div>

      <div style={{display:'flex',gap:'6px',marginBottom:'16px'}}>
        {[['board','Pipeline',board.length],['archived','Archived',finished.length]].map(([v,l,n])=>(
          <button key={v} onClick={()=>{setUi('tab', v);setOpenId(null);}}
            style={{fontSize:'12.5px',fontWeight:600,borderRadius:'980px',padding:'7px 14px',border:'none',
                    cursor:'pointer',fontFamily:'inherit',
                    background:ui.tab===v?'#1D1D1F':'#F2F2F4',color:ui.tab===v?'#fff':'#5A5A5E'}}>
            {l} <span style={{opacity:.65}}>{n}</span>
          </button>
        ))}
      </div>

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'18px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'320px'}}>
          <input value={ui.search} onChange={e=>setUi('search', e.target.value)} placeholder="Search product, SKU or client…"
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',
                    fontSize:'13.5px',outline:'none',fontFamily:'inherit',background:'#fff',boxSizing:'border-box'}} />
        </div>
        {ui.tab==='board' && (
          <FilterSelect multiple label="All stages" value={ui.stageSel} onChange={v=>setUi('stageSel', v)} options={stageOptions} />
        )}
        {/* Owner narrows both tabs, because "what is Kristy carrying" is as fair a
            question about finished work as about live work. */}
        <FilterSelect multiple label="All owners" value={ui.ownerSel} onChange={v=>setUi('ownerSel', v)} options={ownerOptions} />
        <div style={{flex:1}} />
      </div>

      {ui.tab==='board' ? (
        <>
          {/* Tiles first, the original dashboard shape. They read the WHOLE board
              rather than the filtered view, so narrowing never makes a total lie. */}
          {/* Tiles read the WHOLE board rather than the filtered view, so narrowing
              never makes a total lie. No source line under the label any more --
              every one of these is set by a person, so there is nothing to cite. */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))',gap:'10px',marginBottom:'18px'}}>
            {MANUAL_STAGES.map(([k,l])=>(
              <button key={k} onClick={()=>setUi('stageSel', ui.stageSel.length===1&&ui.stageSel[0]===k?[]:[k])}
                style={{background:'#fff',borderRadius:'14px',padding:'13px 15px',textAlign:'left',cursor:'pointer',
                        fontFamily:'inherit',border:'none',borderTop:'3px solid #1D1D1F',
                        boxShadow:ui.stageSel.length===1&&ui.stageSel[0]===k?'0 0 0 2px #1D1D1F':'0 1px 3px rgba(0,0,0,.05)'}}>
                <div style={{fontSize:'21px',fontWeight:700,color:'#1D1D1F',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{counts[k]||0}</div>
                <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'6px'}}>{l}</div>
              </button>
            ))}
          </div>

          {/* Eight columns plus a ninth that only appears when it has something in
              it. A permanent empty No stage set column would be a standing invitation
              to a state nothing produces. */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(215px,1fr))',gap:'12px',alignItems:'start'}}>
            {[...MANUAL_STAGES, ...((counts.none||0) > 0 ? [['none','No stage set']] : [])].map(([k,l])=>{
              const inCol = shownBoard.filter(r => (r.stage || 'none') === k);
              return (
                <div key={k}>
                  <div style={{display:'flex',alignItems:'center',gap:'7px',padding:'0 2px 9px'}}>
                    <span style={{width:'8px',height:'8px',borderRadius:'50%',background:k==='none'?'#C7C7CC':'#1D1D1F'}} />
                    <span style={{fontSize:'12px',fontWeight:700,color:'#1D1D1F'}}>{l}</span>
                    <span style={{fontSize:'11.5px',color:'#A0A0A4'}}>{inCol.length}</span>
                  </div>
                  {inCol.length === 0 ? (
                    <div style={{border:'1px dashed #E5E5EA',borderRadius:'12px',padding:'16px 13px',
                                 fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5}}>
                      Nothing here. Cards arrive at Quoted and are moved on the card.
                    </div>
                  ) : inCol.map(r => <Card key={r.id} r={r} />)}
                </div>
              );
            })}
          </div>
          {/* Cards cannot be dragged, and a board that looks draggable but is not
              owes an explanation rather than a shrug. */}
          <p style={{margin:'18px 0 0',fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.55,maxWidth:'720px'}}>
            Cards are not dragged. Open one to change its stage, change its owner or add a
            note. Nothing here moves on its own &mdash; an order, a test report or a change on
            Testing is reported on the card and never acts on it. A card appears only when
            somebody ticks Create PLM program on a quote.
          </p>
        </>
      ) : (
        <>
        <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'9px'}}>
          <label style={{display:'inline-flex',alignItems:'center',gap:'7px',fontSize:'12px',
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
                          padding:'11px 18px',cursor:'pointer',fontFamily:'inherit',alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:700,color:'#1D1D1F',minWidth:'110px'}}>{p.sku || '—'}</span>
                  <span style={{fontSize:'13px',color:'#1D1D1F',flex:'1 1 200px'}}>{p.name || '—'}</span>
                  <span style={{fontSize:'12px',color:'#5A5A5E',minWidth:'130px'}}>{(r.client||{}).name || '—'}</span>
                  {/* CATALOGUE STATUS, worded and coloured exactly as on the Products
                      list -- green Active, red Inactive, grey Not set -- so a product
                      reads the same on both screens. products.active is three-state and
                      only false is Inactive; NULL is undecided, not retired. */}
                  <span style={{fontSize:'12px',color:'#86868B',minWidth:'80px',display:'inline-flex',alignItems:'center',gap:'5px'}}>
                    <span style={{width:'6px',height:'6px',borderRadius:'50%',flexShrink:0,
                      background: p.active === false ? 'var(--hot)' : p.active === true ? 'var(--ok)' : 'var(--muted)'}} />
                    {p.active === false ? 'Inactive' : p.active === true ? 'Active' : 'Not set'}
                  </span>
                  <span style={{fontSize:'11.5px',color:'#8A8A8E',minWidth:'150px'}}>
                    {r.stage === COMPLETE ? 'Marked complete ' + fmt(r.since) : 'Product retired'}
                  </span>
                  <span style={{fontSize:'11.5px',minWidth:'110px',color:r.ownerName?'#8A8A8E':'var(--hot)'}}>
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
        </>
      )}
    </div>
  );
}
