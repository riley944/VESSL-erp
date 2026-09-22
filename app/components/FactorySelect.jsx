'use client';
import { useState, useEffect, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { SB } from '@/lib/supabase';
import { matches, normalizeTerm } from '@/lib/textFilter';

// ── FactorySelect ────────────────────────────────────────────────────────────
// A closed combobox over the factory companies. Typing filters; only choosing a
// row commits. Free text is no longer a way to name a factory on a quote, which
// is what stops the next UPM -- a company invented by typing a short name into a
// box that never checked whether it already existed.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STRUCTURAL RULE — the same one HtsField carries, for the same reason.       │
// │                                                                             │
// │ The control renders `value` DIRECTLY. Nothing derives its displayed value   │
// │ from `companies`.                                                           │
// │                                                                             │
// │ 52 quotes hold a factory name that matches no company row -- 44 on a        │
// │ spelling of Liaoning without the space after the comma, 7 on "Aung crown"   │
// │ with a small c, 1 on "Baoquan". A <select value={value}> with no matching   │
// │ <option> renders BLANK, and saving from there writes the blank over the     │
// │ only record of who made the goods. Script 71 re-points those 52, and this   │
// │ rule is what keeps the next unmatched name visible rather than erased.      │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Style-agnostic by prop, as HtsField is: the quote form styles with its inline S
// object and hands those in. Only the picker chrome is owned here.

const panelStyle = { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30, marginTop: 4, background: '#ffffff', border: '1px solid #e7eaf0', borderRadius: 12, boxShadow: '0 10px 30px rgba(15,23,41,0.16)', padding: 8 };
const optionStyle = { display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', padding: '8px 9px', borderRadius: 8, fontSize: 13.5, color: '#0f1729', cursor: 'pointer' };
const addBtnStyle = { display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', marginTop: 6, background: '#eef1f6', color: '#3461e0', border: 'none', borderRadius: 9, padding: '9px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer' };
const clearBtnStyle = { background: 'transparent', border: 'none', color: '#6a7488', display: 'inline-flex', padding: 2 };
const filterStyle = { border: '1px solid #e7eaf0', background: '#ffffff', borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#0f1729', width: '100%', marginBottom: 6 };

export const sameName = (a, b) =>
  String(a == null ? '' : a).trim().toLowerCase() === String(b == null ? '' : b).trim().toLowerCase();

// ── THE FACTORY DIRECTORY, FETCHED ONCE PER HOST ────────────────────────────
// Three reads, because the fill needs three different things and one of them is
// not where you would expect.
//
//   companies -- type factory, the list the select offers.
//   contacts  -- vessl.contacts, NOT the client_contacts prop the quote form
//                already carries. That prop is the quotes-side CLIENT directory
//                and holds nothing about factories at all. Using it would have
//                filled the factory contact from a list of buyers.
//   presets   -- factory_presets, which is the only place country and lead time
//                are recorded. companies has no column for either.
//
// addCompany takes the row CreateCompanyModal hands back, so selecting a
// just-created factory does not wait for a refetch to find it.
export function useFactoryCompanies() {
  const [state, setState] = useState({ companies: [], contacts: [], presets: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      SB.from('companies').select('id,name,email,phone').eq('type', 'factory').order('name'),
      SB.from('contacts').select('id,company_id,full_name,email,phone,is_primary'),
      SB.from('factory_presets').select('factory,factory_contact,factory_email,factory_phone,country,lead_time'),
    ]).then(([c, ct, p]) => {
      if (!alive) return;
      // On error the piece that failed stays empty and the control still renders
      // whatever is stored -- the structural rule means a failed fetch costs the
      // picker, never the value.
      setState({
        companies: (!c.error && c.data) || [],
        contacts: (!ct.error && ct.data) || [],
        presets: (!p.error && p.data) || [],
      });
    });
    return () => { alive = false; };
  }, []);
  const addCompany = (row) => {
    if (!row) return;
    setState((prev) => ({
      ...prev,
      companies: [...prev.companies, row].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    }));
  };
  return { ...state, addCompany };
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
  const own = contacts
    .filter((c) => c.company_id === (company && company.id))
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
                 || String(a.full_name || '').localeCompare(String(b.full_name || '')));
  return {
    preset,
    contacts: own,
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

export function FactorySelect({
  value,
  companies = [],
  onPick,
  onAddNew,
  label = 'Factory',
  panelMaxHeight = 240,
  fieldStyle,
  labelStyle,
  inputStyle,
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const q = normalizeTerm(typed);
  const hits = useMemo(
    () => (!q ? companies : companies.filter((c) => matches(q, c.name, c.email))),
    [companies, q]
  );
  // Display only. Never feeds the value -- see the rule above.
  const known = value ? companies.find((c) => sameName(c.name, value)) || null : null;
  const unlisted = !!value && !known;
  const commit = (company) => {
    setTyped('');
    setOpen(false);
    onPick(company);
  };

  return (
    <label style={{ ...fieldStyle, position: 'relative' }}>
      <span style={labelStyle}>{label}</span>

      {/* The committed value, rendered straight from `value` whether or not the
          directory knows it. Clicking opens the picker; it never rewrites itself. */}
      <div onClick={() => setOpen((v) => !v)}
        style={{ ...inputStyle, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', minHeight: 40 }}>
        <span style={{ flex: 1, minWidth: 0, color: value ? '#0f1729' : '#9aa3b5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {value ? value : 'Select a factory'}
        </span>
        {value && <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); commit(null); }} style={clearBtnStyle}><X size={13} /></button>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
      </div>

      {/* Not an error. The name is what the quote has always said and stays
          exactly as stored; it simply has no company row to hang on yet. */}
      {unlisted && <span style={{ fontSize: 11.5, color: '#c2683a', marginTop: 4 }}>Not in the company directory — still saved as is.</span>}

      {open && (
        <div style={panelStyle}>
          {/* data-noguard: typing here is NAVIGATION, not input. It filters and
              commits nothing, so the modal dirty guard must not count it as an
              edit -- otherwise hunting for a factory and closing the panel asks
              to discard changes nobody made. */}
          <input autoFocus data-noguard value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setTyped(''); } if (e.key === 'Enter') { e.preventDefault(); if (hits.length === 1) commit(hits[0]); } }}
            placeholder="Filter by name…" style={filterStyle} />
          <div style={{ maxHeight: panelMaxHeight, overflowY: 'auto' }}>
            {hits.length === 0 && <div style={{ padding: '10px 8px', fontSize: 13, color: '#6a7488' }}>No factories match “{typed.trim()}”.</div>}
            {hits.map((c) => (
              <button key={c.id} type="button" onClick={() => commit(c)} style={optionStyle}>
                <span style={{ fontWeight: 600 }}>{c.name}</span>
                {c.email && <span style={{ color: '#6a7488', marginLeft: 8 }}>{c.email}</span>}
              </button>
            ))}
          </div>
          {/* Fires the host rather than rendering CreateCompanyModal here.
              CreateCompanyModal is a fixed-position overlay and .modal-body is a
              scroll container; nesting one inside the other is the arrangement
              HtsField avoids for CodeModal, for the same reason. */}
          <button type="button" onClick={() => { setOpen(false); onAddNew(typed.trim()); }} style={addBtnStyle}>
            <Plus size={13} /> Add new factory{q ? ' “' + typed.trim() + '”' : '…'}
          </button>
        </div>
      )}
    </label>
  );
}

// ── WHICH CONTACT IS THIS QUOTE FOR ─────────────────────────────────────────
// Only ever shown when a company has MORE THAN ONE contact. One contact fills
// silently -- asking a question with a single answer is a click that teaches
// nobody anything -- and none falls back to the preset without asking either.
//
// One company has several contacts today, so this is rare by design rather than
// by accident, and it stays correct as the directory fills out.
export function ContactPickModal({ company, contacts = [], onPick, onClose }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} style={{ zIndex: 400 }}>
      <div className="modal-box" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Which contact?</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '12px', lineHeight: 1.5 }}>
            {(company && company.name) || 'This factory'} has {contacts.length} contacts. Pick the one this quote is with — the
            other fields fill from them and stay editable.
          </div>
          {contacts.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: '#fff', border: '1px solid #ECECEE',
                       borderRadius: 10, padding: '10px 12px', marginBottom: 8, cursor: 'pointer', fontFamily: 'inherit' }}>
              <div style={{ fontSize: '13.5px', fontWeight: 600, color: '#1D1D1F' }}>
                {c.full_name || 'Unnamed'}
                {c.is_primary && <span style={{ fontSize: '10px', color: '#3461e0', fontFamily: 'var(--mono)', marginLeft: 7 }}>· PRIMARY</span>}
              </div>
              <div style={{ fontSize: '12px', color: '#6a7488', marginTop: 2 }}>
                {[c.email, c.phone].filter(Boolean).join('  ·  ') || 'no details'}
              </div>
            </button>
          ))}
        </div>
        {/* Skipping is a real answer: the quote is with the factory, not
            necessarily with any one person on this list. */}
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => onPick(null)}>Leave blank</button>
        </div>
      </div>
    </div>
  );
}
