'use client';
import React, { useState, useEffect, useMemo } from "react";
import { SB } from "@/lib/supabase";
import { matches, normalizeTerm } from "@/lib/textFilter";
import { CodeModal } from "@/app/components/CodeModal";
import { RegulationsList, regSearchFields } from "@/app/components/RegulationsList";
import { RegModal } from "@/app/components/RegModal";

// ── Codes ────────────────────────────────────────────────────────────────────
// Two libraries the business files things against, behind one toggle:
//
//   HTS       vessl.htscodes    -- customs classification, cited by quotes
//   CPSC      vessl.regulations -- compliance rules, cited by test reports
//
// The CPSC half is the same table and the same editor the Testing page's
// Regulations tab uses, through RegulationsList and RegModal in app/components.
// Two mount points, one implementation: Jenn keeps her list where she logs
// reports, and it cannot drift from this one.
//
// Both halves render three columns on the same grid, so the toggle swaps contents
// rather than shape. HTS's first track widened from 150px to 180px to match --
// harmless there, since an HTS code is ten digits, and necessary for the CPSC
// side, where a code can carry subsection detail up to 24 characters.

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 0 0 1px rgba(0,0,0,.02),0 2px 5px rgba(0,0,0,.04),0 12px 28px -8px rgba(20,20,40,.05)'};

// value, tab label, the noun in the search placeholder, and the create button.
const MODES = [
  ['hts',  'HTS Codes',  'codes — number or description…',        '+ New code'],
  ['cpsc', 'CPSC Rules', 'rules — code, name, certificate, note…', '+ New rule'],
];

// ═══════════════════════════════════════════════════════════════════════════
// canDeleteCodes is a derived boolean rather than the role string, keeping the
// policy next to ROLE_PAGES in page.jsx. Jenn has this page but no Quotes page, so
// deleting an HTS code would orphan quotes she cannot see, in a table she cannot
// open. Retiring stays available to her, which covers the legitimate case.
//
// It deliberately does NOT gate CPSC deletion. She can already delete a regulation
// from the Testing page, so gating it here would mean the same person had the same
// power on one page and not another. RegModal's confirm counts what a deletion
// would orphan and says the number, which is the better guard.
export default function Codes({ canDeleteCodes = true }) {
  const [mode, setMode] = useState('hts');
  const [codes, setCodes] = useState([]);
  const [regs, setRegs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);   // {} for a new row, the row for an edit

  // No caching: the shell unmounts this page on navigation, so every visit
  // refetches. ~180 rows across both tables makes that immaterial; it is the first
  // thing to revisit if either grows past a few thousand.
  //
  // Both load together rather than per mode, so flipping the toggle is instant and
  // the counts on both buttons are true before either has been opened.
  //
  // Unlike Testing, regulations are NOT filtered to active here. Retiring is the
  // sanctioned alternative to deleting, and a retired rule you cannot see is one you
  // cannot bring back. They render dimmed, exactly as retired HTS codes do.
  const load = async () => {
    setLoading(true); setLoadErr('');
    const [c, r] = await Promise.all([
      SB.from('htscodes').select('id,code,description,active').order('code'),
      SB.from('regulations').select('*').order('sort_order').order('code'),
    ]);
    if (c.error || r.error) { setLoadErr((c.error || r.error).message); setCodes([]); setRegs([]); }
    else { setCodes(c.data || []); setRegs(r.data || []); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const q = normalizeTerm(search);
  const searching = q.length > 0;
  const shownCodes = useMemo(()=> !q ? codes : codes.filter(c => matches(q, c.code, c.description)), [codes, q]);
  const shownRegs  = useMemo(()=> !q ? regs  : regs.filter(r => matches(q, ...regSearchFields(r))), [regs, q]);

  const hts = mode === 'hts';
  const [, , placeholder, createLabel] = MODES.find(m => m[0] === mode);
  const shown = hts ? shownCodes : shownRegs;
  const total = hts ? codes.length : regs.length;

  return (
    <div className="db-wrap" style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {/* Title */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'22px',gap:'14px',flexWrap:'wrap'}}>
        <div>
          <div style={{display:'flex',alignItems:'center',gap:'8px',marginBottom:'8px'}}><span style={{width:'7px',height:'7px',borderRadius:'50%',background:'#0A84FF'}}/><span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.12em',textTransform:'uppercase',color:'#86868B'}}>Trade Classification</span></div>
          <div style={{fontSize:'32px',fontWeight:700,color:'#1D1D1F',letterSpacing:'-.032em',lineHeight:1.02}}>Codes</div>
          <div style={{fontSize:'14px',color:'#86868B',marginTop:'7px',letterSpacing:'-.01em'}}>{hts ? 'Tariff classifications used across quotes' : 'CPSC rules products are certified against'}</div>
        </div>
        <button onClick={()=>setModal({})} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>{createLabel}</button>
      </div>

      {/* Toggle + search. Switching clears the search: a term that matched codes
          almost never matches rules, and a list that reads empty on arrival looks
          broken rather than filtered. */}
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'18px',flexWrap:'wrap'}}>
        <div style={{display:'inline-flex',background:'#ECECF0',borderRadius:'12px',padding:'4px'}}>
          {MODES.map(([v,l])=>(
            <button key={v} onClick={()=>{setMode(v);setSearch('');}}
              style={{display:'inline-flex',alignItems:'center',gap:'7px',padding:'8px 15px',borderRadius:'9px',border:'none',cursor:'pointer',fontSize:'13px',fontWeight:600,letterSpacing:'-.01em',background:mode===v?'#1A1A1C':'transparent',color:mode===v?'#fff':'#5A5A5E',boxShadow:mode===v?'0 1px 3px rgba(0,0,0,.18)':'none',transition:'.14s'}}>
              {l}<span style={{fontSize:'11px',fontWeight:700,borderRadius:'20px',padding:'1px 7px',background:mode===v?'rgba(255,255,255,.22)':'#DCDCE0',color:mode===v?'#fff':'#6A6A6E'}}>{v==='hts'?codes.length:regs.length}</span>
            </button>
          ))}
        </div>
        <div className="prod-search" style={{flex:'1 1 260px',maxWidth:'440px'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder={'Search '+placeholder} value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {searching && <span style={{fontSize:'11.5px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{shown.length} of {total}</span>}
      </div>

      {loading ? <div style={{padding:'60px',textAlign:'center',color:'#8A8A8E'}}>Loading…</div> : loadErr ? (
        // Both lists stay [] on failure rather than being reset, so nothing re-enters
        // the effect and spins. Recovery is this button, not a page reload.
        <div style={{...card,padding:'48px 32px',textAlign:'center'}}>
          <div style={{fontSize:'14px',color:'#B91C1C',marginBottom:'14px'}}>Couldn't load: {loadErr}</div>
          <button onClick={load} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'8px 16px',fontSize:'13px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>Try again</button>
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={searching
            ? 'No '+(hts?'codes':'rules')+' match “'+search.trim()+'”'
            : 'No '+(hts?'codes':'rules')+' yet'}
          sub={searching ? 'Try a different term, or clear the search.'
            : hts ? 'Add the tariff classifications you quote against with + New code.'
                  : 'Add the CPSC rules you certify against with + New rule.'}
        />
      ) : hts ? (
        <div style={{...card,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'180px 1fr 130px',gap:'16px',padding:'13px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
            {['Code','Description','Status'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i===2?'right':'left'}}>{h}</div>)}
          </div>
          {shownCodes.map((c,i)=>(
            // Retired codes stay listed so quotes that already cite them remain
            // resolvable — dimmed rather than hidden, and still editable so they
            // can be brought back.
            <div key={c.id} onClick={()=>setModal(c)}
              style={{display:'grid',gridTemplateColumns:'180px 1fr 130px',gap:'16px',padding:'14px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center',cursor:'pointer',opacity:c.active?1:0.55}}
              onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{c.code}</div>
              <div style={{fontSize:'13px',color:'#3A3A3E',minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.description || <span style={{color:'#C0C0C4'}}>—</span>}</div>
              <div style={{fontSize:'12px',fontWeight:600,textAlign:'right',color:c.active?'#15803D':'#8A8A8E'}}>{c.active?'Active':'Inactive'}</div>
            </div>
          ))}
        </div>
      ) : (
        <RegulationsList regs={shownRegs} onEdit={(r)=>setModal(r)} cardStyle={card} dividerColor="#F2F2F4" />
      )}

      {/* One modal slot, two editors -- which one opens follows the toggle, so a row
          can only ever be opened by the editor for its own table. */}
      {modal && (hts
        ? <CodeModal data={modal} canDelete={canDeleteCodes} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} onDeleted={()=>{setModal(null);load();}} />
        : <RegModal  data={modal} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} onDeleted={()=>{setModal(null);load();}} />)}
    </div>
  );
}

function Empty({ title, sub }) {
  return (
    <div style={{...card,padding:'56px 32px',textAlign:'center'}}>
      <div style={{width:'52px',height:'52px',borderRadius:'14px',background:'#F2F2F6',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 16px'}}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#A0A0A4" strokeWidth="1.6"><path d="M4 7V5a2 2 0 0 1 2-2h2M16 3h2a2 2 0 0 1 2 2v2M20 17v2a2 2 0 0 1-2 2h-2M8 21H6a2 2 0 0 1-2-2v-2"/><path d="M8 12h8"/></svg>
      </div>
      <div style={{fontSize:'16px',fontWeight:600,color:'#1A1A1C',marginBottom:'7px'}}>{title}</div>
      <div style={{color:'#8A8A8E',fontSize:'13.5px',maxWidth:'380px',margin:'0 auto',lineHeight:1.6}}>{sub}</div>
    </div>
  );
}
