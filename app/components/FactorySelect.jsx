'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';
import { CompanySelect, useCompanyDirectory, contactsOf, sameName } from '@/app/components/CompanySelect';

// ── The factory side of CompanySelect ────────────────────────────────────────
// Everything structural moved to CompanySelect when the client box needed the
// same control: the combobox, the directory fetch, the contact popup, and the
// rule that the stored value renders directly whether or not the directory knows
// it. What is left here is what is genuinely about factories.
//
// THE EXPORTS AND THEIR PROPS ARE UNCHANGED. FactorySelect, useFactoryCompanies,
// factoryFillFor, contactFieldsFrom, ContactPickModal and sameName all still
// exist with the same shapes, so no factory call site moved. That is deliberate:
// the generalisation is supposed to be invisible from the factory side, and
// keeping the surface identical is what makes that checkable rather than hoped
// for.
export { ContactPickModal, sameName } from '@/app/components/CompanySelect';

// ── THE FACTORY DIRECTORY ───────────────────────────────────────────────────
// The shared directory plus the one table only factories have.
//
// factory_presets is where country and lead time live -- companies has no column
// for either, which is why the presets outlived the saved-factory chips. It is
// fetched here rather than in useCompanyDirectory because the client side has no
// equivalent and should not pay for a read it never uses.
export function useFactoryCompanies() {
  const { companies, contacts, addCompany } = useCompanyDirectory('factory');
  const [presets, setPresets] = useState([]);
  useEffect(() => {
    let alive = true;
    SB.from('factory_presets')
      .select('factory,factory_contact,factory_email,factory_phone,country,lead_time')
      .then(({ data, error }) => { if (alive && !error && data) setPresets(data); });
    return () => { alive = false; };
  }, []);
  return { companies, contacts, presets, addCompany };
}

// Everything the host needs to fill five fields for one company, worked out in
// one place so the select and the contact popup cannot disagree about what a
// selection means.
//
// CONTACTS FIRST, PRESET SECOND. A contact row is a person somebody entered
// against this company; the preset's contact fields are older free text that came
// off a quote. When both exist the structured one wins.
export function factoryFillFor(company, { contacts = [], presets = [] } = {}) {
  const preset = presets.find((p) => sameName(p.factory, company && company.name)) || null;
  return {
    preset,
    contacts: contactsOf(company, contacts),
    // country and lead time only ever come from the preset -- companies has no
    // column for either, which is why factory_presets outlived the chips.
    country: (preset && preset.country) || '',
    leadTime: (preset && preset.lead_time) || '',
  };
}

// The three contact fields for one chosen contact, or for the preset when the
// company has no contact rows at all.
export function contactFieldsFrom(contact, preset, company) {
  if (contact) {
    return {
      factoryContact: contact.full_name || '',
      factoryEmail: contact.email || '',
      factoryPhone: contact.phone || '',
    };
  }
  // NO CONTACT ROWS. Six of the eight factory companies are in this state today,
  // so this fallback is the common case rather than the edge. The company's own
  // email and phone ride along where the preset has none -- they are the same
  // fact recorded in a different column.
  return {
    factoryContact: (preset && preset.factory_contact) || '',
    factoryEmail: (preset && preset.factory_email) || (company && company.email) || '',
    factoryPhone: (preset && preset.factory_phone) || (company && company.phone) || '',
  };
}

// The copy, and nothing else. Every prop passes straight through.
export function FactorySelect(props) {
  return (
    <CompanySelect
      {...props}
      label={props.label || 'Factory'}
      placeholder="Select a factory"
      emptyNoun="factories"
      addLabel="Add new factory"
    />
  );
}
