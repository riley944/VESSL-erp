'use client';
import { useState, useEffect, useMemo } from 'react';
import { SB } from '@/lib/supabase';
import { FilterSelect } from '@/app/components/FilterSelect';
import { LifecyclePanel } from '@/app/components/LifecyclePanel';
// ONE DERIVATION, shared with the panel. This page fetches differently -- in bulk,
// for every program at once -- but it must not DECIDE differently, which is how
// the awarded tile and the awarded filter ended up disagreeing about who won a
// shipment. lib/lifecycle.js owns the rules; this file owns the fetching.
import { LIFECYCLE_STAGES, LIFECYCLE_LABELS, fmt, deriveEvents, reachedStages, CLIENT_OF } from '@/lib/lifecycle';
import { ensurePrograms, pairsFromRecords } from '@/lib/programs';

// ── PROGRAMS. A program is a PRODUCT FOR A CLIENT. ──────────────────────────
// Phase 2A. Five stages are DERIVED from that client's own records and are not
// stored anywhere; two are declared by hand because nobody else can tell you.
//
// FOUR BULK QUERIES, NOT FOUR PER PROGRAM. The panel runs four queries for one
// product, which is right for a modal and catastrophic for a list -- 173 live
// programs would be ~692 requests. So everything is fetched once and bucketed by
// product and client in memory. About 1,200 rows total, flat regardless of how
// many programs exist.
//
// NO LADDER, AND NO CURRENT STAGE. At KUI a sales order is the CLIENT buying from
// us and a purchase order is US buying from the factory, so Sold normally
// precedes Ordered. Deciding "what stage is this at" would mean committing to a
// sequence, and the obvious one is wrong. Every stage reached renders as its own
// chip and the filter asks HAS REACHED. See PLM.md and lib/lifecycle.js.
const DECLARED = [
  ['inquiry',  'Inquiry'],
  ['sampling', 'Sampling'],
];

const CHIP = {
  quoted:    { bg:'#EAF3FE', fg:'#0A84FF' },
  tested:    { bg:'#F3E8FF', fg:'#7C3AED' },
  ordered:   { bg:'#FEF3C7', fg:'#B45309' },
  sold:      { bg:'#DCFCE7', fg:'#15803D' },
  shipped:   { bg:'#E0F2FE', fg:'#0369A1' },
  delivered: { bg:'#DCFCE7', fg:'#166534' },
  inquiry:   { bg:'#F2F2F4', fg:'#5A5A5E' },
  sampling:  { bg:'#F3E8FF', fg:'#7C3AED' },
};

const norm = t => (t || '').toLowerCase();

export default function Programs({ userEmail }) {
  const [rows, setRows]   = useState([]);
  const [ev, setEv]       = useState(null);
  const [loading, setLoad]= useState(true);
  const [err, setErr]     = useState('');
  const [search, setSearch] = useState('');
  const [stageSel, setStageSel] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(null);
  const [sweeping, setSweeping] = useState(false);

  const load = async () => {
    setLoad(true); setErr('');
    try {
      const [p, q, poi, soi, tr] = await Promise.all([
        SB.from('programs')
          .select('id,product_id,client_company_id,declared_stage,expected_ship_date,factory_status,factory_pct,factory_reported_at,archived,'
                + 'products(id,sku,name,active,product_stage),client:companies!client_company_id(id,name)')
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

  // ── BUCKETING ─────────────────────────────────────────────────────────────
  // Keyed product|client for the three sources that carry a client, and by
  // product alone for reports. CLIENT_OF is imported rather than re-read here,
  // so "which client does this row belong to" has one definition shared with the
  // panel scoping.
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
      // Declared stages sit alongside the derived ones for filtering. They are a
      // different KIND of fact -- someone said so, rather than a record proves
      // it -- but "has reached" reads the same either way.
      const reached = reachedStages(events);
      const all = r.declared_stage ? [r.declared_stage, ...reached] : reached;
      return { ...r, events, reached, allStages: all };
    });
  }, [rows, buckets]);

  const counts = useMemo(() => {
    const c = {};
    [...DECLARED.map(d=>d[0]), ...LIFECYCLE_STAGES.map(s=>s[0])].forEach(k => { c[k] = 0; });
    enriched.forEach(r => { if (!r.archived) r.allStages.forEach(k => { c[k] = (c[k]||0) + 1; }); });
    return c;
  }, [enriched]);

  const archivedCount = enriched.filter(r => r.archived).length;

  // ── FILTERING ─────────────────────────────────────────────────────────────
  // MEMBERSHIP, and the counts OVERLAP. A program that is quoted, sold and
  // ordered appears under all three, because reaching a stage is a fact on its
  // own rather than a position in a queue. Same shape as the Ordered date filter
  // on Shipments, which is documented as a union for the same reason.
  //
  // The default is EMPTY here, unlike the Freight Quotes status filter. That one
  // could default non-empty because its buckets partition -- these overlap, so a
  // pre-ticked set would read as "show almost everything" and teach nothing.
  const shown = useMemo(() => enriched.filter(r => {
    if (!showArchived && r.archived) return false;
    if (search) {
      const p = r.products || {};
      const hay = norm(p.sku) + ' ' + norm(p.name) + ' ' + norm((r.client||{}).name);
      if (!hay.includes(norm(search))) return false;
    }
    if (stageSel.length && !r.allStages.some(k => stageSel.includes(k))) return false;
    return true;
  }), [enriched, search, stageSel, showArchived]);

  // Grouped by product, product order preserved from the fetch.
  const groups = useMemo(() => {
    const by = new Map();
    shown.forEach(r => {
      const pid = r.product_id;
      if (!by.has(pid)) by.set(pid, { product: r.products || {}, rows: [] });
      by.get(pid).rows.push(r);
    });
    return [...by.values()].sort((a,b) => norm(a.product.sku).localeCompare(norm(b.product.sku)));
  }, [shown]);

  const stageOptions = useMemo(() => ([
    { value:'', label:'All stages', count:enriched.filter(r=>!r.archived).length },
    ...DECLARED.map(([v,l]) => ({ value:v, label:l+' (declared)', color:CHIP[v].fg, bg:CHIP[v].bg, count:counts[v]||0 })),
    ...LIFECYCLE_STAGES.map(([v,l]) => ({ value:v, label:l, color:CHIP[v].fg, bg:CHIP[v].bg, count:counts[v]||0 })),
  ]), [counts, enriched]);

  // ── THE SWEEP ─────────────────────────────────────────────────────────────
  // The live paths create a program as the work happens, so this is a backstop
  // rather than the mechanism -- for pairs that appeared before those paths
  // shipped, and for anything written straight to the database.
  //
  // IT ONLY CREATES. It never archives and never un-archives, per the phase 2A
  // decision: a program somebody archived by hand must not be resurrected by a
  // background rule, and un-retiring a product must not silently reopen work.
  //
  // Reads the records FRESH rather than reusing what the page loaded, because
  // the whole point is catching what the page has not seen. Then it subtracts
  // what already exists, so it can report an exact number instead of a shrug --
  // "added 0" is a real answer and worth being able to trust.
  const sweep = async () => {
    setSweeping(true);
    try {
      const pairs = await pairsFromRecords();
      const have = new Set(rows.map(r => r.product_id + '|' + r.client_company_id));
      const missing = [];
      const seen = new Set();
      for (const [pid, cid] of pairs) {
        const k = pid + '|' + cid;
        if (have.has(k) || seen.has(k)) continue;
        seen.add(k);
        missing.push([pid, cid]);
      }
      if (!missing.length) {
        window._toast?.('Nothing to add — every pair already has a program', 'ok');
        setSweeping(false);
        return;
      }
      const { error } = await ensurePrograms(missing);
      if (error) { alert('Could not add programs: ' + error.message); setSweeping(false); return; }
      window._toast?.('Added ' + missing.length + ' ' + (missing.length===1?'program':'programs'), 'ok');
      await load();
    } catch (e) {
      alert('Sweep failed: ' + (e && e.message ? e.message : e));
    }
    setSweeping(false);
  };

  const setDeclared = async (r, value) => {
    setSaving(r.id);
    const patch = { declared_stage: value || null, updated_at: new Date().toISOString() };
    const { error } = await SB.from('programs').update(patch).eq('id', r.id);
    setSaving(null);
    if (error) { alert('Could not save: ' + error.message); return; }
    setRows(prev => prev.map(x => x.id === r.id ? { ...x, ...patch } : x));
  };

  if (loading) return <div style={{padding:'28px 30px',color:'#86868B',fontSize:'14px'}}>Reading programs…</div>;
  if (err) return <div style={{padding:'28px 30px',color:'var(--hot)',fontSize:'14px'}}>Could not read programs — {err}</div>;

  const liveCount = enriched.filter(r=>!r.archived).length;
  const clientCount = new Set(enriched.filter(r=>!r.archived).map(r=>r.client_company_id)).size;

  return (
    <div style={{padding:'26px 30px 60px'}}>
      <div style={{display:'flex',alignItems:'baseline',gap:'12px',flexWrap:'wrap',marginBottom:'6px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Programs</h1>
        <span style={{fontSize:'13px',color:'#86868B'}}>
          {liveCount} {liveCount===1?'program':'programs'} across {clientCount} {clientCount===1?'client':'clients'}
        </span>
      </div>
      <p style={{margin:'0 0 18px',fontSize:'12.5px',color:'#8A8A8E',lineHeight:1.55,maxWidth:'720px'}}>
        A program is one product for one client. Quoted, Tested, Ordered, Sold, Shipped and
        Delivered are read from records — nothing to keep up to date by hand. Inquiry and
        Sampling are yours to set.
      </p>

      <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',marginBottom:'18px'}}>
        <div style={{position:'relative',flex:'1 1 240px',maxWidth:'340px'}}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search product, SKU or client…"
            style={{width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',
                    fontSize:'13.5px',outline:'none',fontFamily:'inherit',background:'#fff',boxSizing:'border-box'}} />
        </div>
        <FilterSelect multiple label="All stages" value={stageSel} onChange={setStageSel} options={stageOptions} />
        {archivedCount > 0 && (
          <button onClick={()=>setShowArchived(v=>!v)}
            style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'7px 13px',cursor:'pointer',
                    border:'1px solid rgba(0,0,0,.1)',fontFamily:'inherit',
                    background:showArchived?'#EAF3FE':'#fff',color:showArchived?'#0A84FF':'#5A5A5E'}}>
            {showArchived ? 'Hide archived' : 'Show archived (' + archivedCount + ')'}
          </button>
        )}
        <div style={{flex:1}} />
        <button onClick={sweep} disabled={sweeping}
          title="Create programs for any product and client pair the records prove but the list is missing"
          style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'7px 13px',
                  cursor:sweeping?'default':'pointer',border:'1px solid rgba(0,0,0,.1)',
                  fontFamily:'inherit',background:'#fff',color:sweeping?'#B0B0B4':'#5A5A5E'}}>
          {sweeping ? 'Checking…' : 'Sync from records'}
        </button>
        {shown.length !== enriched.length && (
          <span style={{fontSize:'11.5px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>
            {shown.length} of {enriched.length}
          </span>
        )}
      </div>

      {/* A stage filter narrows PROGRAMS, and a program lives on a product, so an
          empty result is about the filter rather than about the catalogue. */}
      {groups.length === 0 ? (
        <div style={{background:'#fff',borderRadius:'18px',padding:'54px 30px',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',marginBottom:'6px'}}>Nothing matches</div>
          <div style={{fontSize:'13.5px',color:'#86868B'}}>Try a different term, or clear the stage filter.</div>
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
          {groups.map(g => (
            <div key={g.product.id || g.product.sku} style={{background:'#fff',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',overflow:'hidden'}}>
              <div style={{padding:'13px 18px',borderBottom:'1px solid #F5F5F7',display:'flex',alignItems:'baseline',gap:'10px',flexWrap:'wrap'}}>
                <span style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:700,color:'#1D1D1F'}}>{g.product.sku || '—'}</span>
                <span style={{fontSize:'13.5px',color:'#1D1D1F'}}>{g.product.name || '—'}</span>
                {g.product.active === false && (
                  <span style={{fontSize:'10px',fontWeight:700,letterSpacing:'.05em',textTransform:'uppercase',
                                color:'#86868B',background:'#F2F2F4',borderRadius:'980px',padding:'2px 8px'}}>Retired</span>
                )}
                {/* Only worth saying when it is more than one, which is 2 products
                    of 332 -- the visible form of a near-degenerate client axis. */}
                {g.rows.length > 1 && (
                  <span style={{fontSize:'11.5px',color:'#8A8A8E'}}>{g.rows.length} clients</span>
                )}
              </div>
              {g.rows.map((r,i) => {
                const open = openId === r.id;
                return (
                  <div key={r.id} style={{borderTop:i>0?'1px solid #F5F5F7':'none'}}>
                    <div style={{padding:'12px 18px',display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap'}}>
                      <button onClick={()=>setOpenId(open?null:r.id)}
                        style={{background:'none',border:'none',padding:0,cursor:'pointer',fontFamily:'inherit',
                                fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',minWidth:'150px',textAlign:'left'}}>
                        {(r.client||{}).name || '—'}
                      </button>

                      <div style={{display:'flex',gap:'5px',flexWrap:'wrap',flex:'1 1 260px'}}>
                        {r.allStages.length === 0 && (
                          <span style={{fontSize:'12px',color:'#B0B0B4'}}>Nothing recorded yet</span>
                        )}
                        {r.allStages.map(k => {
                          const e = r.events[k];
                          const label = LIFECYCLE_LABELS[k] || (DECLARED.find(d=>d[0]===k)||[])[1] || k;
                          return (
                            <span key={k} title={e && e.on ? label + ' · ' + fmt(e.on) : label + ' · declared'}
                              style={{fontSize:'11px',fontWeight:600,borderRadius:'980px',padding:'3px 9px',
                                      background:CHIP[k].bg,color:CHIP[k].fg,whiteSpace:'nowrap'}}>
                              {label}{e && e.on ? ' · ' + fmt(e.on) : ''}
                            </span>
                          );
                        })}
                      </div>

                      <select value={r.declared_stage || ''} disabled={saving===r.id}
                        onChange={e=>setDeclared(r, e.target.value)}
                        aria-label={'Declared stage for ' + ((r.client||{}).name||'this client')}
                        style={{border:'1px solid rgba(0,0,0,.1)',borderRadius:'8px',padding:'5px 8px',
                                fontSize:'12px',fontWeight:600,background:'#fff',fontFamily:'inherit',
                                color:r.declared_stage?'#1D1D1F':'#8A8A8E'}}>
                        <option value="">Not declared</option>
                        {DECLARED.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                      </select>

                      <span style={{fontSize:'11.5px',color:'#8A8A8E',minWidth:'110px',whiteSpace:'nowrap'}}>
                        {r.expected_ship_date ? 'Ships ' + fmt(r.expected_ship_date) : 'No ship date'}
                      </span>
                    </div>

                    {/* The factory line only when a factory has actually said
                        something, so an empty one never implies silence is a state. */}
                    {(r.factory_status || r.factory_pct != null) && (
                      <div style={{padding:'0 18px 10px',fontSize:'11.5px',color:'#8A8A8E'}}>
                        Factory: {r.factory_status || '—'}
                        {r.factory_pct != null ? ' · ' + r.factory_pct + '%' : ''}
                        {r.factory_reported_at ? ' · ' + fmt(r.factory_reported_at) : ''}
                      </div>
                    )}

                    {open && (
                      <div style={{padding:'2px 18px 18px',borderTop:'1px solid #F5F5F7',background:'#FCFCFD'}}>
                        <LifecyclePanel product={r.products} clientId={r.client_company_id} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
