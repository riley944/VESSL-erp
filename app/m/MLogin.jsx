'use client';
import { useState } from 'react';
import { SB } from '@/lib/supabase';
import s from './m.module.css';

// Sign in for the iPad view: the desktop Login's two Supabase calls
// (app/page.jsx) -- signInWithPassword, and resetPasswordForEmail, whose link
// lands on the desktop's reset page as it always has.
//
// It looks like the desktop Login because it is built from the desktop's own
// classes (login-wrap, login-card, login-sub, login-field, btn-login,
// login-alt, login-note, login-error in globals.css), so the navy, the grid,
// the card and the type are the desktop's values, not copies. The s.login*
// classes on top only add the iPad rules: 16px inputs, 44px tap targets, the
// safe-area insets and a 420px card that fits a phone.
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
  const swap = (to) => { setMode(to); setErr(''); setNote(''); };

  return (
    <div className={'login-wrap ' + s.loginWrap}>
      <form className={'login-card ' + s.loginCard} onSubmit={mode === 'signin' ? signIn : sendReset}>
        <div className="login-mark">
          <img className="login-logo-img" src="/logo.png" alt="King Universal" />
        </div>
        <div className="login-sub">{mode === 'signin' ? 'Operations Platform · Sign in' : 'Operations Platform · Reset password'}</div>
        <input className={'login-field ' + s.loginField} type="email" autoComplete="username" inputMode="email" aria-label="Email"
          placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode === 'signin' ? (
          <>
            <input className={'login-field ' + s.loginField} type="password" autoComplete="current-password" aria-label="Password"
              placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
            <button type="submit" className={'btn-login ' + s.loginBtn} disabled={busy}>{busy ? 'Signing in…' : 'Sign In'}</button>
            <button type="button" className={'login-alt ' + s.loginAlt} onClick={() => swap('forgot')}>Forgot password?</button>
          </>
        ) : (
          <>
            <button type="submit" className={'btn-login ' + s.loginBtn} disabled={busy || !email.trim()}>{busy ? 'Sending…' : 'Send reset link'}</button>
            <button type="button" className={'login-alt ' + s.loginAlt} onClick={() => swap('signin')}>← Back to sign in</button>
          </>
        )}
        <div className="login-note">{note}</div>
        <div className="login-error">{err}</div>
      </form>
    </div>
  );
}
