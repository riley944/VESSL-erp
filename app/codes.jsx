'use client';
import React, { useState, useEffect, useMemo } from "react";
import { SB } from "@/lib/supabase";
import { matches, normalizeTerm } from "@/lib/textFilter";
import { CodeModal } from "@/app/components/CodeModal";
import { RegulationsList, regSearchFields, CERT_PILL } from "@/app/components/RegulationsList";
import { RegModal } from "@/app/components/RegModal";
import { ExportButton } from "@/app/components/ExportButton";
import { loadExcelJS } from "@/lib/excel";

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
  // USAGE, FOR THE EXPORT ONLY. Neither list shows these counts on screen -- they are
  // the question a spreadsheet gets asked and the page does not: which rules are
  // actually linked, and which codes anybody cites.
  //
  // Three id-only fetches rather than three counting queries, because PostgREST has no
  // GROUP BY: ~500 short rows, counted once below. A failure here leaves the counts at
  // zero and the page working, which is why they are not part of the load guard.
  const [regLinks, setRegLinks] = useState([]);
  const [quoteHts, setQuoteHts] = useState([]);
  const [productHts, setProductHts] = useState([]);

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
    const [c, r, pl, qh, ph] = await Promise.all([
      SB.from('htscodes').select('id,code,description,total_duty,duty_note,active').order('code'),
      SB.from('regulations').select('*').order('sort_order').order('code'),
      SB.from('product_regulations').select('regulation_id'),
      // An HTS code is cited on a QUOTE (quotes.hts) and, in principle, on a product
      // (products.hts_code). Both are read, because the export reports both counts and
      // a column that is empty today is not the same as one that cannot fill.
      SB.from('quotes').select('hts').not('hts','is',null),
      SB.from('products').select('hts_code').not('hts_code','is',null),
    ]);
    if (c.error || r.error) { setLoadErr((c.error || r.error).message); setCodes([]); setRegs([]); }
    else { setCodes(c.data || []); setRegs(r.data || []); }
    setRegLinks(pl.data || []); setQuoteHts(qh.data || []); setProductHts(ph.data || []);
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

  // ── EXPORT WHAT IS ON SCREEN ───────────────────────────────────────────────
  // shownCodes / shownRegs, in the order the list is in -- codes by code, rules by
  // sort_order then code, which is the query order and the only order this page has.
  // The search narrows both, so the file is the list.
  //
  // ONE CONTROL, TWO LISTS: the toggle already decides which list a person is looking
  // at, so the button follows it -- columns, sheet name and filename all come from the
  // active mode. A second button for the list not on screen would export something
  // nobody can see.
  //
  // Built the same way as the Products and Testing exports: one column list per format,
  // a Filters sheet in the workbook, the same quoting, BOM and CRLF in the CSV, and the
  // shared ExportButton. Each entry is [header, read, kind].
  const countBy = (rows, pick) => {
    const m = new Map();
    rows.forEach(row => { const k = (pick(row) || '').trim(); if (k) m.set(k, (m.get(k) || 0) + 1); });
    return m;
  };
  const linkCount = useMemo(()=>{
    const m = new Map();
    regLinks.forEach(l => { if (l.regulation_id) m.set(l.regulation_id, (m.get(l.regulation_id) || 0) + 1); });
    return m;
  },[regLinks]);
  const quoteCites  = useMemo(()=>countBy(quoteHts,   r => r.hts),      [quoteHts]);
  const productUses = useMemo(()=>countBy(productHts, r => r.hts_code), [productHts]);

  const HTS_COLS = [
    ['Code',              c => c.code || ''],
    ['Description',       c => c.description || ''],
    // parseFloat drops the stored scale, so 36.50 exports as 36.5 -- the number the row
    // shows. Null stays null, so an unrated code leaves the cell empty rather than 0.
    ['Total duty %',      c => c.total_duty == null ? null : parseFloat(c.total_duty), 'num'],
    // The asterisk on the row means this: a compound rate whose specific part cannot
    // live in the percentage, so the figure beside it understates the duty.
    ['Duty note',         c => c.duty_note || ''],
    ['Status',            c => c.active ? 'Active' : 'Inactive'],
    ['Products using it', c => productUses.get((c.code || '').trim()) || 0, 'num'],
    ['Quotes citing it',  c => quoteCites.get((c.code || '').trim()) || 0, 'num'],
  ];
  const CPSC_COLS = [
    ['Rule code',            r => r.code || ''],
    ['Rule',                 r => r.name || ''],
    ['Category',             r => r.category || ''],
    // The two applies-to fields the table actually has. There is no materials column on
    // vessl.regulations; what a rule covers is written in applies_to and the notes.
    ['Applies to',           r => r.applies_to || ''],
    ['Age grade',            r => r.age_group || ''],
    // The pill's wording, so the file reads as the row does -- the column stores
    // depends_on_age_grade where the row shows "By age grade".
    ['Certificate required', r => (CERT_PILL[r.certificate_required] || {}).label || r.certificate_required || ''],
    // Three-state: null means nobody has recorded an answer, which is not "No".
    ['Third-party testing',  r => r.requires_3p == null ? '' : r.requires_3p ? 'Yes' : 'No'],
    ['Citation',             r => r.citation || ''],
    ['Notes',                r => r.notes || ''],
    ['Status',               r => r.active === false ? 'Inactive' : 'Active'],
    ['Products linked',      r => linkCount.get(r.id) || 0, 'num'],
  ];
  // Everything the two writers need that differs by mode, decided once.
  const exportSet = () => hts
    ? { cols:HTS_COLS,  rows:shownCodes, sheet:'HTS codes',  file:'hts-codes',  title:'King Universal - HTS codes',  total:codes.length, noun:'codes' }
    : { cols:CPSC_COLS, rows:shownRegs,  sheet:'CPSC rules', file:'cpsc-rules', title:'King Universal - CPSC rules', total:regs.length,  noun:'rules' };
  const exportFilterPairs = (set) => [
    ['Search', search.trim() || '(none)'],
    ['List', hts ? 'HTS codes' : 'CPSC rules'],
    ['Order', hts ? 'Code' : 'Sort order, then code'],
    ['Retired rows', 'Included'],
    ['Rows shown', set.rows.length + ' of ' + set.total],
  ];
  const stampToday = () => {
    const d = new Date();
    return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
  };
  const downloadFile = (blob, filename) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  };
  const [exporting, setExporting] = useState(false);

  const exportXlsx = async () => {
    const set = exportSet();
    if (!set.rows.length) return;
    setExporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VESSL'; wb.created = new Date();

      const ws = wb.addWorksheet(set.sheet);
      ws.addRow(set.cols.map(c => c[0]));
      set.rows.forEach(row => ws.addRow(set.cols.map(c => c[1](row))));

      ws.getRow(1).font = { bold: true };
      ws.views = [{ state:'frozen', ySplit:1 }];
      ws.autoFilter = { from:{ row:1, column:1 }, to:{ row:1, column:set.cols.length } };

      set.cols.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        if (c[2] === 'num') col.alignment = { horizontal:'right' };
        let w = String(c[0]).length;
        set.rows.forEach(row => {
          const v = c[1](row);
          const len = v == null ? 0 : String(v).length;
          if (len > w) w = len;
        });
        col.width = Math.min(Math.max(w + 3, 9), 48);
      });

      const fs2 = wb.addWorksheet('Filters');
      fs2.addRow(['Export', set.title]);
      fs2.addRow(['Generated', new Date()]);
      fs2.addRow(['Rows in this file', set.rows.length]);
      fs2.addRow(['Rows in the library', set.total]);
      fs2.addRow([]);
      fs2.addRow(['Filter', 'Applied']);
      exportFilterPairs(set).forEach(pair => fs2.addRow(pair));
      fs2.getRow(1).font = { bold: true };
      fs2.getRow(6).font = { bold: true };
      fs2.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm';
      fs2.getColumn(1).width = 36;
      fs2.getColumn(2).width = 54;

      const buf = await wb.xlsx.writeBuffer();
      downloadFile(new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
                   set.file+'-'+stampToday()+'.xlsx');
    } catch (e) {
      alert('Could not build the export: '+((e && e.message) || e));
    }
    setExporting(false);
  };

  const exportCsv = () => {
    const set = exportSet();
    if (!set.rows.length) return;
    // Every field quoted, so a comma or a quote inside a rule's notes cannot spill.
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const applied = exportFilterPairs(set).filter(([, v]) => v !== '(none)');
    const lines = [];
    lines.push(cell('# ' + applied.map(([k, v]) => k + ' = ' + v).join(' · ')));
    lines.push(set.cols.map(c => cell(c[0])).join(','));
    set.rows.forEach(row => lines.push(set.cols.map(c => cell(c[1](row))).join(',')));
    const csv = '﻿' + lines.join('\r\n') + '\r\n';
    downloadFile(new Blob([csv], { type:'text/csv;charset=utf-8;' }), set.file+'-'+stampToday()+'.csv');
  };

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
        {/* At the end of the row, exporting whichever list the toggle is showing and
            whatever the search left of it. Same control as Testing and Products. */}
        <div style={{marginLeft:'auto'}}>
          <ExportButton count={shown.length} busy={exporting}
                        onXlsx={exportXlsx} onCsv={exportCsv} align="right" />
        </div>
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
          {/* Four tracks here against RegulationsList's three, so the toggle no longer
              swaps contents alone. Deliberate: duty is information a CPSC rule does not
              have, and the parity rule was about not showing the SAME information two
              ways, not about refusing to show more where there is more. */}
          <div style={{display:'grid',gridTemplateColumns:'180px 1fr 100px 110px',gap:'16px',padding:'13px 22px',borderBottom:'1px solid #ECECEE',background:'#FAFAFB'}}>
            {['Code','Description','Duty','Status'].map((h,i)=><div key={i} style={{fontSize:'10px',fontWeight:600,letterSpacing:'.06em',textTransform:'uppercase',color:'#A0A0A4',textAlign:i>=2?'right':'left'}}>{h}</div>)}
          </div>
          {shownCodes.map((c,i)=>(
            // Retired codes stay listed so quotes that already cite them remain
            // resolvable — dimmed rather than hidden, and still editable so they
            // can be brought back.
            <div key={c.id} onClick={()=>setModal(c)}
              style={{display:'grid',gridTemplateColumns:'180px 1fr 100px 110px',gap:'16px',padding:'14px 22px',borderTop:i>0?'1px solid #F2F2F4':'none',alignItems:'center',cursor:'pointer',opacity:c.active?1:0.55}}
              onMouseEnter={e=>e.currentTarget.style.background='#FAFAFB'} onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{fontSize:'13.5px',fontWeight:600,color:'#1A1A1C',fontVariantNumeric:'tabular-nums'}}>{c.code}</div>
              <div style={{fontSize:'13px',color:'#3A3A3E',minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.description || <span style={{color:'#C0C0C4'}}>—</span>}</div>
              {/* parseFloat drops the stored scale, so 36.50 reads 36.5% and 30.00 reads
                  30%. The em dash is the same one the Description cell uses for empty --
                  a row with no rate is a normal state rather than an error. No count
                  here: it moves whenever anyone fills one in, and a stale number in a
                  comment is worse than none.
                  THE ASTERISK IS NOT DECORATION. A row with a duty_note carries a
                  compound rate whose specific part cannot live in the percentage, so
                  the figure beside it is an understatement. Marked at the rate, not in
                  the description, because the rate is the thing being qualified -- and
                  title rather than a second column, since the list is a fixed four-column
                  grid and one qualified row in a hundred does not earn a column. */}
              <div style={{fontSize:'13px',color:'#3A3A3E',textAlign:'right',fontVariantNumeric:'tabular-nums'}}>
                {c.total_duty == null ? <span style={{color:'#C0C0C4'}}>—</span> : parseFloat(c.total_duty)+'%'}
                {c.duty_note && <span title={'Plus a surcharge not included in this percentage: ' + c.duty_note} style={{color:'#B45309',fontWeight:700,marginLeft:'3px',cursor:'help'}}>*</span>}
              </div>
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
