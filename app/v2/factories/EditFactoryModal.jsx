'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';

export default function EditFactoryModal({ id, onClose, onSaved }) {
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    Promise.all([
      SB.from('companies').select('id,name,type,email,phone,website,billing_address,shipping_address,vendor_number,pallet_info,kui_ior,po_notes,delivery_request_recipients')
        .eq('id', id).eq('type', 'factory').maybeSingle(),
      SB.from('contacts').select('id,full_name,email,phone').eq('company_id', id).eq('is_primary', true).order('id').limit(1),
    ])
      .then(([company, contacts]) => { if (active) setResult({ data: company.data, contact: contacts.data?.[0] || null, error: company.error || contacts.error }); })
      .catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [id]);

  if (result.data && !result.error) return <CreateCompanyModal initialType="factory" editCompany={result.data} editContact={result.contact} onClose={onClose} onCreated={(_, company, contact) => onSaved(company, contact)} />;
  return <div className="modal-overlay"><div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="edit-factory-title">
    <div className="modal-head"><h3 id="edit-factory-title">Edit Factory</h3><button className="modal-close" aria-label="Close" onClick={onClose}>×</button></div>
    <div className="modal-body">{result.loading ? 'Loading factory…' : <p role="alert">{result.error ? 'Could not load factory.' : 'Factory not found.'}</p>}</div>
    <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
  </div></div>;
}
