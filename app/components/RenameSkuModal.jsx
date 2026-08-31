'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';
import { prodKey, productByKey, ensureProductForQuote } from '@/lib/products';

// ── RenameSkuModal ───────────────────────────────────────────────────────────
// One deliberate SKU rename, propagated to CHOSEN references in one transaction
// by vessl.rename_product_sku (script 18), which returns a row-by-row report.
//
// WHY A CHECKLIST AND NOT A CASCADE. A SKU appears in places that mean different
// things. products.sku is the live value. purchase_order_items.product_sku is a
// SNAPSHOT of what an already-issued PO said -- script 16 exists to stop that
// being rewritten silently, so it is offered per row, pre-ticked only while the
// PO is still a draft. sales_order_items.client_sku is a MIXED column: 229 of
// 254 rows hold our SKU and 25 hold the customer's own code (BGTEE1,
// BGLHAC-INTNEW), with nothing recording which, so those are never pre-ticked.
//
// THE OLD SKU IS THE KEY TO EVERYTHING HERE. Enumeration, the ownership checks
// inside the function, and the concurrency guard all use it. That is why the
// callers pass the product row as it stood BEFORE any edit.
const Shell = ({ children }) => (
  <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.42)',backdropFilter:'blur(2px)',zIndex:320,display:'flex',alignItems:'flex-start',justifyContent:'center',padding:'40px 16px',overflowY:'auto'}}>
    <div onClick={e=>e.stopPropagation()} style={{background:'#fff',borderRadius:'18px',boxShadow:'0 12px 48px rgba(0,0,0,.2)',width:'100%',maxWidth:'720px',padding:'24px'}}>{children}</div>
  </div>
);

const pill = (bg,color) => ({display:'inline-block',padding:'2px 8px',borderRadius:'980px',fontSize:'10.5px',fontWeight:700,letterSpacing:'.03em',background:bg,color});

// Only a PO that is still a draft is pre-ticked. doc_status and issued_at are
// NOT consulted: both were designed to say whether a document was issued and
// neither has ever been advanced -- doc_status reads 'draft' on all 68 POs and
// issued_at is null on all 68. Using them would pre-tick every PO in the system.
// Once a PO reaches in_production the factory demonstrably has the document.
const poIsDraft = st => (st||'') === 'draft';

// initialNewSku is what the caller already knows the SKU should become -- from a
// quote save, that is the value just typed. Defaulting to the OLD sku, as this
// did at first, meant the field opened on the value being replaced and Apply was
// disabled until it was retyped from memory.
export function RenameSkuModal({ product, updatedBy = null, initialNewSku = null, onClose, onDone }) {
  const oldSku = product?.sku || '';
  const [newSku, setNewSku] = useState(initialNewSku ?? oldSku);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [report, setReport] = useState(null);
  const [quotes, setQuotes] = useState([]);     // {row, group:'linked'|'key'|'drift'}
  const [pois, setPois] = useState([]);
  const [sois, setSois] = useState([]);
  const [progs, setProgs] = useState([]);
  const [ticked, setTicked] = useState({});     // id -> bool

  useEffect(() => {
    let dead = false;
    (async () => {
      const oldKey = prodKey(product.sku, product.name);
      // Quotes arrive two ways. The FK is authoritative; the sku match is the
      // fallback for the 53 rows script 18 could not link, and is also what
      // surfaces drift -- a quote holding this SKU under a different product
      // name, which the composite key would otherwise miss silently.
      const byLink = await SB.from('quotes').select('id,sku,product,client,product_id').eq('product_id', product.id);
      let bySku = { data: [] };
      if (product.sku == null) bySku = await SB.from('quotes').select('id,sku,product,client,product_id').is('sku', null);
      else if (oldSku)         bySku = await SB.from('quotes').select('id,sku,product,client,product_id').eq('sku', product.sku);

      const seen = new Set();
      const qs = [];
      for (const r of (byLink.data||[])) { seen.add(r.id); qs.push({ row:r, group:'linked' }); }
      for (const r of (bySku.data||[])) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        qs.push({ row:r, group: prodKey(r.sku, r.product) === oldKey ? 'key' : 'drift' });
      }

      const poiRes = await SB.from('purchase_order_items')
        .select('id,product_sku,description,purchase_orders(order_number,status)')
        .eq('product_id', product.id);

      // client_sku is the ONLY reachable path: 0 of 254 SO lines carry a
      // product_id, so there is no id-based enumeration to prefer.
      let soiRes = { data: [] };
      if (oldSku) soiRes = await SB.from('sales_order_items')
        .select('id,client_sku,description,sales_orders(so_number,status)')
        .eq('client_sku', product.sku);

      // Two queries rather than one .or(): a SKU is free text and can contain
      // the commas and parentheses PostgREST's or-filter grammar uses.
      let pg = [];
      if (oldSku) {
        const a = await SB.from('programs').select('id,product,sku,quote_sku,stage').eq('sku', product.sku);
        const b = await SB.from('programs').select('id,product,sku,quote_sku,stage').eq('quote_sku', product.sku);
        const ids = new Set();
        for (const r of [...(a.data||[]), ...(b.data||[])]) { if (!ids.has(r.id)) { ids.add(r.id); pg.push(r); } }
      }

      if (dead) return;
      const t = {};
      qs.forEach(q => { t['q:'+q.row.id] = q.group !== 'drift'; });
      (poiRes.data||[]).forEach(r => { t['p:'+r.id] = poIsDraft(r.purchase_orders?.status); });
      (soiRes.data||[]).forEach(r => { t['s:'+r.id] = false; });   // never pre-ticked
      pg.forEach(r => { t['g:'+r.id] = true; });
      setQuotes(qs); setPois(poiRes.data||[]); setSois(soiRes.data||[]); setProgs(pg);
      setTicked(t); setLoading(false);
    })();
    return () => { dead = true; };
  }, [product.id, product.sku, product.name]);

  const tick = k => setTicked(prev => ({ ...prev, [k]: !prev[k] }));
  const idsFor = (pfx, rows) => rows.map(r => (r.row||r).id).filter(id => ticked[pfx+':'+id]);

  const apply = async () => {
    setErr(''); setBusy(true);
    const { data, error } = await SB.rpc('rename_product_sku', {
      p_product_id:       product.id,
      p_expected_old_sku: product.sku,          // sent raw; null is a real value
      p_new_sku:          newSku.trim(),
      p_quote_ids:        idsFor('q', quotes),
      p_poi_ids:          idsFor('p', pois),
      p_soi_ids:          idsFor('s', sois),
      p_program_ids:      idsFor('g', progs),
      p_updated_by:       updatedBy,
    });
    setBusy(false);
    // The function refuses whole rather than partially: a message here means
    // nothing changed, so the checklist is still valid and can be retried.
    if (error) { setErr(error.message); return; }
    setReport(data || []);
    onDone?.();
  };

  const Row = ({ k, label, sub, right, disabled }) => (
    <label style={{display:'flex',gap:'10px',alignItems:'flex-start',padding:'8px 10px',borderRadius:'10px',cursor:disabled?'default':'pointer',background:ticked[k]?'#F0F7FF':'transparent'}}>
      <input type="checkbox" checked={!!ticked[k]} disabled={disabled} onChange={()=>tick(k)} style={{marginTop:'3px'}} />
      <span style={{minWidth:0,flex:1}}>
        <span style={{display:'block',fontSize:'13px',color:'#1D1D1F'}}>{label}</span>
        {sub && <span style={{display:'block',fontSize:'11.5px',color:'#86868B',marginTop:'1px'}}>{sub}</span>}
      </span>
      {right}
    </label>
  );

  // Empty groups render as "none" rather than vanishing: a missing heading reads
  // as "handled", and the whole point is being able to see what was not touched.
  const Group = ({ title, note, children, count }) => (
    <div style={{marginBottom:'14px'}}>
      <div style={{fontSize:'10px',fontWeight:700,letterSpacing:'.07em',textTransform:'uppercase',color:'#A0A0A4',marginBottom:'4px'}}>{title} ({count})</div>
      {note && <div style={{fontSize:'11.5px',color:'#B45309',marginBottom:'6px'}}>{note}</div>}
      {count ? children : <div style={{fontSize:'12.5px',color:'#C7C7CC',padding:'4px 10px'}}>none</div>}
    </div>
  );

  if (report) {
    return (
      <Shell>
        <h3 style={{margin:'0 0 4px',fontSize:'17px'}}>Renamed</h3>
        <div style={{fontSize:'13px',color:'#86868B',marginBottom:'14px'}}>
          <span style={{fontFamily:'var(--mono)'}}>{oldSku||'(no SKU)'}</span> → <span style={{fontFamily:'var(--mono)'}}>{newSku.trim()}</span>
        </div>
        {report.length ? (
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12.5px'}}>
            <thead><tr style={{borderBottom:'1px solid #EEE'}}>
              {['Table','Column','From','To',''].map(h=><th key={h} style={{textAlign:'left',padding:'6px 8px',fontSize:'9.5px',textTransform:'uppercase',letterSpacing:'.08em',color:'#A0A0A4'}}>{h}</th>)}
            </tr></thead>
            <tbody>
              {report.map((r,i)=>(
                <tr key={i} style={{borderBottom:'1px solid #F5F5F7'}}>
                  <td style={{padding:'6px 8px'}}>{r.target_table}</td>
                  <td style={{padding:'6px 8px',color:'#86868B'}}>{r.column_name}</td>
                  <td style={{padding:'6px 8px',fontFamily:'var(--mono)'}}>{r.old_value ?? '—'}</td>
                  <td style={{padding:'6px 8px',fontFamily:'var(--mono)'}}>{r.new_value}</td>
                  {/* changed=false is reported, not hidden: "already correct" and
                      "not attempted" look identical if only successes are listed. */}
                  <td style={{padding:'6px 8px'}}>{r.changed ? <span style={pill('#E7F7EE','#0B6B3A')}>changed</span> : <span style={pill('#F5F5F7','#86868B')}>already</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div style={{fontSize:'13px',color:'#86868B'}}>The function reported no rows. Nothing was changed.</div>}
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:'18px'}}>
          <button onClick={onClose} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'8px 18px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Done</button>
        </div>
      </Shell>
    );
  }

  const nothingToDo = !newSku.trim() || newSku.trim() === oldSku;

  return (
    <Shell>
      <h3 style={{margin:'0 0 2px',fontSize:'17px'}}>Rename SKU</h3>
      <div style={{fontSize:'12.5px',color:'#86868B',marginBottom:'14px'}}>{product.name||'(unnamed product)'}</div>
      <div style={{display:'flex',alignItems:'center',gap:'10px',marginBottom:'18px'}}>
        <span style={{fontFamily:'var(--mono)',fontSize:'14px',fontWeight:600}}>{oldSku||'(no SKU)'}</span>
        <span style={{color:'#C7C7CC'}}>→</span>
        <input autoFocus value={newSku} onChange={e=>setNewSku(e.target.value)}
               style={{flex:1,fontFamily:'var(--mono)',fontSize:'14px',padding:'7px 10px',border:'1px solid rgba(0,0,0,.12)',borderRadius:'9px',outline:'none'}} />
      </div>

      {loading ? <div style={{padding:'24px',textAlign:'center',color:'#86868B',fontSize:'13px'}}>Finding references…</div> : (
        <>
          <Group title="Quotes" count={quotes.length}>
            {quotes.map(q => (
              <Row key={q.row.id} k={'q:'+q.row.id}
                   label={q.row.product||'(untitled)'}
                   sub={[q.row.client, q.row.sku||'(no SKU)'].filter(Boolean).join(' · ')}
                   right={q.group==='linked' ? <span style={pill('#E7F7EE','#0B6B3A')}>linked</span>
                        : q.group==='key'    ? <span style={pill('#F5F5F7','#86868B')}>matched by SKU + name</span>
                                             : <span style={pill('#FEF3C7','#B45309')}>same SKU, different name</span>} />
            ))}
          </Group>

          <Group title="Purchase order lines" count={pois.length}
                 note={pois.some(r=>!poIsDraft(r.purchase_orders?.status)) ? 'Lines on POs past draft are the SKU the factory was sent. Tick only if that document is being reissued.' : null}>
            {pois.map(r => (
              <Row key={r.id} k={'p:'+r.id}
                   label={r.purchase_orders?.order_number||'(no PO number)'}
                   sub={[r.description, 'snapshot: '+(r.product_sku||'none')].filter(Boolean).join(' · ')}
                   right={<span style={poIsDraft(r.purchase_orders?.status)?pill('#F5F5F7','#86868B'):pill('#FEF3C7','#B45309')}>{(r.purchase_orders?.status||'—').replace(/_/g,' ')}</span>} />
            ))}
          </Group>

          <Group title="Sales order lines" count={sois.length}
                 note="client_sku holds the CUSTOMER's code on some rows and ours on others, and nothing records which. Never pre-ticked — tick only what you have checked.">
            {sois.map(r => (
              <Row key={r.id} k={'s:'+r.id}
                   label={r.sales_orders?.so_number||'(no SO number)'}
                   sub={[r.description, 'client_sku: '+(r.client_sku||'none')].filter(Boolean).join(' · ')}
                   right={<span style={pill('#F5F5F7','#86868B')}>{(r.sales_orders?.status||'—').replace(/_/g,' ')}</span>} />
            ))}
          </Group>

          <Group title="Programs" count={progs.length}>
            {progs.map(r => (
              <Row key={r.id} k={'g:'+r.id}
                   label={r.product||'(untitled)'}
                   sub={['sku: '+(r.sku||'none'), 'quote_sku: '+(r.quote_sku||'none')].join(' · ')}
                   right={<span style={pill('#F5F5F7','#86868B')}>{(r.stage||'—').replace(/_/g,' ')}</span>} />
            ))}
          </Group>
        </>
      )}

      {err && <div style={{background:'#FEF2F2',border:'1px solid #FECACA',color:'#B91C1C',borderRadius:'10px',padding:'10px 12px',fontSize:'12.5px',marginTop:'6px',whiteSpace:'pre-wrap'}}>{err}</div>}

      <div style={{display:'flex',justifyContent:'flex-end',gap:'8px',marginTop:'18px'}}>
        <button onClick={onClose} style={{background:'#F5F5F7',border:'none',borderRadius:'980px',padding:'8px 18px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Cancel</button>
        <button onClick={apply} disabled={busy||loading||nothingToDo}
                style={{background:(busy||loading||nothingToDo)?'#C7C7CC':'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'8px 18px',fontSize:'13px',fontWeight:600,cursor:(busy||loading||nothingToDo)?'default':'pointer'}}>
          {busy?'Applying…':'Apply'}
        </button>
      </div>
    </Shell>
  );
}

// ── QuoteSkuChoiceModal ──────────────────────────────────────────────────────
// A SKU changing on a quote is ambiguous, and guessing is what produced the
// duplicate-product mess in the first place. Two readings are both common:
//
//   the product was RENAMED  -> the customer asked for a new code for the same
//                               thing. BUC-157 -> "BUC-157 KU2607001".
//   it is a DIFFERENT product -> the quote was repointed at something else, and
//                               the old product is untouched and still correct.
//
// So this asks instead of inferring. Declining is a real answer and leaves the
// quote linked to the old product, where the divergence surfaces as the "same
// SKU, different name" drift group the next time anyone opens the rename.
export function QuoteSkuChoiceModal({ product, quote, updatedBy = null, onClose, onDone }) {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);

  const newSku = (quote?.sku || '').trim();
  const name   = (quote?.product || '').trim();

  // Creates the product this quote now describes and points the quote at it.
  // The link is set unconditionally here -- unlike the passive linking elsewhere,
  // which only fills a NULL. This IS a statement about which product the quote
  // belongs to, so re-pointing away from the old one is the whole intent.
  const useDifferentProduct = async () => {
    setErr(''); setBusy(true);
    // Was this insert-then-adopt written out by hand; it is lib/products now, so
    // this path and the two quote-save paths cannot drift apart.
    const before = await productByKey(newSku, name);
    const row = await ensureProductForQuote(newSku, name, { origin: 'quote-save', updatedBy });
    const created = !!row && !before;
    if (!row) { setBusy(false); setErr('Could not create a product for that SKU and name, and no existing one matched.'); return; }
    const upd = await SB.from('quotes').update({ product_id: row.id, ...(updatedBy ? { updated_by: updatedBy } : {}) }).eq('id', quote.id);
    setBusy(false);
    if (upd.error) { setErr('Product '+(created?'created':'found')+', but the quote could not be linked to it — '+upd.error.message); return; }
    setResult({ row, created });
    onDone?.();
  };

  if (mode === 'rename') {
    return <RenameSkuModal product={product} updatedBy={updatedBy} initialNewSku={newSku} onClose={onClose} onDone={onDone} />;
  }

  if (result) {
    return (
      <Shell>
        <h3 style={{margin:'0 0 4px',fontSize:'17px'}}>{result.created ? 'Product created' : 'Existing product adopted'}</h3>
        <div style={{fontSize:'13px',color:'#86868B',marginBottom:'14px'}}>
          {result.created
            ? 'A new product was added and this quote now points at it.'
            : 'A product with that SKU and name already existed, so the quote was linked to it rather than a duplicate being made.'}
        </div>
        <div style={{background:'#FAFAFB',borderRadius:'12px',padding:'12px 14px',fontSize:'13px'}}>
          <div><span style={{fontFamily:'var(--mono)',fontWeight:600}}>{result.row.sku||'(no SKU)'}</span> · {result.row.name}</div>
          <div style={{color:'#86868B',fontSize:'11.5px',marginTop:'4px'}}>quotes.product_id → {result.row.id}</div>
          <div style={{color:'#86868B',fontSize:'11.5px',marginTop:'2px'}}>
            {product?.sku||'(no SKU)'} · {product?.name} was not changed, and neither were any order lines.
          </div>
        </div>
        <div style={{display:'flex',justifyContent:'flex-end',marginTop:'18px'}}>
          <button onClick={onClose} style={{background:'#1D1D1F',color:'#fff',border:'none',borderRadius:'980px',padding:'8px 18px',fontSize:'13px',fontWeight:600,cursor:'pointer'}}>Done</button>
        </div>
      </Shell>
    );
  }

  const Choice = ({ title, body, onPick, primary }) => (
    <button onClick={onPick} disabled={busy}
            style={{display:'block',width:'100%',textAlign:'left',background:primary?'#F0F7FF':'#FAFAFB',border:'1px solid '+(primary?'#CCE2FF':'rgba(0,0,0,.06)'),borderRadius:'12px',padding:'12px 14px',marginBottom:'8px',cursor:busy?'default':'pointer',font:'inherit'}}>
      <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F'}}>{title}</div>
      <div style={{fontSize:'12px',color:'#86868B',marginTop:'3px',lineHeight:1.45}}>{body}</div>
    </button>
  );

  return (
    <Shell>
      <h3 style={{margin:'0 0 2px',fontSize:'17px'}}>The SKU on this quote changed</h3>
      <div style={{fontSize:'12.5px',color:'#86868B',marginBottom:'14px'}}>
        <span style={{fontFamily:'var(--mono)'}}>{product?.sku||'(no SKU)'}</span>
        <span style={{color:'#C7C7CC'}}> → </span>
        <span style={{fontFamily:'var(--mono)'}}>{newSku||'(no SKU)'}</span>
        {' · '}{name||'(untitled)'}
      </div>
      <Choice primary
              title="Rename the product"
              body={'The same physical product, under a new code. Opens the checklist so you can carry the new SKU to the quotes, PO lines and programs that should follow it.'}
              onPick={()=>setMode('rename')} />
      <Choice title="This is a different product"
              body={'Creates a product for '+(newSku||'this SKU')+' and points this quote at it. '+(product?.sku||'The old product')+' keeps its SKU, and no order line is touched.'}
              onPick={useDifferentProduct} />
      <Choice title="No change"
              body={'Leaves the quote linked to '+(product?.sku||'the old product')+'. Nothing is written. The mismatch will show up as drift the next time this product is renamed.'}
              onPick={onClose} />
      {err && <div style={{background:'#FEF2F2',border:'1px solid #FECACA',color:'#B91C1C',borderRadius:'10px',padding:'10px 12px',fontSize:'12.5px',marginTop:'6px',whiteSpace:'pre-wrap'}}>{err}</div>}
      {busy && <div style={{fontSize:'12.5px',color:'#86868B',marginTop:'8px'}}>Working…</div>}
    </Shell>
  );
}
