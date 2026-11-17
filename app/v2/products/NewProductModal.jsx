'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { CreateProductModal } from '@/app/components/CreateProductModal';

export default function NewProductModal({ onClose, onSaved }) {
  const [result, setResult] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      const clients = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await SB.from('companies').select('id,name').eq('type', 'client').order('id').range(start, start + 999);
        if (error) throw error;
        clients.push(...data);
        if (data.length < 1000) return clients.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      }
    }
    setResult({ loading: true });
    load().then(clients => { if (active) setResult({ clients }); }).catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [retry]);

  if (result.clients) return <CreateProductModal wizard clients={result.clients} onClose={onClose} onCreated={onSaved} />;
  return <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-label="New Product">
    <div className="modal-head"><h3>New Product</h3><button className="modal-close" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body">{result.loading ? 'Loading clients…' : <p role="alert">Could not load clients.</p>}</div>
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button>{result.error && <button className="btn btn-dark" onClick={() => setRetry(n => n + 1)}>Try again</button>}</div>
  </div></div>;
}
