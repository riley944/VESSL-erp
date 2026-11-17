'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { CreateProductModal } from '@/app/components/CreateProductModal';

export default function EditProductModal({ id, onClose, onSaved }) {
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    SB.from('products').select('*,client:companies!client_company_id(name,kui_ior)').eq('id', id).maybeSingle()
      .then(({ data, error }) => { if (active) setResult({ data, error }); })
      .catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [id]);
  if (result.data) return <CreateProductModal data={result.data} wizard onClose={onClose} onCreated={onSaved} />;
  return <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-label="Edit Product">
    <div className="modal-head"><h3>Edit Product</h3><button className="modal-close" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body">{result.loading ? 'Loading product…' : <p role="alert">{result.error ? 'Could not load product.' : 'Product not found.'}</p>}</div>
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
  </div></div>;
}
