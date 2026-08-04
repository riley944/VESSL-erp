'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';

// ── CreateProductModal (new row in vessl.products) ───────────────────────────
// Lifted out of page.jsx, where it was unreachable — it rendered only under a
// modal key nothing ever set. It lives here rather than in page.jsx because its
// only caller is app/testing.jsx, which page.jsx already imports; importing it
// back the other way would be circular.
//
// Every class name below resolves from globals.css, so this file needs no styles
// of its own.
export function CreateProductModal({ onClose, onCreated }) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({sku:'',name:'',desc:'',hs:'',uom:'',wt:'',upc:'',cwt:'',cl:'',cw:'',ch:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const submit = async () => {
    // Name identifies a product here; a SKU is nice to have and often assigned later.
    const name = form.name.trim();
    const sku  = form.sku.trim();
    if (!name) { alert('Product name required'); return; }
    setSaving(true);
    const { error } = await SB.from('products').insert({
      // products_sku_key is UNIQUE and Postgres does not treat NULLs as equal, so any
      // number of SKU-less products can coexist -- but a second '' would collide.
      // category_id is written explicitly rather than omitted so every row this modal
      // creates carries the same key set. product_categories has no rows to pick from.
      sku:sku||null, name:name, description:form.desc||null, category_id:null,
      // unit_of_measure has a DB default of 'pcs', but a default only fires when the
      // key is absent -- sending null keeps the column empty until someone types a unit.
      hts_code:form.hs||null, unit_of_measure:form.uom||null, weight_kg:Number(form.wt)||null,
      units_per_carton:Number(form.upc)||null, carton_weight_kg:Number(form.cwt)||null,
      carton_l_cm:Number(form.cl)||null, carton_w_cm:Number(form.cw)||null, carton_h_cm:Number(form.ch)||null
    });
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
        <div className="modal-head"><h3>New Product</h3><button className="modal-close" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row"><label>SKU</label><input className="form-input" value={form.sku} onChange={e=>f('sku')(e.target.value)} placeholder="KUI-XXXX-00 — optional" /></div>
          <div className="form-row"><label>Product Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
          <div className="form-row"><label>Description</label><textarea className="form-textarea" value={form.desc} onChange={e=>f('desc')(e.target.value)} /></div>
          <div className="form-row-3">
            <div><label>HTS Code</label><input className="form-input" value={form.hs} onChange={e=>f('hs')(e.target.value)} /></div>
            <div><label>Unit</label><input className="form-input" value={form.uom} onChange={e=>f('uom')(e.target.value)} /></div>
            <div><label>Weight (kg)</label><input type="number" step="0.001" className="form-input" value={form.wt} onChange={e=>f('wt')(e.target.value)} /></div>
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
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit} disabled={saving} style={saving?{opacity:.6,pointerEvents:'none'}:{}}>{saving?'Saving…':'Save Product'}</button></div>
      </div>
    </div>
  );
}
