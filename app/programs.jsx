'use client';
import React, { useState, useEffect, useRef } from "react";
import { SB } from "@/lib/supabase";

// ── stages ────────────────────────────────────────────────────────────────
const STAGES = [
  { key:'inquiry',        label:'Inquiry',        color:'#98989D' },
  { key:'quoting',        label:'Quoting',        color:'#0A84FF' },
  { key:'sampling',       label:'Sampling',       color:'#BF5AF2' },
  { key:'revision',       label:'Revision',       color:'#FF9F0A' },
  { key:'testing',        label:'Testing',        color:'#FF375F' },
  { key:'pre_production', label:'Pre-Production', color:'#5E5CE6' },
  { key:'production',     label:'Production',     color:'#D4A017' },
  { key:'shipped',        label:'Shipped',        color:'#64D2FF' },
  { key:'delivered',      label:'Delivered',      color:'#30D158' },
];
const STAGE_MAP = Object.fromEntries(STAGES.map(s=>[s.key,s]));
const STAGE_ORDER = STAGES.map(s=>s.key);
const STAGE_LABELS = STAGES.map(s=>s.label);

const TEAM = [
  { email:'kenley@kinguniversal.com',  name:'Kenley' },
  { email:'emily@kinguniversal.com',   name:'Emily' },
  { email:'loren@kinguniversal.com',   name:'Loren' },
  { email:'kristy@kinguniversal.com',  name:'Kristy' },
  { email:'steven@kinguniversal.com',  name:'Steven' },
  { email:'carmela@kinguniversal.com', name:'Carmela' },
  { email:'riley@kinguniversal.com',   name:'Riley' },
];
const nameFor = e => { const m=TEAM.find(t=>t.email===(e||'').toLowerCase()); return m?m.name:(e? e.split('@')[0] : 'Unassigned'); };

const STAGE_OWNER = {
  inquiry:'kenley@kinguniversal.com', quoting:'kenley@kinguniversal.com',
  sampling:'emily@kinguniversal.com', revision:'emily@kinguniversal.com',
  testing:'', pre_production:'emily@kinguniversal.com',
  production:'emily@kinguniversal.com', shipped:'kristy@kinguniversal.com', delivered:'kristy@kinguniversal.com',
};
const STAGE_TASKS = {
  sampling:      ['Request sample from factory','Sample received from factory','Sample sent to client','Client feedback received'],
  revision:      ['Log requested changes','Changes sent to factory','Revised sample received','Client sign-off'],
  testing:       ['Submit to lab','Results received','Compliance filed'],
  pre_production:['PO issued','Pre-production sample approved','Production deposit paid'],
  production:    ['Production started','Production complete','QC / inspection booked'],
  shipped:       ['Freight quote issued','Booking confirmed','Docs sent to client'],
};
const BLOCKERS = {
  none:    { label:'No blocker',        dot:'transparent', text:'#8A8A8E' },
  factory: { label:'Waiting · factory', dot:'#0A84FF', text:'#0A84FF' },
  client:  { label:'Waiting · client',  dot:'#FF9F0A', text:'#B45309' },
  us:      { label:'Waiting · us',      dot:'#FF375F', text:'#B91C1C' },
};

const STAGE_EMAILS = {
  inquiry: [
    { label:'Follow up with client', to:'client', subject:'Following up — {product}', body:'Hi {clientContact},\n\nGreat connecting on {product}. What do you need from us to move forward?\n\nBest,' },
  ],
  quoting: [
    { label:'Send quote to client', to:'client', subject:'Quote — {product} ({sku})', body:'Hi {clientContact},\n\nPlease find our quote for {product} attached. Happy to walk through any of it.\n\nBest,' },
  ],
  sampling: [
    { label:'Chase factory sample', to:'emily', subject:'Sample status — {product} ({sku})', body:'Hi Emily,\n\nChecking in on the sample for {product} ({sku}) for {client}. Sent {sent}, due back {due}. Where does it stand — and did the master sample go with it?\n\nThanks,' },
    { label:'Sample to client', to:'client', subject:'Sample on the way — {product}', body:'Hi {clientContact},\n\nThe {product} sample is heading your way. Let us know your thoughts and any changes.\n\nBest,' },
    { label:'Request feedback', to:'client', subject:'Sample feedback — {product}', body:'Hi {clientContact},\n\nFollowing up on the {product} sample (round {round}) — any feedback or approval?\n\nBest,' },
  ],
  revision: [
    { label:'Revisions to factory', to:'emily', subject:'Revisions — {product} ({sku})', body:'Hi Emily,\n\nClient changes on {product} (round {round}):\n\n[changes]\n\nCan we get a revised sample and timeline?\n\nThanks,' },
    { label:'Request sign-off', to:'client', subject:'Revised sample — {product}', body:'Hi {clientContact},\n\nThe revised {product} sample (round {round}) is with you. Good to move to production, or final tweaks?\n\nBest,' },
  ],
  testing: [
    { label:'Submit to lab', to:'', subject:'Test request — {product} ({sku})', body:'Hello,\n\nWe would like to submit {product} ({sku}) for compliance testing. Please advise required samples and turnaround.\n\nThanks,' },
  ],
  pre_production: [
    { label:'Confirm PO with factory', to:'emily', subject:'PO — {product} ({sku})', body:'Hi Emily,\n\nReady to issue the PO on {product} for {client}. Confirm pricing, lead time, and pre-production sample approval?\n\nThanks,' },
  ],
  production: [
    { label:'Production status', to:'emily', subject:'Production status — {product}', body:'Hi Emily,\n\nCan you get an update on {product} for {client}? Percent complete and expected finish.\n\nThanks,' },
  ],
  shipped: [
    { label:'Docs to client', to:'client', subject:'Shipping docs — {product}', body:'Hi {clientContact},\n\n{product} has shipped. Documents attached — we will keep you posted on arrival.\n\nBest,' },
  ],
  delivered: [
    { label:'Delivery confirmation', to:'client', subject:'Delivered — {product}', body:'Hi {clientContact},\n\nConfirming {product} has been delivered. Anything you need on our end?\n\nBest,' },
  ],
};
function fillTemplate(text, p) {
  const map = {
    product: p.product||'the product', sku: p.sku||'', client: p.client||'',
    clientContact: p.client_contact || (p.client? p.client : 'there'),
    factory: p.factory||'', round: String(p.sample_round||1),
    sent: p.sample_sent_date? fmtDate(p.sample_sent_date) : 'recently',
    due: p.sample_due_back? fmtDate(p.sample_due_back) : 'soon',
  };
  var out = text;
  Object.keys(map).forEach(function(k){ out = out.split('{'+k+'}').join(map[k]); });
  return out;
}
function defaultRecipient(role, p) {
  if (role==='emily') return 'emily@kinguniversal.com';
  if (role==='client') return p.client_email||'';
  if (role==='factory') return p.factory_email||'';
  return '';
}

const daysSince = s => { if(!s) return 0; const d=new Date(s); return Math.max(0,Math.round((Date.now()-d.getTime())/86400000)); };

// Load ExcelJS from CDN at runtime — no npm dependency needed
function loadExcelJS() {
  return new Promise(function(resolve, reject){
    if (typeof window!=='undefined' && window.ExcelJS) { resolve(window.ExcelJS); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = function(){ resolve(window.ExcelJS); };
    s.onerror = function(){ reject(new Error('Could not load the Excel engine — check the internet connection and try again.')); };
    document.head.appendChild(s);
  });
}
function fmtDate(s){ if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
const inp = {width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'9px 12px',fontSize:'13.5px',outline:'none',fontFamily:'inherit',boxSizing:'border-box',background:'#fff'};
const lbl = {display:'block',fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#86868B',marginBottom:'5px'};

function healthOf(p, tasks) {
  const open = tasks.filter(t=>!t.done);
  if (p.sample_due_back && daysSince(p.sample_due_back)>0 && ['sampling','revision'].includes(p.stage)) return 'stalled';
  if (open.some(t=>t.blocker==='us') && daysSince(p.stage_entered_at)>7) return 'stalled';
  if (daysSince(p.stage_entered_at)>14) return 'at_risk';
  if (open.some(t=>t.due_date && daysSince(t.due_date)>0)) return 'at_risk';
  return 'on_track';
}
const HEALTH = { on_track:{label:'On track',color:'#30D158'}, at_risk:{label:'At risk',color:'#FF9F0A'}, stalled:{label:'Stalled',color:'#FF375F'} };

// ═══════════════════════════════════════════════════════════════════════════
export default function Programs({ userEmail }) {
  const me = (userEmail||'riley@kinguniversal.com');
  const [programs, setPrograms] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [filterOwner, setFilterOwner] = useState('');
  const [filterBlocker, setFilterBlocker] = useState('');

  const load = async () => {
    const [pr, tk] = await Promise.all([
      SB.from('programs').select('*').eq('archived',false).order('updated_at',{ascending:false}),
      SB.from('program_tasks').select('*').order('sort_order'),
    ]);
    setPrograms(pr.data||[]); setTasks(tk.data||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const tasksFor = id => tasks.filter(t=>t.program_id===id);
  const shown = programs.filter(p=>{
    if (filterOwner && p.owner!==filterOwner) return false;
    if (filterBlocker) {
      const open = tasksFor(p.id).filter(t=>!t.done);
      if (!open.some(t=>t.blocker===filterBlocker)) return false;
    }
    return true;
  });

  const stalled = programs.filter(p=>healthOf(p,tasksFor(p.id))==='stalled');
  const waitUs = programs.filter(p=>tasksFor(p.id).some(t=>!t.done&&t.blocker==='us'));
  const waitClient = programs.filter(p=>tasksFor(p.id).some(t=>!t.done&&t.blocker==='client'));
  const waitFactory = programs.filter(p=>tasksFor(p.id).some(t=>!t.done&&t.blocker==='factory'));
  const overdueSamples = programs.filter(p=>p.sample_due_back&&daysSince(p.sample_due_back)>0&&['sampling','revision'].includes(p.stage));

  const advance = async (p, toStage) => {
    await SB.from('programs').update({ stage:toStage }).eq('id',p.id);
    const existing = tasks.filter(t=>t.program_id===p.id && t.stage===toStage);
    if (existing.length===0 && STAGE_TASKS[toStage]) {
      await SB.from('program_tasks').insert(STAGE_TASKS[toStage].map((task,i)=>({
        program_id:p.id, stage:toStage, task, owner:STAGE_OWNER[toStage]||null, assigned_by:me, blocker:'none', sort_order:i,
      })));
    }
    load();
  };

  if (loading) return <div style={{padding:'60px',textAlign:'center',color:'#86868B',fontSize:'14px'}}>Loading…</div>;
  const open = openId ? programs.find(p=>p.id===openId) : null;

  return (
    <div className="db-apple" style={{padding:'30px 28px 80px',background:'#F5F5F7',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>

      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'16px',marginBottom:'22px',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'28px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.021em',lineHeight:1.05}}>Programs</div>
          <div style={{fontSize:'14.5px',color:'#86868B',marginTop:'5px',letterSpacing:'-.01em'}}>{programs.length} active on the board</div>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={()=>setShowImport(true)} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>Import factory sheet</button>
          <button onClick={()=>setShowSheet(true)} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>Factory update sheet</button>
          <button onClick={()=>setShowNew(true)} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ New Program</button>
        </div>
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'12px',marginBottom:'22px'}}>
        {[
          { k:'Stalled', v:stalled.length, c:'#FF375F' },
          { k:'Overdue samples', v:overdueSamples.length, c:'#FF375F' },
          { k:'Waiting on us', v:waitUs.length, c:'#FF375F', f:'us' },
          { k:'Waiting on clients', v:waitClient.length, c:'#FF9F0A', f:'client' },
          { k:'Waiting on factories', v:waitFactory.length, c:'#0A84FF', f:'factory' },
        ].map(m=>(
          <button key={m.k} onClick={()=>m.f!==undefined?setFilterBlocker(filterBlocker===m.f?'':m.f):null}
            style={{background:m.f!==undefined&&filterBlocker===m.f?'#1D1D1F':'#fff',borderRadius:'16px',padding:'14px 16px',border:'none',boxShadow:'0 1px 3px rgba(0,0,0,.04)',cursor:m.f!==undefined?'pointer':'default',textAlign:'left',transition:'.15s'}}>
            <div style={{fontSize:'24px',fontWeight:600,letterSpacing:'-.02em',lineHeight:1,color:m.f!==undefined&&filterBlocker===m.f?'#fff':(m.v>0?m.c:'#1D1D1F'),fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
            <div style={{fontSize:'11.5px',color:m.f!==undefined&&filterBlocker===m.f?'rgba(255,255,255,.65)':'#86868B',marginTop:'5px',letterSpacing:'-.006em'}}>{m.k}</div>
          </button>
        ))}
      </div>

      <div style={{display:'flex',gap:'6px',marginBottom:'18px',flexWrap:'wrap',alignItems:'center'}}>
        <button onClick={()=>setFilterOwner('')} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',cursor:'pointer',background:!filterOwner?'#1D1D1F':'#fff',color:!filterOwner?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>Everyone</button>
        {TEAM.map(m=>(
          <button key={m.email} onClick={()=>setFilterOwner(filterOwner===m.email?'':m.email)} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 13px',border:'none',cursor:'pointer',background:filterOwner===m.email?'#1D1D1F':'#fff',color:filterOwner===m.email?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{m.name}</button>
        ))}
        {(filterOwner||filterBlocker) && <span style={{fontSize:'12px',color:'#86868B',marginLeft:'4px'}}>{shown.length} shown</span>}
      </div>

      {shown.length===0 ? (
        <div style={{background:'#fff',borderRadius:'20px',padding:'64px 32px',textAlign:'center',boxShadow:'0 1px 3px rgba(0,0,0,.04)'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',marginBottom:'8px',letterSpacing:'-.018em'}}>{programs.length===0?'The board is clear':'Nothing matches the filter'}</div>
          <div style={{color:'#86868B',fontSize:'14px',maxWidth:'420px',margin:'0 auto',lineHeight:1.6}}>{programs.length===0?'Mark a quote as won to put its program on the board, or add one manually.':'Clear the filters above to see everything.'}</div>
        </div>
      ) : (
        <div style={{display:'flex',gap:'14px',overflowX:'auto',paddingBottom:'14px'}}>
          {STAGES.filter(st=>shown.some(p=>p.stage===st.key)||['sampling','revision','production'].includes(st.key)).map(st=>{
            const col = shown.filter(p=>p.stage===st.key);
            return (
              <div key={st.key} style={{flex:'0 0 272px',minWidth:'272px'}}>
                <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'2px 6px 12px'}}>
                  <span style={{width:'9px',height:'9px',borderRadius:'50%',background:st.color}} />
                  <span style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.01em'}}>{st.label}</span>
                  <span style={{fontSize:'12px',color:'#86868B',fontVariantNumeric:'tabular-nums'}}>{col.length}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:'10px'}}>
                  {col.map(p=>{
                    const tk=tasksFor(p.id); const h=healthOf(p,tk); const openT=tk.filter(t=>!t.done);
                    const blk = openT.find(t=>t.blocker!=='none');
                    const dss = daysSince(p.stage_entered_at);
                    const sampleLate = p.sample_due_back&&daysSince(p.sample_due_back)>0&&['sampling','revision'].includes(p.stage);
                    return (
                      <button key={p.id} onClick={()=>setOpenId(p.id)} style={{background:'#fff',borderRadius:'16px',padding:'15px 16px',border:'none',boxShadow:'0 1px 3px rgba(0,0,0,.05)',cursor:'pointer',textAlign:'left',display:'block',width:'100%',borderLeft:'3px solid '+HEALTH[h].color}}>
                        <div style={{fontSize:'14px',fontWeight:600,color:'#1D1D1F',lineHeight:1.35,letterSpacing:'-.012em',overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{p.product||p.sku||'Untitled'}</div>
                        <div style={{fontSize:'12px',color:'#86868B',marginTop:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.client||'—'}{p.factory?' · '+p.factory:''}</div>
                        <div style={{display:'flex',alignItems:'center',gap:'6px',marginTop:'11px',flexWrap:'wrap'}}>
                          <span style={{fontSize:'11px',fontWeight:500,color:dss>14?'#FF375F':'#86868B',background:dss>14?'rgba(255,55,95,.08)':'#F5F5F7',borderRadius:'6px',padding:'2px 8px'}}>{dss}d</span>
                          {openT.length>0 && <span style={{fontSize:'11px',fontWeight:500,color:'#86868B',background:'#F5F5F7',borderRadius:'6px',padding:'2px 8px'}}>{openT.length} open</span>}
                          {blk && <span style={{fontSize:'11px',fontWeight:600,color:BLOCKERS[blk.blocker].text,background:'#F5F5F7',borderRadius:'6px',padding:'2px 8px'}}>{BLOCKERS[blk.blocker].label}</span>}
                          {sampleLate && <span style={{fontSize:'11px',fontWeight:600,color:'#FF375F',background:'rgba(255,55,95,.08)',borderRadius:'6px',padding:'2px 8px'}}>sample overdue</span>}
                        </div>
                        <div style={{fontSize:'11px',color:'#B0B0B4',marginTop:'9px'}}>{nameFor(p.owner)}</div>
                      </button>
                    );
                  })}
                  {col.length===0 && <div style={{border:'1.5px dashed rgba(0,0,0,.08)',borderRadius:'16px',padding:'22px 0',textAlign:'center',fontSize:'12px',color:'#C0C0C4'}}>empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {open && <ProgramDetail program={open} tasks={tasksFor(open.id)} me={me} onClose={()=>setOpenId(null)} onAdvance={advance} onReload={load} />}
      {showNew && <NewProgramModal me={me} onClose={()=>setShowNew(false)} onCreated={()=>{setShowNew(false);load();}} />}
      {showSheet && <FactorySheetModal programs={programs} onClose={()=>setShowSheet(false)} />}
      {showImport && <ImportSheetModal programs={programs} me={me} onClose={()=>setShowImport(false)} onApplied={()=>{setShowImport(false);load();}} />}
    </div>
  );
}

// ── FACTORY UPDATE SHEET (Excel export) ───────────────────────────────────
function FactorySheetModal({ programs, onClose }) {
  const factories = Array.from(new Set(programs.map(p=>(p.factory||'').trim()).filter(Boolean))).sort();
  const [factory, setFactory] = useState(factories[0]||'');
  const [busy, setBusy] = useState(false);
  const rows = programs.filter(p=>(p.factory||'').trim()===factory);

  const generate = async () => {
    if (!rows.length) { alert('No programs for this factory.'); return; }
    setBusy(true);
    try {
      const mod = await import('exceljs');
      const ExcelJS = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Weekly Update');
      ws.columns = [
        { header:'Program ID (do not edit)', key:'id', width:38 },
        { header:'SKU', key:'sku', width:14 },
        { header:'Product', key:'product', width:34 },
        { header:'Client', key:'client', width:18 },
        { header:'Current Stage', key:'stage', width:16 },
        { header:'Factory Status (select)', key:'status', width:20 },
        { header:'% Complete', key:'pct', width:12 },
        { header:'Sample Round', key:'round', width:13 },
        { header:'Expected Ship / Ready Date', key:'ship', width:22 },
        { header:'Notes from factory', key:'notes', width:46 },
      ];
      ws.getRow(1).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF1D1D1F' } };
      ws.getRow(1).font = { bold:true, color:{ argb:'FFFFFFFF' } };
      rows.forEach(p=>{
        ws.addRow({ id:p.id, sku:p.sku||'', product:p.product||'', client:p.client||'',
          stage:(STAGE_MAP[p.stage]||{}).label||p.stage, status:'', pct:'', round:p.sample_round||1, ship:'', notes:'' });
      });
      for (let r=2; r<=rows.length+1; r++) {
        ws.getCell('F'+r).dataValidation = {
          type:'list', allowBlank:true, formulae:['"'+STAGE_LABELS.join(',')+'"'],
          showErrorMessage:true, errorTitle:'Pick from the list', error:'Please choose one of the preset statuses.',
        };
      }
      ws.views = [{ state:'frozen', ySplit:1 }];
      const buf = await wb.xlsx.writeBuffer();
      const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const dt = new Date(); const stamp = dt.getFullYear()+'-'+String(dt.getMonth()+1).padStart(2,'0')+'-'+String(dt.getDate()).padStart(2,'0');
      const fname = 'KUI-Weekly-Update-'+factory.replace(/[^a-z0-9]/gi,'_')+'-'+stamp+'.xlsx';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = fname; a.click();
      URL.revokeObjectURL(a.href);
      const subject = 'KUI weekly update — please fill and return ('+stamp+')';
      const body = 'Hi Emily,\n\nPlease open the attached sheet, set the Factory Status for each item using the dropdown, add % complete, expected ship dates, and notes, then reply with the file.\n\nThank you!\n';
      setTimeout(()=>{ window.location.href = 'mailto:emily@kinguniversal.com?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body); }, 400);
      onClose();
    } catch (e) {
      alert('Could not generate the sheet: '+(e&&e.message?e.message:e)+'\n\nIf this says the module is missing, exceljs must be added to package.json first.');
    }
    setBusy(false);
  };

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',zIndex:1100}}>
      <div style={{background:'#fff',borderRadius:'20px',width:'100%',maxWidth:'440px',boxShadow:'0 8px 40px rgba(0,0,0,.16)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>Factory update sheet</div>
          <div style={{fontSize:'13px',color:'#86868B',marginTop:'4px',lineHeight:1.5}}>Generates the weekly Excel for one factory — status dropdowns locked to your stages — then opens the email to send it.</div>
        </div>
        <div style={{padding:'18px 24px'}}>
          <label style={lbl}>Factory</label>
          <select style={inp} value={factory} onChange={e=>setFactory(e.target.value)}>
            {factories.length===0 && <option value="">— no factories on programs yet —</option>}
            {factories.map(f=><option key={f} value={f}>{f}</option>)}
          </select>
          <div style={{fontSize:'12.5px',color:'#86868B',marginTop:'10px'}}>{rows.length} program{rows.length===1?'':'s'} will be included.</div>
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
          <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,color:'#1D1D1F',cursor:'pointer'}}>Cancel</button>
          <button onClick={generate} disabled={busy||!factory} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:!factory?0.5:1}}>{busy?'Generating…':'Generate & email'}</button>
        </div>
      </div>
    </div>
  );
}

// ── IMPORT FACTORY SHEET ──────────────────────────────────────────────────
function ImportSheetModal({ programs, me, onClose, onApplied }) {
  const fileRef = useRef(null);
  const [changes, setChanges] = useState(null);
  const [busy, setBusy] = useState(false);

  const parse = async (file) => {
    setBusy(true);
    try {
      const mod = await import('exceljs');
      const ExcelJS = mod.default || mod;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await file.arrayBuffer());
      const ws = wb.worksheets[0];
      const out = [];
      ws.eachRow((row, n) => {
        if (n===1) return;
        const val = c => { const v=row.getCell(c).value; if(v==null) return ''; if(typeof v==='object'&&v.text!=null) return String(v.text); if(typeof v==='object'&&v.result!=null) return String(v.result); if(v instanceof Date) return v.toISOString().slice(0,10); return String(v); };
        const id = val(1).trim();
        const prog = programs.find(p=>p.id===id);
        if (!prog) return;
        const statusLabel = val(6).trim();
        const stageKey = (STAGES.find(s=>s.label.toLowerCase()===statusLabel.toLowerCase())||{}).key || null;
        const pct = val(7).trim(); const ship = val(9).trim(); const note = val(10).trim();
        const stageChanged = stageKey && stageKey!==prog.stage;
        if (stageChanged || note || pct || ship) out.push({ prog, stageKey: stageChanged?stageKey:null, pct, ship, note });
      });
      setChanges(out);
    } catch (e) {
      alert('Could not read that file: '+(e&&e.message?e.message:e));
    }
    setBusy(false);
  };

  const apply = async () => {
    setBusy(true);
    for (const c of changes) {
      if (c.stageKey) await SB.from('programs').update({ stage:c.stageKey }).eq('id',c.prog.id);
      const parts = [];
      if (c.note) parts.push(c.note);
      if (c.pct) parts.push('Progress: '+c.pct+'%');
      if (c.ship) parts.push('Expected ship/ready: '+c.ship);
      if (parts.length) {
        await SB.from('program_notes').insert({ program_id:c.prog.id, author:'Factory (via update sheet)', source:'factory_sheet', note:parts.join(' · ') });
      }
    }
    setBusy(false); onApplied();
  };

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',zIndex:1100,overflowY:'auto'}}>
      <div style={{background:'#fff',borderRadius:'20px',width:'100%',maxWidth:'560px',boxShadow:'0 8px 40px rgba(0,0,0,.16)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0'}}>
          <div style={{fontSize:'17px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.018em'}}>Import factory sheet</div>
          <div style={{fontSize:'13px',color:'#86868B',marginTop:'4px',lineHeight:1.5}}>Upload the sheet the factory sent back. You review every change before it applies.</div>
        </div>
        <div style={{padding:'18px 24px'}}>
          {!changes ? (
            <button onClick={()=>fileRef.current&&fileRef.current.click()} disabled={busy} style={{width:'100%',border:'1.5px dashed rgba(0,0,0,.15)',background:'#FAFAFA',borderRadius:'14px',padding:'34px 16px',fontSize:'13.5px',color:'#5A5A5E',cursor:'pointer'}}>
              {busy?'Reading…':'Tap to choose the returned .xlsx file'}
            </button>
          ) : changes.length===0 ? (
            <div style={{fontSize:'13.5px',color:'#86868B',textAlign:'center',padding:'22px 0'}}>No changes found in that sheet.</div>
          ) : (
            <div style={{maxHeight:'44vh',overflowY:'auto'}}>
              {changes.map((c,i)=>(
                <div key={i} style={{padding:'12px 0',borderBottom:'1px solid rgba(0,0,0,.06)'}}>
                  <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F'}}>{c.prog.product||c.prog.sku}</div>
                  {c.stageKey && <div style={{fontSize:'12.5px',marginTop:'4px',color:'#0A84FF',fontWeight:500}}>{(STAGE_MAP[c.prog.stage]||{}).label} → {(STAGE_MAP[c.stageKey]||{}).label}</div>}
                  {(c.note||c.pct||c.ship) && <div style={{fontSize:'12.5px',color:'#5A5A5E',marginTop:'4px',lineHeight:1.5}}>{[c.note, c.pct?('Progress: '+c.pct+'%'):null, c.ship?('Ship: '+c.ship):null].filter(Boolean).join(' · ')}</div>}
                </div>
              ))}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".xlsx" style={{display:'none'}} onChange={e=>{ const f=e.target.files&&e.target.files[0]; if(f) parse(f); }} />
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'space-between',gap:'8px'}}>
          <button onClick={()=>{setChanges(null);}} style={{background:'none',border:'none',color:'#86868B',fontSize:'13px',cursor:'pointer',visibility:changes?'visible':'hidden'}}>Choose different file</button>
          <div style={{display:'flex',gap:'8px'}}>
            <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,color:'#1D1D1F',cursor:'pointer'}}>Cancel</button>
            {changes&&changes.length>0 && <button onClick={apply} disabled={busy} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>{busy?'Applying…':'Apply '+changes.length+' update'+(changes.length===1?'':'s')}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── DETAIL ───────────────────────────────────────────────────────────────
function ProgramDetail({ program, tasks, me, onClose, onAdvance, onReload }) {
  const [p, setP] = useState(program);
  const [notes, setNotes] = useState([]);
  const [taskText, setTaskText] = useState('');
  const [taskWho, setTaskWho] = useState(STAGE_OWNER[program.stage]||me);
  const [taskDue, setTaskDue] = useState('');
  const [noteText, setNoteText] = useState('');
  const [emailTpl, setEmailTpl] = useState(null);
  const st = STAGE_MAP[p.stage]||STAGES[0];
  const idx = STAGE_ORDER.indexOf(p.stage);
  const nextStage = idx>=0 && idx<STAGE_ORDER.length-1 ? STAGE_ORDER[idx+1] : null;

  useEffect(()=>{ SB.from('program_notes').select('*').eq('program_id',program.id).order('created_at',{ascending:false}).then(({data})=>setNotes(data||[])); },[program.id]);

  const saveField = async (patch) => { setP(prev=>({...prev,...patch})); await SB.from('programs').update(patch).eq('id',p.id); onReload(); };
  const addTask = async () => {
    if (!taskText.trim()) return;
    await SB.from('program_tasks').insert({ program_id:p.id, stage:p.stage, task:taskText.trim(), owner:taskWho, assigned_by:me, due_date:taskDue||null, blocker:'none', sort_order:tasks.length });
    setTaskText(''); setTaskDue(''); onReload();
  };
  const addNote = async () => {
    if (!noteText.trim()) return;
    const { data } = await SB.from('program_notes').insert({ program_id:p.id, author:nameFor(me), source:'manual', note:noteText.trim() }).select('*').single();
    if (data) setNotes(prev=>[data,...prev]);
    setNoteText('');
  };
  const toggleTask = async (t) => { await SB.from('program_tasks').update({ done:!t.done, done_at:!t.done?new Date().toISOString():null }).eq('id',t.id); onReload(); };
  const setBlocker = async (t, b) => { await SB.from('program_tasks').update({ blocker:b }).eq('id',t.id); onReload(); };
  const delTask = async (id) => { await SB.from('program_tasks').delete().eq('id',id); onReload(); };
  const archive = async () => { if(window.confirm('Archive this program?')){ await SB.from('programs').update({archived:true}).eq('id',p.id); onClose(); onReload(); } };

  const stageTasks = tasks.filter(t=>t.stage===p.stage);
  const otherOpen = tasks.filter(t=>t.stage!==p.stage && !t.done);
  const inSampling = ['sampling','revision'].includes(p.stage);

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'36px 16px',zIndex:1000,overflowY:'auto'}}>
      <div style={{background:'#fff',borderRadius:'22px',width:'100%',maxWidth:'700px',boxShadow:'0 12px 48px rgba(0,0,0,.2)',overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'22px 26px 18px',borderBottom:'1px solid rgba(0,0,0,.06)'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'19px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.02em'}}>{p.product||p.sku||'Untitled program'}</div>
              <div style={{fontSize:'13px',color:'#86868B',marginTop:'3px'}}>{[p.client,p.factory,p.sku].filter(Boolean).join(' · ')||'—'}</div>
            </div>
            <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'50%',width:'30px',height:'30px',fontSize:'16px',color:'#5A5A5E',cursor:'pointer',lineHeight:1}}>×</button>
          </div>
          <div style={{display:'flex',gap:'4px',marginTop:'16px',flexWrap:'wrap'}}>
            {STAGES.map(s=>{ const active=s.key===p.stage; const passed=STAGE_ORDER.indexOf(s.key)<idx;
              return <button key={s.key} onClick={()=>saveField({stage:s.key})} style={{fontSize:'11px',fontWeight:600,padding:'5px 10px',borderRadius:'980px',border:'none',cursor:'pointer',background:active?s.color:passed?'#EAEAEE':'#F5F5F7',color:active?'#fff':passed?'#5A5A5E':'#B0B0B4'}}>{s.label}</button>;
            })}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:'10px',marginTop:'14px',flexWrap:'wrap'}}>
            {nextStage && <button onClick={()=>{ onAdvance(p,nextStage); setP(prev=>({...prev,stage:nextStage})); }} style={{background:'#0A84FF',color:'#fff',border:'none',borderRadius:'980px',padding:'8px 16px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Advance to {STAGE_MAP[nextStage].label} →</button>}
            <select style={{...inp,width:'auto',padding:'8px 12px',borderRadius:'980px'}} value={p.owner||''} onChange={e=>saveField({owner:e.target.value})}>
              <option value="">Unassigned</option>
              {TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}
            </select>
            <span style={{fontSize:'12.5px',color:daysSince(p.stage_entered_at)>14?'#FF375F':'#86868B'}}>{daysSince(p.stage_entered_at)} days in {st.label}</span>
          </div>
        </div>

        <div style={{padding:'20px 26px',maxHeight:'54vh',overflowY:'auto'}}>
          {inSampling && (
            <div style={{background:'#F5F5F7',borderRadius:'16px',padding:'16px 18px',marginBottom:'20px'}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(130px,1fr))',gap:'14px'}}>
                <div><label style={lbl}>Sample round</label>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <button onClick={()=>saveField({sample_round:Math.max(1,(Number(p.sample_round)||1)-1)})} style={{...inp,width:'32px',padding:'7px 0',textAlign:'center',cursor:'pointer'}}>−</button>
                    <span style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',minWidth:'22px',textAlign:'center'}}>{p.sample_round||1}</span>
                    <button onClick={()=>saveField({sample_round:(Number(p.sample_round)||1)+1})} style={{...inp,width:'32px',padding:'7px 0',textAlign:'center',cursor:'pointer'}}>+</button>
                  </div>
                </div>
                <div><label style={lbl}>Master sample</label>
                  <div style={{display:'flex',gap:'6px'}}>
                    {[['Yes',true],['No',false]].map(([l,v])=>(
                      <button key={l} onClick={()=>saveField({master_sample_included:v})} style={{flex:1,...inp,padding:'7px 0',textAlign:'center',cursor:'pointer',fontWeight:600,background:p.master_sample_included===v?'#1D1D1F':'#fff',color:p.master_sample_included===v?'#fff':'#86868B',border:'1px solid '+(p.master_sample_included===v?'#1D1D1F':'rgba(0,0,0,.1)')}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div><label style={lbl}>Sent</label><input type="date" style={inp} value={p.sample_sent_date||''} onChange={e=>saveField({sample_sent_date:e.target.value||null})} /></div>
                <div><label style={lbl}>Due back</label><input type="date" style={{...inp,borderColor:p.sample_due_back&&daysSince(p.sample_due_back)>0?'#FF375F':'rgba(0,0,0,.1)'}} value={p.sample_due_back||''} onChange={e=>saveField({sample_due_back:e.target.value||null})} /></div>
              </div>
              {p.sample_due_back && daysSince(p.sample_due_back)>0 && <div style={{fontSize:'12.5px',color:'#FF375F',marginTop:'11px',fontWeight:500}}>Sample is {daysSince(p.sample_due_back)} days overdue.</div>}
            </div>
          )}

          {(STAGE_EMAILS[p.stage]||[]).length>0 && (
            <div style={{marginBottom:'20px'}}>
              <div style={{fontSize:'11.5px',fontWeight:600,color:'#86868B',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'9px'}}>Quick emails</div>
              <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}>
                {(STAGE_EMAILS[p.stage]||[]).map((tpl,i)=>(
                  <button key={i} onClick={()=>setEmailTpl(tpl)} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'8px 14px',fontSize:'12.5px',fontWeight:500,color:'#1D1D1F',cursor:'pointer'}}>✉ {tpl.label}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{fontSize:'11.5px',fontWeight:600,color:'#86868B',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'9px'}}>{st.label} checklist</div>
          {stageTasks.length===0 && <div style={{fontSize:'13px',color:'#B0B0B4',marginBottom:'10px'}}>No tasks in this stage.</div>}
          {stageTasks.map(t=><TaskRow key={t.id} t={t} onToggle={toggleTask} onBlocker={setBlocker} onDel={delTask} />)}
          <div style={{display:'flex',gap:'6px',marginTop:'10px',flexWrap:'wrap'}}>
            <select style={{...inp,flex:'0 0 104px'}} value={taskWho} onChange={e=>setTaskWho(e.target.value)}>{TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}</select>
            <input style={{...inp,flex:'1 1 140px'}} value={taskText} onChange={e=>setTaskText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTask()} placeholder="Add a task…" />
            <input type="date" style={{...inp,flex:'0 0 128px'}} value={taskDue} onChange={e=>setTaskDue(e.target.value)} />
            <button onClick={addTask} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'10px',padding:'9px 15px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Add</button>
          </div>
          {otherOpen.length>0 && (
            <div style={{marginTop:'18px'}}>
              <div style={{fontSize:'11px',fontWeight:600,color:'#B0B0B4',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'7px'}}>Open elsewhere ({otherOpen.length})</div>
              {otherOpen.map(t=><TaskRow key={t.id} t={t} dim onToggle={toggleTask} onBlocker={setBlocker} onDel={delTask} />)}
            </div>
          )}

          <div style={{marginTop:'22px'}}>
            <div style={{fontSize:'11.5px',fontWeight:600,color:'#86868B',textTransform:'uppercase',letterSpacing:'.06em',marginBottom:'9px'}}>Notes</div>
            <div style={{display:'flex',gap:'6px',marginBottom:'12px'}}>
              <input style={{...inp,flex:1}} value={noteText} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addNote()} placeholder="Add a note to the record…" />
              <button onClick={addNote} style={{background:'#F5F5F7',border:'none',borderRadius:'10px',padding:'9px 15px',fontSize:'13px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Post</button>
            </div>
            {notes.length===0 && <div style={{fontSize:'13px',color:'#B0B0B4'}}>No notes yet. Factory sheet imports land here automatically.</div>}
            {notes.map(n=>(
              <div key={n.id} style={{padding:'10px 0',borderBottom:'1px solid rgba(0,0,0,.05)'}}>
                <div style={{fontSize:'13.5px',color:'#1D1D1F',lineHeight:1.5}}>{n.note}</div>
                <div style={{fontSize:'11px',color:'#B0B0B4',marginTop:'3px'}}>{n.author||'—'}{n.source==='factory_sheet'?' · factory sheet':''} · {new Date(n.created_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{padding:'14px 26px',borderTop:'1px solid rgba(0,0,0,.06)',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <button onClick={archive} style={{background:'none',border:'none',color:'#FF375F',fontSize:'13px',fontWeight:500,cursor:'pointer'}}>Archive</button>
          <button onClick={onClose} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 20px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>Done</button>
        </div>
      </div>
      {emailTpl && <EmailComposer tpl={emailTpl} program={p} onClose={()=>setEmailTpl(null)} />}
    </div>
  );
}

function TaskRow({ t, dim, onToggle, onBlocker, onDel }) {
  const overdue = t.due_date && !t.done && daysSince(t.due_date)>0;
  const b = BLOCKERS[t.blocker]||BLOCKERS.none;
  return (
    <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'8px 0',borderBottom:'1px solid rgba(0,0,0,.05)',opacity:dim&&t.done?0.5:1}}>
      <button onClick={()=>onToggle(t)} style={{background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0,display:'flex'}}>
        {t.done
          ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#30D158" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
          : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#C7C7CC" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/></svg>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'13.5px',color:t.done?'#B0B0B4':'#1D1D1F',textDecoration:t.done?'line-through':'none',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.task}</div>
        <div style={{fontSize:'11px',color:overdue?'#FF375F':'#B0B0B4',marginTop:'1px'}}>{nameFor(t.owner)}{t.due_date?' · due '+fmtDate(t.due_date):''}{overdue?' · overdue':''}</div>
      </div>
      {!t.done && (
        <select value={t.blocker||'none'} onChange={e=>onBlocker(t,e.target.value)} style={{fontSize:'11px',border:'none',borderRadius:'980px',padding:'5px 9px',color:b.text,fontWeight:600,cursor:'pointer',background:'#F5F5F7',flexShrink:0}}>
          <option value="none">No blocker</option>
          <option value="factory">Waiting · factory</option>
          <option value="client">Waiting · client</option>
          <option value="us">Waiting · us</option>
        </select>
      )}
      <button onClick={()=>onDel(t.id)} style={{background:'none',border:'none',color:'#C7C7CC',cursor:'pointer',fontSize:'16px',flexShrink:0}}>×</button>
    </div>
  );
}

function EmailComposer({ tpl, program, onClose }) {
  const [to, setTo] = useState(defaultRecipient(tpl.to, program));
  const [subject, setSubject] = useState(fillTemplate(tpl.subject, program));
  const [body, setBody] = useState(fillTemplate(tpl.body, program));
  const chips = [
    ...TEAM.map(m=>({ label:m.name, email:m.email })),
    program.client_email ? { label:(program.client_contact||program.client||'Client'), email:program.client_email } : null,
    program.factory_email ? { label:(program.factory_contact||program.factory||'Factory'), email:program.factory_email } : null,
  ].filter(Boolean);
  const openMail = () => { window.location.href = 'mailto:'+(to||'')+'?subject='+encodeURIComponent(subject)+'&body='+encodeURIComponent(body); onClose(); };
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',zIndex:1200}}>
      <div style={{background:'#fff',borderRadius:'20px',width:'100%',maxWidth:'520px',boxShadow:'0 12px 48px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F',letterSpacing:'-.016em'}}>{tpl.label}</div>
          <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'50%',width:'28px',height:'28px',fontSize:'15px',color:'#5A5A5E',cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'16px 24px'}}>
          <label style={lbl}>To</label>
          <input style={inp} value={to} onChange={e=>setTo(e.target.value)} placeholder="recipient@email.com" />
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'8px',marginBottom:'14px'}}>
            {chips.map((c,i)=>(
              <button key={i} onClick={()=>setTo(c.email)} style={{fontSize:'11.5px',fontWeight:500,border:'none',background:to===c.email?'#1D1D1F':'#F5F5F7',color:to===c.email?'#fff':'#5A5A5E',borderRadius:'980px',padding:'5px 12px',cursor:'pointer'}}>{c.label}</button>
            ))}
          </div>
          <label style={lbl}>Subject</label>
          <input style={{...inp,marginBottom:'14px'}} value={subject} onChange={e=>setSubject(e.target.value)} />
          <label style={lbl}>Message</label>
          <textarea style={{...inp,minHeight:'150px',resize:'vertical',lineHeight:1.55}} value={body} onChange={e=>setBody(e.target.value)} />
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'flex-end'}}>
          <button onClick={openMail} style={{background:'#0A84FF',color:'#fff',border:'none',borderRadius:'980px',padding:'10px 20px',fontSize:'13.5px',fontWeight:600,cursor:'pointer'}}>Open in Mail</button>
        </div>
      </div>
    </div>
  );
}

// ── NEW PROGRAM ────────────────────────────────────────────────────────────
function NewProgramModal({ me, onClose, onCreated }) {
  const [f, setF] = useState({ product:'', sku:'', client:'', factory:'', stage:'inquiry', owner:me });
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const save = async () => {
    if (!f.product.trim() && !f.sku.trim()) { alert('Enter a product name or SKU.'); return; }
    setSaving(true);
    const { data, error } = await SB.from('programs').insert({ ...f, owner:f.owner||null }).select('id').single();
    if (error) { setSaving(false); alert('Error: '+error.message); return; }
    if (STAGE_TASKS[f.stage]) {
      await SB.from('program_tasks').insert(STAGE_TASKS[f.stage].map((task,i)=>({ program_id:data.id, stage:f.stage, task, owner:STAGE_OWNER[f.stage]||null, assigned_by:me, blocker:'none', sort_order:i })));
    }
    setSaving(false); onCreated();
  };
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',zIndex:1000}}>
      <div style={{background:'#fff',borderRadius:'20px',width:'100%',maxWidth:'460px',boxShadow:'0 12px 48px rgba(0,0,0,.2)'}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'20px 24px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:'16px',fontWeight:600,color:'#1D1D1F'}}>New Program</div>
          <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'50%',width:'28px',height:'28px',fontSize:'15px',color:'#5A5A5E',cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'18px 24px'}}>
          <div style={{marginBottom:'12px'}}><label style={lbl}>Product</label><input style={inp} value={f.product} onChange={set('product')} placeholder="e.g. Insulated tumbler 20oz" /></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div><label style={lbl}>SKU</label><input style={inp} value={f.sku} onChange={set('sku')} /></div>
            <div><label style={lbl}>Client</label><input style={inp} value={f.client} onChange={set('client')} /></div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'12px'}}>
            <div><label style={lbl}>Factory</label><input style={inp} value={f.factory} onChange={set('factory')} /></div>
            <div><label style={lbl}>Owner</label><select style={inp} value={f.owner} onChange={set('owner')}>{TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}</select></div>
          </div>
          <div><label style={lbl}>Starting stage</label><select style={inp} value={f.stage} onChange={set('stage')}>{STAGES.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></div>
        </div>
        <div style={{padding:'0 24px 20px',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
          <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'9px 17px',fontSize:'13.5px',fontWeight:500,color:'#1D1D1F',cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>{saving?'Creating…':'Create'}</button>
        </div>
      </div>
    </div>
  );
}
