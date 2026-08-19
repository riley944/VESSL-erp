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

// The same three CreateProductModal offers, because both write products.cpsc_type and
// a value one accepts that the other does not would be invisible until someone hit it.
// They are declared in both files rather than shared; unifying them is a small change
// worth making, but it belongs with a pass over CreateProductModal.
//
// Values are uppercase, not 'Gcc': the product row renders cpsc_type raw, so a
// mixed-case value would read "· Gcc" beside "· GCC".
//
// BOTH was removed because it modelled a state CPSIA does not have. A general-use
// product takes a GCC and a children's product takes a CPC; the two are mutually
// exclusive, so no product needs both certificates and offering it invited a wrong
// answer that looked considered. This was the last writer of the value -- with the
// option gone, products_cpsc_type_chk can be narrowed to GCC | CPC | null.
const CPSC_TYPES = [['', '— N/A —'], ['GCC', 'GCC'], ['CPC', 'CPC']];

// ┌───────────────────────────────────────────────────────────────────────────┐
// │ The two CPSC vocabularies do NOT share casing, and this is the only place  │
// │ they meet.                                                                 │
// │                                                                            │
// │   products.cpsc_type          'GCC' | 'CPC' | null  (UPPERCASE)            │
// │       ('BOTH' is legacy: no longer offered, no longer writable)            │
// │   regulations.certificate_required                                         │
// │       'gcc' | 'cpc' | 'depends_on_age_grade' | 'verify' | null (lowercase) │
// │                                                                            │
// │ Comparing them directly -- r.certificate_required === p.cpsc_type -- is    │
// │ always false and fails silently, matching nothing at all. Lowercasing here │
// │ is what bridges them; do not remove it on the assumption they agree.       │
// │                                                                            │
// │ 'both' is a cpsc_type only. No rule carries it: a rule states the ONE       │
// │ certificate it belongs to, or depends_on_age_grade, or nothing. Never look  │
// │ for certificate_required === 'both'.                                        │
// └───────────────────────────────────────────────────────────────────────────┘
//
// products_cpsc_type_chk constrains the column to those three values or null, so an
// unrecognised value can no longer be stored -- but this still guards rather than
// trusting the constraint, because a value that slipped in before it existed must
// not silently promote the 15 depends_on_age_grade rules as though a type had been
// chosen. "Not recognised" and "not set" are treated the same on purpose.
const asCertType = (v) => {
  const t = String(v ?? '').trim().toLowerCase();
  return (t === 'gcc' || t === 'cpc' || t === 'both') ? t : null;
};

// The certificate a rule would have to carry to NOT apply. Null under 'both',
// because there is no such certificate -- every rule that names one is in scope.
//
// Deliberately a switch and not `want === 'gcc' ? 'CPC' : 'GCC'`. That ternary
// answers 'GCC' for 'both', which is wrong quietly: it would label a divider that
// should never render, and stay wrong if the bucket it labels ever filled.
const otherCertOf = (want) => {
  if (want === 'gcc') return 'CPC';
  if (want === 'cpc') return 'GCC';
  return null;
};

export function LinkRulesModal({ product, regs, existing, onClose, onSaved }) {
  const [sel,setSel] = useState(new Set(existing.map(e=>e.regulation_id)));
  const [saving,setSaving] = useState(false);
  const [search,setSearch] = useState('');
  const [showAll,setShowAll] = useState(false);
  // Held in state and saved with the links, so changing it regroups the list here and
  // now rather than sending someone to Edit Product and back. It is the same field
  // that modal writes, saved once -- not a duplicate control that only displays.
  const [cpscType,setCpscType] = useState(product.cpsc_type || '');
  const toggle=id=>setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });

  // Grouping follows the selector, not the stored value, so the split moves as soon
  // as the type changes and before anything is written.
  const want = asCertType(cpscType);
  const q = normalizeTerm(search);
  const searching = q.length > 0;

  // Search is display only. sel, and therefore what gets written, is never derived
  // from the filtered arrays -- otherwise typing a term would silently unlink every
  // rule the term happened to exclude.
  const matching = useMemo(()=> !q ? regs : regs.filter(r => matches(q, ...regSearchFields(r))), [regs, q]);

  // Sticky visibility. A rule linked when this opened stays on screen for the whole
  // session even after it is unticked, so nothing vanishes under the cursor at the
  // moment it is clicked, and a newly ticked one cannot disappear either.
  const openedWith = useMemo(()=> new Set(existing.map(e=>e.regulation_id)), [existing]);

  // Four buckets. `other` is the other certificate's rules that ARE on screen;
  // `hidden` is the ones that are not. They are counted separately because the header
  // claims a hidden count, and a count that included visible rows would be a lie.
  const { applies, unknown, other, hidden } = useMemo(()=>{
    const a=[], u=[], o=[], h=[];
    matching.forEach(r => {
      if (!want) { a.push(r); return; }   // no type chosen: one flat list, nothing filtered
      // ── the four 'both' branches below are LEGACY, and stay on purpose ──
      // Nothing can write 'both' any more: the option is gone from CPSC_TYPES above and
      // from CreateProductModal, and products_cpsc_type_chk is being narrowed to
      // GCC | CPC | null, which makes the value unreachable rather than merely unoffered.
      // No product carries it today either -- 99 GCC, 13 CPC, 159 null.
      //
      // They are kept anyway because a branch that renders a legacy value harmlessly
      // costs nothing, while removing them means touching four call sites, two of which
      // (canHide, wantLabel) change how the OTHER types render if got wrong. If a row
      // somehow still holds 'both' -- restored backup, a hand-run UPDATE before the
      // constraint lands -- this displays it sensibly instead of falling through to a
      // filter that matches nothing. Delete them in a pass of their own, after the
      // constraint has been in place long enough to trust.
      //
      // 'both' means every rule that names a certificate is in scope, so nothing can
      // land in `other` or `hidden` -- the product needs a GCC and a CPC, and each
      // rule belongs to one of them. The unknowns below are still separated: their
      // status is unstated, which is orthogonal to which certificate is needed, and
      // flattening here would make BOTH the one mode where CA Prop 65 is
      // indistinguishable from a rule that genuinely applies.
      if (want === 'both'
        ? (r.certificate_required === 'gcc' || r.certificate_required === 'cpc' || r.certificate_required === 'depends_on_age_grade')
        : (r.certificate_required === want || r.certificate_required === 'depends_on_age_grade')) { a.push(r); return; }
      // Blank is unknown, not "does not apply". CA Prop 65 carries no CPSC certificate
      // and applies to nearly anything sold in California; 16 CFR 1260 is stayed and
      // unresolved. Hiding either would be asserting something the data does not say.
      if (r.certificate_required == null || r.certificate_required === 'verify') { u.push(r); return; }
      // A linked rule for the OTHER certificate is shown on purpose, and this is not a
      // hole in the filter. It is a contradiction -- either the product's type is wrong
      // or the link is -- and it is the one row in the list that needs someone's
      // attention. Hiding it would bury exactly that.
      //
      // Note this branch is unreachable under 'both', so the contradiction flag cannot
      // fire there. That is correct -- every rule applies, so no link can contradict
      // the type -- but it also means BOTH can be used to silence the flag rather than
      // resolve it. A product widened to BOTH after a mismatch looks identical to one
      // that genuinely needs both certificates. A lot of BOTH products is worth a
      // second look for that reason.
      ((showAll || sel.has(r.id) || openedWith.has(r.id)) ? o : h).push(r);
    });
    return { applies:a, unknown:u, other:o, hidden:h };
  },[matching, want, showAll, sel, openedWith]);

  const visibleCount = applies.length + unknown.length + other.length;
  const otherLabel = otherCertOf(want);
  // What the applicable group is called. 'both' needs its own phrasing -- "apply to a
  // BOTH" is not a sentence, and interpolating want.toUpperCase() would produce it.
  const wantLabel = want === 'both' ? 'GCC and a CPC' : String(want).toUpperCase();
  // Under 'both' nothing is filtered out, so there is nothing to reveal. Offering the
  // checkbox anyway would suggest something was being kept back.
  const canHide = !!otherLabel;

  // Two tables in one action, and there is no transaction across them: PostgREST
  // calls are independent requests and supabase-js has no multi-table transaction,
  // so real atomicity would need a Postgres function behind an RPC. Given that, the
  // order is chosen so the cheapest write fails first and costs nothing.
  //
  //   cpsc_type fails            -> nothing changed at all, retry as it stands
  //   cpsc_type ok, links fail   -> type saved, links not; the toast says so, the
  //                                 selection survives, and Save again retries
  //
  // It is written only when it actually differs, so a retry after a partial failure
  // does not repeat it.
  const save=async()=>{
    setSaving(true);
    try {
      // Tracks what has actually been written, so a later failure can say what landed
      // without claiming a save that never ran. Without it the link-failure message
      // would have to guess, and would be wrong every time the type was untouched.
      let typeSaved = false;
      const wantType = cpscType || null;
      if (wantType !== (product.cpsc_type || null)) {
        const { error } = await SB.from('products').update({ cpsc_type: wantType }).eq('id', product.id);
        if (error) {
          toast('Could not save the CPSC type: '+error.message+' — nothing was changed; press Save to try again.', 'err');
          return;   // nothing else has run, so the product is exactly as it was
        }
        typeSaved = true;
      }

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
          // The duplicate case deliberately does not say "try again": the stored state
          // has diverged from what this modal is holding, so reopening is the right
          // move and retrying would just fail the same way.
          toast(dupe
            ? 'Some of those rules are already linked — close and reopen to see the current state.'
            : (typeSaved ? 'CPSC type saved, but the rules were not linked: ' : 'Could not link rules: ')
              + error.message + ' — press Save to try again; closing loses the selection.', 'err');
          return;   // no onSaved: the links did not change, so there is nothing new for
                    // the parent to show. Retrying in place is what avoids the stale
                    // read that closing and editing the product would give.
        }
      }
      if(toRemove.length){
        const { error } = await SB.from('product_regulations').delete().in('id', toRemove.map(e=>e.id));
        if(error){
          // Built from what actually ran rather than assumed: additions are skipped
          // entirely when nothing was added, and the type when it was unchanged.
          const done = [];
          if (typeSaved) done.push('CPSC type saved');
          if (toAdd.length) done.push('new rules linked');
          toast((done.length ? done.join(', ')+', but could not remove' : 'Could not remove')
            + ' the unlinked ones: '+error.message+' — press Save to try again; closing loses the selection.', 'err');
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

      {/* The type sits above the list because it decides how the list is arranged.
          It replaces the line that used to point at Edit Product: the friction that
          line existed to explain is what this control removes. */}
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'10px',flexWrap:'wrap'}}>
        <span style={{fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',whiteSpace:'nowrap'}}>CPSC type</span>
        <select value={cpscType} onChange={e=>setCpscType(e.target.value)} style={{...inp,width:'auto',minWidth:'120px',padding:'7px 10px',fontSize:'13px'}}>
          {CPSC_TYPES.map(([v,l])=><option key={v||'none'} value={v}>{l}</option>)}
        </select>
        <span style={{fontSize:'11.5px',color:'#A0A0A4'}}>saved with the links</span>
      </div>

      {/* The counts are of the FILTERED set, so searching narrows both groups rather
          than collapsing the distinction between them. */}
      <div style={{fontSize:'12px',color:'#6A6A6E',marginBottom:'12px',lineHeight:1.5}}>
        {want ? (
          <>
            {applies.length} apply to a {wantLabel} · {unknown.length} with no certificate stated
            {/* Under 'both' there is no third clause at all: nothing is hidden, nothing
                is another certificate's, so a "0 hidden" would be noise. */}
            {canHide && (showAll
              ? ' · '+other.length+' apply to a '+otherLabel+' only'
              : (other.length > 0 ? ' · '+other.length+' linked but '+otherLabel+'-only' : '')
                + ' · '+hidden.length+' hidden')}
            {searching && ' · '+visibleCount+' of '+regs.length}
          </>
        ) : (
          // Still says why there is no divider, but now points at the control directly
          // above rather than at another modal.
          <>Pick a CPSC type above to filter by what applies.{searching ? ' · '+visibleCount+' of '+regs.length : ' · '+regs.length+' rules'}</>
        )}
        {sel.size > 0 && <span style={{color:'#1A1A1C',fontWeight:600}}>{' · '+sel.size+' selected'}</span>}
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'12px',flexWrap:'wrap'}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search rules — code, name, certificate, note…" style={{...inp,flex:'1 1 240px',width:'auto'}} />
        {/* Only offered when a type is chosen -- with none, nothing is filtered and a
            "show all" that changes nothing would suggest something was being kept back. */}
        {canHide && (
          <label style={{display:'flex',alignItems:'center',gap:'7px',fontSize:'12.5px',color:'#3A3A3E',cursor:'pointer',whiteSpace:'nowrap'}}>
            <input type="checkbox" checked={showAll} onChange={e=>setShowAll(e.target.checked)} />
            Show all {regs.length} rules
          </label>
        )}
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'6px',maxHeight:'360px',overflowY:'auto'}}>
        {/* "No rules match" on its own would be false whenever the filter is holding
            matches back -- which is the objection to filtering, arriving through the
            search box instead of the list. The count and the way out go with it. */}
        {visibleCount===0 && (
          <div style={{fontSize:'13px',color:'#8A8A8E',padding:'12px 2px',lineHeight:1.5}}>
            {searching ? (
              <>
                No rules match “{search.trim()}”{hidden.length>0 ? ' here.' : '.'}
                {hidden.length>0 && ' '+hidden.length+(hidden.length===1?' hidden rule does':' hidden rules do')
                  +' — tick “Show all '+regs.length+' rules” to include '+(hidden.length===1?'it':'them')+'.'}
              </>
            ) : 'No rules available.'}
          </div>
        )}
        {want && applies.length>0 && <Divider text={'Applies to a '+wantLabel} />}
        {applies.map(Row)}
        {want && unknown.length>0 && <Divider text="No certificate stated" />}
        {unknown.map(Row)}
        {want && other.length>0 && <Divider text={'Applies to a '+otherLabel+' only'} />}
        {other.map(Row)}
        {/* Reached when the search matches nothing visible is false -- i.e. there ARE
            visible rows, and more matches sit behind the filter. Same honesty, quieter
            placement, since the list above already answered the question. */}
        {searching && visibleCount>0 && hidden.length>0 && (
          <div style={{fontSize:'11.5px',color:'#A0A0A4',padding:'8px 2px 2px'}}>
            {hidden.length+(hidden.length===1?' more rule matches but is hidden':' more rules match but are hidden')} by the {wantLabel} filter.
          </div>
        )}
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
