// ── THE ORDER-NOTES TEAM ─────────────────────────────────────────────────────
// Who a note on a purchase order can be assigned to, and who "notify team"
// emails. One list for the order page (app/page.jsx) and the server route that
// sends the email (app/api/orders/notify), so the route only ever mails someone
// the page could have offered. No imports, so the server can load it.
export const TEAM = [
  { name:'Kristy',  email:'kristy@kinguniversal.com' },
  { name:'Loren',   email:'loren@kinguniversal.com' },
  { name:'Riley',   email:'riley@kinguniversal.com' },
  { name:'Steven',  email:'steven@kinguniversal.com' },
  { name:'Carmela', email:'carmela@kinguniversal.com' },
  { name:'Matt',    email:'mattdillon@kinguniversal.com' },
];

// A team member's name, else the mailbox part of the address.
export const teamName = email => {
  const e = (email || '').trim().toLowerCase();
  const m = TEAM.find(x => x.email.toLowerCase() === e);
  return m ? m.name : (email || '').split('@')[0];
};

// Names joined for a sentence: "Riley", "Riley & Matt", "Riley, Steven & Matt".
export const teamNames = emails => {
  const n = (emails || []).map(teamName).filter(Boolean);
  return n.length < 2 ? (n[0] || '') : n.slice(0, -1).join(', ') + ' & ' + n[n.length - 1];
};
