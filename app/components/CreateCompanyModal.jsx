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
const COMPANY_TYPES = [
  ['client',            'Client'],
  ['factory',           'Factory'],
  ['carrier',           'Carrier'],
  ['freight_forwarder', 'Freight Forwarder'],
];

export function CreateCompanyModal({ onClose, onCreated, initialType = 'client' }) {
  // Plain form, every field an input or select. No click-driven setters at all.
  const { ref: cardRef, guardedClose } = useDirtyGuard(onClose);
  // initialType lets a host open this already set to what it is asking for -- the
  // quote form only ever wants a factory, and making somebody pick it from a list
  // of four when the button said "add new factory" is a step that can go wrong.
  const [form, setForm] = useState({name:'',type:initialType,email:'',phone:'',website:'',vendor_number:'',pallet_info:'',billing_address:'',shipping_address:'',cname:'',cemail:'',cphone:''});
  const f = k => v => setForm(prev=>({...prev,[k]:v}));
  const submit = async () => {
    if (!form.name) { alert('Company name required'); return; }
    const { data: co, error } = await SB.from('companies').upsert({name:form.name,type:form.type,email:form.email||null,phone:form.phone||null,website:form.website||null,vendor_number:form.vendor_number||null,pallet_info:form.pallet_info||null,billing_address:form.billing_address||null,shipping_address:form.shipping_address||null},{onConflict:'name,type',ignoreDuplicates:false}).select().single();
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
        <div className="modal-head"><h3>New Company</h3><button className="modal-close" onClick={guardedClose}>×</button></div>
        <div className="modal-body">
          <div className="form-row-2">
            <div><label>Company Name *</label><input className="form-input" value={form.name} onChange={e=>f('name')(e.target.value)} /></div>
            <div><label>Type</label><select className="form-select" value={form.type} onChange={e=>f('type')(e.target.value)}>{COMPANY_TYPES.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <div className="form-row-2">
            <div><label>Email</label><input type="email" className="form-input" value={form.email} onChange={e=>f('email')(e.target.value)} /></div>
            <div><label>Phone</label><input className="form-input" value={form.phone} onChange={e=>f('phone')(e.target.value)} /></div>
          </div>
          <div className="form-row"><label>Website</label><input className="form-input" value={form.website} onChange={e=>f('website')(e.target.value)} placeholder="https://" /></div>
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
        <div className="modal-foot"><button className="btn btn-ghost" onClick={onClose}>Cancel</button><button className="btn btn-dark" onClick={submit}>Save Company</button></div>
      </div>
    </div>
  );
}
