'use client';

// ── RegulationsList ─────────────────────────────────────────────────────────
// The vessl.regulations table rendered as rows. Extracted from testing.jsx so the
// Testing page and the Codes page show one list rather than two that drift -- the
// same reasoning that moved CodeModal and HtsField into this directory.
//
// Style-agnostic by prop, because the two hosts have different cards: Testing uses
// a 20px radius with a soft shadow, Codes a 16px radius with a hairline border.
// Everything inside the card is owned here, so the columns cannot diverge.
//
// Three columns, matching the Codes page's HTS table so the toggle there swaps
// contents and not shape: Code / Rule / Certificate. Testing's old Category and
// "3P required" columns are gone -- both are still edited in RegModal and still
// searched, and as columns they had stopped earning their width: category is
// derived for 68 of 82 rows and holds four values, requires_3p is null on the same
// 68. certificate_required is populated on 79 and is the question the page exists
// to answer.
//
// The empty state is NOT rendered here. Each page words and styles it differently,
// and a shared one would need the copy passed in, which is the prop-creep
// lib/textFilter.js was careful to avoid. Hosts check length and render their own.

// Short forms. The full sheet wording lives in RegModal's select; at 130px a column
// needs a label, not a sentence.
const CERT_PILL = {
  cpc:                  { label:'CPC',          color:'#0A84FF', bg:'#EAF3FE' },
  gcc:                  { label:'GCC',          color:'#4A4A4E', bg:'#F5F5F7' },
  depends_on_age_grade: { label:'By age grade', color:'#B45309', bg:'#FEF3C7' },
  verify:               { label:'Verify',       color:'#B91C1C', bg:'#FEE2E2' },
};

const dash = <span style={{fontSize:'12px',color:'#C7C7CC'}}>—</span>;

// What the search covers, defined once so Testing and Codes cannot disagree about
// what is findable. Pass the result to matches() from lib/textFilter.
//
// notes is in deliberately: "Reese's Law", "STURDY Act" and "banning rule" live
// there and are what someone actually types. category stays even though it is no
// longer a column -- it is still edited, so it should still be found.
//
// Both the stored certificate value and its pill label are included, because they
// differ: the column holds depends_on_age_grade and the row reads "By age grade",
// and someone will search for whichever one they are looking at.
export const regSearchFields = (r) => [
  r.code, r.name, r.category, r.citation, r.notes,
  r.certificate_required, CERT_PILL[r.certificate_required]?.label,
];

export function RegulationsList({ regs, onEdit, cardStyle, dividerColor = '#F2F2F4' }) {
  const grid = { display:'grid', gridTemplateColumns:'180px 1fr 130px', gap:'16px' };
  return (
    <div style={{...cardStyle, overflow:'hidden'}}>
      <div style={{...grid,padding:'13px 22px',borderBottom:'1px solid '+dividerColor,background:'#FAFAFB'}}>
        {['Code','Rule','Certificate'].map((h,i)=>(
          <div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4'}}>{h}</div>
        ))}
      </div>
      {regs.map((r,i)=>{
        const cert = CERT_PILL[r.certificate_required];
        return (
          // Retired rules stay listed where the host fetches them, dimmed rather than
          // hidden and still clickable, so unticking Active can be undone. Testing
          // filters them out at the query; Codes does not.
          <div key={r.id} onClick={()=>onEdit(r)}
            style={{...grid,padding:'14px 22px',borderTop:i>0?'1px solid '+dividerColor:'none',alignItems:'center',cursor:'pointer',transition:'.12s',opacity:r.active===false?0.55:1}}
            onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            {/* The track holds about 24 mono characters and the longest code is exactly
                24 -- 16 CFR 1500.86(a)(7)-(8) -- so the ellipsis is the margin. */}
            <div style={{fontFamily:'var(--mono)',fontSize:'12.5px',fontWeight:600,color:'#1D1D1F',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.code}</div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:'13px',color:'#1D1D1F',fontWeight:500,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.name}</div>
              {(r.applies_to||r.age_group)&&(
                <div style={{fontSize:'11.5px',color:'#A0A0A4',marginTop:'2px',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{[r.applies_to,r.age_group].filter(Boolean).join(' · ')}</div>
              )}
            </div>
            <div>{cert
              ? <span style={{fontSize:'11px',fontWeight:700,color:cert.color,background:cert.bg,borderRadius:'980px',padding:'3px 10px',whiteSpace:'nowrap'}}>{cert.label}</span>
              : dash}</div>
          </div>
        );
      })}
    </div>
  );
}
