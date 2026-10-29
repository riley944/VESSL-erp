// ── WHO MAY SIGN IN, AND WHAT A ROLE MAY SEE ────────────────────────────
// Moved verbatim from app/page.jsx so the iPad view (app/m) applies the same
// gates as the desktop shell: the staff domain, and the page list of a
// limited role.

// ── Staff domain gate ────────────────────────────────────────────────────────
// orders.vessl.io is staff-only, but kui.vessl.io (the client portal) shares
// this Supabase project and therefore its auth.users pool — so a portal account
// is a valid credential here unless we check the domain ourselves.
// Mirrors portal.is_kui_staff() in Postgres, which is
//   auth.jwt()->>'email' ilike '%@kinguniversal.com'
// so the UI and RLS agree on who counts as staff. Non-string input (null,
// undefined, a missing email claim) short-circuits to false rather than throwing.
export const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

// ── Role-based page access ───────────────────────────────────────────────────
// Only roles listed here are limited, to exactly the page ids they map to.
// Any other role — including no staff_profiles row, or a lookup error — is
// unrestricted and sees every page, exactly as before.
// Pages every role reaches, however limited. Settings is one because what it now
// holds -- your own name, your own password -- belongs to the person, not the job.
// Spread into each limited role rather than special-cased in the `page` fallback
// below, and the difference matters: allowedPages is also what the sidebar filters
// its links against and what supplies the [0] fallback, so it has to stay the
// complete list of what a role may render. An exception written into the fallback
// line would leave those two reading a list that no longer says what it means.
// It cannot surface a nav link: the sidebar filters over `links`, which has never
// had a settings entry -- that button was always separate, and is now gone.
export const UNIVERSAL_PAGES = ['settings'];
// Appended last on purpose, so allowedPages[0] is still 'testing' and a limited
// role landing on a genuinely disallowed page falls back where it always did.
//
// PROGRAMS IS ON THIS LIST, and it is the one page here that is not a list of
// things to check. The PLM board is where a product's stage, its owner and its
// sampling history are kept, and QC work is most of what moves a card off
// Sampling and off Testing -- so the person doing that work could see neither
// the board they were moving nor the notes on it. Granted as a page rather than
// by making the role unrestricted: this list is still the whole of what
// limited_qc may render, and quotes, orders, companies, pricing and banking
// stay off it.
//
// NOT AT POSITION 0, deliberately, whatever else moves around it. allowedPages[0]
// is the fallback a limited role lands on when a hash names a page it may not
// see, and that has always been testing.
//
// LIMITED_OPS (Monica, 19 Oct) is every sidebar page but the orders and the
// numbers: Purchase Orders and Sales Orders (with their detail pages,
// order-detail and so-detail, which are not on the list either) and Analytics.
// Samples first, so a disallowed hash lands where everyone else lands. Company
// Banking is not listed: its own allowlist (COMPANY_TAB_ROLES, admin and staff)
// would refuse it anyway. Pricing ('pricing', PRICING_PAGE below) is listed so
// it appears if PRICING_ENABLED is ever turned on.
//
// A PAGE LIST, NOT A LOCK ON THE DATA. limited_ops is a staff profile, so RLS
// lets it read what staff read -- Inventory, Shipments and Quotes show PO
// details on their own pages, and the API would answer an order query. This
// keeps the order pages out of the way; it does not make orders private.
export const ROLE_PAGES = {
  limited_qc: ['testing', 'products', 'programs', 'shipments', 'codes', ...UNIVERSAL_PAGES],
  limited_ops: ['programs', 'companies', 'products', 'testing', 'pricing', 'shipments', 'inventory', 'quotes', 'codes',
                'client-relations', ...UNIVERSAL_PAGES],
};
// Returns the allowed page ids for a limited role, or null meaning unrestricted.
// hasOwnProperty guard: role is free text, so a value like 'constructor' must
// not pick up an inherited Object.prototype member and read as limited.
export const allowedPagesFor = role =>
  (role && Object.prototype.hasOwnProperty.call(ROLE_PAGES, role)) ? ROLE_PAGES[role] : null;

// ── MONEY IN AN ORDER EXPORT ────────────────────────────────────────────────
// The Sales and Purchase Order exports include prices, costs and margins only
// for these roles. They are the roles that can open those pages today -- every
// other role reaching them would be a change to allowedPagesFor -- and on those
// pages admin and staff see every figure. Anyone else gets the same export with
// every money column and row removed (withoutMoney in lib/ordersExport.js), so
// widening page access later cannot widen what an export reveals by accident.
export const ORDER_MONEY_ROLES = ['admin', 'staff'];
export const canSeeOrderMoney = role => ORDER_MONEY_ROLES.includes(role);
