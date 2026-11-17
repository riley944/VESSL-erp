'use client';

import { useRef, useState } from 'react';
import { SB } from '@/lib/supabase';
import { HtsField, useHtsCodes } from '@/app/components/HtsField';
import { CodeModal } from '@/app/components/CodeModal';
import { DUTY_SPLIT_AT } from '@/lib/quoteRow';
import { QUOTES_CHANGED } from '../quoteEvents';
import ProductPicker from './ProductPicker';
import FactoryField from './FactoryField';
import QuoteTasks from './QuoteTasks';
import QuotePricing from './QuotePricing';
import useQuotePricing from './useQuotePricing';
import { initialQuoteForm, quoteChanges } from './quoteForm';
import styles from './quote-modal.module.css';

const TABS = ['Quote details', 'Client', 'Factory', 'Pricing', 'Carton', 'Tasks'];

export default function QuoteModal({ quote = null, newQuote = null, onClose, onSaved }) {
  const [savedQuote, setSavedQuote] = useState(quote);
  const [form, setForm] = useState(() => initialQuoteForm(quote));
  const original = useRef(initialQuoteForm(quote));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [taskDraft, setTaskDraft] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [addingCode, setAddingCode] = useState(null);
  const [selectedProduct, setSelectedProduct] = useState(newQuote);
  const [productQuery, setProductQuery] = useState('');
  const { codes, addCode } = useHtsCodes();
  const { updateTier, changeHts, finishDutyEdit, addTier, removeTier } = useQuotePricing({ form, setForm, codes, setNotice });
  const dirty = JSON.stringify(form) !== JSON.stringify(original.current);
  const client = savedQuote?.client ?? selectedProduct?.client ?? '';
  const product = savedQuote?.product ?? selectedProduct?.product ?? '';
  const set = key => e => { setForm(previous => ({ ...previous, [key]: e.target.value })); setNotice(''); };
  const pickProduct = next => {
    const hasContact = ['client_contact', 'client_email', 'client_phone', 'client_address'].some(key => form[key]);
    if (selectedProduct?.productId !== next?.productId && hasContact) {
      if (!window.confirm('Changing the product will clear the client contact details. Continue?')) return false;
      setForm(previous => ({ ...previous, client_contact: '', client_email: '', client_phone: '', client_address: '' }));
    }
    setSelectedProduct(next);
    setError('');
    return true;
  };
  const pickFactory = factory => {
    setForm(previous => ({ ...previous, factory: factory?.name || '', factory_company_id: factory?.id || '', factory_contact: '', factory_email: '', factory_phone: '', country: '', lead_time: '' }));
    setNotice('');
  };
  const tabKeyDown = (event, index) => {
    const target = event.key === 'ArrowRight' ? (index + 1) % TABS.length : event.key === 'ArrowLeft' ? (index + TABS.length - 1) % TABS.length : event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : null;
    if (target !== null) {
      event.preventDefault();
      setStep(target);
      event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[target].focus();
    }
  };
  const close = () => {
    if (saving || taskBusy) return;
    if ((dirty || taskDraft.trim()) && !window.confirm('Discard unsaved changes?')) return;
    if (changed) onSaved(); else onClose();
  };
  const save = async () => {
    if (saving) return;
    if (!savedQuote && !selectedProduct?.productId) { setStep(0); setError('Select a product before creating a quote.'); return; }
    if (!savedQuote && productQuery.trim()) { setStep(0); setError('Select a product from the search results or clear the search before saving.'); return; }
    const { payload, changedFreight, legacyRemains } = quoteChanges(form, original.current, savedQuote, selectedProduct);
    if (savedQuote && !Object.keys(payload).length) { setNotice('No changes to save.'); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const { data: auth, error: authError } = await SB.auth.getSession();
      if (authError) throw authError;
      payload.updated_at = new Date().toISOString();
      payload.updated_by = auth?.session?.user?.email || null;
      if (changedFreight && !legacyRemains) {
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
      setNotice(changedFreight && legacyRemains ? 'Quote saved. Older freight that includes duty is preserved; review other freight-only tiers in older quote views.' : 'Quote saved.');
    } catch (err) { setError(err.message || 'Could not save quote.'); }
    finally { setSaving(false); }
  };
  const field = (key, label, type = 'text') => <div className="form-row">
    <label htmlFor={`quote-${key}`}>{label}</label>
    {type === 'textarea' ? <textarea id={`quote-${key}`} className="form-input" rows={3} value={form[key]} onChange={set(key)} /> : <input id={`quote-${key}`} className="form-input" type={type} step={type === 'number' ? 'any' : undefined} value={form[key]} onChange={set(key)} />}
  </div>;

  return <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) close(); }}>
    {addingCode && <CodeModal data={addingCode} onClose={() => setAddingCode(null)} onSaved={row => { setAddingCode(null); if (row) { changeHts(row.code, row); addCode(row); } }} />}
    <div className="modal-box" role="dialog" aria-modal="true" aria-label={quote ? 'Edit Quote' : 'New Quote'}>
      <div className="modal-head"><h3>{quote ? 'Edit Quote' : 'New Quote'}{savedQuote?.quote_code ? ` · ${savedQuote.quote_code}` : ''}</h3><button className="modal-close" aria-label="Close" onClick={close}>×</button></div>
      <div className="modal-body">
        <div role="tablist" aria-label="Quote sections" className={styles.tabs}>
          {TABS.map((label, index) => <button type="button" role="tab" id={`quote-tab-${index}`} aria-controls={`quote-panel-${index}`} aria-selected={step === index} tabIndex={step === index ? 0 : -1} key={label} onClick={() => setStep(index)} onKeyDown={event => tabKeyDown(event, index)}>{label}</button>)}
        </div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status">{notice}</p>}
        <section hidden={step !== 0} role="tabpanel" id="quote-panel-0" aria-labelledby="quote-tab-0">
          {!quote && !newQuote?.productId && !savedQuote
            ? <ProductPicker selected={selectedProduct} query={productQuery} setQuery={setProductQuery} disabled={saving} onPick={pickProduct} />
            : <div className="form-row"><label>Product</label><p>{product || 'Not linked'}</p></div>}
          <div className="form-row"><label>SKU</label><p>{savedQuote?.sku || selectedProduct?.sku || 'Not set'}</p></div>
          {field('quote_date', 'Quote date', 'date')}{field('notes', 'Notes', 'textarea')}
          {field('client_details', 'Client price sheet details', 'textarea')}{field('client_color', 'Client price sheet color')}
        </section>
        <section hidden={step !== 1} role="tabpanel" id="quote-panel-1" aria-labelledby="quote-tab-1">
          <div className="form-row"><label>Client</label><p>{client || 'Not set'}</p></div>
          {field('client_contact', 'Client contact')}{field('client_email', 'Client email', 'email')}
          {field('client_phone', 'Client phone')}{field('client_address', 'Client address', 'textarea')}
        </section>
        <section hidden={step !== 2} role="tabpanel" id="quote-panel-2" aria-labelledby="quote-tab-2">
          <FactoryField value={form.factory} factoryId={form.factory_company_id} onChange={pickFactory} />
          {field('factory_contact', 'Factory contact')}{field('factory_email', 'Factory email', 'email')}
          {field('factory_phone', 'Factory phone')}{field('country', 'Country')}{field('lead_time', 'Lead time')}
          <HtsField label="HTS code" fieldClassName="form-row" inputClassName="form-input" value={form.hts} codes={codes} onChange={changeHts} onAdd={code => setAddingCode({ code })} />
        </section>
        <section hidden={step !== 3} role="tabpanel" id="quote-panel-3" aria-labelledby="quote-tab-3">
          <QuotePricing form={form} field={field} updateTier={updateTier} finishDutyEdit={finishDutyEdit} addTier={addTier} removeTier={removeTier} />
        </section>
        <section hidden={step !== 4} role="tabpanel" id="quote-panel-4" aria-labelledby="quote-tab-4">
          {field('units_per_carton', 'Units per carton', 'number')}{field('carton_l', 'Carton length (cm)', 'number')}
          {field('carton_w', 'Carton width (cm)', 'number')}{field('carton_h', 'Carton height (cm)', 'number')}{field('carton_weight', 'Carton weight (kg)', 'number')}
        </section>
        <section hidden={step !== 5} role="tabpanel" id="quote-panel-5" aria-labelledby="quote-tab-5">
          {savedQuote ? <QuoteTasks quote={savedQuote} draft={taskDraft} setDraft={setTaskDraft} busy={taskBusy} setBusy={setTaskBusy} /> : <p>Save the quote before adding a task.</p>}
        </section>
      </div>
      <div className="modal-foot">
        <button className="btn btn-ghost" onClick={close}>Close</button>
        {step > 0 && <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
        {step < TABS.length - 1 && <button className="btn btn-ghost" onClick={() => setStep(step + 1)}>Next</button>}
        <button className="btn btn-dark" disabled={saving || taskBusy} onClick={save}>{saving ? 'Saving…' : 'Save quote'}</button>
      </div>
    </div>
  </div>;
}
