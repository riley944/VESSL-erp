// ── PEOPLE: names from staff_profiles ───────────────────────────────────────
// Who can be picked on the people pills -- order notes and quote tasks -- is
// every row of vessl.staff_profiles, by full name. These helpers turn those
// rows and the emails picked into words. No imports, so the server route can
// load it too. (This was lib/team.js and its hard-coded TEAM list; the list is
// gone -- staff_profiles is the one source.)
//
// staff: rows of { email, full_name }.

// Names joined for a sentence: "Riley", "Riley & Matt", "Riley, Steven & Matt".
export const joinNames = names => {
  const n = (names || []).filter(Boolean);
  return n.length < 2 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
};

const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

// A person's full name, else the mailbox part of the address.
export const personName = (staff, email) => {
  const p = (staff || []).find(s => same(s.email, email));
  return (p && (p.full_name || '').trim()) || (email || '').split('@')[0];
};

export const peopleNames = (staff, emails) => joinNames((emails || []).map(e => personName(staff, e)));

// The pills' list: { email, name }, by name.
export const peopleFromStaff = staff => (staff || []).filter(s => s.email)
  .map(s => ({ email: s.email, name: personName(staff, s.email) }))
  .sort((a, b) => a.name.localeCompare(b.name));

// Whether a list of emails is everyone on the staff list (the All pill).
export const isEveryone = (staff, emails) => {
  const all = (staff || []).filter(s => s.email);
  return all.length > 0 && all.every(s => (emails || []).some(e => same(e, s.email)));
};
