'use client';

// ── ONE OWNER PICKER, TWO DOORS ─────────────────────────────────────────────
// The tick on the quote form and the Create PLM Card popup both have to ask the same
// question -- who keeps this card -- against the same staff_profiles list the PLM
// card modal offers for reassignment. Two copies of a select would be two places
// for the default to drift, and the default is the part that matters: a card that
// opens owned by the wrong person is worse than one that opens owned by nobody,
// because nobody is visible on the board and wrong is not.
//
// UNOWNED IS A REAL CHOICE, not an absence. programs.owner_id is nullable, the
// board has an Unowned filter with a count, and the card modal offers the same
// empty option -- so this one does too, rather than forcing a name onto a card
// somebody has not decided about yet.
//
// It takes the staff list rather than fetching one. Both hosts already load what
// they need for other reasons, and a component that fetches inside a modal is a
// component that fetches again every time the modal opens.
export function OwnerSelect({ value, onChange, staff = [], disabled = false, style }) {
  return (
    <select
      value={value || ''}
      onChange={e => onChange(e.target.value || null)}
      disabled={disabled}
      style={{
        border: '1px solid rgba(0,0,0,.12)', borderRadius: '9px', padding: '7px 9px',
        fontSize: '13px', fontFamily: 'inherit', background: '#fff', color: '#1D1D1F',
        letterSpacing: 0, textTransform: 'none',
        cursor: disabled ? 'default' : 'pointer', minWidth: '175px',
        ...style,
      }}
    >
      <option value="">Unowned</option>
      {staff.map(s => <option key={s.id} value={s.id}>{s.full_name || s.email}</option>)}
    </select>
  );
}

// ── THE ONE PLACE AN EMAIL BECOMES AN ID ────────────────────────────────────
// Both doors default to the person doing the work, and both of them know an
// EMAIL -- that is what the session carries. programs.owner_id is a key into
// staff_profiles. Somebody with no staff row resolves to null, which is Unowned
// and a state the board shows rather than an error: refusing to open the card
// would punish the quote for a missing profile.
//
// Matched case-insensitively on the trimmed address, the same way createProgram
// matches when it is given an email instead of an id.
export function ownerIdForEmail(staff, email) {
  const e = (email || '').trim().toLowerCase();
  if (!e) return null;
  const hit = (staff || []).find(s => (s.email || '').trim().toLowerCase() === e);
  return hit ? hit.id : null;
}
