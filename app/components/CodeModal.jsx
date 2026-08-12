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

export function CodeModal({ data, canDelete = false, onClose, onSaved, onDeleted }) {
  const editing = !!(data && data.id);
  const [f,setF] = useState({
    code: data?.code || '',
    description: data?.description || '',
    // numeric comes back from PostgREST as a string ("36.50"), which is what the input
    // wants anyway. null becomes '' so the box is empty rather than showing "null".
    total_duty: data?.total_duty == null ? '' : String(data.total_duty),
    active: editing ? !!data.active : true,
  });
  const [saving,setSaving] = useState(false);
  const [deleting,setDeleting] = useState(false);
  // Stripped on every keystroke rather than only on save, so a pasted
  // 6307.90.9000 visibly becomes 6307909000 in the box -- what you see is what
  // gets stored. No length rule: 39269090 is a real 8-digit subheading and a
  // 10-digit check would reject it.
  const setCode = e => setF(p=>({...p, code: e.target.value.replace(/\D/g,'')}));
  // Digits and at most one dot, sanitised on every keystroke like the code above, so
  // a pasted "40.3%" visibly becomes 40.3. The first dot is kept and later ones
  // dropped by position rather than by regex -- /(\..*)\./g leaves "1.2.3.4" as
  // "1.2.34", which is not a number, and the field would look accepted until save.
  //
  // The % is a static suffix beside the box, never part of the value: what is typed
  // is what is stored. total_duty holds the percentage NUMBER, so 40.3 means 40.3%
  // and nothing here multiplies or divides.
  const setDuty = e => setF(p=>{
    const c = e.target.value.replace(/[^\d.]/g,'');
    const i = c.indexOf('.');
    return {...p, total_duty: i === -1 ? c : c.slice(0,i+1) + c.slice(i+1).replace(/\./g,'')};
  });
  // Delete is for mistakes. A code that is genuinely obsolete but still cited
  // should be retired by unticking Active, which keeps it resolvable -- the confirm
  // says so, but only on the path where the distinction actually matters.
  //
  // There is no foreign key from quotes.hts to htscodes, so a delete never fails
  // and never cascades: it silently orphans any quote holding the code, which then
  // shows "Not in the code library" with nothing explaining why. Everything below
  // exists to put that consequence in front of someone before they accept it.
  const remove = async () => {
    setDeleting(true);
    try {
      // htscodes.code is clean -- this form has always stripped non-digits on input
      // -- so an exact match is safe here. quotes.hts is NOT: it predates the closed
      // picker and can hold whitespace or separators, which is why the scan below
      // fetches and normalises in JS instead of filtering with .eq. Anyone assuming
      // both are clean writes a count that silently reads zero.
      const { count: siblings, error: sibErr } = await SB.from('htscodes')
        .select('id', { count:'exact', head:true })
        .eq('code', data.code).neq('id', data.id);
      // A confirm that cannot establish the consequence must not offer to proceed.
      if (sibErr) { toast('Could not check the code library — '+sibErr.message, 'err'); return; }

      const label = data.code + (data.description ? ' — '+data.description : '');
      let message;
      if (siblings > 0) {
        message = 'Delete '+label+'?\n\nAnother entry for '+data.code+' remains in the library, '
          + 'so quotes using this code still resolve.\n\nThis cannot be undone.';
      } else {
        const { data:rows, error:qErr } = await SB.from('quotes').select('id,product,client,hts').not('hts','is',null);
        if (qErr) { toast('Could not check which quotes use this code — '+qErr.message, 'err'); return; }
        const users = (rows||[]).filter(q => String(q.hts ?? '').replace(/\D/g,'') === data.code);
        if (users.length === 0) {
          message = 'Delete '+label+'?\n\nThis is the only entry for '+data.code+', but no quotes use it. '
            + 'Nothing will be orphaned.\n\nThis cannot be undone.';
        } else {
          const names = users.slice(0,2).map(q => q.product || q.client || 'a quote').join(', ');
          message = 'Delete '+label+'?\n\nThis is the only entry for '+data.code+'. '
            + users.length+(users.length===1?' quote uses':' quotes use')+' it — including '+names+' — and will show '
            + '"Not in the code library" with nothing explaining why.\n\n'
            + 'If the code is obsolete but still cited, close this and untick Active instead — that keeps it resolvable.'
            + '\n\nThis cannot be undone.';
        }
      }
      if (!window.confirm(message)) return;

      const { error } = await SB.from('htscodes').delete().eq('id', data.id);
      if (error) { toast('Could not delete code: '+error.message, 'err'); return; }
      toast('Code deleted', 'ok');
      onDeleted();
    } finally { setDeleting(false); }
  };
  const save = async () => {
    const code = f.code.trim();
    // description is NOT NULL with a no-blank CHECK, so it is validated here the same
    // way code is. Writing `|| null` would hand the database a value it rejects and
    // surface a raw constraint error instead of a sentence.
    const description = f.description.trim();
    if (!code) { toast('A code is required','err'); return; }
    if (!description) { toast('A description is required','err'); return; }
    // Blank is a real answer -- "no rate established" -- and must reach the column as
    // NULL, not 0. Number('') is 0, so the empty case is tested before any conversion.
    //
    // A lone '.' is the one thing the keystroke sanitiser can still leave behind, and
    // JSON.stringify turns NaN into null, so without this an unfinished entry would
    // silently save as "no rate" rather than being questioned.
    const dutyRaw = f.total_duty.trim();
    const duty = dutyRaw === '' ? null : Number(dutyRaw);
    if (duty !== null && !isFinite(duty)) { toast('Total duty must be a number, or blank for no rate','err'); return; }
    // numeric(5,2) tops out at 999.99. Caught here so an overflow reads as a sentence
    // rather than as a raw 22003 from Postgres.
    if (duty !== null && duty > 999.99) { toast('Total duty cannot be above 999.99%','err'); return; }
    setSaving(true);
    // One payload, keyed on id. Duty belongs to the ROW, not the code -- 4202320000 is
    // 32.50 for a coin purse and 30.10 for a fabric zip pouch -- so editing one row
    // must never reach another sharing its code.
    const payload = { code, description, total_duty: duty, active: !!f.active };
    // .select().single() on both paths so onSaved can hand the row back.
    const { data:row, error } = editing
      ? await SB.from('htscodes').update(payload).eq('id', data.id).select('id,code,description,total_duty,active').single()
      : await SB.from('htscodes').insert(payload).select('id,code,description,total_duty,active').single();
    setSaving(false);
    if (error) {
      // Uniqueness is on (code, description), so a repeat code is fine as long as
      // the description differs -- one tariff line legitimately covers several kinds
      // of product. The message says which half to change.
      const dupe = error.code === '23505' || /duplicate key|htscodes_code_description_key/i.test(error.message||'');
      toast(dupe ? 'That code already exists with the same description' : 'Could not save code: '+error.message, 'err');
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
        <div>
          <label style={lbl}>Total duty</label>
          {/* The % sits outside the input so it can never end up in the value. */}
          <div style={{display:'flex',alignItems:'center',gap:'8px'}}>
            <input style={{...inp,flex:1,minWidth:0}} value={f.total_duty} onChange={setDuty} inputMode="decimal" placeholder="e.g. 36.5" />
            <span style={{fontSize:'14px',color:'#8A8A8E',flexShrink:0}}>%</span>
          </div>
          <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'5px'}}>The percentage itself — 36.5 means 36.5%. Leave blank if no rate is established.</div>
        </div>
        <label style={{display:'flex',alignItems:'center',gap:'8px',fontSize:'13px',color:'#3A3A3E',cursor:'pointer'}}>
          <input type="checkbox" checked={f.active} onChange={e=>setF(p=>({...p,active:e.target.checked}))} />
          Active <span style={{color:'#A0A0A4'}}>— uncheck to retire it; it stays listed so old quotes still resolve</span>
        </label>
      </div>
      <div style={{display:'flex',justifyContent:'flex-end',gap:'10px',marginTop:'22px'}}>
        {/* Edit path only, so this can never appear in the quote form -- HtsField
            opens the modal with {code: seed} and no id, making `editing` false. */}
        {editing && canDelete && (
          <button onClick={remove} disabled={deleting||saving} style={{marginRight:'auto',background:'none',border:'1px solid #F0C8C8',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#B91C1C',opacity:(deleting||saving)?0.6:1}}>{deleting?'Checking…':'Delete'}</button>
        )}
        <button onClick={onClose} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',color:'#4A4A4E'}}>Cancel</button>
        <button onClick={save} disabled={saving} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 18px',fontSize:'13.5px',fontWeight:500,cursor:'pointer',opacity:saving?0.6:1}}>{saving?'Saving…':(editing?'Save changes':'Save code')}</button>
      </div>
    </Overlay>
  );
}
