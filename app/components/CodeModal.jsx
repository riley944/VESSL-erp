'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';

// ── CodeModal (create or edit one vessl.htscodes row) ────────────────────────
// Extracted from app/codes.jsx so the quote form can offer "+ Add code" without
// a second copy. It lives here rather than being exported from codes.jsx because
// that would mean importing a whole page module to get a modal -- the same reason
// CreateProductModal was moved out of page.jsx.
//
// Branches on data?.id. There is no delete: retiring a code is unchecking Active,
// so a quote that already cites it still resolves.
//
// onSaved receives the saved row, so a caller that needs to act on the new code --
// the quote form selects it straight away -- does not have to refetch to find it.
//
// The style constants below are deliberate copies rather than a shared import.
// codes.jsx and testing.jsx each carry their own; a "styles" module would be a
// third convention for five lines.

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 0 0 1px rgba(0,0,0,.02),0 2px 5px rgba(0,0,0,.04),0 12px 28px -8px rgba(20,20,40,.05)'};
const inp = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit'};
const lbl = {display:'block',fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'6px'};
// ToastProvider in page.jsx publishes this global and wraps every page, so this
// works from a modal opened anywhere in the shell without prop plumbing.
const toast = (msg, type) => { if (typeof window !== 'undefined') window._toast?.(msg, type); };

const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(20,20,30,.4)',backdropFilter:'blur(2px)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{...card,width:'100%',maxWidth:'520px',padding:'24px'}}>{children}</div>
  </div>
);

export function CodeModal({ data, onClose, onSaved }) {
  const editing = !!(data && data.id);
  const [f,setF] = useState({
    code: data?.code || '',
    description: data?.description || '',
    active: editing ? !!data.active : true,
  });
  const [saving,setSaving] = useState(false);
  // Stripped on every keystroke rather than only on save, so a pasted
  // 6307.90.9000 visibly becomes 6307909000 in the box -- what you see is what
  // gets stored. No length rule: 39269090 is a real 8-digit subheading and a
  // 10-digit check would reject it.
  const setCode = e => setF(p=>({...p, code: e.target.value.replace(/\D/g,'')}));
  const save = async () => {
    const code = f.code.trim();
    // description is NOT NULL with a no-blank CHECK, so it is validated here the same
    // way code is. Writing `|| null` would hand the database a value it rejects and
    // surface a raw constraint error instead of a sentence.
    const description = f.description.trim();
    if (!code) { toast('A code is required','err'); return; }
    if (!description) { toast('A description is required','err'); return; }
    setSaving(true);
    const payload = { code, description, active: !!f.active };
    // .select().single() on both paths so onSaved can hand the row back.
    const { data:row, error } = editing
      ? await SB.from('htscodes').update(payload).eq('id', data.id).select('id,code,description,active').single()
      : await SB.from('htscodes').insert(payload).select('id,code,description,active').single();
    setSaving(false);
    if (error) {
      const dupe = error.code === '23505' || /duplicate key|htscodes_code_key/i.test(error.message||'');
      toast(dupe ? 'That code already exists' : 'Could not save code: '+error.message, 'err');
      return;   // stay open so the entry is not lost
    }
    toast(editing ? 'Code updated' : 'Code added', 'ok');
    onSaved(row);
  };
  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>{editing?'Edit code':'New code'}</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>A tariff classification quotes can be filed against.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div>
          <label style={lbl}>HTS code *</label>
          <input style={inp} value={f.code} onChange={setCode} inputMode="numeric" placeholder="e.g. 6307909000" />
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'5px'}}>Digits only — separators are stripped as you type.</div>
        </div>
        <div>
          <label style={lbl}>Description *</label>
          <input style={inp} value={f.description} onChange={e=>setF(p=>({...p,description:e.target.value}))} placeholder="What this code covers" />
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#3A3A3E',cursor:'pointer'}}>
          <input type="checkbox" checked={f.active} onChange={e=>setF(p=>({...p,active:e.target.checked}))} />
          Active <span style={{color:'#A0A0A4'}}>— uncheck to retire it; it stays listed so old quotes still resolve</span>
        </label>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':(editing?'Save changes':'Save code')}</button>
      </div>
    </Overlay>
  );
}
