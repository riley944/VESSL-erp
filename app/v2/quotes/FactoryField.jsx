'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';

export default function FactoryField({ value, onChange }) {
  const [factories, setFactories] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    SB.from('companies').select('id,name').eq('type', 'factory').order('name')
      .then(({ data, error: err }) => { if (active) { setFactories(data || []); setError(!!err); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  return <div className="form-row">
    <label htmlFor="quote-factory">Factory</label>
    <select id="quote-factory" className="form-select" value={value} onChange={e => onChange(e.target.value)}>
      <option value="">Not set</option>
      {value && !factories.some(factory => factory.name === value) && <option value={value}>{value}</option>}
      {factories.map(factory => <option key={factory.id} value={factory.name}>{factory.name}</option>)}
    </select>
    {error && <p role="alert">Could not load factories. The saved factory is unchanged.</p>}
  </div>;
}
