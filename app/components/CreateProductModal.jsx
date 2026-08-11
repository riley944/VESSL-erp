'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';
import { HtsField, useHtsCodes } from '@/app/components/HtsField';
import { CodeModal } from '@/app/components/CodeModal';

// ── CreateProductModal (create or edit a row in vessl.products) ──────────────
// Lifted out of page.jsx, where it was unreachable — it rendered only under a
// modal key nothing ever set. It lives here rather than in page.jsx because its
// only caller is app/testing.jsx, which page.jsx already imports; importing it
// back the other way would be circular.
//
// regs and links are passed in rather than fetched. app/testing.jsx already holds
// both, and a second fetch would let this modal and the product row behind it
// disagree about the same product -- the row would show one count and the modal
// another, with nothing to say which was right.
//
// fmtDay is a deliberate duplicate of fmtDate in app/testing.jsx, not an import.
// That module imports THIS one, so importing back would close a cycle -- the same
// circularity this file's header already warns about for page.jsx. Passing a
// formatted string in would need a new prop, and efiled_date is already on `data`.
//
// The T12:00:00 is the whole point of copying it rather than writing something
// shorter. A bare 'YYYY-MM-DD' parses as UTC midnight, which toLocaleDateString
// renders as the PREVIOUS day anywhere west of UTC. Landing the instant at local
// noon means neither direction can cross midnight. A filing date off by one is
// exactly what nobody notices.
//
// The honest fix is moving fmtDate to lib/ beside textFilter.js, which is the
// precedent for a pure function shared by a page module and a component. That
// edits testing.jsx, so it belongs with the next pass over that file.
const fmtDay = (s) => {
  if (!s) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s);
  // Falls back to the stored text rather than an em dash: efiled_date is a `date`
  // column so this cannot fire today, but if it ever does, seeing the bad value
  // beats seeing a placeholder that looks like "not filed".
  return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month:'short', day:'2-digit', year:'numeric' });
};

// Pass `data` to edit that row, omit it to create — the same shape MaterialModal
// uses. Every class name below resolves from globals.css, so this file needs no
// styles of its own.
export function CreateProductModal({ data, regs = [], links = [], onClose, onCreated }) {
  const editing = !!(data && data.id);
  // Read-only. LinkRulesModal is the only writer of product_regulations.
  //
  // Resolved by iterating regs rather than links, so the order matches the rule
  // library's own -- sort_order then code -- instead of whatever order the link rows
  // came back in.
  //
  // regs is filtered to active by the Testing page, so a link to a RETIRED rule
  // resolves to nothing. Counting the shortfall rather than letting those rows
  // silently disappear: the link is real, and a block that quietly shows fewer rules
  // than are linked is the same failure as a picker that blanks an unlisted code.
  const linkedIds = new Set(links.map(l => l.regulation_id));
  const linkedRules = regs.filter(r => linkedIds.has(r.id));
  const retiredCount = links.length - linkedRules.length;
  const [saving, setSaving] = useState(false);
  // The DB hands numbers back as numbers; every box here is a string.
  const s = v => (v === null || v === undefined ? '' : String(v));
  const [form, setForm] = useState({
    sku:s(data?.sku), name:s(data?.name), desc:s(data?.description), hs:s(data?.hts_code),
    uom:s(data?.unit_of_measure), wt:s(data?.weight_kg), upc:s(data?.units_per_carton),
    cwt:s(data?.carton_weight_kg), cl:s(data?.carton_l_cm), cw:s(data?.carton_w_cm), ch:s(data?.carton_h_cm),
    cpscType:s(data?.cpsc_type),
  });
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  // Fetched here rather than by the Testing page's load(), which has no reason to pull
  // quotes for any other tab. PostgREST has no DISTINCT, and a SKU repeats across quote
  // rows, so the de-dupe happens here -- ~275 rows collapse to ~240 SKUs.
  const [skus, setSkus] = useState([]);
  useEffect(()=>{
    let alive = true;
    SB.from('quotes').select('sku,product').not('sku','is',null).order('sku').limit(1000)
      .then(({data,error})=>{
        // On error the list simply stays empty and the field renders as plain text.
        // quotes is a different table with its own policies; a refusal there must not
        // take the modal down when the user only wanted to type a SKU.
        if(!alive || error || !data) return;
        const seen = new Map();
        data.forEach(r=>{
          const sku = (r.sku||'').trim();
          if(!sku || seen.has(sku)) return;
          seen.set(sku, (r.product||'').trim());
        });
        setSkus([...seen].map(([sku,product])=>({sku,product})));
      });
    return ()=>{ alive = false; };
  },[]);
  // HTS Code is a closed picker over vessl.htscodes, the same control the quote form
  // uses. It cannot be typed into: a code that is not in the library is added through
  // "+ Add code" below, which writes the library row first and then selects it.
  //
  // hts_code is empty on all 271 products today, so nothing here has to cope with a
  // stored value the library does not know -- but HtsField renders whatever is stored
  // regardless, because retiring or deleting a code creates exactly that case and
  // there is no foreign key to prevent it. See the rule in HtsField.jsx.
  const { codes: htsCodes, addCode } = useHtsCodes();
  const [addingCode, setAddingCode] = useState(null);
  const onCodeAdded = (row) => {
    setAddingCode(null);
    if (!row) return;
    addCode(row);
    setForm(prev=>({...prev, hs:row.code}));   // select it without leaving the modal
  };
  const submit = async () => {
    // Name identifies a product here; a SKU is nice to have and often assigned later.
    const name = form.name.trim();
    const sku  = form.sku.trim();
    if (!name) { alert('Product name required'); return; }
    setSaving(true);
    const payload = {
      // products_sku_key is UNIQUE and Postgres does not treat NULLs as equal, so any
      // number of SKU-less products can coexist -- but a second '' would collide.
      sku:sku||null, name:name, description:form.desc||null,
      // unit_of_measure has a DB default of 'pcs', but a default only fires when the
      // key is absent -- sending null keeps the column empty until someone types a unit.
      hts_code:form.hs||null, unit_of_measure:form.uom||null, weight_kg:Number(form.wt)||null,
      // 'N/A' is not a type, so it clears to NULL and the column reads the same
      // whether it was never set or emptied out. products_cpsc_type_chk accepts only
      // NULL, 'GCC' or 'CPC', which is why '' must not reach it.
      cpsc_type:form.cpscType||null,
      // cpsc_code is deliberately absent. Its input was removed because the column
      // has never held a value -- null on all 271 rows, and nothing anywhere read it.
      //
      // The COLUMN is still there on purpose. Dropping it is irreversible, an empty
      // column costs nothing, and the field can come back without a migration if
      // certificate numbers turn out to matter. Omitting the key rather than sending
      // null also means an update leaves the column alone, so a value written by hand
      // would survive an edit here rather than being wiped by it.
      //
      // It is NOT superseded by the linked rules below. The rules are what a product
      // is certified against; cpsc_code was the number off the issued GCC or CPC
      // document. Different things -- this was removed as unused, not replaced.
      units_per_carton:Number(form.upc)||null, carton_weight_kg:Number(form.cwt)||null,
      carton_l_cm:Number(form.cl)||null, carton_w_cm:Number(form.cw)||null, carton_h_cm:Number(form.ch)||null
    };
    // category_id is written explicitly on create so every new row carries the same
    // key set (product_categories has no rows to pick from). On edit it is left out
    // rather than nulled, so a category set elsewhere survives a save here.
    const { error } = editing
      ? await SB.from('products').update(payload).eq('id', data.id)
      : await SB.from('products').insert({ ...payload, category_id:null });
    setSaving(false);
    if (error) {
      const dupe = error.code === '23505' || /duplicate key|products_sku_key/i.test(error.message||'');
      alert(dupe ? 'That SKU already exists' : 'Error: '+error.message);
      return;   // stay open so the entry is not lost
    }
    onCreated();
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      {/* Sibling of the modal box, not a child of modal-body -- that is overflow-y:auto
          and would be a scroll container wrapping a fixed-position overlay. This is the
          arrangement the quote form already uses. It needs no stopPropagation: its own
          backdrop makes e.target the inner overlay, so the test above fails and the
          product draft underneath survives. CodeModal is zIndex 300 against this
          overlay's 100, so it stacks on top without help. */}
      {addingCode && <CodeModal data={addingCode} onClose={()=>setAddingCode(null)} onSaved={onCodeAdded} />}
      <div className="modal-box">
        <div className="modal-head"><h3>{editing?'Edit Product':'New Product'}</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          {/* A datalist gives no visual cue that suggestions exist, so the chevron and
              the hint are what make it findable. The input still accepts anything —
              the list narrows as you type, it does not constrain. */}
          <div className="form-row">
            <label>SKU <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>{skus.length?'(pick one or type a new one)':'(optional)'}</span></label>
            <div style={{position:'relative'}}>
              <input className="form-input" list={skus.length?'cpm-sku-list':undefined} value={form.sku} onChange={e=>f('sku')(e.target.value)} placeholder="KUI-XXXX-00 — optional" style={skus.length?{paddingRight:'30px'}:undefined} />
              {skus.length>0 && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{position:'absolute',right:'11px',top:'50%',transform:'translateY(-50%)',pointerEvents:'none',color:'var(--muted)'}}><polyline points="6 9 12 15 18 9"/></svg>
              )}
            </div>
            {/* value is the SKU alone; the text content is only the descriptive label
                the browser shows beside it, and is never what gets written. */}
            {skus.length>0 && <datalist id="cpm-sku-list">{skus.map(s=><option key={s.sku} value={s.sku}>{s.product}</option>)}</datalist>}
          </div>
          <div className="form-row"><label>Product Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
          <div className="form-row"><label>Description</label><textarea className="form-textarea" value={form.desc} onChange={e=>f('desc')(e.target.value)} /></div>
          {/* Its own full-width row rather than a third of a form-row-3. At ~170px the
              closed control ellipsised the selected code and its description away, so
              you could not read back what you had picked. Unit and Weight drop to a
              form-row-2 below.

              fieldStyle replaces the wrapper's default block layout: elsewhere in this
              modal the caption is a <label> SIBLING of the input and gets its spacing
              from globals.css:241, but HtsField nests a <span> caption inside a <label>
              wrapper, which inherits the type but not the margin. The gap supplies it.
              inputStyle sheds the uppercase and letter-spacing that same rule would
              otherwise pass down to the trigger, which the sibling inputs never see. */}
          <HtsField
            value={form.hs} onChange={f('hs')} codes={htsCodes}
            onAdd={seed=>setAddingCode({ code:seed || '' })}
            fieldClassName="form-row" inputClassName="form-input"
            fieldStyle={{display:'flex',flexDirection:'column',gap:'7px'}}
            inputStyle={{textTransform:'none',letterSpacing:'normal'}}
          />
          <div className="form-row-2">
            <div><label>Unit</label><input className="form-input" value={form.uom} onChange={e=>f('uom')(e.target.value)} /></div>
            <div><label>Weight (kg)</label><input type="number" step="0.001" className="form-input" value={form.wt} onChange={e=>f('wt')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>CPSC</label><select className="form-select" value={form.cpscType} onChange={e=>f('cpscType')(e.target.value)}>
              {/* Must stay in step with CPSC_TYPES in LinkRulesModal and with
                  products_cpsc_type_chk. BOTH is stored uppercase like the other two:
                  the product row renders cpsc_type raw, so 'Both' would read
                  "· Both" beside "· GCC". */}
              <option value="">— N/A —</option>
              <option value="GCC">GCC</option>
              <option value="CPC">CPC</option>
              <option value="BOTH">Both</option>
            </select></div>
            {/* The CPSC Code input stood here. Removed as unused -- see the payload.
                The empty cell keeps the select at half width, matching the rows above
                and below it, rather than stretching it across the modal. */}
            <div></div>
          </div>
          {/* Read-only, like the rules block below. EfilingModal on the product row is
              the only writer. Hidden on create for the same reason: no product, so no
              filing to show.

              Placed above the rules block rather than below it so the two single-line
              facts -- type and filing -- stay together under the CPSC row, and the list
              that can run long sits last. */}
          {editing && (
            <div className="form-row">
              <label>eFiling <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(set with the eFiling button)</span></label>
              {data.efiled_date
                ? <div style={{fontSize:'13px',color:'var(--ink)'}}>{fmtDay(data.efiled_date)}</div>
                : <div style={{fontSize:'13px',color:'var(--muted)'}}>Not eFiled</div>}
            </div>
          )}
          {/* Hidden on create: there is no product yet, so there can be no links, and a
              placeholder would describe a flow that cannot happen from here — Testing
              has no create path.

              The CPSC type is deliberately NOT repeated on each row. The dropdown
              holding it is directly above, and a product has one type while it can
              link many rules, so putting it on every row would read as a per-rule
              property rather than a per-product one. */}
          {editing && (
            <div className="form-row">
              <label>CPSC Rules <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(set with the Rules button)</span></label>
              {links.length === 0 ? (
                <div style={{fontSize:'13px',color:'var(--muted)'}}>No rules linked</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:'7px'}}>
                  {linkedRules.map(r=>(
                    <div key={r.id} style={{display:'flex',gap:'8px',alignItems:'baseline',minWidth:0,fontSize:'13px',color:'var(--ink)'}}>
                      <span style={{fontFamily:'var(--mono)',fontSize:'11.5px',fontWeight:600,whiteSpace:'nowrap',flexShrink:0}}>{r.code}</span>
                      <span style={{color:'var(--muted)',flexShrink:0}}>—</span>
                      <span style={{minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.name}</span>
                    </div>
                  ))}
                  {retiredCount > 0 && (
                    <div style={{fontSize:'12px',color:'var(--muted)'}}>
                      {retiredCount === 1 ? '1 linked rule is retired' : retiredCount+' linked rules are retired'} and not shown here.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          <span className="form-section-label">Carton / Case Pack</span>
          <div className="form-row-3">
            <div><label>Units/Carton</label><input type="number" className="form-input" value={form.upc} onChange={e=>f('upc')(e.target.value)} /></div>
            <div><label>Carton Wt (kg)</label><input type="number" step="0.01" className="form-input" value={form.cwt} onChange={e=>f('cwt')(e.target.value)} /></div>
            <div></div>
          </div>
          <div className="form-row-3">
            <div><label>L (cm)</label><input type="number" step="0.1" className="form-input" value={form.cl} onChange={e=>f('cl')(e.target.value)} /></div>
            <div><label>W (cm)</label><input type="number" step="0.1" className="form-input" value={form.cw} onChange={e=>f('cw')(e.target.value)} /></div>
            <div><label>H (cm)</label><input type="number" step="0.1" className="form-input" value={form.ch} onChange={e=>f('ch')(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit} disabled={saving} style={saving?{opacity:.6,pointerEvents:'none'}:{}}>{saving?'Saving…':(editing?'Save Changes':'Save Product')}</button></div>
      </div>
    </div>
  );
}
