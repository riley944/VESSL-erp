'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { SB } from '@/lib/supabase';
import { isStaffEmail } from '@/lib/access';
import { MLogin } from '@/app/m/MLogin';
import s from './v2.module.css';
import { navigation, help } from './navigation';
import GlobalSearch from './GlobalSearch';

export default function V2Shell({ children }) {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const hideButtonRef = useRef(null);
  const showButtonRef = useRef(null);
  const focusMenuToggle = useRef(false);
  const pathname = usePathname();

  useEffect(() => {
    try { setHidden(localStorage.getItem('vessl-v2-menu-hidden') === '1'); } catch {}
  }, []);
  useEffect(() => { setMobileOpen(false); }, [pathname]);
  useEffect(() => {
    if (!focusMenuToggle.current) return;
    (hidden ? showButtonRef : hideButtonRef).current?.focus();
    focusMenuToggle.current = false;
  }, [hidden]);
  useEffect(() => {
    const close = event => { if (event.key === 'Escape') setMobileOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  function toggleHidden(value) {
    focusMenuToggle.current = true;
    setHidden(value);
    try { localStorage.setItem('vessl-v2-menu-hidden', value ? '1' : '0'); } catch {}
  }

  useEffect(() => {
    let active = true;
    let authEventSeen = false;
    SB.auth.getSession().then(({ data: { session: current } }) => {
      if (active && !authEventSeen) setSession(current || null);
    });
    const { data: { subscription } } = SB.auth.onAuthStateChange((_event, current) => {
      authEventSeen = true;
      setProfile(previous => previous?.email === current?.user?.email ? previous : null);
      setSession(current || null);
    });
    return () => { active = false; subscription.unsubscribe(); };
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
    <div className={`${s.root} ${s.shell} ${hidden ? s.hidden : ''} ${mobileOpen ? s.mobileOpen : ''}`}>
      <aside className={s.sidebar} id="v2-menu" aria-label="Vessl menu">
        <div className={s.logo}><span className={s.mark} aria-hidden="true">V</span><b className={s.wordmark}>VESSL</b><span className={s.by}>by KUI</span><button ref={hideButtonRef} className={s.hideButton} type="button" aria-label="Hide menu" onClick={() => toggleHidden(true)}><PanelLeftClose size={18} /></button></div>
        <nav aria-label="Main navigation">
          {navigation.map(section => <section key={section.group}><h2 className={s.group}>{section.group}</h2><ul className={s.navList}>{section.items.map(item => <NavItem key={item.slug} item={item} pathname={pathname} close={() => setMobileOpen(false)} />)}</ul></section>)}
        </nav>
        <div className={s.footer}><ul className={s.navList}><NavItem item={help} pathname={pathname} close={() => setMobileOpen(false)} /></ul><div className={s.person}><span className={s.avatar}>{(profile.row.full_name || email).split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><div><b>{profile.row.full_name || email}</b><small>KUI</small></div></div><button className={s.signOut} type="button" onClick={() => SB.auth.signOut()}>Sign out</button></div>
      </aside>
      {mobileOpen && <button className={s.backdrop} aria-label="Close menu" onClick={() => setMobileOpen(false)} />}
      <div className={s.content}>
      <header className={s.header}>
        {hidden && <button ref={showButtonRef} className={s.showButton} type="button" aria-label="Show menu" onClick={() => toggleHidden(false)}><PanelLeftOpen size={18} /></button>}
        <button className={s.mobileButton} type="button" aria-expanded={mobileOpen} aria-controls="v2-menu" onClick={() => setMobileOpen(!mobileOpen)}><Menu size={18} /> Menu</button>
        <GlobalSearch />
        <span className={s.badge}>V2 preview</span>
      </header>
      {children || <main className={s.main}>
        <p className={s.eyebrow}>VESSL V2</p>
        <h1>Welcome{profile.row.full_name ? `, ${profile.row.full_name}` : ''}.</h1>
        <p className={s.description}>This is the starting point for the new VESSL home page.</p>
        <p><Link className={s.link} href="/v2/quotes">View quotes</Link></p>
        <Link className={s.link} href="/">Return to VESSL</Link>
      </main>}
      </div>
    </div>
  );
}

function NavItem({ item, pathname, close }) {
  const href = `/v2/${item.slug}`;
  const current = pathname === href || pathname?.startsWith(`${href}/`);
  const Icon = item.icon;
  return <li className={item.separator ? s.separator : undefined}><Link className={s.navItem} href={href} aria-current={current ? 'page' : undefined} onClick={close}><Icon size={20} strokeWidth={1.7} aria-hidden="true" /><span className={s.navLabel}>{item.label}</span>{item.count != null && <span className={`${s.count} ${s[item.tone]}`} aria-label={`${item.count} need attention (placeholder)`}>{item.count}</span>}</Link></li>;
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
