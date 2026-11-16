'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { SB } from '@/lib/supabase';
import s from './v2.module.css';

export default function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState({ loading: false, items: [] });
  const container = useRef(null);
  const query = term.trim();

  useEffect(() => {
    if (!query) return;
    let active = true;
    const timer = setTimeout(async () => {
      setResult({ loading: true, items: [] });
      const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
      try {
        const [products, clients] = await Promise.all([
          SB.from('products').select('id,style_number,name').ilike('style_number', pattern).order('style_number').limit(8),
          SB.from('companies').select('id,name').eq('type', 'client').ilike('name', pattern).order('name').limit(8),
        ]);
        if (!active) return;
        if (products.error || clients.error) { setResult({ error: true, items: [] }); return; }
        setResult({ items: [
          ...(products.data || []).map(p => ({ id: p.id, label: p.style_number, detail: p.name, type: 'Product', href: `/v2/products/${p.id}` })),
          ...(clients.data || []).map(c => ({ id: c.id, label: c.name, type: 'Client', href: `/v2/clients/${c.id}` })),
        ] });
      } catch { if (active) setResult({ error: true, items: [] }); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);

  useEffect(() => {
    const dismiss = event => { if (!container.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);

  return <div className={s.globalSearch} ref={container} onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
    <Search size={18} aria-hidden="true" />
    <input aria-label="Search products by style number or clients by name" placeholder="Search style number or client" value={term}
      onFocus={() => setOpen(true)} onChange={event => { setTerm(event.target.value); setResult({ loading: true, items: [] }); setOpen(true); }} />
    {open && query && <div className={s.searchResults} aria-live="polite">
      {result.loading ? <p>Searching…</p> : result.error ? <p>Search unavailable. Try again.</p> : !result.items.length ? <p>No matching products or clients.</p> : result.items.map(item =>
        <Link key={`${item.type}-${item.id}`} href={item.href} className={s.searchResult} onClick={() => { setOpen(false); setTerm(''); }}>
          <span><strong>{item.label}</strong>{item.detail && <small>{item.detail}</small>}</span><span className={s.searchType}>{item.type}</span>
        </Link>)}
    </div>}
  </div>;
}
