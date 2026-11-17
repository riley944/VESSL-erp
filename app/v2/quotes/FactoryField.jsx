'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';

export default function FactoryField({ value, factoryId, onChange }) {
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
    <select id="quote-factory" className="form-select" value={factoryId || (value ? '__saved_name__' : '')} onChange={e => onChange(factories.find(factory => factory.id === e.target.value) || null)}>
      <option value="">Not set</option>
      {value && !factoryId && <option value="__saved_name__">{value} (saved name)</option>}
      {factoryId && !factories.some(factory => factory.id === factoryId) && <option value={factoryId}>{value || 'Saved factory'}</option>}
      {factories.map(factory => <option key={factory.id} value={factory.id}>{factory.id === factoryId && value ? value : factory.name}</option>)}
    </select>
    {error && <p role="alert">Could not load factories. The saved factory is unchanged.</p>}
  </div>;
}
