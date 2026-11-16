'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SB } from '@/lib/supabase';
import V2Shell from './V2Shell';
import s from './detail.module.css';

function Field({ label, value }) {
  return <div><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? '—' : value}</dd></div>;
}

function list(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function Detail({ type }) {
  const { id } = useParams();
  const isQuote = type === 'quote';
  const [result, setResult] = useState({ loading: true });
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    const table = isQuote ? 'quotes' : 'products';
    const select = isQuote
      ? '*,company:companies!client_company_id(name),product_row:products!product_id(id,style_number)'
      : '*,company:companies!client_company_id(name)';
    SB.from(table).select(select).eq('id', id).maybeSingle().then(({ data, error }) => {
      if (active) setResult({ data, error });
    });
    return () => { active = false; };
  }, [id, isQuote]);

  const record = result.data;
  const tiers = isQuote && record ? list(record.tiers) : [];
  return <main className={s.main}>
    <Link className={s.back} href="/v2/quotes">← Quotes</Link>
    {result.loading ? <p className={s.message}>Loading {type}…</p> : result.error ? <p className={s.message} role="alert">Could not load {type}: {result.error.message}</p> : !record ? <p className={s.message}>{isQuote ? 'Quote' : 'Product'} not found.</p> : <>
      <p className={s.eyebrow}>{isQuote ? 'Quote' : 'Product'}</p>
      <h1>{(isQuote ? record.product_row?.style_number : record.style_number) || (isQuote ? record.quote_code : record.name) || (isQuote ? 'Quote details' : 'Product details')}</h1>
      <p className={s.subtitle}>{isQuote ? record.product || 'Product not entered' : record.name || 'Product name not entered'}</p>
      {isQuote && record.product_row && <Link className={s.button} href={`/v2/products/${record.product_row.id}`}>View product</Link>}
      <section className={s.card}>
        <h2>{isQuote ? 'Quote details' : 'Product details'}</h2>
        <dl className={s.fields}>
          {isQuote ? <>
            <Field label="Quote ID" value={record.quote_code} />
            <Field label="Client" value={record.company?.name || record.client} />
            <Field label="Factory" value={record.factory} />
            <Field label="SKU" value={record.sku} />
            <Field label="Quote date" value={record.quote_date} />
            <Field label="Country" value={record.country} />
            <Field label="Lead time" value={record.lead_time} />
            <Field label="HTS code" value={record.hts} />
          </> : <>
            <Field label="Style number" value={record.style_number} />
            <Field label="Client" value={record.company?.name} />
            <Field label="SKU" value={record.sku} />
            <Field label="Description" value={record.description} />
            <Field label="Composition" value={record.composition} />
            <Field label="HTS code" value={record.hts_code} />
            <Field label="Unit of measure" value={record.unit_of_measure} />
          </>}
        </dl>
      </section>
      {isQuote && <section className={s.card}>
        <h2>Quantity tiers</h2>
        {tiers.length ? <div className={s.tiers}>{tiers.map((tier, index) => <div className={s.tier} key={index}>
          <h3>Tier {index + 1}</h3>
          <dl className={s.fields}>
            <Field label="Quantity" value={tier.qty} />
            <Field label="Factory price" value={tier.landed} />
            <Field label="Client price" value={tier.client} />
          </dl>
          {(list(tier.sizeQty).length > 0 || list(tier.sizeCost).length > 0) && <p className={s.note}>This tier also has size-specific quantities or prices.</p>}
        </div>)}</div> : <p className={s.note}>No quantity tiers recorded.</p>}
      </section>}
      {isQuote && record.notes && <section className={s.card}><h2>Notes</h2><p className={s.notes}>{record.notes}</p></section>}
    </>}
  </main>;
}

export default function RecordDetail({ type }) {
  return <V2Shell><Detail type={type} /></V2Shell>;
}
