'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';
import { SBQ } from '@/lib/supabaseQuotes';
import { useDirtyGuard } from '@/app/components/ModalGuard';

// ── CreateCompanyModal ───────────────────────────────────────────────────────
// Extracted from app/page.jsx unchanged in behaviour. It moved because the quote
// form needs to create a factory without free text, and page.jsx imports
// app/quotes.jsx rather than the other way round -- so exporting it from there
// would have made a cycle. Same reason HtsField, CodeModal and OwnerSelect live
// here: a component two pages need belongs to neither of them.
//
// ── onCreated TAKES TWO ARGUMENTS NOW ───────────────────────────────────────
// onCreated(type, company). The FIRST is unchanged and is what the Companies page
// has always used: the list there is fetched one type at a time, so a company
// created as a factory while the Clients tab is open has to move the tab, and the
// type is the only way to know which. page.jsx ignores the second argument.
//
// The SECOND is the created row, which the quote form needs -- it has to select
// the company it just made, and selecting needs the id and the name. Reading it
// back off a refetch would mean guessing which row is new.
//
// THE UPSERT IS THE POINT, not an implementation detail. onConflict is
// (name, type), so saving a company that already exists ADOPTS it rather than
// failing or duplicating -- which is why the contact insert below counts first.
// ── THE ONE LIST OF COMPANY TYPES ───────────────────────────────────────────
// [value, label] -- the value is what is stored and compared, the label is only
// ever rendered. Exported because page.jsx reads it too (the Companies edit modal
// and the + New button), and a second copy there is how the two drifted apart
// once already. Singular on purpose: it names one company's type. The Companies
// tabs keep their own plural list, which titles a tab rather than a company.
export const COMPANY_TYPES = [
  ['client',            'Client'],
  ['factory',           'Factory'],
  ['carrier',           'Carrier'],
  ['freight_forwarder', 'Freight Forwarder'],
];

export function CreateCompanyModal({ onClose, onCreated, initialType }) {
  // Plain form, every field an input or select. No click-driven setters at all.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  // initialType lets a host open this already set to what it is asking for -- the
  // quote form only ever wants a factory, and making somebody pick it from a list
  // of four when the button said "add new factory" is a step that can go wrong.
  //
  // AND WHEN IT IS GIVEN, THE TYPE IS FIXED. Every host passes one -- the four
  // Companies tabs, the quote form's client and factory, the PLM round form's
  // carrier -- and each asked for exactly that type, so the form shows it as a
  // value rather than a select somebody could change on the way to Save. The
  // select is kept for an opening with no initialType, which nothing does today;
  // that opening starts as Client, as the old default did.
  const typeFixed = !!initialType;
  const [form, setForm] = useState({name:'',type:initialType || 'client',email:'',phone:'',website:'',vendor_number:'',pallet_info:'',billing_address:'',shipping_address:'',tracking_url:'',cname:'',cemail:'',cphone:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  // THE WORD FOLLOWS THE TYPE, fixed or selected, so the title, the name label, the save
  // button and the required-name alert all say Factory once somebody picks
  // Factory -- read from form.type on every render rather than from initialType,
  // which only seeds it. An empty or unknown type says Company, as it always did.
  const typeLabel = (COMPANY_TYPES.find(([v]) => v === form.type) || [null, 'Company'])[1];
  const submit = async () => {
    if (!form.name) { alert(typeLabel + ' name required'); return; }
    // ── A CARRIER'S TRACKING PAGE, AND ITS NAME IN ANY CASE ─────────────────
    // companies.tracking_url (script 85) is the carrier tracking page with
    // {number} where the number goes, and the database refuses any other shape,
    // so it is checked here first with the same rule and a readable message.
    // Blank is allowed and sends nothing -- adopting an existing carrier with
    // the field left empty keeps the pattern it already has.
    //
    // (name, type) is unique but case-sensitive, so "fedex" would make a
    // second FedEx. For a carrier, a name matching one in another case adopts
    // that carrier, spelled as it already is.
    const url = form.type === 'carrier' ? (form.tracking_url || '').trim() : '';
    if (url && !(url.startsWith('https') && url.includes('{number}'))) {
      alert('The tracking URL must start with https and contain {number} where the tracking number goes.'); return;
    }
    let name = form.name;
    if (form.type === 'carrier') {
      const { data: same } = await SB.from('companies').select('name').eq('type', 'carrier');
      const hit = (same || []).find(c => (c.name || '').trim().toLowerCase() === name.trim().toLowerCase());
      if (hit) name = hit.name;
    }
    const { data: co, error } = await SB.from('companies').upsert({name,type:form.type,...(url ? { tracking_url: url } : {}),email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null,billing_address:form.billing_address||null,shipping_address:form.shipping_address||null},{onConflict:'name,type',ignoreDuplicates:false}).select().single();
    if (error) { alert('Error: '+error.message); return; }
    // PRIMARY ONLY IF THIS COMPANY HAS NOBODY YET. This modal is an UPSERT on
    // (name, type), so "create" can adopt a company that already exists and
    // already has contacts -- and hardcoding true here is one of the ways three
    // companies ended up with several primaries. The count is one extra read on
    // a path somebody takes once.
    if (form.cname) {
      const { count } = await SB.from('contacts')
        .select('id', { count:'exact', head:true }).eq('company_id', co.id);
      await SB.from('contacts').insert({company_id:co.id,full_name:form.cname,email:form.cemail||null,phone:form.cphone||null,is_primary:!(count||0)});
    }
    // Mirror into Quotes directory so it appears in quote autofill.
    //
    // THE FACTORY BRANCH IS KEPT ON PURPOSE, even though the quote form no longer
    // writes presets itself. The factory select fills country and lead time from
    // the preset matching the company name, so a factory created with no preset
    // would fill nothing and give nobody a place to record them. An empty preset
    // created here is the row those two fields get typed into later.
    try {
      if (form.type==='client') {
        await SBQ.from('client_contacts').insert({client:form.name,contact:form.cname||null,email:form.cemail||null,phone:form.phone||null}).select();
      } else if (form.type==='factory') {
        await SBQ.from('factory_presets').insert({factory:form.name,factory_email:form.email||null,factory_phone:form.phone||null}).select();
      }
    } catch(e) {}
    // THE TYPE TRAVELS BACK, because the Companies list is fetched per type and
    // cannot otherwise know which tab the new company landed on. The ROW travels
    // back beside it for hosts that have to select what they just made.
    onCreated(co.type, co);
  };
  return (
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&guardedClose()}>
      <div ref={cardRef} className="modal-box">
        <div className="modal-head"><h3>New {typeLabel}</h3><button className="modal-close" onClick={guardedClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>{typeLabel} Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
            <div><label>Type</label>{typeFixed
              ? <input className="form-input" value={typeLabel} readOnly tabIndex={-1} data-noguard aria-label="Type" style={{background:'var(--bg)',color:'var(--muted)',cursor:'default'}} />
              : <select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{COMPANY_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>}</div>
          </div>
          <div className="form-row-2">
            <div><label>Email</label><input type="email" className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
            <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
          {form.type==='carrier' && (
            <div className="form-row"><label>Tracking URL <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(optional -- put {'{number}'} where the tracking number goes)</span></label><input className="form-input" value={form.tracking_url} onChange={e=>f('tracking_url')(e.target.value)} placeholder="https://www.example.com/track?n={number}" /></div>
          )}
          <div className="form-row"><label>Billing Address</label><textarea className="form-input" rows={3} value={form.billing_address} onChange={e=>f('billing_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
          <div className="form-row"><label>Shipping Address <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(prefills the ship-to on new orders)</span></label><textarea className="form-input" rows={3} value={form.shipping_address} onChange={e=>f('shipping_address')(e.target.value)} placeholder="Street, city, state / province, postal code, country" style={{resize:'vertical',fontFamily:'var(--sans)',lineHeight:1.5}} /></div>
          {form.type==='client' && (
            <div className="form-row-2">
              <div><label>Vendor # <span style={{color:'var(--muted)',textTransform:'none',letterSpacing:0}}>(internal)</span></label><input className="form-input" value={form.vendor_number} onChange={e=>f('vendor_number')(e.target.value)} /></div>
              <div><label>Pallet info</label><input className="form-input" value={form.pallet_info} onChange={e=>f('pallet_info')(e.target.value)} placeholder="e.g. 48x40 GMA" /></div>
            </div>
          )}
          <span className="form-section-label">Primary Contact</span>
          <div className="form-row-2">
            <div><label>Full Name</label><input className="form-input" value={form.cname} onChange={e=>f('cname')(e.target.value)} /></div>
            <div><label>Email</label><input type="email" className="form-input" value={form.cemail} onChange={e=>f('cemail')(e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save {typeLabel}</button></div>
      </div>
    </div>
  );
}
