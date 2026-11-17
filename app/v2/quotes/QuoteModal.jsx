'use client';

import { useEffect, useRef, useState } from 'react';
import { SB } from '@/lib/supabase';
import { insertTask } from '@/lib/taskSeen';
import { notifyTaskAssigned } from '@/lib/taskNotify';
import { HtsField, useHtsCodes } from '@/app/components/HtsField';
import { CodeModal } from '@/app/components/CodeModal';
import { DUTY_SPLIT_AT } from '@/lib/quoteRow';
import { QUOTES_CHANGED } from '../quoteEvents';
import styles from './quote-modal.module.css';

const TABS = ['Quote details', 'Client', 'Factory', 'Pricing', 'Carton', 'Tasks'];
const FIELDS = ['quote_date', 'notes', 'client_contact', 'client_email', 'client_phone', 'client_address', 'factory', 'factory_contact', 'factory_email', 'factory_phone', 'country', 'lead_time', 'hts', 'units_per_carton', 'carton_l', 'carton_w', 'carton_h', 'carton_weight', 'mold_fee', 'sample_fee', 'client_details', 'client_color'];
const NUMBERS = new Set(['units_per_carton', 'carton_l', 'carton_w', 'carton_h', 'carton_weight', 'mold_fee', 'sample_fee']);
const TIER_NUMBERS = ['qty', 'landed', 'freightAir', 'freightOcean', 'duty', 'client'];
const emptyTier = () => ({ qty: '', landed: '', ship: 'ocean', freightAir: '', freightOcean: '', duty: '', client: '' });

function initialForm(quote) {
  const fields = Object.fromEntries(FIELDS.map(key => [key, quote?.[key] == null ? '' : String(quote[key])]));
  if (!quote) fields.quote_date = new Date().toISOString().slice(0, 10);
  let tiers = quote?.tiers;
  let invalidTiers = false;
  if (typeof tiers === 'string') { try { tiers = JSON.parse(tiers); } catch { invalidTiers = true; tiers = null; } }
  if (tiers != null && (!Array.isArray(tiers) || tiers.some(tier => !tier || typeof tier !== 'object' || Array.isArray(tier)))) invalidTiers = true;
  if (invalidTiers) return { ...fields, tiers: [], invalidTiers: true };
  if (!Array.isArray(tiers) || !tiers.length) {
    tiers = quote && (quote.qty != null || quote.landed != null)
      ? [{ ...emptyTier(), qty: quote.qty ?? '', landed: quote.landed ?? '', freightOcean: quote.freight_duty ?? '' }]
      : [];
  }
  tiers = tiers.map(tier => {
    if (!tier || typeof tier !== 'object' || Array.isArray(tier)) return tier;
    if (tier.freightDuty != null && tier.freightDuty !== '' && (tier.freightAir == null || tier.freightAir === '') && (tier.freightOcean == null || tier.freightOcean === '')) {
      return { ...tier, [tier.ship === 'air' ? 'freightAir' : 'freightOcean']: tier.freightDuty };
    }
    return tier;
  });
  return { ...fields, tiers, invalidTiers: false };
}

function TierField({ label, value, onChange }) {
  return <label>{label}<input className="form-input" type="number" step="any" value={value ?? ''} onChange={e => onChange(e.target.value)} /></label>;
}

export default function QuoteModal({ quote = null, newQuote = null, onClose, onSaved }) {
  const [savedQuote, setSavedQuote] = useState(quote);
  const [form, setForm] = useState(() => initialForm(quote));
  const original = useRef(initialForm(quote));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [addingCode, setAddingCode] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(newQuote);
  const { codes, addCode } = useHtsCodes();
  const dirty = JSON.stringify(form) !== JSON.stringify(original.current);
  const client = savedQuote?.client ?? selectedProduct?.client ?? '';
  const product = savedQuote?.product ?? selectedProduct?.product ?? '';
  const set = key => e => { setForm(previous => ({ ...previous, [key]: e.target.value })); setNotice(''); };
  const updateTier = (index, key, value) => setForm(previous => ({ ...previous, tiers: previous.tiers.map((tier, i) => {
    if (i !== index) return tier;
    const updated = { ...tier, [key]: value, ...(key === 'duty' ? { dutyManual: value !== '' } : {}) };
    if (key === 'freightAir' || key === 'freightOcean') delete updated.freightDuty;
    return updated;
  }) }));

  const close = () => {
    if (saving || taskBusy) return;
    if ((dirty || taskDraft.trim()) && !window.confirm('Discard unsaved changes?')) return;
    if (changed) onSaved(); else onClose();
  };
  const save = async () => {
    if (saving) return;
    if (!savedQuote && !selectedProduct?.productId) { setStep(0); setError('Select a product before creating a quote.'); return; }
    const payload = {};
    for (const key of FIELDS) {
      if (savedQuote && form[key] === original.current[key]) continue;
      const value = form[key];
      payload[key] = value === '' ? null : NUMBERS.has(key) ? Number(value) : value;
    }
    const tiersChanged = JSON.stringify(form.tiers) !== JSON.stringify(original.current.tiers);
    if (tiersChanged || !savedQuote) {
      const tiers = form.tiers.map(tier => {
        const result = { ...tier };
        TIER_NUMBERS.forEach(key => { if (key in result) result[key] = result[key] === '' || result[key] == null ? null : Number(result[key]); });
        return result;
      });
      payload.tiers = tiers;
      const first = tiers[0] || {};
      payload.qty = first.qty ?? null;
      payload.landed = first.landed ?? null;
      payload.freight_duty = (first.ship === 'air' ? first.freightAir : first.freightOcean) ?? null;
    }
    if (!savedQuote) Object.assign(payload, { product_id: selectedProduct.productId, client_company_id: selectedProduct.clientId || null, product: product || null, client: client || null, sku: selectedProduct.sku || null });
    if (savedQuote && !Object.keys(payload).length) { setNotice('No changes to save.'); return; }
    const freightChanged = tiersChanged && JSON.stringify(form.tiers.map(tier => [tier.ship, tier.freightAir, tier.freightOcean, tier.duty])) !== JSON.stringify(original.current.tiers.map(tier => [tier.ship, tier.freightAir, tier.freightOcean, tier.duty]));
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: auth, error: authError } = await SB.auth.getSession();
      if (authError) throw authError;
      payload.updated_at = new Date().toISOString();
      payload.updated_by = auth?.session?.user?.email || null;
      if (freightChanged) {
        payload.freight_duty_updated_at = payload.updated_at;
        payload.freight_duty_updated_by = payload.updated_by;
      } else if (savedQuote && !savedQuote.freight_duty_updated_at && Date.parse(savedQuote.updated_at) < DUTY_SPLIT_AT) {
        payload.freight_duty_updated_at = savedQuote.updated_at;
      }
      const query = savedQuote ? SB.from('quotes').update(payload).eq('id', savedQuote.id) : SB.from('quotes').insert(payload);
      const { data, error: saveError } = await query.select('*');
      if (saveError) throw saveError;
      if (!data?.length) throw new Error('No quote was saved. It may no longer exist or you may not have permission.');
      if (!savedQuote) window.dispatchEvent(new Event(QUOTES_CHANGED));
      setSavedQuote(data[0]);
      original.current = form;
      setChanged(true);
      setNotice('Quote saved.');
    } catch (err) { setError(err.message || 'Could not save quote.'); }
    finally { setSaving(false); }
  };
  const field = (key, label, type = 'text') => <div className="form-row"><label htmlFor={`quote-${key}`}>{label}</label>{type === 'textarea' ? <textarea id={`quote-${key}`} className="form-input" rows={3} value={form[key]} onChange={set(key)} /> : <input id={`quote-${key}`} className="form-input" type={type} step={type === 'number' ? 'any' : undefined} value={form[key]} onChange={set(key)} />}</div>;

  return <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
    {addingCode && <CodeModal data={addingCode} onClose={() => setAddingCode(null)} onSaved={row => { setAddingCode(null); if (row) { addCode(row); setForm(previous => ({ ...previous, hts: row.code })); } }} />}
    <div className="modal-box" role="dialog" aria-modal="true" aria-label={quote ? 'Edit Quote' : 'New Quote'}>
      <div className="modal-head"><h3>{quote ? 'Edit Quote' : 'New Quote'}{savedQuote?.quote_code ? ` · ${savedQuote.quote_code}` : ''}</h3><button className="modal-close" aria-label="Close" onClick={close}>×</button></div>
      <div className="modal-body">
        <div role="tablist" aria-label="Quote sections" className={styles.tabs}>{TABS.map((label, index) => <button type="button" role="tab" id={`quote-tab-${index}`} aria-controls={`quote-panel-${index}`} aria-selected={step === index} tabIndex={step === index ? 0 : -1} key={label} onClick={() => setStep(index)} onKeyDown={e => { const target = e.key === 'ArrowRight' ? (index + 1) % TABS.length : e.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null; if (target !== null) { e.preventDefault(); setStep(target); e.currentTarget.parentElement.querySelectorAll('[role="tab"]')[target].focus(); } }}>{label}</button>)}</div>
        {error && <p role="alert" className={styles.error}>{error}</p>}{notice && <p role="status">{notice}</p>}
        <section hidden={step !== 0} role="tabpanel" id="quote-panel-0" aria-labelledby="quote-tab-0">{!quote && !newQuote?.productId && !savedQuote ? <ProductPicker selected={selectedProduct} disabled={saving} onPick={next => { if (selectedProduct?.productId !== next?.productId && ['client_contact', 'client_email', 'client_phone', 'client_address'].some(key => form[key])) { if (!window.confirm('Changing the product will clear the client contact details. Continue?')) return false; setForm(previous => ({ ...previous, client_contact: '', client_email: '', client_phone: '', client_address: '' })); } setSelectedProduct(next); setError(''); return true; }} /> : <div className="form-row"><label>Product</label><p>{product || 'Not linked'}</p></div>}<div className="form-row"><label>SKU</label><p>{savedQuote?.sku || selectedProduct?.sku || 'Not set'}</p></div>{field('quote_date', 'Quote date', 'date')}{field('notes', 'Notes', 'textarea')}{field('client_details', 'Client price sheet details', 'textarea')}{field('client_color', 'Client price sheet color')}</section>
        <section hidden={step !== 1} role="tabpanel" id="quote-panel-1" aria-labelledby="quote-tab-1"><div className="form-row"><label>Client</label><p>{client || 'Not set'}</p></div>{field('client_contact', 'Client contact')}{field('client_email', 'Client email', 'email')}{field('client_phone', 'Client phone')}{field('client_address', 'Client address', 'textarea')}</section>
        <section hidden={step !== 2} role="tabpanel" id="quote-panel-2" aria-labelledby="quote-tab-2"><FactoryField value={form.factory} onChange={value => { setForm(previous => ({ ...previous, factory: value, factory_contact: '', factory_email: '', factory_phone: '', country: '', lead_time: '' })); setNotice(''); }} />{field('factory_contact', 'Factory contact')}{field('factory_email', 'Factory email', 'email')}{field('factory_phone', 'Factory phone')}{field('country', 'Country')}{field('lead_time', 'Lead time')}<HtsField label="HTS code" fieldClassName="form-row" inputClassName="form-input" value={form.hts} codes={codes} onChange={value => setForm(previous => ({ ...previous, hts: value }))} onAdd={code => setAddingCode({ code })} /></section>
        <section hidden={step !== 3} role="tabpanel" id="quote-panel-3" aria-labelledby="quote-tab-3">{field('mold_fee', 'Mold fee', 'number')}{field('sample_fee', 'Sample fee', 'number')}{form.invalidTiers ? <p role="alert">Pricing tiers could not be read. They will be preserved; use the original quote editor to review them.</p> : <>{form.tiers.map((tier, index) => <fieldset key={index} className={styles.tier}><legend>Tier {index + 1}</legend><div className={styles.tierFields}>{[['Quantity', 'qty'], ['Factory price', 'landed'], ['Air freight', 'freightAir'], ['Ocean freight', 'freightOcean'], ['Duty', 'duty'], ['Client price', 'client']].map(([label, key]) => <TierField key={key} label={label} value={tier[key]} onChange={value => updateTier(index, key, value)} />)}<label>Shipping method<select className="form-select" value={tier.ship || 'ocean'} onChange={e => updateTier(index, 'ship', e.target.value)}><option value="ocean">Ocean</option><option value="air">Air</option></select></label></div>{(tier.sizeQty || tier.sizeCost) && <p>Size-specific quantities and prices are preserved. Edit them in the original quote editor for now.</p>}<button type="button" className="btn btn-ghost" onClick={() => { if (window.confirm('Remove this pricing tier, including its size-specific details?')) setForm(previous => ({ ...previous, tiers: previous.tiers.filter((_, i) => i !== index) })); }}>Remove tier</button></fieldset>)}<button type="button" className="btn btn-ghost" onClick={() => setForm(previous => ({ ...previous, tiers: [...previous.tiers, emptyTier()] }))}>+ Add tier</button></>}</section>
        <section hidden={step !== 4} role="tabpanel" id="quote-panel-4" aria-labelledby="quote-tab-4">{field('units_per_carton', 'Units per carton', 'number')}{field('carton_l', 'Carton length (cm)', 'number')}{field('carton_w', 'Carton width (cm)', 'number')}{field('carton_h', 'Carton height (cm)', 'number')}{field('carton_weight', 'Carton weight (kg)', 'number')}</section>
        <section hidden={step !== 5} role="tabpanel" id="quote-panel-5" aria-labelledby="quote-tab-5">{savedQuote ? <QuoteTasks quote={savedQuote} draft={taskDraft} setDraft={setTaskDraft} busy={taskBusy} setBusy={setTaskBusy} /> : <p>Save the quote before adding a task.</p>}</section>
      </div>
      <div className="modal-foot"><button className="btn btn-ghost" onClick={close}>Close</button>{step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}{step < TABS.length - 1 && <button className="btn btn-ghost" onClick={() => setStep(step + 1)}>Next</button>}<button className="btn btn-dark" disabled={saving || taskBusy} onClick={save}>{saving ? 'Saving…' : 'Save quote'}</button></div>
    </div>
  </div>;
}

function ProductPicker({ selected, onPick, disabled }) {
  const [result, setResult] = useState({ loading: true });
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
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
  return <div className="form-row"><label htmlFor="quote-product">Product *</label><div className={styles.productPicker} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActiveIndex(-1); } }}>
    <input id="quote-product" className="form-input" role="combobox" aria-autocomplete="list" aria-expanded={open && !!result.products} aria-controls="quote-product-options" aria-activedescendant={open && shown[activeIndex] ? `quote-product-option-${activeIndex}` : undefined} placeholder="Search style number, product, SKU or client" value={query} disabled={disabled || !result.products?.length} onFocus={() => setOpen(true)} onChange={event => { setQuery(event.target.value); setOpen(true); setActiveIndex(-1); }} onKeyDown={event => {
      if (event.key === 'ArrowDown' && shown.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => Math.min(index + 1, shown.length - 1)); }
      else if (event.key === 'ArrowUp' && shown.length) { event.preventDefault(); setOpen(true); setActiveIndex(index => index <= 0 ? shown.length - 1 : index - 1); }
      else if (event.key === 'Enter' && open && shown[activeIndex]) { event.preventDefault(); choose(shown[activeIndex]); }
      else if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveIndex(-1); }
    }} />
    {open && !!result.products?.length && <div className={styles.productResults}><ul id="quote-product-options" role="listbox" aria-label="Matching products">{shown.map((product, index) => <li key={product.id} id={`quote-product-option-${index}`} role="option" aria-selected={selected?.productId === product.id} className={index === activeIndex ? styles.activeProduct : ''} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(product)}>{[product.style_number || 'Style not assigned', product.name || product.description || 'Unnamed product', product.company?.name].filter(Boolean).join(' · ')}</li>)}</ul>{!shown.length && <p>No matching products.</p>}{matches.length > shown.length && <p>Showing the first {shown.length} matches. Keep typing to narrow the list.</p>}</div>}
  </div>{selected && <p className={styles.selectedProduct}>Selected: {[selected.styleNumber || 'Style not assigned', selected.product || 'Unnamed product', selected.client].filter(Boolean).join(' · ')}</p>}{result.loading && <p>Loading products…</p>}{result.error && <p role="alert">Could not load products. <button type="button" className="btn btn-ghost" onClick={() => setRetry(n => n + 1)}>Try again</button></p>}{result.products?.length === 0 && <p>No products found. Create a product first.</p>}</div>;
}

function FactoryField({ value, onChange }) {
  const [factories, setFactories] = useState([]);
  const [error, setError] = useState(false);
  useEffect(() => { let active = true; SB.from('companies').select('id,name').eq('type', 'factory').order('name').then(({ data, error: err }) => { if (active) { setFactories(data || []); setError(!!err); } }).catch(() => { if (active) setError(true); }); return () => { active = false; }; }, []);
  return <div className="form-row"><label htmlFor="quote-factory">Factory</label><select id="quote-factory" className="form-select" value={value} onChange={e => onChange(e.target.value)}><option value="">Not set</option>{value && !factories.some(factory => factory.name === value) && <option value={value}>{value}</option>}{factories.map(factory => <option key={factory.id} value={factory.name}>{factory.name}</option>)}</select>{error && <p role="alert">Could not load factories. The saved factory is unchanged.</p>}</div>;
}

function QuoteTasks({ quote, draft, setDraft, busy, setBusy }) {
  const [tasks, setTasks] = useState(null);
  const [staff, setStaff] = useState([]);
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setTasks(null); setError('');
    Promise.all([SB.from('tasks').select('*').eq('quote_id', quote.id).order('created_at'), SB.from('staff_profiles').select('email,full_name').order('full_name')])
      .then(([taskResult, staffResult]) => { if (!active) return; if (taskResult.error || staffResult.error) throw taskResult.error || staffResult.error; setTasks(taskResult.data || []); setStaff(staffResult.data || []); })
      .catch(err => { if (active) setError(err.message || 'Could not load tasks.'); });
    return () => { active = false; };
  }, [quote.id, retry]);
  const add = async () => {
    if (busy || !draft.trim() || !assignee) return;
    setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await SB.auth.getSession();
      if (authError) throw authError;
      const task = { quote_id: quote.id, quote_label: `${quote.product || 'Quote'}${quote.sku ? ` · ${quote.sku}` : ''}`, assigned_to: assignee, assigned_by: auth?.session?.user?.email || null, task: draft.trim(), done: false };
      const { data, error: taskError } = await insertTask(task);
      if (taskError) throw taskError;
      setTasks(previous => [...previous, data]); setDraft(''); setAssignee('');
      void notifyTaskAssigned(data?.id, staff.find(person => person.email === assignee)?.full_name || assignee, setError);
    } catch (err) { setError(err.message || 'Could not save task.'); }
    finally { setBusy(false); }
  };
  return <><p>Tasks save separately from quote changes.</p>{error && <p role="alert">{error}</p>}{tasks === null ? <><p>Loading tasks…</p>{error && <button type="button" className="btn btn-ghost" onClick={() => setRetry(n => n + 1)}>Try again</button>}</> : <><ul>{tasks.map(task => <li key={task.id}>{task.task} · {task.assigned_to || 'Unassigned'}{task.done ? ' · Done' : ''}</li>)}</ul><div className="form-row"><label htmlFor="quote-task">New task</label><input id="quote-task" className="form-input" value={draft} onChange={e => setDraft(e.target.value)} /></div><div className="form-row"><label htmlFor="quote-task-assignee">Assign to</label><select id="quote-task-assignee" className="form-select" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Select a person</option>{staff.filter(person => person.email).map(person => <option key={person.email} value={person.email}>{person.full_name || person.email}</option>)}</select></div><button type="button" className="btn btn-ghost" disabled={busy || !draft.trim() || !assignee} onClick={add}>{busy ? 'Adding…' : 'Add task'}</button></>}</>;
}
