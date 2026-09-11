'use client';
import { useState, useEffect, useMemo } from 'react';
import { SB } from '@/lib/supabase';
import { FilterSelect } from '@/app/components/FilterSelect';
// Overlay, not a hand-rolled backdrop. It carries useDirtyGuard, so a typed note
// is protected from a backdrop click by importing this and nothing else -- which
// is precisely why the guard was put there rather than in each modal.
import { Overlay } from '@/app/components/ModalGuard';
// ONE DERIVATION, shared with the panel. This page fetches differently -- in bulk,
// for every program at once -- but it must not DECIDE differently, which is how
// the awarded tile and the awarded filter ended up disagreeing about who won a
// shipment. lib/lifecycle.js owns the rules; this file owns the fetching.
import {
  PIPELINE_STAGES, fmt, deriveEvents,
  isComplete, currentStage, stageEnteredAt, daysSince, CLIENT_OF, completionOf,
} from '@/lib/lifecycle';
import { ensurePrograms, pairsFromRecords } from '@/lib/programs';

// ── PRODUCT LIFE MANAGEMENT ─────────────────────────────────────────────────
// THE BOARD IS THE PRE-ORDER PIPELINE AND NOTHING ELSE. A program on a
// selectable product with no purchase order line and no sales order line for the
// pair, ever. The moment either appears the program is COMPLETE and leaves the
// board -- derived, never a flag somebody has to set.
//
// That scope is what makes the ladder honest. Sold and Ordered have no fixed
// order at KUI, which is why the six-stage lifecycle has none; the pipeline
// stops before both of them, so Quoted to Sampling to Tested is a real
// sequence. See lib/lifecycle.js and PLM.md.
//
// FOUR BULK QUERIES, NOT FOUR PER PROGRAM. The panel runs four for one product,
// which is right for a modal and catastrophic for a list. Everything is fetched
// once and bucketed by product and client -- about 1,200 rows, flat however many
// programs exist.
const COL = {
  quoted:   { bg:'#EAF3FE', fg:'#0A84FF', bar:'#0A84FF' },
  sampling: { bg:'#F3E8FF', fg:'#7C3AED', bar:'#7C3AED' },
  tested:   { bg:'#DCFCE7', fg:'#15803D', bar:'#15803D' },
};

const norm = t => (t || '').toLowerCase();

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

// The card-open and row-open views are the SAME view, which is the point -- a
// completed program reads exactly as it did on the board, minus what happened
// after it completed. stopAfter carries the completion date, so an incomplete
// program passes null and sees its whole lifecycle.
// ── THE CARD LADDER: QUOTED, SAMPLING, TESTED, COMPLETION ───────────────────
// FOUR ROWS, and deliberately not the six-stage LifecyclePanel. PLM is the
// pre-order pipeline, so Shipped and Delivered are not late stages of a program
// -- they are logistics, and they belong to the shipment.
//
// The fourth row is THE COMPLETION EVENT rather than a fixed "Ordered", because
// a fixed label was measured and found wrong most of the time. Of 192 completed
// programs, 106 -- 55 percent -- were sold and never ordered: an Ordered row
// would have sat empty and greyed on more than half the Completed tab, on
// programs that are finished. 110 completed on a sales order, 82 on a purchase
// order, and 41 have both on the SAME DAY, which is too many to settle by an
// arbitrary pick, so those name both.
//
// Rendered from what the board already holds. The page bulk-fetches quotes, PO
// lines, SO lines and reports for every program at once, so the card needs no
// query of its own and opens instantly -- which is why it no longer uses
// LifecyclePanel, whose four per-product queries would be a round trip on every
// open of data already in hand.
function ProgramLadder({ r }) {
  const ev = r.events || {};
  const p  = r.products || {};

  // Sampling MIRRORS THE BOARD exactly -- the product stage, not a declaration.
  // There is no date behind it (product_stage carries no timestamp), so the row
  // shows no date rather than a dash pretending to be one.
  const sampling = p.product_stage === 'sample' || p.product_stage === 'production';
  // Tested likewise: a report gives a date, a passed compliance flag does not.
  const testedOn = (ev.tested || {}).on || null;
  const tested   = !!ev.tested || p.compliance_status === 'passed';

  const rows = [
    { key:'quoted',   label:'Quoted',   hit:!!ev.quoted, on:(ev.quoted||{}).on || null,
      detail:(ev.quoted||{}).detail || null,
      empty:'No quote names this product for this client.' },
    { key:'sampling', label:'Sampling', hit:sampling, on:null,
      detail:sampling ? 'Product stage is ' + p.product_stage : null,
      empty:'Product is not marked Sample or Production.' },
    { key:'tested',   label:'Tested',   hit:tested, on:testedOn,
      detail:ev.tested ? ((ev.tested||{}).detail || null)
                       : (tested ? 'Compliance status is passed' : null),
      empty:'No test report, and compliance is not marked passed.' },
    // Ordered / Sold / Ordered & Sold when complete; when not, the row names
    // BOTH WAYS OUT, because either one completes the program and promising a
    // purchase order that may never come would be the same error as the fixed
    // label this replaces.
    { key:'done',     label:r.complete ? r.completedBy : 'Ordered or sold',
      hit:r.complete, on:r.completedOn,
      detail:r.complete ? 'This program left the pipeline here.' : null,
      empty:'Not yet ordered or sold.' },
  ];

  return (
    <div style={{marginTop:'14px',display:'flex',flexDirection:'column',gap:'1px'}}>
      {rows.map((row, i) => (
        <div key={row.key} style={{display:'flex',gap:'11px',alignItems:'flex-start',
                                   padding:'9px 0',borderTop:i?'1px solid #F2F2F4':'none'}}>
          <div style={{width:'9px',height:'9px',borderRadius:'50%',marginTop:'4px',flexShrink:0,
                       background:row.hit?'#1D1D1F':'#E5E5EA'}} />
          <div style={{minWidth:0,flex:1}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'baseline'}}>
              <span style={{fontSize:'13px',fontWeight:600,color:row.hit?'#1D1D1F':'#A0A0A4'}}>{row.label}</span>
              {/* No date is not the same as no event: Sampling never has one and
                  a passed compliance flag carries none, so the slot stays empty
                  rather than printing a dash that reads as missing data. */}
              {row.on && <span style={{fontSize:'12px',color:'#5A5A5E',fontVariantNumeric:'tabular-nums'}}>{fmt(row.on)}</span>}
            </div>
            <div style={{fontSize:'11.5px',color:row.hit?'#5A5A5E':'#B0B0B4',marginTop:'2px',lineHeight:1.45}}>
              {row.hit ? (row.detail || '') : row.empty}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// A POPUP, NOT AN INLINE EXPANSION, and the notes box is why the guard matters.
//
// Overlay dismisses on a backdrop click, and every other modal in the app accepts
// that because a half-filled form is recoverable. A note is not -- it is prose
// somebody just wrote and cannot get back. useDirtyGuard watches input events
// inside the card, so typed-but-unsaved text turns the backdrop click into a
// confirm instead of a dismissal. Nothing here has to arrange that beyond using
// Overlay.
function ProgramDetail({ r, userEmail, onClose }) {
  const p = r.products || {};
  return (
    <Overlay onClose={onClose} maxWidth={640}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',marginBottom:'4px'}}>
        <div style={{minWidth:0}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em',marginTop:'2px'}}>{p.name || '—'}</div>
          <div style={{fontSize:'13px',color:'#5A5A5E',marginTop:'3px'}}>{(r.client||{}).name || '—'}</div>
        </div>
        <button onClick={onClose} aria-label="Close"
          style={{background:'none',border:'none',fontSize:'22px',lineHeight:1,color:'#A0A0A4',
                  cursor:'pointer',padding:'0 2px',fontFamily:'inherit'}}>×</button>
      </div>
      {/* No banners here. The testing-coverage caveat and the one-client note
          earn their place on the Testing page, where the panel is all there is;
          on a card the header already names the client, and a standing caveat
          about catalogue coverage is not what somebody opened a program to read.
          A card-view removal -- LifecyclePanel still shows both. */}
      <ProgramLadder r={r} />
      <ProgramNotes programId={r.id} userEmail={userEmail} />
    </Overlay>
  );
}

export default function Programs({ userEmail }) {
  const [rows, setRows]   = useState([]);
  const [ev, setEv]       = useState(null);
  const [loading, setLoad]= useState(true);
  const [err, setErr]     = useState('');
  const [tab, setTab]     = useState('board');      // board | completed
  const [search, setSearch] = useState('');
  const [stageSel, setStageSel] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [sweeping, setSweeping] = useState(false);

  const load = async () => {
    setLoad(true); setErr('');
    try {
      const [p, q, poi, soi, tr] = await Promise.all([
        SB.from('programs')
          .select('id,product_id,client_company_id,expected_ship_date,archived,'
                + 'products(id,sku,name,active,product_stage,compliance_status),client:companies!client_company_id(id,name)')
          .order('created_at', { ascending:true }),
        SB.from('quotes').select('product_id,client_company_id,quote_date,created_at').not('product_id','is',null),
        SB.from('purchase_order_items')
          .select('product_id,purchase_orders(order_date,issued_at,client_company_id,shipment_pos(shipments(actual_departure,actual_arrival)))')
          .not('product_id','is',null),
        SB.from('sales_order_items')
          .select('product_id,sales_orders(order_date,client_company_id)')
          .not('product_id','is',null),
        // Product-wide on purpose -- a test report has no client, and testing is
        // not repeated per client. The panel says the same thing on screen.
        SB.from('test_reports').select('product_id,test_date,issue_date,overall_result').not('product_id','is',null),
      ]);
      const e = [p,q,poi,soi,tr].find(r => r.error);
      if (e) throw new Error(e.error.message);
      setRows(p.data || []);
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
      const complete = isComplete(events);
      // The PRODUCT decides Sampling and Tested now, so the product row goes in
      // rather than a per-program declaration. since is null for Sampling always,
      // and for Tested when compliance rather than a report put it there.
      const stage = currentStage(events, r.products);
      const since = stageEnteredAt(stage, events);
      // Retired products never sit on the board, however incomplete they are --
      // nobody is going to quote a product that is out of the catalogue.
      const retired = (r.products || {}).active === false;
      // THE EARLIER of the two. A program is complete the moment the FIRST order
      // names it -- Riley's rule -- and at KUI either can come first, which is
      // exactly why this takes the minimum rather than assuming Sold leads.
      // Null for a retired-but-never-ordered program, which sorts last rather
      // than pretending to a date.
      // completionOf carries the measurement: 106 of 192 completed programs were
      // SOLD AND NEVER ORDERED, and 41 have both on the same day. Deciding the
      // name here rather than at each render is what stops those 41 being called
      // Sold on the row and Ordered in the ladder.
      const done_ = completionOf(events);
      const completedOn = done_ ? done_.on : null;
      const completedBy = done_ ? done_.label : null;
      return { ...r, events, complete, stage, since, days: daysSince(since), retired,
               completedOn, completedBy, onBoard: !complete && !retired };
    });
  }, [rows, buckets]);

  const board = useMemo(() => enriched.filter(r => r.onBoard), [enriched]);
  const done  = useMemo(() => enriched.filter(r => !r.onBoard), [enriched]);

  const counts = useMemo(() => {
    const c = {}; PIPELINE_STAGES.forEach(([k]) => { c[k] = 0; });
    board.forEach(r => { if (r.stage) c[r.stage] = (c[r.stage]||0) + 1; });
    return c;
  }, [board]);

  const matches = r => {
    if (!search) return true;
    const p = r.products || {};
    return (norm(p.sku) + ' ' + norm(p.name) + ' ' + norm((r.client||{}).name)).includes(norm(search));
  };

  // Membership against the ladder. Empty is All -- no narrowing -- and because
  // every program has exactly ONE current stage here, these counts partition
  // rather than overlap. That is the difference the six-stage chip filter could
  // not offer, and it is a consequence of the pipeline having an order.
  const shownBoard = useMemo(() => board.filter(r =>
    matches(r) && (!stageSel.length || stageSel.includes(r.stage))), [board, search, stageSel]);
  const shownDone  = useMemo(() => done.filter(matches)
    .sort((a,b) => String(b.completedOn||'').localeCompare(String(a.completedOn||''))), [done, search]);

  const stageOptions = useMemo(() => ([
    { value:'', label:'All stages', count:board.length },
    ...PIPELINE_STAGES.map(([v,l]) => ({
      value:v, label:l, color:COL[v].fg, bg:COL[v].bg, count:counts[v]||0 })),
  ]), [counts, board.length]);

  const sweep = async () => {
    setSweeping(true);
    try {
      const pairs = await pairsFromRecords();
      const have = new Set(rows.map(r => r.product_id + '|' + r.client_company_id));
      const missing = []; const seen = new Set();
      for (const [pid, cid] of pairs) {
        const k = pid + '|' + cid;
        if (have.has(k) || seen.has(k)) continue;
        seen.add(k); missing.push([pid, cid]);
      }
      if (!missing.length) { window._toast?.('Nothing to add — every pair already has a program','ok'); setSweeping(false); return; }
      const { error } = await ensurePrograms(missing);
      if (error) { alert('Could not add programs: ' + error.message); setSweeping(false); return; }
      window._toast?.('Added ' + missing.length + ' ' + (missing.length===1?'program':'programs'), 'ok');
      await load();
    } catch (e) { alert('Sweep failed: ' + (e && e.message ? e.message : e)); }
    setSweeping(false);
  };

  if (loading) return <div style={{padding:'28px 30px',color:'#86868B',fontSize:'14px'}}>Reading programs…</div>;
  if (err) return <div style={{padding:'28px 30px',color:'var(--hot)',fontSize:'14px'}}>Could not read programs — {err}</div>;

  const Card = ({ r }) => {
    const p = r.products || {};
    return (
      <div style={{background:'#fff',borderRadius:'12px',boxShadow:'0 1px 2px rgba(0,0,0,.06)',marginBottom:'8px',overflow:'hidden'}}>
        <button onClick={()=>setOpenId(open?null:r.id)}
          style={{display:'block',width:'100%',textAlign:'left',background:'none',border:'none',
                  padding:'11px 13px',cursor:'pointer',fontFamily:'inherit'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'12.5px',color:'#1D1D1F',marginTop:'2px',lineHeight:1.35}}>{p.name || '—'}</div>
          <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'4px'}}>{(r.client||{}).name || '—'}</div>
          {/* THE WHOLE LINE GOES when there is no date, rather than degrading to
              a dash or a zero -- both of those read as a measurement. Sampling
              never has one, and Tested only has one when a report rather than a
              compliance flag put it there. */}
          {r.since && (
            <div style={{fontSize:'11px',color:'#8A8A8E',marginTop:'6px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
              <span>{r.days === 0 ? 'today' : r.days + 'd in stage'}</span>
              <span>· since {fmt(r.since)}</span>
            </div>
          )}
          {r.events.quoted && r.stage !== 'quoted' && (
            <div style={{fontSize:'11px',color:'#8A8A8E',marginTop:'2px'}}>Quoted {fmt(r.events.quoted.on)}</div>
          )}
        </button>

      </div>
    );
  };

  const openRow = enriched.find(x => x.id === openId) || null;

  return (
    <div style={{padding:'26px 30px 60px'}}>
      {openRow && <ProgramDetail r={openRow} userEmail={userEmail} onClose={()=>setOpenId(null)} />}
      {/* Centred, and the count on its own line beneath. The description
          paragraph that sat here is gone -- the columns and their placeholders
          already say what the board is, and a paragraph nobody rereads after the
          first visit is a paragraph that only costs vertical space above the
          thing people came for. */}
      <div style={{textAlign:'center',marginBottom:'18px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
        <div style={{fontSize:'13px',color:'#86868B',marginTop:'5px'}}>
          {board.length} in the pipeline · {done.length} complete
        </div>
      </div>

      <div style={{display:'flex',gap:'6px',marginBottom:'16px'}}>
        {[['board','Pipeline',board.length],['completed','Completed',done.length]].map(([v,l,n])=>(
          <button key={v} onClick={()=>{setTab(v);setOpenId(null);}}
            style={{fontSize:'12.5px',fontWeight:600,borderRadius:'980px',padding:'7px 14px',border:'none',
                    cursor:'pointer',fontFamily:'inherit',
                    background:tab===v?'#1D1D1F':'#F2F2F4',color:tab===v?'#fff':'#5A5A5E'}}>
            {l} <span style={{opacity:.65}}>{n}</span>
          </button>
        ))}
      </div>

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'18px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'320px'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, SKU or client…"
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',
                    fontSize:'13.5px',outline:'none',fontFamily:'inherit',background:'#fff',boxSizing:'border-box'}} />
        </div>
        {tab==='board' && (
          <FilterSelect multiple label="All stages" value={stageSel} onChange={setStageSel} options={stageOptions} />
        )}
        <div style={{flex:1}} />
        <button onClick={sweep} disabled={sweeping}
          title="Create programs for any product and client pair the records prove but the list is missing"
          style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'7px 13px',
                  cursor:sweeping?'default':'pointer',border:'1px solid rgba(0,0,0,.1)',
                  fontFamily:'inherit',background:'#fff',color:sweeping?'#B0B0B4':'#5A5A5E'}}>
          {sweeping ? 'Checking…' : 'Sync from records'}
        </button>
      </div>

      {tab==='board' ? (
        <>
          {/* Tiles first, the original dashboard shape. They read the WHOLE board
              rather than the filtered view, so narrowing never makes a total lie. */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px',marginBottom:'18px'}}>
            {PIPELINE_STAGES.map(([k,l,src])=>(
              <button key={k} onClick={()=>setStageSel(stageSel.length===1&&stageSel[0]===k?[]:[k])}
                style={{background:'#fff',borderRadius:'14px',padding:'14px 16px',textAlign:'left',cursor:'pointer',
                        fontFamily:'inherit',border:'none',borderTop:'3px solid '+COL[k].bar,
                        boxShadow:stageSel.length===1&&stageSel[0]===k?'0 0 0 2px '+COL[k].fg:'0 1px 3px rgba(0,0,0,.05)'}}>
                <div style={{fontSize:'22px',fontWeight:700,color:'#1D1D1F',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{counts[k]||0}</div>
                <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'6px'}}>{l}</div>
                <div style={{fontSize:'10px',color:'#A0A0A4',marginTop:'2px'}}>{src}</div>
              </button>
            ))}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(240px,1fr))',gap:'12px',alignItems:'start'}}>
            {PIPELINE_STAGES.map(([k,l])=>{
              const inCol = shownBoard.filter(r => r.stage === k);
              return (
                <div key={k}>
                  <div style={{display:'flex',alignItems:'center',gap:'7px',padding:'0 2px 9px'}}>
                    <span style={{width:'8px',height:'8px',borderRadius:'50%',background:COL[k].bar}} />
                    <span style={{fontSize:'12px',fontWeight:700,color:'#1D1D1F'}}>{l}</span>
                    <span style={{fontSize:'11.5px',color:'#A0A0A4'}}>{inCol.length}</span>
                  </div>
                  {inCol.length === 0 ? (
                    <div style={{border:'1px dashed #E5E5EA',borderRadius:'12px',padding:'16px 13px',
                                 fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5}}>
                      {k==='sampling'
                        ? 'No product here is marked Sample or Production.'
                        : k==='tested'
                        ? 'Nothing here has a test report or a passed compliance status.'
                        : 'Nothing has reached Quoted.'}
                    </div>
                  ) : inCol.map(r => <Card key={r.id} r={r} />)}
                </div>
              );
            })}
          </div>
          {/* Cards cannot be dragged, and a board that looks draggable but is not
              owes an explanation rather than a shrug. */}
          <p style={{margin:'18px 0 0',fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.55,maxWidth:'720px'}}>
            Cards are not dragged, and nothing here is set on the card. Quoted follows the
            quote; Sampling follows the product&rsquo;s Sample or Production stage; Tested follows a
            test report or a passed compliance status. Change the product on Testing and the card
            moves on its own.
          </p>
        </>
      ) : (
        <div style={{background:'#fff',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',overflow:'hidden'}}>
          {shownDone.length === 0 ? (
            <div style={{padding:'44px 24px',textAlign:'center',fontSize:'13.5px',color:'#86868B'}}>Nothing here.</div>
          ) : shownDone.map((r,i) => {
            const p = r.products || {};
            return (
              <div key={r.id} style={{borderTop:i>0?'1px solid #F5F5F7':'none'}}>
                <button onClick={()=>setOpenId(open?null:r.id)}
                  style={{display:'flex',width:'100%',textAlign:'left',background:'none',border:'none',gap:'12px',
                          padding:'11px 18px',cursor:'pointer',fontFamily:'inherit',alignItems:'center',flexWrap:'wrap'}}>
                  <span style={{fontFamily:'var(--mono)',fontSize:'12px',fontWeight:700,color:'#1D1D1F',minWidth:'110px'}}>{p.sku || '—'}</span>
                  <span style={{fontSize:'13px',color:'#1D1D1F',flex:'1 1 200px'}}>{p.name || '—'}</span>
                  <span style={{fontSize:'12px',color:'#5A5A5E',minWidth:'130px'}}>{(r.client||{}).name || '—'}</span>
                  <span style={{fontSize:'11.5px',color:'#8A8A8E',minWidth:'150px'}}>
                    {r.complete ? r.completedBy + ' ' + fmt(r.completedOn) : 'Product retired'}
                  </span>
                  {r.retired && (
                    <span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',
                                  color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 8px'}}>History</span>
                  )}
                </button>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
