'use client';
import React, { useState, useEffect } from "react";
import { SB } from "@/lib/supabase";
import { SBQ } from "@/lib/supabaseQuotes";

// ── helpers ──────────────────────────────────────────────────────────────────
const money = (n, d=2) => (n==null||isNaN(n)) ? '—' : '$'+Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtNum = n => (n==null||isNaN(n)) ? '—' : Number(n).toLocaleString('en-US');
const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); };
const pct = n => (n==null||isNaN(n)) ? '—' : (n>=0?'':'-')+Math.abs(n).toFixed(1)+'%';
const daysAgo = s => { if(!s) return 9999; const d=new Date(s); return Math.max(0,Math.round((Date.now()-d.getTime())/86400000)); };

const CATEGORIES = [
  ['ocean_freight','Ocean freight'], ['air_freight','Air freight'], ['drayage','Drayage'],
  ['inland','Inland / trucking'], ['customs','Customs / brokerage'], ['duty','Duty & tariffs'],
  ['fuel','Fuel surcharge'], ['documentation','Documentation'], ['demurrage','Demurrage / detention'], ['other','Other'],
];
const CAT_LABEL = Object.fromEntries(CATEGORIES);

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.04)'};
const inp = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'9px 11px',fontSize:'13.5px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const lbl = {display:'block',fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'5px'};
const th = {fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4'};

// CBM per unit from a quote record
function cbmPerUnitOf(q) {
  if (!q) return 0;
  const L=Number(q.carton_l)||0, W=Number(q.carton_w)||0, H=Number(q.carton_h)||0;
  const upc=Number(q.units_per_carton)||0;
  if (L<=0||W<=0||H<=0||upc<=0) return 0;
  return ((L*W*H)/1000000)/upc;
}
// Pick the tier closest to a quantity
function tierFor(q, units) {
  let tiers=[]; try { tiers = Array.isArray(q?.tiers)?q.tiers:(q?.tiers?JSON.parse(q.tiers):[]); } catch(e) { tiers=[]; }
  if (!tiers.length) return null;
  const u=Number(units)||0;
  if (!u) return tiers[0];
  let best=tiers[0], bestD=Infinity;
  tiers.forEach(t=>{ const d=Math.abs((Number(t.qty)||0)-u); if(d<bestD){bestD=d;best=t;} });
  return best;
}
function quotedFreightOf(t) {
  if (!t) return null;
  const v = (t.ship==='air') ? t.freightAir : t.freightOcean;
  const n = Number(v);
  return isNaN(n)?null:n;
}

// Build recency-weighted lane rates from invoices
function computeLanes(invoices) {
  const groups = {};
  (invoices||[]).forEach(iv=>{
    const cbm = Number(iv.total_cbm)||0;
    const amt = Number(iv.total_amount)||0;
    if (cbm<=0 || amt<=0) return;
    const key = (iv.origin||'?')+'|||'+(iv.destination||'?')+'|||'+(iv.mode||'ocean');
    if (!groups[key]) groups[key] = { origin:iv.origin||'—', destination:iv.destination||'—', mode:iv.mode||'ocean', points:[] };
    groups[key].points.push({ perCbm: amt/cbm, date: iv.invoice_date||iv.created_at, age: daysAgo(iv.invoice_date||iv.created_at) });
  });
  return Object.values(groups).map(g=>{
    // recency weight: <=90d ×4, <=180d ×2, <=365d ×1, older ×0.4
    let wsum=0, vsum=0;
    g.points.forEach(p=>{ const w = p.age<=90?4 : p.age<=180?2 : p.age<=365?1 : 0.4; wsum+=w; vsum+=w*p.perCbm; });
    const weighted = wsum>0 ? vsum/wsum : 0;
    const recent = g.points.filter(p=>p.age<=180).map(p=>p.perCbm);
    const pool = recent.length? recent : g.points.map(p=>p.perCbm);
    const low = Math.min.apply(null,pool), high = Math.max.apply(null,pool);
    const freshest = g.points.reduce((a,p)=>Math.min(a,p.age), 9999);
    return { ...g, perCbm:weighted, low, high, n:g.points.length, recentN:recent.length, freshest };
  }).sort((a,b)=>b.n-a.n);
}
function confidenceOf(lane) {
  if (!lane) return { label:'No data', color:'#8A8A8E', bg:'#F2F2F4' };
  if (lane.recentN>=3 && lane.freshest<=90) return { label:'High', color:'#15803D', bg:'#DCFCE7' };
  if (lane.n>=2 && lane.freshest<=365) return { label:'Medium', color:'#B45309', bg:'#FEF3C7' };
  return { label:'Low', color:'#B91C1C', bg:'#FEE2E2' };
}

// ═══════════════════════════════════════════════════════════════════════════
export default function Pricing() {
  const [tab, setTab] = useState('variance');
  const [invoices, setInvoices] = useState([]);
  const [allocs, setAllocs] = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    const [inv, al, comp] = await Promise.all([
      SB.from('freight_invoices').select('*,lines:freight_invoice_lines(*),forwarder:companies!forwarder_company_id(name)').order('invoice_date',{ascending:false}),
      SB.from('freight_allocations').select('*').order('created_at',{ascending:false}),
      SB.from('companies').select('id,name,type').order('name'),
    ]);
    let invRows = inv.data;
    if (!invRows) { const retry = await SB.from('freight_invoices').select('*').order('created_at',{ascending:false}); invRows = retry.data||[]; }
    setInvoices(invRows||[]); setAllocs(al.data||[]); setCompanies(comp.data||[]);
    const q = await SBQ.from('quotes').select('*').order('created_at',{ascending:false});
    setQuotes(q.data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const lanes = computeLanes(invoices);
  const deleteInvoice = async (id) => {
    const { error } = await SB.from('freight_invoices').delete().eq('id',id);
    if (error) { alert('Could not delete: '+error.message); return; }
    setInvoices(prev=>prev.filter(i=>i.id!==id));
    setAllocs(prev=>prev.filter(a=>a.invoice_id!==id));
  };

  return (
    <div style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {/* Header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'14px',marginBottom:'20px',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'24px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.02em'}}>Pricing &amp; Landed Cost</div>
          <div style={{fontSize:'13.5px',color:'#8A8A8E',marginTop:'3px'}}>Actual freight vs. quoted assumptions — and what it means for the next quote</div>
        </div>
        <button onClick={()=>setShowModal(true)} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Log Freight Invoice</button>
      </div>

      {/* Tabs */}
      <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',marginBottom:'20px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)',flexWrap:'wrap'}}>
        {[['variance','Margin Variance'],['estimator','Estimator'],['lanes','Lane Rates'],['invoices','Invoices']].map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{padding:'9px 18px',borderRadius:'9px',border:'none',cursor:'pointer',fontSize:'13.5px',fontWeight:600,letterSpacing:'-.01em',background:tab===v?'#1A1A1C':'transparent',color:tab===v?'#fff':'#5A5A5E',boxShadow:tab===v?'0 1px 3px rgba(0,0,0,.18)':'none',transition:'.14s'}}>{l}</button>
        ))}
      </div>

      {loading ? <div style={{padding:'60px',textAlign:'center',color:'#8A8A8E',fontSize:'14px'}}>Loading…</div> : (
        <>
          {tab==='variance'  && <VarianceView allocs={allocs} quotes={quotes} />}
          {tab==='estimator' && <EstimatorView quotes={quotes} lanes={lanes} />}
          {tab==='lanes'     && <LanesView lanes={lanes} />}
          {tab==='invoices'  && <InvoicesView invoices={invoices} allocs={allocs} onDelete={deleteInvoice} />}
        </>
      )}

      {showModal && <InvoiceModal companies={companies} quotes={quotes} onClose={()=>setShowModal(false)} onSaved={()=>{setShowModal(false);load();}} />}
    </div>
  );
}

// ── MARGIN VARIANCE ──────────────────────────────────────────────────────────
function VarianceView({ allocs, quotes }) {
  const rows = (allocs||[]).map(a=>{
    const q = (quotes||[]).find(x=>(x.sku||'').trim().toLowerCase()===(a.sku||'').trim().toLowerCase()) || null;
    const t = tierFor(q, a.units);
    const exw = a.exw_per_unit!=null ? Number(a.exw_per_unit) : (t? Number(t.landed)||0 : 0);
    const clientPrice = a.client_price!=null ? Number(a.client_price) : (t? Number(t.client)||0 : 0);
    const qFreight = a.quoted_freight_per_unit!=null ? Number(a.quoted_freight_per_unit) : quotedFreightOf(t);
    const aFreight = Number(a.freight_per_unit)||0;
    const quotedCost = qFreight!=null ? exw+qFreight : null;
    const actualCost = exw+aFreight;
    const qMargin = (clientPrice>0 && quotedCost!=null) ? ((clientPrice-quotedCost)/clientPrice)*100 : null;
    const aMargin = clientPrice>0 ? ((clientPrice-actualCost)/clientPrice)*100 : null;
    const erosion = (qMargin!=null && aMargin!=null) ? aMargin-qMargin : null;
    return { ...a, product:q?.product||a.description||a.sku||'—', client:q?.client||'', exw, clientPrice, qFreight, aFreight, quotedCost, actualCost, qMargin, aMargin, erosion };
  }).filter(r=>r.sku||r.description);

  const withBoth = rows.filter(r=>r.erosion!=null);
  const avgErosion = withBoth.length ? withBoth.reduce((a,r)=>a+r.erosion,0)/withBoth.length : null;
  const worst = withBoth.slice().sort((a,b)=>a.erosion-b.erosion)[0];
  const freightVar = rows.filter(r=>r.qFreight!=null);
  const avgFreightDelta = freightVar.length ? freightVar.reduce((a,r)=>a+(r.aFreight-r.qFreight),0)/freightVar.length : null;

  if (!rows.length) return <Empty title="No allocated costs yet" sub="Log a freight invoice and allocate it across SKUs — margin variance appears here automatically." />;

  return (
    <>
      {/* summary */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,minmax(0,1fr))',gap:'14px',marginBottom:'18px'}}>
        <div style={{...card,padding:'18px 20px'}}>
          <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'12px'}}>Avg margin vs. quote</div>
          <div style={{fontSize:'28px',fontWeight:700,letterSpacing:'-.02em',lineHeight:1,color:avgErosion==null?'#1A1A1C':avgErosion<0?'#DC2626':'#15803D',fontVariantNumeric:'tabular-nums'}}>{avgErosion==null?'—':(avgErosion>0?'+':'')+avgErosion.toFixed(1)+' pts'}</div>
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'8px'}}>{withBoth.length} SKUs with quoted baseline</div>
        </div>
        <div style={{...card,padding:'18px 20px'}}>
          <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'12px'}}>Avg freight vs. assumed</div>
          <div style={{fontSize:'28px',fontWeight:700,letterSpacing:'-.02em',lineHeight:1,color:avgFreightDelta==null?'#1A1A1C':avgFreightDelta>0?'#DC2626':'#15803D',fontVariantNumeric:'tabular-nums'}}>{avgFreightDelta==null?'—':(avgFreightDelta>0?'+':'')+money(avgFreightDelta,3)}</div>
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'8px'}}>per unit, across {freightVar.length} lines</div>
        </div>
        <div style={{...card,padding:'18px 20px'}}>
          <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'12px'}}>Biggest erosion</div>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1A1A1C',letterSpacing:'-.01em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{worst?worst.product:'—'}</div>
          <div style={{fontSize:'11.5px',color:worst&&worst.erosion<0?'#DC2626':'#A0A0A4',marginTop:'8px'}}>{worst?(worst.erosion>0?'+':'')+worst.erosion.toFixed(1)+' pts vs. quote':'—'}</div>
        </div>
      </div>

      {/* table */}
      <div style={{...card,overflow:'hidden'}}>
        <div style={{overflowX:'auto'}}><div style={{minWidth:'880px'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 88px 92px 92px 92px 92px 96px',gap:'12px',padding:'12px 20px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
            <div style={th}>Product / SKU</div>
            <div style={{...th,textAlign:'right'}}>EXW</div>
            <div style={{...th,textAlign:'right'}}>Frt quoted</div>
            <div style={{...th,textAlign:'right'}}>Frt actual</div>
            <div style={{...th,textAlign:'right'}}>Quoted GM</div>
            <div style={{...th,textAlign:'right'}}>Actual GM</div>
            <div style={{...th,textAlign:'right'}}>Variance</div>
          </div>
          {rows.map((r,i)=>(
            <div key={r.id||i} style={{display:'grid',gridTemplateColumns:'1fr 88px 92px 92px 92px 92px 96px',gap:'12px',padding:'13px 20px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center'}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.product}</div>
                <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[r.sku,r.client,fmtNum(r.units)+' units'].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={{textAlign:'right',fontSize:'13px',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{r.exw?money(r.exw,2):'—'}</div>
              <div style={{textAlign:'right',fontSize:'13px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums'}}>{r.qFreight!=null?money(r.qFreight,3):'—'}</div>
              <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(r.aFreight,3)}</div>
              <div style={{textAlign:'right',fontSize:'13px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums'}}>{r.qMargin!=null?pct(r.qMargin):'—'}</div>
              <div style={{textAlign:'right',fontSize:'13px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{r.aMargin!=null?pct(r.aMargin):'—'}</div>
              <div style={{textAlign:'right'}}>
                {r.erosion==null ? <span style={{fontSize:'12px',color:'#C0C0C4'}}>—</span> :
                  <span style={{display:'inline-flex',alignItems:'center',fontSize:'12px',fontWeight:700,borderRadius:'6px',padding:'3px 9px',fontVariantNumeric:'tabular-nums',color:r.erosion<0?'#B91C1C':'#15803D',background:r.erosion<0?'#FEE2E2':'#DCFCE7'}}>{(r.erosion>0?'+':'')+r.erosion.toFixed(1)} pts</span>}
              </div>
            </div>
          ))}
        </div></div>
      </div>
    </>
  );
}

// ── ESTIMATOR ────────────────────────────────────────────────────────────────
function EstimatorView({ quotes, lanes }) {
  const [qid, setQid] = useState('');
  const [laneKey, setLaneKey] = useState('');
  const [units, setUnits] = useState('');
  const [dutyRate, setDutyRate] = useState('');
  const [targetPrice, setTargetPrice] = useState('');

  const q = (quotes||[]).find(x=>String(x.id)===String(qid)) || null;
  const lane = (lanes||[]).find(l=>(l.origin+'|||'+l.destination+'|||'+l.mode)===laneKey) || null;
  const conf = confidenceOf(lane);
  const cpu = cbmPerUnitOf(q);
  const t = tierFor(q, units);
  const exw = t? Number(t.landed)||0 : 0;
  const dr = Number(dutyRate)||0;

  const est = (rate) => {
    const freight = cpu>0 ? cpu*rate : 0;
    const duty = exw*(dr/100);
    return exw+freight+duty;
  };
  const mid = lane? est(lane.perCbm) : null;
  const low = lane? est(lane.low) : null;
  const high = lane? est(lane.high) : null;
  const price = Number(targetPrice)|| (t? Number(t.client)||0 : 0);
  const marginAt = (cost) => (price>0 && cost>0) ? ((price-cost)/price)*100 : null;

  return (
    <div style={{display:'grid',gridTemplateColumns:'minmax(0,340px) minmax(0,1fr)',gap:'18px',alignItems:'start'}}>
      {/* inputs */}
      <div style={{...card,padding:'20px 22px'}}>
        <div style={{fontSize:'15px',fontWeight:700,color:'#1A1A1C',marginBottom:'16px'}}>Estimate a landed cost</div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Product</label>
          <select style={inp} value={qid} onChange={e=>setQid(e.target.value)}>
            <option value="">— select a product —</option>
            {(quotes||[]).map(x=><option key={x.id} value={x.id}>{(x.product||x.sku||'Untitled')+(x.client?' · '+x.client:'')}</option>)}
          </select>
        </div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Quantity</label><input style={inp} value={units} onChange={e=>setUnits(e.target.value)} placeholder="e.g. 10000" /></div>
        <div style={{marginBottom:'12px'}}><label style={lbl}>Lane</label>
          <select style={inp} value={laneKey} onChange={e=>setLaneKey(e.target.value)}>
            <option value="">— select a lane —</option>
            {(lanes||[]).map(l=>{ const k=l.origin+'|||'+l.destination+'|||'+l.mode; return <option key={k} value={k}>{l.origin+' → '+l.destination+' ('+l.mode+')'}</option>; })}
          </select>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'10px'}}>
          <div><label style={lbl}>Duty %</label><input style={inp} value={dutyRate} onChange={e=>setDutyRate(e.target.value)} placeholder="e.g. 17.6" /></div>
          <div><label style={lbl}>Target price</label><input style={inp} value={targetPrice} onChange={e=>setTargetPrice(e.target.value)} placeholder={t&&t.client?String(t.client):'per unit'} /></div>
        </div>
        {q && (
          <div style={{marginTop:'16px',paddingTop:'14px',borderTop:'1px solid #F2F2F4',fontSize:'12px',color:'#8A8A8E',lineHeight:1.7}}>
            <div>EXW: <b style={{color:'#1A1A1C'}}>{exw?money(exw,2):'not set'}</b></div>
            <div>CBM/unit: <b style={{color:'#1A1A1C'}}>{cpu>0?cpu.toFixed(5):'no carton data'}</b></div>
            {q.hts && <div>HTS: <b style={{color:'#1A1A1C'}}>{q.hts}</b></div>}
          </div>
        )}
      </div>

      {/* output */}
      <div style={{...card,padding:'22px 24px'}}>
        {!q || !lane ? (
          <div style={{padding:'40px 10px',textAlign:'center',color:'#8A8A8E',fontSize:'14px'}}>Pick a product and a lane to estimate landed cost.</div>
        ) : cpu<=0 ? (
          <div style={{padding:'40px 10px',textAlign:'center',color:'#B45309',fontSize:'14px'}}>This product has no carton dimensions or units-per-carton on its quote, so CBM per unit can&apos;t be calculated. Add those to the quote first.</div>
        ) : (
          <>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'18px',gap:'12px',flexWrap:'wrap'}}>
              <div style={{fontSize:'15px',fontWeight:700,color:'#1A1A1C'}}>Estimated landed cost / unit</div>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px',fontSize:'11.5px',fontWeight:600,borderRadius:'7px',padding:'4px 10px',color:conf.color,background:conf.bg}}>{conf.label} confidence · {lane.n} invoice{lane.n===1?'':'s'}</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px',marginBottom:'18px'}}>
              {[['Best case',low,'#15803D'],['Expected',mid,'#1A1A1C'],['Worst case',high,'#B91C1C']].map(([k,v,c])=>(
                <div key={k} style={{background:k==='Expected'?'#F7F7F9':'transparent',border:k==='Expected'?'none':'1px solid #F0F0F2',borderRadius:'12px',padding:'16px 16px'}}>
                  <div style={{fontSize:'11px',color:'#8A8A8E',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'8px'}}>{k}</div>
                  <div style={{fontSize:k==='Expected'?'26px':'20px',fontWeight:700,color:c,letterSpacing:'-.02em',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{money(v,3)}</div>
                  {price>0 && <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'7px'}}>{pct(marginAt(v))} margin</div>}
                </div>
              ))}
            </div>
            {/* breakdown */}
            <div style={{borderTop:'1px solid #F2F2F4',paddingTop:'16px'}}>
              <div style={{fontSize:'11px',color:'#A0A0A4',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'12px'}}>Cost build-up (expected)</div>
              {[['EXW / unit',exw],['Freight / unit',cpu*lane.perCbm],['Duty / unit',exw*(dr/100)]].map(([k,v])=>(
                <div key={k} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',fontSize:'13.5px'}}>
                  <span style={{color:'#8A8A8E'}}>{k}</span><span style={{fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(v,3)}</span>
                </div>
              ))}
              <div style={{display:'flex',justifyContent:'space-between',padding:'11px 0 0',marginTop:'6px',borderTop:'1px solid #F2F2F4',fontSize:'14px'}}>
                <span style={{fontWeight:600,color:'#1A1A1C'}}>Landed / unit</span><span style={{fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(mid,3)}</span>
              </div>
              {units && Number(units)>0 && <div style={{display:'flex',justifyContent:'space-between',padding:'8px 0 0',fontSize:'12.5px',color:'#8A8A8E'}}>
                <span>Total for {fmtNum(Number(units))} units</span><span style={{fontVariantNumeric:'tabular-nums'}}>{money(mid*Number(units),0)}</span>
              </div>}
            </div>
            <div style={{marginTop:'16px',fontSize:'11.5px',color:'#8A8A8E',lineHeight:1.6}}>
              Lane rate {money(lane.perCbm,2)}/CBM (recency-weighted from {lane.n} invoice{lane.n===1?'':'s'}, range {money(lane.low,2)}–{money(lane.high,2)}). Most recent data {lane.freshest>900?'over a year old':lane.freshest+' days old'}.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── LANE RATES ───────────────────────────────────────────────────────────────
function LanesView({ lanes }) {
  if (!lanes.length) return <Empty title="No lane data yet" sub="Lane rates build automatically as you log freight invoices with an origin, destination and total CBM." />;
  return (
    <div style={{...card,overflow:'hidden'}}>
      <div style={{overflowX:'auto'}}><div style={{minWidth:'760px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 80px 110px 150px 90px 110px',gap:'14px',padding:'12px 20px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
          <div style={th}>Lane</div><div style={th}>Mode</div>
          <div style={{...th,textAlign:'right'}}>$ / CBM</div>
          <div style={{...th,textAlign:'right'}}>Range</div>
          <div style={{...th,textAlign:'right'}}>Invoices</div>
          <div style={{...th,textAlign:'right'}}>Confidence</div>
        </div>
        {lanes.map((l,i)=>{ const c=confidenceOf(l); return (
          <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 80px 110px 150px 90px 110px',gap:'14px',padding:'14px 20px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.origin} → {l.destination}</div>
              <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px'}}>latest {l.freshest>900?'1yr+ ago':l.freshest+'d ago'}</div>
            </div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E',textTransform:'capitalize'}}>{l.mode}</div>
            <div style={{textAlign:'right',fontSize:'16px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(l.perCbm,2)}</div>
            <div style={{textAlign:'right',fontSize:'12.5px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums'}}>{money(l.low,2)} – {money(l.high,2)}</div>
            <div style={{textAlign:'right',fontSize:'13px',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{l.n}</div>
            <div style={{textAlign:'right'}}><span style={{display:'inline-flex',fontSize:'11px',fontWeight:600,borderRadius:'6px',padding:'3px 9px',color:c.color,background:c.bg}}>{c.label}</span></div>
          </div>
        ); })}
      </div></div>
    </div>
  );
}

// ── INVOICES ─────────────────────────────────────────────────────────────────
function InvoicesView({ invoices, allocs, onDelete }) {
  if (!invoices.length) return <Empty title="No freight invoices logged" sub="Log your forwarder invoices here — each one sharpens your lane rates and margin variance." />;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      {invoices.map(iv=>{
        const mine = (allocs||[]).filter(a=>a.invoice_id===iv.id);
        const perCbm = (Number(iv.total_cbm)>0) ? Number(iv.total_amount)/Number(iv.total_cbm) : null;
        return (
          <div key={iv.id} style={{...card,padding:'18px 20px'}}>
            <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'14px',flexWrap:'wrap'}}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:'15px',fontWeight:700,color:'#1A1A1C'}}>{iv.origin||'—'} → {iv.destination||'—'}</div>
                <div style={{fontSize:'12px',color:'#8A8A8E',marginTop:'3px'}}>{[iv.invoice_number&&('Inv '+iv.invoice_number), iv.forwarder?.name, fmtDate(iv.invoice_date), iv.container_type, (iv.mode||'ocean')].filter(Boolean).join(' · ')}</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:'16px'}}>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:'19px',fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(iv.total_amount,2)}</div>
                  <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px'}}>{Number(iv.total_cbm)>0?Number(iv.total_cbm).toFixed(1)+' CBM · '+money(perCbm,2)+'/CBM':'no CBM'}</div>
                </div>
                <button title="Delete invoice" onClick={()=>{ if(window.confirm('Delete this freight invoice and its allocations?')) onDelete(iv.id); }} style={{background:'none',border:'none',cursor:'pointer',padding:'5px',borderRadius:'6px',color:'#C0C0C4',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#DC2626';e.currentTarget.style.background='#FEE2E2';}} onMouseLeave={e=>{e.currentTarget.style.color='#C0C0C4';e.currentTarget.style.background='none';}}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>
                </button>
              </div>
            </div>
            {(iv.lines||[]).length>0 && (
              <div style={{display:'flex',flexWrap:'wrap',gap:'8px',marginTop:'14px',paddingTop:'13px',borderTop:'1px solid #F2F2F4'}}>
                {(iv.lines||[]).map(l=>(
                  <span key={l.id} style={{fontSize:'11.5px',color:'#4A4A4E',background:'#F5F5F7',borderRadius:'7px',padding:'4px 10px'}}>{CAT_LABEL[l.category]||l.category} <b style={{color:'#1A1A1C'}}>{money(l.amount,2)}</b></span>
                ))}
              </div>
            )}
            {mine.length>0 && (
              <div style={{marginTop:'12px',fontSize:'11.5px',color:'#8A8A8E'}}>Allocated across {mine.length} SKU{mine.length===1?'':'s'} by CBM share</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── INVOICE MODAL ────────────────────────────────────────────────────────────
function InvoiceModal({ companies, quotes, onClose, onSaved }) {
  const [f, setF] = useState({ number:'', forwarder:'', date:'', origin:'', destination:'', mode:'ocean', container:'40HQ', containers:'1', cbm:'', weight:'', notes:'' });
  const [lines, setLines] = useState([{ category:'ocean_freight', description:'', amount:'' }]);
  const [rows, setRows] = useState([{ sku:'', description:'', units:'', cbm:'' }]);
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const forwarders = (companies||[]).filter(c=>['carrier','freight_forwarder'].includes(c.type));

  const setLine = (i,k) => e => setLines(p=>p.map((l,j)=>j===i?{...l,[k]:e.target.value}:l));
  const setRow  = (i,k) => e => setRows(p=>p.map((r,j)=>j===i?{...r,[k]:e.target.value}:r));

  const total = lines.reduce((a,l)=>a+(Number(l.amount)||0),0);
  const allocCbm = rows.reduce((a,r)=>a+(Number(r.cbm)||0),0);
  const baseCbm = Number(f.cbm)||allocCbm;

  // auto CBM from the matching quote when a SKU is entered
  const fillCbm = (i) => {
    const r = rows[i]; const sku=(r.sku||'').trim().toLowerCase();
    if (!sku) return;
    const q = (quotes||[]).find(x=>(x.sku||'').trim().toLowerCase()===sku);
    if (!q) { alert('No quote found with SKU "'+r.sku+'".'); return; }
    const cpu = cbmPerUnitOf(q);
    if (cpu<=0) { alert('That quote has no carton dimensions or units-per-carton.'); return; }
    const u = Number(r.units)||0;
    if (u<=0) { alert('Enter units first, then CBM can be calculated.'); return; }
    setRows(p=>p.map((x,j)=>j===i?{...x, cbm:(cpu*u).toFixed(3), description:x.description||q.product||''}:x));
  };

  const save = async () => {
    if (total<=0) { alert('Add at least one cost line.'); return; }
    setSaving(true);
    const { data: inv, error } = await SB.from('freight_invoices').insert({
      invoice_number:f.number||null, forwarder_company_id:f.forwarder||null,
      invoice_date:f.date||null, origin:f.origin||null, destination:f.destination||null,
      mode:f.mode, container_type:f.container||null, containers:Number(f.containers)||1,
      total_cbm:baseCbm||0, total_weight_kg:Number(f.weight)||0,
      total_amount:total, notes:f.notes||null,
    }).select('id').single();
    if (error) { setSaving(false); alert('Error: '+error.message); return; }

    const lineRows = lines.filter(l=>Number(l.amount)>0).map((l,idx)=>({ invoice_id:inv.id, category:l.category, description:l.description||null, amount:Number(l.amount)||0, sort_order:idx }));
    if (lineRows.length) await SB.from('freight_invoice_lines').insert(lineRows);

    const valid = rows.filter(r=>(Number(r.cbm)||0)>0);
    const sumCbm = valid.reduce((a,r)=>a+(Number(r.cbm)||0),0);
    if (valid.length && sumCbm>0) {
      const allocRows = valid.map(r=>{
        const cbm=Number(r.cbm)||0, share=cbm/sumCbm, amt=total*share, u=Number(r.units)||0;
        const q=(quotes||[]).find(x=>(x.sku||'').trim().toLowerCase()===(r.sku||'').trim().toLowerCase());
        const t=tierFor(q,u);
        return { invoice_id:inv.id, sku:r.sku||null, description:r.description||null,
          units:u, cbm:cbm, cbm_share:Number(share.toFixed(6)), allocated_amount:Number(amt.toFixed(2)),
          freight_per_unit: u>0?Number((amt/u).toFixed(4)):0,
          exw_per_unit: t?Number(t.landed)||null:null,
          quoted_freight_per_unit: quotedFreightOf(t),
          client_price: t?Number(t.client)||null:null };
      });
      await SB.from('freight_allocations').insert(allocRows);
    }
    setSaving(false); onSaved();
  };

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-box modal-lg">
        <div className="modal-head"><h3>Log Freight Invoice</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-3">
            <div><label style={lbl}>Invoice #</label><input style={inp} value={f.number} onChange={set('number')} /></div>
            <div><label style={lbl}>Forwarder</label><select style={inp} value={f.forwarder} onChange={set('forwarder')}><option value="">—</option>{forwarders.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label style={lbl}>Invoice date</label><input type="date" style={inp} value={f.date} onChange={set('date')} /></div>
          </div>
          <div className="form-row-3" style={{marginTop:'12px'}}>
            <div><label style={lbl}>Origin *</label><input style={inp} value={f.origin} onChange={set('origin')} placeholder="Ningbo, CN" /></div>
            <div><label style={lbl}>Destination *</label><input style={inp} value={f.destination} onChange={set('destination')} placeholder="Savannah, GA" /></div>
            <div><label style={lbl}>Mode</label><select style={inp} value={f.mode} onChange={set('mode')}><option value="ocean">Ocean</option><option value="air">Air</option><option value="truck">Truck</option></select></div>
          </div>
          <div className="form-row-3" style={{marginTop:'12px'}}>
            <div><label style={lbl}>Container type</label><input style={inp} value={f.container} onChange={set('container')} placeholder="40HQ / 20GP / LCL" /></div>
            <div><label style={lbl}>Total CBM *</label><input style={inp} value={f.cbm} onChange={set('cbm')} placeholder={allocCbm>0?allocCbm.toFixed(2):'volume shipped'} /></div>
            <div><label style={lbl}>Total weight (kg)</label><input style={inp} value={f.weight} onChange={set('weight')} /></div>
          </div>

          {/* cost lines */}
          <div style={{marginTop:'18px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
              <span style={{fontSize:'12px',fontWeight:700,color:'#1A1A1C',textTransform:'uppercase',letterSpacing:'.05em'}}>Invoice line items</span>
              <button type="button" onClick={()=>setLines(p=>[...p,{ category:'other', description:'', amount:'' }])} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 10px',fontSize:'12px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>+ Add cost</button>
            </div>
            {lines.map((l,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'170px 1fr 110px 26px',gap:'7px',marginBottom:'6px',alignItems:'center'}}>
                <select style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.category} onChange={setLine(i,'category')}>{CATEGORIES.map(([v,lab])=><option key={v} value={v}>{lab}</option>)}</select>
                <input style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.description} onChange={setLine(i,'description')} placeholder="Detail (optional)" />
                <input style={{...inp,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={l.amount} onChange={setLine(i,'amount')} placeholder="0.00" />
                <button type="button" onClick={()=>setLines(p=>p.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#C0C0C4',cursor:'pointer',fontSize:'17px'}}>×</button>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'8px',fontSize:'14px'}}>
              <span style={{color:'#8A8A8E'}}>Invoice total</span><span style={{fontWeight:700,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{money(total,2)}</span>
            </div>
          </div>

          {/* allocation */}
          <div style={{marginTop:'20px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'6px'}}>
              <span style={{fontSize:'12px',fontWeight:700,color:'#1A1A1C',textTransform:'uppercase',letterSpacing:'.05em'}}>Allocate by CBM share</span>
              <button type="button" onClick={()=>setRows(p=>[...p,{ sku:'', description:'', units:'', cbm:'' }])} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 10px',fontSize:'12px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>+ Add SKU</button>
            </div>
            <div style={{fontSize:'11.5px',color:'#8A8A8E',marginBottom:'10px'}}>Enter each SKU in the container. Hit ⚡ to calculate CBM from that SKU&apos;s quote carton data.</div>
            <div style={{display:'grid',gridTemplateColumns:'130px 1fr 84px 96px 30px 88px 26px',gap:'6px',marginBottom:'6px'}}>
              {['SKU','Description','Units','CBM','','Share',''].map((h,i)=><div key={i} style={{...th,fontSize:'9.5px',textAlign:(i===2||i===3||i===5)?'right':'left'}}>{h}</div>)}
            </div>
            {rows.map((r,i)=>{
              const cbm=Number(r.cbm)||0; const share=allocCbm>0?cbm/allocCbm:0;
              return (
                <div key={i} style={{display:'grid',gridTemplateColumns:'130px 1fr 84px 96px 30px 88px 26px',gap:'6px',marginBottom:'6px',alignItems:'center'}}>
                  <input style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={r.sku} onChange={setRow(i,'sku')} placeholder="SKU" />
                  <input style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={r.description} onChange={setRow(i,'description')} placeholder="Description" />
                  <input style={{...inp,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={r.units} onChange={setRow(i,'units')} placeholder="0" />
                  <input style={{...inp,padding:'8px 9px',fontSize:'12.5px',textAlign:'right'}} value={r.cbm} onChange={setRow(i,'cbm')} placeholder="0.000" />
                  <button type="button" title="Calculate CBM from quote" onClick={()=>fillCbm(i)} style={{background:'#EAF3FE',border:'1px solid #BFDBFE',borderRadius:'7px',padding:'6px 0',fontSize:'12px',cursor:'pointer',color:'#0071E3'}}>⚡</button>
                  <div style={{fontSize:'12.5px',fontWeight:600,color:'#1A1A1C',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>{share>0?(share*100).toFixed(1)+'%':'—'}</div>
                  <button type="button" onClick={()=>setRows(p=>p.filter((_,j)=>j!==i))} style={{background:'none',border:'none',color:'#C0C0C4',cursor:'pointer',fontSize:'17px'}}>×</button>
                </div>
              );
            })}
            {allocCbm>0 && total>0 && (
              <div style={{marginTop:'10px',background:'#F7F7F9',borderRadius:'11px',padding:'12px 14px',fontSize:'12px',color:'#4A4A4E'}}>
                Allocating <b style={{color:'#1A1A1C'}}>{money(total,2)}</b> across <b style={{color:'#1A1A1C'}}>{allocCbm.toFixed(2)} CBM</b> = <b style={{color:'#1A1A1C'}}>{money(total/allocCbm,2)}/CBM</b>
                {Number(f.cbm)>0 && Math.abs(Number(f.cbm)-allocCbm)>0.5 && <span style={{color:'#B45309'}}> · note: allocated CBM differs from the invoice CBM ({Number(f.cbm).toFixed(2)})</span>}
              </div>
            )}
          </div>

          <div style={{marginTop:'14px'}}><label style={lbl}>Notes</label><textarea style={{...inp,minHeight:'52px',resize:'vertical'}} value={f.notes} onChange={set('notes')} /></div>
        </div>
        <div className="modal-foot" style={{display:'flex',justifyContent:'space-between'}}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={save} disabled={saving}>{saving?'Saving…':'Save invoice'}</button>
        </div>
      </div>
    </div>
  );
}

function Empty({ title, sub }) {
  return (
    <div style={{...card,padding:'56px 32px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'7px'}}>{title}</div>
      <div style={{color:'#8A8A8E',fontSize:'13.5px',maxWidth:'420px',margin:'0 auto',lineHeight:1.6}}>{sub}</div>
    </div>
  );
}
