'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';

// ── RegModal (create, edit or delete one vessl.regulations row) ──────────────
// Extracted from app/testing.jsx so the Codes page can offer the same editor
// rather than a second copy. Same reasoning as CodeModal: a page module is the
// wrong thing to import to get a modal, and two editors over one table drift.
//
// Style constants are deliberate copies rather than a shared import, matching
// CodeModal. Overlay here uses zIndex 300 like CodeModal's rather than the 200
// testing.jsx used, so the two modals stack consistently wherever they are
// mounted; maxWidth is 560 because this form carries a good deal more.
//
// Errors go through the toast bridge, not alert(). testing.jsx used alert()
// locally; a component mounted from two pages should not carry one page's habit,
// and ToastProvider wraps every page in the shell so this works from either.

const inp = {width:'100%',border:'1px solid rgba(0,0,0,.1)',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const lbl = {display:'block',fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'6px'};
const hint = {textTransform:'none',letterSpacing:0,fontWeight:400,color:'#A0A0A4'};
const toast = (msg, type) => { if (typeof window !== 'undefined') window._toast?.(msg, type); };

const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',backdropFilter:'blur(2px)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'18px',boxShadow:'0 12px 48px rgba(0,0,0,.2)',width:'100%',maxWidth:'560px',padding:'24px'}}>{children}</div>
  </div>
);

// The four values vessl.regulations.certificate_required accepts, plus the empty
// case. A <select> rather than a text box because the column carries a CHECK
// constraint: anything else is rejected by the database, and a free-text field
// would turn a typo into a raw constraint error. Labels are the source sheet's own
// wording, so a row reads here the way it reads in the CPSC list.
export const CERT_OPTS = [
  ['', '— Not set —'],
  ['cpc', "CPC (children's product)"],
  ['gcc', 'GCC (general use)'],
  ['depends_on_age_grade', 'CPC or GCC — depends on age grading'],
  ['verify', 'See note — verify status'],
];

// Fields mirror vessl.regulations exactly: code and name (both NOT NULL), citation,
// certificate_required, notes, category, applies_to, age_group, requires_3p, active
// (default true), sort_order (default 100). Both lists filter on active, so a rule
// created inactive would vanish from view the moment it was saved — it defaults on.
//
// Code and Citation are two different columns and their labels say so: code is the
// short unique key the rest of the app cites (16 CFR 1263), citation is the string
// as published, which can name several subsections of that one part.
export function RegModal({ data, onClose, onSaved, onDeleted }) {
  const editing = !!(data && data.id);
  const [f,setF]=useState({
    code:data?.code||'', name:data?.name||'', category:data?.category||'',
    citation:data?.citation||'', certificate_required:data?.certificate_required||'',
    notes:data?.notes||'',
    applies_to:data?.applies_to||'', age_group:data?.age_group||'',
    requires_3p:editing?!!data.requires_3p:false,
    active:editing?!!data.active:true,
    sort_order:data?.sort_order==null?'':String(data.sort_order),
  });
  const [saving,setSaving]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const set=k=>e=>setF(p=>({...p,[k]:e.target.value}));
  const setB=k=>e=>setF(p=>({...p,[k]:e.target.checked}));

  // Two references point at a regulation and they behave in opposite ways.
  //
  //   test_results.regulation_id  has NO on-delete rule, so Postgres BLOCKS.
  //   product_regulations.regulation_id  is ON DELETE CASCADE, so it goes quietly
  //   and every product linked to this rule is silently unlinked.
  //
  // The blocked case is checked first and offered no way forward, because there is
  // none -- the database would refuse anyway, and a confirm that leads to a raw
  // 23503 is worse than a sentence. The cascade is the case that needs a human to
  // see a number before agreeing to it.
  const remove = async () => {
    setDeleting(true);
    try {
      const { count: results, error: resErr } = await SB.from('test_results')
        .select('id', { count:'exact', head:true }).eq('regulation_id', data.id);
      // A confirm that cannot establish the consequence must not offer to proceed.
      if (resErr) { toast('Could not check test results — '+resErr.message, 'err'); return; }
      const label = data.code + (data.name ? ' — '+data.name : '');
      if (results > 0) {
        window.alert('Cannot delete '+label+'.\n\n'
          + results+(results===1?' test result cites':' test results cite')+' this rule, and deleting it would '
          + 'break that record. Untick Active instead — the rule stops being offered for new work '
          + 'and everything already filed still resolves.');
        return;
      }

      // Fetched rather than counted so the confirm can name a couple of products.
      const { data: links, error: linkErr } = await SB.from('product_regulations')
        .select('id, product:products(name,sku)').eq('regulation_id', data.id);
      if (linkErr) { toast('Could not check which products use this rule — '+linkErr.message, 'err'); return; }

      let message;
      if (!links || links.length === 0) {
        message = 'Delete '+label+'?\n\nNo products are linked to it and no test results cite it. '
          + 'Nothing will be orphaned.\n\nThis cannot be undone.';
      } else {
        const names = links.slice(0,2).map(l => l.product?.name || l.product?.sku || 'a product').join(', ');
        message = 'Delete '+label+'?\n\n'
          + links.length+(links.length===1?' product is':' products are')+' linked to this rule — including '+names+' — '
          + 'and '+(links.length===1?'that link':'those links')+' will be removed with it, silently. Nothing will warn '
          + 'anyone that the rule stopped applying.\n\n'
          + 'If the rule is obsolete but still relevant to those products, close this and untick Active instead.'
          + '\n\nThis cannot be undone.';
      }
      if (!window.confirm(message)) return;

      const { error } = await SB.from('regulations').delete().eq('id', data.id);
      if (error) { toast('Could not delete regulation: '+error.message, 'err'); return; }
      toast('Regulation deleted', 'ok');
      onDeleted();
    } finally { setDeleting(false); }
  };

  const save=async()=>{
    const code=f.code.trim(), name=f.name.trim();
    if(!code||!name){ toast('Code and rule name are both required','err'); return; }
    setSaving(true);
    const payload = {
      code, name, category:f.category||null, applies_to:f.applies_to||null, age_group:f.age_group||null,
      // Trimmed, then '' collapses to null so a cleared box empties the column rather
      // than storing a blank. certificate_required needs no trim -- it can only hold a
      // value the select put there -- but '' must still become null: the CHECK accepts
      // null or one of four words, and '' is neither.
      citation:f.citation.trim()||null,
      certificate_required:f.certificate_required||null,
      notes:f.notes.trim()||null,
      requires_3p:!!f.requires_3p, active:!!f.active,
    };
    // sort_order defaults to 100 in the database, and a default only fires when the
    // key is absent -- so on create send it only when a number was typed. On edit the
    // column already has a value, so a cleared box means "put it back to the default".
    const sort = f.sort_order===''?null:Number(f.sort_order);
    const { error } = editing
      ? await SB.from('regulations').update({ ...payload, sort_order:sort==null?100:sort }).eq('id', data.id)
      : await SB.from('regulations').insert(sort==null?payload:{ ...payload, sort_order:sort });
    setSaving(false);
    if(error){
      // regulations_code_key is UNIQUE (code). Unlike htscodes there is no second
      // column in the key: one code is one rule, and a repeat means this citation is
      // already in the library under some other name.
      const dupe = error.code === '23505' || /duplicate key|regulations_code_key/i.test(error.message||'');
      toast(dupe ? 'Another regulation already uses the code ' + code : 'Could not save regulation: '+error.message, 'err');
      return;   // stay open so the entry is not lost
    }
    toast(editing ? 'Regulation updated' : 'Regulation added', 'ok');
    onSaved();
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>{editing?'Edit regulation':'New regulation'}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>{editing?'Reports already filed keep the code they recorded.':'A rule that test results can be recorded against.'}</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 2fr',gap:'12px'}}>
          <div><label style={lbl}>Code *</label><input style={inp} value={f.code} onChange={set('code')} placeholder="e.g. 16 CFR 1303" /></div>
          <div><label style={lbl}>Rule name *</label><input style={inp} value={f.name} onChange={set('name')} placeholder="e.g. Lead in paint" /></div>
        </div>
        <div>
          <label style={lbl}>Citation</label>
          <input style={inp} value={f.citation} onChange={set('citation')} placeholder="e.g. 15 U.S.C. § 2056e; 16 CFR §§ 1263.3, 1263.4" />
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Certificate required</label>
            <select style={inp} value={f.certificate_required} onChange={set('certificate_required')}>
              {CERT_OPTS.map(([v,l])=><option key={v||'none'} value={v}>{l}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Category</label><input style={inp} value={f.category} onChange={set('category')} placeholder="e.g. chemical, mechanical" /></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Applies to</label><input style={inp} value={f.applies_to} onChange={set('applies_to')} placeholder="e.g. painted surfaces" /></div>
          <div><label style={lbl}>Age group</label><input style={inp} value={f.age_group} onChange={set('age_group')} placeholder="e.g. under 12" /></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'12px'}}>
          <div><label style={lbl}>Sort order <span style={hint}>(blank = 100)</span></label><input type="number" style={inp} value={f.sort_order} onChange={set('sort_order')} placeholder="100" /></div>
          <div></div>
        </div>
        <div>
          <label style={lbl}>Notes</label>
          <textarea style={{...inp,minHeight:'60px',resize:'vertical'}} value={f.notes} onChange={set('notes')} placeholder="Enforcement status, parallel standards, anything that qualifies the rule" />
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#3A3A3E',cursor:'pointer'}}>
          <input type="checkbox" checked={f.requires_3p} onChange={setB('requires_3p')} /> Requires third-party testing
        </label>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#3A3A3E',cursor:'pointer'}}>
          <input type="checkbox" checked={f.active} onChange={setB('active')} /> Active <span style={{color:'#A0A0A4'}}>— inactive rules are hidden everywhere</span>
        </label>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        {/* Edit path only -- a rule that has not been saved has nothing to delete. */}
        {editing && (
          <button onClick={remove} disabled={deleting||saving} style={{marginRight:'auto',background:'none',border:'1px solid #F0C8C8',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#B91C1C',opacity:(deleting||saving)?0.6:1}}>{deleting?'Checking…':'Delete'}</button>
        )}
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':(editing?'Save changes':'Save regulation')}</button>
      </div>
    </Overlay>
  );
}
