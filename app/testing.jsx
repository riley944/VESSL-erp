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
import { AddMaterialModal } from "@/app/components/AddMaterialModal";
import { FilterSelect } from "@/app/components/FilterSelect";
import { materialLabel } from "@/lib/materialLabel";
import { matches, normalizeTerm } from "@/lib/textFilter";

// ── helpers ──────────────────────────────────────────────────────────────────
const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
const daysUntil = s => { if(!s) return null; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); if(isNaN(d)) return null; return Math.round((d.getTime()-Date.now())/86400000); };
// eFiling has FOUR readings, not two, and the fourth is the one every product is in
// today. efiling_required is nullable with no default and null on all 271 rows: nobody
// has decided. That is not "not required" -- it is the absence of the decision -- and it
// is not "not filed" either, which a null efiled_date already says on its own.
//
// Tested with === on both branches, never truthiness. false and null are both falsy, so
// !p.efiling_required would read an undecided product as one Jenn had ruled exempt, and
// nothing on screen would say the reading was invented. That is the products.active
// mistake 0c41008 had to undo.
//
// A stored date outranks the judgement below it. A filing that happened is a fact;
// required is somebody's reading of the rules, and where the two disagree the fact is
// the one worth showing. Reachable today: 2 of 271 carry a date, both with required
// still unset.
const efilingKey = p =>
    p.efiled_date              ? 'filed'
  : p.efiling_required === false ? 'notreq'
  : p.efiling_required === true  ? 'unfiled'
  :                                'undecided';
// One place the four strings are written, so the row tooltip, the search index and the
// filter cannot drift apart. CreateProductModal repeats them rather than importing:
// that module is imported BY this one, and importing back would close a cycle -- the
// same reason fmtDay is duplicated there.
// "Not set" is the word for the undecided state, everywhere. EfilingModal's dropdown
// says "— Not set —" and that is where Jenn meets the concept, so it is the word she
// will type into the search box and look for on a pill. page.jsx's active cell already
// calls its undecided option the same thing, which makes this the app's word for the
// state rather than this feature's word for it.
const EFILING_LABEL = { filed:'eFiled', unfiled:'Not eFiled', notreq:'Not required', undecided:'Not set' };
const efilingTitle = p => {
  const k = efilingKey(p);
  if (k==='filed')   return 'eFiled '+fmtDate(p.efiled_date);
  if (k==='notreq')  return 'Not required — this product does not need eFiling';
  if (k==='unfiled') return 'Not eFiled — this product needs filing and no date is recorded';
  return 'Not set — nobody has recorded whether this product needs eFiling';
};
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
  // Blue, and blue on purpose. The two states TBD is likeliest to be misread as are
  // Pending (amber) and Not set (grey), and being neither of them is the entire reason
  // the option exists -- it is a decision to defer, where Not set is no decision and
  // Pending is work already under way. A fourth warm or neutral tone would have to be
  // read rather than recognised. Blue is the only hue not already spoken for here:
  // green passed, amber in-progress, red failed, grey absent.
  tbd:         { label:'TBD',         color:'#1D4ED8', bg:'#DBEAFE', dot:'#3B82F6' },
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
// The compliance-side mirror of efilingKey: one product, one bucket, one place the
// mapping lives. Written because the Compliance filter became a membership test and
// four bespoke predicates cannot be one.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ TBD IS WHY THIS HAS TO BE A TOTAL FUNCTION.                               │
// │                                                                           │
// │ The old filters were four independent tests -- two `includes`, one `===`, │
// │ one `!`. 'tbd' satisfied none of them, so 88 products (a third of the     │
// │ catalogue) matched no Compliance filter at all and were reachable only    │
// │ under All. Nothing reported it; the pill simply never returned them.      │
// │                                                                           │
// │ Every product lands in exactly one bucket now, so a value nobody has      │
// │ taught this map cannot go missing -- it falls to 'unset'. That is not     │
// │ strictly true of an unrecognised value, and it is the deliberate trade:   │
// │ visible in an approximate bucket beats invisible in none, which is the    │
// │ failure this exists to prevent recurring.                                 │
// └───────────────────────────────────────────────────────────────────────────┘
const complianceKey = p => {
  const s = effectiveStatus(p);
  return s === 'compliant' || s === 'passed' ? 'compliant'
       : s === 'pending'                     ? 'pending'
       : s === 'failed' || s === 'expired'   ? 'issues'
       : s === 'tbd'                         ? 'tbd'
       :                                       'unset';
};
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ EVERY FILTER SELECTION IS AN ARRAY, AND [] MEANS ALL.                     │
// │                                                                           │
// │ Route every "is anything narrowing" test through this. `[]` is TRUTHY in  │
// │ JavaScript, so `if (sel)` and `!!sel` are true for an empty selection --  │
// │ the same shape of trap as Boolean('') being false, inverted. Left to      │
// │ themselves, `filtered={!!prodFilter}` would claim a filter was active on  │
// │ a fresh page and the empty state would read "Nothing in this filter"      │
// │ instead of "No products yet".                                             │
// └───────────────────────────────────────────────────────────────────────────┘
const isAll = sel => !Array.isArray(sel) || sel.length === 0;
// Membership, never exclusion: All short-circuits to everything, otherwise the
// product's own bucket must be in the chosen set. No <> and no NOT anywhere.
const inSel = (sel, key) => isAll(sel) || sel.includes(key);
// Written to products.compliance_status. '' means clear it back to NULL.
//
// 'tbd' is lowercase like the other three because the column is plain nullable text
// with no CHECK -- nothing normalises what is stored, so the casing convention is the
// only thing keeping 'tbd' and 'TBD' from both existing and reading as one value.
//
// Placed next to — Not set — rather than in the pass/pending/failed run: both are the
// absence of a verdict, and the distinction between them is the one worth putting
// side by side. Not set means nobody has looked; TBD means someone looked and is
// deferring. Pending, further down, means the work is already under way.
const COMPLIANCE_OPTS = [['','— Not set —'],['tbd','TBD'],['passed','Pass'],['pending','Pending'],['failed','Failed']];
// Written to products.product_stage. '' means clear it back to NULL, which
// products_product_stage_check requires -- it accepts NULL, 'production' or 'sample'
// and would reject an empty string. Values lowercase, labels capitalised, the same
// split COMPLIANCE_OPTS uses.
const STAGE_OPTS = [['','— Not set —'],['production','Production'],['sample','Sample']];
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
  const [prodOrders, setProdOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // {type:'material'|'report'|'link', data}
  const [search, setSearch] = useState('');
  // ── Products filters: five multi-select axes plus Client ───────────────────
  // Each is an ARRAY and [] is All -- see isAll. They are separate states rather
  // than one because they are separate axes ANDed together: "Merlin products that
  // are not eFiled" is the actual question, and a single slot would make those two
  // mutually exclusive.
  //
  // Multi-select is what lets each one stay a membership test. "Pending or TBD" is
  // now expressible as a set, where a single slot could only have offered a
  // NOT-something pill to approximate it -- and a NOT over a nullable column is the
  // thing this file refuses to write.
  const [compSel,  setCompSel]  = useState([]);   // complianceKey's five returns
  const [efSel,    setEfSel]    = useState([]);   // efilingKey's four returns, verbatim
  const [brandSel, setBrandSel] = useState([]);   // merlin | non_merlin | unclassified
  const [stageSel, setStageSel] = useState([]);   // production | sample | notset
  const [dateSel,  setDateSel]  = useState([]);   // 30 | 60 | 90 | over90 | nolink
  // Client stays SINGLE-select: it is an identity, not a bucket, and 13 of them
  // behave differently from a five-item state list. FilterSelect serves both.
  const [clientFilter, setClientFilter] = useState(''); // '' | <company uuid> | unassigned
  const [matFilter, setMatFilter] = useState('');     // '' | passed | untested | attention
  const [repFilter, setRepFilter] = useState('');     // '' | pass | fail | expiring

  const load = async () => {
    setLoading(true);
    const [p, m, r, rg, lb, pm, pr, ord] = await Promise.all([
      // Every column CreateProductModal edits has to be named here. This select is not
      // `*`, so anything left off arrives undefined -- the modal renders that field blank
      // whatever the row holds, and Save writes null, or 0 for the numerics, back over it.
      //
      // Nine were missing: description, hts_code, unit_of_measure, weight_kg,
      // units_per_carton, carton_weight_kg and the three carton dimensions. The live path
      // is Testing -> Products -> click a row -> Save, and it needed no edit to fire:
      // opening a product and pressing Save was enough.
      //
      // unit_of_measure is the one with something to lose, 'pcs' on all 271. The other
      // eight are empty, so there the loss was potential rather than actual -- and
      // updated_at still equals created_at on every row, so nothing has been saved
      // through this modal yet and the bug has been live and unfired.
      //
      // brand_group and client_company_id are named for the same reason one step milder:
      // absent, they read as unclassified and unassigned rather than erasing anything.
      //
      // cpsc_code stays out deliberately. The payload omits it so a certificate number
      // written by hand survives an edit here, and a column the modal neither reads nor
      // writes has no business in the select.
      SB.from('products').select('id,sku,name,description,composition,hts_code,unit_of_measure,weight_kg,units_per_carton,carton_weight_kg,carton_l_cm,carton_w_cm,carton_h_cm,compliance_status,cpsc_type,product_stage,efiled_date,efiling_required,ships_to,trade_direction,importer_of_record,testing_paid_by,brand_group,client_company_id,client:companies!client_company_id(name)').order('sku',{nullsFirst:false}),
      // By MAT number, not by age. These twelve fibres are a reference library, not a
      // feed -- there is no "latest" worth surfacing, and newest-first put MAT-0013
      // (Tritan, added by hand after the import) above MAT-0001. A fixed order means a
      // material stays where you last saw it.
      //
      // A TEXT sort is a numeric sort here, and that is a property of the column rather
      // than luck: material_code defaults to 'MAT-' || lpad(nextval(...), 4, '0'), so
      // every code the app can generate is zero-padded to exactly four digits. Neither
      // writer sets the column, so the default always applies. It would stop holding at
      // MAT-10000, ~9,987 fibres away; parsing the number client-side to guard a
      // boundary that far off would cost more than it protects.
      //
      // nullsFirst:false, stated rather than inherited. The column is nullable, and a
      // material with no code leading a list ordered BY code reads as position 0 rather
      // than as missing data. All 13 have one today; this is about the fourteenth.
      SB.from('materials').select('*,supplier:companies!supplier_id(name)').order('material_code',{ascending:true,nullsFirst:false}),
      SB.from('test_reports').select('*,lab:labs(name),material:materials(name),product:products(name,sku),test_results(*)').order('test_date',{ascending:false}),
      // Secondary sort on code, because sort_order does not identify a row: the column
      // defaults to 100, so every rule created through RegModal without an explicit
      // number ties with 16 CFR 1633 and with every other such rule. Postgres may
      // return a tie in a different order between queries, which would reorder both
      // the Regulations tab and ReportModal's rule picker between page loads.
      SB.from('regulations').select('*').eq('active',true).order('sort_order').order('code'),
      SB.from('labs').select('*').order('name'),
      // material_code rides along on the join so the link row can label itself. That is
      // what lets Edit Product name a linked material without looking it up in a
      // materials list, so a fetch that failed or has not arrived cannot blank a real
      // link.
      SB.from('product_materials').select('*,material:materials(id,name,status,material_code)'),
      // Ids only. The rule rows themselves come from `regs` above, so joining
      // regulations here would fetch the same 82 rows a second time.
      SB.from('product_regulations').select('id,product_id,regulation_id'),
      // Order dates, as a separate fetch mapped by product_id -- the same shape
      // product_materials and product_regulations already use here, rather than hanging
      // an embed off the products select.
      //
      // Filtered to lines that actually resolved to a product: 78 of 196. The other 118
      // carry no product_id and could not be attributed to one anyway.
      SB.from('purchase_order_items').select('product_id,purchase_order_id,po:purchase_orders(order_date)').not('product_id','is',null),
    ]);
    setProducts(p.data||[]); setMaterials(m.data||[]); setReports(r.data||[]);
    setRegs(rg.data||[]); setLabs(lb.data||[]); setProdMats(pm.data||[]); setProdRegs(pr.data||[]);
    setProdOrders(ord.data||[]);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  // ── derived signals ──
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

  // Most recent order date and order count per product, from the PO lines that resolved
  // to one.
  //
  // ┌──────────────────────────────────────────────────────────────────────────┐
  // │ This measures LINKED lines, which is 78 of 196. A product with nothing    │
  // │ here has not been shown to be unordered -- its PO line could not be       │
  // │ matched to it. 212 of 271 are in that position, so the absence is the     │
  // │ common case and must never be worded as "never ordered". The caption      │
  // │ under the pills states the coverage for exactly this reason.              │
  // └──────────────────────────────────────────────────────────────────────────┘
  //
  // order_date itself is worth reading with suspicion: it defaults to CURRENT_DATE and
  // differs from created_at on only 12 of 54 POs, so on the other 42 it records when the
  // PO was typed in rather than when the order was placed.
  //
  // Compared as 'YYYY-MM-DD' strings, which sort correctly and keep this off the Date
  // round-trip that EfilingModal's comment warns about. Counting rows is counting orders:
  // purchase_order_items_purchase_order_id_product_id_key makes one product appear at
  // most once per PO.
  const ordersByProduct = useMemo(()=>{
    const map = {};
    prodOrders.forEach(r=>{
      if(!r.product_id) return;
      const d = r.po?.order_date || null;
      const cur = map[r.product_id] || { last:null, count:0 };
      cur.count += 1;
      if (d && (!cur.last || d > cur.last)) cur.last = d;
      map[r.product_id] = cur;
    });
    return map;
  },[prodOrders]);
  // Local date, not toISOString(): that returns UTC and would move the window boundary by
  // a day for anyone west of it.
  const isoDaysAgo = (n) => {
    const d = new Date(); d.setDate(d.getDate() - n);
    const pad = x => String(x).padStart(2,'0');
    return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
  };
  // Built from the products themselves, not from a companies fetch, so the list holds
  // only clients that actually have products and every count matches what the table
  // shows. Same approach the nav Products page takes with quotes.client -- different
  // object, different question, deliberately not the same control.
  //
  // Keyed on company id rather than name: two clients could share a name across types,
  // and the id is what the column stores.
  // ── Option lists for the five multi-selects ────────────────────────────────
  // Counts are over ALL products, not over what the other filters have already
  // narrowed. Two reasons: a live cross-filtered count changes under your hand as
  // you tick things, and a zero would then mean "not in the current result" rather
  // than "none exist" -- which is the one thing a count on a filter must not be
  // ambiguous about.
  //
  // Every list starts with an All row whose value is '' and whose count is the whole
  // catalogue. FilterSelect reads '' as "clear the set", so All is never a member.
  const countBy = useMemo(()=>{
    const c = {};
    const bump = k => { c[k] = (c[k]||0) + 1; };
    products.forEach(p=>{
      bump('c:'+complianceKey(p));
      bump('e:'+efilingKey(p));
      bump('b:'+(p.brand_group == null ? 'unclassified' : p.brand_group));
      bump('s:'+(p.product_stage == null ? 'notset' : p.product_stage));
    });
    return c;
  },[products]);
  const n = k => countBy[k] || 0;
  // PROD_STATUS carries the colour for each compliance bucket, so the dropdown rows
  // tint the same way the row pills do rather than inventing a second palette.
  const compOptions = useMemo(()=>[
    { value:'',          label:'All compliance', count:products.length },
    { value:'compliant', label:'Compliant',      count:n('c:compliant'), color:PROD_STATUS.compliant.dot },
    { value:'pending',   label:'Pending',        count:n('c:pending'),   color:PROD_STATUS.pending.dot },
    { value:'issues',    label:'Issues',         count:n('c:issues'),    color:PROD_STATUS.failed.dot },
    { value:'tbd',       label:'TBD',            count:n('c:tbd'),       color:PROD_STATUS.tbd.dot },
    { value:'unset',     label:'Not set',        count:n('c:unset'),     color:PROD_STATUS.not_set.dot },
  ],[countBy, products.length]);
  // Labels from EFILING_LABEL where it has one, so the dropdown, the row button and
  // the tooltip all say the same words. The two that would collide with a compliance
  // label are qualified: "Not set" already means compliance four rows up.
  const efOptions = useMemo(()=>[
    { value:'',          label:'All eFiling',           count:products.length },
    { value:'filed',     label:EFILING_LABEL.filed,     count:n('e:filed') },
    { value:'unfiled',   label:EFILING_LABEL.unfiled,   count:n('e:unfiled') },
    { value:'notreq',    label:'eFiling not required',  count:n('e:notreq') },
    { value:'undecided', label:'eFiling not set',       count:n('e:undecided') },
  ],[countBy, products.length]);
  const brandOptions = useMemo(()=>[
    { value:'',             label:'All brands',   count:products.length },
    { value:'merlin',       label:'Merlin',       count:n('b:merlin') },
    { value:'non_merlin',   label:'Non-Merlin',   count:n('b:non_merlin') },
    { value:'unclassified', label:'Unclassified', count:n('b:unclassified') },
  ],[countBy, products.length]);
  const stageOptions = useMemo(()=>[
    { value:'',           label:'All stages', count:products.length },
    { value:'production', label:'Production', count:n('s:production') },
    { value:'sample',     label:'Sample',     count:n('s:sample') },
    { value:'notset',     label:'Not set',    count:n('s:notset') },
  ],[countBy, products.length]);
  // No counts on the windows. They overlap -- 30 ⊂ 60 ⊂ 90 -- so a column of numbers
  // that do not sum to the total reads as an error rather than as nesting, and the
  // caption under the row already carries the coverage figure that matters.
  const dateOptions = useMemo(()=>[
    { value:'',       label:'Ordered · any' },
    { value:'30',     label:'Within 30 days' },
    { value:'60',     label:'Within 60 days' },
    { value:'90',     label:'Within 90 days' },
    { value:'over90', label:'Over 90 days' },
    { value:'nolink', label:'No linked order' },
  ],[]);
  const clientOptions = useMemo(()=>{
    const byId = new Map();
    products.forEach(p=>{
      if(!p.client_company_id) return;
      const cur = byId.get(p.client_company_id)
        || { value:p.client_company_id, label:p.client?.name || '(unnamed client)', count:0 };
      cur.count += 1;
      byId.set(p.client_company_id, cur);
    });
    const named = [...byId.values()].sort((a,b)=>a.label.localeCompare(b.label));
    const unassigned = products.filter(p=>p.client_company_id == null).length;
    return [
      { value:'', label:'All Clients', count:products.length },
      ...named,
      // Its own entry rather than an absence. The six products here are the ones whose
      // SKU names no guide prefix -- they are unresolved, not clientless, and they have
      // to be reachable without clearing the filter.
      ...(unassigned ? [{ value:'unassigned', label:'Unassigned', count:unassigned }] : []),
    ];
  },[products]);
  const orderCoverage = useMemo(()=>({
    withOrder: products.filter(p=>ordersByProduct[p.id]).length,
    total: products.length,
  }),[products, ordersByProduct]);

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
      // eFiling joins through its DISPLAYED state, not its value, for the same reason
      // cpsc_type does: nobody searches for a date, they search for the gap. All four
      // readings are indexed, so "Not set" reaches the 269 nobody has ruled on and
      // "Not required" reaches the exempt ones -- both new gaps, both otherwise
      // unfindable.
      // ships_to is joined explicitly rather than passed as an array. matches() would
      // stringify it to "US,JP" via Array.prototype.toString and happen to work, but
      // relying on that means a search silently changes if the field ever holds
      // anything but strings. Spaces, so "JP" matches without the comma.
      // Compliance joins the index through its DISPLAYED label, so "TBD" finds the
      // deferred products. It was not searchable AT ALL before this -- the pill row
      // covered four of the five states, and TBD is the first with no pill, so the
      // omission stopped being harmless. Adding the map rather than just TBD means
      // "Pass" and "Failed" become findable too, which they should always have been.
      // Falls back to not_set's label so an unset product answers "Not set", the same
      // shape cpsc_type's 'No CPSC' fallback uses.
      matches(q, p.name, p.sku, p.cpsc_type || 'No CPSC', EFILING_LABEL[efilingKey(p)],
              (PROD_STATUS[effectiveStatus(p) || 'not_set'] || {}).label,
              // Both words, though only Sample is ever rendered. "Which ones are
              // production" is as real a question as the other, and the word is
              // unambiguous -- searching for text the row does not show is the deliberate
              // exception here, not the rule. Nothing is indexed for null: there is no
              // label to find, and inventing one would make 271 rows answer a search for
              // a state nobody has recorded.
              p.product_stage === 'sample' ? 'Sample' : p.product_stage === 'production' ? 'Production' : null,
              (p.ships_to || []).join(' '), p.trade_direction, p.importer_of_record, p.testing_paid_by,
              // composition is searched but not rendered as text on the row -- the only
              // field here in that position. It runs to 57 characters on a real blend and
              // the Product cell already carries three lines and truncates, so a fourth
              // would ellipsise to "72% Cotton 18% Nyl...", which reads like a whole
              // answer and is not. The cell title carries it in full on hover instead,
              // which is what tells you why a search for "Spandex" matched.
              p.composition)
    );
    // ── Six axes, ANDed. Each is a membership test; none is an exclusion. ──────
    //
    // Compliance and eFiling both read a KEY FUNCTION -- complianceKey / efilingKey --
    // so the bucket a product is in is decided in one place and the filter, the row
    // dot, the tooltip and the search index cannot drift apart. That is also what
    // stops a value like 'tbd' from falling through every branch and vanishing, which
    // is exactly what the old four-independent-tests shape did to 88 products.
    if (!isAll(compSel))  list = list.filter(p => inSel(compSel,  complianceKey(p)));
    if (!isAll(efSel))    list = list.filter(p => inSel(efSel,    efilingKey(p)));
    // brand_group and product_stage are already key-shaped in the column. NULL is a
    // named bucket rather than a NOT, so an unclassified product appears under
    // Unclassified and under All, nowhere else.
    if (!isAll(brandSel)) list = list.filter(p => inSel(brandSel, p.brand_group == null ? 'unclassified' : p.brand_group));
    if (!isAll(stageSel)) list = list.filter(p => inSel(stageSel, p.product_stage == null ? 'notset' : p.product_stage));
    // Equality on both branches, never <> and never NOT -- the same rule brand_group
    // follows. client_company_id is NULL on the six products whose SKU names no guide
    // prefix; those are unresolved, not "some other client", and
    // p.client_company_id !== id would sweep all six into every named client's result.
    if (clientFilter==='unassigned') list = list.filter(p=>p.client_company_id == null);
    else if (clientFilter)           list = list.filter(p=>p.client_company_id === clientFilter);
    // ORDERED IS THE ONE THAT IS NOT A KEY FUNCTION, because its buckets are not a
    // partition: 30 ⊂ 60 ⊂ 90 are nested, so a product can be in three of them at
    // once. It is a UNION of the chosen windows instead -- ticking 30 and 60 means
    // "within 60", which is the honest reading of picking both. Still comparison per
    // window and still no NOT; just ORed rather than looked up.
    //
    // Rolling from today, so the windows drain as time passes without new linked
    // orders. 'nolink' is the absence of a linked line. 'over90' is the rest of the
    // linked set -- without it the 8 products whose most recent linked order predates
    // the cutoff matched nothing at all.
    //
    // One hole, documented rather than papered over: a product whose linked PO carries
    // a NULL order_date falls outside every window, since each needs o.last.
    // purchase_orders.order_date is nullable but defaults to CURRENT_DATE and is set
    // on all 54 rows, so this cannot happen today.
    if (!isAll(dateSel)) {
      const within = dateSel.filter(v => v==='30'||v==='60'||v==='90').map(Number);
      const cutoffs = within.map(isoDaysAgo);
      const over90 = isoDaysAgo(90);
      list = list.filter(p => {
        const o = ordersByProduct[p.id];
        if (dateSel.includes('nolink') && !o) return true;
        if (!o || !o.last) return false;
        if (dateSel.includes('over90') && o.last < over90) return true;
        return cutoffs.some(c => o.last >= c);
      });
    }
    return list;
    // Joined rather than passed raw: each selection is a fresh array identity on every
    // render, which would defeat the memo entirely.
  }, [products, q, compSel.join(), efSel.join(), brandSel.join(), stageSel.join(), dateSel.join(), clientFilter, ordersByProduct]);
  const shownMaterials = useMemo(() => {
    let list = !q ? materials : materials.filter(m =>
      // material_code is the identifier a person actually holds -- database-generated,
      // populated on every row, and now printed on the row itself -- so a pasted MAT-0007
      // has to find its material.
      // master_sku stays beside it though it is NULL on all 14 and MaterialModal's save
      // does not send it. What it is meant to hold is still open; leaving it in the list
      // costs nothing and means the search does not have to be remembered later.
      matches(q, m.name, m.material_type, m.supplier?.name, m.supplier_name, m.material_code, m.master_sku)
    );
    if (matFilter==='passed')    list = list.filter(m=>m.status==='passed');
    if (matFilter==='untested')  list = list.filter(m=>['untested','in_progress'].includes(m.status));
    if (matFilter==='attention') list = list.filter(m=>['failed','expired'].includes(m.status));
    return list;
  }, [materials, q, matFilter]);
  const shownReports = useMemo(() => {
    let list = !q ? reports : reports.filter(r =>
      // All FIVE headline fallbacks, since which one renders varies by row, plus the
      // regulation codes from the nested results grid.
      //
      // style_ref and sample_description joined the title chain and had to join this
      // with it: 73 of the 84 imported reports resolve to no material and no product, so
      // one of those two is the only text on the row, and searching for what you can see
      // has to find it. Same gap material_code had on the Materials tab -- a field
      // promoted to the visible identifier while the filter still looked past it.
      matches(q, r.report_number, r.lab?.name, r.material?.name, r.product?.sku, r.product?.name,
        r.style_ref, r.sample_description,
        // composition joins them for the same reason, one step removed: it is not on the
        // row at all, so searching "Spandex" or "PVC" is the ONLY way to reach the 48
        // reports carrying one. The value itself is read in ReportModal.
        r.composition,
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
    // Deliberately the same two statuses the 'attention' filter matches (see
    // shownMaterials): the tile navigates straight there, so counting anything that
    // filter excludes produces a number its own destination cannot show. Untested is
    // not here on purpose — it is a pill, for the reason the products pills are.
    matIssues: materials.filter(m=>['failed','expired'].includes(m.status)).length,
    expiring:  expiringReports.length,
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
  // Deliberately the same shape as setCompliance rather than a shared helper: two
  // columns, two error messages, and one write each. The '' -> null is what keeps
  // products_product_stage_check happy, which accepts NULL, 'production' or 'sample'
  // and nothing else -- an empty string would be rejected rather than stored.
  const setStage = async (prodId, value) => {
    setStatusErr('');
    const { error } = await SB.from('products').update({ product_stage: value || null }).eq('id', prodId);
    if (error) { setStatusErr('Could not save stage — ' + error.message); return; }
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
  // The multi-select version: a tile sets its axis to EXACTLY its own bucket, and
  // tapping it again goes back to All. It replaces the whole selection rather than
  // adding to it -- a tile is a shortcut to one answer, not a way to build a set.
  const gotoSel = (t, setter, current, val) => () =>
    { setTab(t); setSearch(''); setter(current.length===1 && current[0]===val ? [] : [val]); };
  const only = (sel, val) => sel.length===1 && sel[0]===val;
  // Follows the eFiling dropdown, over all products rather than over what is on
  // screen -- so Brand, Stage, Client and the search box do not move it. All reads
  // the full catalogue; Not eFiled reads 125.
  //
  // DISPLAY ONLY, and the only inert tile in the row. Its number mirrors a control,
  // so letting it also drive that control would be a loop: you could not tell
  // whether the tile was reporting the dropdown or setting it.
  //
  // It is also the only tile that is not a count of things needing attention. The
  // label carries that -- it names the selection rather than a problem -- but it is
  // a different kind of number sitting in a row that was homogeneous, which is worth
  // knowing before reading 271 as 271 problems.
  const efTileCount = isAll(efSel) ? products.length
                    : products.filter(p => efSel.includes(efilingKey(p))).length;
  const efTileLabel = isAll(efSel) ? 'eFiling \u00b7 all'
                    : efSel.length === 1 ? (EFILING_LABEL[efSel[0]] || 'eFiling')
                    : 'eFiling \u00b7 ' + efSel.length + ' selected';
  const pulse = [
    { k:'Compliant',        v:counts.compliant, c:'#30D158', go:gotoSel('products',setCompSel,compSel,'compliant'), on:tab==='products'&&only(compSel,'compliant') },
    { k:'Pending decision', v:counts.pending,   c:'#FF9F0A', go:gotoSel('products',setCompSel,compSel,'pending'),   on:tab==='products'&&only(compSel,'pending') },
    { k:'Issues',           v:counts.issues,    c:'#FF375F', go:gotoSel('products',setCompSel,compSel,'issues'),    on:tab==='products'&&only(compSel,'issues') },
    { k:'Material issues',  v:counts.matIssues, c:'#FF9F0A', go:goto('materials',setMatFilter,matFilter,'attention'), on:tab==='materials'&&matFilter==='attention' },
    { k:'Expiring \u2264'+EXPIRY_WINDOW_DAYS+'d', v:counts.expiring, c:'#FF375F', go:goto('reports',setRepFilter,repFilter,'expiring'), on:tab==='reports'&&repFilter==='expiring' },
    { k:efTileLabel,        v:efTileCount,      c:'#0A84FF', go:null, on:false },
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
          // A div when there is nowhere to go: the eFiling tile reports a control it
          // must not drive, and a <button> that does nothing on click is worse than
          // something that never looked clickable.
          <button key={m.k} onClick={m.go || undefined} disabled={!m.go} style={{background:m.on?'#1D1D1F':'#fff',borderRadius:'16px',padding:'14px 16px',border:'none',boxShadow:'0 1px 3px rgba(0,0,0,.04)',cursor:m.go?'pointer':'default',textAlign:'left',transition:'.15s'}}>
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
        {/* ── Six filters, one row of dropdowns ────────────────────────────────
            Four pill rows became four multi-selects. The rows had grown to eleven
            pills on one line plus three captioned rows beneath, and every axis
            still only answered one value at a time.

            MULTI-SELECT IS THE POINT, not the space it saves. Each control is a
            membership test against a chosen set, so "Pending or TBD" is a thing you
            can ask. A single-value control could only have approximated that with a
            NOT-something option, and a NOT over a nullable column is what sweeps the
            unclassified rows into every answer -- the mistake brand_group and
            client_company_id both carry comments against.

            Each dropdown carries its own live counts, which eleven pills on one line
            could not have done.

            GONE: the No CPSC and No trade info pills. Both were worklists and
            nothing else finds those products now; that is accepted, not overlooked. */}
        {tab==='products' && (
          <div style={{display:'flex',gap:'8px',flexWrap:'wrap',alignItems:'center',width:'100%'}}>
            <FilterSelect multiple label="All compliance" value={compSel}  onChange={setCompSel}  options={compOptions} />
            <FilterSelect multiple label="All eFiling"    value={efSel}    onChange={setEfSel}    options={efOptions} />
            <FilterSelect multiple label="All brands"     value={brandSel} onChange={setBrandSel} options={brandOptions} />
            <FilterSelect multiple label="All stages"     value={stageSel} onChange={setStageSel} options={stageOptions} />
            <FilterSelect multiple label="Ordered · any"  value={dateSel}  onChange={setDateSel}  options={dateOptions} />
            {/* Single-select: a client is an identity, not a bucket, and the 13 of
                them behave nothing like a five-item state list. */}
            <FilterSelect label="All Clients" value={clientFilter} onChange={setClientFilter} options={clientOptions} />
            {/* The caption is not decoration. Only a fraction of products have a
                reachable order date, so picking "90 days" and seeing a small number
                reads as "only this many were ordered in 90 days" -- when the truth is
                the rest were never checked, because their PO line could not be matched
                to a product. It stops being needed when coverage improves, and the
                numbers are live so it will say so. */}
            <span style={{flexBasis:'100%',height:0}} />
            <span style={{fontSize:'11.5px',color:'#A0A0A4',lineHeight:1.5}}>
              {'Order dates cover '+orderCoverage.withOrder+' of '+orderCoverage.total+' products — the rest have no linked PO line, which is not the same as never ordered.'}
            </span>
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
          {tab==='products'  && <ProductsView products={shownProducts} prodMats={prodMats} prodRegs={prodRegs} productStatus={productStatus} onLink={(p)=>setModal({type:'link',data:p})} onLinkRules={(p)=>setModal({type:'linkrules',data:p})} onEfiling={(p)=>setModal({type:'efiling',data:p})} onSetStatus={setCompliance} onSetStage={setStage} onEdit={(p)=>setModal({type:'product',data:p})} onDelete={deleteProduct} searching={searching} term={search.trim()} filtered={!(isAll(compSel) && isAll(efSel) && isAll(brandSel) && isAll(stageSel) && isAll(dateSel) && !clientFilter)} ordersByProduct={ordersByProduct} orderFiltered={!isAll(dateSel)} />}
          {/* No onTest: the per-material shortcut into ReportModal went with the Testing
              column. "+ Log Test Report" in the header is the way in, and its Material
              dropdown is what picks the material. */}
          {tab==='materials' && <MaterialsView materials={shownMaterials} onEdit={(m)=>setModal({type:'material',data:m})} onDelete={deleteMaterial} searching={searching} term={search.trim()} filtered={!!matFilter} />}
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
      {/* matLinks is this product's link rows, carrying the joined material so the modal
          can name what is linked without consulting a materials list. It takes no
          materials array: the block is read-only, so there is nothing to choose from. */}
      {modal?.type==='product'  && <CreateProductModal data={modal.data} regs={regs} links={modal.data ? prodRegs.filter(l=>l.product_id===modal.data.id) : []} matLinks={modal.data ? prodMats.filter(l=>l.product_id===modal.data.id) : []} onClose={()=>setModal(null)} onCreated={()=>{setModal(null);load();}} />}
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
// ONE template for the header and the rows, because they have to resolve identically and
// two copies of a string cannot be relied on to.
//
// The last track is a fixed width and not max-content, which is what the misalignment
// actually was. max-content is resolved per grid from that grid's own contents: the
// header's last cell is '', so its track measured 0, while a row's last cell holds four
// controls and measured ~320px. fr tracks divide what is LEFT after the fixed and
// intrinsic ones, so the header had ~320px more to share out, both of its flexible
// columns came out wider, and every label from column 2 rightward drifted right of the
// cells it names -- Stage landing over the Materials button.
//
// Fixed on both sides removes the dependency on content entirely. 340px is the widest
// realistic actions cell -- Materials, Rules, eFiling and delete, each nowrap, with the
// two counts at their longest -- plus room to spare; the cell is right-aligned, so any
// surplus is invisible rather than a gap.
const PROD_COLS = 'minmax(200px,1.2fr) minmax(160px,1fr) 170px 130px 340px';

function ProductsView({ products, prodMats, prodRegs, productStatus, onLink, onLinkRules, onEfiling, onSetStatus, onSetStage, onEdit, onDelete, searching, term, filtered, ordersByProduct = {}, orderFiltered = false }) {
  // Mid-search the "how records get created" copy would be misleading — the record may
  // well exist, it just does not match.
  // The order filters get their own empty copy. "Nothing in this filter" would be read as
  // "nothing was ordered in that window", and for these five pills that is the one
  // sentence the data cannot support: what is missing is the LINK, on 212 of 271
  // products, not the order.
  if(!products.length) return searching
    ? <Empty title={'No products match \u201C'+term+'\u201D'} sub="Try a different term, or clear the search / filter." />
    : orderFiltered
    ? <Empty title="No products with a linked order in this window"
             sub="These filters read purchase order lines that resolved to a product. Most products have no linked line, which is not the same as never ordered." />
    : filtered
    ? <Empty title="Nothing in this filter" sub="Try a different term, or clear the search / filter." />
    : <Empty title="No products yet" sub="Products appear here once they exist. Open one to link the materials it is built from and set its compliance status." />;
  return (
    <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
      {/* Five columns. Compliance keeps third, where it has always been, and Stage takes
          fourth. Ordering here is about muscle memory rather than meaning: Compliance is
          an existing control people already reach for by position, and moving it to make
          room for a new one costs more than putting the new one alongside.

          Stage's track is a fixed 130px against Compliance's 170px, its longest option
          being "Production" versus "— Not set —". Fixed rather than flexible so it cannot
          take width from the two minmax tracks, which is where the cost of a fifth column
          would otherwise land: only Product and Built from flex, and the Product cell is
          three lines truncating at its 200px floor.

          Template comes from PROD_COLS, shared with the rows below. Track widths and cell
          order have to move together; the HEADERS no longer track them one-to-one -- see
          below. */}
      {/* Four labels over five tracks, on purpose.

          STAGE spans tracks 3 and 4, covering both dropdowns, and COMPLIANCE sits over
          track 5, the action buttons -- because Materials, Rules and eFiling ARE the
          compliance tools, and grouping the label with them says what that cluster is
          for. Chosen deliberately: it happens to resemble what dc3bff7 fixed, where the
          same labels landed over the buttons through max-content drift rather than
          intent. The difference is that the drift also made the tracks themselves
          disagree between header and rows; this does not touch the tracks at all.

          Both spanning labels are centred rather than left-aligned. Left-aligned, STAGE
          sat at the start of track 3 -- directly over the Compliance dropdown, naming the
          wrong control. Centred across its two tracks it reads as belonging to the pair
          rather than to either one, which is what a spanning label is for.

          The consequence to know is that neither label sits over a single control any
          more. That is the trade this arrangement makes.

          COMPLIANCE is centred rather than right-aligned, to sit over the button group
          rather than over the track's edge. Only approximately: the buttons hug the
          right of a 340px track and their width moves with the two counts, so the label
          centres on the track, not on the group. */}
      <div style={{display:'grid',gridTemplateColumns:PROD_COLS,gap:'16px',padding:'13px 22px',borderBottom:'1px solid rgba(0,0,0,.06)',background:'#FAFAFB'}}>
        {[{label:'Product'},{label:'Built from'},{label:'Stage',span:2,align:'center'},{label:'Compliance',align:'center'}].map(({label,span,align},i)=>(
          <div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:align||'left',...(span?{gridColumn:'span '+span}:null)}}>{label}</div>
        ))}
      </div>
      {products.map((p,i)=>{
        const links = prodMats.filter(l=>l.product_id===p.id);
        // Counts LINK rows, not resolved rules, so a link to a retired rule still
        // counts here even though the modal cannot name it.
        const ruleCount = prodRegs.filter(l=>l.product_id===p.id).length;
        const ord = ordersByProduct[p.id];
        const st = effectiveStatus(p);
        const derived = productStatus(p.id);
        const dInfo = PROD_STATUS[derived] || PROD_STATUS.not_set;
        return (
          <div key={p.id} onClick={()=>onEdit(p)} style={{display:'grid',gridTemplateColumns:PROD_COLS,gap:'16px',padding:'15px 22px',borderTop:i>0?'1px solid #F5F5F7':'none',alignItems:'center',cursor:'pointer',transition:'.12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            {/* Composition rides on the title rather than the row. It is free text that
                runs to 57 characters on a real blend -- "72% Cotton 18% Nylon 6%
                Polyester 2% Spandex 2% Elastodiene" -- and this cell is already three
                lines that truncate at its 200px floor, so a fourth would ellipsise to
                something that reads like a whole answer and is not.
                It is searchable, though, so a hover has to be able to say why a search
                for "Spandex" matched this row. Undefined when unrecorded, which renders
                no tooltip at all rather than an empty one. */}
            <div style={{minWidth:0}} title={p.composition || undefined}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.name||'—'}</div>
              {/* Type only. The certificate number that used to sit beside it in the
                  modal was removed as unused, not moved here — its column has never
                  held a value. 'No CPSC' rather than nothing: every product is
                  unset today and the gap is the thing worth seeing. Deliberately the
                  same muted colour as the SKU — GCC vs CPC says which rule applies,
                  not pass or fail, so colouring it would imply a judgement. */}
              {/* A third segment when there is a linked order, and NOTHING when there is
                  not. 212 of 271 would otherwise carry the same placeholder, which is how
                  73 test reports all came to be titled "Report" -- text on every row stops
                  being read and crowds out the text that is not on every row. Silence also
                  asserts nothing, and any wording here would be asserting something about
                  a product whose orders simply could not be reached.

                  It is last in the line and the line ellipsises, so on a long SKU or a
                  narrow window this is the segment that disappears. That is the right one
                  to lose, and it is 59 rows. */}
              <div style={{fontSize:'12px',color:'#86868B',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[p.sku, p.cpsc_type || 'No CPSC', ord && ord.last ? 'Last ordered '+fmtDate(ord.last)+' \u00b7 '+ord.count+' order'+(ord.count===1?'':'s') : null].filter(Boolean).join(' \u00b7 ')}</div>
              {/* Its own line rather than a fourth segment above. That line is already at
                  capacity and truncates; a client appended to it would be the piece that
                  disappears, on the rows where it matters.
                  Client is also a GROUPING attribute -- it is read down the column, not
                  across the row -- and that only works from a fixed vertical position,
                  which a segment after a variable-length SKU is not.
                  Nothing rendered when unresolved, same rule as the order segment. Here
                  the blank is rare (6 of 271) rather than the norm, so it reads as the
                  exception it is. */}
              {p.client?.name && <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.client.name}</div>}
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
            {/* Modelled on the compliance select to its left, down to the stopPropagation
                that stops changing a value from also opening the modal.

                No optimistic update, same as compliance: the select is controlled from
                `products`, so a rejected write leaves the cell showing what the database
                still holds rather than what was picked. products_product_stage_check is
                a real constraint, so a rejected write is reachable here.

                Uncoloured, unlike compliance. Production and Sample are not better and
                worse, they are different things -- the same reason cpsc_type is rendered
                in the muted colour rather than a judgement colour. */}
            <div style={{minWidth:0}} onClick={e=>e.stopPropagation()}>
              <select
                value={p.product_stage||''}
                onChange={e=>onSetStage(p.id,e.target.value)}
                aria-label={'Stage for '+(p.sku||p.name||'product')}
                style={{border:'1px solid rgba(0,0,0,.1)',borderRadius:'8px',padding:'5px 8px',fontSize:'12px',fontWeight:600,color:p.product_stage?'#1D1D1F':'#8A8A8E',background:'#fff',cursor:'pointer',fontFamily:'inherit',outline:'none',maxWidth:'100%'}}
              >
                {STAGE_OPTS.map(([v,l])=><option key={v||'none'} value={v}>{l}</option>)}
              </select>
            </div>
            {/* The row itself opens the editor, so anything clickable inside it has to
                stop the event or it would do both. */}
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',alignItems:'center'}}>
              {/* Counted like Rules beside it, and suppressed at zero for the same
                  reason. Two adjacent pills where one counts and the other never does
                  read as "this one has nothing to count" rather than "this one does not
                  say", which is most of why the materials control was hard to find at
                  all. links is already computed above for the Built from cell.

                  A count and not eFiling's dot: filing is binary so a dot is the right
                  shape there, but a dot here would throw away the difference between
                  one material and five, which is the thing worth opening the cell for. */}
              <button onClick={e=>{e.stopPropagation();onLink(p);}} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Materials{links.length>0 && ' ('+links.length+')'}</button>
              <button onClick={e=>{e.stopPropagation();onLinkRules(p);}} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:'#1D1D1F',cursor:'pointer'}}>Rules{ruleCount>0 && ' ('+ruleCount+')'}</button>
              {/* Four states now, and a dot cannot carry four readings — so the dot keeps
                  only the distinction worth scanning for and the tooltip carries the
                  meaning, which is the split page.jsx's active cell already uses.

                  GREEN FILLED, filed: a date is stored.
                  HOLLOW RING, needs filing and has none: the actionable gap, and the one
                    the "Not eFiled" pill collects.
                  GREY FILLED, undecided: something is missing, but a decision, not a
                    filing. Filled rather than hollow so it does not read as the gap above.
                  EM DASH, not required: nothing to scan for. A dot of any colour would
                    put it in the same visual class as the two that want work; the em dash
                    is page.jsx's glyph for a cell with nothing to say. */}
              {/* Muted whole, not just the dot, when nothing is required. Swapping only
                  the dot left a button identical in weight to the three that want
                  something, which is not a difference you catch scanning a column of
                  271. Faded TEXT rather than opacity or a paler background: page.jsx
                  mutes an inert cell by colour (var(--faint) on its em-dash cell) and
                  reserves opacity for controls that are actually disabled, which this
                  one must never be.

                  Still a live button, deliberately not `disabled`. EfilingModal is the
                  only route from No back to Yes, so disabling it here would seal the
                  value in with no way out -- the state would be unreachable from the one
                  screen that can change it. The tooltip stays on for the same reason:
                  it is what says WHY the button looks spent. */}
              <button onClick={e=>{e.stopPropagation();onEfiling(p);}} title={efilingTitle(p)} style={{display:'inline-flex',alignItems:'center',gap:'6px',background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'6px 12px',fontSize:'12px',fontWeight:600,color:efilingKey(p)==='notreq'?'#A0A0A4':'#1D1D1F',cursor:'pointer',whiteSpace:'nowrap'}}>
                {efilingKey(p)==='notreq'
                  ? <span style={{fontSize:'11px',color:'#C7C7CC',lineHeight:1,flexShrink:0}}>—</span>
                  : <span style={{width:'7px',height:'7px',borderRadius:'50%',flexShrink:0,
                      background: efilingKey(p)==='filed' ? '#30D158' : efilingKey(p)==='undecided' ? '#C7C7CC' : 'transparent',
                      border: efilingKey(p)==='unfiled' ? '1.5px solid #C7C7CC' : 'none'}}/>}
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
// Material, Type and Supplier, and nothing else. Status and the testing clock were
// dropped from the row: what a material IS belongs here, and where it is up to in the
// lab is answered by the Test Reports tab, which holds the reports themselves.
//
// Status survives as a dot on the name, because the Untested pill and the Material
// issues tile both filter this list on m.status and a filter has to be able to show
// its own criterion. It is a dot and not the column it replaced: the pill already
// names the status in words, so the row only has to distinguish, not label.
function MaterialsView({ materials, onEdit, onDelete, searching, term, filtered }) {
  if(!materials.length) return (searching || filtered)
    ? <Empty title={searching?('No materials match \u201C'+term+'\u201D'):'Nothing in this filter'} sub="Try a different term, or clear the search / filter." />
    : <Empty title="No materials yet" sub="Add a material (fabric, dye, zipper…) — it's the unit that gets tested and that SKUs inherit compliance from." />;
  return (
    <div style={{background:'#fff',borderRadius:'20px',boxShadow:'0 1px 3px rgba(0,0,0,.04)',overflow:'hidden'}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(200px,1.3fr) 110px minmax(120px,1fr) 120px',gap:'14px',padding:'13px 22px',borderBottom:'1px solid rgba(0,0,0,.06)',background:'#FAFAFB'}}>
        {['Material','Type','Supplier',''].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i===3?'right':'left'}}>{h}</div>)}
      </div>
      {materials.map((m,i)=>{
        // The subtitle leads with the identifier on every row, so it sits at the same
        // offset down the list and can be scanned like a column without being one.
        // Composition joins it only where it says something the name does not.
        //
        // That branch is DORMANT: materials are fibres now -- Cotton, Polyester -- and
        // composition is null on all 12, so showComp is false on every row and the
        // subtitle is the code alone. It is kept rather than deleted because it costs one
        // expression and is the correct behaviour if the column is ever populated again;
        // deleting it would mean a repopulated composition silently never rendered.
        //
        // It was written for the previous shape, where a material WAS a composition
        // string and the import wrote the same value to name and composition, so the two
        // matched and the subtitle would otherwise have printed it twice. Compared
        // trimmed because MaterialModal trimmed name but not composition.
        // Built by filter/join rather than a conditional suffix so a row with no
        // material_code degrades to composition alone instead of a dangling separator.
        const ms = MAT_STATUS[m.status] || MAT_STATUS.untested;
        const showComp = m.composition && m.composition.trim() !== (m.name||'').trim();
        const sub = [m.material_code, showComp?m.composition:null].filter(Boolean).join(' · ');
        return (
          <div key={m.id} onClick={()=>onEdit(m)} style={{display:'grid',gridTemplateColumns:'minmax(200px,1.3fr) 110px minmax(120px,1fr) 120px',gap:'14px',padding:'15px 22px',borderTop:i>0?'1px solid #F5F5F7':'none',alignItems:'center',cursor:'pointer',transition:'.12s'}} onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <div style={{minWidth:0}}>
              {/* The status, as a dot on the name rather than a column. The Untested pill
                  and the Material issues tile both filter this list on m.status, and a
                  filter whose criterion is invisible on the rows it returns is the same
                  fault as a tile pointing at a filter that excludes what it counts. Same
                  map and same untested fallback as the dots on the product row, so one
                  material reads identically in both places. */}
              <div style={{display:'flex',alignItems:'center',gap:'7px',minWidth:0}}>
                <span title={ms.label} aria-label={ms.label} style={{width:'7px',height:'7px',borderRadius:'50%',background:ms.dot,flexShrink:0}}/>
                <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
              </div>
              {/* Indented by the dot's width plus its gap so the two text lines still
                  start at the same x. */}
              {sub&&<div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',marginLeft:'14px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>}
            </div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E',textTransform:'capitalize',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.material_type||'—'}</div>
            <div style={{fontSize:'12.5px',color:'#4A4A4E',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.supplier?.name||m.supplier_name||'—'}</div>
            <div style={{display:'flex',gap:'6px',justifyContent:'flex-end',alignItems:'center'}}>
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
                  {/* Six links, most specific first. The imported reports mostly resolve
                      to nothing -- 11 of 84 carry a product and none a material -- so
                      without the last three every one of the rest rendered as the word
                      "Report" and the list read as 73 identical rows.

                      style_ref is what the lab register actually identified the sample
                      by, and is the right answer whenever it exists; sample_description
                      is the lab's own wording and the last thing that still says
                      something. 'Report' now only shows for a row carrying none of the
                      five, which no imported row does. */}
                  <div style={{fontSize:'14px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.material?.name||r.product?.sku||r.product?.name||r.style_ref||r.sample_description||'Report'}</div>
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
              {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{display:'inline-block',marginTop:'11px',fontSize:'12.5px',color:'#0A84FF',fontWeight:600,textDecoration:'none'}}>View report PDF →</a>}
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
  // composition is deliberately absent. A material is a FIBRE now -- Cotton,
  // Polyester, Spandex -- and a fibre does not have a composition, it is one. The
  // column stays on the table and is null on all 12; this modal simply stops offering
  // it, and omitting the key means an edit here leaves whatever a row still holds
  // alone rather than nulling it.
  const [f,setF]=useState({ name:data?.name||'', material_type:data?.material_type||'', supplier_name:data?.supplier_name||'', color:data?.color||'', notes:data?.notes||'' });
  const [saving,setSaving]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  // Checked, not discarded -- the same shape LabModal uses, and for the reason its
  // comment gives. Until now the result was thrown away and onSaved() ran either way,
  // so a refused write closed the modal, reloaded the parent and reported success for
  // a material that was never saved. That is why nobody could say whether this modal
  // had ever written a row: a rejected insert and a never-clicked button looked
  // identical from outside.
  //
  // vessl.materials.name is UNIQUE as of materials_name_key, so 23505 is now reachable
  // from here for the first time -- both on a new material and on renaming one onto
  // another's name. The message matches AddMaterialModal's leading sentence, since the
  // two are the only writers of this table and the same collision should not read as
  // two different problems.
  const save=async()=>{
    const name=f.name.trim();
    // Was a bare return, which made Save do nothing at all with no reason given.
    if(!name){ toast('A material name is required','err'); return; }
    setSaving(true);
    const payload={ name, material_type:f.material_type||null, supplier_name:f.supplier_name||null, color:f.color||null, notes:f.notes||null };
    const { error } = data?.id
      ? await SB.from('materials').update(payload).eq('id',data.id)
      : await SB.from('materials').insert(payload);
    setSaving(false);
    if(error){
      const dupe = error.code === '23505' || /materials_name_key/i.test(error.message||'');
      toast(dupe
        ? 'A material with that name already exists — give this one a different name.'
        : 'Could not save material: '+error.message, 'err');
      return;   // stay open so the entry is not lost, and no onSaved: nothing was written
    }
    onSaved();
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
    composition:(editing?data.composition:'')||'',
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
    // Create only. The guard exists to stop the modal MAKING an orphan -- a report
    // logged against nothing is a record of nothing, and picking the material is the
    // first thing you do here.
    //
    // On edit it was doing something else entirely: refusing to save a report that is
    // legitimately unlinked. The imported test reports carry a style ref that mostly
    // does not resolve to a product, so most of them have neither id, and the guard
    // made every one of them read-only -- a wrong date could not be corrected, a PDF
    // link could not be added. The only way past it was to attach an unrelated product
    // to satisfy it, which is worse than not saving.
    //
    // Both columns are nullable and both foreign keys are ON DELETE CASCADE, so an
    // unlinked report is a state the schema allows and the reports list already renders.
    if(!editing && !f.material_id && !f.product_id){ alert('Pick a material or product'); return; }
    setSaving(true);
    // Only lines carrying a regulation are written (see `rows` below), so those are the
    // ones a verdict can be derived FROM. The old code tested every line including the
    // blank one the form always starts with, so a report with nothing filled in derived
    // 'pass' -- no fails found, therefore passed.
    //
    // With no scored lines there is nothing to derive and the stored verdict stands.
    // That matters for reports whose result was recorded without a per-regulation
    // breakdown: a fail with no lines would otherwise be silently flipped to pass by
    // someone opening it to read it, and the value it was flipped from would be gone.
    //
    // On create with no lines the key is omitted entirely so the column default,
    // 'pending', applies. A report nobody has scored has not passed.
    const scored = lines.filter(l=>l.regulation_id);
    const payload={
      material_id:f.material_id||null, product_id:f.product_id||null, lab_id:f.lab_id||null,
      report_number:f.report_number||null, test_date:f.test_date||null, expiry_date:f.expiry_date||null,
      manufacture_place:f.manufacture_place||null, sample_description:f.sample_description||null,
      // Named here as well as bound to the input below. The two go together: an input
      // whose column the payload omits looks like it saves and does not, which is the
      // shape the products select had.
      composition:f.composition||null,
      pdf_url:f.pdf_url||null,
    };
    if (scored.length) payload.overall_result = scored.some(l=>l.result==='fail') ? 'fail' : 'pass';
    else if (editing) payload.overall_result = data.overall_result ?? null;
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
    const rows=scored.map(l=>{
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
          {/* Labelled through materialLabel, the same helper the Edit Product picker
              and the Materials row use. One format, one place to change it.
              The code earned its place when the names were near-identical composition
              strings -- "100% Cotton" beside "Cotton" beside "80% Cotton 20% Polyester"
              -- and only the code told two of them apart. Twelve fibre names are
              distinguishable on sight, so it earns it differently now: MAT-0002 is what
              you paste into a search, and a name is not. */}
          <div><label style={lbl}>Material</label><select style={inp} value={f.material_id} onChange={set('material_id')}><option value="">— select —</option>{materials.map(m=><option key={m.id} value={m.id}>{materialLabel(m)}</option>)}</select></div>
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
        {/* Was in the form state and in the payload but never rendered, so it round-tripped
            correctly and could not be corrected. It is populated on all 84 imported
            reports and 73 of those resolve to no material and no product, which means the
            title chain falls through to it -- this string is the NAME of most rows in the
            reports list, and until now the only way to fix a wrong one was SQL.

            Above Composition because it says what the sample was and Composition says
            what it was made of; the second reads as a qualifier on the first. */}
        <div><label style={lbl}>Sample description</label><input style={inp} value={f.sample_description} onChange={set('sample_description')} placeholder="What was tested" /></div>
        {/* What the LAB measured, which is not what products.composition says. That one
            is the current spec; this one is a swatch on a date, and a report from January
            disagreeing with today's spec is the history, not an error. Do not reconcile
            them.

            Full width because the longest imported value is 83 characters and they are
            not all clean blends -- some carry a component label ("(A) Blue Body: ...")
            and three carry a style number the register put in the wrong column. Half
            width ellipsises those into something that reads as complete.

            Editable, and off the reports row on purpose: 48 of 84 have one, so a row slot
            would be empty on 36. Search reaches it instead. */}
        <div><label style={lbl}>Composition</label><input style={inp} value={f.composition} onChange={set('composition')} placeholder="e.g. 51% Cotton 49% Polyester" /></div>
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
  // Held as the <select>'s own string and converted once, on the way out. '' is the
  // undecided option and maps to null, NOT to false: a select hands back '' for its
  // empty option and Boolean('') is false, so the obvious conversion silently turns
  // "nobody has decided" into "Jenn ruled this exempt" without anyone touching the
  // control. Read back with === on both branches for the same reason.
  const [required,setRequired] = useState(
    product.efiling_required === true ? 'yes' : product.efiling_required === false ? 'no' : '');
  const parsed = required === 'yes' ? true : required === 'no' ? false : null;
  const [saving,setSaving] = useState(false);
  const save = async () => {
    // "Not required" and a recorded filing date cannot both stand, and it is the date
    // that gets dropped -- so it is said out loud first. A filing date is a fact somebody
    // entered from a document; losing it to a dropdown two rows above it is not a trade
    // anyone agreed to. 2 of 271 have a date today, so this is reachable rather than
    // theoretical.
    if (parsed === false && date &&
        !confirm('This product has an eFiling date of '+fmtDate(date)+'.\n\n'+
                 'Saving it as not required will clear that date. Continue?')) return;
    setSaving(true);
    try {
      // Both columns in one write. efiled_date is nulled only on the not-required
      // branch; on the other two it goes through the same `date || null` as before, so
      // the undecided and needs-filing paths are untouched.
      const { error } = await SB.from('products')
        .update({ efiling_required: parsed, efiled_date: parsed === false ? null : (date || null) })
        .eq('id', product.id);
      if (error) { toast('Could not save the eFiling details: '+error.message, 'err'); return; }
      onSaved();
    } finally { setSaving(false); }
  };
  const label = product.sku || product.name || 'this product';
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'4px'}}>eFiling for {label}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>Whether this product needs eFiling with CPSC, and the date it was filed.</div>
      {/* Above the date because it governs it. Each option reads as a whole answer to
          "does this need eFiling" rather than as a bare word that only means something
          next to the label -- "No" alone is the reading that gets mistaken for "not
          filed yet", which is what a blank date already says. */}
      <div style={{marginBottom:'14px'}}>
        <label style={lbl}>eFiling required</label>
        <select style={inp} value={required} onChange={e=>setRequired(e.target.value)}>
          <option value="">— Not set —</option>
          <option value="yes">Yes — needs eFiling</option>
          <option value="no">No — not required</option>
        </select>
      </div>
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
        {/* Both controls go dead under "not required", not just the input. Leaving the ×
            live would let the date be edited to a different wrong value on a product
            where no date can be correct, and a half-disabled field reads as an oversight
            rather than a rule. The value is kept in local state rather than blanked, so
            switching back to Yes or Not set restores what was there and nothing is lost
            before Save. */}
        <div style={{display:'flex',alignItems:'center',gap:'8px',opacity:parsed===false?0.5:1}}>
          <input type="date" style={{...inp,flex:1,minWidth:0}} value={date} disabled={parsed===false}
            onChange={e=>setDate(e.target.value)} />
          {date && parsed!==false && (
            <button type="button" onClick={()=>setDate('')} title="Clear the date" aria-label="Clear the date"
              style={{flexShrink:0,width:'20px',height:'20px',borderRadius:'50%',border:'none',background:'#F0F0F2',color:'#8A8A8E',fontSize:'14px',lineHeight:1,cursor:'pointer'}}>×</button>
          )}
        </div>
        <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'6px'}}>
          {parsed===false
            ? (date ? 'Not required — saving will clear the date shown above.' : 'Not required — no filing date applies.')
            : date ? 'Clear it with the × beside the field, then save, to mark this product not filed.'
            : parsed===true ? 'No date means it needs filing and has not been filed.'
            : 'No date means not filed. Set the field above to record whether filing is needed at all.'}
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
  // A material added from here is held locally until the parent reloads, which happens
  // on save. Deduped by id in case that reload lands while this is still mounted.
  const [added,setAdded]=useState([]);
  const [adding,setAdding]=useState(false);
  const allMaterials = useMemo(()=>{
    const seen=new Set();
    return [...materials, ...added].filter(m=>{ if(!m||seen.has(m.id)) return false; seen.add(m.id); return true; });
  },[materials, added]);
  // Ticked on arrival. You do not open this modal and add a material in order to leave
  // it unlinked, and a new row would otherwise land at the bottom of the list unticked
  // and easy to miss.
  const onAdded=(row)=>{
    setAdding(false);
    if(!row) return;
    setAdded(p=>[...p, row]);
    setSel(p=>{ const n=new Set(p); n.add(row.id); return n; });
  };
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
      {adding && <AddMaterialModal onClose={()=>setAdding(false)} onSaved={onAdded} />}
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'4px'}}>Materials in {product.sku||product.name}</div>
      {/* The old line said the product's compliance status is derived from these. It is
          not, and has not been since the derivation was dropped -- compliance_status is
          Jenn's stored call and nothing here writes it. What the materials do feed is
          the advisory line under the status on the product row, which is a different
          claim and a much weaker one. */}
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>Link the materials this product is built from. Their test statuses show as an advisory line on the product row; the compliance status itself is set there by hand.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'6px',maxHeight:'340px',overflowY:'auto'}}>
        {allMaterials.length===0 && <div style={{fontSize:'13px',color:'#8A8A8E'}}>No materials yet — add the first one below.</div>}
        {allMaterials.map(m=>{ const on=sel.has(m.id); return (
          <button key={m.id} onClick={()=>toggle(m.id)} style={{display:'flex',alignItems:'center',gap:'11px',padding:'11px 13px',borderRadius:'10px',border:'1px solid '+(on?'#1A1A1C':'#E5E7EB'),background:on?'#FAFAFB':'#fff',cursor:'pointer',textAlign:'left'}}>
            <div style={{width:'18px',height:'18px',borderRadius:'5px',border:'1px solid '+(on?'#1A1A1C':'#D1D5DB'),background:on?'#1A1A1C':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<span style={{color:'#fff',fontSize:'12px'}}>✓</span>}</div>
            <div style={{flex:1,minWidth:0}}>
              {/* materialLabel, so this reads the same as the Materials row, Edit
                  Product's block and ReportModal's dropdown. It was the last surface
                  showing bare names, back when those names were fourteen near-identical
                  composition strings and the code was the only thing separating them.
                  The names are twelve fibres now and tell themselves apart, so the code
                  stays for the other reason: it is the handle you paste into a search. */}
              <div style={{fontSize:'13px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{materialLabel(m)}</div>
              <div style={{fontSize:'11.5px',color:'#8A8A8E',textTransform:'capitalize'}}>{m.material_type}</div>
            </div>
            <StatusPill map={MAT_STATUS} status={m.status} />
          </button>
        ); })}
      </div>
      {/* Always present, not only on the empty state. An add button that disappears the
          moment you use it once puts the same dead end one material further along --
          you would still be stuck the first time you need a fifteenth mid-link. Same
          placement as HtsField's "+ Add code", at the foot of the list it adds to. */}
      <button onClick={()=>setAdding(true)} style={{display:'inline-flex',alignItems:'center',justifyContent:'center',gap:'6px',width:'100%',marginTop:'8px',background:'#F5F5F7',color:'#3461E0',border:'none',borderRadius:'10px',padding:'9px 12px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>+ Add material</button>
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
