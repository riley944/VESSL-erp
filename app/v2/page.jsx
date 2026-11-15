'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SB } from '@/lib/supabase';
import { isStaffEmail } from '@/lib/access';
import { MLogin } from '@/app/m/MLogin';
import s from './v2.module.css';

export default function V2Page() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    SB.auth.getSession().then(({ data: { session: current } }) => setSession(current || null));
    const { data: { subscription } } = SB.auth.onAuthStateChange((_event, current) => setSession(current || null));
    return () => subscription.unsubscribe();
  }, []);

  const email = session?.user?.email || '';
  useEffect(() => {
    if (!isStaffEmail(email)) return;
    let active = true;
    SB.from('staff_profiles').select('email,full_name').ilike('email', email).then(({ data, error }) => {
      if (!active) return;
      const row = (data || []).find((item) => (item.email || '').toLowerCase() === email.toLowerCase());
      setProfile({ email, row: row || null, error });
    });
    return () => { active = false; };
  }, [email]);

  if (session === undefined) return <Status>Loading…</Status>;
  if (!session) return <MLogin />;
  if (!isStaffEmail(email)) {
    return <Status title="This is a client account" signOut>{email} is signed in. Sign out and use your King Universal staff account.</Status>;
  }
  if (!profile || profile.email !== email) return <Status>Loading…</Status>;
  if (profile.error) {
    return <Status title="Unable to load your staff profile" signOut>Please try again later.</Status>;
  }
  if (!profile.row) {
    return <Status title="No staff access yet" signOut>{email} has no staff profile in VESSL. Ask Matt to add one.</Status>;
  }

  return (
    <div className={s.root}>
      <header className={s.header}>
        <span className={s.brand}>VESSL <span className={s.badge}>V2 preview</span></span>
        <div className={s.account}>
          <span>{profile.row.full_name || email}</span>
          <button type="button" onClick={() => SB.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <main className={s.main}>
        <p className={s.eyebrow}>VESSL V2</p>
        <h1>Welcome{profile.row.full_name ? `, ${profile.row.full_name}` : ''}.</h1>
        <p className={s.description}>This is the starting point for the new VESSL home page.</p>
        <Link className={s.link} href="/">Return to VESSL</Link>
      </main>
    </div>
  );
}

function Status({ title, children, signOut = false }) {
  return (
    <div className={s.root}>
      <main className={s.status}>
        {title && <h1>{title}</h1>}
        <p>{children}</p>
        {signOut && <button type="button" onClick={() => SB.auth.signOut()}>Sign out</button>}
      </main>
    </div>
  );
}
