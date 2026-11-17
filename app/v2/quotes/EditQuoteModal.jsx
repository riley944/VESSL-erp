'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import Quotes from '@/app/quotes';

export default function EditQuoteModal({ id, onClose, onSaved }) {
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    SB.from('quotes').select('*').eq('id', id).maybeSingle()
      .then(({ data, error }) => { if (active) setResult({ data, error }); })
      .catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [id]);
  if (result.data) return <Quotes modalOnly editQuote={result.data} onClose={onClose} onSaved={onSaved} />;
  return <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-label="Edit Quote">
    <div className="modal-head"><h3>Edit Quote</h3><button className="modal-close" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body">{result.loading ? 'Loading quote…' : <p role="alert">{result.error ? 'Could not load quote.' : 'Quote not found.'}</p>}</div>
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
  </div></div>;
}
