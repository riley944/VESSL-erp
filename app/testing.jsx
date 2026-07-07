'use client';
import React, { useState, useEffect } from "react";
import { SB } from "@/lib/supabase";

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const MAT_STATUS = {
  untested:   { label:'Untested',    color:'#8A8A8E', bg:'#F2F2F4' },
  in_progress:{ label:'In Progress', color:'#B45309', bg:'#FEF3C7' },
  passed:     { label:'Passed',      color:'#15803D', bg:'#DCFCE7' },
  failed:     { label:'Failed',      color:'#B91C1C', bg:'#FEE2E2' },
  expired:    { label:'Expired',     color:'#B91C1C', bg:'#FEE2E2' },
};
const PROD_STATUS = {
  compliant:   { label:'Compliant',   color:'#15803D', bg:'#DCFCE7', dot:'#22C55E' },
  pending:     { label:'Pending',     color:'#B45309', bg:'#FEF3C7', dot:'#F59E0B' },
  failed:      { label:'Failed',      color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
  expired:     { label:'Expired',     color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
  no_materials:{ label:'No materials',color:'#8A8A8E', bg:'#F2F2F4', dot:'#CBD5E1' },
};
const MAT_TYPES = ['fabric','dye','ink','zipper','plastic','trim','hardware','packaging','other'];

function StatusPill({ map, status }) {
  const s = map[status] || { label:status||'—', color:'#8A8A8E', bg:'#F2F2F4' };
  return <span style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11.5px',fontWeight:600,color:s.color,background:s.bg,borderRadius:'7px',padding:'3px 9px',whiteSpace:'nowrap'}}>{s.dot&&<span style={{width:'6px',height:'6px',borderRadius:'50%',background:s.dot}}/>}{s.label}</span>;
}

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 0 0 1px rgba(0,0,0,.02),0 2px 5px rgba(0,0,0,.04),0 12px 28px -8px rgba(20,20,40,.05)'};

// ═══════════════════════════════════════════════════════════════════════════
export default function Testing() {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [reports, setReports] = useState([]);
  const [regs, setRegs] = useState([]);
  const [labs, setLabs] = useState([]);
  const [prodMats, setProdMats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {type:'material'|'report'|'link', data}

  const load = async () => {
    setLoading(true);
    const [p, m, r, rg, lb, pm] = await Promise.all([
      SB.from('products').select('id,sku,name').order('sku',{nullsFirst:false}),
      SB.from('materials').select('*,supplier:companies!supplier_id(name)').order('created_at',{ascending:false}),
      SB.from('test_reports').select('*,lab:labs(name),material:materials(name),product:products(name,sku),test_results(*)').order('test_date',{ascending:false}),
      SB.from('regulations').select('*').eq('active',true).order('sort_order'),
      SB.from('labs').select('*').order('name'),
      SB.from('product_materials').select('*,material:materials(id,name,status)'),
    ]);
    setProducts(p.data||[]); setMaterials(m.data||[]); setReports(r.data||[]);
    setRegs(rg.data||[]); setLabs(lb.data||[]); setProdMats(pm.data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  // derived product status from linked materials
  const productStatus = (prodId) => {
    const links = prodMats.filter(l=>l.product_id===prodId && l.is_required);
    if(!links.length) return 'no_materials';
    const st = links.map(l=>l.material?.status);
    if(st.includes('failed')) return 'failed';
    if(st.includes('expired')) return 'expired';
    if(st.some(s=>s==='untested'||s==='in_progress')) return 'pending';
    if(st.every(s=>s==='passed')) return 'compliant';
    return 'pending';
  };

  const counts = {
    compliant: products.filter(p=>productStatus(p.id)==='compliant').length,
    pending:   products.filter(p=>['pending'].includes(productStatus(p.id))).length,
    issues:    products.filter(p=>['failed','expired'].includes(productStatus(p.id))).length,
    materials: materials.length,
  };

  return (
    <div className="db-wrap" style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {/* Title */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'22px',gap:'14px',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'24px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.02em'}}>Testing &amp; Compliance</div>
          <div style={{fontSize:'13.5px',color:'#8A8A8E',marginTop:'3px'}}>Material testing, CPSC readiness &amp; product certification</div>
        </div>
        <div style={{display:'flex',gap:'8px'}}>
          <button onClick={()=>setModal({type:'material'})} style={{background:'#fff',color:'#1A1A1C',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Material</button>
          <button onClick={()=>setModal({type:'report'})} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Log Test Report</button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="db-kpi-grid" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:'14px',marginBottom:'20px'}}>
        {[
          {k:'Compliant products', v:counts.compliant, tint:'#22C55E', bg:'#DCFCE7'},
          {k:'Pending testing',    v:counts.pending,   tint:'#F59E0B', bg:'#FEF3C7'},
          {k:'Issues / expired',   v:counts.issues,    tint:'#EF4444', bg:'#FEE2E2'},
          {k:'Materials tracked',  v:counts.materials, tint:'#6366F1', bg:'#EEF'},
        ].map(m=>(
          <div key={m.k} style={{...card,padding:'18px 20px'}}>
            <div style={{display:'flex',alignItems:'center',gap:'9px',marginBottom:'13px'}}>
              <div style={{width:'9px',height:'9px',borderRadius:'50%',background:m.tint}}/>
              <div style={{fontSize:'12.5px',fontWeight:500,color:'#8A8A8E'}}>{m.k}</div>
            </div>
            <div style={{fontSize:'30px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.02em',lineHeight:1,fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:'flex',gap:'6px',marginBottom:'18px',flexWrap:'wrap'}}>
        {[['products','Products'],['materials','Materials'],['reports','Test Reports'],['regs','Regulations']].map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)} style={{padding:'8px 15px',borderRadius:'9px',border:'1px solid '+(tab===v?'transparent':'#E5E7EB'),cursor:'pointer',fontSize:'13px',fontWeight:500,background:tab===v?'#1A1A1C':'#fff',color:tab===v?'#fff':'#4A4A4E'}}>{l}</button>
        ))}
      </div>

      {loading ? <div style={{padding:'60px',textAlign:'center',color:'#8A8A8E'}}>Loading…</div> : (
        <>
          {tab==='products'  && <ProductsView products={products} prodMats={prodMats} productStatus={productStatus} onLink={(p)=>setModal({type:'link',data:p})} />}
          {tab==='materials' && <MaterialsView materials={materials} onEdit={(m)=>setModal({type:'material',data:m})} onTest={(m)=>setModal({type:'report',data:{material_id:m.id}})} />}
          {tab==='reports'   && <ReportsView reports={reports} />}
          {tab==='regs'      && <RegsView regs={regs} />}
        </>
      )}

      {modal?.type==='material' && <MaterialModal data={modal.data} labs={labs} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='report'   && <ReportModal preset={modal.data} materials={materials} products={products} labs={labs} regs={regs} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='link'     && <LinkModal product={modal.data} materials={materials} existing={prodMats.filter(l=>l.product_id===modal.data.id)} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
    </div>
  );
}

// ── PRODUCTS VIEW ────────────────────────────────────────────────────────────
function ProductsView({ products, prodMats, productStatus, onLink }) {
  if(!products.length) return <Empty title="No products yet" sub="Products created in the Products tab appear here for compliance tracking." />;
  return (
    <div style={{...card,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 140px 120px 90px',gap:'16px',padding:'12px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
        {['Product','Materials','Status',''].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i>=1&&i<3?'left':i===3?'right':'left'}}>{h}</div>)}
      </div>
      {products.map((p,i)=>{
        const links=prodMats.filter(l=>l.product_id===p.id);
        const st=productStatus(p.id);
        return (
          <div key={p.id} style={{display:'grid',gridTemplateColumns:'1fr 140px 120px 90px',gap:'16px',padding:'14px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.sku||'—'}</div>
              <div style={{fontSize:'12px',color:'#8A8A8E',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name}</div>
            </div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E'}}>{links.length? links.length+' linked':<span style={{color:'#C0C0C4'}}>none</span>}</div>
            <div><StatusPill map={PROD_STATUS} status={st} /></div>
            <div style={{textAlign:'right'}}><button onClick={()=>onLink(p)} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'8px',padding:'5px 11px',fontSize:'12px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>Materials</button></div>
          </div>
        );
      })}
    </div>
  );
}

// ── MATERIALS VIEW ───────────────────────────────────────────────────────────
function MaterialsView({ materials, onEdit, onTest }) {
  if(!materials.length) return <Empty title="No materials yet" sub="Add a material (fabric, dye, zipper…) — it's the unit that gets tested and that SKUs inherit compliance from." />;
  return (
    <div style={{...card,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 130px 120px 120px 150px',gap:'16px',padding:'12px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
        {['Material','Type','Supplier','Status','Last tested'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4'}}>{h}</div>)}
      </div>
      {materials.map((m,i)=>(
        <div key={m.id} onClick={()=>onEdit(m)} style={{display:'grid',gridTemplateColumns:'1fr 130px 120px 120px 150px',gap:'16px',padding:'14px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center',cursor:'pointer'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
          <div style={{minWidth:0}}>
            <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
            {m.composition&&<div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.composition}</div>}
          </div>
          <div style={{fontSize:'12.5px',color:'#4A4A4E',textTransform:'capitalize'}}>{m.material_type||'—'}</div>
          <div style={{fontSize:'12.5px',color:'#4A4A4E',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.supplier?.name||m.supplier_name||'—'}</div>
          <div><StatusPill map={MAT_STATUS} status={m.status} /></div>
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <span style={{fontSize:'12.5px',color:'#8A8A8E'}}>{m.last_tested?fmtDate(m.last_tested):'—'}</span>
            <button onClick={e=>{e.stopPropagation();onTest(m);}} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 9px',fontSize:'11px',fontWeight:500,color:'#4A4A4E',cursor:'pointer',marginLeft:'auto'}}>+ Test</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── REPORTS VIEW ─────────────────────────────────────────────────────────────
function ReportsView({ reports }) {
  if(!reports.length) return <Empty title="No test reports yet" sub="Log a lab report to record pass/fail results against CPSC regulations." />;
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      {reports.map(r=>(
        <div key={r.id} style={{...card,padding:'18px 20px'}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'14px',marginBottom:'12px'}}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'14px',fontWeight:600,color:'#1A1A1C'}}>{r.material?.name||r.product?.sku||r.product?.name||'Report'}</div>
              <div style={{fontSize:'12px',color:'#8A8A8E',marginTop:'3px'}}>{r.lab?.name||'—'} · Report {r.report_number||'—'} · Tested {fmtDate(r.test_date)}</div>
            </div>
            <StatusPill map={{pass:{label:'Pass',color:'#15803D',bg:'#DCFCE7'},fail:{label:'Fail',color:'#B91C1C',bg:'#FEE2E2'},pending:{label:'Pending',color:'#B45309',bg:'#FEF3C7'}}} status={r.overall_result} />
          </div>
          {r.test_results?.length>0 && (
            <div style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:'6px 14px',fontSize:'12px',paddingTop:'12px',borderTop:'1px solid #F2F2F4'}}>
              <div style={{fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4'}}>Regulation</div>
              <div style={{fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Measured</div>
              <div style={{fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Limit</div>
              <div style={{fontSize:'10px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Result</div>
              {r.test_results.map(tr=>(
                <React.Fragment key={tr.id}>
                  <div style={{color:'#1A1A1C',fontWeight:500}}>{tr.regulation_code||'—'}</div>
                  <div style={{textAlign:'right',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{tr.measured_value||'—'}</div>
                  <div style={{textAlign:'right',color:'#8A8A8E',fontVariantNumeric:'tabular-nums'}}>{tr.limit_value||'—'}</div>
                  <div style={{textAlign:'right',fontWeight:600,color:tr.result==='pass'?'#15803D':tr.result==='fail'?'#B91C1C':'#8A8A8E'}}>{(tr.result||'—').toUpperCase()}</div>
                </React.Fragment>
              ))}
            </div>
          )}
          {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noreferrer" style={{display:'inline-block',marginTop:'12px',fontSize:'12.5px',color:'#0071E3',fontWeight:500}}>View report PDF →</a>}
        </div>
      ))}
    </div>
  );
}

// ── REGULATIONS VIEW ─────────────────────────────────────────────────────────
function RegsView({ regs }) {
  if(!regs.length) return <Empty title="No regulations loaded" sub="Run the compliance schema seed to load the CPSC rule library." />;
  return (
    <div style={{...card,overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'150px 1fr 130px',gap:'16px',padding:'12px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
        {['Citation','Rule','Category'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4'}}>{h}</div>)}
      </div>
      {regs.map((r,i)=>(
        <div key={r.id} style={{display:'grid',gridTemplateColumns:'150px 1fr 130px',gap:'16px',padding:'13px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center'}}>
          <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:600,color:'#1A1A1C'}}>{r.code}</div>
          <div style={{fontSize:'13px',color:'#3A3A3E'}}>{r.name}</div>
          <div style={{fontSize:'12px',color:'#8A8A8E',textTransform:'capitalize'}}>{r.category||'—'}</div>
        </div>
      ))}
    </div>
  );
}

// ── MODALS ───────────────────────────────────────────────────────────────────
const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(20,20,30,.4)',backdropFilter:'blur(2px)',zIndex:200,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{...card,width:'100%',maxWidth:'560px',padding:'24px'}}>{children}</div>
  </div>
);
const inp = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit'};
const lbl = {display:'block',fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'6px'};

function MaterialModal({ data, labs, onClose, onSaved }) {
  const [f,setF]=useState({ name:data?.name||'', material_type:data?.material_type||'fabric', supplier_name:data?.supplier_name||'', composition:data?.composition||'', color:data?.color||'', notes:data?.notes||'' });
  const [saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{
    if(!f.name.trim()) return;
    setSaving(true);
    const payload={ name:f.name.trim(), material_type:f.material_type, supplier_name:f.supplier_name||null, composition:f.composition||null, color:f.color||null, notes:f.notes||null };
    if(data?.id) await SB.from('materials').update(payload).eq('id',data.id);
    else await SB.from('materials').insert(payload);
    setSaving(false); onSaved();
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'18px'}}>{data?.id?'Edit material':'New material'}</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div><label style={lbl}>Material name</label><input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. 100% Cotton Jersey 180gsm" /></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Type</label><select style={inp} value={f.material_type} onChange={set('material_type')}>{MAT_TYPES.map(t=><option key={t} value={t}>{t}</option>)}</select></div>
          <div><label style={lbl}>Color</label><input style={inp} value={f.color} onChange={set('color')} placeholder="optional" /></div>
        </div>
        <div><label style={lbl}>Supplier</label><input style={inp} value={f.supplier_name} onChange={set('supplier_name')} placeholder="Factory / supplier name" /></div>
        <div><label style={lbl}>Composition</label><input style={inp} value={f.composition} onChange={set('composition')} placeholder="e.g. 100% combed cotton" /></div>
        <div><label style={lbl}>Notes</label><textarea style={{...inp,minHeight:'60px',resize:'vertical'}} value={f.notes} onChange={set('notes')} /></div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save material'}</button>
      </div>
    </Overlay>
  );
}

function ReportModal({ preset, materials, products, labs, regs, onClose, onSaved }) {
  const [f,setF]=useState({ material_id:preset?.material_id||'', product_id:'', lab_id:'', report_number:'', test_date:'', expiry_date:'', manufacture_place:'', sample_description:'', pdf_url:'', overall_result:'pass' });
  const [lines,setLines]=useState([{ regulation_id:'', measured_value:'', limit_value:'', result:'pass' }]);
  const [saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const setLine=(i,k)=>e=>setLines(p=>p.map((l,j)=>j===i?{...l,[k]:e.target.value}:l));
  const addLine=()=>setLines(p=>[...p,{ regulation_id:'', measured_value:'', limit_value:'', result:'pass' }]);
  const rmLine=i=>setLines(p=>p.filter((_,j)=>j!==i));

  const save=async()=>{
    if(!f.material_id && !f.product_id){ alert('Pick a material or product'); return; }
    setSaving(true);
    const anyFail=lines.some(l=>l.result==='fail');
    const overall=anyFail?'fail':'pass';
    const { data:rep, error } = await SB.from('test_reports').insert({
      material_id:f.material_id||null, product_id:f.product_id||null, lab_id:f.lab_id||null,
      report_number:f.report_number||null, test_date:f.test_date||null, expiry_date:f.expiry_date||null,
      manufacture_place:f.manufacture_place||null, sample_description:f.sample_description||null,
      pdf_url:f.pdf_url||null, overall_result:overall,
    }).select().single();
    if(error){ setSaving(false); alert('Error: '+error.message); return; }
    const rows=lines.filter(l=>l.regulation_id).map(l=>{
      const reg=regs.find(r=>r.id===l.regulation_id);
      return { report_id:rep.id, regulation_id:l.regulation_id, regulation_code:reg?.code||null, measured_value:l.measured_value||null, limit_value:l.limit_value||null, result:l.result };
    });
    if(rows.length) await SB.from('test_results').insert(rows);
    setSaving(false); onSaved();
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>Log test report</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>Enter the lab result. A material passing here cascades to every SKU built from it.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Material</label><select style={inp} value={f.material_id} onChange={set('material_id')}><option value="">— select —</option>{materials.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          <div><label style={lbl}>or Product (direct)</label><select style={inp} value={f.product_id} onChange={set('product_id')}><option value="">— none —</option>{products.map(p=><option key={p.id} value={p.id}>{p.sku||p.name}</option>)}</select></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Lab</label><select style={inp} value={f.lab_id} onChange={set('lab_id')}><option value="">— select —</option>{labs.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div><label style={lbl}>Report #</label><input style={inp} value={f.report_number} onChange={set('report_number')} /></div>
          <div><label style={lbl}>Test date</label><input type="date" style={inp} value={f.test_date} onChange={set('test_date')} /></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Expiry (re-test due)</label><input type="date" style={inp} value={f.expiry_date} onChange={set('expiry_date')} /></div>
          <div><label style={lbl}>Place of manufacture</label><input style={inp} value={f.manufacture_place} onChange={set('manufacture_place')} placeholder="City, Country" /></div>
        </div>
        <div><label style={lbl}>Report PDF URL</label><input style={inp} value={f.pdf_url} onChange={set('pdf_url')} placeholder="Paste a link to the uploaded report" /></div>

        {/* per-rule results */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'8px'}}>
            <label style={{...lbl,marginBottom:0}}>Results by regulation</label>
            <button onClick={addLine} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'7px',padding:'4px 10px',fontSize:'12px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>+ Add rule</button>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {lines.map((l,i)=>(
              <div key={i} style={{display:'grid',gridTemplateColumns:'1fr 84px 84px 78px 26px',gap:'7px',alignItems:'center'}}>
                <select style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.regulation_id} onChange={setLine(i,'regulation_id')}><option value="">Regulation…</option>{regs.map(r=><option key={r.id} value={r.id}>{r.code}</option>)}</select>
                <input style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.measured_value} onChange={setLine(i,'measured_value')} placeholder="Measured" />
                <input style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.limit_value} onChange={setLine(i,'limit_value')} placeholder="Limit" />
                <select style={{...inp,padding:'8px 9px',fontSize:'12.5px'}} value={l.result} onChange={setLine(i,'result')}><option value="pass">Pass</option><option value="fail">Fail</option><option value="na">N/A</option></select>
                <button onClick={()=>rmLine(i)} style={{background:'none',border:'none',color:'#C0C0C4',cursor:'pointer',fontSize:'18px'}}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save report'}</button>
      </div>
    </Overlay>
  );
}

function LinkModal({ product, materials, existing, onClose, onSaved }) {
  const [sel,setSel]=useState(new Set(existing.map(e=>e.material_id)));
  const [saving,setSaving]=useState(false);
  const toggle=id=>setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  const save=async()=>{
    setSaving(true);
    const have=new Set(existing.map(e=>e.material_id));
    const toAdd=[...sel].filter(id=>!have.has(id));
    const toRemove=existing.filter(e=>!sel.has(e.material_id));
    if(toAdd.length) await SB.from('product_materials').insert(toAdd.map(mid=>({ product_id:product.id, material_id:mid, is_required:true })));
    for(const e of toRemove) await SB.from('product_materials').delete().eq('id',e.id);
    setSaving(false); onSaved();
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'4px'}}>Materials in {product.sku||product.name}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>Link the materials this product is built from. Its compliance status is derived from these.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'6px',maxHeight:'340px',overflowY:'auto'}}>
        {materials.length===0 && <div style={{fontSize:'13px',color:'#8A8A8E'}}>No materials yet — add some first.</div>}
        {materials.map(m=>{ const on=sel.has(m.id); return (
          <button key={m.id} onClick={()=>toggle(m.id)} style={{display:'flex',alignItems:'center',gap:'11px',padding:'11px 13px',borderRadius:'10px',border:'1px solid '+(on?'#1A1A1C':'#E5E7EB'),background:on?'#FAFAFB':'#fff',cursor:'pointer',textAlign:'left'}}>
            <div style={{width:'18px',height:'18px',borderRadius:'5px',border:'1px solid '+(on?'#1A1A1C':'#D1D5DB'),background:on?'#1A1A1C':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<span style={{color:'#fff',fontSize:'12px'}}>✓</span>}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:'13px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
              <div style={{fontSize:'11.5px',color:'#8A8A8E',textTransform:'capitalize'}}>{m.material_type}</div>
            </div>
            <StatusPill map={MAT_STATUS} status={m.status} />
          </button>
        ); })}
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save'}</button>
      </div>
    </Overlay>
  );
}

function Empty({ title, sub }) {
  return (
    <div style={{...card,padding:'56px 32px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </div>
      <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'7px'}}>{title}</div>
      <div style={{color:'#8A8A8E',fontSize:'13.5px',maxWidth:'380px',margin:'0 auto',lineHeight:1.6}}>{sub}</div>
    </div>
  );
}
