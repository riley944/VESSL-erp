'use client';
import React, { useState, useEffect } from "react";
import { SB } from "@/lib/supabase";

// ── stages ────────────────────────────────────────────────────────────────
const STAGES = [
  { key:'inquiry',        label:'Inquiry',        color:'#8E8E93' },
  { key:'quoting',        label:'Quoting',        color:'#0071E3' },
  { key:'sampling',       label:'Sampling',       color:'#AF52DE' },
  { key:'revision',       label:'Revision',       color:'#FF9500' },
  { key:'testing',        label:'Testing',        color:'#FF375F' },
  { key:'pre_production', label:'Pre-Production', color:'#5856D6' },
  { key:'production',     label:'Production',     color:'#FF9F0A' },
  { key:'shipped',        label:'Shipped',        color:'#30B0C7' },
  { key:'delivered',      label:'Delivered',      color:'#34C759' },
];
const STAGE_MAP = Object.fromEntries(STAGES.map(s=>[s.key,s]));
const STAGE_ORDER = STAGES.map(s=>s.key);

const TEAM = [
  { email:'kenley@kinguniversal.com',  name:'Kenley' },
  { email:'emily@kinguniversal.com',   name:'Emily' },
  { email:'loren@kinguniversal.com',   name:'Loren' },
  { email:'kristy@kinguniversal.com',  name:'Kristy' },
  { email:'riley@kinguniversal.com',   name:'Riley' },
];
const nameFor = e => { const m=TEAM.find(t=>t.email===(e||'').toLowerCase()); return m?m.name:(e? e.split('@')[0] : 'Unassigned'); };

// default owner per stage (editable per task)
const STAGE_OWNER = {
  inquiry:'kenley@kinguniversal.com', quoting:'kenley@kinguniversal.com',
  sampling:'emily@kinguniversal.com', revision:'emily@kinguniversal.com',
  testing:'', pre_production:'emily@kinguniversal.com',
  production:'emily@kinguniversal.com', shipped:'kristy@kinguniversal.com', delivered:'kristy@kinguniversal.com',
};

// stage → default task templates (auto-added when a program enters the stage)
const STAGE_TASKS = {
  sampling:      ['Request sample from factory','Sample received from factory','Sample sent to client','Client feedback received'],
  revision:      ['Log requested changes','Changes sent to factory','Revised sample received','Client sign-off'],
  testing:       ['Submit to lab','Results received','Compliance filed'],
  pre_production:['PO issued','Pre-production sample approved','Production deposit paid'],
  production:    ['Production started','Production complete','QC / inspection booked'],
  shipped:       ['Freight quote issued','Booking confirmed','Docs sent to client'],
};

const BLOCKERS = {
  none:    { label:'—',                dot:'transparent', text:'#8A8A8E' },
  factory: { label:'Waiting on factory', dot:'#0071E3',   text:'#0071E3' },
  client:  { label:'Waiting on client',  dot:'#FF9500',   text:'#B45309' },
  us:      { label:'Waiting on us',      dot:'#FF375F',   text:'#B91C1C' },
};

const money = (n) => '$'+Number(n||0).toLocaleString();
const daysSince = s => { if(!s) return 0; const d=new Date(s); return Math.max(0,Math.round((Date.now()-d.getTime())/86400000)); };
const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); };
const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 1px 3px rgba(0,0,0,.04)'};
const inp = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'9px 11px',fontSize:'13.5px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const lbl = {display:'block',fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'5px'};

// health derivation
function healthOf(p, tasks) {
  const open = tasks.filter(t=>!t.done);
  if (p.sample_due_back && daysSince(p.sample_due_back)>0 && ['sampling','revision'].includes(p.stage)) return 'stalled';
  if (open.some(t=>t.blocker==='us') && daysSince(p.stage_entered_at)>7) return 'stalled';
  if (daysSince(p.stage_entered_at)>14) return 'at_risk';
  if (open.some(t=>t.due_date && daysSince(t.due_date)>0)) return 'at_risk';
  return 'on_track';
}
const HEALTH = { on_track:{label:'On track',color:'#34C759'}, at_risk:{label:'At risk',color:'#FF9500'}, stalled:{label:'Stalled',color:'#FF375F'} };

// ═══════════════════════════════════════════════════════════════════════════
export default function Programs({ userEmail }) {
  const me = (userEmail||'riley@kinguniversal.com');
  const [programs, setPrograms] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState('board'); // board | list
  const [showNew, setShowNew] = useState(false);
  const [filterOwner, setFilterOwner] = useState('');

  const load = async () => {
    setLoading(true);
    const [pr, tk] = await Promise.all([
      SB.from('programs').select('*').eq('archived',false).order('updated_at',{ascending:false}),
      SB.from('program_tasks').select('*').order('sort_order'),
    ]);
    setPrograms(pr.data||[]); setTasks(tk.data||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const tasksFor = id => tasks.filter(t=>t.program_id===id);
  const shown = programs.filter(p=>!filterOwner || p.owner===filterOwner);

  const advance = async (p, toStage) => {
    await SB.from('programs').update({ stage:toStage }).eq('id',p.id);
    // seed template tasks for the new stage if none exist yet
    const existing = tasks.filter(t=>t.program_id===p.id && t.stage===toStage);
    if (existing.length===0 && STAGE_TASKS[toStage]) {
      const rows = STAGE_TASKS[toStage].map((task,i)=>({
        program_id:p.id, stage:toStage, task, owner:STAGE_OWNER[toStage]||null, assigned_by:me, blocker:'none', sort_order:i,
      }));
      await SB.from('program_tasks').insert(rows);
    }
    load();
  };

  if (loading) return <div style={{padding:'60px',textAlign:'center',color:'#8A8A8E',fontSize:'14px'}}>Loading programs…</div>;

  const open = openId ? programs.find(p=>p.id===openId) : null;

  return (
    <div style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {/* header */}
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'14px',marginBottom:'20px',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'24px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.02em'}}>Programs</div>
          <div style={{fontSize:'13.5px',color:'#8A8A8E',marginTop:'3px'}}>Every product&apos;s life — from won quote to delivered goods</div>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <select value={filterOwner} onChange={e=>setFilterOwner(e.target.value)} style={{...inp,width:'auto',padding:'9px 13px'}}>
            <option value="">All owners</option>
            {TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}
          </select>
          <button onClick={()=>setShowNew(true)} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ New Program</button>
        </div>
      </div>

      {/* view toggle */}
      <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',marginBottom:'20px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)'}}>
        {[['board','Board'],['list','List']].map(([v,l])=>(
          <button key={v} onClick={()=>setView(v)} style={{padding:'9px 18px',borderRadius:'9px',border:'none',cursor:'pointer',fontSize:'13.5px',fontWeight:600,background:view===v?'#1A1A1C':'transparent',color:view===v?'#fff':'#5A5A5E',boxShadow:view===v?'0 1px 3px rgba(0,0,0,.18)':'none'}}>{l}</button>
        ))}
      </div>

      {shown.length===0 ? (
        <div style={{...card,padding:'56px 32px',textAlign:'center'}}>
          <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/></svg>
          </div>
          <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'7px'}}>No active programs</div>
          <div style={{color:'#8A8A8E',fontSize:'13.5px',maxWidth:'440px',margin:'0 auto',lineHeight:1.6}}>Mark a quote as won to start its program automatically, or create one manually for an inquiry.</div>
        </div>
      ) : view==='board' ? (
        <BoardView programs={shown} tasksFor={tasksFor} onOpen={setOpenId} />
      ) : (
        <ListView programs={shown} tasksFor={tasksFor} onOpen={setOpenId} />
      )}

      {open && <ProgramDetail program={open} tasks={tasksFor(open.id)} me={me} onClose={()=>setOpenId(null)} onAdvance={advance} onReload={load} />}
      {showNew && <NewProgramModal me={me} onClose={()=>setShowNew(false)} onCreated={()=>{setShowNew(false);load();}} />}
    </div>
  );
}

// ── BOARD ────────────────────────────────────────────────────────────────
function BoardView({ programs, tasksFor, onOpen }) {
  const active = STAGES.filter(s=>s.key!=='delivered' || programs.some(p=>p.stage==='delivered'));
  return (
    <div style={{display:'flex',gap:'12px',overflowX:'auto',paddingBottom:'12px'}}>
      {active.map(st=>{
        const col = programs.filter(p=>p.stage===st.key);
        return (
          <div key={st.key} style={{flex:'0 0 260px',minWidth:'260px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'8px',padding:'0 4px 10px'}}>
              <span style={{width:'8px',height:'8px',borderRadius:'50%',background:st.color}} />
              <span style={{fontSize:'13px',fontWeight:700,color:'#1A1A1C'}}>{st.label}</span>
              <span style={{fontSize:'11.5px',color:'#A0A0A4',fontVariantNumeric:'tabular-nums'}}>{col.length}</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
              {col.map(p=>{ const tk=tasksFor(p.id); const h=healthOf(p,tk); const open=tk.filter(t=>!t.done);
                const blk = open.find(t=>t.blocker!=='none');
                return (
                  <button key={p.id} onClick={()=>onOpen(p.id)} style={{...card,textAlign:'left',padding:'13px 14px',cursor:'pointer',border:'1px solid #ECECEE',display:'block',width:'100%'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'8px'}}>
                      <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',lineHeight:1.3,minWidth:0,overflow:'hidden',textOverflow:'ellipsis'}}>{p.product||p.sku||'Untitled'}</div>
                      <span style={{width:'8px',height:'8px',borderRadius:'50%',background:HEALTH[h].color,flexShrink:0,marginTop:'4px'}} title={HEALTH[h].label} />
                    </div>
                    <div style={{fontSize:'11.5px',color:'#8A8A8E',marginTop:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.client||'—'}</div>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:'10px'}}>
                      <span style={{fontSize:'10.5px',color:'#A0A0A4'}}>{daysSince(p.stage_entered_at)}d in stage</span>
                      <div style={{display:'flex',alignItems:'center',gap:'6px'}}>
                        {open.length>0 && <span style={{fontSize:'10.5px',color:'#8A8A8E',background:'#F2F2F4',borderRadius:'5px',padding:'1px 6px'}}>{open.length}</span>}
                        {blk && <span style={{width:'7px',height:'7px',borderRadius:'50%',background:BLOCKERS[blk.blocker].dot}} title={BLOCKERS[blk.blocker].label} />}
                      </div>
                    </div>
                    {p.sample_due_back && ['sampling','revision'].includes(p.stage) && (
                      <div style={{fontSize:'10.5px',marginTop:'7px',color:daysSince(p.sample_due_back)>0?'#B91C1C':'#8A8A8E'}}>Sample due {fmtDate(p.sample_due_back)}{daysSince(p.sample_due_back)>0?' · overdue':''}</div>
                    )}
                  </button>
                );
              })}
              {col.length===0 && <div style={{fontSize:'12px',color:'#C0C0C4',textAlign:'center',padding:'16px 0'}}>—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── LIST ─────────────────────────────────────────────────────────────────
function ListView({ programs, tasksFor, onOpen }) {
  const sorted = programs.slice().sort((a,b)=>{ const ra={stalled:0,at_risk:1,on_track:2}; return ra[healthOf(a,tasksFor(a.id))]-ra[healthOf(b,tasksFor(b.id))]; });
  return (
    <div style={{...card,overflow:'hidden'}}>
      <div style={{overflowX:'auto'}}><div style={{minWidth:'820px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 150px 130px 110px 90px 110px',gap:'12px',padding:'12px 20px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
          {['Product / Client','Stage','Owner','Days in stage','Open','Health'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i>=3&&i<5?'right':'left'}}>{h}</div>)}
        </div>
        {sorted.map((p,i)=>{ const tk=tasksFor(p.id); const h=healthOf(p,tk); const st=STAGE_MAP[p.stage]||STAGES[0];
          return (
            <div key={p.id} onClick={()=>onOpen(p.id)} style={{display:'grid',gridTemplateColumns:'1fr 150px 130px 110px 90px 110px',gap:'12px',padding:'14px 20px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{minWidth:0}}>
                <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.product||p.sku||'Untitled'}</div>
                <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.client||'—'}</div>
              </div>
              <div><span style={{display:'inline-flex',alignItems:'center',gap:'6px',fontSize:'12px',fontWeight:600,color:st.color}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:st.color}} />{st.label}</span></div>
              <div style={{fontSize:'12.5px',color:'#4A4A4E'}}>{nameFor(p.owner)}</div>
              <div style={{textAlign:'right',fontSize:'13px',color:daysSince(p.stage_entered_at)>14?'#B91C1C':'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{daysSince(p.stage_entered_at)}d</div>
              <div style={{textAlign:'right',fontSize:'13px',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{tk.filter(t=>!t.done).length}</div>
              <div><span style={{display:'inline-flex',fontSize:'11px',fontWeight:600,borderRadius:'6px',padding:'3px 9px',color:'#fff',background:HEALTH[h].color}}>{HEALTH[h].label}</span></div>
            </div>
          );
        })}
      </div></div>
    </div>
  );
}

// ── DETAIL ───────────────────────────────────────────────────────────────
function ProgramDetail({ program, tasks, me, onClose, onAdvance, onReload }) {
  const [p, setP] = useState(program);
  const [taskText, setTaskText] = useState('');
  const [taskWho, setTaskWho] = useState(STAGE_OWNER[program.stage]||me);
  const [taskDue, setTaskDue] = useState('');
  const st = STAGE_MAP[p.stage]||STAGES[0];
  const idx = STAGE_ORDER.indexOf(p.stage);
  const nextStage = idx>=0 && idx<STAGE_ORDER.length-1 ? STAGE_ORDER[idx+1] : null;

  const saveField = async (patch) => {
    setP(prev=>({...prev,...patch}));
    await SB.from('programs').update(patch).eq('id',p.id);
    onReload();
  };
  const addTask = async () => {
    if (!taskText.trim()) return;
    await SB.from('program_tasks').insert({ program_id:p.id, stage:p.stage, task:taskText.trim(), owner:taskWho, assigned_by:me, due_date:taskDue||null, blocker:'none', sort_order:tasks.length });
    setTaskText(''); setTaskDue(''); onReload();
  };
  const toggleTask = async (t) => { await SB.from('program_tasks').update({ done:!t.done, done_at:!t.done?new Date().toISOString():null }).eq('id',t.id); onReload(); };
  const setBlocker = async (t, b) => { await SB.from('program_tasks').update({ blocker:b }).eq('id',t.id); onReload(); };
  const delTask = async (id) => { await SB.from('program_tasks').delete().eq('id',id); onReload(); };
  const archive = async () => { if(window.confirm('Archive this program? It leaves the board but is kept.')){ await SB.from('programs').update({archived:true}).eq('id',p.id); onClose(); onReload(); } };

  const stageTasks = tasks.filter(t=>t.stage===p.stage);
  const otherTasks = tasks.filter(t=>t.stage!==p.stage);
  const inSampling = ['sampling','revision'].includes(p.stage);

  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',zIndex:1000,overflowY:'auto'}}>
      <div style={{...card,width:'100%',maxWidth:'680px',padding:0,overflow:'hidden'}} onClick={e=>e.stopPropagation()}>
        {/* head */}
        <div style={{padding:'20px 24px',borderBottom:'1px solid #ECECEE'}}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.01em'}}>{p.product||p.sku||'Untitled program'}</div>
              <div style={{fontSize:'13px',color:'#8A8A8E',marginTop:'3px'}}>{[p.client,p.factory,p.sku].filter(Boolean).join(' · ')||'—'}</div>
            </div>
            <button onClick={onClose} style={{background:'none',border:'none',fontSize:'22px',color:'#A0A0A4',cursor:'pointer',lineHeight:1}}>×</button>
          </div>
          {/* stage stepper */}
          <div style={{display:'flex',gap:'4px',marginTop:'16px',flexWrap:'wrap'}}>
            {STAGES.map(s=>{ const active=s.key===p.stage; const passed=STAGE_ORDER.indexOf(s.key)<idx;
              return (
                <button key={s.key} onClick={()=>saveField({stage:s.key})} title={'Move to '+s.label} style={{fontSize:'11px',fontWeight:600,padding:'4px 9px',borderRadius:'7px',border:'none',cursor:'pointer',background:active?s.color:passed?'#EAEAEE':'#F7F7F9',color:active?'#fff':passed?'#4A4A4E':'#A0A0A4'}}>{s.label}</button>
              );
            })}
          </div>
          {nextStage && (
            <button onClick={()=>{ onAdvance(p,nextStage); setP(prev=>({...prev,stage:nextStage})); }} style={{marginTop:'12px',background:'#0071E3',color:'#fff',border:'none',borderRadius:'9px',padding:'8px 15px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Advance to {STAGE_MAP[nextStage].label} →</button>
          )}
        </div>

        <div style={{padding:'20px 24px',maxHeight:'56vh',overflowY:'auto'}}>
          {/* owner */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',marginBottom:'18px'}}>
            <div><label style={lbl}>Program owner</label>
              <select style={inp} value={p.owner||''} onChange={e=>saveField({owner:e.target.value})}>
                <option value="">— unassigned —</option>
                {TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Days in {st.label}</label>
              <div style={{...inp,background:'#F7F7F9',color:daysSince(p.stage_entered_at)>14?'#B91C1C':'#1A1A1C'}}>{daysSince(p.stage_entered_at)} days</div>
            </div>
          </div>

          {/* sampling detail block */}
          {inSampling && (
            <div style={{background:'#FAF5FF',border:'1px solid #E9D8FD',borderRadius:'12px',padding:'16px',marginBottom:'18px'}}>
              <div style={{fontSize:'12px',fontWeight:700,color:'#6B21A8',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'12px'}}>Sampling detail</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
                <div><label style={lbl}>Sample round</label>
                  <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
                    <button onClick={()=>saveField({sample_round:Math.max(1,(Number(p.sample_round)||1)-1)})} style={{...inp,width:'34px',padding:'8px 0',textAlign:'center',cursor:'pointer'}}>−</button>
                    <div style={{fontSize:'16px',fontWeight:700,color:'#1A1A1C',minWidth:'24px',textAlign:'center'}}>{p.sample_round||1}</div>
                    <button onClick={()=>saveField({sample_round:(Number(p.sample_round)||1)+1})} style={{...inp,width:'34px',padding:'8px 0',textAlign:'center',cursor:'pointer'}}>+</button>
                  </div>
                </div>
                <div><label style={lbl}>Master sample included?</label>
                  <div style={{display:'flex',gap:'6px'}}>
                    {[['yes',true],['no',false]].map(([l,v])=>(
                      <button key={l} onClick={()=>saveField({master_sample_included:v})} style={{flex:1,...inp,padding:'8px 0',textAlign:'center',cursor:'pointer',background:p.master_sample_included===v?(v?'#DCFCE7':'#FEE2E2'):'#fff',color:p.master_sample_included===v?(v?'#15803D':'#B91C1C'):'#8A8A8E',borderColor:p.master_sample_included===v?(v?'#86EFAC':'#FCA5A5'):'#E5E7EB',fontWeight:600,textTransform:'capitalize'}}>{l}</button>
                    ))}
                  </div>
                </div>
                <div><label style={lbl}>Sample sent</label><input type="date" style={inp} value={p.sample_sent_date||''} onChange={e=>saveField({sample_sent_date:e.target.value||null})} /></div>
                <div><label style={lbl}>Due back</label><input type="date" style={{...inp,borderColor:p.sample_due_back&&daysSince(p.sample_due_back)>0?'#FCA5A5':'#E5E7EB'}} value={p.sample_due_back||''} onChange={e=>saveField({sample_due_back:e.target.value||null})} /></div>
              </div>
              {p.sample_due_back && daysSince(p.sample_due_back)>0 && <div style={{fontSize:'12px',color:'#B91C1C',marginTop:'10px',fontWeight:500}}>Sample is {daysSince(p.sample_due_back)} days overdue.</div>}
            </div>
          )}

          {/* current-stage tasks */}
          <div style={{fontSize:'12px',fontWeight:700,color:'#1A1A1C',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'10px'}}>{st.label} tasks</div>
          {stageTasks.length===0 && <div style={{fontSize:'13px',color:'#A0A0A4',marginBottom:'12px'}}>No tasks in this stage yet.</div>}
          {stageTasks.map(t=><TaskRow key={t.id} t={t} onToggle={toggleTask} onBlocker={setBlocker} onDel={delTask} />)}

          {/* add task */}
          <div style={{display:'flex',gap:'6px',marginTop:'10px',flexWrap:'wrap'}}>
            <select style={{...inp,flex:'0 0 110px'}} value={taskWho} onChange={e=>setTaskWho(e.target.value)}>{TEAM.map(m=><option key={m.email} value={m.email}>{m.name}</option>)}</select>
            <input style={{...inp,flex:'1 1 140px'}} value={taskText} onChange={e=>setTaskText(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTask()} placeholder="Add a task…" />
            <input type="date" style={{...inp,flex:'0 0 130px'}} value={taskDue} onChange={e=>setTaskDue(e.target.value)} />
            <button onClick={addTask} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'9px',padding:'9px 15px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Add</button>
          </div>

          {/* other-stage tasks (collapsed reference) */}
          {otherTasks.length>0 && (
            <div style={{marginTop:'20px'}}>
              <div style={{fontSize:'11px',fontWeight:600,color:'#A0A0A4',textTransform:'uppercase',letterSpacing:'.05em',marginBottom:'8px'}}>Other stages ({otherTasks.filter(t=>!t.done).length} open)</div>
              {otherTasks.map(t=><TaskRow key={t.id} t={t} dim onToggle={toggleTask} onBlocker={setBlocker} onDel={delTask} />)}
            </div>
          )}
        </div>

        <div style={{padding:'14px 24px',borderTop:'1px solid #ECECEE',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <button onClick={archive} style={{background:'none',border:'none',color:'#B91C1C',fontSize:'13px',fontWeight:500,cursor:'pointer'}}>Archive program</button>
          <button onClick={onClose} style={{background:'#F2F2F4',border:'none',borderRadius:'9px',padding:'9px 18px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>Done</button>
        </div>
      </div>
    </div>
  );
}

function TaskRow({ t, dim, onToggle, onBlocker, onDel }) {
  const overdue = t.due_date && !t.done && daysSince(t.due_date)>0;
  const b = BLOCKERS[t.blocker]||BLOCKERS.none;
  return (
    <div style={{display:'flex',alignItems:'center',gap:'10px',padding:'9px 0',borderBottom:'1px solid #F4F4F6',opacity:dim&&t.done?0.5:1}}>
      <button onClick={()=>onToggle(t)} style={{background:'none',border:'none',cursor:'pointer',padding:0,flexShrink:0,display:'flex'}}>
        {t.done
          ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34C759" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg>
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C4C4C8" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/></svg>}
      </button>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:'13.5px',color:t.done?'#A0A0A4':'#1A1A1C',textDecoration:t.done?'line-through':'none',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{t.task}</div>
        <div style={{fontSize:'11px',color:'#A0A0A4',marginTop:'1px'}}>{nameFor(t.owner)}{t.due_date?' · due '+fmtDate(t.due_date):''}{overdue?' · overdue':''}</div>
      </div>
      {!t.done && (
        <select value={t.blocker||'none'} onChange={e=>onBlocker(t,e.target.value)} style={{fontSize:'11px',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 6px',color:b.text,fontWeight:600,cursor:'pointer',background:'#fff',flexShrink:0}}>
          <option value="none">— no blocker —</option>
          <option value="factory">Waiting: factory</option>
          <option value="client">Waiting: client</option>
          <option value="us">Waiting: us</option>
        </select>
      )}
      <button onClick={()=>onDel(t.id)} style={{background:'none',border:'none',color:'#C4C4C8',cursor:'pointer',fontSize:'16px',flexShrink:0}}>×</button>
    </div>
  );
}

// ── NEW PROGRAM (manual) ───────────────────────────────────────────────────
function NewProgramModal({ me, onClose, onCreated }) {
  const [f, setF] = useState({ product:'', sku:'', client:'', factory:'', stage:'inquiry', owner:me });
  const [saving, setSaving] = useState(false);
  const set = k => e => setF(p=>({...p,[k]:e.target.value}));
  const save = async () => {
    if (!f.product.trim() && !f.sku.trim()) { alert('Enter a product name or SKU.'); return; }
    setSaving(true);
    const { data, error } = await SB.from('programs').insert({ ...f, owner:f.owner||null }).select('id').single();
    if (error) { setSaving(false); alert('Error: '+error.message); return; }
    // seed template tasks if the starting stage has them
    if (STAGE_TASKS[f.stage]) {
      await SB.from('program_tasks').insert(STAGE_TASKS[f.stage].map((task,i)=>({ program_id:data.id, stage:f.stage, task, owner:STAGE_OWNER[f.stage]||null, assigned_by:me, blocker:'none', sort_order:i })));
    }
    setSaving(false); onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:'16px',zIndex:1000}}>
      <div style={{...card,width:'100%',maxWidth:'460px',padding:0}} onClick={e=>e.stopPropagation()}>
        <div style={{padding:'18px 22px',borderBottom:'1px solid #ECECEE',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{fontSize:'16px',fontWeight:700,color:'#1A1A1C'}}>New Program</div>
          <button onClick={onClose} style={{background:'none',border:'none',fontSize:'22px',color:'#A0A0A4',cursor:'pointer'}}>×</button>
        </div>
        <div style={{padding:'20px 22px'}}>
          <div style={{marginBottom:'12px'}}><label style={lbl}>Product name</label><input style={inp} value={f.product} onChange={set('product')} placeholder="e.g. Insulated tumbler 20oz" /></div>
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
        <div style={{padding:'14px 22px',borderTop:'1px solid #ECECEE',display:'flex',justifyContent:'flex-end',gap:'8px'}}>
          <button onClick={onClose} style={{background:'#F2F2F4',border:'none',borderRadius:'9px',padding:'9px 16px',fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',cursor:'pointer'}}>Cancel</button>
          <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'9px',padding:'9px 18px',fontSize:'13.5px',fontWeight:600,cursor:'pointer'}}>{saving?'Creating…':'Create program'}</button>
        </div>
      </div>
    </div>
  );
}
