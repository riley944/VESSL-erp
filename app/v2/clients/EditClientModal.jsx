'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';

export default function EditClientModal({ id, onClose, onSaved }) {
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    SB.from('companies').select('id,name,type,email,phone,website,billing_address,shipping_address,vendor_number,pallet_info,kui_ior,po_notes,delivery_request_recipients')
      .eq('id', id).eq('type', 'client').maybeSingle()
      .then(({ data, error }) => { if (active) setResult({ data, error }); })
      .catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [id]);

  if (result.data) return <CreateCompanyModal initialType="client" noun="Company" editCompany={result.data} onClose={onClose} onCreated={(_, company) => onSaved(company)} />;
  return <div className="modal-overlay">
    <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="edit-client-loading-title">
      <div className="modal-head"><h3 id="edit-client-loading-title">Edit Company</h3><button className="modal-close" aria-label="Close" onClick={onClose}>×</button></div>
      <div className="modal-body">{result.loading ? 'Loading company…' : <p role="alert">{result.error ? 'Could not load company.' : 'Company not found.'}</p>}</div>
      <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
    </div>
  </div>;
}
