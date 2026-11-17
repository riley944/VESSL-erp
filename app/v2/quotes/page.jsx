'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Archive, Pencil } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { SB } from '@/lib/supabase';
import { recordPath } from '@/lib/v2RecordPaths';
import V2Shell from '../V2Shell';
import EditQuoteModal from './EditQuoteModal';
import s from './quotes.module.css';

const BATCH = 1000;
const TABS = ['Incomplete', 'Needs approval', 'Ready to send', 'Waiting on the client', 'All open'];

function QuotesList() {
  const params = useSearchParams();
  const requestedId = params.get('clientId') || '';
  const requestedName = params.get('clientName') || '';
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [client, setClient] = useState('');
  const [clientId, setClientId] = useState('');
  const [sort, setSort] = useState('style');
  const [tab, setTab] = useState('All open');
  const [retry, setRetry] = useState(0);
  const [editing, setEditing] = useState(null);

  useEffect(() => { setClientId(requestedId); setClient(requestedId ? requestedName : ''); }, [requestedId, requestedName]);

  useEffect(() => {
    let active = true;
    async function load() {
      setRows(null);
      setError('');
      const all = [];
      for (let start = 0; ; start += BATCH) {
        const { data, error: err } = await SB.from('quotes')
          .select('id,product_id,client_company_id,quote_code,sku,product,client,factory,created_at,updated_at,company:companies!client_company_id(name),product_row:products!product_id(style_number)')
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

  const clients = useMemo(() => [...new Set([...(rows || []).map(q => q.clientName), clientId ? client : ''].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [rows, clientId, client]);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (rows || []).filter(q => (clientId ? q.client_company_id === clientId || (!q.client_company_id && !!client && q.clientName === client) : !client || q.clientName === client) &&
      (!term || [q.style, q.sku, q.product, q.clientName, q.factory, q.quote_code].some(v => (v || '').toLowerCase().includes(term))))
      .sort((a, b) => {
        if (sort === 'new' || sort === 'old') {
          const cmp = (a.updated_at || a.created_at || '').localeCompare(b.updated_at || b.created_at || '');
          return sort === 'new' ? -cmp : cmp;
        }
        const key = sort === 'client' ? 'clientName' : 'style';
        return (a[key] || '\uffff').localeCompare(b[key] || '\uffff', undefined, { numeric: true }) || (a.quote_code || '').localeCompare(b.quote_code || '', undefined, { numeric: true });
      });
  }, [rows, search, client, clientId, sort]);

  return <main className={s.main}>
    <Link href="/v2" className={s.back}>← V2 home</Link>
    <h1>Quotes</h1>
    <p className={s.subtitle}>Factory quotes in one list</p>
    <div className={s.tabs} aria-label="Quote status preview">
      {TABS.map(label => <button type="button" key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label} <b>–</b></button>)}
    </div>
    <p className={s.preview}>Status tabs are a preview. All quotes are shown.</p>
    <div className={s.filters}>
      <input type="search" placeholder="Search style, client or product" aria-label="Search quotes" value={search} onChange={e => setSearch(e.target.value)} />
      <label>Client <select value={client} onChange={e => { setClientId(''); setClient(e.target.value); }}><option value="">All clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select></label>
      <label>Sort <select value={sort} onChange={e => setSort(e.target.value)}><option value="style">Style number</option><option value="client">Client</option><option value="new">Last edited, newest first</option><option value="old">Last edited, oldest first</option></select></label>
      {(search || client || clientId || sort !== 'style') && <button className={s.clear} onClick={() => { setSearch(''); setClient(''); setClientId(''); setSort('style'); }}>Clear filters</button>}
    </div>
    <div className={s.card}>
      {error ? <div className={s.empty} role="alert">Could not load quotes. {error} <button onClick={() => setRetry(n => n + 1)}>Try again</button></div> : !rows ? <p className={s.empty}>Loading quotes…</p> : !shown.length ? <p className={s.empty}>{rows.length ? 'No quotes match these filters.' : 'No quotes found.'}</p> : <>
        <div className={`${s.grid} ${s.heading}`} aria-hidden="true"><span>Style / product</span><span>Client</span><span>Factory</span><span>Quote ID</span><span>Last edited</span><span></span></div>
        {shown.map(q => <div className={`${s.grid} ${s.row}`} key={q.id}>
          <div><strong><Link className={s.styleLink} href={recordPath('quote', q)} title={`View quote ${q.quote_code || q.style || ''}`.trim()}>{q.style || q.quote_code || 'View quote'}</Link></strong>{!q.style && <span className={s.sub}>Style number not assigned</span>}<span className={s.sub}>{q.product_id && q.product_row && q.product ? <Link className={s.productName} href={recordPath('product', { id: q.product_id, style_number: q.style })} title={`View product ${q.product}`}>{q.product}</Link> : q.product || 'Product not entered'}{q.sku ? ` · SKU ${q.sku}` : ''}</span></div>
          <div><span className={s.mobileLabel}>Client: </span>{q.clientName || '—'}</div>
          <div><span className={s.mobileLabel}>Factory: </span>{q.factory || '—'}</div>
          <div><span className={s.mobileLabel}>Quote ID: </span>{q.quote_code || '—'}</div>
          <div><span className={s.mobileLabel}>Last edited: </span>{q.updated_at || q.created_at ? new Date(q.updated_at || q.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</div>
          <div><div className={s.actions}><button className={s.edit} title="Edit quote" aria-label={`Edit ${q.quote_code || q.style || q.product || 'quote'}`} onClick={() => setEditing(q.id)}><Pencil size={18} aria-hidden="true" /></button><button className={s.archive} title="Archive quote (coming soon)" aria-label={`Archive ${q.quote_code || q.style || q.product || 'quote'} (coming soon)`} disabled><Archive size={18} aria-hidden="true" /></button></div>{!(q.product_id && q.product_row) && <span className={s.sub}>No linked product</span>}</div>
        </div>)}
      </>}
    </div>
    {rows && <p className={s.count}>{shown.length} {shown.length === 1 ? 'quote' : 'quotes'} shown</p>}
    {editing && <EditQuoteModal id={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setRetry(n => n + 1); }} />}
  </main>;
}

export default function QuotesPage() {
  return <V2Shell><Suspense fallback={<main className={s.main}>Loading quotes…</main>}><QuotesList /></Suspense></V2Shell>;
}
