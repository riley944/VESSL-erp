'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { SB } from '@/lib/supabase';
import V2Shell from '../V2Shell';
import s from './quotes.module.css';

const BATCH = 1000;

function QuotesList() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('');
  const [sort, setSort] = useState('style');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setRows(null);
      setError('');
      const all = [];
      for (let start = 0; ; start += BATCH) {
        const { data, error: err } = await SB.from('quotes')
          .select('id,quote_code,sku,product,client,factory,created_at,updated_at,company:companies!client_company_id(name),product_row:products!product_id(style_number)')
          .order('id', { ascending: true }).range(start, start + BATCH - 1);
        if (!active) return;
        if (err) { setError(err.message); return; }
        all.push(...data);
        if (data.length < BATCH) break;
      }
      if (active) setRows(all.map(q => ({
        ...q,
        style: q.product_row?.style_number || '',
        clientName: q.company?.name || q.client || '',
      })));
    }
    load();
    return () => { active = false; };
  }, [retry]);

  const clients = useMemo(() => [...new Set((rows || []).map(q => q.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (rows || []).filter(q => (!client || q.clientName === client) &&
      (!term || [q.style, q.sku, q.product, q.clientName, q.factory, q.quote_code].some(v => (v || '').toLowerCase().includes(term))))
      .sort((a, b) => {
        if (sort === 'new' || sort === 'old') {
          const cmp = (a.updated_at || a.created_at || '').localeCompare(b.updated_at || b.created_at || '');
          return sort === 'new' ? -cmp : cmp;
        }
        const key = sort === 'client' ? 'clientName' : 'style';
        return (a[key] || '\uffff').localeCompare(b[key] || '\uffff', undefined, { numeric: true }) || (a.quote_code || '').localeCompare(b.quote_code || '', undefined, { numeric: true });
      });
  }, [rows, search, client, sort]);

  return <main className={s.main}>
    <Link href="/v2" className={s.back}>← V2 home</Link>
    <h1>Quotes</h1>
    <p className={s.subtitle}>Factory quotes in one list</p>
    <div className={s.tabs}><span>All quotes <b>{rows ? rows.length : '–'}</b></span></div>
    <div className={s.filters}>
      <input type="search" placeholder="Search style, client or product" aria-label="Search quotes" value={search} onChange={e => setSearch(e.target.value)} />
      <label>Client <select value={client} onChange={e => setClient(e.target.value)}><option value="">All clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Sort <select value={sort} onChange={e => setSort(e.target.value)}><option value="style">Style number</option><option value="client">Client</option><option value="new">Last edited, newest first</option><option value="old">Last edited, oldest first</option></select></label>
      {(search || client || sort !== 'style') && <button className={s.clear} onClick={() => { setSearch(''); setClient(''); setSort('style'); }}>Clear filters</button>}
    </div>
    <div className={s.card}>
      {error ? <div className={s.empty} role="alert">Could not load quotes. {error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></div> : !rows ? <p className={s.empty}>Loading quotes…</p> : !shown.length ? <p className={s.empty}>{rows.length ? 'No quotes match these filters.' : 'No quotes found.'}</p> : <>
        <div className={`${s.grid} ${s.heading}`} aria-hidden="true"><span>Style / product</span><span>Client</span><span>Factory</span><span>Quote ID</span><span>Last edited</span></div>
        {shown.map(q => <div className={`${s.grid} ${s.row}`} key={q.id}>
          <div><strong>{q.style || 'Style number not assigned'}</strong><span className={s.sub}>{q.product || 'Product not entered'}{q.sku ? ` · SKU ${q.sku}` : ''}</span></div>
          <div><span className={s.mobileLabel}>Client: </span>{q.clientName || '—'}</div>
          <div><span className={s.mobileLabel}>Factory: </span>{q.factory || '—'}</div>
          <div><span className={s.mobileLabel}>Quote ID: </span>{q.quote_code || '—'}</div>
          <div><span className={s.mobileLabel}>Last edited: </span>{q.updated_at || q.created_at ? new Date(q.updated_at || q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
        </div>)}
      </>}
    </div>
    {rows && <p className={s.count}>{shown.length} {shown.length === 1 ? 'quote' : 'quotes'} shown</p>}
  </main>;
}

export default function QuotesPage() {
  return <V2Shell><QuotesList /></V2Shell>;
}
