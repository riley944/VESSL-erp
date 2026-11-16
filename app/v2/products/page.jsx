'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Backpack, CupSoda, Package, Shirt, ShoppingBag } from 'lucide-react';
import { SB } from '@/lib/supabase';
import V2Shell from '../V2Shell';
import s from './products.module.css';

const BATCH = 1000;
const TABS = [['all', 'All products'], ['active', 'Active'], ['inactive', 'Inactive'], ['unset', 'Not set']];
const statusOf = product => product.active === true ? 'active' : product.active === false ? 'inactive' : 'unset';
const normalize = value => (value || '').toLowerCase().replace(/[-\s]/g, '');

function ProductThumbnail({ product }) {
  const description = `${product.name || ''} ${product.description || ''}`.toLowerCase();
  const Icon = /\b(backpack|sling)\b/.test(description) ? Backpack
    : /\b(tote|bag|pouch)\b/.test(description) ? ShoppingBag
    : /\b(bottle|cup|mug|tumbler)\b/.test(description) ? CupSoda
    : /\b(tee|t-shirt|shirt|hoodie|jacket|polo|pullover|apparel)\b/.test(description) ? Shirt
    : Package;
  return <span className={s.thumbnail} aria-hidden="true"><Icon size={27} strokeWidth={1.5} /></span>;
}

async function fetchAll(table, columns) {
  const rows = [];
  for (let start = 0; ; start += BATCH) {
    const { data, error } = await SB.from(table).select(columns).order('id', { ascending: true }).range(start, start + BATCH - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < BATCH) return rows;
  }
}

function ProductsList() {
  const [products, setProducts] = useState(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('all');

  useEffect(() => {
    let active = true;
    setProducts(null); setError(false);
    Promise.all([
      fetchAll('products', 'id,style_number,name,description,active,company:companies!client_company_id(name)'),
      fetchAll('quotes', 'id,product_id,quote_code,created_at'),
    ]).then(([rows, quotes]) => {
      if (!active) return;
      const byProduct = new Map();
      quotes.forEach(quote => {
        if (!quote.product_id) return;
        const list = byProduct.get(quote.product_id) || [];
        list.push(quote);
        byProduct.set(quote.product_id, list);
      });
      byProduct.forEach(list => list.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '') || String(b.id).localeCompare(String(a.id))));
      setProducts(rows.map(product => ({ ...product, quotes: byProduct.get(product.id) || [] }))
        .sort((a, b) => (a.style_number || '\uffff').localeCompare(b.style_number || '\uffff', undefined, { numeric: true }) || String(a.id).localeCompare(String(b.id))));
    }).catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, [retry]);

  const shown = useMemo(() => {
    const term = normalize(search);
    return (products || []).filter(product => (tab === 'all' || statusOf(product) === tab) &&
      (!term || [product.style_number, product.name, product.description, product.company?.name].some(value => normalize(value).includes(term))));
  }, [products, search, tab]);

  return <main className={s.main}>
    <h1>Products</h1><p className={s.subtitle}>Every style number, across all clients</p>
    <div className={s.tabs} role="group" aria-label="Product status">
      {TABS.map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => setTab(key)}>{label}{products && <b>{key === 'all' ? products.length : products.filter(product => statusOf(product) === key).length}</b>}</button>)}
    </div>
    <input className={s.search} type="search" aria-label="Search products" placeholder="Search style number, product or client" value={search} onChange={event => setSearch(event.target.value)} />
    <div className={s.card}>
      {error ? <div className={s.empty} role="alert">Could not load products. <button type="button" onClick={() => setRetry(n => n + 1)}>Try again</button></div> : !products ? <p className={s.empty}>Loading products…</p> : !shown.length ? <p className={s.empty}>{products.length ? 'No products match these filters.' : 'No products found.'}</p> : <>
        <div className={`${s.grid} ${s.heading}`} aria-hidden="true"><span>Style number</span><span>Product description</span><span>Client</span><span>Status</span><span /></div>
        {shown.map(product => <div className={`${s.grid} ${s.row}`} key={product.id}>
          <div className={s.styleCell}><ProductThumbnail product={product} /><Link className={s.style} href={`/v2/products/${product.id}`}>{product.style_number || 'Style number not assigned'}</Link></div>
          <div><span className={s.mobileLabel}>Product: </span>{product.name || product.description || '—'}</div>
          <div><span className={s.mobileLabel}>Client: </span>{product.company?.name || '—'}</div>
          <div><span className={s.mobileLabel}>Status: </span>{statusOf(product) === 'unset' ? 'Not set' : statusOf(product) === 'active' ? 'Active' : 'Inactive'}</div>
          <div>{product.quotes.length ? <>
            <Link className={s.button} href={`/v2/quotes/${product.quotes[0].id}`} aria-label={`View quote for ${product.style_number || product.name || 'product'}`}>View quote</Link>
            {product.quotes.length > 1 && <span className={s.latest}>Latest quote</span>}
            {product.quotes.length > 1 && <details className={s.more}><summary>{product.quotes.length - 1} more {product.quotes.length === 2 ? 'quote' : 'quotes'}</summary><ul>{product.quotes.slice(1).map(quote => <li key={quote.id}><Link href={`/v2/quotes/${quote.id}`}>{quote.quote_code || 'View quote'}</Link></li>)}</ul></details>}
          </> : <span className={s.noQuote}>No linked quote</span>}</div>
        </div>)}
      </>}
    </div>
    {products && <p className={s.count}>{shown.length} {shown.length === 1 ? 'product' : 'products'} shown</p>}
  </main>;
}

export default function ProductsPage() { return <V2Shell><ProductsList /></V2Shell>; }
