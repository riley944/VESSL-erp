'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { SB } from '@/lib/supabase';
import V2Shell from '../../V2Shell';
import EditClientModal from '../EditClientModal';
import s from '../../detail.module.css';

function formatPhone(value) {
  const digits = value.replace(/\D/g, '');
  if (!/^[\d\s().+-]+$/.test(value)) return value;
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  if (digits.length === 11 && digits[0] === '1') return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return value;
}

function websiteHref(value) {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function ClientDetail() {
  const { id } = useParams();
  const [result, setResult] = useState({ loading: true });
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    SB.from('companies').select('id,name,type,email,phone,website,billing_address,shipping_address').eq('id', id).eq('type', 'client').maybeSingle()
      .then(({ data, error }) => { if (active) setResult({ data, error }); });
    return () => { active = false; };
  }, [id]);
  const client = result.data;
  const website = client?.website && websiteHref(client.website.trim());
  return <main className={s.main}>
    <Link className={s.back} href="/v2/clients">← Clients</Link>
    {result.loading ? <p className={s.message}>Loading client…</p> : result.error ? <p className={s.message} role="alert">Could not load client: {result.error.message}</p> : !client ? <p className={s.message}>Client not found.</p> : <>
      <p className={s.eyebrow}>Client</p><div className={s.titleRow}><h1>{client.name}</h1><button className={s.editIcon} title="Edit client" aria-label="Edit client" onClick={() => setEditing(true)}><Pencil size={18} aria-hidden="true" /></button></div>
      <section className={s.card}><h2>Client details</h2><dl className={s.fields}>
        <div><dt>Email</dt><dd>{client.email ? <a href={`mailto:${client.email.trim()}`}>{client.email}</a> : '—'}</dd></div>
        <div><dt>Phone</dt><dd>{client.phone ? formatPhone(client.phone) : '—'}</dd></div>
        <div><dt>Website</dt><dd>{website ? <a href={website} target="_blank" rel="noopener noreferrer">{client.website}</a> : client.website || '—'}</dd></div>
        {[['Billing address', client.billing_address], ['Shipping address', client.shipping_address]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl></section>
      {editing && <EditClientModal id={id} onClose={() => setEditing(false)} onSaved={company => { setResult({ data: company }); setEditing(false); }} />}
    </>}
  </main>;
}

export default function ClientPage() { return <V2Shell><ClientDetail /></V2Shell>; }
