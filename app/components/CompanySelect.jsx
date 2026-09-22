'use client';
import { useState, useEffect, useMemo } from 'react';
import { Plus, X } from 'lucide-react';
import { SB } from '@/lib/supabase';
import { matches, normalizeTerm } from '@/lib/textFilter';

// ── CompanySelect ────────────────────────────────────────────────────────────
// A closed combobox over the companies of one type. Typing filters; only choosing
// a row commits. Free text is not a way to name a company on a quote, which is
// what stops the next UPM -- a firm invented by typing a short name into a box
// that never checked whether it already existed.
//
// GENERALISED FROM FactorySelect rather than copied. The factory side keeps its
// own module, which now holds nothing but the copy and the preset-specific fill;
// everything structural lives here and is shared. A copy would have been two
// places for the rule below to be true in.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STRUCTURAL RULE — the same one HtsField carries, for the same reason.       │
// │                                                                             │
// │ The control renders `value` DIRECTLY. Nothing derives its displayed value   │
// │ from `companies`.                                                           │
// │                                                                             │
// │ A <select value={value}> with no matching <option> renders BLANK, and       │
// │ saving from there writes the blank over the only record of who the quote    │
// │ was with. That is not hypothetical on either side: 52 quotes named a        │
// │ factory no company answered to until script 71 re-pointed them, and 2 name  │
// │ a client that has no company row today. The rule is what keeps the next     │
// │ unmatched name visible rather than erased.                                  │
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

// ── THE DIRECTORY FOR ONE TYPE, FETCHED ONCE PER HOST ───────────────────────
// companies of that type, and vessl.contacts.
//
// vessl.contacts IS THE CONTACT TABLE FOR BOTH SIDES. The quotes-side
// client_contacts table still exists and is still edited from the Directory
// panel, but the quote form no longer reads or writes it -- it is free text
// keyed on a client NAME, which is the shape this whole change is removing.
//
// Contacts are fetched whole rather than filtered by company, because the host
// needs them for whichever company is picked next and a per-pick query would be
// a round trip in the middle of filling a form.
//
// addCompany takes the row CreateCompanyModal hands back, so selecting a
// just-created company does not wait for a refetch to find it.
export function useCompanyDirectory(type) {
  const [state, setState] = useState({ companies: [], contacts: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      SB.from('companies').select('id,name,email,phone,billing_address,shipping_address').eq('type', type).order('name'),
      SB.from('contacts').select('id,company_id,full_name,email,phone,is_primary'),
    ]).then(([c, ct]) => {
      if (!alive) return;
      // On error the piece that failed stays empty and the control still renders
      // whatever is stored -- the structural rule means a failed fetch costs the
      // picker, never the value.
      setState({
        companies: (!c.error && c.data) || [],
        contacts: (!ct.error && ct.data) || [],
      });
    });
    return () => { alive = false; };
  }, [type]);
  const addCompany = (row) => {
    if (!row) return;
    setState((prev) => ({
      ...prev,
      companies: [...prev.companies, row].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    }));
  };
  return { ...state, addCompany };
}

// One company's contacts, primary first then by name. Worked out here so the
// select and the contact popup cannot disagree about who a company's people are.
export function contactsOf(company, contacts = []) {
  return contacts
    .filter((c) => c.company_id === (company && company.id))
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
                 || String(a.full_name || '').localeCompare(String(b.full_name || '')));
}

export function CompanySelect({
  value,
  companies = [],
  onPick,
  onAddNew,
  label = 'Company',
  // The four strings that are not structural. Factory and client pass their own;
  // everything else about this control is identical for both.
  placeholder = 'Select a company',
  emptyNoun = 'companies',
  addLabel = 'Add new company',
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
          {value ? value : placeholder}
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
              edit -- otherwise hunting for a company and closing the panel asks
              to discard changes nobody made. */}
          <input autoFocus data-noguard value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setTyped(''); } if (e.key === 'Enter') { e.preventDefault(); if (hits.length === 1) commit(hits[0]); } }}
            placeholder="Filter by name…" style={filterStyle} />
          <div style={{ maxHeight: panelMaxHeight, overflowY: 'auto' }}>
            {hits.length === 0 && <div style={{ padding: '10px 8px', fontSize: 13, color: '#6a7488' }}>No {emptyNoun} match “{typed.trim()}”.</div>}
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
            <Plus size={13} /> {addLabel}{q ? ' “' + typed.trim() + '”' : '…'}
          </button>
        </div>
      )}
    </label>
  );
}

// ── WHICH CONTACT IS THIS QUOTE FOR ─────────────────────────────────────────
// Only ever shown when a company has MORE THAN ONE contact. One contact fills
// silently -- asking a question with a single answer is a click that teaches
// nobody anything -- and none fills nothing without asking either.
//
// noun is passed so the factory side keeps saying "This factory". Without it a
// client quote would read "This factory has 3 contacts", which is the kind of
// wrong that survives review because the sentence is grammatical.
export function ContactPickModal({ company, contacts = [], onPick, onClose, noun = 'This company' }) {
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()} style={{ zIndex: 400 }}>
      <div className="modal-box" style={{ maxWidth: '420px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Which contact?</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginBottom: '12px', lineHeight: 1.5 }}>
            {(company && company.name) || noun} has {contacts.length} contacts. Pick the one this quote is with — the
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
        {/* Skipping is a real answer: the quote is with the company, not
            necessarily with any one person on this list. */}
        <div className="modal-foot">
          <button className="btn btn-ghost" onClick={() => onPick(null)}>Leave blank</button>
        </div>
      </div>
    </div>
  );
}
