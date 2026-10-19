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
