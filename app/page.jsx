'use client';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SB } from '@/lib/supabase';
import { SBQ } from '@/lib/supabaseQuotes';
import Quotes from '@/app/quotes';

const LOGO_WHITE = "data:image/png;base64,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";

// Per-company color — identical hash+palette to the Quotes app so a company's
// hue is the SAME in both systems.
const CLIENT_PALETTE = ['#f87171','#fb923c','#fbbf24','#a3e635','#4ade80','#2dd4bf','#58a6ff','#818cf8','#a78bfa','#f472b6','#fb7185','#22d3ee'];
function companyColor(name){
  const n=(name||'Unassigned').trim(); let hash=0;
  for(let i=0;i<n.length;i++) hash=(hash*31+n.charCodeAt(i))>>>0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}
function initials(name){ return (name||'?').replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?'; }

// ── Utils ────────────────────────────────────────────────────────────────────
const money = (n, c='USD') => n == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n);
const fmtDate = s => { if (!s) return '—'; return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const fmtDateTime = s => { if (!s) return ''; const d=new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
const fmtNum = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
const nowDate = () => new Date().toISOString().slice(0,10);
const STATUSES = ['draft','confirmed','sampling','sample_approved','testing','in_production','ready_to_ship','shipped','delivered','closed'];
const TEAM = [
  { name:'Kristy',  email:'kristy@kinguniversal.com' },
  { name:'Loren',   email:'loren@kinguniversal.com' },
  { name:'Riley',   email:'riley@kinguniversal.com' },
  { name:'Steven',  email:'steven@kinguniversal.com' },
  { name:'Carmela', email:'carmela@kinguniversal.com' },
];

function Badge({ status }) {
  return <span className={`badge badge-${(status||'').replace(/ /g,'_')}`}>{(status||'—').replace(/_/g,' ')}</span>;
}

// ── PO browsing helpers (search + client filter, shared by Orders & Dashboard) ──
const poClient   = p => p.client?.name || '';
const poFactory  = p => p.factory?.name || p.companies?.name || '';
const poProducts = p => (p.purchase_order_items||[]).map(it=>it.products?.name||it.description||'').join(' ');
function filterPOs(rows, { search, client, status }){
  const s = (search||'').toLowerCase().trim();
  return (rows||[]).filter(p=>{
    if (status && status!=='all' && p.status!==status) return false;
    if (client && client!=='all' && poClient(p)!==client) return false;
    if (s){
      const hay = `${p.order_number||''} ${poClient(p)} ${poFactory(p)} ${poProducts(p)}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
function distinctClients(rows){
  const m={}; (rows||[]).forEach(p=>{ const c=poClient(p); if(c) m[c]=(m[c]||0)+1; });
  return Object.entries(m).sort((a,b)=>a[0].localeCompare(b[0]));
}
const PO_CARD_SELECT = 'id,order_number,status,order_date,requested_ship_date,factory:companies!factory_company_id(name),client:companies!client_company_id(name),purchase_order_items(description,products(name))';

function OrderCard({ p, navigate, onStatus }){
  const client = poClient(p), factory = poFactory(p);
  const name = client || factory || '—';
  return (
    <div className="order-card">
      <div className="oc-top" onClick={()=>navigate('order-detail',{id:p.id})}>
        <span className="oc-num mono">{p.order_number||'—'}</span>
        <Badge status={p.status} />
      </div>
      <div className="oc-factory" onClick={()=>navigate('order-detail',{id:p.id})}>
        <span className="oc-avatar" style={{background:companyColor(name)}}>{initials(name)}</span>
        <span style={{display:'flex',flexDirection:'column',minWidth:0}}>
          <span style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{name}</span>
          {client && factory && <span style={{fontSize:'11px',color:'var(--muted)',fontWeight:400}}>{factory}</span>}
        </span>
      </div>
      <div className="oc-foot">
        <span className="oc-date">{fmtDate(p.order_date)}</span>
        {onStatus
          ? <select className="oc-status" value={p.status} onChange={e=>onStatus(p.id,e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select>
          : <span className="oc-date">{fmtDate(p.requested_ship_date)}</span>}
      </div>
    </div>
  );
}

// ── PO toolbar (search + client chips + status chips), shared UI ────────────────
function PoToolbar({ rows, search, setSearch, client, setClient, status, setStatus }){
  const clients = distinctClients(rows);
  return (
    <div className="po-toolbar">
      <input className="po-search" placeholder="Search PO #, client, or product…" value={search} onChange={e=>setSearch(e.target.value)} />
      <div className="filters">
        <button className={`filter-btn ${client==='all'?'active':''}`} onClick={()=>setClient('all')}>All Clients</button>
        {clients.map(([c,n])=>(
          <button key={c} className={`filter-btn ${client===c?'active':''}`} onClick={()=>setClient(c)}>
            <span className="chip-dot" style={{background:companyColor(c)}} />{c} <span className="chip-n">{n}</span>
          </button>
        ))}
      </div>
      <div className="filters">
        {['all',...STATUSES].map(s=>(
          <button key={s} className={`filter-btn ${status===s?'active':''}`} onClick={()=>setStatus(s)}>{s.replace(/_/g,' ')}</button>
        ))}
      </div>
    </div>
  );
}


// ── Icons (inline SVG, 1.6px stroke) ─────────────────────────────────────────
const Ic = {
  dashboard:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  orders:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  companies:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg>,
  products:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>,
  shipments:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>,
  quotes:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5h3.5a1.5 1.5 0 0 0 0-3h-2a1.5 1.5 0 0 1 0-3H14"/></svg>,
  settings:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
};

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ page, navigate, user, open }) {
  const links = [
    { id:'dashboard', label:'Dashboard' },
    { id:'orders',    label:'Purchase Orders' },
    { id:'companies', label:'Companies' },
    { id:'products',  label:'Products' },
    { id:'shipments', label:'Shipments' },
    { id:'quotes',    label:'Quotes' },
  ];
  return (
    <aside className={`sidebar ${open?'sidebar--open':''}`}>
      <div className="sb-brand">
        <img className="sb-logo-img" src={LOGO_WHITE} alt="King Universal" />
      </div>
      <div className="sb-scroll">
        <div className="sb-section">Workspace</div>
        {links.map(l => (
          <button key={l.id} className={`nav-link ${page===l.id||page==='order-detail'&&l.id==='orders'?'active':''}`} onClick={()=>navigate(l.id)}>
            <span className="ic">{Ic[l.id]}</span> {l.label}
          </button>
        ))}
      </div>
      <button className={`nav-link sb-settings ${page==='settings'?'active':''}`} onClick={()=>navigate('settings')}>
        <span className="ic">{Ic.settings}</span> KUI Settings
      </button>
      <div className="sb-user">
        <span className="sb-email">{user?.email}</span>
        <button className="btn-signout" onClick={()=>SB.auth.signOut()}>Sign Out</button>
      </div>
    </aside>
  );
}

// ── Login ────────────────────────────────────────────────────────────────────
function Login() {
  const [email, setEmail] = useState('');
  const [pass,  setPass]  = useState('');
  const [err,   setErr]   = useState('');
  const submit = async () => {
    setErr('');
    const { error } = await SB.auth.signInWithPassword({ email, password: pass });
    if (error) setErr(error.message);
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-mark">
          <img className="login-logo-img" src="/logo.png" alt="King Universal" />
        </div>
        <div className="login-sub">Operations Platform · Sign in</div>
        <input className="login-field" type="email" placeholder="Work email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} />
        <input className="login-field" type="password" placeholder="Password" value={pass} onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==='Enter'&&submit()} />
        <button className="btn-login" onClick={submit}>Sign In</button>
        <div className="login-error">{err}</div>
      </div>
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ navigate }) {
  const [stats, setStats] = useState({active:0,prod:0,rts:0,clients:0});
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('all');
  const [status, setStatusFilter] = useState('all');
  useEffect(() => {
    (async () => {
      const [{ data: pos }, { data: cos }, { data: rec }] = await Promise.all([
        SB.from('purchase_orders').select('status'),
        SB.from('companies').select('type'),
        SB.from('purchase_orders').select(PO_CARD_SELECT).order('created_at',{ascending:false}).limit(60)
      ]);
      setStats({
        active:(pos||[]).filter(p=>!['closed','cancelled'].includes(p.status)).length,
        prod:(pos||[]).filter(p=>p.status==='in_production').length,
        rts:(pos||[]).filter(p=>p.status==='ready_to_ship').length,
        clients:(cos||[]).filter(c=>c.type==='client').length
      });
      setRecent(rec||[]);
      setLoading(false);
    })();
  },[]);
  if (loading) return <div className="loading">Loading...</div>;
  const setStatus = async (pid, st) => {
    await SB.from('purchase_orders').update({status:st,updated_at:new Date().toISOString()}).eq('id',pid);
    setRecent(prev=>prev.map(p=>p.id===pid?{...p,status:st}:p));
  };
  const shown = filterPOs(recent,{search,client,status});
  return (
    <>
      <div className="stats-grid">
        {[['Active Orders',stats.active],['In Production',stats.prod],['Ready to Ship',stats.rts],['Clients',stats.clients]].map(([l,v])=>(
          <div key={l} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value">{v}</div></div>
        ))}
      </div>
      <div className="section-head" style={{padding:'0 2px 12px'}}><h3 style={{fontSize:'17px'}}>Orders</h3><button className="btn btn-ghost btn-sm" onClick={()=>navigate('orders')}>View all →</button></div>
      <PoToolbar rows={recent} search={search} setSearch={setSearch} client={client} setClient={setClient} status={status} setStatus={setStatusFilter} />
      {shown.length ? (
        <div className="order-card-grid">
          {shown.map(p=><OrderCard key={p.id} p={p} navigate={navigate} onStatus={setStatus} />)}
        </div>
      ) : <div className="section-card"><div className="empty"><h3>No orders match</h3><p>Try clearing the search or filters.</p></div></div>}
    </>
  );
}

// ── KUI Settings ──────────────────────────────────────────────────────────────
function KuiSettings() {
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(()=>{
    SB.from('kui_settings').select('*').eq('id',1).single().then(({data})=>{
      setForm(data || { id:1, company_name:'', address:'', contact_name:'', email:'', phone:'', office_phone:'', ach_info:'' });
    });
  },[]);
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const save = async () => {
    setSaving(true);
    const { error } = await SB.from('kui_settings').upsert({ ...form, id:1, updated_at:new Date().toISOString() });
    setSaving(false);
    setMsg(error ? 'Error: '+error.message : 'Saved.'); setTimeout(()=>setMsg(''),2500);
  };
  if (!form) return <div className="loading">Loading...</div>;
  const fields = [['Company name','company_name','King Universal Inc.'],['Contact name','contact_name',''],['Email','email',''],['Phone','phone',''],['Office phone','office_phone','']];
  return (
    <>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Company Info</h3><span style={{fontSize:'11px',color:'var(--muted)'}}>Used on documents sent to clients</span></div>
        <div className="logi-grid">
          {fields.map(([lab,k,ph])=>(
            <div key={k} className="logi-field"><label>{lab}</label><input className="form-input" value={form[k]||''} placeholder={ph} onChange={e=>f(k)(e.target.value)} /></div>
          ))}
          <div className="logi-field" style={{gridColumn:'1 / -1'}}><label>Address</label><textarea className="form-input" rows={2} value={form.address||''} onChange={e=>f('address')(e.target.value)} /></div>
        </div>
      </div>
      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>ACH / Wire Information</h3><span style={{fontSize:'11px',color:'var(--muted)'}}>Auto-fills the bottom of client quote sheets</span></div>
        <div style={{padding:'18px'}}>
          <label style={{display:'block',fontSize:'11px',letterSpacing:'.04em',textTransform:'uppercase',color:'var(--muted)',marginBottom:'5px'}}>Bank / payment details</label>
          <textarea className="form-input" rows={7} value={form.ach_info||''} placeholder={"Bank name:\nBeneficiary:\nAccount #:\nRouting / ABA:\nSWIFT:\nBank address:"} onChange={e=>f('ach_info')(e.target.value)} />
          <p style={{fontSize:'12px',color:'var(--muted)',marginTop:'8px'}}>Leave blank for now if you don't have it — the client sheet just won't show a payment block until this is filled in.</p>
        </div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:'14px'}}>
        <button className="btn btn-dark" onClick={save} disabled={saving}>{saving?'Saving…':'Save settings'}</button>
        {msg && <span style={{fontSize:'13px',color:'var(--accent)'}}>{msg}</span>}
      </div>
    </>
  );
}

// ── Orders List ───────────────────────────────────────────────────────────────
function Orders({ navigate }) {
  const [rows, setRows]     = useState([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('all');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await SB.from('purchase_orders').select(PO_CARD_SELECT).order('created_at',{ascending:false});
    setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  const setStat = async (pid, st) => {
    await SB.from('purchase_orders').update({status:st,updated_at:new Date().toISOString()}).eq('id',pid);
    setRows(prev=>prev.map(p=>p.id===pid?{...p,status:st}:p));
  };
  const shown = filterPOs(rows,{search,client,status});
  return (
    <>
      <PoToolbar rows={rows} search={search} setSearch={setSearch} client={client} setClient={setClient} status={status} setStatus={setStatus} />
      {loading ? <div className="loading">Loading...</div> : shown.length ? (
        <div className="order-card-grid">
          {shown.map(p=><OrderCard key={p.id} p={p} navigate={navigate} onStatus={setStat} />)}
        </div>
      ) : <div className="section-card"><div className="empty"><h3>No orders</h3><p>No purchase orders match your search or filters.</p></div></div>}
    </>
  );
}

// ── Order Detail ──────────────────────────────────────────────────────────────
function OrderDetail({ id, navigate }) {
  const [po, setPO]       = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [ship, setShip]   = useState(null);
  const [logi, setLogi]   = useState({});
  const [savingLogi, setSavingLogi] = useState(false);
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState('');
  const [noteMsg, setNoteMsg]   = useState('');
  const [posting, setPosting]   = useState(false);
  const load = async () => {
    const [{ data: p },{ data: its }] = await Promise.all([
      SB.from('purchase_orders').select('*,companies!factory_company_id(name,email),client:companies!client_company_id(name,vendor_number)').eq('id',id).single(),
      SB.from('purchase_order_items').select('*,products(sku,name)').eq('purchase_order_id',id)
    ]);
    setPO(p); setItems(its||[]);
    // linked shipment (first one), if any
    const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
    let sh = null;
    if (links && links.length) {
      const { data: s } = await SB.from('shipments').select('*').eq('id',links[0].shipment_id).single();
      sh = s;
    }
    setShip(sh);
    setLogi({
      vessel_name: sh?.vessel_name||'', container_no: sh?.container_no||'', booking_number: sh?.booking_number||'',
      bill_of_lading: sh?.bill_of_lading||'', voyage_no: sh?.voyage_no||'',
      etd: sh?.estimated_departure ? sh.estimated_departure.slice(0,10) : '',
      eta: sh?.estimated_arrival ? sh.estimated_arrival.slice(0,10) : '',
    });
    // order notes
    const { data: ns } = await SB.from('order_notes').select('*').eq('purchase_order_id',id).order('created_at',{ascending:false});
    setNotes(ns||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[id]);
  const updateStatus = async (status) => {
    await SB.from('purchase_orders').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    setPO(prev=>({...prev,status}));
    if (status === 'shipped') {
      const created = await ensureShipmentForPO();
      if (created) alert('A shipment was created for this PO. You can find it in the Shipments tab.');
    }
  };
  // Turn this PO into a shipment (once). Returns true if a new shipment was made.
  const ensureShipmentForPO = async () => {
    try {
      const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
      if (links && links.length) return false; // already linked to a shipment
      const base = (po?.order_number || id.slice(0,8)).toString().replace(/^PO[-\s]?/i,'');
      const num  = `SHP-${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const { data: ship, error: sErr } = await SB.from('shipments').insert({
        shipment_number: num,
        status: 'in_transit',
        inco_term: po?.incoterm || null,
        estimated_departure: new Date().toISOString(),
      }).select('id').single();
      if (sErr || !ship) { console.error('shipment create failed', sErr); return false; }
      await SB.from('shipment_pos').insert({ shipment_id: ship.id, purchase_order_id: id });
      return true;
    } catch(e){ console.error(e); return false; }
  };
  // Find this PO's shipment, creating+linking one if it doesn't exist yet.
  const getOrCreateShipmentId = async () => {
    if (ship?.id) return ship.id;
    const { data: links } = await SB.from('shipment_pos').select('shipment_id').eq('purchase_order_id',id).limit(1);
    if (links && links.length) return links[0].shipment_id;
    const base = (po?.order_number || id.slice(0,8)).toString().replace(/^PO[-\s]?/i,'');
    const num  = `SHP-${base}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    const { data: s } = await SB.from('shipments').insert({ shipment_number:num, status:'created', inco_term:po?.incoterm||null }).select().single();
    if (!s) return null;
    await SB.from('shipment_pos').insert({ shipment_id:s.id, purchase_order_id:id });
    setShip(s);
    return s.id;
  };
  const setLg = k => v => setLogi(prev=>({...prev,[k]:v}));
  const saveLogistics = async () => {
    setSavingLogi(true);
    const sid = await getOrCreateShipmentId();
    if (!sid){ setSavingLogi(false); alert('Could not save logistics.'); return; }
    const upd = {
      vessel_name: logi.vessel_name||null, container_no: logi.container_no||null, voyage_no: logi.voyage_no||null,
      booking_number: logi.booking_number||null, bill_of_lading: logi.bill_of_lading||null,
      estimated_departure: logi.etd ? new Date(logi.etd+'T12:00:00').toISOString() : null,
      estimated_arrival:   logi.eta ? new Date(logi.eta+'T12:00:00').toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { data: s, error } = await SB.from('shipments').update(upd).eq('id',sid).select().single();
    setSavingLogi(false);
    if (error){ alert('Error saving logistics: '+error.message); return; }
    setShip(s);
    setNoteMsg('Logistics saved.'); setTimeout(()=>setNoteMsg(''),2500);
  };
  const postNote = async () => {
    const body = (noteText||'').trim(); if(!body) return;
    setPosting(true);
    let author=null; try{ const { data } = await SB.auth.getUser(); author=data?.user?.email||null; }catch(e){}
    const { data:n, error } = await SB.from('order_notes').insert({ purchase_order_id:id, body, author_email:author }).select().single();
    if (error){ setPosting(false); alert('Couldn\u2019t post note: '+error.message); return; }
    setNotes(prev=>[n,...prev]); setNoteText('');
    try {
      const whoName = author ? author.split('@')[0] : 'Someone';
      const recipients = TEAM.map(t=>t.email).filter(e=>e!==author);
      const e = (s)=>String(s??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      const html = `
        <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px">
          <p style="font-size:13px;color:#64748b;margin:0 0 4px">New note on order <strong style="color:#0b1120">${e(po?.order_number||'')}</strong>${po?.companies?.name?` &middot; ${e(po.companies.name)}`:''}</p>
          <div style="background:#f6f8fb;border:1px solid #e6eaf0;border-radius:10px;padding:16px 18px;margin:10px 0 16px">
            <p style="margin:0;font-size:15px;color:#0b1120;line-height:1.55">${e(body)}</p>
          </div>
          <p style="font-size:12px;color:#94a3b8;margin:0 0 16px">Posted by ${e(whoName)}</p>
          <a href="https://orders.vessl.io" style="display:inline-block;background:#0b1530;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open in Vessl &rarr;</a>
        </div>`;
      if (recipients.length){
        const { error:mailErr } = await SB.functions.invoke('send-email',{ body:{ to:recipients, replyTo:author||undefined, subject:`Order note \u00b7 ${po?.order_number||''}`, html } });
        setNoteMsg(mailErr ? 'Note posted (email skipped).' : 'Note posted & team notified.');
      } else setNoteMsg('Note posted.');
    } catch(e){ setNoteMsg('Note posted (email skipped).'); }
    setTimeout(()=>setNoteMsg(''),3000);
    setPosting(false);
  };
  const deletePO = async () => {
    if(!confirm('Delete this purchase order and all its line items? This cannot be undone.')) return;
    await SB.from('purchase_order_items').delete().eq('purchase_order_id',id);
    const { error } = await SB.from('purchase_orders').delete().eq('id',id);
    if(error){alert('Error deleting: '+error.message);return;}
    navigate('orders');
  };
  const genPO = async () => {
    // Open the window SYNCHRONOUSLY, before any await — otherwise iPad/Safari
    // treats it as a non-user-gesture popup and blocks it (button "does nothing").
    const win = window.open('', '_blank');
    if (win) {
      win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating PO…</body>');
    }
    const { data, error } = await SB.rpc('po_document_json',{p_po_id:id});
    if (error||!data){ if(win) win.close(); alert('Error: '+(error?.message||'No data')); return; }
    const html = buildPODoc(data, { pallet: po?.pallet_info });
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
      setTimeout(()=>{ try{ win.focus(); win.print(); }catch(e){} }, 600);
    } else {
      // Popup was blocked anyway — fall back to downloading the PO as a file.
      const url = URL.createObjectURL(new Blob([html],{type:'text/html'}));
      const a = document.createElement('a');
      a.href = url; a.download = `PO-${po?.order_number||id}.html`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 4000);
    }
  };
  if (loading) return <div className="loading">Loading...</div>;
  if (!po) return <div className="empty"><h3>Order not found</h3></div>;
  const subtotal = items.reduce((a,i)=>a+(Number(i.quantity)*Number(i.unit_price)),0);
  const mold = Number(po.mold_fee||0);
  const grand = subtotal+mold;
  const dep = po.deposit_percent ? grand*(po.deposit_percent/100) : null;
  return (
    <>
      <div style={{display:'flex',gap:'10px',marginBottom:'20px',flexWrap:'wrap'}}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('orders')}>← Back</button>
        <button className="btn btn-dark btn-sm" onClick={genPO}>Generate PO PDF</button>
        <div style={{flex:1}} />
        <button className="btn btn-ghost btn-sm" onClick={()=>setEditing(true)}>Edit</button>
        <button className="btn btn-ghost btn-sm" style={{color:'var(--hot)'}} onClick={deletePO}>Delete</button>
      </div>
      {editing && <PoEditModal po={po} items={items} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);load();}} />}
      <div className="detail-grid">
        <div className="detail-block">
          <div className="blabel">Factory</div>
          <div className="bval">{po.companies?.name||'—'}</div>
          <div className="bsub">{po.companies?.email||''}</div>
          {po.client?.name && <div style={{marginTop:'10px',paddingTop:'10px',borderTop:'1px solid var(--line)'}}><div style={{color:'var(--muted)',fontSize:'11px',marginBottom:'2px'}}>CLIENT</div><div style={{fontSize:'13px',fontWeight:500}}>{po.client.name}</div>{po.client.vendor_number && <div style={{fontSize:'11.5px',color:'var(--muted)'}}>Vendor # {po.client.vendor_number} · internal</div>}</div>}
          {po.pallet_info && <div style={{marginTop:'10px',fontSize:'12px',color:'var(--muted)'}}><span style={{textTransform:'uppercase',fontSize:'10px'}}>Pallet</span> · {po.pallet_info}</div>}
        </div>
        <div className="detail-block">
          <div className="blabel">Order Details</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px',fontSize:'13px'}}>
            {[['ORDER DATE',fmtDate(po.order_date)],['SHIP BY',fmtDate(po.requested_ship_date)],['INCOTERM',po.incoterm||'—'],['PAYMENT',po.payment_terms||'—']].map(([l,v])=>(
              <div key={l}><div style={{color:'var(--muted)',fontSize:'11px',marginBottom:'3px'}}>{l}</div>{v}</div>
            ))}
          </div>
        </div>
      </div>
      <div className="detail-block" style={{marginBottom:'20px'}}>
        <div className="blabel">Status &mdash; tap to change</div>
        <div className="status-pills">
          {STATUSES.map(s=>(
            <button key={s} className={`status-pill ${po.status===s?'on':''} sp-${s}`} onClick={()=>updateStatus(s)}>{s.replace(/_/g,' ')}</button>
          ))}
        </div>
        {po.notes && <div style={{marginTop:'12px',fontSize:'12.5px',color:'var(--muted)',paddingTop:'12px',borderTop:'1px solid var(--line)'}}>{po.notes}</div>}
      </div>

      <div className="section-card" style={{marginBottom:'20px'}}>
        <div className="section-head"><h3>Logistics</h3>{ship?.shipment_number && <span className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>{ship.shipment_number}</span>}</div>
        <div className="logi-grid">
          {[['Vessel / Boat','vessel_name','e.g. MAERSK SELETAR'],['Container #','container_no','e.g. MSKU1234567'],['Voyage #','voyage_no','e.g. 084W'],['Booking #','booking_number',''],['Bill of Lading','bill_of_lading','']].map(([lab,k,ph])=>(
            <div key={k} className="logi-field"><label>{lab}</label><input className="form-input" value={logi[k]||''} placeholder={ph} onChange={e=>setLg(k)(e.target.value)} /></div>
          ))}
          <div className="logi-field"><label>ETD</label><input type="date" className="form-input" value={logi.etd||''} onChange={e=>setLg('etd')(e.target.value)} /></div>
          <div className="logi-field"><label>ETA</label><input type="date" className="form-input" value={logi.eta||''} onChange={e=>setLg('eta')(e.target.value)} /></div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:'12px',padding:'0 18px 16px'}}>
          <button className="btn btn-dark btn-sm" onClick={saveLogistics} disabled={savingLogi}>{savingLogi?'Saving…':'Save logistics'}</button>
          {!ship && <span style={{fontSize:'12px',color:'var(--muted)'}}>Saving will create a shipment for this PO.</span>}
        </div>
      </div>
      <div className="section-card">
        <div className="section-head"><h3>Line Items</h3></div>
        {items.length ? (
          <table className="data-table">
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
            <tbody>
              {items.map(it=>(
                <tr key={it.id}>
                  <td><div style={{fontWeight:500}}>{it.products?.name||it.description||'—'}</div><div className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>{it.products?.sku||''}</div>{it.carton_info&&<div style={{fontSize:'11px',color:'var(--muted)',marginTop:'2px'}}>{it.carton_info}</div>}</td>
                  <td className="mono">{fmtNum(it.quantity)}</td>
                  <td className="mono">{money(it.unit_price,po.currency)}{it.ci_value?<div style={{fontSize:'10px',color:'var(--muted)'}}>CI: {money(it.ci_value,po.currency)}</div>:null}</td>
                  <td className="mono">{money(Number(it.quantity)*Number(it.unit_price),po.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No items</h3></div>}
        <div className="totals-block">
          <div className="total-row"><span className="k">Goods subtotal</span><span className="v">{money(subtotal,po.currency)}</span></div>
          {mold>0 && <div className="total-row"><span className="k">Tooling / mold</span><span className="v">{money(mold,po.currency)}</span></div>}
          {po.sample_fee>0 && <div className="total-row" style={{opacity:.6,fontStyle:'italic'}}><span className="k">Sample fee (sep.)</span><span className="v">{money(po.sample_fee,po.currency)}</span></div>}
          <div className="total-grand"><span>Total {po.currency||'USD'}</span><span className="mono">{money(grand,po.currency)}</span></div>
          {dep && <div className="total-row" style={{marginTop:'4px'}}><span className="k">{po.deposit_percent}% deposit</span><span className="v">{money(dep,po.currency)}</span></div>}
        </div>
      </div>

      <div className="section-card" style={{marginTop:'20px'}}>
        <div className="section-head"><h3>Notes &amp; Activity</h3><span style={{fontSize:'11px',color:'var(--muted)'}}>Posting notifies the team</span></div>
        <div className="note-composer">
          <textarea className="form-input" rows={3} placeholder="Add a note about this order — updates, issues, decisions…" value={noteText} onChange={e=>setNoteText(e.target.value)} />
          <div style={{display:'flex',alignItems:'center',gap:'12px',marginTop:'10px'}}>
            <button className="btn btn-dark btn-sm" onClick={postNote} disabled={posting||!noteText.trim()}>{posting?'Posting…':'Post & notify team'}</button>
            {noteMsg && <span style={{fontSize:'12.5px',color:'var(--accent)'}}>{noteMsg}</span>}
          </div>
        </div>
        <div className="note-list">
          {notes.length ? notes.map(n=>(
            <div key={n.id} className="note-item">
              <div className="note-avatar" style={{background:companyColor(n.author_email||'?')}}>{initials(n.author_email||'?')}</div>
              <div style={{flex:1,minWidth:0}}>
                <div className="note-body">{n.body}</div>
                <div className="note-meta">{(n.author_email||'unknown').split('@')[0]} · {fmtDateTime(n.created_at)}</div>
              </div>
            </div>
          )) : <div style={{padding:'8px 18px 18px',fontSize:'13px',color:'var(--muted)'}}>No notes yet.</div>}
        </div>
      </div>
    </>
  );
}

// ── PO Edit Modal ───────────────────────────────────────────────────────────
function PoEditModal({ po, items:initialItems, onClose, onSaved }) {
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState({
    num:po.order_number||'', date:po.order_date||'', ship:po.requested_ship_date||'',
    inco:po.incoterm||'', pay:po.payment_terms||'', dep:po.deposit_percent!=null?String(po.deposit_percent):'',
    mold:po.mold_fee!=null?String(po.mold_fee):'', sample:po.sample_fee!=null?String(po.sample_fee):'',
    currency:po.currency||'USD', notes:po.notes||'', status:po.status||'draft', pallet:po.pallet_info||''
  });
  const [items, setItems] = useState((initialItems||[]).map(it=>({id:it.id,prodId:it.product_id||'',desc:it.description||it.products?.name||'',qty:it.quantity!=null?String(it.quantity):'',price:it.unit_price!=null?String(it.unit_price):'',ci:it.ci_value!=null?String(it.ci_value):'',carton:it.carton_info||''})));
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  useEffect(()=>{ SB.from('products').select('id,sku,name').order('name').then(({data})=>setProducts(data||[])); },[]);
  const setItem=(i,k,v)=>setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const addItem=()=>setItems(prev=>[...prev,{id:null,prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);
  const rmItem =i=>setItems(prev=>prev.filter((_,idx)=>idx!==i));
  const [products, setProducts] = useState([]);
  const [recentDescs, setRecentDescs] = useState([]);
  const [eSrchIdx, setESrchIdx] = useState(-1);
  const [eSrchHits, setESrchHits] = useState([]);
  const [eSrchRect, setESrchRect] = useState(null);
  useEffect(()=>{
    Promise.all([
      SB.from('products').select('id,sku,name').order('name'),
      SB.from('purchase_order_items').select('description').not('description','is',null).limit(200)
    ]).then(([{data:pro},{data:itmD}])=>{
      setProducts(pro||[]);
      setRecentDescs([...new Set((itmD||[]).map(it=>it.description||'').filter(Boolean))]);
    });
  },[]);
  const handleEProdInput = (i,v,el) => {
    setItem(i,'desc',v);
    if(v.trim().length>0){
      const lv=v.toLowerCase();
      const cat=(products||[]).filter(p=>(p.name||'').toLowerCase().includes(lv)||(p.sku||'').toLowerCase().includes(lv)).map(p=>({id:p.id,name:p.name,sku:p.sku||'',recent:false}));
      const rec=recentDescs.filter(d=>d.toLowerCase().includes(lv)&&!cat.some(c=>c.name===d)).slice(0,5).map(d=>({id:null,name:d,sku:'',recent:true}));
      const h=[...cat,...rec].slice(0,8);
      setESrchHits(h); setESrchIdx(i);
      if(el){const r=el.getBoundingClientRect();setESrchRect({top:r.bottom+2,left:r.left,w:Math.max(r.width,240)});}
    } else { setESrchIdx(-1); setESrchHits([]); setESrchRect(null); }
  };
  const pickEProd = (i,p) => { setItem(i,'desc',p.name); setItem(i,'prodId',p.id||''); setESrchIdx(-1); setESrchHits([]); setESrchRect(null); };
  const save = async () => {
    if(!form.num){alert('PO number required');return;}
    const { error } = await SB.from('purchase_orders').update({
      order_number:form.num, order_date:form.date||null, requested_ship_date:form.ship||null,
      incoterm:form.inco||null, payment_terms:form.pay||null, deposit_percent:Number(form.dep)||null,
      mold_fee:Number(form.mold)||0, sample_fee:Number(form.sample)||0, currency:form.currency,
      notes:form.notes||null, status:form.status, pallet_info:form.pallet||null, updated_at:new Date().toISOString()
    }).eq('id',po.id);
    if(error){alert('Error: '+error.message);return;}
    // replace line items: delete all, re-insert the valid ones
    await SB.from('purchase_order_items').delete().eq('purchase_order_id',po.id);
    for(const it of items){
      const hasDesc=(it.desc||'').trim();
      if(!(it.prodId||hasDesc) || !(Number(it.qty)>0)) continue;
      const base={purchase_order_id:po.id,product_id:it.prodId||null,quantity:Number(it.qty),unit_price:Number(it.price)||0,currency:form.currency,ci_value:Number(it.ci)||null,carton_info:it.carton||null};
      let { error:e1 } = await SB.from('purchase_order_items').insert({...base,description:hasDesc||null});
      if(e1 && /description/i.test(e1.message)) await SB.from('purchase_order_items').insert(base);
    }
    onSaved();
  };
  return (
    <>
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box modal-lg">
        <div className="modal-head"><h3>Edit Purchase Order</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>PO Number *</label><input className="form-input" value={form.num} onChange={e=>f('num')(e.target.value)} /></div>
            <div><label>Status</label><select className="form-select" value={form.status} onChange={e=>f('status')(e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
            <div><label>Ship By</label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Incoterm</label><input className="form-input" value={form.inco} onChange={e=>f('inco')(e.target.value)} /></div>
            <div><label>Payment Terms</label><input className="form-input" value={form.pay} onChange={e=>f('pay')(e.target.value)} /></div>
          </div>
          <span className="form-section-label">Line Items</span>
          <table className="items-table">
            <thead><tr><th style={{width:'40%'}}>Product</th><th>Qty</th><th>Unit Price</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <React.Fragment key={i}>
                  <tr>
                    <td>
                      <div style={{position:'relative'}}>
                        <input value={it.desc} onChange={e=>handleEProdInput(i,e.target.value,e.target)} onBlur={()=>setTimeout(()=>{setESrchIdx(-1);setESrchHits([]);setESrchRect(null);},200)} placeholder="Type to search products…" />
                        {eSrchIdx===i && eSrchHits.length>0 && (
                          <div className="prod-suggestions">
                            {eSrchHits.map(p=>(
                              <div key={p.id} className="prod-sugg-item" onMouseDown={()=>pickEProd(i,p)}>
                                <span style={{fontWeight:600}}>{p.name}</span>{p.sku&&<span style={{fontSize:'11px',color:'var(--muted)',marginLeft:'8px'}}>{p.sku}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </td>
                    <td><input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} placeholder="0" /></td>
                    <td><input type="number" step="0.01" value={it.price} onChange={e=>setItem(i,'price',e.target.value)} placeholder="0.00" /></td>
                    <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                  </tr>
                  <tr className="item-sub-row">
                    <td colSpan={4}>
                      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',padding:'4px 0 8px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>CI Value ($)</span><input type="number" step="0.01" className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.ci||''} onChange={e=>setItem(i,'ci',e.target.value)} placeholder="0.00" /></div>
                        <div style={{display:'flex',flexDirection:'column',flex:'1 1 180px'}}><span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>Carton info</span><input className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.carton||''} onChange={e=>setItem(i,'carton',e.target.value)} placeholder="e.g. 12 pcs/ctn, 60×40×30 cm, 11 kg" /></div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'16px'}} onClick={addItem}>+ Add Item</button>
          <span className="form-section-label">Fees & Currency</span>
          <div className="form-row-3">
            <div><label>Mold / Tooling</label><input type="number" className="form-input" value={form.mold} onChange={e=>f('mold')(e.target.value)} /></div>
            <div><label>Sample Fee</label><input type="number" className="form-input" value={form.sample} onChange={e=>f('sample')(e.target.value)} /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}><option>USD</option><option>CNY</option><option>VND</option><option>EUR</option></select></div>
          </div>
          <div className="form-row"><label>Pallet instructions <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prints on the factory PO)</span></label><input className="form-input" value={form.pallet} onChange={e=>f('pallet')(e.target.value)} /></div>
          <div className="form-row"><label>Notes</label><textarea className="form-textarea" value={form.notes} onChange={e=>f('notes')(e.target.value)} /></div>
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={save}>Save Changes</button>
        </div>
      </div>
    </div>
    {eSrchIdx>=0 && eSrchHits.length>0 && eSrchRect && typeof window!=='undefined' && createPortal(
      <div style={{position:'fixed',top:eSrchRect.top,left:eSrchRect.left,width:eSrchRect.w,background:'#fff',border:'1px solid #e2e8f0',borderRadius:'10px',boxShadow:'0 8px 24px rgba(0,0,0,.16)',zIndex:99999,maxHeight:'220px',overflowY:'auto'}}>
        {eSrchHits.map(p=>(
          <div key={p.id||p.name} style={{padding:'10px 14px',fontSize:'13px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}} onMouseDown={()=>pickEProd(eSrchIdx,p)}>
            <span style={{fontWeight:600,color:'#0b1120'}}>{p.name}</span>
            <span style={{fontSize:'11px',color:'#94a3b8'}}>{p.sku||''}{p.recent?' recent':''}</span>
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  );
}

// ── Companies ────────────────────────────────────────────────────────────────
function Companies() {
  const types = ['client','factory','carrier','freight_forwarder'];
  const [tab, setTab]   = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [openId, setOpenId] = useState(null);
  const load = async () => {
    setLoading(true);
    const { data } = await SB.from('companies').select('*,contacts(full_name,email,phone,is_primary)').eq('type',types[tab]).order('name');
    setRows(data||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[tab]);
  return (
    <>
      <div className="tabs">
        {types.map((t,i)=><button key={t} className={`tab ${i===tab?'active':''}`} onClick={()=>setTab(i)}>{t.replace(/_/g,' ')}</button>)}
      </div>
      <div className="section-card">
        {loading ? <div className="loading">Loading...</div> : rows.length ? (
          <table className="data-table">
            <thead><tr><th>Company</th><th>Type</th><th>Contact</th><th>Email</th></tr></thead>
            <tbody>
              {rows.map(c=>{
                const p=(c.contacts||[]).find(x=>x.is_primary)||(c.contacts||[])[0]||{};
                return <tr key={c.id} onClick={()=>setOpenId(c.id)}>
                  <td><div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{width:'26px',height:'26px',borderRadius:'7px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'10px',fontWeight:600,fontFamily:'var(--mono)',color:'#0b1120',background:companyColor(c.name)}}>{initials(c.name)}</span>
                    <span style={{fontWeight:500}}>{c.name}</span>
                  </div></td>
                  <td><Badge status={c.type} /></td>
                  <td>{p.full_name||'—'}</td>
                  <td>{p.email||'—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No {types[tab].replace(/_/g,' ')}s yet</h3><p>Add your first to get started.</p></div>}
      </div>
      {showCreate && <CreateCompanyModal onClose={()=>setShowCreate(false)} onCreated={()=>{setShowCreate(false);load();}} />}
      {openId && <CompanyDetailModal id={openId} onClose={()=>setOpenId(null)} onSaved={()=>{setOpenId(null);load();}} />}
    </>
  );
}

// ── Company Detail + Edit ──────────────────────────────────────────────────────
function CompanyDetailModal({ id, onClose, onSaved }) {
  const [co, setCo] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState(null);
  const types = ['client','factory','carrier','freight_forwarder'];
  useEffect(()=>{
    (async()=>{
      const { data:c } = await SB.from('companies').select('*').eq('id',id).single();
      const { data:cc } = await SB.from('contacts').select('*').eq('company_id',id).order('is_primary',{ascending:false});
      setCo(c); setContacts(cc||[]);
      setForm({ name:c?.name||'', type:c?.type||'client', email:c?.email||'', phone:c?.phone||'', website:c?.website||'', vendor_number:c?.vendor_number||'', pallet_info:c?.pallet_info||'' });
    })();
  },[id]);
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const setC = (i,k,v) => setContacts(prev=>prev.map((c,idx)=>idx===i?{...c,[k]:v}:c));
  const addContact = () => setContacts(prev=>[...prev,{__new:true,company_id:id,full_name:'',email:'',phone:'',is_primary:prev.length===0}]);
  const save = async () => {
    if(!form.name){alert('Name required');return;}
    await SB.from('companies').update({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null}).eq('id',id);
    for(const c of contacts){
      if(!(c.full_name||'').trim()) continue;
      if(c.__new) await SB.from('contacts').insert({company_id:id,full_name:c.full_name,email:c.email||null,phone:c.phone||null,is_primary:!!c.is_primary});
      else await SB.from('contacts').update({full_name:c.full_name,email:c.email||null,phone:c.phone||null,is_primary:!!c.is_primary}).eq('id',c.id);
    }
    onSaved();
  };
  if(!co||!form) return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}><div className="modal-box"><div className="modal-body"><div className="loading">Loading…</div></div></div></div>
  );
  const col = companyColor(co.name);
  return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box">
        <div className="modal-head" style={{gap:'12px'}}>
          <div style={{display:'flex',alignItems:'center',gap:'12px',minWidth:0}}>
            <span style={{width:'34px',height:'34px',borderRadius:'9px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'12px',fontWeight:600,fontFamily:'var(--mono)',color:'#0b1120',background:col}}>{initials(co.name)}</span>
            <h3 style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{co.name}</h3>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          {!edit ? (
            <>
              <div style={{display:'flex',gap:'8px',marginBottom:'18px'}}><Badge status={co.type} /></div>
              <div className="detail-grid" style={{gridTemplateColumns:'1fr',gap:'0'}}>
                {[['Email',co.email],['Phone',co.phone],['Website',co.website],...(co.type==='client'?[['Vendor #',co.vendor_number],['Pallet info',co.pallet_info]]:[])].map(([l,v])=>(
                  <div key={l} style={{display:'flex',justifyContent:'space-between',gap:'16px',padding:'11px 0',borderBottom:'1px solid var(--line-2)'}}>
                    <span style={{color:'var(--muted)',fontSize:'12px',whiteSpace:'nowrap'}}>{l}</span><span style={{fontSize:'13px',textAlign:'right',whiteSpace:'pre-wrap'}}>{v||'—'}</span>
                  </div>
                ))}
              </div>
              <span className="form-section-label">Contacts</span>
              {contacts.length? contacts.map((c,i)=>(
                <div key={i} style={{padding:'10px 0',borderBottom:'1px solid var(--line-2)'}}>
                  <div style={{fontWeight:500,fontSize:'13.5px'}}>{c.full_name} {c.is_primary&&<span style={{fontSize:'10px',color:'var(--accent)',fontFamily:'var(--mono)'}}>· PRIMARY</span>}</div>
                  <div style={{fontSize:'12.5px',color:'var(--muted)'}}>{[c.email,c.phone].filter(Boolean).join('  ·  ')||'—'}</div>
                </div>
              )) : <div style={{fontSize:'13px',color:'var(--muted)'}}>No contacts yet.</div>}
            </>
          ) : (
            <>
              <div className="form-row-2">
                <div><label>Company Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
                <div><label>Type</label><select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{types.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}</select></div>
              </div>
              <div className="form-row-2">
                <div><label>Email</label><input className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
                <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
              </div>
              <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
              {form.type==='client' && (
                <div className="form-row-2">
                  <div><label>Vendor # <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(internal — our # with this client)</span></label><input className="form-input" value={form.vendor_number} onChange={e=>f('vendor_number')(e.target.value)} /></div>
                  <div><label>Pallet info <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(autofills onto their POs)</span></label><input className="form-input" value={form.pallet_info} onChange={e=>f('pallet_info')(e.target.value)} placeholder="e.g. 48x40 GMA, max 60 cartons/pallet" /></div>
                </div>
              )}
              <span className="form-section-label">Contacts</span>
              {contacts.map((c,i)=>(
                <div key={i} className="form-row-2" style={{marginBottom:'10px'}}>
                  <div><label>Name</label><input className="form-input" value={c.full_name||''} onChange={e=>setC(i,'full_name',e.target.value)} /></div>
                  <div><label>Email</label><input className="form-input" value={c.email||''} onChange={e=>setC(i,'email',e.target.value)} /></div>
                  <div><label>Phone</label><input className="form-input" value={c.phone||''} onChange={e=>setC(i,'phone',e.target.value)} /></div>
                  <div style={{display:'flex',alignItems:'flex-end',gap:'8px'}}><label style={{display:'flex',alignItems:'center',gap:'6px',textTransform:'none',letterSpacing:0,fontFamily:'var(--sans)',fontSize:'12.5px',color:'var(--ink-2)',margin:0}}><input type="checkbox" checked={!!c.is_primary} onChange={e=>setC(i,'is_primary',e.target.checked)} /> Primary contact</label></div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addContact}>+ Add Contact</button>
            </>
          )}
        </div>
        <div className="modal-foot">
          {!edit ? (
            <><button className="btn btn-ghost" onClick={onClose}>Close</button><button className="btn btn-dark" onClick={()=>setEdit(true)}>Edit</button></>
          ) : (
            <><button className="btn btn-ghost" onClick={()=>setEdit(false)}>Cancel</button><button className="btn btn-dark" onClick={save}>Save Changes</button></>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Products ─────────────────────────────────────────────────────────────────
function Products({ navigate }) {
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState('All');
  const [search, setSearch] = useState('');
  const [poQuote, setPoQuote] = useState(null);
  useEffect(()=>{
    SBQ.from('quotes').select('*').order('created_at',{ascending:false}).then(({data})=>{ setQuotes(data||[]); setLoading(false); });
  },[]);
  const tiersOf = q => { try { return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]); } catch { return []; } };
  const activeFreight = t => { const ship=t.ship||'ocean'; return ship==='air'?(Number(t.freightAir??t.freightDuty)||0):(Number(t.freightOcean??t.freightDuty)||0); };
  const moldPer = (m,qty)=>{ const f=Number(m)||0,qn=Number(qty)||0; return (f<=0||qn<=0)?0:f/qn; };
  const tierMargin = (t,mold)=>{ const total=(Number(t.landed)||0)+activeFreight(t)+moldPer(mold,t.qty); const p=Number(t.client)||0; return p<=0?null:((p-total)/p)*100; };
  const clientPrices = q => tiersOf(q).map(t=>Number(t.client)||0).filter(Boolean);
  const priceRange = q => { const p=clientPrices(q); if(!p.length) return null; const lo=Math.min(...p),hi=Math.max(...p); return lo===hi?money(lo):`${money(lo)} – ${money(hi)}`; };
  const avgMargin = q => { const ms=tiersOf(q).map(t=>tierMargin(t,q.mold_fee)).filter(v=>v!=null); return ms.length?Math.round(ms.reduce((a,b)=>a+b,0)/ms.length):null; };

  const counts = {}; quotes.forEach(q=>{ const c=(q.client||'').trim()||'—'; counts[c]=(counts[c]||0)+1; });
  const clientList = Object.keys(counts).sort((a,b)=>a.localeCompare(b));
  const filtered = quotes.filter(q=>{
    if(client!=='All' && ((q.client||'').trim()||'—')!==client) return false;
    const s=search.toLowerCase(); if(!s) return true;
    return `${q.product} ${q.client} ${q.factory} ${q.sku} ${q.country}`.toLowerCase().includes(s);
  });

  return (
    <>
      <div className="prod-search" style={{marginBottom:'16px'}}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input placeholder="Search products — name, client, factory, SKU…" value={search} onChange={e=>setSearch(e.target.value)} />
      </div>
      <div className="filters">
        <button className={`filter-btn ${client==='All'?'active':''}`} onClick={()=>setClient('All')}>All Clients <span className="chip-count">{quotes.length}</span></button>
        {clientList.map(c=>(
          <button key={c} className={`filter-btn ${client===c?'active':''}`} onClick={()=>setClient(c)}>
            <span className="chip-dot" style={{background:companyColor(c)}} />{c} <span className="chip-count">{counts[c]}</span>
          </button>
        ))}
      </div>
      {client!=='All' && (
        <div style={{display:'flex',alignItems:'center',gap:'8px',margin:'4px 0 16px',fontSize:'15px'}}>
          <button className="crumb" onClick={()=>setClient('All')}>‹ All Clients</button>
          <span style={{color:'var(--faint)'}}>/</span>
          <span style={{fontFamily:'var(--serif)',fontWeight:600}}>{client}</span>
          <span style={{color:'var(--muted)',fontSize:'12.5px'}}>{filtered.length} {filtered.length===1?'product':'products'}</span>
        </div>
      )}
      <div className="section-card">
        {loading ? <div className="loading">Loading products…</div> : filtered.length ? (
          <table className="data-table">
            <thead><tr><th>Product</th><th>Factory</th><th>Tiers</th><th>Client Price</th><th>Avg Margin</th><th></th></tr></thead>
            <tbody>
              {filtered.map(q=>{
                const col=companyColor(q.client); const tiers=tiersOf(q); const m=avgMargin(q);
                return (
                  <tr key={q.id} onClick={()=>setPoQuote(q)}>
                    <td>
                      <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                        <span style={{width:'26px',height:'26px',borderRadius:'7px',flexShrink:0,display:'flex',alignItems:'center',justifyContent:'center',fontSize:'9px',fontWeight:600,fontFamily:'var(--mono)',color:'#0b1120',background:col}}>{initials(q.client)}</span>
                        <div style={{minWidth:0}}>
                          <div style={{fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'260px'}}>{q.product||'Untitled'}</div>
                          <div style={{fontSize:'11px',color:'var(--muted)'}}>{q.client||'—'}{q.sku?` · ${q.sku}`:''}</div>
                        </div>
                      </div>
                    </td>
                    <td><div style={{whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:'200px'}}>{q.factory||'—'}</div><div style={{fontSize:'11px',color:'var(--faint)'}}>{q.country||''}</div></td>
                    <td className="mono">{tiers.length}</td>
                    <td className="mono">{priceRange(q)||'—'}</td>
                    <td className="mono" style={{color:m==null?'var(--faint)':m<15?'var(--hot)':m<25?'var(--warn)':'var(--ok)'}}>{m==null?'—':m+'%'}</td>
                    <td style={{textAlign:'right'}}><span className="pull-link">Pull → PO</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No products</h3><p>{quotes.length? 'Nothing matches this filter.' : 'Create quotes in the Quotes tab — each one becomes a pullable product here.'}</p></div>}
      </div>
      {poQuote && <CreatePOModal initialQuote={poQuote} onClose={()=>setPoQuote(null)} onCreated={id=>{setPoQuote(null);navigate('order-detail',{id});}} />}
    </>
  );
}

// ── Shipments ─────────────────────────────────────────────────────────────────
function Shipments() {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const reload = async () => {
    const { data } = await SB.from('shipments').select('*,companies!client_company_id(name)').order('created_at',{ascending:false});
    setRows(data||[]); setLoading(false);
  };
  useEffect(()=>{ reload(); },[]);
  return (
    <div className="section-card">
      {loading ? <div className="loading">Loading...</div> : rows.length ? (
        <table className="data-table">
          <thead><tr><th>Shipment #</th><th>Client</th><th>Vessel</th><th>Container #</th><th>Status</th><th>ETA</th></tr></thead>
          <tbody>
            {rows.map(s=>(
              <tr key={s.id} onClick={()=>setOpenId(s.id)} style={{cursor:'pointer'}}>
                <td className="mono">{s.shipment_number||'—'}</td>
                <td>{s.companies?.name||'—'}</td>
                <td>{s.vessel_name||'—'}</td>
                <td className="mono">{s.container_no||'—'}</td>
                <td><Badge status={s.status} /></td>
                <td>{fmtDate(s.estimated_arrival)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty"><h3>No shipments yet</h3><p>Shipments appear here when orders move to the shipping stage.</p></div>}
      {openId && <ShipmentDetailModal id={openId} onClose={()=>setOpenId(null)} onSaved={()=>{setOpenId(null);reload();}} />}
    </div>
  );
}

// ── Shipment Detail / Edit Modal ──────────────────────────────────────────────
function ShipmentDetailModal({ id, onClose, onSaved }) {
  const [s, setS] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(()=>{
    SB.from('shipments').select('*').eq('id',id).single().then(({data})=>setS(data||{}));
    SB.from('companies').select('id,name,type').order('name').then(({data})=>setCompanies(data||[]));
  },[id]);
  const set = (k,v)=>setS(prev=>({...prev,[k]:v}));
  const STAT = ['created','in_transit','at_origin_port','at_transshipment','at_destination_port','customs','out_for_delivery','delivered','delayed','exception','cancelled'];
  const dval = v => v ? String(v).slice(0,10) : '';
  const save = async () => {
    setSaving(true);
    const upd = {
      shipment_number: s.shipment_number||null, status: s.status||'created',
      client_company_id: s.client_company_id||null, carrier_company_id: s.carrier_company_id||null,
      vessel_name: s.vessel_name||null, container_no: s.container_no||null, voyage_no: s.voyage_no||null,
      booking_number: s.booking_number||null, bill_of_lading: s.bill_of_lading||null,
      estimated_departure: dval(s.estimated_departure) ? new Date(dval(s.estimated_departure)+'T12:00:00').toISOString() : null,
      estimated_arrival:   dval(s.estimated_arrival)   ? new Date(dval(s.estimated_arrival)+'T12:00:00').toISOString()   : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await SB.from('shipments').update(upd).eq('id',id);
    setSaving(false);
    if (error){ alert('Error: '+error.message); return; }
    onSaved();
  };
  const clients  = companies.filter(c=>['client','brand','customer'].includes(c.type));
  const carriers = companies.filter(c=>['carrier','freight_forwarder'].includes(c.type));
  return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box">
        <div className="modal-head"><h3>{s?.shipment_number||'Shipment'}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        {!s ? <div className="modal-body">Loading…</div> : (
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Shipment #</label><input className="form-input" value={s.shipment_number||''} onChange={e=>set('shipment_number',e.target.value)} /></div>
            <div><label>Status</label><select className="form-select" value={s.status||'created'} onChange={e=>set('status',e.target.value)}>{STAT.map(x=><option key={x} value={x}>{x.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Client</label><select className="form-select" value={s.client_company_id||''} onChange={e=>set('client_company_id',e.target.value)}><option value="">—</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label>Carrier / Forwarder</label><select className="form-select" value={s.carrier_company_id||''} onChange={e=>set('carrier_company_id',e.target.value)}><option value="">—</option>{carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Vessel / Boat</label><input className="form-input" value={s.vessel_name||''} onChange={e=>set('vessel_name',e.target.value)} placeholder="e.g. MAERSK SELETAR" /></div>
            <div><label>Voyage #</label><input className="form-input" value={s.voyage_no||''} onChange={e=>set('voyage_no',e.target.value)} placeholder="e.g. 084W" /></div>
          </div>
          <div className="form-row-2">
            <div><label>Container #</label><input className="form-input" value={s.container_no||''} onChange={e=>set('container_no',e.target.value)} placeholder="e.g. MSKU1234567" /></div>
            <div><label>Booking #</label><input className="form-input" value={s.booking_number||''} onChange={e=>set('booking_number',e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Bill of Lading</label><input className="form-input" value={s.bill_of_lading||''} onChange={e=>set('bill_of_lading',e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>ETD</label><input type="date" className="form-input" value={dval(s.estimated_departure)} onChange={e=>set('estimated_departure',e.target.value)} /></div>
            <div><label>ETA</label><input type="date" className="form-input" value={dval(s.estimated_arrival)} onChange={e=>set('estimated_arrival',e.target.value)} /></div>
          </div>
        </div>
        )}
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={save} disabled={saving||!s}>{saving?'Saving…':'Save shipment'}</button></div>
      </div>
    </div>
  );
}


// ── Create PO Modal ───────────────────────────────────────────────────────────
function CreatePOModal({ onClose, onCreated, initialQuote=null }) {
  const [mode, setMode]   = useState('quote'); // 'quote' | 'manual'
  const [factories, setFactories] = useState([]);
  const [clients, setClients] = useState([]);
  const [products,  setProducts]  = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [qLoading, setQLoading] = useState(true);
  const [qSearch, setQSearch] = useState('');
  const [picked, setPicked] = useState(null);   // chosen quote (form-shaped)
  const [tierIdx, setTierIdx] = useState(0);
  const [refsReady, setRefsReady] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [items, setItems] = useState([{prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);
  const [srchIdx, setSrchIdx] = useState(-1);
  const [srchHits, setSrchHits] = useState([]);
  const [srchRect, setSrchRect] = useState(null);
  const [recentDescs, setRecentDescs] = useState([]);
  const [form, setForm]  = useState({ factoryId:'', clientId:'', num:`KUI-PO-${new Date().getFullYear()}-`, date:nowDate(), ship:'', inco:'', pay:'', dep:'', mold:'', sample:'', currency:'USD', notes:'', pallet:'' });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));

  // Build the next sequential PO number, e.g. KUI-PO-2026-007, from existing ones.
  const genNum = (list=[]) => {
    const year = new Date().getFullYear();
    const prefix = `KUI-PO-${year}-`;
    const max = (list||[]).reduce((m,n)=>{
      if(typeof n!=='string'||!n.startsWith(prefix)) return m;
      const tail=parseInt(n.slice(prefix.length),10);
      return isNaN(tail)?m:Math.max(m,tail);
    },0);
    return prefix+String(max+1).padStart(3,'0');
  };

  useEffect(()=>{
    Promise.all([
      SB.from('companies').select('id,name').eq('type','factory').order('name'),
      SB.from('products').select('id,sku,name').order('name'),
      SB.from('companies').select('id,name,vendor_number,pallet_info').eq('type','client').order('name'),
      SB.from('purchase_order_items').select('description').not('description','is',null).limit(200)
    ]).then(([{data:fac},{data:pro},{data:cli},{data:itmD}])=>{
      setFactories(fac||[]); setProducts(pro||[]); setClients(cli||[]);
      setRecentDescs([...new Set((itmD||[]).map(it=>it.description||'').filter(Boolean))]);
      setRefsReady(true);
    });
    // auto-number this PO based on what's already in the system
    SB.from('purchase_orders').select('order_number').then(({data})=>{
      setForm(prev=> prev.num && !/-$/.test(prev.num) ? prev : {...prev, num: genNum((data||[]).map(r=>r.order_number))});
    });
    // quotes live in the public schema (migrated quotes platform)
    SBQ.from('quotes').select('*').order('created_at',{ascending:false}).then(({data})=>{
      setQuotes(data||[]); setQLoading(false);
    });
  },[]);

  const addItem = () => setItems(prev=>[...prev,{prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);
  const handleProdInput = (i,v,el) => {
    setItem(i,'desc',v);
    if(v.trim().length>0){
      const lv=v.toLowerCase();
      const cat=(products||[]).filter(p=>(p.name||'').toLowerCase().includes(lv)||(p.sku||'').toLowerCase().includes(lv)).map(p=>({id:p.id,name:p.name,sku:p.sku||'',recent:false}));
      const rec=recentDescs.filter(d=>d.toLowerCase().includes(lv)&&!cat.some(c=>c.name===d)).slice(0,5).map(d=>({id:null,name:d,sku:'',recent:true}));
      const h=[...cat,...rec].slice(0,8);
      setSrchHits(h); setSrchIdx(i);
      if(el){const r=el.getBoundingClientRect();setSrchRect({top:r.bottom+2,left:r.left,w:Math.max(r.width,240)});}
    } else { setSrchIdx(-1); setSrchHits([]); setSrchRect(null); }
  };
  const pickProd = (i,p) => { setItem(i,'desc',p.name); setItem(i,'prodId',p.id||''); setSrchIdx(-1); setSrchHits([]); setSrchRect(null); };
  const setItem = (i,k,v) => setItems(prev=>prev.map((it,idx)=>idx===i?{...it,[k]:v}:it));
  const rmItem  = i => setItems(prev=>prev.filter((_,idx)=>idx!==i));

  // tiers stored as jsonb on each quote row
  const tiersOf = q => { try { return Array.isArray(q.tiers)?q.tiers:(q.tiers?JSON.parse(q.tiers):[]); } catch { return []; } };
  const qPrice  = q => { const t=tiersOf(q).map(x=>Number(x.client)||0).filter(Boolean); return t.length?Math.min(...t):null; };

  const filteredQuotes = quotes.filter(q=>{
    const s=qSearch.toLowerCase(); if(!s) return true;
    return `${q.product} ${q.client} ${q.factory} ${q.sku} ${q.country}`.toLowerCase().includes(s);
  });

  // when a quote+tier is chosen, prefill the PO form & line item
  const applyQuote = (q, ti=0) => {
    setPicked(q); setTierIdx(ti);
    const tiers=tiersOf(q); const t=tiers[ti]||{};
    const matchFactory = factories.find(fc=>(fc.name||'').toLowerCase()===(q.factory||'').toLowerCase());
    const matchClient  = clients.find(c=>(c.name||'').toLowerCase()===(q.client||'').toLowerCase());
    const matchProduct = products.find(p=>(q.sku && (p.sku||'').toLowerCase()===(q.sku||'').toLowerCase()) || (p.name||'').toLowerCase()===(q.product||'').toLowerCase());
    setForm(prev=>({...prev,
      factoryId: matchFactory?matchFactory.id:prev.factoryId,
      clientId: matchClient?matchClient.id:prev.clientId,
      pallet: (matchClient&&matchClient.pallet_info)?matchClient.pallet_info:prev.pallet,
      inco: q.country?`FOB ${q.country}`:prev.inco,
      mold: q.mold_fee!=null?String(q.mold_fee):prev.mold,
      sample: q.sample_fee!=null?String(q.sample_fee):prev.sample,
      notes: prev.notes || (q.notes||''),
    }));
    setItems([{ prodId: matchProduct?matchProduct.id:'', desc: q.product||'', qty: t.qty!=null?String(t.qty):'', price: t.landed!=null?String(t.landed):'', ci:'', carton:'' }]);
  };
  const pickTier = ti => { if(picked) applyQuote(picked, ti); };

  // when opened from a product card, seed the chosen quote once refs are ready
  useEffect(()=>{
    if(initialQuote && refsReady && !seeded){ applyQuote(initialQuote, 0); setSeeded(true); }
  },[initialQuote, refsReady, seeded]);

  const submit  = async () => {
    if (!form.factoryId||!form.num) { alert('Factory and PO number required'); return; }
    const valid = items.filter(it => (it.prodId || (it.desc||'').trim()) && Number(it.qty)>0);
    if (valid.length===0) { alert('Add at least one line item with a quantity greater than 0 before creating the PO.'); return; }
    const baseFields = {
      factory_company_id:form.factoryId, client_company_id:form.clientId||null, pallet_info:form.pallet||null, order_date:form.date,
      requested_ship_date:form.ship||null, incoterm:form.inco||null, payment_terms:form.pay||null,
      deposit_percent:Number(form.dep)||null, mold_fee:Number(form.mold)||0, sample_fee:Number(form.sample)||0,
      currency:form.currency, notes:form.notes||null, status:'draft',
      source_quote_id: picked?.id || null
    };
    let po=null, lastErr=null, orderNumber=form.num;
    for (let attempt=0; attempt<4 && !po; attempt++){
      const { data, error } = await SB.from('purchase_orders').insert({ ...baseFields, order_number:orderNumber }).select().single();
      if (!error){ po=data; break; }
      lastErr=error;
      if (/order_number|duplicate key/i.test(error.message||'')){
        const { data:rows } = await SB.from('purchase_orders').select('order_number');
        orderNumber = genNum((rows||[]).map(r=>r.order_number));
        setForm(prev=>({...prev,num:orderNumber}));
        continue; // try again with the next free number
      }
      break; // a different error — stop
    }
    if (!po) { alert('Error creating PO: '+(lastErr?.message||'unknown')); return; }
    let added=0, failed=[];
    for (const it of valid) {
      const hasDesc=(it.desc||'').trim();
      const base={ purchase_order_id:po.id, product_id:it.prodId||null, quantity:Number(it.qty), unit_price:Number(it.price)||0, currency:form.currency, ci_value:Number(it.ci)||null, carton_info:it.carton||null };
      let { error:e1 } = await SB.from('purchase_order_items').insert({ ...base, description:hasDesc||null });
      if (e1 && /description/i.test(e1.message)) {
        // description column not added yet (migration 007) — insert without it
        const r = await SB.from('purchase_order_items').insert(base);
        e1 = r.error;
      }
      if (e1) failed.push(e1.message); else added++;
    }
    if (failed.length) alert('PO created, but '+failed.length+' line item(s) failed:\n'+failed[0]);
    onCreated(po.id);
  };

  return (
    <>
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box modal-lg">
        <div className="modal-head"><h3>New Purchase Order</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">

          {/* mode toggle */}
          <div className="qp-toggle">
            <button className={mode==='quote'?'on':''} onClick={()=>setMode('quote')}>Generate from Quote</button>
            <button className={mode==='manual'?'on':''} onClick={()=>{setMode('manual');setPicked(null);}}>Manual Entry</button>
          </div>

          {/* selected-quote banner */}
          {picked && (
            <div className="qp-banner">
              <span><b>{picked.product||'Quote'}</b> · {picked.client||'—'} {picked.sku?`· ${picked.sku}`:''}</span>
              <button className="x" onClick={()=>{setPicked(null);setItems([{prodId:'',desc:'',qty:'',price:'',ci:'',carton:''}]);}}>Change</button>
            </div>
          )}

          {/* QUOTE PICKER */}
          {mode==='quote' && !picked && (
            <>
              <div className="qp-search">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
                <input placeholder="Search quotes — product, client, factory, SKU…" value={qSearch} onChange={e=>setQSearch(e.target.value)} autoFocus />
              </div>
              {qLoading ? <div className="loading">Loading quotes…</div> : (
                <div className="qp-list">
                  {filteredQuotes.length===0 && <div className="empty" style={{padding:'40px 20px'}}><p>No quotes match.</p></div>}
                  {filteredQuotes.map(q=>{
                    const tiers=tiersOf(q); const price=qPrice(q);
                    return (
                      <button key={q.id} className="qp-card" onClick={()=>applyQuote(q,0)}>
                        <span className="qp-avatar" style={{background:companyColor(q.client),color:'#0b1120'}}>{initials(q.client)}</span>
                        <span className="qp-meta">
                          <div className="qp-prod">{q.product||'Untitled product'}</div>
                          <div className="qp-sub">{q.client||'—'}{q.factory?` · ${q.factory}`:''}{q.sku?` · ${q.sku}`:''}</div>
                        </span>
                        <span className="qp-right">
                          <div className="qp-price">{price!=null?money(price):'—'}</div>
                          <div className="qp-tiers">{tiers.length} {tiers.length===1?'tier':'tiers'}</div>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {/* tier picker once a quote is chosen */}
          {mode==='quote' && picked && tiersOf(picked).length>0 && (
            <div className="form-row">
              <label>Pricing Tier — pick the quantity to build this PO from</label>
              <div className="qp-tierpick">
                {tiersOf(picked).map((t,i)=>(
                  <button key={i} className={i===tierIdx?'on':''} onClick={()=>pickTier(i)}>
                    {t.qty?Number(t.qty).toLocaleString():'—'} @ {t.landed?money(Number(t.landed)):'—'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* SHARED PO FORM — shown for manual, or after a quote is picked */}
          {(mode==='manual' || picked) && (
          <>
          <div className="form-row" style={{marginTop:picked?4:0}}><label>Factory *</label>
            <select className="form-select" value={form.factoryId} onChange={e=>f('factoryId')(e.target.value)}>
              <option value="">Select factory...</option>
              {factories.map(fc=><option key={fc.id} value={fc.id}>{fc.name}</option>)}
            </select>
          </div>
          <div className="form-row"><label>Client <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(for tracking &amp; inventory — never shown on the factory PO)</span></label>
            <select className="form-select" value={form.clientId} onChange={e=>{const cid=e.target.value;const c=clients.find(x=>x.id===cid);setForm(prev=>({...prev,clientId:cid,pallet:(c&&c.pallet_info&&!prev.pallet)?c.pallet_info:prev.pallet}));}}>
              <option value="">Unassigned</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {(()=>{ const c=clients.find(x=>x.id===form.clientId); return c?.vendor_number ? <div style={{fontSize:'12px',color:'var(--muted)',marginTop:'6px'}}>Vendor # <b style={{color:'var(--ink)'}}>{c.vendor_number}</b> · internal only, won't appear on the factory PO</div> : null; })()}
          </div>
          <div className="form-row"><label>Pallet instructions <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prints on the factory PO)</span></label>
            <input className="form-input" value={form.pallet} onChange={e=>f('pallet')(e.target.value)} placeholder="Autofills from the client — edit if needed" />
          </div>
          <div className="form-row-2">
            <div><label>PO Number *</label><input className="form-input" value={form.num} onChange={e=>f('num')(e.target.value)} /></div>
            <div><label>Order Date</label><input type="date" className="form-input" value={form.date} onChange={e=>f('date')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Ship By</label><input type="date" className="form-input" value={form.ship} onChange={e=>f('ship')(e.target.value)} /></div>
            <div><label>Incoterm (EXW / FOB)</label><input className="form-input" placeholder="e.g. FOB HCMC" value={form.inco} onChange={e=>f('inco')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Payment Terms</label><input className="form-input" placeholder="e.g. 30/70" value={form.pay} onChange={e=>f('pay')(e.target.value)} /></div>
            <div><label>Deposit %</label><input type="number" className="form-input" placeholder="30" value={form.dep} onChange={e=>f('dep')(e.target.value)} /></div>
          </div>
          <span className="form-section-label">Line Items</span>
          <table className="items-table">
            <thead><tr><th style={{width:'40%'}}>Product</th><th>Qty</th><th>Unit Price</th><th style={{textAlign:'right'}}>Amount</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <React.Fragment key={i}>
                  <tr>
                    <td>
                      <input value={it.desc} onChange={e=>handleProdInput(i,e.target.value,e.target)} onBlur={()=>setTimeout(()=>{setSrchIdx(-1);setSrchHits([]);setSrchRect(null);},200)} placeholder="Type to search products…" />
                    </td>
                    <td><input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} placeholder="0" /></td>
                    <td><input type="number" step="0.01" value={it.price} onChange={e=>setItem(i,'price',e.target.value)} placeholder="0.00" /></td>
                    <td className="mono" style={{textAlign:'right',whiteSpace:'nowrap',fontSize:'12.5px'}}>{money((Number(it.qty)||0)*(Number(it.price)||0),form.currency)}</td>
                    <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                  </tr>
                  <tr className="item-sub-row">
                    <td colSpan={5}>
                      <div style={{display:'flex',gap:'10px',flexWrap:'wrap',padding:'4px 0 8px'}}>
                        <div style={{display:'flex',flexDirection:'column',flex:'0 0 100px'}}>
                          <span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>CI Value ($)</span>
                          <input type="number" step="0.01" className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.ci||''} onChange={e=>setItem(i,'ci',e.target.value)} placeholder="0.00" />
                        </div>
                        <div style={{display:'flex',flexDirection:'column',flex:'1 1 180px'}}>
                          <span style={{fontSize:'10px',textTransform:'uppercase',letterSpacing:'.05em',color:'var(--muted)'}}>Carton info</span>
                          <input className="form-input" style={{padding:'5px 8px',fontSize:'12.5px'}} value={it.carton||''} onChange={e=>setItem(i,'carton',e.target.value)} placeholder="e.g. 12 pcs/ctn, 60×40×30 cm, 11 kg" />
                        </div>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {picked && <div style={{fontSize:'12px',color:'var(--muted)',marginBottom:'10px'}}>Prefilled from the quote — edit any field before creating.</div>}
          {items.some(it=>Number(it.qty)>0&&Number(it.price)>0) && (()=>{
            const sub=items.reduce((a,it)=>a+(Number(it.qty)||0)*(Number(it.price)||0),0);
            const mold=Number(form.mold)||0; const grand=sub+mold;
            return (
              <div className="po-draft-totals">
                <div className="pdt-row"><span>Goods subtotal</span><span className="mono">{money(sub,form.currency)}</span></div>
                {mold>0 && <div className="pdt-row"><span>Tooling / mold</span><span className="mono">{money(mold,form.currency)}</span></div>}
                <div className="pdt-grand"><span>PO total · {form.currency}</span><span className="mono">{money(grand,form.currency)}</span></div>
              </div>
            );
          })()}
          <button className="btn btn-ghost btn-sm" style={{marginBottom:'16px'}} onClick={addItem}>+ Add Item</button>
          <span className="form-section-label">Fees & Currency</span>
          <div className="form-row-3">
            <div><label>Mold / Tooling</label><input type="number" className="form-input" placeholder="0" value={form.mold} onChange={e=>f('mold')(e.target.value)} /></div>
            <div><label>Sample Fee</label><input type="number" className="form-input" placeholder="0" value={form.sample} onChange={e=>f('sample')(e.target.value)} /></div>
            <div><label>Currency</label><select className="form-select" value={form.currency} onChange={e=>f('currency')(e.target.value)}><option>USD</option><option>CNY</option><option>VND</option><option>EUR</option></select></div>
          </div>
          <div className="form-row"><label>Notes</label><textarea className="form-textarea" placeholder="Special instructions..." value={form.notes} onChange={e=>f('notes')(e.target.value)} /></div>
          </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-dark" onClick={submit} disabled={mode==='quote'&&!picked} style={mode==='quote'&&!picked?{opacity:.5,pointerEvents:'none'}:{}}>Create Purchase Order</button>
        </div>
      </div>
    </div>
    {srchIdx>=0 && srchHits.length>0 && srchRect && typeof window!=='undefined' && createPortal(
      <div style={{position:'fixed',top:srchRect.top,left:srchRect.left,width:srchRect.w,background:'#fff',border:'1px solid #e2e8f0',borderRadius:'10px',boxShadow:'0 8px 24px rgba(0,0,0,.16)',zIndex:99999,maxHeight:'220px',overflowY:'auto'}}>
        {srchHits.map(p=>(
          <div key={p.id||p.name} style={{padding:'10px 14px',fontSize:'13px',cursor:'pointer',borderBottom:'1px solid #f1f5f9',display:'flex',justifyContent:'space-between',alignItems:'center'}} onMouseDown={()=>pickProd(srchIdx,p)}>
            <span style={{fontWeight:600,color:'#0b1120'}}>{p.name}</span>
            <span style={{fontSize:'11px',color:'#94a3b8'}}>{p.sku||''}{p.recent?' recent':''}</span>
          </div>
        ))}
      </div>,
      document.body
    )}
    </>
  );
}

// ── Create Company Modal ──────────────────────────────────────────────────────
function CreateCompanyModal({ onClose, onCreated }) {
  const [form, setForm] = useState({name:'',type:'client',email:'',phone:'',website:'',vendor_number:'',pallet_info:'',cname:'',cemail:'',cphone:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const submit = async () => {
    if (!form.name) { alert('Company name required'); return; }
    const { data: co, error } = await SB.from('companies').upsert({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null},{onConflict:'name,type',ignoreDuplicates:false}).select().single();
    if (error) { alert('Error: '+error.message); return; }
    if (form.cname) await SB.from('contacts').insert({company_id:co.id,full_name:form.cname,email:form.cemail||null,phone:form.cphone||null,is_primary:true});
    // Mirror into Quotes directory so it appears in quote autofill
    try {
      if (form.type==='client') {
        await SBQ.from('client_contacts').insert({client:form.name,contact:form.cname||null,email:form.cemail||null,phone:form.phone||null}).select();
      } else if (form.type==='factory') {
        await SBQ.from('factory_presets').insert({factory:form.name,factory_email:form.email||null,factory_phone:form.phone||null}).select();
      }
    } catch(e) {}
    onCreated();
  };
  const types = ['client','factory','carrier','freight_forwarder'];
  return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box">
        <div className="modal-head"><h3>New Company</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Company Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
            <div><label>Type</label><select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{types.map(t=><option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Email</label><input type="email" className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
            <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
          {form.type==='client' && (
            <div className="form-row-2">
              <div><label>Vendor # <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(internal)</span></label><input className="form-input" value={form.vendor_number} onChange={e=>f('vendor_number')(e.target.value)} /></div>
              <div><label>Pallet info</label><input className="form-input" value={form.pallet_info} onChange={e=>f('pallet_info')(e.target.value)} placeholder="e.g. 48x40 GMA" /></div>
            </div>
          )}
          <span className="form-section-label">Primary Contact</span>
          <div className="form-row-2">
            <div><label>Full Name</label><input className="form-input" value={form.cname} onChange={e=>f('cname')(e.target.value)} /></div>
            <div><label>Email</label><input type="email" className="form-input" value={form.cemail} onChange={e=>f('cemail')(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Company</button></div>
      </div>
    </div>
  );
}

// ── Create Shipment Modal ─────────────────────────────────────────────────────
function CreateShipmentModal({ onClose, onCreated }) {
  const [companies, setCompanies] = useState([]);
  const [pos, setPos] = useState([]);
  const [form, setForm] = useState({
    number: `SHP-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    client:'', carrier:'', bol:'', etd:'', eta:'', status:'created', inco:'', poId:''
  });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  useEffect(()=>{
    SB.from('companies').select('id,name,type').order('name').then(({data})=>setCompanies(data||[]));
    SB.from('purchase_orders').select('id,order_number').order('created_at',{ascending:false}).limit(200).then(({data})=>setPos(data||[]));
  },[]);
  const clients  = companies.filter(c=>['client','brand','customer'].includes(c.type));
  const carriers = companies.filter(c=>['carrier','freight_forwarder'].includes(c.type));
  const STATUSES = ['created','in_transit','at_origin_port','at_transshipment','at_destination_port','customs','out_for_delivery','delivered','delayed','exception','cancelled'];
  const submit = async () => {
    if (!form.number) { alert('Shipment number required'); return; }
    const { data: ship, error } = await SB.from('shipments').insert({
      shipment_number: form.number,
      client_company_id: form.client || null,
      carrier_company_id: form.carrier || null,
      bill_of_lading: form.bol || null,
      estimated_departure: form.etd ? new Date(form.etd+'T12:00:00').toISOString() : null,
      estimated_arrival:   form.eta ? new Date(form.eta+'T12:00:00').toISOString() : null,
      status: form.status,
      inco_term: form.inco || null,
    }).select('id').single();
    if (error) { alert('Error: '+error.message); return; }
    if (form.poId) await SB.from('shipment_pos').insert({ shipment_id: ship.id, purchase_order_id: form.poId });
    onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box">
        <div className="modal-head"><h3>New Shipment</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Shipment # *</label><input className="form-input" value={form.number} onChange={e=>f('number')(e.target.value)} /></div>
            <div><label>Status</label><select className="form-select" value={form.status} onChange={e=>f('status')(e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Client</label><select className="form-select" value={form.client} onChange={e=>f('client')(e.target.value)}><option value="">—</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label>Carrier / Forwarder</label><select className="form-select" value={form.carrier} onChange={e=>f('carrier')(e.target.value)}><option value="">—</option>{carriers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row"><label>Bill of Lading</label><input className="form-input" value={form.bol} onChange={e=>f('bol')(e.target.value)} /></div>
          <div className="form-row-2">
            <div><label>ETD</label><input type="date" className="form-input" value={form.etd} onChange={e=>f('etd')(e.target.value)} /></div>
            <div><label>ETA</label><input type="date" className="form-input" value={form.eta} onChange={e=>f('eta')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>Incoterm</label><input className="form-input" value={form.inco} onChange={e=>f('inco')(e.target.value)} placeholder="FOB, DDP…" /></div>
            <div><label>Link to PO (optional)</label><select className="form-select" value={form.poId} onChange={e=>f('poId')(e.target.value)}><option value="">None</option>{pos.map(p=><option key={p.id} value={p.id}>{p.order_number||p.id.slice(0,8)}</option>)}</select></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Shipment</button></div>
      </div>
    </div>
  );
}

// ── Create Product Modal ──────────────────────────────────────────────────────
function CreateProductModal({ onClose, onCreated }) {
  const [cats, setCats] = useState([]);
  const [form, setForm] = useState({sku:'',name:'',desc:'',catId:'',hs:'',uom:'pcs',wt:'',upc:'',cwt:'',cl:'',cw:'',ch:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  useEffect(()=>{ SB.from('product_categories').select('id,name').order('name').then(({data})=>setCats(data||[])); },[]);
  const submit = async () => {
    if (!form.sku||!form.name) { alert('SKU and name required'); return; }
    const { error } = await SB.from('products').insert({
      sku:form.sku, name:form.name, description:form.desc||null, category_id:form.catId||null,
      hs_code:form.hs||null, unit_of_measure:form.uom||'pcs', weight_kg:Number(form.wt)||null,
      units_per_carton:Number(form.upc)||null, carton_weight_kg:Number(form.cwt)||null,
      carton_l_cm:Number(form.cl)||null, carton_w_cm:Number(form.cw)||null, carton_h_cm:Number(form.ch)||null
    });
    if (error) { alert('Error: '+error.message); return; }
    onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target.className==='modal-overlay'&&onClose()}>
      <div className="modal-box">
        <div className="modal-head"><h3>New Product</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>SKU *</label><input className="form-input" value={form.sku} onChange={e=>f('sku')(e.target.value)} placeholder="KUI-XXXX-00" /></div>
            <div><label>Category</label><select className="form-select" value={form.catId} onChange={e=>f('catId')(e.target.value)}><option value="">None</option>{cats.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          </div>
          <div className="form-row"><label>Product Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
          <div className="form-row"><label>Description</label><textarea className="form-textarea" value={form.desc} onChange={e=>f('desc')(e.target.value)} /></div>
          <div className="form-row-3">
            <div><label>HS Code</label><input className="form-input" value={form.hs} onChange={e=>f('hs')(e.target.value)} /></div>
            <div><label>Unit</label><input className="form-input" value={form.uom} onChange={e=>f('uom')(e.target.value)} /></div>
            <div><label>Weight (kg)</label><input type="number" step="0.001" className="form-input" value={form.wt} onChange={e=>f('wt')(e.target.value)} /></div>
          </div>
          <span className="form-section-label">Carton / Case Pack</span>
          <div className="form-row-3">
            <div><label>Units/Carton</label><input type="number" className="form-input" value={form.upc} onChange={e=>f('upc')(e.target.value)} /></div>
            <div><label>Carton Wt (kg)</label><input type="number" step="0.01" className="form-input" value={form.cwt} onChange={e=>f('cwt')(e.target.value)} /></div>
            <div></div>
          </div>
          <div className="form-row-3">
            <div><label>L (cm)</label><input type="number" step="0.1" className="form-input" value={form.cl} onChange={e=>f('cl')(e.target.value)} /></div>
            <div><label>W (cm)</label><input type="number" step="0.1" className="form-input" value={form.cw} onChange={e=>f('cw')(e.target.value)} /></div>
            <div><label>H (cm)</label><input type="number" step="0.1" className="form-input" value={form.ch} onChange={e=>f('ch')(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Product</button></div>
      </div>
    </div>
  );
}

// ── PO Document Builder ───────────────────────────────────────────────────────
function buildPODoc(d, opts={}) {
  const pallet = opts.pallet || d.pallet_info || '';
  const t=d.totals||{};
  const m=(n,c)=>n==null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:c||'USD'}).format(n);
  const fd=s=>{if(!s)return'—';return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'});};
  const fn=n=>n==null?'—':new Intl.NumberFormat('en-US').format(n);
  const lines=(d.lines||[]).map(l=>`<tr>
    <td class="l"><div class="desc">${l.description||''}</div><div class="sku">${l.sku||''}</div></td>
    <td class="num">${fn(l.quantity)}</td><td class="num">${l.carton_count?fn(l.carton_count):'—'}</td>
    <td class="num">${m(l.unit_price,d.currency)}</td><td class="num">${m(l.line_amount,d.currency)}</td></tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${d.po_number||'PO'}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Spline+Sans:wght@400;500&family=Spline+Sans+Mono:wght@400&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}html,body{background:#fff;font-family:'Spline Sans',sans-serif;font-size:13px;color:#1a1d1f;}
.page{max-width:8.5in;margin:0 auto;padding:.9in .9in .8in;min-height:11in;}
.lbl{font-family:'Spline Sans Mono',monospace;font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:#8a9097;}
.num{font-family:'Spline Sans Mono',monospace;}.head{display:flex;justify-content:space-between;align-items:center;margin-bottom:60px;}
.logo{height:56px;}.title-row{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:52px;}
h1{font-family:'Fraunces',serif;font-weight:400;font-size:30px;}
.pov{font-family:'Spline Sans Mono',monospace;font-size:15px;margin-top:5px;text-align:right;}
.parties{display:grid;grid-template-columns:1fr 1fr;gap:56px;margin-bottom:46px;}
.party-name{font-size:14px;font-weight:500;margin-bottom:5px;margin-top:11px;}.party-body{font-size:12px;line-height:1.75;color:#8a9097;}
.terms{display:grid;grid-template-columns:repeat(4,1fr);gap:24px;padding-top:22px;border-top:1px solid #ececec;margin-bottom:50px;}
.tv{font-size:13px;font-weight:500;margin-top:7px;}
table{width:100%;border-collapse:collapse;}
thead th{font-family:'Spline Sans Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:#8a9097;text-align:right;font-weight:400;padding:0 0 14px;}
thead th.l{text-align:left;}tbody td{font-size:12.5px;padding:18px 0;border-top:1px solid #ececec;text-align:right;vertical-align:top;}
tbody td.l{text-align:left;padding-right:24px;}.desc{font-weight:500;font-size:13px;}.sku{font-family:'Spline Sans Mono',monospace;font-size:10px;color:#c9ccce;margin-top:4px;}
.foot{display:grid;grid-template-columns:1fr 280px;gap:60px;margin-top:46px;}
.nb{font-size:11.5px;line-height:1.8;color:#8a9097;margin-top:12px;}
.tr{display:flex;justify-content:space-between;padding:9px 0;font-size:12.5px;}.tr .k{color:#8a9097;}.tr .v{font-family:'Spline Sans Mono',monospace;}
.grand{display:flex;justify-content:space-between;padding:16px 0 0;margin-top:8px;border-top:1px solid #1a1d1f;}
.grand .k{font-family:'Fraunces',serif;font-size:14px;}.grand .v{font-family:'Spline Sans Mono',monospace;font-size:19px;}
.dep{display:flex;justify-content:space-between;padding-top:12px;font-size:11.5px;color:#8a9097;}.dep .v{font-family:'Spline Sans Mono',monospace;}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:56px;margin-top:80px;}
.sline{border-top:1px solid #c9ccce;padding-top:8px;}
.pf{margin-top:54px;display:flex;justify-content:space-between;font-family:'Spline Sans Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#c9ccce;}
@media print{@page{size:letter;margin:0;}.page{padding:.85in .9in;}}</style></head><body>
<div class="page">
  <div class="head"><img class="logo" src="/logo.png" alt="King Universal"></div>
  <div class="title-row"><h1>Purchase Order</h1><div><div class="lbl">PO Number</div><div class="pov">${d.po_number||'—'}</div></div></div>
  <div class="parties">
    <div><div class="lbl">Supplier</div><div class="party-name">${d.supplier?.name||'—'}</div><div class="party-body">${d.supplier?.contact?'Attn: '+d.supplier.contact+'<br>':''}${(d.supplier?.lines||[]).join('<br>')}${d.supplier?.email?'<br>'+d.supplier.email:''}</div></div>
    <div><div class="lbl">Ship To</div><div class="party-name">${d.ship_to?.name||'—'}</div><div class="party-body">${(d.ship_to?.lines||[]).join('<br>')}</div></div>
  </div>
  <div class="terms">
    <div><div class="lbl">Order Date</div><div class="tv">${fd(d.order_date)}</div></div>
    <div><div class="lbl">Ship By</div><div class="tv">${fd(d.requested_ship_date)}</div></div>
    <div><div class="lbl">Incoterm</div><div class="tv">${d.incoterm||'—'}</div></div>
    <div><div class="lbl">Payment</div><div class="tv">${d.payment_terms||'—'}</div></div>
  </div>
  <table><thead><tr><th class="l">Item</th><th>Qty</th><th>Cartons</th><th>Unit</th><th>Amount</th></tr></thead><tbody>${lines}</tbody></table>
  <div class="foot">
    <div><div class="lbl">Notes</div><div class="nb">${d.notes||''}</div>${pallet?`<div class="lbl" style="margin-top:22px">Palletization</div><div class="nb">${pallet}</div>`:''}${t.total_cartons?`<div class="lbl" style="margin-top:22px">Logistics</div><div class="nb">${fn(t.total_cartons)} cartons · ${t.total_cbm} CBM · ${fn(t.total_gross_weight_kg)} kg</div>`:''}</div>
    <div>
      <div class="tr"><span class="k">Goods subtotal</span><span class="v">${m(t.subtotal,d.currency)}</span></div>
      ${t.mold_fee?`<div class="tr"><span class="k">Tooling / mold</span><span class="v">${m(t.mold_fee,d.currency)}</span></div>`:''}
      ${t.sample_fee?`<div class="tr" style="opacity:.6;font-style:italic"><span class="k">Sample fee (sep.)</span><span class="v">${m(t.sample_fee,d.currency)}</span></div>`:''}
      <div class="grand"><span class="k">Total — ${d.currency||'USD'}</span><span class="v">${m(t.grand_total,d.currency)}</span></div>
      ${t.deposit_amount?`<div class="dep"><span>${d.deposit_percent}% deposit</span><span class="v">${m(t.deposit_amount,d.currency)}</span></div>`:''}
    </div>
  </div>
  <div class="sign"><div><div class="sline"><div class="lbl">Authorized — King Universal Inc.</div></div></div><div><div class="sline"><div class="lbl">Accepted — Supplier</div></div></div></div>
  <div class="pf"><span>King Universal Inc.</span><span>${d.po_number||''}</span></div>
</div></body></html>`;
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user,    setUser]    = useState(null);
  const [session, setSession] = useState(null);
  const [page,    setPage]    = useState('dashboard');
  const [params,  setParams]  = useState({});
  const [loading, setLoading] = useState(true);

  const pageActions = {
    orders:    <button className="btn btn-dark" onClick={()=>setModal('create-po')}>+ New PO</button>,
    companies: <button className="btn btn-dark" onClick={()=>setModal('create-company')}>+ New Company</button>,
    products:  <button className="btn btn-ghost" onClick={()=>navigate('quotes')}>+ New Quote</button>,
    shipments: <button className="btn btn-dark" onClick={()=>setModal('create-shipment')}>+ New Shipment</button>,
  };
  const [modal, setModal] = useState(null);
  const [shipmentsRefresh, setShipmentsRefresh] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const navigate = (p, pr={}) => { setPage(p); setParams(pr); setNavOpen(false); };

  useEffect(()=>{
    SB.auth.getSession().then(({data:{session}})=>{
      setUser(session?.user||null); setSession(session||null); setLoading(false);
    });
    const {data:{subscription}} = SB.auth.onAuthStateChange((_,session)=>{
      setUser(session?.user||null); setSession(session||null);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  if (loading) return <div className="loading" style={{paddingTop:'40vh'}}>Loading...</div>;
  if (!user)   return <Login />;

  const titles = {dashboard:'Dashboard',orders:'Purchase Orders','order-detail':'Purchase Order',companies:'Companies',products:'Products',shipments:'Shipments',quotes:'Quotes'};

  return (
    <div className="app-shell">
      <button className="mobile-menu-btn" aria-label="Open menu" onClick={()=>setNavOpen(true)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <div className={`sidebar-backdrop ${navOpen?'show':''}`} onClick={()=>setNavOpen(false)} />
      <Sidebar page={page} navigate={navigate} user={user} open={navOpen} />
      {page==='quotes' ? (
        <div className="main-area">
          <div className="quotes-root" style={{height:'100%',overflowY:'auto'}}>
            <Quotes session={session} />
          </div>
        </div>
      ) : (
      <div className="main-area">
        <div className="page-header">
          <h1 className="page-title">{titles[page]||''}</h1>
          <div className="page-actions">{pageActions[page]}</div>
        </div>
        <div className="page-content">
          {page==='dashboard'    && <Dashboard navigate={navigate} />}
          {page==='orders'       && <Orders navigate={navigate} />}
          {page==='order-detail' && <OrderDetail id={params.id} navigate={navigate} />}
          {page==='companies'    && <Companies />}
          {page==='products'     && <Products navigate={navigate} />}
          {page==='shipments'    && <Shipments key={shipmentsRefresh} />}
          {page==='settings'     && <KuiSettings />}
        </div>
      </div>
      )}
      {modal==='create-po'      && <CreatePOModal onClose={()=>setModal(null)} onCreated={id=>{setModal(null);navigate('order-detail',{id});}} />}
      {modal==='create-company' && <CreateCompanyModal onClose={()=>setModal(null)} onCreated={()=>setModal(null)} />}
      {modal==='create-product' && <CreateProductModal onClose={()=>setModal(null)} onCreated={()=>setModal(null)} />}
      {modal==='create-shipment'&& <CreateShipmentModal onClose={()=>setModal(null)} onCreated={()=>{setModal(null);setShipmentsRefresh(n=>n+1);navigate('shipments');}} />}
    </div>
  );
}
