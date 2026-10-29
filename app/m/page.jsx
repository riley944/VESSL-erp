'use client';
import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { isStaffEmail, allowedPagesFor, canSeeOrderMoney } from '@/lib/access';
import { MLogin } from './MLogin';
import { MQuotes } from './MQuotes';
import { MSalesOrders } from './MSalesOrders';
import { MPurchaseOrders } from './MPurchaseOrders';
import { MShipments } from './MShipments';
import s from './m.module.css';

// ── /m, THE IPAD VIEW ───────────────────────────────────────────────────────
// The same sign-in and the same gates as the desktop shell (app/page.jsx), in
// the same order: a session, an @kinguniversal.com address (isStaffEmail), a
// staff_profiles row, and -- for a limited role -- Quotes on its page list
// (allowedPagesFor; limited_qc has no Quotes, limited_ops does). As on the
// desktop, a profile lookup that errors reads as unrestricted: the data is
// still behind RLS, which is what actually keeps it staff-only.
//
// Four tabs, all read-only. Each is open to the roles that can open its
// desktop page (PAGE_OF: the desktop page id, checked against a limited
// role's list); money in the order tabs follows canSeeOrderMoney, as on the
// desktop. The four fit the bar on one line at iPad portrait (768px) at 15px
// -- measured in Spline Sans 600: 708px of 768 with the bar's spacing in
// m.module.css -- so the labels stay whole.
const TABS = [['quotes', 'Quotes'], ['orders', 'Sales Orders'], ['pos', 'Purchase Orders'], ['shipments', 'Shipments']];
const PAGE_OF = { quotes: 'quotes', orders: 'sales-orders', pos: 'orders', shipments: 'shipments' };

export default function MPage() {
  const [session, setSession] = useState(undefined);   // undefined while loading
  const [profile, setProfile] = useState(undefined);   // undefined loading, null no row
  const [tab, setTab] = useState('quotes');

  useEffect(() => {
    SB.auth.getSession().then(({ data: { session: ses } }) => setSession(ses || null));
    const { data: { subscription } } = SB.auth.onAuthStateChange((_e, ses) => setSession(ses || null));
    return () => subscription.unsubscribe();
  }, []);

  const email = (session && session.user && session.user.email) || '';
  useEffect(() => {
    if (!email || !isStaffEmail(email)) { setProfile(undefined); return; }
    let live = true;
    (async () => {
      try {
        // staff_profiles is itself is_staff()-gated, so no row reads as none.
        const { data, error } = await SB.from('staff_profiles').select('email,role,full_name,job_title').ilike('email', email);
        if (error) throw error;
        const row = (data || []).find((r) => (r.email || '').toLowerCase() === email.toLowerCase()) || null;
        if (live) setProfile(row);
      } catch (e) {
        if (live) setProfile({ email, role: null, full_name: '', job_title: '', lookupFailed: true });
      }
    })();
    return () => { live = false; };
  }, [email]);

  const signOut = () => SB.auth.signOut();

  let content;
  if (session === undefined) content = <div className={s.center}><span className={s.meta}>Loading…</span></div>;
  else if (!session) content = <MLogin />;
  else if (!isStaffEmail(email)) {
    content = (
      <Message title="This is a client account" signOut={signOut}>
        {email} is signed in, but this view is for King Universal staff. Sign out, then sign in with your
        @kinguniversal.com address.
      </Message>
    );
  } else if (profile === undefined) content = <div className={s.center}><span className={s.meta}>Loading…</span></div>;
  else if (profile === null) {
    content = (
      <Message title="No staff access yet" signOut={signOut}>
        {email} has no staff profile in VESSL, so there is nothing to show. Ask Matt to add one.
      </Message>
    );
  } else {
    const allowed = allowedPagesFor(profile.role);
    const can = (id) => !allowed || allowed.includes(PAGE_OF[id]);
    const showMoney = canSeeOrderMoney(profile.role);
    const label = (TABS.find(([id]) => id === tab) || [])[1];
    content = (
      <>
        <header className={s.bar}>
          <img className={s.logo} src="/logo.png" alt="King Universal" />
          <nav className={s.tabs} aria-label="Sections">
            {TABS.map(([id, label]) => (
              <button key={id} type="button" className={s.tab + (tab === id ? ' ' + s.tabOn : '')}
                aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>
            ))}
          </nav>
          <button type="button" className={s.signOut} onClick={signOut}>Sign out</button>
        </header>
        <main className={s.main}>
          {!can(tab) && <div className={s.soon}>{label} is not part of your account&apos;s pages. Ask Matt if you need it.</div>}
          {can(tab) && tab === 'quotes' && <MQuotes email={email} me={profile} />}
          {can(tab) && tab === 'orders' && <MSalesOrders user={session.user} displayName={profile.full_name || ''} showMoney={showMoney} />}
          {can(tab) && tab === 'pos' && <MPurchaseOrders user={session.user} displayName={profile.full_name || ''} showMoney={showMoney} />}
          {can(tab) && tab === 'shipments' && <MShipments user={session.user} displayName={profile.full_name || ''} />}
        </main>
      </>
    );
  }
  return <div className={s.root}>{content}</div>;
}

function Message({ title, children, signOut }) {
  return (
    <div className={s.center}>
      <div className={s.panel}>
        <div style={{ fontSize: 'calc(var(--m-fs) + 3px)', fontWeight: 700, marginBottom: 8 }}>{title}</div>
        <div>{children}</div>
        <button type="button" className={s.btn + ' ' + s.btnDark} onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}
