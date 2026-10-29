'use client';
import { useEffect, useMemo, useState } from 'react';
import { fmt } from '@/lib/lifecycle';
import { loadBoardData, buildBuckets, enrichRows, tileFacts, MANUAL_STAGES, HEALTH, BLOCKERS, accentOf, stageLabel,
         roundText, sourceQuoteOf } from '@/lib/plmBoard';
import { fetchCardNotes, cardGroups, stampText, cardLogo, cardFileHtml, cardFileXlsx, cardFileCsv } from '@/lib/plmFiles';
import { loadExcelJS } from '@/lib/excel';
import { shareFiles } from '@/lib/shareFile';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { TestingTab } from '@/app/components/PlmTestingTab';
import { Field, Pill, ReadyBar, Filters, Count } from './shared';
import s from './m.module.css';

// ── SAMPLES (THE PLM BOARD) ON THE IPAD ─────────────────────────────────────
// Read-only: no stage moves, no editing, no new cards. The desktop board's own
// load and derivation (lib/plmBoard.js loadBoardData, buildBuckets,
// enrichRows), so a card says here what its tile says there; the cards on the
// board, removed ones left off as the board leaves them. A client dropdown and
// a search (SKU, product, client, source quote). A card carries every field of
// the desktop tile -- SKU, source quote, product, client, the stage's colour
// and its pills (Stalled / At risk, days and stale, sample overdue, N open, the
// blocker, N notes, No testing, Retired), Created by and Last edited by -- and
// opens to the stage, owner and lab as text, the sample rounds with their
// notes, the card notes, the general notes, the card's Testing tab, What the
// system knows, and the card's own files: the records file (the Card tab's)
// and the working file (the first tab's), as PDF, CSV or XLSX
// (lib/plmFiles.js), exactly as the desktop card exports them.
const STAGE_ORDER = Object.fromEntries(MANUAL_STAGES.map(([k], i) => [k, i]));
const clientOf = (r) => (r.client && r.client.name) || 'No client';

export function MSamples() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [client, setClient] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    loadBoardData().then(setData, (e) => setErr('Could not load samples: ' + ((e && e.message) || e)));
  }, []);

  // As the board: every card not removed. Ladder order, then the most recently touched.
  const cards = useMemo(() => {
    if (!data) return null;
    return enrichRows(data.rows, buildBuckets(data.ev), data)
      .filter((r) => r.archived !== true)
      .sort((a, b) => {
        const sa = a.stage in STAGE_ORDER ? STAGE_ORDER[a.stage] : 99, sb = b.stage in STAGE_ORDER ? STAGE_ORDER[b.stage] : 99;
        if (sa !== sb) return sa - sb;
        const la = a.updated_at || '', lb = b.updated_at || '';
        return la < lb ? 1 : la > lb ? -1 : 0;
      });
  }, [data]);

  const clients = useMemo(() => [...new Set((cards || []).map(clientOf))].sort((a, b) => a.localeCompare(b)), [cards]);
  const shown = useMemo(() => {
    const t = normalizeTerm(term);
    return (cards || []).filter((r) => (!client || clientOf(r) === client) && (!t || matches(t,
      (r.products || {}).sku, (r.products || {}).name, clientOf(r), (sourceQuoteOf(r) || {}).code)));
  }, [cards, client, term]);

  if (err) return <div className={s.err}>{err}</div>;
  if (!cards) return <div className={s.meta}>Loading samples…</div>;
  return (
    <>
      <Filters label="Client" allLabel={'All clients (' + cards.length + ')'} options={clients} value={client} onValue={(v) => { setClient(v); setOpen(null); }}
        term={term} onTerm={setTerm} placeholder="Search SKU, product, client, quote" />
      <Count shown={shown.length} total={cards.length} noun="sample cards" />
      {shown.length === 0
        ? <div className={s.soon}>Nothing matches. Try clearing the search or the client.</div>
        : <div className={s.list}>{shown.map((r) => (
            <SampleCard key={r.id} r={r} staff={data.staff} open={open === r.id}
              onToggle={() => setOpen(open === r.id ? null : r.id)} onPending={setPending} />
          ))}</div>}
      <ReadyBar pending={pending} setPending={setPending} />
    </>
  );
}

// The tile's pills, in the tile's order and words.
function TilePills({ r }) {
  const { h, notReq, late, openHere, blk } = tileFacts(r);
  const pills = [];
  if (h === 'stalled' || h === 'at_risk') pills.push({ label: HEALTH[h].label, color: HEALTH[h].color, bg: h === 'stalled' ? 'rgba(255,55,95,.08)' : 'rgba(255,159,10,.10)' });
  if (r.days !== null && r.days !== undefined) pills.push({ label: r.days + 'd' + (r.stale ? ' · stale' : ''), color: r.stale ? '#8a5a00' : '#5b6478', bg: r.stale ? '#FDF0DC' : '#eef0f4' });
  if (late) pills.push({ label: 'sample overdue', color: '#FF375F', bg: 'rgba(255,55,95,.08)' });
  if (openHere > 0) pills.push({ label: openHere + ' open' });
  if (blk) pills.push({ label: BLOCKERS[blk].label, color: BLOCKERS[blk].text });
  if (r.noteCount > 0) pills.push({ label: r.noteCount + ' note' + (r.noteCount === 1 ? '' : 's') });
  if (notReq) pills.push({ label: 'No testing' });
  if (r.retired) pills.push({ label: 'Retired' });
  if (!pills.length) return null;
  return <div className={s.row}>{pills.map((t) => <Pill key={t.label} tone={t} />)}</div>;
}

function SampleCard({ r, staff, open, onToggle, onPending }) {
  const p = r.products || {};
  const sq = sourceQuoteOf(r);
  const [notes, setNotes] = useState(null);
  const [notesErr, setNotesErr] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  // The notes are read when the card opens, as the desktop card reads them.
  useEffect(() => {
    if (!open || notes) return;
    fetchCardNotes(r, staff).then(setNotes, (e) => setNotesErr((e && e.message) || String(e)));
  }, [open]);

  // The desktop card's Export menu: kind 'records' (its Card tab) or 'working'
  // (its first tab). Each file reads the notes afresh, as the desktop does. The
  // PDF opens in a window taken on the tap and prints itself; Excel and CSV go
  // to the share sheet, or download.
  const run = async (kind, format) => {
    if (busy) return;
    setMsg('');
    let win = null;
    if (format === 'pdf') {
      win = window.open('', '_blank');
      if (!win) { setMsg('The PDF opens in a new window. Allow pop-ups for this site and try again.'); return; }
      win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Generating sample card…</body>');
    }
    setBusy(kind + format);
    try {
      const fresh = await fetchCardNotes(r, staff);
      const args = { kind, r, factoryName: r.factoryName, staff, notes: fresh };
      if (format === 'pdf') {
        const html = cardFileHtml({ ...args, logo: await cardLogo() });
        win.document.open(); win.document.write(html); win.document.close();
      } else {
        const f = format === 'xlsx' ? await cardFileXlsx({ ...args, ExcelJS: await loadExcelJS() }) : cardFileCsv(args);
        const how = await shareFiles([f]);
        if (how === 'needs-tap') onPending([f]);
        else if (how === 'downloaded') setMsg('Downloaded ' + f.name + '.');
      }
    } catch (e) {
      if (win) { try { win.close(); } catch (x) { /* already closed */ } }
      setMsg('Could not build the export — ' + ((e && e.message) || e));
    }
    setBusy('');
  };

  const g = open ? cardGroups(r) : null;
  const rounds = r.rounds || [];
  const noteList = (list, empty) => (list.length === 0 ? <div className={s.meta}>{empty}</div> : list.map((n, i) => (
    <div key={i} className={s.lineItem}>
      <div className={s.dValue}>{n.text}</div>
      <div className={s.lineMeta}>{[n.author, stampText(n.date), n.edited ? 'edited' : '', n.kind].filter(Boolean).join(' · ')}</div>
    </div>
  )));

  return (
    <div className={s.card + (open ? ' ' + s.cardOpen : '')} style={{ borderLeft: '4px solid ' + accentOf(r.stage) }}>
      <button type="button" className={s.cardHead} aria-expanded={open} onClick={onToggle}>
        <div className={s.client}>{clientOf(r)}</div>
        <div className={s.product}>{p.name || 'Untitled'}</div>
        <div className={s.sub}>{[p.sku || '—', sq ? 'From quote ' + sq.code : ''].filter(Boolean).join(' · ')}</div>
        <div className={s.row}>
          <Pill tone={{ label: stageLabel(r.stage), color: '#ffffff', bg: accentOf(r.stage) }} />
        </div>
        <TilePills r={r} />
        <div className={s.sub}>
          Created{r.createdByName ? ' by ' + r.createdByName : ''}{r.created_at ? ' · ' + fmt(r.created_at) : ''}
          {r.edited && <><br />Last edited{r.lastTouchBy ? ' by ' + r.lastTouchBy : ''} · {fmt(r.updated_at)}</>}
        </div>
      </button>
      {open && (
        <div className={s.body}>
          <div className={s.fields} style={{ marginTop: 0, marginBottom: 16 }}>
            {g.head.map(([l, v]) => <Field key={l} label={l}>{v}</Field>)}
            <Field label="Testing lab">{r.testing_lab || 'Not recorded'}</Field>
            <Field label="Factory">{r.factoryName || 'Not recorded'}</Field>
          </div>

          <div className={s.section}>Sample rounds ({rounds.length})</div>
          <div className={s.lines}>
            {rounds.map((x) => {
              const leg = [x.received_date && 'Arrived at KUI ' + fmt(x.received_date),
                x.client_sent_date && 'Sent to client ' + fmt(x.client_sent_date),
                (x.client_carrier || x.client_tracking_number) && [x.client_carrier, x.client_tracking_number].filter(Boolean).join(' '),
                x.client_received_date && 'Client had it ' + fmt(x.client_received_date)].filter(Boolean);
              const own = notes ? notes.rounds.filter((n) => n.roundId === x.id) : [];
              return (
                <div key={x.id} className={s.lineItem}>
                  <div className={s.lineName}>{roundText(x, true)}</div>
                  {leg.length > 0 && <div className={s.lineMeta}>{leg.join(' · ')}</div>}
                  {x.client_feedback && <div className={s.lineMeta}>Client feedback: {x.client_feedback}</div>}
                  {own.map((n, i) => (
                    <div key={i} className={s.lineMeta} style={{ marginTop: 6, color: 'var(--m-ink)' }}>
                      <span style={{ whiteSpace: 'pre-wrap' }}>{n.text}</span>
                      <span className={s.meta}>{' — ' + [n.author, stampText(n.date), n.edited ? 'edited' : ''].filter(Boolean).join(' · ')}</span>
                    </div>
                  ))}
                </div>
              );
            })}
            {rounds.length === 0 && <div className={s.meta}>No rounds saved.</div>}
          </div>

          <div className={s.section} style={{ marginTop: 16 }}>Card notes</div>
          <div className={s.lines}>
            {notesErr ? <div className={s.err}>Could not read the notes — {notesErr}</div>
              : !notes ? <div className={s.meta}>Reading notes…</div>
              : noteList(notes.card, 'No notes.')}
          </div>
          <div className={s.section} style={{ marginTop: 16 }}>General notes</div>
          <div className={s.lines}>
            {notes && noteList(notes.general, r.product_id ? 'No notes.' : 'No product linked, so there are no product notes.')}
          </div>

          <div className={s.section} style={{ marginTop: 16 }}>Testing</div>
          <TestingTab r={r} />

          <div className={s.section} style={{ marginTop: 20 }}>What the system knows</div>
          <div className={s.details}>
            {g.knows.map(([l, v]) => <div key={l}><div className={s.dLabel}>{l}</div><div className={s.dValue}>{v}</div></div>)}
          </div>

          {[['records', 'Records file (the Card tab)'], ['working', 'Working file (stage, rounds, card notes)']].map(([kind, label]) => (
            <div key={kind}>
              <div className={s.section} style={{ marginTop: 16 }}>{label}</div>
              <div className={s.actions} style={{ marginTop: 0 }}>
                {[['pdf', 'Export PDF'], ['csv', 'Export CSV'], ['xlsx', 'Export XLSX']].map(([f, l]) => (
                  <button key={f} type="button" className={s.btn} disabled={!!busy} onClick={() => run(kind, f)}>{busy === kind + f ? 'Building…' : l}</button>
                ))}
              </div>
            </div>
          ))}
          {msg && <div className={msg.startsWith('Could not') || msg.startsWith('The PDF') ? s.err : s.note}>{msg}</div>}
          <div className={s.note}>Read-only here: stages, rounds and notes are changed on the desktop board.</div>
        </div>
      )}
    </div>
  );
}
