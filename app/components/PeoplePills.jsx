'use client';

// ── PeoplePills ──────────────────────────────────────────────────────────────
// Pick any number of people by name. Each pill toggles; value is the list of
// emails picked, in the order they were picked. The look is the global
// filter-btn / filter-btn active classes, so every people picker reads as one
// control. aria-pressed says which are on.
//
// showAll adds an All pill in front. It is a shortcut, not a state of its own:
// pressing it picks everyone (in list order), and it shows as on whenever
// everyone is picked; pressing it then clears them all. Nothing is picked until
// somebody presses something.
//
// people: [{ email, name }]. label: the group's accessible name.
export function PeoplePills({ people = [], value = [], onChange, disabled = false, label = 'People', showAll = false }) {
  const on = email => value.includes(email);
  const toggle = email => onChange(on(email) ? value.filter(e => e !== email) : [...value, email]);
  const everyone = people.length > 0 && people.every(p => on(p.email));
  return (
    <div className="filters" role="group" aria-label={label} style={{ flexWrap:'wrap', gap:'6px' }}>
      {showAll && (
        <button type="button" className={'filter-btn' + (everyone ? ' active' : '')} aria-pressed={everyone}
          disabled={disabled || !people.length} onClick={() => onChange(everyone ? [] : people.map(p => p.email))}>
          All
        </button>
      )}
      {people.map(p => (
        <button key={p.email} type="button" className={'filter-btn' + (on(p.email) ? ' active' : '')}
          aria-pressed={on(p.email)} disabled={disabled} onClick={() => toggle(p.email)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}
