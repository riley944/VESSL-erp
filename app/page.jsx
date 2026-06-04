'use client';
import { useState, useEffect, useRef } from 'react';
import { SB } from '@/lib/supabase';
import { SBQ } from '@/lib/supabaseQuotes';
import Quotes from '@/app/quotes';

const LOGO_PATH = '/logo.png';

// ── Utils ────────────────────────────────────────────────────────────────────
const money = (n, c='USD') => n == null ? '—' : new Intl.NumberFormat('en-US',{style:'currency',currency:c}).format(n);
const fmtDate = s => { if (!s) return '—'; return new Date(s+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const fmtNum = n => n == null ? '—' : new Intl.NumberFormat('en-US').format(n);
const nowDate = () => new Date().toISOString().slice(0,10);
const STATUSES = ['draft','confirmed','sampling','sample_approved','in_production','ready_to_ship','shipped','delivered','closed','cancelled'];

function Badge({ status }) {
  return <span className={`badge badge-${(status||'').replace(/ /g,'_')}`}>{(status||'—').replace(/_/g,' ')}</span>;
}

// ── Icons (inline SVG, 1.6px stroke) ─────────────────────────────────────────
const Ic = {
  dashboard:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>,
  orders:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3"/><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
  companies:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h.01M9 13h.01M9 17h.01M15 9h.01M15 13h.01M15 17h.01"/></svg>,
  products:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z"/><path d="m3 8 9 5 9-5M12 13v8"/></svg>,
  shipments:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6h13v9H1zM14 9h4l3 3v3h-7z"/><circle cx="5.5" cy="17.5" r="1.8"/><circle cx="17.5" cy="17.5" r="1.8"/></svg>,
  quotes:<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 18v-6M9.5 14.5h3.5a1.5 1.5 0 0 0 0-3h-2a1.5 1.5 0 0 1 0-3H14"/></svg>,
};

// ── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ page, navigate, user }) {
  const links = [
    { id:'dashboard', label:'Dashboard' },
    { id:'orders',    label:'Purchase Orders' },
    { id:'companies', label:'Companies' },
    { id:'products',  label:'Products' },
    { id:'shipments', label:'Shipments' },
    { id:'quotes',    label:'Quotes' },
  ];
  return (
    <aside className="sidebar">
      <div className="sb-brand">
        <img className="sb-logo-img" src="/logo-white.png" alt="King Universal" />
      </div>
      <div className="sb-section">Workspace</div>
      {links.map(l => (
        <button key={l.id} className={`nav-link ${page===l.id||page==='order-detail'&&l.id==='orders'?'active':''}`} onClick={()=>navigate(l.id)}>
          <span className="ic">{Ic[l.id]}</span> {l.label}
        </button>
      ))}
      <div className="sb-spacer" />
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
  useEffect(() => {
    (async () => {
      const [{ data: pos }, { data: cos }, { data: rec }] = await Promise.all([
        SB.from('purchase_orders').select('status'),
        SB.from('companies').select('type'),
        SB.from('purchase_orders').select('id,order_number,status,order_date,companies!factory_company_id(name)').order('created_at',{ascending:false}).limit(8)
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
  return (
    <>
      <div className="stats-grid">
        {[['Active Orders',stats.active],['In Production',stats.prod],['Ready to Ship',stats.rts],['Clients',stats.clients]].map(([l,v])=>(
          <div key={l} className="stat-card"><div className="stat-label">{l}</div><div className="stat-value">{v}</div></div>
        ))}
      </div>
      <div className="section-card">
        <div className="section-head"><h3>Recent Purchase Orders</h3></div>
        {recent.length ? (
          <table className="data-table">
            <thead><tr><th>PO Number</th><th>Factory</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>
              {recent.map(p=>(
                <tr key={p.id} onClick={()=>navigate('order-detail',{id:p.id})}>
                  <td className="mono">{p.order_number||'—'}</td>
                  <td>{p.companies?.name||'—'}</td>
                  <td><Badge status={p.status} /></td>
                  <td>{fmtDate(p.order_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No orders yet</h3><p>Create your first purchase order to get started.</p></div>}
      </div>
    </>
  );
}

// ── Orders List ───────────────────────────────────────────────────────────────
function Orders({ navigate }) {
  const [rows, setRows]     = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const load = async (f) => {
    setLoading(true);
    let q = SB.from('purchase_orders').select('id,order_number,status,order_date,requested_ship_date,companies!factory_company_id(name)').order('created_at',{ascending:false});
    if (f && f!=='all') q = q.eq('status',f);
    const { data } = await q;
    setRows(data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(filter); },[filter]);
  return (
    <>
      <div className="filters">
        {['all',...STATUSES].map(s=>(
          <button key={s} className={`filter-btn ${filter===s?'active':''}`} onClick={()=>setFilter(s)}>{s.replace(/_/g,' ')}</button>
        ))}
      </div>
      <div className="section-card">
        {loading ? <div className="loading">Loading...</div> : rows.length ? (
          <table className="data-table">
            <thead><tr><th>PO Number</th><th>Factory</th><th>Status</th><th>Order Date</th><th>Ship By</th></tr></thead>
            <tbody>
              {rows.map(p=>(
                <tr key={p.id} onClick={()=>navigate('order-detail',{id:p.id})}>
                  <td className="mono">{p.order_number||'—'}</td>
                  <td>{p.companies?.name||'—'}</td>
                  <td><Badge status={p.status} /></td>
                  <td>{fmtDate(p.order_date)}</td>
                  <td>{fmtDate(p.requested_ship_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No orders</h3><p>No purchase orders match this filter.</p></div>}
      </div>
      {showCreate && <CreatePOModal onClose={()=>setShowCreate(false)} onCreated={id=>{setShowCreate(false);navigate('order-detail',{id});}} />}
    </>
  );
}

// ── Order Detail ──────────────────────────────────────────────────────────────
function OrderDetail({ id, navigate }) {
  const [po, setPO]       = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    const [{ data: p },{ data: its }] = await Promise.all([
      SB.from('purchase_orders').select('*,companies!factory_company_id(name,email)').eq('id',id).single(),
      SB.from('purchase_order_items').select('*,products(sku,name)').eq('purchase_order_id',id)
    ]);
    setPO(p); setItems(its||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[id]);
  const updateStatus = async (status) => {
    await SB.from('purchase_orders').update({status,updated_at:new Date().toISOString()}).eq('id',id);
    setPO(prev=>({...prev,status}));
  };
  const genPO = async () => {
    const { data, error } = await SB.rpc('po_document_json',{p_po_id:id});
    if (error||!data){alert('Error: '+(error?.message||'No data'));return;}
    const win=window.open('','_blank');
    win.document.write(buildPODoc(data));
    win.document.close();
    setTimeout(()=>{win.focus();win.print();},1000);
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
      </div>
      <div className="detail-grid">
        <div className="detail-block">
          <div className="blabel">Factory</div>
          <div className="bval">{po.companies?.name||'—'}</div>
          <div className="bsub">{po.companies?.email||''}</div>
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
      <div className="detail-block" style={{marginBottom:'20px',display:'flex',alignItems:'center',gap:'16px',flexWrap:'wrap'}}>
        <div className="blabel" style={{marginBottom:0}}>Status</div>
        <select className="status-select" value={po.status} onChange={e=>updateStatus(e.target.value)}>
          {STATUSES.map(s=><option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
        </select>
        {po.notes && <div style={{flex:1,fontSize:'12.5px',color:'var(--muted)',paddingLeft:'16px',borderLeft:'1px solid var(--line)'}}>{po.notes}</div>}
      </div>
      <div className="section-card">
        <div className="section-head"><h3>Line Items</h3></div>
        {items.length ? (
          <table className="data-table">
            <thead><tr><th>Product</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
            <tbody>
              {items.map(it=>(
                <tr key={it.id}>
                  <td><div style={{fontWeight:500}}>{it.products?.name||it.description||'—'}</div><div className="mono" style={{fontSize:'11px',color:'var(--muted)'}}>{it.products?.sku||''}</div></td>
                  <td className="mono">{fmtNum(it.quantity)}</td>
                  <td className="mono">{money(it.unit_price,po.currency)}</td>
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
    </>
  );
}

// ── Companies ────────────────────────────────────────────────────────────────
function Companies() {
  const types = ['client','factory','carrier','freight_forwarder','supplier','partner'];
  const [tab, setTab]   = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  useEffect(()=>{
    (async()=>{
      setLoading(true);
      const { data } = await SB.from('companies').select('*,contacts(full_name,email,is_primary)').eq('type',types[tab]).order('name');
      setRows(data||[]); setLoading(false);
    })();
  },[tab]);
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
                return <tr key={c.id}><td style={{fontWeight:500}}>{c.name}</td><td><Badge status={c.type} /></td><td>{p.full_name||'—'}</td><td>{p.email||'—'}</td></tr>;
              })}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No {types[tab].replace(/_/g,' ')}s yet</h3><p>Add your first to get started.</p></div>}
      </div>
      {showCreate && <CreateCompanyModal onClose={()=>setShowCreate(false)} onCreated={()=>{setShowCreate(false);}} />}
    </>
  );
}

// ── Products ─────────────────────────────────────────────────────────────────
function Products() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const load = async () => {
    setLoading(true);
    const { data } = await SB.from('products').select('*,product_categories(name)').order('name');
    setRows(data||[]); setLoading(false);
  };
  useEffect(()=>{ load(); },[]);
  return (
    <>
      <div className="section-card">
        {loading ? <div className="loading">Loading...</div> : rows.length ? (
          <table className="data-table">
            <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th>Pack</th><th>HS Code</th></tr></thead>
            <tbody>
              {rows.map(p=>(
                <tr key={p.id}>
                  <td className="mono" style={{fontSize:'12px'}}>{p.sku||'—'}</td>
                  <td><div style={{fontWeight:500}}>{p.name||'—'}</div>{p.description&&<div style={{fontSize:'11.5px',color:'var(--muted)'}}>{p.description.slice(0,60)}{p.description.length>60?'…':''}</div>}</td>
                  <td>{p.product_categories?.name||'—'}</td>
                  <td>{p.units_per_carton?`${fmtNum(p.units_per_carton)} pcs/ctn`:'—'}</td>
                  <td className="mono">{p.hs_code||'—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="empty"><h3>No products yet</h3><p>Add your product catalog to use in purchase orders.</p></div>}
      </div>
      {showCreate && <CreateProductModal onClose={()=>setShowCreate(false)} onCreated={()=>{setShowCreate(false);load();}} />}
    </>
  );
}

// ── Shipments ─────────────────────────────────────────────────────────────────
function Shipments() {
  const [rows, setRows]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    (async()=>{
      const { data } = await SB.from('shipments').select('*,companies!client_company_id(name)').order('created_at',{ascending:false});
      setRows(data||[]); setLoading(false);
    })();
  },[]);
  return (
    <div className="section-card">
      {loading ? <div className="loading">Loading...</div> : rows.length ? (
        <table className="data-table">
          <thead><tr><th>Shipment #</th><th>Client</th><th>Bill of Lading</th><th>Status</th><th>ETA</th></tr></thead>
          <tbody>
            {rows.map(s=>(
              <tr key={s.id}>
                <td className="mono">{s.shipment_number||'—'}</td>
                <td>{s.companies?.name||'—'}</td>
                <td className="mono">{s.bill_of_lading||'—'}</td>
                <td><Badge status={s.status} /></td>
                <td>{fmtDate(s.estimated_arrival)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="empty"><h3>No shipments yet</h3><p>Shipments appear here when orders move to the shipping stage.</p></div>}
    </div>
  );
}

// ── Create PO Modal ───────────────────────────────────────────────────────────
function CreatePOModal({ onClose, onCreated }) {
  const [mode, setMode]   = useState('quote'); // 'quote' | 'manual'
  const [factories, setFactories] = useState([]);
  const [products,  setProducts]  = useState([]);
  const [quotes, setQuotes] = useState([]);
  const [qLoading, setQLoading] = useState(true);
  const [qSearch, setQSearch] = useState('');
  const [picked, setPicked] = useState(null);   // chosen quote (form-shaped)
  const [tierIdx, setTierIdx] = useState(0);
  const [items, setItems] = useState([{prodId:'',qty:'',price:''}]);
  const [form, setForm]  = useState({ factoryId:'', num:`KUI-PO-${new Date().getFullYear()}-`, date:nowDate(), ship:'', inco:'', pay:'', dep:'', mold:'', sample:'', currency:'USD', notes:'' });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));

  useEffect(()=>{
    Promise.all([
      SB.from('companies').select('id,name').eq('type','factory').order('name'),
      SB.from('products').select('id,sku,name').order('name')
    ]).then(([{data:fac},{data:pro}])=>{ setFactories(fac||[]); setProducts(pro||[]); });
    // quotes live in the public schema (migrated quotes platform)
    SBQ.from('quotes').select('*').order('created_at',{ascending:false}).then(({data})=>{
      setQuotes(data||[]); setQLoading(false);
    });
  },[]);

  const addItem = () => setItems(prev=>[...prev,{prodId:'',qty:'',price:''}]);
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
    const matchProduct = products.find(p=>(q.sku && (p.sku||'').toLowerCase()===(q.sku||'').toLowerCase()) || (p.name||'').toLowerCase()===(q.product||'').toLowerCase());
    setForm(prev=>({...prev,
      factoryId: matchFactory?matchFactory.id:prev.factoryId,
      inco: q.country?`FOB ${q.country}`:prev.inco,
      mold: q.mold_fee!=null?String(q.mold_fee):prev.mold,
      sample: q.sample_fee!=null?String(q.sample_fee):prev.sample,
      notes: prev.notes || (q.notes||''),
    }));
    setItems([{ prodId: matchProduct?matchProduct.id:'', qty: t.qty!=null?String(t.qty):'', price: t.landed!=null?String(t.landed):'' }]);
  };
  const pickTier = ti => { if(picked) applyQuote(picked, ti); };

  const submit  = async () => {
    if (!form.factoryId||!form.num) { alert('Factory and PO number required'); return; }
    const { data: po, error } = await SB.from('purchase_orders').insert({
      factory_company_id:form.factoryId, order_number:form.num, order_date:form.date,
      requested_ship_date:form.ship||null, incoterm:form.inco||null, payment_terms:form.pay||null,
      deposit_percent:Number(form.dep)||null, mold_fee:Number(form.mold)||0, sample_fee:Number(form.sample)||0,
      currency:form.currency, notes:form.notes||null, status:'draft',
      source_quote_id: picked?.id || null
    }).select().single();
    if (error) { alert('Error: '+error.message); return; }
    for (const it of items) {
      if (it.prodId && Number(it.qty)>0) {
        await SB.from('purchase_order_items').insert({ purchase_order_id:po.id, product_id:it.prodId, quantity:Number(it.qty), unit_price:Number(it.price)||0, currency:form.currency });
      }
    }
    onCreated(po.id);
  };

  const avatar = name => (name||'?').slice(0,2).toUpperCase();

  return (
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
              <button className="x" onClick={()=>{setPicked(null);setItems([{prodId:'',qty:'',price:''}]);}}>Change</button>
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
                        <span className="qp-avatar">{avatar(q.client)}</span>
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
            <thead><tr><th style={{width:'44%'}}>Product</th><th>Qty</th><th>Unit Price</th><th style={{width:'36px'}}></th></tr></thead>
            <tbody>
              {items.map((it,i)=>(
                <tr key={i}>
                  <td><select value={it.prodId} onChange={e=>setItem(i,'prodId',e.target.value)}>
                    <option value="">Select product...</option>
                    {products.map(p=><option key={p.id} value={p.id}>{p.sku?p.sku+' — ':''}{p.name}</option>)}
                  </select></td>
                  <td><input type="number" value={it.qty} onChange={e=>setItem(i,'qty',e.target.value)} placeholder="0" /></td>
                  <td><input type="number" step="0.01" value={it.price} onChange={e=>setItem(i,'price',e.target.value)} placeholder="0.00" /></td>
                  <td><button className="rm" onClick={()=>rmItem(i)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {picked && <div style={{fontSize:'12px',color:'var(--muted)',marginBottom:'10px'}}>Prefilled from quote — edit any field before creating. If the product or factory didn't auto-match, pick it above.</div>}
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
  );
}

// ── Create Company Modal ──────────────────────────────────────────────────────
function CreateCompanyModal({ onClose, onCreated }) {
  const [form, setForm] = useState({name:'',type:'client',email:'',phone:'',website:'',cname:'',cemail:'',cphone:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const submit = async () => {
    if (!form.name) { alert('Company name required'); return; }
    const { data: co, error } = await SB.from('companies').insert({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null}).select().single();
    if (error) { alert('Error: '+error.message); return; }
    if (form.cname) await SB.from('contacts').insert({company_id:co.id,full_name:form.cname,email:form.cemail||null,phone:form.cphone||null,is_primary:true});
    onCreated();
  };
  const types = ['client','factory','carrier','freight_forwarder','supplier','partner'];
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
function buildPODoc(d) {
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
    <div><div class="lbl">Notes</div><div class="nb">${d.notes||''}</div>${t.total_cartons?`<div class="lbl" style="margin-top:22px">Logistics</div><div class="nb">${fn(t.total_cartons)} cartons · ${t.total_cbm} CBM · ${fn(t.total_gross_weight_kg)} kg</div>`:''}</div>
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
    products:  <button className="btn btn-dark" onClick={()=>setModal('create-product')}>+ New Product</button>,
    shipments: <button className="btn btn-dark" onClick={()=>alert('Coming soon')}>+ New Shipment</button>,
  };
  const [modal, setModal] = useState(null);

  const navigate = (p, pr={}) => { setPage(p); setParams(pr); };

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
      <Sidebar page={page} navigate={navigate} user={user} />
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
          {page==='products'     && <Products />}
          {page==='shipments'    && <Shipments />}
        </div>
      </div>
      )}
      {modal==='create-po'      && <CreatePOModal onClose={()=>setModal(null)} onCreated={id=>{setModal(null);navigate('order-detail',{id});}} />}
      {modal==='create-company' && <CreateCompanyModal onClose={()=>setModal(null)} onCreated={()=>setModal(null)} />}
      {modal==='create-product' && <CreateProductModal onClose={()=>setModal(null)} onCreated={()=>setModal(null)} />}
    </div>
  );
}
