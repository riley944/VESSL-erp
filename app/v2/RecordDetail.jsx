'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { SB } from '@/lib/supabase';
import { recordLookupColumn, recordPath } from '@/lib/v2RecordPaths';
import V2Shell from './V2Shell';
import EditProductModal from './products/EditProductModal';
import s from './detail.module.css';

function Field({ label, value }) {
  return <div><dt>{label}</dt><dd>{value === null || value === undefined || value === '' ? '—' : value}</dd></div>;
}

function list(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function quoteTiers(record) {
  const tiers = list(record.tiers).filter(tier => tier && typeof tier === 'object' && !Array.isArray(tier));
  if (tiers.length) return tiers;
  if (record.qty != null || record.landed != null) return [{ qty: record.qty, landed: record.landed }];
  return [];
}

function Detail({ type }) {
  const { id } = useParams();
  const isQuote = type === 'quote';
  const [result, setResult] = useState({ loading: true });
  const [editing, setEditing] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setResult({ loading: true });
    const table = isQuote ? 'quotes' : 'products';
    const select = isQuote
      ? '*,company:companies!client_company_id(name),product_row:products!product_id(id,style_number)'
      : '*,company:companies!client_company_id(name)';
    SB.from(table).select(select).eq(recordLookupColumn(type, id), id).maybeSingle().then(({ data, error }) => {
      if (active) setResult({ data, error });
    });
    return () => { active = false; };
  }, [id, isQuote, revision, type]);

  const record = result.data;
  const tiers = isQuote && record ? quoteTiers(record) : [];
  return <main className={s.main}>
    <Link className={s.back} href={isQuote ? '/v2/quotes' : '/v2/products'}>← {isQuote ? 'Quotes' : 'Products'}</Link>
    {result.loading ? <p className={s.message}>Loading {type}…</p> : result.error ? <p className={s.message} role="alert">Could not load {type}: {result.error.message}</p> : !record ? <p className={s.message}>{isQuote ? 'Quote' : 'Product'} not found.</p> : <>
      <p className={s.eyebrow}>{isQuote ? 'Quote' : 'Product'}</p>
      <div className={s.titleRow}><h1>{(isQuote ? record.product_row?.style_number : record.style_number) || (isQuote ? record.quote_code : record.name) || (isQuote ? 'Quote details' : 'Product details')}</h1>{!isQuote && <button className={s.editButton} onClick={() => setEditing(true)}>Edit</button>}</div>
      <p className={s.subtitle}>{isQuote ? record.product || 'Product not entered' : record.name || 'Product name not entered'}</p>
      {isQuote && record.product_row && <Link className={s.button} href={recordPath('product', record.product_row)}>View product</Link>}
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
        {tiers.length ? <div className={s.tiers}>{tiers.map((tier, index) => {
          const quantities = list(tier.sizeQty).filter(item => item && item.qty !== '' && item.qty != null && Number.isFinite(Number(item.qty)));
          const sizeCosts = list(tier.sizeCost).filter(item => item && typeof item === 'object');
          const quantity = quantities.length ? quantities.reduce((sum, item) => sum + Number(item.qty), 0) : tier.qty;
          return <div className={s.tier} key={index}>
          <h3>Tier {index + 1}</h3>
          <dl className={s.fields}>
            <Field label="Quantity" value={quantity} />
            <Field label={sizeCosts.length ? 'Base factory price' : 'Factory price'} value={tier.landed} />
            <Field label={sizeCosts.length ? 'Base client price' : 'Client price'} value={tier.client} />
          </dl>
          {(quantities.length > 0 || sizeCosts.length > 0) && <div className={s.sizeDetails}>
            <h4>Size details</h4>
            {quantities.map((item, i) => <p key={`qty-${i}`}>{[item.scale, item.size].filter(Boolean).join(' / ') || 'Unspecified size'}: {item.qty} units</p>)}
            {sizeCosts.map((item, i) => <p key={`cost-${i}`}>{[item.scale, item.size].filter(Boolean).join(' / ') || 'Unspecified size'}: {[item.landed != null && item.landed !== '' ? `factory ${item.landed}` : null, item.client != null && item.client !== '' ? `client ${item.client}` : null, item.mold != null && item.mold !== '' ? `mold fee ${item.mold}` : null].filter(Boolean).join(' · ') || 'No size-specific prices'}</p>)}
          </div>}
        </div>; })}</div> : <p className={s.note}>No quantity tiers recorded.</p>}
      </section>}
      {isQuote && record.notes && <section className={s.card}><h2>Notes</h2><p className={s.notes}>{record.notes}</p></section>}
      {!isQuote && editing && <EditProductModal id={record.id} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); setRevision(n => n + 1); }} />}
    </>}
  </main>;
}

export default function RecordDetail({ type }) {
  return <V2Shell><Detail type={type} /></V2Shell>;
}
