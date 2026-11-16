'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SB } from '@/lib/supabase';
import V2Shell from '../../V2Shell';
import s from '../../detail.module.css';

function ClientDetail() {
  const { id } = useParams();
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    SB.from('companies').select('id,name,type,email,phone,website,billing_address,shipping_address').eq('id', id).eq('type', 'client').maybeSingle()
      .then(({ data, error }) => { if (active) setResult({ data, error }); });
    return () => { active = false; };
  }, [id]);
  const client = result.data;
  return <main className={s.main}>
    <Link className={s.back} href="/v2/clients">← Clients</Link>
    {result.loading ? <p className={s.message}>Loading client…</p> : result.error ? <p className={s.message} role="alert">Could not load client: {result.error.message}</p> : !client ? <p className={s.message}>Client not found.</p> : <>
      <p className={s.eyebrow}>Client</p><h1>{client.name}</h1>
      <section className={s.card}><h2>Client details</h2><dl className={s.fields}>
        {[['Email', client.email], ['Phone', client.phone], ['Website', client.website], ['Billing address', client.billing_address], ['Shipping address', client.shipping_address]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || '—'}</dd></div>)}
      </dl></section>
    </>}
  </main>;
}

export default function ClientPage() { return <V2Shell><ClientDetail /></V2Shell>; }
