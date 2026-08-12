'use client';
import React, { useState, useEffect, useMemo } from "react";
import { SB } from "@/lib/supabase";
import { CreateProductModal } from "@/app/components/CreateProductModal";
// The regulations list and its editor moved to app/components so the Codes page
// shows the same two rather than copies. Delete went into RegModal with them --
// see the comment on the regs tab below.
import { RegulationsList, regSearchFields } from "@/app/components/RegulationsList";
import { RegModal } from "@/app/components/RegModal";
import { LinkRulesModal } from "@/app/components/LinkRulesModal";
import { matches, normalizeTerm } from "@/lib/textFilter";

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const daysUntil = s => { if(!s) return null; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); if(isNaN(d)) return null; return Math.round((d.getTime()-Date.now())/86400000); };
const MAT_STATUS = {
  untested:   { label:'Untested',    color:'#8A8A8E', bg:'#F2F2F4', dot:'#C7C7CC' },
  in_progress:{ label:'In Progress', color:'#B45309', bg:'#FEF3C7', dot:'#F59E0B' },
  passed:     { label:'Passed',      color:'#15803D', bg:'#DCFCE7', dot:'#22C55E' },
  failed:     { label:'Failed',      color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
  expired:    { label:'Expired',     color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
};
// 'passed', 'pending' and 'failed' are the three a human can set. The rest are only
// reachable on a row whose status was written before the derivation was dropped, or
// straight from the database — kept so such a row still renders with a real label.
// 'not_set' is the null case: grey and unlabelled by colour, because no judgement has
// been made about that product yet.
const PROD_STATUS = {
  not_set:     { label:'Not set',     color:'#8A8A8E', bg:'#F2F2F4' },
  compliant:   { label:'Compliant',   color:'#15803D', bg:'#DCFCE7', dot:'#22C55E' },
  passed:      { label:'Pass',        color:'#15803D', bg:'#DCFCE7', dot:'#22C55E' },
  pending:     { label:'Pending',     color:'#B45309', bg:'#FEF3C7', dot:'#F59E0B' },
  failed:      { label:'Failed',      color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
  expired:     { label:'Expired',     color:'#B91C1C', bg:'#FEE2E2', dot:'#EF4444' },
  no_materials:{ label:'No materials',color:'#8A8A8E', bg:'#F2F2F4', dot:'#CBD5E1' },
};
// The stored value and nothing else. Linking a material no longer moves a product to
// 'pending' behind Jenn's back — compliance is her call, and an unset product simply
// reads as unset rather than inheriting a verdict from its materials.
const effectiveStatus = (product) => (product && product.compliance_status) || null;
// Written to products.compliance_status. '' means clear it back to NULL.
const COMPLIANCE_OPTS = [['','— Not set —'],['passed','Pass'],['pending','Pending'],['failed','Failed']];
// Unused on purpose. MaterialModal's Type field was opened up to free text so we can
// see what people actually reach for; this is the list to put back as a <select> once
// there is enough real data to say what the options should be.
const MAT_TYPES = ['fabric','dye','ink','zipper','plastic','trim','hardware','packaging','other'];
// value, tab label, and the noun used in the placeholder and the no-matches message.
const TABS = [
  ['products','Products','products'],
  ['materials','Materials','materials'],
  ['reports','Test Reports','test reports'],
  ['regs','Regulations','regulations'],
];
// Reports whose expiry lands inside this window count as "expiring" on the pulse
// strip and the reports filter. 60 days is the re-test lead time that gives a lab
// round-trip comfortable margin.
const EXPIRY_WINDOW_DAYS = 60;

function StatusPill({ map, status }) {
  const s = map[status] || { label:status||'—', color:'#8A8A8E', bg:'#F2F2F4' };
  return <span style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11.5px',fontWeight:600,color:s.color,background:s.bg,borderRadius:'980px',padding:'3px 10px',whiteSpace:'nowrap'}}>{s.dot&&<span style={{width:'6px',height:'6px',borderRadius:'50%',background:s.dot}}/>}{s.label}</span>;
}

const card = {background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)'};

// ═══════════════════════════════════════════════════════════════════════════
export default function Testing() {
  const [tab, setTab] = useState('products');
  const [products, setProducts] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [reports, setReports] = useState([]);
  const [regs, setRegs] = useState([]);
  const [labs, setLabs] = useState([]);
  const [prodMats, setProdMats] = useState([]);
  const [prodRegs, setProdRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {type:'material'|'report'|'link', data}
  const [search, setSearch] = useState('');
  // One filter slot per tab, driven by the pulse tiles and the pill rows. Kept
  // separate so switching tabs doesn't drag a products filter onto materials.
  const [prodFilter, setProdFilter] = useState('');   // '' | compliant | pending | issues | nocpsc | unset
  const [matFilter, setMatFilter] = useState('');     // '' | passed | untested | attention
  const [repFilter, setRepFilter] = useState('');     // '' | pass | fail | expiring

  const load = async () => {
    setLoading(true);
    const [p, m, r, rg, lb, pm, pr] = await Promise.all([
      SB.from('products').select('id,sku,name,compliance_status,cpsc_type,efiled_date,ships_to,trade_direction,importer_of_record,testing_paid_by').order('sku',{nullsFirst:false}),
      SB.from('materials').select('*,supplier:companies!supplier_id(name)').order('created_at',{ascending:false}),
      SB.from('test_reports').select('*,lab:labs(name),material:materials(name),product:products(name,sku),test_results(*)').order('test_date',{ascending:false}),
      // Secondary sort on code, because sort_order does not identify a row: the column
      // defaults to 100, so every rule created through RegModal without an explicit
      // number ties with 16 CFR 1633 and with every other such rule. Postgres may
      // return a tie in a different order between queries, which would reorder both
      // the Regulations tab and ReportModal's rule picker between page loads.
      SB.from('regulations').select('*').eq('active',true).order('sort_order').order('code'),
      SB.from('labs').select('*').order('name'),
      SB.from('product_materials').select('*,material:materials(id,name,status)'),
      // Ids only. The rule rows themselves come from `regs` above, so joining
      // regulations here would fetch the same 82 rows a second time.
      SB.from('product_regulations').select('id,product_id,regulation_id'),
    ]);
    setProducts(p.data||[]); setMaterials(m.data||[]); setReports(r.data||[]);
    setRegs(rg.data||[]); setLabs(lb.data||[]); setProdMats(pm.data||[]); setProdRegs(pr.data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  // ── derived signals ──
  // Latest report per material (reports arrive test_date desc, so first hit wins).
  // Its expiry is the material's re-test clock — the same "most recent report" the
  // report_recalc trigger derives status from, so the two never disagree.
  const latestByMaterial = useMemo(()=>{
    const map = {};
    reports.forEach(r=>{ if(r.material_id && !map[r.material_id]) map[r.material_id] = r; });
    return map;
  },[reports]);
  const expiryOf = (materialId) => { const r = latestByMaterial[materialId]; return r ? r.expiry_date : null; };

  const expiringReports = useMemo(()=>reports.filter(r=>{
    const d = daysUntil(r.expiry_date);
    return d!==null && d>=0 && d<=EXPIRY_WINDOW_DAYS;
  }),[reports]);

  // Derived product status from linked materials. Shown as a quiet secondary line
  // under the manual pill — a signal beside Jenn's call, never a substitute for it.
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

  // Everything is already in memory from load(), so filtering is a pass over arrays --
  // no query runs on a keystroke. These feed the four VIEWS ONLY: ReportModal's product
  // and material pickers and LinkModal's material list keep the unfiltered arrays, or a
  // search would silently narrow what is selectable inside a modal.
  const q = normalizeTerm(search);
  const searching = q.length > 0;
  const shownProducts = useMemo(() => {
    let list = !q ? products : products.filter(p =>
      // cpsc_type is matched through its displayed fallback, so "no cpsc" finds exactly
      // the products missing one -- the gap the fallback exists to show.
      // efiled_date joins through its DISPLAYED state, not its value, for the same
      // reason cpsc_type does: nobody searches for a date, they search for the gap.
      // ships_to is joined explicitly rather than passed as an array. matches() would
      // stringify it to "US,JP" via Array.prototype.toString and happen to work, but
      // relying on that means a search silently changes if the field ever holds
      // anything but strings. Spaces, so "JP" matches without the comma.
      matches(q, p.name, p.sku, p.cpsc_type || 'No CPSC', p.efiled_date ? 'eFiled' : 'Not eFiled',
              (p.ships_to || []).join(' '), p.trade_direction, p.importer_of_record, p.testing_paid_by)
    );
    if (prodFilter==='compliant') list = list.filter(p=>['compliant','passed'].includes(effectiveStatus(p)));
    if (prodFilter==='pending')   list = list.filter(p=>effectiveStatus(p)==='pending');
    if (prodFilter==='issues')    list = list.filter(p=>['failed','expired'].includes(effectiveStatus(p)));
    if (prodFilter==='unset')     list = list.filter(p=>!effectiveStatus(p));
    if (prodFilter==='nocpsc')    list = list.filter(p=>!p.cpsc_type);
    if (prodFilter==='noefile')   list = list.filter(p=>!p.efiled_date);
    // The worklist for filling the Trade & Compliance block across 271 products: none
    // of the four set. Not "any missing" -- with nothing filled yet those are the same
    // list, and this one keeps shrinking as work is done rather than staying long
    // because one field of four is blank.
    if (prodFilter==='notrade')   list = list.filter(p=>!(p.ships_to && p.ships_to.length) && !p.trade_direction && !p.importer_of_record && !p.testing_paid_by);
    return list;
  }, [products, q, prodFilter]);
  const shownMaterials = useMemo(() => {
    let list = !q ? materials : materials.filter(m =>
      // master_sku is not rendered on the row, unlike the rest. It is included because a
      // pasted SKU should find its material; it is NULL on every row today because
      // MaterialModal's save does not send it.
      matches(q, m.name, m.composition, m.material_type, m.supplier?.name, m.supplier_name, m.master_sku)
    );
    if (matFilter==='passed')    list = list.filter(m=>m.status==='passed');
    if (matFilter==='untested')  list = list.filter(m=>['untested','in_progress'].includes(m.status));
    if (matFilter==='attention') list = list.filter(m=>['failed','expired'].includes(m.status));
    return list;
  }, [materials, q, matFilter]);
  const shownReports = useMemo(() => {
    let list = !q ? reports : reports.filter(r =>
      // All three headline fallbacks, since which one renders varies by row, plus the
      // regulation codes from the nested results grid.
      matches(q, r.report_number, r.lab?.name, r.material?.name, r.product?.sku, r.product?.name,
        ...(r.test_results || []).map(t => t.regulation_code))
    );
    if (repFilter==='pass') list = list.filter(r=>r.overall_result==='pass');
    if (repFilter==='fail') list = list.filter(r=>r.overall_result==='fail');
    if (repFilter==='expiring') list = list.filter(r=>{ const d=daysUntil(r.expiry_date); return d!==null && d>=0 && d<=EXPIRY_WINDOW_DAYS; });
    return list;
  }, [reports, q, repFilter]);
  const shownRegs = useMemo(() => !q ? regs : regs.filter(r =>
    matches(q, ...regSearchFields(r))
  ), [regs, q]);
  const shownCount = { products:shownProducts, materials:shownMaterials, reports:shownReports, regs:shownRegs }[tab].length;
  const totalCount = { products, materials, reports, regs }[tab].length;

  // Stored statuses only, matching the table beneath. A product nobody has ruled on
  // counts toward none of the three — the totals are what has been decided, not a
  // partition of every product.
  const counts = {
    compliant: products.filter(p=>['compliant','passed'].includes(effectiveStatus(p))).length,
    pending:   products.filter(p=>['pending'].includes(effectiveStatus(p))).length,
    issues:    products.filter(p=>['failed','expired'].includes(effectiveStatus(p))).length,
    matGaps:   materials.filter(m=>['untested','in_progress','failed','expired'].includes(m.status)).length,
    expiring:  expiringReports.length,
    noCpsc:    products.filter(p=>!p.cpsc_type).length,
  };

  // No optimistic update on purpose: the select is controlled from `products`, so a
  // write that fails leaves the cell showing what the database still holds rather than
  // what the user picked. Reloading on success keeps the tiles in step with the table.
  const [statusErr, setStatusErr] = useState('');
  const setCompliance = async (prodId, value) => {
    setStatusErr('');
    const { error } = await SB.from('products').update({ compliance_status: value || null }).eq('id', prodId);
    if (error) { setStatusErr('Could not save compliance status — ' + error.message); return; }
    await load();
  };

  // products cascades to test_reports, product_materials, compliance_tasks,
  // inventory_lots, inventory_balances and stock_movements — all six go with it.
  // purchase_order_items and sales_order_items are ON DELETE RESTRICT instead, so
  // Postgres refuses (23503) rather than tearing a line off an order.
  const deleteProduct = async (p) => {
    const label = p.name || p.sku || 'this product';
    if (!window.confirm('Delete ' + label + '?\n\nIts test reports, material links, compliance tasks and inventory records are deleted with it. This cannot be undone.')) return;
    setStatusErr('');
    const { error } = await SB.from('products').delete().eq('id', p.id);
    if (error) {
      const inUse = error.code === '23503' || /foreign key|purchase_order_items|sales_order_items/i.test(error.message || '');
      setStatusErr(inUse ? "This product is used on a purchase or sales order and can't be deleted" : 'Could not delete product — ' + error.message);
      return;
    }
    await load();
  };

  // Every FK into materials is ON DELETE CASCADE — compliance_tasks,
  // product_materials and test_reports (whose own test_results cascade in turn).
  // Nothing blocks, so the 23503 branch below is a guard against a constraint
  // being tightened later, not a path reachable today.
  const deleteMaterial = async (m) => {
    const label = m.name || 'this material';
    if (!window.confirm('Delete ' + label + '?\n\nIts test reports and their results, its links to products, and its compliance tasks are deleted with it. This cannot be undone.')) return;
    setStatusErr('');
    const { error } = await SB.from('materials').delete().eq('id', m.id);
    if (error) {
      const inUse = error.code === '23503' || /foreign key/i.test(error.message || '');
      setStatusErr(inUse ? "This material is in use and can't be deleted" : 'Could not delete material — ' + error.message);
      return;
    }
    await load();
  };

  // test_results cascade off the report, so this never blocks. Deleting the row
  // fires report_recalc, which re-derives the linked material's status from
  // whatever report is now the most recent — exactly what we want.
  const deleteReport = async (r) => {
    const label = r.report_number ? 'report ' + r.report_number : 'this report';
    if (!window.confirm('Delete ' + label + '?\n\nIts per-regulation results go with it, and the material’s status is recalculated from its remaining reports. This cannot be undone.')) return;
    setStatusErr('');
    const { error } = await SB.from('test_reports').delete().eq('id', r.id);
    if (error) { setStatusErr('Could not delete report — ' + error.message); return; }
    await load();
  };

  // Pulse tiles: each is a live count and a shortcut. Tapping switches to the tab
  // that answers it and toggles the matching filter; tapping again clears it.
  const goto = (t, setter, current, val) => () => { setTab(t); setSearch(''); setter(current===val?'':val); };
  const pulse = [
    { k:'Compliant',        v:counts.compliant, c:'#30D158', go:goto('products',setProdFilter,prodFilter,'compliant'), on:tab==='products'&&prodFilter==='compliant' },
    { k:'Pending decision', v:counts.pending,   c:'#FF9F0A', go:goto('products',setProdFilter,prodFilter,'pending'),   on:tab==='products'&&prodFilter==='pending' },
    { k:'Issues',           v:counts.issues,    c:'#FF375F', go:goto('products',setProdFilter,prodFilter,'issues'),    on:tab==='products'&&prodFilter==='issues' },
    { k:'Material gaps',    v:counts.matGaps,   c:'#FF9F0A', go:goto('materials',setMatFilter,matFilter,'attention'), on:tab==='materials'&&matFilter==='attention' },
    { k:'Expiring \u2264'+EXPIRY_WINDOW_DAYS+'d', v:counts.expiring, c:'#FF375F', go:goto('reports',setRepFilter,repFilter,'expiring'), on:tab==='reports'&&repFilter==='expiring' },
    { k:'No CPSC type',     v:counts.noCpsc,    c:'#0A84FF', go:goto('products',setProdFilter,prodFilter,'nocpsc'),    on:tab==='products'&&prodFilter==='nocpsc' },
  ];

  return (
    <div className="db-apple" style={{padding:'30px 28px 80px',background:'#F5F5F7',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>

      {/* ── Header ── */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',gap:'16px',marginBottom:'22px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#FF9F0A'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>Compliance Operations</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Testing &amp; Compliance</div>
          <div style={{fontSize:'14.5px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>{String(materials.length)+' materials \u00b7 '+String(reports.length)+' reports \u00b7 '+String(regs.length)+' active rules'}</div>
        </div>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap'}}>
          <button onClick={()=>setModal({type:'material'})} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Material</button>
          <button onClick={()=>setModal({type:'lab'})} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Lab</button>
          <button onClick={()=>setModal({type:'reg'})} style={{background:'#fff',color:'#1D1D1F',border:'1px solid rgba(0,0,0,.1)',borderRadius:'980px',padding:'9px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Regulation</button>
          <button onClick={()=>setModal({type:'report'})} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'9px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ Log Test Report</button>
        </div>
      </div>

      {/* ── Pulse strip ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(140px,1fr))',gap:'12px',marginBottom:'22px'}}>
        {pulse.map(m=>(
          <button key={m.k} onClick={m.go} style={{background:m.on?'#1D1D1F':'#fff',borderRadius:'16px',padding:'14px 16px',border:'none',boxShadow:'0 1px 3px rgba(0,0,0,.04)',cursor:'pointer',textAlign:'left',transition:'.15s'}}>
            <div style={{fontSize:'24px',fontWeight:600,letterSpacing:'-.02em',lineHeight:1,color:m.on?'#fff':(m.v>0?m.c:'#1D1D1F'),fontVariantNumeric:'tabular-nums'}}>{m.v}</div>
            <div style={{fontSize:'11.5px',color:m.on?'rgba(255,255,255,.65)':'#86868B',marginTop:'5px',letterSpacing:'-.006em'}}>{m.k}</div>
          </button>
        ))}
      </div>

      {/* ── Controls: segmented tabs + search + per-tab filter pills ── */}
      {/* Changing tab clears the term: otherwise you land on Materials, see an empty
          list, and have no idea why. Filters persist per tab so a tile shortcut
          survives a detour through another view. */}
      <div style={{display:'flex',gap:'12px',alignItems:'center',flexWrap:'wrap',marginBottom:'18px'}}>
        <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px',boxShadow:'inset 0 1px 2px rgba(0,0,0,.05)'}}>
          {TABS.map(([v,l])=>(
            <button key={v} onClick={()=>{setTab(v);setSearch('');}} style={{display:'inline-flex',alignItems:'center',gap:'7px',padding:'9px 16px',borderRadius:'9px',border:'none',cursor:'pointer',fontSize:'13.5px',fontWeight:600,letterSpacing:'-.01em',background:tab===v?'#1D1D1F':'transparent',color:tab===v?'#fff':'#5A5A5E',boxShadow:tab===v?'0 1px 3px rgba(0,0,0,.18)':'none',transition:'.14s'}}>
              {l}<span style={{fontSize:'11px',fontWeight:700,borderRadius:'20px',padding:'1px 7px',background:tab===v?'rgba(255,255,255,.22)':'#DCDCE0',color:tab===v?'#fff':'#6A6A6E'}}>{ {products:products.length,materials:materials.length,reports:reports.length,regs:regs.length}[v] }</span>
            </button>
          ))}
        </div>
        <div style={{position:'relative',flex:'1 1 200px',maxWidth:'320px'}}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="2" strokeLinecap="round" style={{position:'absolute',left:'13px',top:'50%',transform:'translateY(-50%)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder={'Search '+(TABS.find(t=>t[0]===tab)||[])[2]+'\u2026'} style={{width:'100%',border:'none',borderRadius:'980px',padding:'10px 15px 10px 38px',fontSize:'13.5px',outline:'none',background:'#fff',boxShadow:'0 1px 3px rgba(0,0,0,.05)',boxSizing:'border-box'}} />
        </div>
        {/* The tiles above stay at totals while the list is filtered. This count makes
            that read as deliberate rather than as the tiles being wrong. */}
        {searching && <span style={{fontSize:'11.5px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{shownCount} of {totalCount}</span>}
        {tab==='products' && (
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {/* A pill rather than a seventh pulse tile: with nothing filed yet the tile
                would read 271 beside "No CPSC type" 271, two tiles saying the same
                thing -- that nothing has been entered. It earns a tile once the count
                is meaningfully below the total, and this filter is what it would
                point at. */}
            {[['','All'],['compliant','Compliant'],['pending','Pending'],['issues','Issues'],['unset','Not set'],['nocpsc','No CPSC'],['noefile','Not eFiled'],['notrade','No trade info']].map(([v,l])=>(
              <button key={v||'all'} onClick={()=>setProdFilter(v)} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 12px',border:'none',cursor:'pointer',background:prodFilter===v?'#1D1D1F':'#fff',color:prodFilter===v?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{l}</button>
            ))}
          </div>
        )}
        {tab==='materials' && (
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {[['','All'],['passed','Passed'],['untested','Untested'],['attention','Failed / expired']].map(([v,l])=>(
              <button key={v||'all'} onClick={()=>setMatFilter(v)} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 12px',border:'none',cursor:'pointer',background:matFilter===v?'#1D1D1F':'#fff',color:matFilter===v?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{l}</button>
            ))}
          </div>
        )}
        {tab==='reports' && (
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            {[['','All'],['pass','Pass'],['fail','Fail'],['expiring','Expiring \u2264'+EXPIRY_WINDOW_DAYS+'d']].map(([v,l])=>(
              <button key={v||'all'} onClick={()=>setRepFilter(v)} style={{fontSize:'12px',fontWeight:600,borderRadius:'980px',padding:'6px 12px',border:'none',cursor:'pointer',background:repFilter===v?'#1D1D1F':'#fff',color:repFilter===v?'#fff':'#5A5A5E',boxShadow:'0 1px 2px rgba(0,0,0,.05)'}}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {statusErr && (
        <div style={{display:'flex',alignItems:'center',gap:'10px',background:'#FEE2E2',border:'1px solid #FCA5A5',color:'#B91C1C',borderRadius:'12px',padding:'11px 14px',fontSize:'13px',marginBottom:'14px'}}>
          <span style={{flex:1}}>{statusErr}</span>
          <button onClick={()=>setStatusErr('')} style={{background:'none',border:'none',color:'#B91C1C',fontSize:'15px',cursor:'pointer',lineHeight:1,padding:0}}>×</button>
        </div>
      )}

      {loading ? <div style={{padding:'60px',textAlign:'center',color:'#86868B',fontSize:'14px'}}>Loading…</div> : (
        <>
          {tab==='products'  && <ProductsView products={shownProducts} prodMats={prodMats} prodRegs={prodRegs} productStatus={productStatus} onLink={(p)=>setModal({type:'link',data:p})} onLinkRules={(p)=>setModal({type:'linkrules',data:p})} onEfiling={(p)=>setModal({type:'efiling',data:p})} onSetStatus={setCompliance} onEdit={(p)=>setModal({type:'product',data:p})} onDelete={deleteProduct} searching={searching} term={search.trim()} filtered={!!prodFilter} />}
          {tab==='materials' && <MaterialsView materials={shownMaterials} expiryOf={expiryOf} reports={reports} onEdit={(m)=>setModal({type:'material',data:m})} onTest={(m)=>setModal({type:'report',data:{material_id:m.id}})} onDelete={deleteMaterial} searching={searching} term={search.trim()} filtered={!!matFilter} />}
          {tab==='reports'   && <ReportsView reports={shownReports} onEdit={(r)=>setModal({type:'report',row:r})} onDelete={deleteReport} searching={searching} term={search.trim()} filtered={!!repFilter} />}
          {/* RegulationsList renders rows only -- the empty state stays here because its
              wording is this page's, not the shared component's. Delete moved into
              RegModal, so the row no longer carries a bin: a rule can be cited by test
              results and linked to products, and the confirm has to establish both
              before it can say what deleting one would do. */}
          {tab==='regs'      && (shownRegs.length === 0
            ? <Empty
                title={searching ? 'No regulations match “'+search.trim()+'”' : 'No regulations loaded'}
                sub={searching ? 'Try a different term, or clear the search.' : 'Run the compliance schema seed to load the CPSC rule library.'} />
            : <RegulationsList regs={shownRegs} onEdit={(r)=>setModal({type:'reg',data:r})} cardStyle={card} dividerColor="#F5F5F7" />)}
        </>
      )}

      {/* regs and the product's links are passed rather than refetched, so this modal
          and the row it opened from cannot disagree about the same product. */}
      {modal?.type==='product'  && <CreateProductModal data={modal.data} regs={regs} links={modal.data ? prodRegs.filter(l=>l.product_id===modal.data.id) : []} onClose={()=>setModal(null)} onCreated={()=>{setModal(null);load();}} />}
      {modal?.type==='lab'      && <LabModal onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='reg'      && <RegModal data={modal.data} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} onDeleted={()=>{setModal(null);load();}} />}
      {modal?.type==='material' && <MaterialModal data={modal.data} labs={labs} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='report'   && <ReportModal preset={modal.data} data={modal.row} materials={materials} products={products} labs={labs} regs={regs} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='link'     && <LinkModal product={modal.data} materials={materials} existing={prodMats.filter(l=>l.product_id===modal.data.id)} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {/* regs is already filtered to active, so a retired rule cannot be linked to a
          new product while ones already linked to it keep their link. */}
      {modal?.type==='linkrules' && <LinkRulesModal product={modal.data} regs={regs} existing={prodRegs.filter(l=>l.product_id===modal.data.id)} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
      {modal?.type==='efiling'   && <EfilingModal product={modal.data} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} />}
    </div>
  );
}

// ── PRODUCTS VIEW ────────────────────────────────────────────────────────────
function ProductsView({ products, prodMats, prodRegs, productStatus, onLink, onLinkRules, onEfiling, onSetStatus, onEdit, onDelete, searching, term, filtered }) {
  // Mid-search the "how records get created" copy would be misleading — the record may
  // well exist, it just does not match.
  if(!products.length) return (searching || filtered)
    ? <Empty title={searching?('No products match \u201C'+term+'\u201D'):'Nothing in this filter'} sub="Try a different term, or clear the search / filter." />
    : <Empty title="No products yet" sub="Products appear here once they exist. Open one to link the materials it is built from and set its compliance status." />;
  return (
    <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(200px,1.2fr) minmax(160px,1fr) 170px max-content',gap:'16px',padding:'13px 22px',borderBottom:'1px solid rgba(0,0,0,.06)',background:'#FAFAFB'}}>
        {['Product','Built from','Compliance',''].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i===3?'right':'left'}}>{h}</div>)}
      </div>
      {products.map((p,i)=>{
        const links = prodMats.filter(l=>l.product_id===p.id);
        // Counts LINK rows, not resolved rules, so a link to a retired rule still
        // counts here even though the modal cannot name it.
        const ruleCount = prodRegs.filter(l=>l.product_id===p.id).length;
        const st = effectiveStatus(p);
        const derived = productStatus(p.id);
        const dInfo = PROD_STATUS[derived] || PROD_STATUS.not_set;
        return (
          <div key={p.id} onClick={()=>onEdit(p)} style={{display:'grid',gridTemplateColumns:'minmax(200px,1.2fr) minmax(160px,1fr) 170px max-content',gap:'16px',padding:'15px 22px',borderTop:i>0?'1px solid #F5F5F7':'none',alignItems:'center',cursor:'pointer',transition:'.12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name||'—'}</div>
              {/* Type only. The certificate number that used to sit beside it in the
                  modal was removed as unused, not moved here — its column has never
                  held a value. 'No CPSC' rather than nothing: every product is
                  unset today and the gap is the thing worth seeing. Deliberately the
                  same muted colour as the SKU — GCC vs CPC says which rule applies,
                  not pass or fail, so colouring it would imply a judgement. */}
              <div style={{fontSize:'12px',color:'#86868B',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[p.sku, p.cpsc_type || 'No CPSC'].filter(Boolean).join(' \u00b7 ')}</div>
            </div>
            {/* The materials cell shows what the product is actually built from, with
                each material's status as a dot — and opens the link modal directly. */}
            <div onClick={e=>{e.stopPropagation();onLink(p);}} style={{minWidth:0,cursor:'pointer'}} title="Edit linked materials">
              {links.length ? (
                <div style={{display:'flex',alignItems:'center',gap:'6px',flexWrap:'wrap'}}>
                  {links.slice(0,2).map(l=>{
                    const ms = MAT_STATUS[l.material?.status] || MAT_STATUS.untested;
                    return (
                      <span key={l.id} style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'11.5px',fontWeight:500,color:'#4A4A4E',background:'#F5F5F7',borderRadius:'980px',padding:'3px 9px',maxWidth:'150px'}}>
                        <span style={{width:'6px',height:'6px',borderRadius:'50%',background:ms.dot,flexShrink:0}}/>
                        <span style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{l.material?.name||'—'}</span>
                      </span>
                    );
                  })}
                  {links.length>2 && <span style={{fontSize:'11px',fontWeight:600,color:'#86868B'}}>+{links.length-2}</span>}
                </div>
              ) : <span style={{fontSize:'12px',color:'#C7C7CC'}}>no materials linked</span>}
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:'4px',minWidth:0}} onClick={e=>e.stopPropagation()}>
              {/* The pill is Jenn's stored call; the select writes it. The line under is
                  the material-derived signal — advisory context beside the decision,
                  never a substitute for it. */}
              <select
                value={p.compliance_status||''}
                onChange={e=>onSetStatus(p.id,e.target.value)}
                aria-label={'Compliance status for '+(p.sku||p.name||'product')}
                style={{border:'1px solid rgba(0,0,0,.1)',borderRadius:'8px',padding:'5px 8px',fontSize:'12px',fontWeight:600,color:(PROD_STATUS[st||'not_set']||{}).color,background:'#fff',cursor:'pointer',fontFamily:'inherit',outline:'none',maxWidth:'100%'}}
              >
                {COMPLIANCE_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </select>
              {links.length>0 && (
                <span style={{display:'inline-flex',alignItems:'center',gap:'5px',fontSize:'10.5px',color:'#86868B'}}>
                  <span style={{width:'5px',height:'5px',borderRadius:'50%',background:dInfo.dot||'#C7C7CC'}}/>
                  materials: {dInfo.label.toLowerCase()}
                </span>
              )}
            </div>
            {/* The row itself opens the editor, so anything clickable inside it has to
                stop the event or it would do both. */}
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',alignItems:'center'}}>
              <button onClick={e=>{e.stopPropagation();onLink(p);}} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Materials</button>
              <button onClick={e=>{e.stopPropagation();onLinkRules(p);}} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Rules{ruleCount>0 && ' ('+ruleCount+')'}</button>
              {/* A dot rather than a count: filing is binary, so a number would say
                  nothing. Filled means a date is stored, hollow means none — the gap is
                  what is worth scanning down the column. The date itself is in the
                  modal and on the tooltip; it is too wide for the row and rarely needed
                  at a glance. */}
              <button onClick={e=>{e.stopPropagation();onEfiling(p);}} title={p.efiled_date ? 'eFiled '+fmtDate(p.efiled_date) : 'Not eFiled'} style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer',whiteSpace:'nowrap'}}>
                <span style={{width:'7px',height:'7px',borderRadius:'50%',flexShrink:0,background:p.efiled_date?'#30D158':'transparent',border:p.efiled_date?'none':'1.5px solid #C7C7CC'}}/>
                eFiling
              </button>
              <button onClick={e=>{e.stopPropagation();onDelete(p);}} title={'Delete '+(p.name||p.sku||'product')} aria-label={'Delete '+(p.name||p.sku||'product')} style={{background:'none',border:'none',padding:'5px',borderRadius:'7px',color:'#C7C7CC',cursor:'pointer',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#FF375F';}} onMouseLeave={e=>{e.currentTarget.style.color='#C7C7CC';}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MATERIALS VIEW ───────────────────────────────────────────────────────────
function MaterialsView({ materials, expiryOf, reports, onEdit, onTest, onDelete, searching, term, filtered }) {
  if(!materials.length) return (searching || filtered)
    ? <Empty title={searching?('No materials match \u201C'+term+'\u201D'):'Nothing in this filter'} sub="Try a different term, or clear the search / filter." />
    : <Empty title="No materials yet" sub="Add a material (fabric, dye, zipper…) — it's the unit that gets tested and that SKUs inherit compliance from." />;
  const reportCount = id => reports.filter(r=>r.material_id===id).length;
  return (
    <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(200px,1.3fr) 110px minmax(120px,1fr) 118px 150px 120px',gap:'14px',padding:'13px 22px',borderBottom:'1px solid rgba(0,0,0,.06)',background:'#FAFAFB'}}>
        {['Material','Type','Supplier','Status','Testing',''].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i===5?'right':'left'}}>{h}</div>)}
      </div>
      {materials.map((m,i)=>{
        const exp = expiryOf(m.id);
        const d = daysUntil(exp);
        const expSoon = d!==null && d>=0 && d<=EXPIRY_WINDOW_DAYS;
        const expPast = d!==null && d<0;
        const rc = reportCount(m.id);
        return (
          <div key={m.id} onClick={()=>onEdit(m)} style={{display:'grid',gridTemplateColumns:'minmax(200px,1.3fr) 110px minmax(120px,1fr) 118px 150px 120px',gap:'14px',padding:'15px 22px',borderTop:i>0?'1px solid #F5F5F7':'none',alignItems:'center',cursor:'pointer',transition:'.12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
              {m.composition&&<div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.composition}</div>}
            </div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E',textTransform:'capitalize',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.material_type||'—'}</div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.supplier?.name||m.supplier_name||'—'}</div>
            <div><StatusPill map={MAT_STATUS} status={m.status} /></div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'12px',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{m.last_tested?fmtDate(m.last_tested):'never tested'}{rc>0?' \u00b7 '+rc+' rpt'+(rc===1?'':'s'):''}</div>
              {/* The re-test clock, from the latest report's expiry — the list a
                  compliance operator actually plans lab work from. */}
              {expSoon && <div style={{fontSize:'11px',fontWeight:700,color:'#B45309',marginTop:'2px'}}>{'re-test in '+d+'d'}</div>}
              {expPast && <div style={{fontSize:'11px',fontWeight:700,color:'#FF375F',marginTop:'2px'}}>{'expired '+Math.abs(d)+'d ago'}</div>}
            </div>
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',alignItems:'center'}}>
              <button onClick={e=>{e.stopPropagation();onTest(m);}} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer',whiteSpace:'nowrap'}}>+ Test</button>
              <button onClick={e=>{e.stopPropagation();onDelete(m);}} title={'Delete '+(m.name||'material')} aria-label={'Delete '+(m.name||'material')} style={{background:'none',border:'none',padding:'5px',borderRadius:'7px',color:'#C7C7CC',cursor:'pointer',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#FF375F';}} onMouseLeave={e=>{e.currentTarget.style.color='#C7C7CC';}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── REPORTS VIEW ─────────────────────────────────────────────────────────────
function ReportsView({ reports, onEdit, onDelete, searching, term, filtered }) {
  if(!reports.length) return (searching || filtered)
    ? <Empty title={searching?('No test reports match \u201C'+term+'\u201D'):'Nothing in this filter'} sub="Try a different term, or clear the search / filter." />
    : <Empty title="No test reports yet" sub="Log a lab report to record pass/fail results against CPSC regulations." />;
  return (
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(360px,1fr))',gap:'14px'}}>
      {reports.map(r=>{
        const d = daysUntil(r.expiry_date);
        const expSoon = d!==null && d>=0 && d<=EXPIRY_WINDOW_DAYS;
        const expPast = d!==null && d<0;
        const rail = r.overall_result==='pass'?'#30D158':r.overall_result==='fail'?'#FF375F':'#FF9F0A';
        return (
          <div key={r.id} onClick={()=>onEdit(r)} style={{background:'#fff',borderRadius:'18px',boxShadow:'0 1px 3px rgba(0,0,0,.05)',cursor:'pointer',overflow:'hidden',display:'flex'}}>
            <div style={{width:'4px',background:rail,flexShrink:0}} />
            <div style={{padding:'16px 18px',flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:'12px',marginBottom:'10px'}}>
                <div style={{minWidth:0}}>
                  <div style={{fontSize:'14px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.material?.name||r.product?.sku||r.product?.name||'Report'}</div>
                  <div style={{fontSize:'12px',color:'#86868B',marginTop:'3px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{(r.lab?.name||'—')+' \u00b7 '+(r.report_number||'no #')+' \u00b7 '+fmtDate(r.test_date)}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:'7px',flexShrink:0}}>
                  <StatusPill map={{pass:{label:'Pass',color:'#15803D',bg:'#DCFCE7'},fail:{label:'Fail',color:'#B91C1C',bg:'#FEE2E2'},pending:{label:'Pending',color:'#B45309',bg:'#FEF3C7'}}} status={r.overall_result} />
                  <button onClick={e=>{e.stopPropagation();onDelete(r);}} title="Delete report" aria-label={'Delete report '+(r.report_number||'')} style={{background:'none',border:'none',padding:'4px',color:'#C7C7CC',cursor:'pointer',display:'flex'}} onMouseEnter={e=>{e.currentTarget.style.color='#FF375F';}} onMouseLeave={e=>{e.currentTarget.style.color='#C7C7CC';}}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>
                  </button>
                </div>
              </div>
              {(expSoon || expPast || r.expiry_date) && (
                <div style={{marginBottom:r.test_results?.length?'10px':'0'}}>
                  <span style={{display:'inline-flex',fontSize:'11px',fontWeight:700,borderRadius:'980px',padding:'3px 10px',color:expPast?'#B91C1C':expSoon?'#B45309':'#4A4A4E',background:expPast?'#FEE2E2':expSoon?'#FEF3C7':'#F5F5F7'}}>
                    {expPast?('Expired '+Math.abs(d)+'d ago'):expSoon?('Expires in '+d+'d'):('Valid until '+fmtDate(r.expiry_date))}
                  </span>
                </div>
              )}
              {r.test_results?.length>0 && (
                <div style={{display:'grid',gridTemplateColumns:'1fr auto auto auto',gap:'5px 12px',fontSize:'12px',paddingTop:'10px',borderTop:'1px solid #F5F5F7'}}>
                  <div style={{fontSize:'9.5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4'}}>Regulation</div>
                  <div style={{fontSize:'9.5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Measured</div>
                  <div style={{fontSize:'9.5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Limit</div>
                  <div style={{fontSize:'9.5px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.05em',color:'#A0A0A4',textAlign:'right'}}>Result</div>
                  {r.test_results.map(tr=>(
                    <React.Fragment key={tr.id}>
                      <div style={{color:'#1D1D1F',fontWeight:500,fontFamily:'var(--mono)',fontSize:'11.5px'}}>{tr.regulation_code||'—'}</div>
                      <div style={{textAlign:'right',color:'#4A4A4E',fontVariantNumeric:'tabular-nums'}}>{tr.measured_value||'—'}</div>
                      <div style={{textAlign:'right',color:'#86868B',fontVariantNumeric:'tabular-nums'}}>{tr.limit_value||'—'}</div>
                      <div style={{textAlign:'right',fontWeight:700,fontSize:'11px',color:tr.result==='pass'?'#15803D':tr.result==='fail'?'#B91C1C':'#8A8A8E'}}>{(tr.result||'—').toUpperCase()}</div>
                    </React.Fragment>
                  ))}
                </div>
              )}
              {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{display:'inline-block',marginTop:'11px',fontSize:'12.5px',color:'#0A84FF',fontWeight:600,textDecoration:'none'}}>View report PDF \u2192</a>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── MODALS ───────────────────────────────────────────────────────────────────
const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',backdropFilter:'blur(2px)',zIndex:200,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'18px',boxShadow:'0 12px 48px rgba(0,0,0,.2)',width:'100%',maxWidth:'560px',padding:'24px'}}>{children}</div>
  </div>
);
const inp = {width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const lbl = {display:'block',fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'6px'};
// ToastProvider in page.jsx publishes this global and wraps every page, so it works
// from a modal without prop plumbing. The other modals in this file still call
// alert(); moving them across is its own cleanup, not this one.
const toast = (msg, type) => { if (typeof window !== 'undefined') window._toast?.(msg, type); };

function MaterialModal({ data, labs, onClose, onSaved }) {
  const [f,setF]=useState({ name:data?.name||'', material_type:data?.material_type||'', supplier_name:data?.supplier_name||'', composition:data?.composition||'', color:data?.color||'', notes:data?.notes||'' });
  const [saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const save=async()=>{
    if(!f.name.trim()) return;
    setSaving(true);
    const payload={ name:f.name.trim(), material_type:f.material_type||null, supplier_name:f.supplier_name||null, composition:f.composition||null, color:f.color||null, notes:f.notes||null };
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
          <div><label style={lbl}>Type</label><input style={inp} value={f.material_type} onChange={set('material_type')} placeholder="e.g. fabric, zipper, trim" /></div>
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

// Fields mirror vessl.labs exactly: name (NOT NULL), address, phone, email,
// cpsc_accepted (default true), notes. id and created_at are database-side.
function LabModal({ onClose, onSaved }) {
  const [f,setF]=useState({ name:'', address:'', phone:'', email:'', cpsc_accepted:false, notes:'' });
  const [saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const setB=k=>e=>setF(p=>({...p,[k]:e.target.checked}));
  const save=async()=>{
    const name=f.name.trim();
    if(!name){ alert('Lab name required'); return; }
    setSaving(true);
    const { error } = await SB.from('labs').insert({
      name, address:f.address||null, phone:f.phone||null, email:f.email||null,
      cpsc_accepted:!!f.cpsc_accepted, notes:f.notes||null,
    });
    setSaving(false);
    // Checked, not discarded: a silent failure here is how a permissions problem
    // turns into "the lab I added isn't in the dropdown".
    if(error){ alert('Error: '+error.message); return; }
    onSaved();
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>New lab</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>Testing labs available when logging a report.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div><label style={lbl}>Lab name *</label><input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. SGS, Intertek, Bureau Veritas" /></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Email</label><input style={inp} value={f.email} onChange={set('email')} placeholder="optional" /></div>
          <div><label style={lbl}>Phone</label><input style={inp} value={f.phone} onChange={set('phone')} placeholder="optional" /></div>
        </div>
        <div><label style={lbl}>Address</label><input style={inp} value={f.address} onChange={set('address')} placeholder="optional" /></div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#3A3A3E',cursor:'pointer'}}>
          <input type="checkbox" checked={f.cpsc_accepted} onChange={setB('cpsc_accepted')} /> CPSC-accepted lab
        </label>
        <div><label style={lbl}>Notes</label><textarea style={{...inp,minHeight:'60px',resize:'vertical'}} value={f.notes} onChange={set('notes')} /></div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save lab'}</button>
      </div>
    </Overlay>
  );
}

// `preset` pre-seeds a NEW report (the + Test button passes {material_id}); `data` is
// an existing row to edit. The parent's reports query already pulls test_results(*),
// so the child lines come in with the row and need no second fetch.
function ReportModal({ preset, data, materials, products, labs, regs, onClose, onSaved }) {
  const editing = !!(data && data.id);
  const [f,setF]=useState({
    material_id:(editing?data.material_id:preset?.material_id)||'', product_id:(editing?data.product_id:'')||'',
    lab_id:(editing?data.lab_id:'')||'', report_number:(editing?data.report_number:'')||'',
    test_date:(editing?data.test_date:'')||'', expiry_date:(editing?data.expiry_date:'')||'',
    manufacture_place:(editing?data.manufacture_place:'')||'', sample_description:(editing?data.sample_description:'')||'',
    pdf_url:(editing?data.pdf_url:'')||'',
  });
  const [lines,setLines]=useState(()=>{
    const existing = editing && Array.isArray(data.test_results) ? data.test_results : [];
    if(!existing.length) return [{ regulation_id:'', measured_value:'', limit_value:'', result:'pass' }];
    return existing.map(tr=>({ regulation_id:tr.regulation_id||'', measured_value:tr.measured_value||'', limit_value:tr.limit_value||'', result:tr.result||'pass' }));
  });
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
    const payload={
      material_id:f.material_id||null, product_id:f.product_id||null, lab_id:f.lab_id||null,
      report_number:f.report_number||null, test_date:f.test_date||null, expiry_date:f.expiry_date||null,
      manufacture_place:f.manufacture_place||null, sample_description:f.sample_description||null,
      pdf_url:f.pdf_url||null, overall_result:overall,
    };
    // Writing overall_result on either path fires report_recalc, which re-derives the
    // linked material's status from its latest report. That is the point of saving.
    const { data:rep, error } = editing
      ? await SB.from('test_reports').update(payload).eq('id', data.id).select().single()
      : await SB.from('test_reports').insert(payload).select().single();
    if(error){ setSaving(false); alert('Error: '+error.message); return; }
    // The child lines are replaced, not merged: on edit every existing result row is
    // deleted first, so re-saving cannot duplicate them and a line removed in the form
    // actually disappears. test_results.id is referenced by nothing, so churning the
    // ids costs nothing. Deleting from test_results does not fire report_recalc --
    // that trigger is on test_reports -- but the update above already did.
    if(editing){
      const { error:delErr } = await SB.from('test_results').delete().eq('report_id', data.id);
      if(delErr){ setSaving(false); alert('Error replacing results: '+delErr.message); return; }
    }
    const rows=lines.filter(l=>l.regulation_id).map(l=>{
      const reg=regs.find(r=>r.id===l.regulation_id);
      return { report_id:rep.id, regulation_id:l.regulation_id, regulation_code:reg?.code||null, measured_value:l.measured_value||null, limit_value:l.limit_value||null, result:l.result };
    });
    if(rows.length){
      const { error:insErr } = await SB.from('test_results').insert(rows);
      if(insErr){ setSaving(false); alert('Error saving results: '+insErr.message); return; }
    }
    setSaving(false); onSaved();
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>{editing?'Edit test report':'Log test report'}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>{editing?'Saving replaces this report’s per-regulation results and recalculates the material’s status.':'Enter the lab result. A material passing here cascades to every SKU built from it.'}</div>
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
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':(editing?'Save changes':'Save report')}</button>
      </div>
    </Overlay>
  );
}

// One nullable date. A date means filed, null means not filed, and there is no
// "not applicable" state -- whether a product needs filing is a judgement for
// whoever is looking, not something the app decides. If that turns out to be
// wanted it is a third state added later, not a sentinel value smuggled in here.
//
// Local to this file rather than app/components: one host, and it reuses the
// Overlay, inp, lbl and toast already defined above. Extracting it would mean
// copying four style constants to save nothing -- the opposite of the CodeModal
// case, where two pages needed the same editor.
function EfilingModal({ product, onClose, onSaved }) {
  // Straight from the column, straight back to it. <input type="date"> both reads
  // and writes 'YYYY-MM-DD', which is exactly what a Postgres `date` wants, so no
  // Date object is constructed anywhere on this path. Round-tripping through one
  // is how a filing date silently moves by a day, and nobody notices.
  const [date,setDate] = useState(product.efiled_date || '');
  const [saving,setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await SB.from('products').update({ efiled_date: date || null }).eq('id', product.id);
      if (error) { toast('Could not save the eFiling date: '+error.message, 'err'); return; }
      onSaved();
    } finally { setSaving(false); }
  };
  const label = product.sku || product.name || 'this product';
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'4px'}}>eFiling for {label}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>The date this product was eFiled with CPSC.</div>
      <div>
        <label style={lbl}>eFiled date</label>
        {/* A native date input offers no way to empty itself -- Chrome shows no clear
            affordance at all -- so without this button the only route back to "not
            filed" would be one the widget does not afford, however the hint worded it.
            It only empties local state; the null still goes through the existing
            `date || null` on save, so nothing writes until Save is pressed.

            Glyph and colours copied from the search clear at page.jsx:1043 rather
            than the lucide <X> used in quotes.jsx and HtsField: this file imports no
            icon library, and it already uses × as its dismiss glyph twice. */}
        <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
          <input type="date" style={{...inp,flex:1,minWidth:0}} value={date} onChange={e=>setDate(e.target.value)} />
          {date && (
            <button type="button" onClick={()=>setDate('')} title="Clear the date" aria-label="Clear the date"
              style={{flexShrink:0,width:'20px',height:'20px',borderRadius:'50%',border:'none',background:'#F0F0F2',color:'#8A8A8E',fontSize:'14px',lineHeight:1,cursor:'pointer'}}>×</button>
          )}
        </div>
        <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'6px'}}>
          {date ? 'Clear it with the × beside the field, then save, to mark this product not filed.' : 'No date means not filed.'}
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save'}</button>
      </div>
    </Overlay>
  );
}

function LinkModal({ product, materials, existing, onClose, onSaved }) {
  const [sel,setSel]=useState(new Set(existing.map(e=>e.material_id)));
  const [saving,setSaving]=useState(false);
  const toggle=id=>setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });
  // Neither write used to be checked, and onSaved() ran unconditionally: a refused
  // insert closed the modal, reloaded the parent, and reported success for links that
  // were never created. Both are checked now and onSaved() is reached only when
  // everything asked for actually happened.
  const save=async()=>{
    setSaving(true);
    try {
      const have=new Set(existing.map(e=>e.material_id));
      const toAdd=[...sel].filter(id=>!have.has(id));
      const toRemove=existing.filter(e=>!sel.has(e.material_id));

      // Additions first, deliberately. If this fails nothing has been removed yet, so
      // the stored link set is exactly what it was and the selection can be retried
      // as it stands. Doing removals first would lose them to a failed insert.
      if(toAdd.length){
        // upsert, not insert. A retry after a failure recomputes toAdd from `existing`,
        // which is stale until the parent reloads -- so rows the first attempt did
        // write would be offered again, and a plain insert is atomic, meaning that one
        // collision would reject the whole batch including the genuinely new rows.
        // product_materials has UNIQUE (product_id, material_id), which is what the
        // conflict target needs.
        const { error } = await SB.from('product_materials').upsert(
          toAdd.map(mid=>({ product_id:product.id, material_id:mid, is_required:true })),
          { onConflict:'product_id,material_id', ignoreDuplicates:true }
        );
        if(error){
          // Unreachable via the conflict target above, so a 23505 here means the
          // constraint is not the one this assumes -- worth saying rather than
          // showing a raw message that reads like a bug in the user's input.
          const dupe = error.code === '23505';
          toast(dupe
            ? 'Some of those materials are already linked — close and reopen to see the current state.'
            : 'Could not link materials: '+error.message, 'err');
          return;   // no onSaved: nothing changed, so there is nothing to reload
        }
      }

      // One statement rather than a request per row.
      if(toRemove.length){
        const { error } = await SB.from('product_materials').delete().in('id', toRemove.map(e=>e.id));
        if(error){
          // Partial: the additions landed, the removals did not. The modal stays open
          // on the same selection, and because the upsert above is idempotent, pressing
          // Save again re-attempts only what is genuinely outstanding.
          toast('Linked the new materials, but could not remove the unlinked ones: '+error.message, 'err');
          return;
        }
      }
      onSaved();
    } finally { setSaving(false); }
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
    <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',padding:'56px 32px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </div>
      <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'7px'}}>{title}</div>
      <div style={{color:'#8A8A8E',fontSize:'13.5px',maxWidth:'380px',margin:'0 auto',lineHeight:1.6}}>{sub}</div>
    </div>
  );
}
