// ── Sales Orders and Purchase Orders: what each list shows ───────────────────
// The two list pages' filtering, sorting and totals as pure functions, moved out
// of app/page.jsx unchanged so the page and its export read the very same list
// in the very same order. Nothing here writes or fetches.

// ── Shared status vocabulary (moved from app/page.jsx) ──────────────────────
export const SO_STATUSES = ['received','confirmed','testing','in_production','shipped','delivered','invoiced','closed'];
export const SO_SM = {
  received:     {label:'Received',     color:'#6366f1',bg:'#eef2ff'},
  confirmed:    {label:'Confirmed',    color:'#3461e0',bg:'#eff6ff'},
  in_production:{label:'In Production',color:'#d97706',bg:'#fffbeb'},
  testing:      {label:'Testing',      color:'#db2777',bg:'#fdf2f8'},
  shipped:      {label:'Shipped',      color:'#0891b2',bg:'#ecfeff'},
  delivered:    {label:'Delivered',    color:'#059669',bg:'#ecfdf5'},
  invoiced:     {label:'Invoiced',     color:'#7c3aed',bg:'#f5f3ff'},
  closed:       {label:'Closed',       color:'#64748b',bg:'#f8fafc'},
};
// Map shipment/PO-specific statuses onto the aligned SO status set so every tag matches
const STATUS_ALIAS = {
  created:'confirmed', at_origin_port:'shipped', in_transit:'shipped',
  at_transshipment:'shipped', at_destination_port:'shipped', customs:'shipped',
  out_for_delivery:'shipped', cancelled:'closed', ready_to_ship:'in_production',
};
export const alignStatus = s => STATUS_ALIAS[s] || s;
// A status as the lists' badges and filters name it.
export const statusLabel = s => (SO_SM[s] && SO_SM[s].label) || String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

const inSel = (sel, v) => !Array.isArray(sel) || sel.length === 0 || sel.includes(v);

// ── Sales Orders ──────────────────────────────────────────────────────────────
export const soMetrics = so => {
  const rev = (so.sales_order_items||[]).reduce((a,i)=>a+(Number(i.quantity)||0)*(Number(i.client_price)||0),0);
  const factoryCost = (so.sales_order_pos||[]).reduce((a,l)=>a+((l.purchase_orders?.purchase_order_items)||[]).reduce((b,i)=>b+(Number(i.quantity)||0)*(Number(i.unit_price)||0),0),0);
  const addlCost = (so.order_costs||[]).reduce((a,c)=>a+(Number(c.amount)||0),0);
  const cost = factoryCost + addlCost;
  return {rev, cost, factoryCost, addlCost, gross:rev-cost, mgn:rev>0?(rev-cost)/rev*100:null};
};
export const soUnits = so => (so.sales_order_items||[]).reduce((b,it)=>b+(Number(it.quantity)||0),0);

// One comparator per sort key, applied in the order they were ticked. A missing
// cargo ready date never compares as a date: no-CRD orders go last.
const SO_CMP = {
  newest:  (a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')),
  oldest:  (a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||'')),
  crd_asc: (a,b)=>{ const A=a.cargo_ready_date,B=b.cargo_ready_date;
                    if(!A&&!B) return 0; if(!A) return 1; if(!B) return -1;
                    return A.localeCompare(B); },
  crd_desc:(a,b)=>{ const A=a.cargo_ready_date,B=b.cargo_ready_date;
                    if(!A&&!B) return 0; if(!A) return 1; if(!B) return -1;
                    return B.localeCompare(A); },
};

// rows: as fetched (created_at descending). ui: { search, statusF, clientF }.
// sortBy and crdF: the page's sort and CRD choices.
export function soListView(rows, ui, sortBy, crdF) {
  const clients=[...new Set(rows.map(r=>r.client?.name).filter(Boolean))].sort();
  const preCrd=rows.filter(r=>{
    if(!inSel(ui.statusF,r.status)) return false;
    if(!inSel(ui.clientF,r.client?.name)) return false;
    if(ui.search){ const q=ui.search.toLowerCase(); return (r.so_number||'').toLowerCase().includes(q)||(r.client_po_number||'').toLowerCase().includes(q)||(r.client?.name||'').toLowerCase().includes(q); }
    return true;
  });
  const shownUnsorted=preCrd.filter(r=>inSel(crdF, r.cargo_ready_date ? 'has' : 'none'));
  // Nothing ticked is Newest SO -- the order the query already returns.
  const sortKeys = sortBy.length ? sortBy : ['newest'];
  const shown = sortKeys.length===1 && sortKeys[0]==='newest' ? shownUnsorted
              : [...shownUnsorted].sort((a,b)=>{
                  for(const k of sortKeys){ const c=(SO_CMP[k]||(()=>0))(a,b); if(c) return c; }
                  return 0;
                });
  const totals=shown.reduce((a,so)=>{ const m=soMetrics(so); return {rev:a.rev+m.rev,cost:a.cost+m.cost,n:a.n+1}; },{rev:0,cost:0,n:0});
  const totalMgn=totals.rev>0?(totals.rev-totals.cost)/totals.rev*100:null;
  const totalUnits = shown.reduce((a,so)=>a+soUnits(so),0);
  return { clients, preCrd, shown, totals, totalMgn, totalUnits };
}

// ── Purchase Orders ───────────────────────────────────────────────────────────
export const poClient   = p => p.client?.name || '';
export const poFactory  = p => p.factory?.name || p.companies?.name || '';
export const poProducts = p => (p.purchase_order_items||[]).map(it=>it.products?.name||it.description||'').join(' ');

export function filterPOs(rows, { search, client, status }){
  const s = (search||'').toLowerCase().trim();
  return (rows||[]).filter(p=>{
    if (!inSel(status, alignStatus(p.status))) return false;
    if (!inSel(client, poClient(p))) return false;
    if (s){
      const hay = ((p.client_po_number||'')+' '+(p.order_number||'')+' '+poClient(p)+' '+poFactory(p)+' '+poProducts(p)).toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}

// The Production Board's columns. A PO in any other status is not on the board.
export const PROD_COLUMNS = [
  { key:'confirmed',      label:'Confirmed',      color:'#0071E3' },
  { key:'sampling',       label:'Sampling',       color:'#AF52DE' },
  { key:'sample_approved',label:'Sample Approved',color:'#5856D6' },
  { key:'in_production',  label:'In Production',  color:'#FF9F0A' },
  { key:'ready_to_ship',  label:'Ready to Ship',  color:'#34C759' },
];

// ui: { search, client, status, view }. shown: the List view, in fetch order.
// onScreen: what the current view draws -- the list, or the board's cards
// column by column, which leaves out any PO whose status has no column.
export function poListView(rows, ui) {
  const shown = filterPOs(rows, { search: ui.search, client: ui.client, status: ui.status });
  const onScreen = ui.view === 'board'
    ? PROD_COLUMNS.flatMap(c => shown.filter(p => p.status === c.key))
    : shown;
  return { shown, onScreen, offBoard: ui.view === 'board' ? shown.length - onScreen.length : 0 };
}
