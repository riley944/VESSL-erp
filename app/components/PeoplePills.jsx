'use client';

// ── PeoplePills ──────────────────────────────────────────────────────────────
// Pick any number of people by name. Each pill toggles; value is the list of
// emails picked, in the order they were picked. The look is the PO notes'
// NOTIFY pills -- the global filter-btn / filter-btn active classes -- so the
// two pickers read as one control. aria-pressed says which are on.
//
// people: [{ email, name }]. label: the group's accessible name.
export function PeoplePills({ people = [], value = [], onChange, disabled = false, label = 'People' }) {
  const on = email => value.includes(email);
  const toggle = email => onChange(on(email) ? value.filter(e => e !== email) : [...value, email]);
  return (
    <div className="filters" role="group" aria-label={label} style={{ flexWrap:'wrap', gap:'6px' }}>
      {people.map(p => (
        <button key={p.email} type="button" className={'filter-btn' + (on(p.email) ? ' active' : '')}
          aria-pressed={on(p.email)} disabled={disabled} onClick={() => toggle(p.email)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}
