'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';
// The Testing tab reads a product by the Testing page's own rules (lib/testingStatus.js).
import { fmtDate, daysUntil, EXPIRY_WINDOW_DAYS, efilingKey, EFILING_LABEL,
         latestTestDateByProduct, testingDateOf } from '@/lib/testingStatus';
import { materialLabel } from '@/lib/materialLabel';

// The sample card's Testing tab, moved out of app/programs.jsx as it was, so
// the iPad view's Samples tab (app/m) shows a card's testing exactly as the
// desktop card does. ProgramCard and the iPad view both render it.

// ── THE TESTING TAB (12 Oct) ────────────────────────────────────────────────
// What the Testing page knows about this card's PRODUCT, read-only. Nothing is
// typed or saved here and nothing is copied onto the card: the tab mounts each
// time it is chosen and reads the product's live rows, so whatever Jenn changes
// on the Testing page shows the next time the tab is opened.
//
// THE RULES ARE THE TESTING PAGE'S, imported from lib/testingStatus.js rather
// than restated -- fmtDate, daysUntil, EXPIRY_WINDOW_DAYS, the four eFiling
// readings, and the latest-test-date rule (newest test_date among reports linked
// to the product, else manual_test_date).
//
// EXPIRY IS THE LATEST REPORT'S. The basis is the report with the newest
// test_date; its expiry_date is the expiry. No expiry on that report reads so,
// and does NOT fall back to an older report. With no dated report there is no
// basis, and expiry reads None recorded, manual_test_date or not.
//
// Only reports carrying the product's id count, as on the Testing page and in
// the weekly email; a report linked to a material alone is not this product's.
const TT_LBL = { fontSize:'10px', fontWeight:600, textTransform:'uppercase', letterSpacing:'.06em', color:'#86868B' };
const TT_HEAD = { fontSize:'11px', fontWeight:600, letterSpacing:'.08em', textTransform:'uppercase',
                  color:'#86868B', marginBottom:'6px' };
const TT_NONE = 'None recorded';
// The Testing page's pill colours for an expiry: past, inside the window, and
// clear of it.
const EXPIRY_TONE = {
  expired:  { label:'Expired',  color:'#B91C1C', bg:'#FEE2E2' },
  expiring: { label:'Expiring', color:'#B45309', bg:'#FEF3C7' },
  ok:       { label:'OK',       color:'#15803D', bg:'#DCFCE7' },
};
const expiryTone = d => d === null ? null : d < 0 ? 'expired' : d <= EXPIRY_WINDOW_DAYS ? 'expiring' : 'ok';
const RESULT_LABEL = { pass:'Pass', fail:'Fail', pending:'Pending' };
// A stored status in the Testing page's words -- untested, in_progress, passed,
// failed, expired read Untested, In Progress, Passed, Failed, Expired there.
const statusWords = v => String(v || '').split('_').filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function TestingTab({ r, canOpenTesting = false }) {
  const pid = r.product_id;
  const [data, setData] = useState(null);   // { product, reports, materials, rules }
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!pid) return;
    let dead = false;
    setData(null); setErr('');
    (async () => {
      const [pr, rp, pm, rg] = await Promise.all([
        SB.from('products').select('id,sku,name,efiling_required,efiled_date,manual_test_date').eq('id', pid).maybeSingle(),
        // Newest first, an undated report last, id breaking a tie.
        SB.from('test_reports')
          .select('id,product_id,report_number,test_date,expiry_date,overall_result,pdf_url,lab:labs(name)')
          .eq('product_id', pid)
          .order('test_date', { ascending:false, nullsFirst:false }).order('id', { ascending:false }),
        SB.from('product_materials').select('id,material:materials(id,name,status,material_code)').eq('product_id', pid),
        // The links, then the rules by id -- two plain reads, the way
        // useProductCpscRules reads them, rather than an embed nothing else uses.
        SB.from('product_regulations').select('id,regulation_id').eq('product_id', pid),
      ]);
      if (dead) return;
      const e = [pr, rp, pm, rg].find(x => x.error);
      if (e) { setErr(e.error.message); return; }
      const ids = [...new Set((rg.data || []).map(l => l.regulation_id).filter(Boolean))];
      const rr = ids.length ? await SB.from('regulations').select('id,code,name,citation,active').in('id', ids)
                            : { data: [], error: null };
      if (dead) return;
      if (rr.error) { setErr(rr.error.message); return; }
      const byId = Object.fromEntries((rr.data || []).map(g => [g.id, g]));
      const rules = (rg.data || []).map(l => ({ id: l.id, regulation: byId[l.regulation_id] || null }))
        .sort((a, b) => String((a.regulation || {}).code || '').localeCompare(String((b.regulation || {}).code || '')));
      setData({ product: pr.data || {}, reports: rp.data || [], materials: pm.data || [], rules });
    })();
    return () => { dead = true; };
  }, [pid]);

  const openLink = canOpenTesting && (
    <a href="/#testing" target="_blank" rel="noopener noreferrer"
      style={{fontSize:'12px',fontWeight:600,color:'#0A84FF',textDecoration:'none'}}>Open in Testing →</a>
  );
  const shell = body => (
    <div style={{marginTop:'16px'}}>
      {openLink && <div style={{display:'flex',justifyContent:'flex-end',marginBottom:'8px'}}>{openLink}</div>}
      {body}
    </div>
  );
  const quiet = text => <div style={{fontSize:'12.5px',color:'#A0A0A4'}}>{text}</div>;

  if (!pid) return shell(quiet('No product linked to this card yet. Testing details appear once a product is linked.'));
  if (err) return shell(<div style={{fontSize:'12.5px',color:'var(--hot)'}}>Could not read the testing details — {err}</div>);
  if (!data) return shell(quiet('Reading testing details…'));

  const { product: p, reports, materials, rules } = data;
  // The latest report date by the Testing page's own rule, and the report that
  // carries it -- the first in the newest-first list with that date.
  const latestDate = latestTestDateByProduct(reports)[pid] || null;
  const basis = latestDate ? reports.find(x => x.test_date === latestDate) : null;
  const testDate = testingDateOf({ ...p, id: pid }, latestDate ? { [pid]: latestDate } : {});
  const manual = !latestDate && !!p.manual_test_date;
  const expiry = basis ? basis.expiry_date || null : null;
  const days = daysUntil(expiry);
  const tone = expiryTone(days);
  const efKey = efilingKey(p);
  const efText = EFILING_LABEL[efKey] + (efKey === 'filed' ? ' ' + fmtDate(p.efiled_date) : '');
  const expiryNote = !basis ? TT_NONE : !expiry ? 'No expiry recorded on the latest report' : null;

  const tile = (label, value, sub, color) => (
    <div style={{background:'#F5F5F7',borderRadius:'12px',padding:'10px 12px',minWidth:0}}>
      <div style={TT_LBL}>{label}</div>
      <div style={{fontSize:'15px',fontWeight:600,color:color || '#1D1D1F',marginTop:'4px',lineHeight:1.25}}>{value}</div>
      {sub && <div style={{fontSize:'11px',color:'#86868B',marginTop:'3px',lineHeight:1.35}}>{sub}</div>}
    </div>
  );
  const pill = (text, t) => (
    <span style={{display:'inline-flex',fontSize:'11px',fontWeight:700,borderRadius:'980px',padding:'2px 9px',
                  color:t.color,background:t.bg}}>{text}</span>
  );
  const section = (title, body) => (
    <div style={{marginTop:'16px',paddingTop:'13px',borderTop:'1px solid #ECECEE'}}>
      <div style={TT_HEAD}>{title}</div>
      {body}
    </div>
  );
  // The SystemKnows row, label left and value right.
  const row = (label, value, muted) => (
    <div key={label} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
      <span style={{fontSize:'11.5px',color:'#86868B',minWidth:'118px',flexShrink:0}}>{label}</span>
      <span style={{fontSize:'12.5px',color:muted?'#A0A0A4':'#1D1D1F',lineHeight:1.45}}>{value}</span>
    </div>
  );
  const daysWords = d => d === null ? '' : d < 0 ? Math.abs(d) + ' day' + (d === -1 ? '' : 's') + ' overdue'
                                     : d === 0 ? 'today' : 'in ' + d + ' day' + (d === 1 ? '' : 's');

  return shell(
    <>
      {/* ── SUMMARY ── */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(118px,1fr))',gap:'8px'}}>
        {tile('eFiling', EFILING_LABEL[efKey], efKey === 'filed' ? fmtDate(p.efiled_date) : null,
              efKey === 'undecided' ? '#A0A0A4' : null)}
        {tile('Test report', testDate ? fmtDate(testDate) : TT_NONE, manual ? 'manual' : null,
              testDate ? null : '#A0A0A4')}
        {tile('Days to expiry', days === null ? '—' : String(days),
              tone ? EXPIRY_TONE[tone].label : (expiryNote === TT_NONE ? TT_NONE : 'No expiry recorded'),
              tone ? EXPIRY_TONE[tone].color : '#A0A0A4')}
        {tile('Materials', String(materials.length))}
        {tile('CPSC rules', String(rules.length))}
      </div>

      {section('Testing lab · this card',
        row('Testing lab', r.testing_lab || 'Not recorded', !r.testing_lab))}

      {/* ── 1. eFILING ── */}
      {section('eFiling', <>
        {row('Required', p.efiling_required === true ? 'Yes' : p.efiling_required === false ? 'No' : 'Not set',
             p.efiling_required !== true && p.efiling_required !== false)}
        {row('Status', efText, efKey === 'undecided')}
        {row('eFiled date', p.efiled_date ? fmtDate(p.efiled_date) : TT_NONE, !p.efiled_date)}
      </>)}

      {/* ── 2. TEST REPORTS, newest first ── */}
      {section('Test reports', reports.length === 0
        ? quiet(manual ? TT_NONE + ' — the testing date above was entered by hand.' : TT_NONE)
        : (
          <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
            {reports.map(x => {
              const d = daysUntil(x.expiry_date);
              const t = expiryTone(d);
              const isBasis = basis && basis.id === x.id;
              return (
                <div key={x.id} style={{background:'#fff',border:'1px solid #ECECEE',borderRadius:'10px',padding:'9px 11px'}}>
                  <div style={{display:'flex',alignItems:'baseline',gap:'8px',flexWrap:'wrap'}}>
                    <span style={{fontSize:'13px',fontWeight:600,color:'#1D1D1F'}}>
                      {/* A link only when the report has a file to open. */}
                      {x.pdf_url
                        ? <a href={x.pdf_url} target="_blank" rel="noopener noreferrer"
                            style={{color:'#0A84FF',textDecoration:'underline',textUnderlineOffset:'2px'}}>{x.report_number || 'Report'}</a>
                        : (x.report_number || 'No report number')}
                    </span>
                    {x.overall_result && <span style={{fontSize:'11.5px',color:'#86868B'}}>{RESULT_LABEL[x.overall_result] || x.overall_result}</span>}
                    {isBasis && pill('Basis for expiry', { color:'#1D1D1F', bg:'#E5E5EA' })}
                  </div>
                  <div style={{fontSize:'12px',color:'#5A5A5E',marginTop:'4px',lineHeight:1.5}}>
                    {'Report date ' + (x.test_date ? fmtDate(x.test_date) : '—')}
                    {' · Lab ' + ((x.lab || {}).name || '—')}
                    {' · Expires ' + (x.expiry_date ? fmtDate(x.expiry_date) : '—')}
                    {t && <> · {pill(daysWords(d), EXPIRY_TONE[t])}</>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}

      {/* ── 3. EXPIRATION ── */}
      {section('Expiration', expiryNote ? quiet(expiryNote) : (
        <>
          {row('Expiry date', fmtDate(expiry))}
          {row('Days', <>{days === null ? '—' : daysWords(days)}{tone && <> {pill(EXPIRY_TONE[tone].label, EXPIRY_TONE[tone])}</>}</>)}
          {row('Based on', 'Latest test report' + (basis.report_number ? ' ' + basis.report_number : '')
                           + ', dated ' + fmtDate(basis.test_date))}
        </>
      ))}

      {/* ── 4. MATERIALS ── */}
      {section('Materials', materials.length === 0 ? quiet(TT_NONE) : (
        <div>
          {materials.map(l => (
            row(materialLabel(l.material) || 'Material', l.material && l.material.status ? statusWords(l.material.status) : 'Not set')
          ))}
        </div>
      ))}

      {/* ── 5. CPSC RULES, only when there are any ── */}
      {rules.length > 0 && section('CPSC rules', (
        <div>
          {rules.map(l => {
            const g = l.regulation || {};
            return (
              <div key={l.id} style={{display:'flex',gap:'10px',padding:'6px 0',borderTop:'1px solid #F2F2F4'}}>
                <span style={{fontSize:'12px',fontWeight:600,fontFamily:'var(--mono)',color:'#1D1D1F',minWidth:'118px',flexShrink:0}}>{g.code || '—'}</span>
                <span style={{fontSize:'12.5px',color:'#1D1D1F',lineHeight:1.45}}>
                  {g.name || ''}{g.citation ? <span style={{color:'#86868B'}}> · {g.citation}</span> : null}
                  {g.active === false ? <span style={{color:'#A0A0A4'}}> · retired</span> : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}
