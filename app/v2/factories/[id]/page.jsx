'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { SB } from '@/lib/supabase';
import V2Shell from '../../V2Shell';
import EditFactoryModal from '../EditFactoryModal';
import s from '../../detail.module.css';

function websiteHref(value) {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function FactoryDetail() {
  const { id } = useParams();
  const [result, setResult] = useState({ loading: true });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    Promise.all([
      SB.from('companies').select('id,name,type,email,phone,website,billing_address,shipping_address').eq('id', id).eq('type', 'factory').maybeSingle(),
      SB.from('contacts').select('id,full_name,email,phone').eq('company_id', id).eq('is_primary', true).order('id').limit(1),
    ]).then(([company, contacts]) => {
      if (active) setResult({ data: company.data, contact: contacts.data?.[0], error: company.error || contacts.error });
    }).catch(error => { if (active) setResult({ error }); });
    return () => { active = false; };
  }, [id]);
  const factory = result.data;
  const website = factory?.website && websiteHref(factory.website.trim());
  return <main className={s.main}>
    <Link className={s.back} href="/v2/factories">← Factories</Link>
    {result.loading ? <p className={s.message}>Loading factory…</p> : result.error ? <p className={s.message} role="alert">Could not load factory.</p> : !factory ? <p className={s.message}>Factory not found.</p> : <>
      <p className={s.eyebrow}>Factory</p><div className={s.titleRow}><h1>{factory.name || 'Unnamed factory'}</h1><button className={s.editIcon} title="Edit factory" aria-label="Edit factory" onClick={() => setEditing(true)}><Pencil size={18} aria-hidden="true" /></button></div>
      <section className={s.card}><h2>Factory details</h2><dl className={s.fields}>
        <div><dt>Main contact</dt><dd>{result.contact?.full_name || '—'}</dd></div>
        <div><dt>Email</dt><dd>{factory.email ? <a href={`mailto:${factory.email.trim()}`}>{factory.email}</a> : '—'}</dd></div>
        <div><dt>Phone</dt><dd>{factory.phone || '—'}</dd></div>
        <div><dt>Website</dt><dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{factory.website}</a> : factory.website || '—'}</dd></div>
        {[['Billing address', factory.billing_address], ['Shipping address', factory.shipping_address]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl></section>
      {editing && <EditFactoryModal id={id} onClose={() => setEditing(false)} onSaved={(company, contact) => { setResult(current => ({ ...current, data: company, contact })); setEditing(false); }} />}
    </>}
  </main>;
}

export default function FactoryPage() { return <V2Shell><FactoryDetail /></V2Shell>; }
