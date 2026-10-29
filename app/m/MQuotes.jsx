'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { SB } from '@/lib/supabase';
import { rowToForm } from '@/lib/quoteRow';
import { fmt, moldFeeText, pricedState, NO_PRICE_TEXT, SOME_UNPRICED_TEXT } from '@/lib/quoteFigures';
import { htsRateFor } from '@/lib/quoteTiers';
import { personName } from '@/lib/people';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { sheetHeader, sheetEdits, sheetModel, sheetBaseName, sheetLogo, sheetFile } from '@/lib/clientSheetExport';
import { shareOrDownload } from '@/lib/shareFile';
import { useHtsCodes } from '@/app/components/HtsField';
import { TierCards } from '@/app/components/TierCards';
import { SendToClientModal } from '@/app/quotes';
import s from './m.module.css';

// ── QUOTES ON THE IPAD ──────────────────────────────────────────────────────
// Every quote, newest first, read through the desktop's rowToForm. The client
// dropdown and a search narrow it;
// a card opens in place to the details, one column, and the tiers as cards
// (TierCards, touch). Each card exports the client price sheet for that one
// quote -- the same sheet Send to Client builds for one quote, DDP only
// (lib/clientSheetExport.js) -- as PDF, CSV or Excel, and opens Send to Client
// on its client with it ticked. Files go to the iPad share sheet where the
// browser can (lib/shareFile.js), else download.
const UNASSIGNED = 'Unassigned';
const clientOf = (q) => (q.client || '').trim() || UNASSIGNED;
const day = (iso) => {
  const d = iso ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + 'T12:00:00' : iso) : null;
  return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
};

export function MQuotes({ email, me }) {
  const [quotes, setQuotes] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState(null);
  const [client, setClient] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [sendFor, setSendFor] = useState(null);     // the quote whose Send to Client is open
  const [pending, setPending] = useState(null);     // { blob, filename } waiting for a Share tap
  const { codes } = useHtsCodes();

  const load = useCallback(async () => {
    const { data, error } = await SB.from('quotes').select('*').order('created_at', { ascending: false });
    if (error) { setLoadErr('Could not load quotes: ' + error.message); return; }
    setLoadErr('');
    setQuotes((data || []).map((r) => ({ ...rowToForm(r), createdAt: r.created_at || '' })));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    SB.from('staff_profiles').select('email,full_name,job_title').then(({ data }) => setStaff(data || []));
    // The sheet's sign-off company, as the desktop settings step reads it.
    SB.from('kui_settings').select('company_name').eq('id', 1).single().then(({ data }) => setSettings(data || {}), () => setSettings({}));
  }, []);

  // Clients: every one, by name, for the dropdown.
  const clientNames = useMemo(() => [...new Set((quotes || []).map(clientOf))].sort((a, b) => a.localeCompare(b)), [quotes]);
  const shown = useMemo(() => {
    const t = normalizeTerm(term);
    return (quotes || []).filter((q) => (!client || clientOf(q) === client)
      && (!t || matches(t, q.sku, q.product, q.client, q.factory, q.quoteCode, q.clientDetails, q.clientColor)));
  }, [quotes, client, term]);

  // Send to Client wants the quotes by client.
  const byClient = useMemo(() => clientNames.map((name) => ({ name, quotes: (quotes || []).filter((q) => clientOf(q) === name) })), [clientNames, quotes]);

  const deliver = useCallback(async (blob, filename) => {
    const how = await shareOrDownload(blob, filename);
    if (how === 'needs-tap') setPending({ blob, filename });
    return how;
  }, []);

  if (loadErr) return <div className={s.err}>{loadErr}</div>;
  if (!quotes) return <div className={s.meta}>Loading quotes…</div>;

  return (
    <>
      <div className={s.controls}>
        <select className={s.select} aria-label="Client" value={client} onChange={(e) => { setClient(e.target.value); setOpen(null); }}>
          <option value="">All clients ({quotes.length})</option>
          {clientNames.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className={s.search} type="search" aria-label="Search quotes" placeholder="Search SKU, product, client, factory, Q-number"
          value={term} onChange={(e) => setTerm(e.target.value)} />
      </div>
      <div className={s.meta} style={{ marginBottom: 10 }}>{shown.length === quotes.length ? quotes.length + ' quotes' : shown.length + ' of ' + quotes.length + ' quotes'}</div>

      {shown.length === 0
        ? <div className={s.soon}>Nothing matches. Try clearing the search or the client.</div>
        : (
          <div className={s.list}>
            {shown.map((q) => (
              <QuoteCard key={q.id} q={q} open={open === q.id} onToggle={() => setOpen(open === q.id ? null : q.id)}
                staff={staff} me={me} settings={settings} dutyRate={htsRateFor(q.hts, codes)}
                deliver={deliver} onSend={() => setSendFor(q)} />
            ))}
          </div>
        )}

      {pending && (
        <div className={s.ready} role="status">
          <span style={{ flex: '1 1 200px' }}>Ready: {pending.filename}</span>
          <button type="button" className={s.btn} onClick={async () => { const p = pending; setPending(null); await deliver(p.blob, p.filename); }}>Share</button>
          <button type="button" className={s.btn} style={{ background: 'transparent', color: '#ffffff' }} onClick={() => setPending(null)}>Dismiss</button>
        </div>
      )}

      {sendFor && (
        <SendToClientModal clients={byClient} staff={staff} userEmail={email} onSaved={load} onClose={() => setSendFor(null)}
          deliver={deliver} initialClient={clientOf(sendFor)} initialPicked={[sendFor.id]} touch />
      )}
    </>
  );
}

// ── One quote ───────────────────────────────────────────────────────────────
function QuoteCard({ q, open, onToggle, staff, me, settings, dutyRate, deliver, onSend }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const ps = pricedState(q);
  const status = !(q.tiers || []).length ? ['No tiers', s.pillNone]
    : ps.none ? [NO_PRICE_TEXT, s.pillNone]
    : ps.some ? [SOME_UNPRICED_TEXT, s.pillWarn]
    : ['Priced', s.pillOk];
  const who = q.updatedBy ? personName(staff, q.updatedBy).split(' ')[0] : '';

  // The client price sheet for this one quote: the header, Item / Details /
  // Color and the files exactly as Send to Client makes them for one quote.
  const exportAs = async (fmtKey) => {
    if (busy) return;
    setMsg('');
    // The PDF page opens on the tap, before any wait, or Safari blocks it.
    let win = null;
    if (fmtKey === 'pdf') {
      win = window.open('', '_blank');
      if (!win) { setMsg('The PDF opens in a new window. Allow pop-ups for this site and try again.'); return; }
      win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Preparing the sheet…</body>');
    }
    setBusy(fmtKey);
    try {
      const header = sheetHeader({ client: clientOf(q) === UNASSIGNED ? '' : q.client, settings, me });
      const model = sheetModel({ quotes: [q], edits: sheetEdits([q]), header, payment: null });
      const { logoSrc, logoSize } = fmtKey === 'csv' ? { logoSrc: '', logoSize: null } : await sheetLogo();
      const out = await sheetFile({ fmt: fmtKey, model, logoSrc, logoSize, base: sheetBaseName(q.client) });
      if (out.blob) {
        const how = await deliver(out.blob, out.filename);
        if (how === 'downloaded') setMsg('Downloaded ' + out.filename + '.');
      } else if (win) {
        win.document.open(); win.document.write(out.html); win.document.close();
      }
    } catch (e) {
      if (win) { try { win.close(); } catch (x) { /* already closed */ } }
      setMsg('Could not build the sheet — ' + ((e && e.message) || e));
    }
    setBusy('');
  };

  const cartonDims = [q.cartonL, q.cartonW, q.cartonH].every((v) => v !== '' && v != null) ? q.cartonL + ' × ' + q.cartonW + ' × ' + q.cartonH + ' cm' : '';
  const details = [
    ['Factory', q.factory],
    ['Country', q.country],
    ['Lead time', q.leadTime],
    ['HTS code', q.hts],
    ['Quote date', day(q.quoteDate)],
    ['Mold fee', moldFeeText(q)],
    ['Sample fee', Number(q.sampleFee) > 0 ? '$' + fmt(q.sampleFee) : ''],
    ['Details', q.clientDetails],
    ['Colour', q.clientColor],
    ['Units per carton', q.unitsPerCarton !== '' && q.unitsPerCarton != null ? String(q.unitsPerCarton) : ''],
    ['Carton', cartonDims],
    ['Carton weight', q.cartonWeight !== '' && q.cartonWeight != null ? q.cartonWeight + ' kg' : ''],
    ['Notes', q.notes],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  return (
    <div className={s.card + (open ? ' ' + s.cardOpen : '')}>
      <button type="button" className={s.cardHead} aria-expanded={open} onClick={onToggle}>
        <div className={s.client}>{clientOf(q)}</div>
        <div className={s.product}>{q.product || 'No product name'}</div>
        <div className={s.sub}>{[q.sku || 'No SKU', q.quoteCode].filter(Boolean).join(' · ')}</div>
        <div className={s.row}>
          <span className={s.pill + ' ' + status[1]}>{status[0]}</span>
          {q.createdAt && <span className={s.meta}>Created {day(q.createdAt)}</span>}
          {q.updatedAt && <span className={s.meta}>Updated {day(q.updatedAt)}{who ? ' by ' + who : ''}</span>}
        </div>
      </button>
      {open && (
        <div className={s.body}>
          {details.length > 0 && (
            <div className={s.details}>
              {details.map(([label, value]) => (
                <div key={label}>
                  <div className={s.dLabel}>{label}</div>
                  <div className={s.dValue}>{value}</div>
                </div>
              ))}
            </div>
          )}
          <div className={s.section}>Tiered pricing</div>
          <TierCards q={q} dutyRate={dutyRate} variant="touch" />
          <div className={s.actions}>
            <button type="button" className={s.btn} disabled={!!busy} onClick={() => exportAs('pdf')}>{busy === 'pdf' ? 'Building…' : 'Export PDF'}</button>
            <button type="button" className={s.btn} disabled={!!busy} onClick={() => exportAs('csv')}>{busy === 'csv' ? 'Building…' : 'Export CSV'}</button>
            <button type="button" className={s.btn} disabled={!!busy} onClick={() => exportAs('xlsx')}>{busy === 'xlsx' ? 'Building…' : 'Export XLSX'}</button>
            <button type="button" className={s.btn + ' ' + s.btnDark} disabled={!!busy} onClick={onSend}>Send to Client</button>
          </div>
          <div className={s.note}>Exports are the client price sheet for this quote: delivered (DDP) prices only.</div>
          {msg && <div className={msg.startsWith('Could not') || msg.startsWith('The PDF') ? s.err : s.note}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
