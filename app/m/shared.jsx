'use client';
import { useState } from 'react';
import { buildExportFiles } from '@/lib/recordExport';
import { shareFiles } from '@/lib/shareFile';
import s from './m.module.css';

// ── PIECES THE IPAD VIEW'S ORDER TABS SHARE ─────────────────────────────────
// A label and value that wrap; a status pill in the desktop badge's colours; a
// date; the per-card export (lib/recordExport.js, the desktop's own files) to
// the share sheet; and the bar offering a file again when Safari refused it.

export function Field({ label, num = false, wide = false, children }) {
  return (
    <div className={s.field2} style={wide ? { gridColumn: '1 / -1' } : undefined}>
      <div className={s.fLabel}>{label}</div>
      <div className={num ? s.fValue + ' ' + s.num : s.fValue}>{children}</div>
    </div>
  );
}

// tone: { label, color, bg } as SO_SM / PO_STATUS hold them.
export function Pill({ tone }) {
  return <span className={s.pill} style={{ color: tone.color || '#5b6478', background: tone.bg || '#eef0f4' }}>{tone.label}</span>;
}

// "Oct 23, 2026". A date-only value is read at midday, so no time zone moves
// it to the day before.
export const dateText = (v) => {
  if (!v) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export const money2 = (n, cur = 'USD') => (n == null || !isFinite(Number(n)) ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur || 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n)));

// One card's Export PDF / CSV / XLSX. build() returns the desktop's `out`
// ({ sheets, xlsxName, csvName, pdfMeta }). The PDF page opens in a window
// taken on the tap (before anything is awaited, or Safari blocks it) and
// prints itself, as on the desktop; Excel and CSV go to the share sheet, or
// download. onPending(files) when Safari refused the share sheet.
export function useCardExport(build, onPending) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const run = async (fmt) => {
    if (busy) return;
    setMsg('');
    let win = null;
    if (fmt === 'pdf') {
      win = window.open('', '_blank');
      if (!win) { setMsg('The PDF opens in a new window. Allow pop-ups for this site and try again.'); return; }
      win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Preparing the PDF…</body>');
    }
    setBusy(fmt);
    try {
      const out = build();
      if (fmt === 'pdf') {
        const { html } = await buildExportFiles('pdf', out);
        win.document.open(); win.document.write(html); win.document.close();
        setTimeout(() => { try { win.focus(); win.print(); } catch (e) { /* the page is open either way */ } }, 900);
      } else {
        const { files } = await buildExportFiles(fmt, out);
        const how = await shareFiles(files);
        if (how === 'needs-tap') onPending(files);
        else if (how === 'downloaded') setMsg('Downloaded ' + files.map((f) => f.name).join(', ') + '.');
      }
    } catch (e) {
      if (win) { try { win.close(); } catch (x) { /* already closed */ } }
      setMsg('Could not build the export — ' + ((e && e.message) || e));
    }
    setBusy('');
  };
  return { busy, msg, run };
}

export function ExportButtons({ ex }) {
  return (
    <>
      <div className={s.actions}>
        {[['pdf', 'Export PDF'], ['csv', 'Export CSV'], ['xlsx', 'Export XLSX']].map(([k, label]) => (
          <button key={k} type="button" className={s.btn} disabled={!!ex.busy} onClick={() => ex.run(k)}>{ex.busy === k ? 'Building…' : label}</button>
        ))}
      </div>
      {ex.msg && <div className={ex.msg.startsWith('Could not') || ex.msg.startsWith('The PDF') ? s.err : s.note}>{ex.msg}</div>}
    </>
  );
}

// The files Safari would not share inside the first tap, offered on a fresh one.
export function ReadyBar({ pending, setPending }) {
  if (!pending || !pending.length) return null;
  return (
    <div className={s.ready} role="status">
      <span style={{ flex: '1 1 200px' }}>Ready: {pending.map((f) => f.name).join(', ')}</span>
      <button type="button" className={s.btn} onClick={async () => { const p = pending; setPending(null); const how = await shareFiles(p); if (how === 'needs-tap') setPending(p); }}>Share</button>
      <button type="button" className={s.btn} style={{ background: 'transparent', color: '#ffffff' }} onClick={() => setPending(null)}>Dismiss</button>
    </div>
  );
}

// The tab's filter row: a dropdown (all, or one) and a search box.
export function Filters({ label, allLabel, options, value, onValue, term, onTerm, placeholder }) {
  return (
    <div className={s.controls}>
      <select className={s.select} aria-label={label} value={value} onChange={(e) => onValue(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <input className={s.search} type="search" aria-label={'Search ' + label.toLowerCase()} placeholder={placeholder}
        value={term} onChange={(e) => onTerm(e.target.value)} />
    </div>
  );
}

export function Count({ shown, total, noun }) {
  return <div className={s.meta} style={{ marginBottom: 10 }}>{shown === total ? total + ' ' + noun : shown + ' of ' + total + ' ' + noun}</div>;
}
