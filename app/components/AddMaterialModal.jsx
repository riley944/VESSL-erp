'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';

// ── AddMaterialModal (create one vessl.materials row) ────────────────────────
// The "+ Add material" target for MaterialField, mirroring what CodeModal is to
// HtsField: it writes the row, then hands it back so the caller can select it
// without a refetch.
//
// Create only. Editing a material is MaterialModal's job on the Testing page, and
// this deliberately does not grow into a second editor for the same table.
//
// It does NOT copy MaterialModal's save. That one discards the result entirely --
// no error destructure, onSaved() fires either way -- which is why nobody can say
// whether it has ever successfully written a row. The error handling here is
// LabModal's: check, say what happened, stay open.
//
// ── what gets written ────────────────────────────────────────────────────────
// name and composition ONLY, both set to the same string.
//
// That is not a shortcut, it is the decision the import was built on: a test report
// certifies a composition, not a fibre, so the composition IS the material's name.
// The Materials row renders one line when they match and both when they differ, so
// a material added here reads exactly like the 14 that were imported.
//
// material_code is NEVER sent. It defaults to 'MAT-' || lpad(nextval(...),4,'0')
// server-side and is UNIQUE; generating one here would mean the client guessing at
// a sequence it cannot see, and two people adding a material at once would guess
// the same number. The returned row carries whatever the database assigned.
//
// master_sku is likewise absent -- what it is meant to hold is an open question,
// and NULL is the honest answer until it is settled. status is left to its
// 'untested' default, which is what a material with no test report is.

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 0 0 1px rgba(0,0,0,.02),0 2px 5px rgba(0,0,0,.04),0 12px 28px -8px rgba(20,20,40,.05)'};
const inp = {width:'100%',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 12px',fontSize:'14px',outline:'none',fontFamily:'inherit',boxSizing:'border-box'};
const lbl = {display:'block',fontSize:'11px',fontWeight:600,textTransform:'uppercase',letterSpacing:'.06em',color:'#8A8A8E',marginBottom:'6px'};
// ToastProvider in page.jsx publishes this global and wraps every page. Deliberately
// toast() and not quotes.jsx's flash(), which renders errors in the success green --
// a failure here has to look like one.
const toast = (msg, type) => { if (typeof window !== 'undefined') window._toast?.(msg, type); };

const Overlay = ({children,onClose}) => (
  <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(20,20,30,.4)',backdropFilter:'blur(2px)',zIndex:300,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{...card,width:'100%',maxWidth:'520px',padding:'24px'}}>{children}</div>
  </div>
);

export function AddMaterialModal({ seed = '', onClose, onSaved }) {
  const [name,setName] = useState(seed || '');
  const [saving,setSaving] = useState(false);

  const save = async () => {
    const value = name.trim();
    if (!value) { toast('A material name is required','err'); return; }
    setSaving(true);
    // .select().single() so onSaved can hand the row back with the code the database
    // assigned -- the caller selects it immediately and must not have to refetch to
    // learn what it is called.
    const { data:row, error } = await SB.from('materials')
      .insert({ name: value, composition: value })
      .select('id,name,material_code,composition,status')
      .single();
    setSaving(false);
    if (error) {
      // 23505 is handled before materials.name is UNIQUE, not after. The constraint
      // is coming, and a writer that meets it for the first time in production shows
      // Jenn a raw Postgres string; this is the same order CodeModal's duplicate
      // handling shipped in, ahead of the (code, description) key.
      //
      // The two keys mean opposite things, so they do not share a message. A name
      // collision is something the person can fix by typing something else. A
      // material_code collision is the sequence disagreeing with the table, which
      // they cannot fix and should not be told to retry.
      const code = error.code === '23505';
      const byCode = /materials_material_code_key/i.test(error.message||'');
      toast(
        code && byCode
          ? 'The generated material code is already taken — the code sequence is out of step with the table. Nothing was saved; this one needs a database fix.'
          : code
            ? 'A material with that name already exists — pick it from the list instead.'
            : 'Could not add material: '+error.message,
        'err'
      );
      return;   // stay open so the entry is not lost, and no onSaved: nothing was written
    }
    toast('Material added','ok');
    onSaved(row);
  };

  return (
    <Overlay onClose={onClose}>
      <div style={{fontSize:'18px',fontWeight:700,color:'#1A1A1C',marginBottom:'6px'}}>New material</div>
      <div style={{fontSize:'12.5px',color:'#8A8A8E',marginBottom:'18px'}}>The unit that gets tested, and that products inherit compliance from.</div>
      <div style={{display:'flex',flexDirection:'column',gap:'14px'}}>
        <div>
          <label style={lbl}>Composition *</label>
          <input style={inp} value={name} onChange={e=>setName(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); save(); } }}
            placeholder="e.g. 80% Cotton 20% Polyester" autoFocus />
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'5px'}}>
            The full composition string, percentages included — it is both the material’s name and its composition. Its code is assigned automatically.
          </div>
        </div>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':'Save material'}</button>
      </div>
    </Overlay>
  );
}
