'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { FileText, Pencil } from 'lucide-react';
import { SB } from '@/lib/supabase';
import V2Shell from '../V2Shell';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';
import EditClientModal from './EditClientModal';
import s from './clients.module.css';

const BATCH = 1000;
// Reserved for the future client attention calculation.
const SHOW_ATTENTION = false;

async function fetchAll(table, columns, configure) {
  const rows = [];
  for (let start = 0; ; start += BATCH) {
    const { data, error } = await configure(SB.from(table).select(columns)).order('id', { ascending: true }).range(start, start + BATCH - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < BATCH) return rows;
  }
}

function ClientsList() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    let active = true;
    setData(null); setError(false);
    Promise.all([
      fetchAll('companies', 'id,name', q => q.eq('type', 'client')),
      fetchAll('products', 'id,client_company_id', q => q.eq('active', true)),
    ]).then(([clients, products]) => {
      if (!active) return;
      const counts = new Map();
      products.forEach(product => counts.set(product.client_company_id, (counts.get(product.client_company_id) || 0) + 1));
      setData(clients.map(client => ({ ...client, products: counts.get(client.id) || 0 })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);
  const shown = useMemo(() => (data || []).filter(client => (client.name || '').toLowerCase().includes(search.trim().toLowerCase())), [data, search]);

  return <main className={s.main}>
    <div className={s.header}><div><h1>Clients</h1><p className={s.subtitle}>Everyone we make products for</p></div><button className={s.create} onClick={() => setCreating(true)}>+ New company</button></div>
    <input className={s.search} type="search" aria-label="Search clients" placeholder="Search clients" value={search} onChange={event => setSearch(event.target.value)} />
    <div className={s.card}>
      {error ? <div className={s.empty} role="alert">Could not load clients. <button onClick={() => setRetry(n => n + 1)}>Try again</button></div> : !data ? <p className={s.empty}>Loading clients…</p> : !shown.length ? <p className={s.empty}>{data.length ? 'No clients match your search.' : 'No clients found.'}</p> : <>
        <div className={`${s.grid} ${s.heading} ${SHOW_ATTENTION ? s.withAttention : ''}`} aria-hidden="true"><span>Client</span><span>Active products</span>{SHOW_ATTENTION && <span>Needs attention</span>}<span /></div>
        {shown.map(client => <div className={`${s.grid} ${s.row} ${SHOW_ATTENTION ? s.withAttention : ''}`} key={client.id}>
          <Link className={s.client} href={`/v2/clients/${client.id}`}>{client.name || 'Unnamed client'}</Link>
          <span><span className={s.mobileLabel}>Active products: </span>{client.products ? <Link className={s.productLink} href={`/v2/products?${new URLSearchParams({ clientId: client.id })}`} title="See products" aria-label={`${client.products} active products for ${client.name || 'unnamed client'}`}>{client.products}</Link> : 0}</span>
          {SHOW_ATTENTION && <span>—</span>}
          <div className={s.actions}><button className={s.edit} title="Edit client" aria-label={`Edit ${client.name || 'unnamed client'}`} onClick={() => setEditing(client.id)}><Pencil size={18} aria-hidden="true" /></button><Link className={s.button} href={`/v2/quotes?${new URLSearchParams({ clientId: client.id, clientName: client.name || '' })}`} title="See quotes" aria-label={`See quotes for ${client.name || 'unnamed client'}`}><FileText size={18} aria-hidden="true" /></Link></div>
        </div>)}
      </>}
    </div>
    {data && <p className={s.count}>{shown.length} {shown.length === 1 ? 'client' : 'clients'} shown</p>}
    {creating && <CreateCompanyModal initialType="client" noun="Company" onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setSearch(''); setRetry(n => n + 1); }} />}
    {editing && <EditClientModal id={editing} onClose={() => setEditing(null)} onSaved={company => { setData(rows => rows.map(row => row.id === company.id ? { ...row, ...company } : row).sort((a, b) => (a.name || '').localeCompare(b.name || ''))); setEditing(null); }} />}
  </main>;
}

export default function ClientsPage() { return <V2Shell><ClientsList /></V2Shell>; }
