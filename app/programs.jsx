'use client';
import { useState, useEffect, useMemo } from 'react';
import { SB } from '@/lib/supabase';
import { FilterSelect } from '@/app/components/FilterSelect';
import { LifecyclePanel } from '@/app/components/LifecyclePanel';
// ONE DERIVATION, shared with the panel. This page fetches differently -- in bulk,
// for every program at once -- but it must not DECIDE differently, which is how
// the awarded tile and the awarded filter ended up disagreeing about who won a
// shipment. lib/lifecycle.js owns the rules; this file owns the fetching.
import {
  PIPELINE_STAGES, fmt, deriveEvents,
  isComplete, currentStage, stageEnteredAt, daysSince, CLIENT_OF,
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
// stops before both of them, so Inquiry to Quoted to Sampling to Tested is a
// real sequence. See lib/lifecycle.js and PLM.md.
//
// FOUR BULK QUERIES, NOT FOUR PER PROGRAM. The panel runs four for one product,
// which is right for a modal and catastrophic for a list. Everything is fetched
// once and bucketed by product and client -- about 1,200 rows, flat however many
// programs exist.
const COL = {
  inquiry:  { bg:'#F2F2F4', fg:'#5A5A5E', bar:'#C7C7CC' },
  quoted:   { bg:'#EAF3FE', fg:'#0A84FF', bar:'#0A84FF' },
  sampling: { bg:'#F3E8FF', fg:'#7C3AED', bar:'#7C3AED' },
  tested:   { bg:'#DCFCE7', fg:'#15803D', bar:'#15803D' },
};

const norm = t => (t || '').toLowerCase();

export default function Programs({ userEmail }) {
  const [rows, setRows]   = useState([]);
  const [ev, setEv]       = useState(null);
  const [loading, setLoad]= useState(true);
  const [err, setErr]     = useState('');
  const [tab, setTab]     = useState('board');      // board | completed
  const [search, setSearch] = useState('');
  const [stageSel, setStageSel] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(null);
  const [sweeping, setSweeping] = useState(false);

  const load = async () => {
    setLoad(true); setErr('');
    try {
      const [p, q, poi, soi, tr] = await Promise.all([
        SB.from('programs')
          .select('id,product_id,client_company_id,declared_stage,declared_stage_at,expected_ship_date,archived,'
                + 'products(id,sku,name,active),client:companies!client_company_id(id,name)')
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
      const stage = currentStage(events, r.declared_stage);
      const since = stageEnteredAt(stage, events, r.declared_stage_at);
      // Retired products never sit on the board, however incomplete they are --
      // nobody is going to quote a product that is out of the catalogue.
      const retired = (r.products || {}).active === false;
      // THE EARLIER of the two. A program is complete the moment the FIRST order
      // names it -- Riley's rule -- and at KUI either can come first, which is
      // exactly why this takes the minimum rather than assuming Sold leads.
      // Null for a retired-but-never-ordered program, which sorts last rather
      // than pretending to a date.
      const sOn = (events.sold || {}).on || null;
      const oOn = (events.ordered || {}).on || null;
      const completedOn = [sOn, oOn].filter(Boolean).sort()[0] || null;
      // Which one it was, so the row can name it rather than guess from presence.
      const completedBy = !completedOn ? null : (completedOn === sOn ? 'Sold' : 'Ordered');
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
    ...PIPELINE_STAGES.map(([v,l,kind]) => ({
      value:v, label:l + (kind==='declared' ? ' · declared' : ''),
      color:COL[v].fg, bg:COL[v].bg, count:counts[v]||0 })),
  ]), [counts, board.length]);

  const setDeclared = async (r, value) => {
    setSaving(r.id);
    // declared_stage_at is NOT written here. trg_programs_declared_stage_at
    // stamps it, so the page cannot forget and neither can any other writer.
    const { data, error } = await SB.from('programs')
      .update({ declared_stage: value || null, updated_at: new Date().toISOString() })
      .eq('id', r.id).select('declared_stage,declared_stage_at').single();
    setSaving(null);
    if (error) { alert('Could not save: ' + error.message); return; }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...data } : x));
  };

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
    const open = openId === r.id;
    const p = r.products || {};
    return (
      <div style={{background:'#fff',borderRadius:'12px',boxShadow:'0 1px 2px rgba(0,0,0,.06)',marginBottom:'8px',overflow:'hidden'}}>
        <button onClick={()=>setOpenId(open?null:r.id)}
          style={{display:'block',width:'100%',textAlign:'left',background:'none',border:'none',
                  padding:'11px 13px',cursor:'pointer',fontFamily:'inherit'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:700,color:'#1D1D1F'}}>{p.sku || '—'}</div>
          <div style={{fontSize:'12.5px',color:'#1D1D1F',marginTop:'2px',lineHeight:1.35}}>{p.name || '—'}</div>
          <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'4px'}}>{(r.client||{}).name || '—'}</div>
          <div style={{fontSize:'11px',color:'#8A8A8E',marginTop:'6px',display:'flex',gap:'8px',flexWrap:'wrap'}}>
            {/* days is null when a stage was declared before script 49 existed.
                Saying so beats printing a zero that reads like a fact. */}
            <span>{r.days == null ? 'just now' : r.days === 0 ? 'today' : r.days + 'd in stage'}</span>
            {r.since && <span>· since {fmt(r.since)}</span>}
          </div>
          {r.events.quoted && r.stage !== 'quoted' && (
            <div style={{fontSize:'11px',color:'#8A8A8E',marginTop:'2px'}}>Quoted {fmt(r.events.quoted.on)}</div>
          )}
        </button>
        <div style={{padding:'0 13px 11px',display:'flex',gap:'6px',alignItems:'center'}} onClick={e=>e.stopPropagation()}>
          <select value={r.declared_stage || ''} disabled={saving===r.id}
            onChange={e=>setDeclared(r, e.target.value)}
            aria-label={'Declared stage for ' + (p.sku||'this program')}
            style={{border:'1px solid rgba(0,0,0,.1)',borderRadius:'7px',padding:'4px 6px',fontSize:'11.5px',
                    fontWeight:600,background:'#fff',fontFamily:'inherit',
                    color:r.declared_stage?'#1D1D1F':'#8A8A8E',width:'100%'}}>
            <option value="">Not declared</option>
            <option value="inquiry">Inquiry</option>
            <option value="sampling">Sampling</option>
          </select>
        </div>
        {open && (
          <div style={{padding:'2px 13px 14px',borderTop:'1px solid #F5F5F7',background:'#FCFCFD'}}>
            <LifecyclePanel product={r.products} clientId={r.client_company_id} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{padding:'26px 30px 60px'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:'12px',flexWrap:'wrap',marginBottom:'6px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Product Life Management</h1>
        <span style={{fontSize:'13px',color:'#86868B'}}>
          {board.length} in the pipeline · {done.length} complete
        </span>
      </div>
      <p style={{margin:'0 0 16px',fontSize:'12.5px',color:'#8A8A8E',lineHeight:1.55,maxWidth:'760px'}}>
        Everything before the first order. A program leaves the board the moment a purchase
        order or sales order names it — nothing to close by hand. Quoted and Tested are read
        from records; Inquiry and Sampling are yours to set.
      </p>

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
            {PIPELINE_STAGES.map(([k,l,kind])=>(
              <button key={k} onClick={()=>setStageSel(stageSel.length===1&&stageSel[0]===k?[]:[k])}
                style={{background:'#fff',borderRadius:'14px',padding:'14px 16px',textAlign:'left',cursor:'pointer',
                        fontFamily:'inherit',border:'none',borderTop:'3px solid '+COL[k].bar,
                        boxShadow:stageSel.length===1&&stageSel[0]===k?'0 0 0 2px '+COL[k].fg:'0 1px 3px rgba(0,0,0,.05)'}}>
                <div style={{fontSize:'22px',fontWeight:700,color:'#1D1D1F',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{counts[k]||0}</div>
                <div style={{fontSize:'11.5px',color:'#5A5A5E',marginTop:'6px'}}>{l}</div>
                <div style={{fontSize:'10px',color:'#A0A0A4',marginTop:'2px'}}>{kind}</div>
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
                      {k==='inquiry'||k==='sampling'
                        ? 'Nothing declared here yet. Set a card to ' + l + ' and it moves.'
                        : 'Nothing has reached ' + l + '.'}
                    </div>
                  ) : inCol.map(r => <Card key={r.id} r={r} />)}
                </div>
              );
            })}
          </div>
          {/* Cards cannot be dragged, and a board that looks draggable but is not
              owes an explanation rather than a shrug. */}
          <p style={{margin:'18px 0 0',fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.55,maxWidth:'720px'}}>
            Cards are not dragged. Quoted and Tested move when a quote or a test report appears;
            Inquiry and Sampling move when you set them on the card.
          </p>
        </>
      ) : (
        <div style={{background:'#fff',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',overflow:'hidden'}}>
          {shownDone.length === 0 ? (
            <div style={{padding:'44px 24px',textAlign:'center',fontSize:'13.5px',color:'#86868B'}}>Nothing here.</div>
          ) : shownDone.map((r,i) => {
            const p = r.products || {};
            const open = openId === r.id;
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
                {open && (
                  <div style={{padding:'2px 18px 16px',borderTop:'1px solid #F5F5F7',background:'#FCFCFD'}}>
                    <LifecyclePanel product={r.products} clientId={r.client_company_id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
