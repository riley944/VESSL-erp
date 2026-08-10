'use client';
import { useState, useMemo } from 'react';
import { SB } from '@/lib/supabase';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { CERT_PILL, regSearchFields } from '@/app/components/RegulationsList';

// ── LinkRulesModal (product ↔ vessl.regulations, via product_regulations) ────
// Launched from the product row on the Testing page, beside Materials, because
// that is where the other many-to-many link on a product already lives. It is
// deliberately NOT inside CreateProductModal: on create there is no product.id
// yet and product_regulations.product_id is NOT NULL, so links would need a
// two-phase write with a failure mode where the product exists and its rules
// do not.
//
// Write discipline copied from the fixed LinkModal: additions first so a failure
// loses nothing, upsert so a retry is idempotent, one .delete().in() for removals,
// both results checked, and onSaved() only when everything asked for happened.
//
// cpsc_type ORDERS this list and never filters it. Filtering on
// certificate_required would drop the 15 depends_on_age_grade rules, which can
// require either certificate; it would also drop CA Prop 65, which is null
// precisely because it carries no CPSC certificate while applying to nearly
// anything sold in California. A list that hides relevant rules while looking
// complete is worse than a long one.

const inp = {width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const toast = (msg, type) => { if (typeof window !== 'undefined') window._toast?.(msg, type); };

const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',backdropFilter:'blur(2px)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'18px',boxShadow:'0 12px 48px rgba(0,0,0,.2)',width:'100%',maxWidth:'620px',padding:'24px'}}>{children}</div>
  </div>
);

// products.cpsc_type is a free text column whose only writer offers GCC and CPC.
// Anything else is treated as "not set" rather than being matched loosely -- an
// unrecognised value must not silently promote the 15 depends_on_age_grade rules
// as though a type had been chosen.
const asCertType = (v) => {
  const t = String(v ?? '').trim().toLowerCase();
  return (t === 'gcc' || t === 'cpc') ? t : null;
};

export function LinkRulesModal({ product, regs, existing, onClose, onSaved }) {
  const [sel,setSel] = useState(new Set(existing.map(e=>e.regulation_id)));
  const [saving,setSaving] = useState(false);
  const [search,setSearch] = useState('');
  const toggle=id=>setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });

  const want = asCertType(product.cpsc_type);
  const q = normalizeTerm(search);
  const searching = q.length > 0;

  // Search is display only. sel, and therefore what gets written, is never derived
  // from the filtered arrays -- otherwise typing a term would silently unlink every
  // rule the term happened to exclude.
  const shown = useMemo(()=> !q ? regs : regs.filter(r => matches(q, ...regSearchFields(r))), [regs, q]);
  const [applies, others] = useMemo(()=>{
    if (!want) return [[], shown];
    const a=[], o=[];
    shown.forEach(r => ((r.certificate_required === want || r.certificate_required === 'depends_on_age_grade') ? a : o).push(r));
    return [a, o];
  },[shown, want]);

  const save=async()=>{
    setSaving(true);
    try {
      const have=new Set(existing.map(e=>e.regulation_id));
      const toAdd=[...sel].filter(id=>!have.has(id));
      const toRemove=existing.filter(e=>!sel.has(e.regulation_id));

      if(toAdd.length){
        const { error } = await SB.from('product_regulations').upsert(
          toAdd.map(rid=>({ product_id:product.id, regulation_id:rid, is_required:true })),
          { onConflict:'product_id,regulation_id', ignoreDuplicates:true }
        );
        if(error){
          const dupe = error.code === '23505';
          toast(dupe
            ? 'Some of those rules are already linked — close and reopen to see the current state.'
            : 'Could not link rules: '+error.message, 'err');
          return;   // no onSaved: nothing changed, so there is nothing to reload
        }
      }
      if(toRemove.length){
        const { error } = await SB.from('product_regulations').delete().in('id', toRemove.map(e=>e.id));
        if(error){
          toast('Linked the new rules, but could not remove the unlinked ones: '+error.message, 'err');
          return;
        }
      }
      onSaved();
    } finally { setSaving(false); }
  };

  const Row = (r) => {
    const on = sel.has(r.id);
    const cert = CERT_PILL[r.certificate_required];
    return (
      <button key={r.id} onClick={()=>toggle(r.id)} style={{display:'flex',alignItems:'center',gap:'11px',padding:'10px 12px',borderRadius:'10px',border:'1px solid '+(on?'#1A1A1C':'#E5E7EB'),background:on?'#FAFAFB':'#fff',cursor:'pointer',textAlign:'left',width:'100%'}}>
        <div style={{width:'18px',height:'18px',borderRadius:'5px',border:'1px solid '+(on?'#1A1A1C':'#D1D5DB'),background:on?'#1A1A1C':'#fff',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{on&&<span style={{color:'#fff',fontSize:'12px'}}>✓</span>}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:'13px',fontWeight:600,color:'#1A1A1C',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</div>
          <div style={{fontFamily:'var(--mono)',fontSize:'11px',color:'#8A8A8E',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.code}</div>
        </div>
        {cert && <span style={{fontSize:'11px',fontWeight:700,color:cert.color,background:cert.bg,borderRadius:'980px',padding:'3px 10px',whiteSpace:'nowrap',flexShrink:0}}>{cert.label}</span>}
      </button>
    );
  };

  const label = product.sku || product.name || 'this product';
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'4px'}}>CPSC rules for {label}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'14px'}}>Link the rules this product has to be certified against.</div>

      {/* The counts are of the FILTERED set, so searching narrows both groups rather
          than collapsing the distinction between them. */}
      <div style={{fontSize:'12px',color:'#6A6A6E',marginBottom:'12px',lineHeight:1.5}}>
        {want ? (
          <>{applies.length} apply to a {want.toUpperCase()} · {others.length} others{searching && ' · '+shown.length+' of '+regs.length}</>
        ) : (
          // Explains the missing divider instead of leaving a flat list looking wrong,
          // and names where the field is so nobody goes hunting for it. Left
          // non-actionable on purpose: a second cpsc_type control here would be a
          // second writer of one column.
          <>Set a CPSC type in Edit Product to see which rules apply to it.{searching ? ' · '+shown.length+' of '+regs.length : ' · '+regs.length+' rules'}</>
        )}
        {sel.size > 0 && <span style={{color:'#1A1A1C',fontWeight:600}}>{' · '+sel.size+' selected'}</span>}
      </div>

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search rules — code, name, certificate, note…" style={{...inp,marginBottom:'12px'}} />

      <div style={{display:'flex',flexDirection:'column',gap:'6px',maxHeight:'360px',overflowY:'auto'}}>
        {shown.length===0 && <div style={{fontSize:'13px',color:'#8A8A8E',padding:'12px 2px'}}>No rules match “{search.trim()}”.</div>}
        {want && applies.length>0 && <Divider text={'Applies to a '+want.toUpperCase()} />}
        {applies.map(Row)}
        {want && others.length>0 && <Divider text="Other rules" />}
        {others.map(Row)}
      </div>

      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save'}</button>
      </div>
    </Overlay>
  );
}

function Divider({ text }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:'10px',margin:'8px 2px 2px'}}>
      <span style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',whiteSpace:'nowrap'}}>{text}</span>
      <span style={{flex:1,height:'1px',background:'#ECECEE'}}/>
    </div>
  );
}
