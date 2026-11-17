'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Pencil } from 'lucide-react';
import { SB } from '@/lib/supabase';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';
import V2Shell from '../V2Shell';
import EditFactoryModal from './EditFactoryModal';
import s from '../clients/clients.module.css';
import styles from './factories.module.css';

async function fetchAll(table, columns, configure) {
  const rows = [];
  for (let start = 0; ; start += 1000) {
    const { data, error } = await configure(SB.from(table).select(columns)).order('id').range(start, start + 999);
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

function FactoriesList() {
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
      fetchAll('companies', 'id,name', q => q.eq('type', 'factory')),
      fetchAll('contacts', 'id,company_id,full_name', q => q.eq('is_primary', true)),
    ]).then(([factories, contacts]) => {
      if (!active) return;
      const names = new Map(contacts.map(contact => [contact.company_id, contact.full_name]));
      setData(factories.map(factory => ({ ...factory, contact: names.get(factory.id) || '' })).sort((a, b) => (a.name || '').localeCompare(b.name || '')));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data || []).filter(factory => [factory.name, factory.contact].some(value => (value || '').toLowerCase().includes(term)));
  }, [data, search]);

  return <main className={s.main}>
    <div className={s.header}><div><h1>Factories</h1><p className={s.subtitle}>Factories we work with</p></div><button className={s.create} onClick={() => setCreating(true)}>+ New factory</button></div>
    <input className={s.search} type="search" aria-label="Search factories" placeholder="Search factories or contacts" value={search} onChange={event => setSearch(event.target.value)} />
    <div className={s.card}>
      {error ? <div className={s.empty} role="alert">Could not load factories. <button onClick={() => setRetry(n => n + 1)}>Try again</button></div> : !data ? <p className={s.empty}>Loading factories…</p> : !shown.length ? <p className={s.empty}>{data.length ? 'No factories match your search.' : 'No factories found.'}</p> : <>
        <div className={`${s.grid} ${styles.grid} ${s.heading}`} aria-hidden="true"><span>Factory</span><span>Main contact</span><span /></div>
        {shown.map(factory => <div className={`${s.grid} ${styles.grid} ${s.row}`} key={factory.id}>
          <Link className={s.client} href={`/v2/factories/${factory.id}`}>{factory.name || 'Unnamed factory'}</Link>
          <span><span className={s.mobileLabel}>Main contact: </span>{factory.contact || '—'}</span>
          <button className={s.edit} title="Edit factory" aria-label={`Edit ${factory.name || 'unnamed factory'}`} onClick={() => setEditing(factory.id)}><Pencil size={18} aria-hidden="true" /></button>
        </div>)}
      </>}
    </div>
    {data && <p className={s.count}>{shown.length} {shown.length === 1 ? 'factory' : 'factories'} shown</p>}
    {creating && <CreateCompanyModal initialType="factory" onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setSearch(''); setRetry(n => n + 1); }} />}
    {editing && <EditFactoryModal id={editing} onClose={() => setEditing(null)} onSaved={(company, contact) => { setData(rows => rows.map(row => row.id === company.id ? { ...row, ...company, contact: contact?.full_name || '' } : row).sort((a, b) => (a.name || '').localeCompare(b.name || ''))); setEditing(null); }} />}
  </main>;
}

export default function FactoriesPage() { return <V2Shell><FactoriesList /></V2Shell>; }
