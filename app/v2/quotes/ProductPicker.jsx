'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import styles from './quote-modal.module.css';

export default function ProductPicker({ selected, onPick, disabled, query, setQuery }) {
  const [result, setResult] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    let active = true;
    async function load() {
      const products = [];
      for (let start = 0; ; start += 1000) {
        const { data, error } = await SB.from('products').select('id,style_number,sku,name,description,client_company_id,company:companies!client_company_id(name)').order('id').range(start, start + 999);
        if (error) throw error;
        products.push(...data);
        if (data.length < 1000) return products.sort((a, b) => (a.style_number || a.name || '').localeCompare(b.style_number || b.name || '', undefined, { numeric: true }));
      }
    }
    setResult({ loading: true });
    load().then(products => { if (active) setResult({ products }); }).catch(() => { if (active) setResult({ error: true }); });
    return () => { active = false; };
  }, [retry]);

  const normalize = value => String(value || '').toLowerCase().replace(/[-\s]/g, '');
  const term = normalize(query);
  const matches = (result.products || []).filter(product => !term || [product.style_number, product.name, product.description, product.sku, product.company?.name].some(value => normalize(value).includes(term)));
  const shown = matches.slice(0, 30);
  const choose = product => {
    const accepted = onPick({ productId: product.id, product: product.name || product.description || '', sku: product.sku || '', clientId: product.client_company_id || null, client: product.company?.name || '', styleNumber: product.style_number || '' });
    if (accepted !== false) { setQuery(''); setOpen(false); setActiveIndex(-1); }
  };
  const onKeyDown = event => {
    if (event.key === 'ArrowDown' && shown.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, shown.length - 1)); }
    else if (event.key === 'ArrowUp' && shown.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => index <= 0 ? shown.length - 1 : index - 1); }
    else if (event.key === 'Enter' && open && shown[activeIndex]) { event.preventDefault(); choose(shown[activeIndex]); }
    else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveIndex(-1); }
  };

  return <div className="form-row">
    <label htmlFor="quote-product">Product *</label>
    <div className={styles.productPicker} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActiveIndex(-1); } }}>
      <input id="quote-product" className="form-input" role="combobox" aria-autocomplete="list" aria-expanded={open && !!result.products} aria-controls="quote-product-options" aria-activedescendant={open && shown[activeIndex] ? `quote-product-option-${activeIndex}` : undefined} placeholder="Search style number, product, SKU or client" value={query} disabled={disabled || !result.products?.length} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }} onKeyDown={onKeyDown} />
      {open && !!result.products?.length && <div className={styles.productResults}>
        <ul id="quote-product-options" role="listbox" aria-label="Matching products">
          {shown.map((product, index) => <li key={product.id} id={`quote-product-option-${index}`} role="option" aria-selected={selected?.productId === product.id} className={index === activeIndex ? styles.activeProduct : ''} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(product)}>{[product.style_number || 'Style not assigned', product.name || product.description || 'Unnamed product', product.company?.name].filter(Boolean).join(' · ')}</li>)}
        </ul>
        {!shown.length && <p>No matching products.</p>}
        {matches.length > shown.length && <p>Showing the first {shown.length} matches. Keep typing to narrow the list.</p>}
      </div>}
    </div>
    {query && <button type="button" className="btn btn-ghost" disabled={disabled} onClick={() => { setQuery(''); setOpen(false); setActiveIndex(-1); }}>Clear product search</button>}
    {selected && <p className={styles.selectedProduct}>Selected: {[selected.styleNumber || 'Style not assigned', selected.product || 'Unnamed product', selected.client].filter(Boolean).join(' · ')}</p>}
    {result.loading && <p>Loading products…</p>}
    {result.error && <p role="alert">Could not load products. <button type="button" className="btn btn-ghost" onClick={() => setRetry(n => n + 1)}>Try again</button></p>}
    {result.products?.length === 0 && <p>No products found. Create a product first.</p>}
  </div>;
}
