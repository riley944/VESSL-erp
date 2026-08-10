'use client';
import React, { useState, useEffect, useMemo } from "react";
import { SB } from "@/lib/supabase";
import { matches, normalizeTerm } from "@/lib/textFilter";
import { CodeModal } from "@/app/components/CodeModal";

// ── HTS Codes ────────────────────────────────────────────────────────────────
// A small curated vocabulary, hand-typed rather than imported from the USITC
// list: twenty-odd codes are actually in use across the quotes, so carrying
// 19,000 rows to hold those would not be proportionate.
//
// Conventions follow app/testing.jsx -- same card and the global .prod-search
// class. The create/edit modal lives in app/components/CodeModal.jsx so the quote
// form can open it too; inp, lbl, Overlay and the toast bridge went with it, and
// only `card` is still needed here for the list, the error panel and Empty.

const card = {background:'#fff',border:'1px solid #ECECEE',borderRadius:'16px',boxShadow:'0 0 0 1px rgba(0,0,0,.02),0 2px 5px rgba(0,0,0,.04),0 12px 28px -8px rgba(20,20,40,.05)'};

// ═══════════════════════════════════════════════════════════════════════════
// canDeleteCodes is a derived boolean rather than the role string, keeping the
// policy next to ROLE_PAGES in page.jsx. Jenn has this page but no Quotes page, so
// deleting a code would orphan quotes she cannot see, in a table she cannot open.
// Retiring stays available to her, which covers the legitimate case.
export default function Codes({ canDeleteCodes = true }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);   // {} for a new code, the row for an edit

  // No caching: the shell unmounts this page on navigation, so every visit
  // refetches. 97 rows of four columns makes that immaterial; it is the first
  // thing to revisit if the table ever grows past a few thousand.
  const load = async () => {
    setLoading(true); setLoadErr('');
    const { data, error } = await SB.from('htscodes').select('id,code,description,active').order('code');
    if (error) { setLoadErr(error.message); setCodes([]); }
    else setCodes(data || []);
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const q = normalizeTerm(search);
  const searching = q.length > 0;
  const shown = useMemo(()=> !q ? codes : codes.filter(c => matches(q, c.code, c.description)), [codes, q]);

  return (
    <div className="db-wrap" style={{padding:'26px 28px 72px',background:'#FBFBFD',minHeight:'calc(100vh - 54px)',marginTop:'-24px',boxSizing:'border-box',overflowX:'hidden',maxWidth:'100%'}}>
      {/* Title */}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:'22px',gap:'14px',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'24px',fontWeight:700,color:'#1A1A1C',letterSpacing:'-.02em'}}>HTS Codes</div>
          <div style={{fontSize:'13.5px',color:'#8A8A8E',marginTop:'3px'}}>Tariff classifications used across quotes</div>
        </div>
        <button onClick={()=>setModal({})} style={{background:'#1A1A1C',color:'#fff',border:'none',borderRadius:'10px',padding:'10px 16px',fontSize:'13.5px',fontWeight:500,cursor:'pointer'}}>+ New code</button>
      </div>

      {/* Search */}
      <div style={{display:'flex',alignItems:'center',gap:'12px',marginBottom:'18px',flexWrap:'wrap'}}>
        <div className="prod-search" style={{flex:'1 1 260px',maxWidth:'440px'}}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input placeholder="Search codes — number or description…" value={search} onChange={e=>setSearch(e.target.value)} />
        </div>
        {searching && <span style={{fontSize:'11.5px',color:'#8A8A8E',fontVariantNumeric:'tabular-nums',whiteSpace:'nowrap'}}>{shown.length} of {codes.length}</span>}
      </div>

      {loading ? <div style={{padding:'60px',textAlign:'center',color:'#8A8A8E'}}>Loading codes…</div> : loadErr ? (
        // codes stays [] on failure rather than being reset, so nothing re-enters
        // the effect and spins. Recovery is this button, not a page reload.
        <div style={{...card,padding:'48px 32px',textAlign:'center'}}>
          <div style={{fontSize:'14px',color:'#B91C1C',marginBottom:'14px'}}>Couldn't load codes: {loadErr}</div>
          <button onClick={load} style={{background:'none',border:'1px solid #E5E7EB',borderRadius:'9px',padding:'8px 16px',fontSize:'13px',fontWeight:500,color:'#4A4A4E',cursor:'pointer'}}>Try again</button>
        </div>
      ) : shown.length === 0 ? (
        <Empty
          title={searching ? 'No codes match “'+search.trim()+'”' : 'No codes yet'}
          sub={searching ? 'Try a different term, or clear the search.' : 'Add the tariff classifications you quote against with + New code.'}
        />
      ) : (
        <div style={{...card,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'150px 1fr 100px',gap:'16px',padding:'12px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
            {['Code','Description','Status'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i===2?'right':'left'}}>{h}</div>)}
          </div>
          {shown.map((c,i)=>(
            // Retired codes stay listed so quotes that already cite them remain
            // resolvable — dimmed rather than hidden, and still editable so they
            // can be brought back.
            <div key={c.id} onClick={()=>setModal(c)}
              style={{display:'grid',gridTemplateColumns:'150px 1fr 100px',gap:'16px',padding:'14px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center',cursor:'pointer',opacity:c.active?1:0.55}}
              onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{c.code}</div>
              <div style={{fontSize:'13px',color:'#3A3A3E',minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.description || <span style={{color:'#C0C0C4'}}>—</span>}</div>
              <div style={{fontSize:'12px',fontWeight:600,textAlign:'right',color:c.active?'#15803D':'#8A8A8E'}}>{c.active?'Active':'Inactive'}</div>
            </div>
          ))}
        </div>
      )}

      {modal && <CodeModal data={modal} canDelete={canDeleteCodes} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();}} onDeleted={()=>{setModal(null);load();}} />}
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
