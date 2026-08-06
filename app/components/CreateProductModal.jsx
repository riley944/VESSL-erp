'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';

// ── CreateProductModal (create or edit a row in vessl.products) ──────────────
// Lifted out of page.jsx, where it was unreachable — it rendered only under a
// modal key nothing ever set. It lives here rather than in page.jsx because its
// only caller is app/testing.jsx, which page.jsx already imports; importing it
// back the other way would be circular.
//
// Pass `data` to edit that row, omit it to create — the same shape MaterialModal
// uses. Every class name below resolves from globals.css, so this file needs no
// styles of its own.
export function CreateProductModal({ data, onClose, onCreated }) {
  const editing = !!(data && data.id);
  const [saving, setSaving] = useState(false);
  // The DB hands numbers back as numbers; every box here is a string.
  const s = v => (v === null || v === undefined ? '' : String(v));
  const [form, setForm] = useState({
    sku:s(data?.sku), name:s(data?.name), desc:s(data?.description), hs:s(data?.hts_code),
    uom:s(data?.unit_of_measure), wt:s(data?.weight_kg), upc:s(data?.units_per_carton),
    cwt:s(data?.carton_weight_kg), cl:s(data?.carton_l_cm), cw:s(data?.carton_w_cm), ch:s(data?.carton_h_cm),
    cpscType:s(data?.cpsc_type), cpscCode:s(data?.cpsc_code),
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
      // '' is not a certificate and 'N/A' is not a type -- both clear to NULL so the
      // column reads the same whether it was never set or emptied out.
      cpsc_type:form.cpscType||null, cpsc_code:form.cpscCode.trim()||null,
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
          <div className="form-row-3">
            <div><label>HTS Code</label><input className="form-input" value={form.hs} onChange={e=>f('hs')(e.target.value)} /></div>
            <div><label>Unit</label><input className="form-input" value={form.uom} onChange={e=>f('uom')(e.target.value)} /></div>
            <div><label>Weight (kg)</label><input type="number" step="0.001" className="form-input" value={form.wt} onChange={e=>f('wt')(e.target.value)} /></div>
          </div>
          <div className="form-row-2">
            <div><label>CPSC</label><select className="form-select" value={form.cpscType} onChange={e=>f('cpscType')(e.target.value)}>
              <option value="">— N/A —</option>
              <option value="GCC">GCC</option>
              <option value="CPC">CPC</option>
            </select></div>
            <div><label>CPSC Code</label><input className="form-input" value={form.cpscCode} onChange={e=>f('cpscCode')(e.target.value)} placeholder="Certificate number, if applicable" /></div>
          </div>
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
