'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';
import s from './m.module.css';

// Sign in for the iPad view: the desktop Login's two Supabase calls
// (app/page.jsx) -- signInWithPassword, and resetPasswordForEmail, whose link
// lands on the desktop's reset page as it always has. Plain divs for the
// captions: globals.css styles every <label> as the small uppercase field label.
export function MLogin() {
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [mode, setMode] = useState('signin');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (e) => {
    if (e) e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await SB.auth.signInWithPassword({ email, password: pass });
    setBusy(false);
    if (error) setErr(error.message);
  };
  const sendReset = async (e) => {
    if (e) e.preventDefault();
    setErr(''); setNote(''); setBusy(true);
    const { error } = await SB.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    setBusy(false);
    if (error) setErr(error.message);
    else setNote('If that email has an account, a reset link is on its way. Check your inbox.');
  };

  return (
    <div className={s.center}>
      <form className={s.panel} onSubmit={mode === 'signin' ? signIn : sendReset}>
        <img src="/logo.png" alt="King Universal" style={{ height: 34, width: 'auto', display: 'block', marginBottom: 10 }} />
        <div className={s.meta} style={{ marginBottom: 6 }}>{mode === 'signin' ? 'Sign in' : 'Reset password'}</div>
        <input className={s.field} type="email" autoComplete="username" inputMode="email" aria-label="Email" placeholder="Email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode === 'signin' && (
          <input className={s.field} type="password" autoComplete="current-password" aria-label="Password" placeholder="Password"
            value={pass} onChange={(e) => setPass(e.target.value)} />
        )}
        <button type="submit" className={s.btn + ' ' + s.btnDark} disabled={busy || !email.trim() || (mode === 'signin' && !pass)}>
          {mode === 'signin' ? (busy ? 'Signing in…' : 'Sign in') : (busy ? 'Sending…' : 'Send reset link')}
        </button>
        <button type="button" className={s.linkBtn} onClick={() => { setMode(mode === 'signin' ? 'forgot' : 'signin'); setErr(''); setNote(''); }}>
          {mode === 'signin' ? 'Forgot password?' : '← Back to sign in'}
        </button>
        {note && <div className={s.note}>{note}</div>}
        {err && <div className={s.err}>{err}</div>}
      </form>
    </div>
  );
}
