'use client';
import { useEffect, useMemo, useState } from 'react';
import { SB } from '@/lib/supabase';
import { SO_LIST_SELECT } from '@/lib/orderQueries';
import { SO_SM, SO_STATUSES, statusLabel, soMetrics, soUnits } from '@/lib/ordersView';
import { buildSoRecordSheets, orderFileName, orderPdfMeta } from '@/lib/ordersExport';
import { stampToday, exportUser } from '@/lib/recordExport';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { Field, Pill, dateText, money2, useCardExport, ExportButtons, ReadyBar, Filters, Count } from './shared';
import s from './m.module.css';

// ── SALES ORDERS ON THE IPAD ────────────────────────────────────────────────
// Read-only. The desktop list's rows (lib/orderQueries.js SO_LIST_SELECT),
// newest first; a client dropdown and a search. A card carries every field of
// the desktop's sales order card, in its order -- client PO, client, status
// and its stage, units, CRD, value, linked POs -- plus the SO number and order
// date; it opens to the lines with their sizes, the ship-to and the terms.
// Money (value, prices) only for the roles the desktop shows it to
// (canSeeOrderMoney), in the card and in the export. Export PDF / CSV / XLSX
// is the desktop card's own export (lib/ordersExport.js buildSoRecordSheets).
const linkedPos = (so) => (so.sales_order_pos || []).map((l) => l.purchase_orders).filter(Boolean);
const clientOf = (so) => (so.client && so.client.name) || 'Unknown';
const refOf = (so) => so.client_po_number || so.so_number || '—';

export function MSalesOrders({ user, displayName, showMoney }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [client, setClient] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    SB.from('sales_orders').select(SO_LIST_SELECT).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setErr('Could not load sales orders: ' + error.message); else setRows(data || []); });
  }, []);

  const clients = useMemo(() => [...new Set((rows || []).map(clientOf))].sort((a, b) => a.localeCompare(b)), [rows]);
  const shown = useMemo(() => {
    const t = normalizeTerm(term);
    return (rows || []).filter((so) => (!client || clientOf(so) === client) && (!t || matches(t,
      so.client_po_number, so.so_number, so.order_number, clientOf(so), so.invoice_number,
      ...(so.sales_order_items || []).flatMap((it) => [it.description, it.client_sku]),
      ...linkedPos(so).flatMap((p) => [p.order_number, p.client_po_number]))));
  }, [rows, client, term]);

  if (err) return <div className={s.err}>{err}</div>;
  if (!rows) return <div className={s.meta}>Loading sales orders…</div>;
  return (
    <>
      <Filters label="Client" allLabel={'All clients (' + rows.length + ')'} options={clients} value={client} onValue={(v) => { setClient(v); setOpen(null); }}
        term={term} onTerm={setTerm} placeholder="Search client PO, SO number, client, items" />
      <Count shown={shown.length} total={rows.length} noun="sales orders" />
      {shown.length === 0
        ? <div className={s.soon}>Nothing matches. Try clearing the search or the client.</div>
        : <div className={s.list}>{shown.map((so) => (
            <SoCard key={so.id} so={so} open={open === so.id} onToggle={() => setOpen(open === so.id ? null : so.id)}
              user={user} displayName={displayName} showMoney={showMoney} onPending={setPending} />
          ))}</div>}
      <ReadyBar pending={pending} setPending={setPending} />
    </>
  );
}

function SoCard({ so, open, onToggle, user, displayName, showMoney, onPending }) {
  const tone = SO_SM[so.status] || { label: statusLabel(so.status), color: '#8A8A8E' };
  const stageIdx = SO_STATUSES.indexOf(so.status);
  const pct = stageIdx >= 0 ? Math.round((stageIdx / (SO_STATUSES.length - 1)) * 100) : 0;
  const pos = linkedPos(so);
  const cur = so.currency || 'USD';
  // The desktop card's export, exactly (SalesOrders exportOne).
  const ex = useCardExport(() => {
    const ctx = { exportedAt: new Date(), user: exportUser(user, displayName), showMoney };
    const day = stampToday();
    return { sheets: buildSoRecordSheets(so, ctx), xlsxName: orderFileName('so', so, day, 'xlsx'),
      csvName: (sh, t, i) => orderFileName('so', so, day, 'csv', t, i), pdfMeta: orderPdfMeta('so', so, ctx) };
  }, onPending);

  const details = [
    ['Ship-to', so.delivery_address],
    ['Payment terms', so.payment_terms],
    ['Shipping method', so.shipping_method],
    ['INDC', dateText(so.indc_date || so.required_ship_date)],
    ['Cancel date', dateText(so.cancel_date)],
    ['Invoice number', so.invoice_number],
    ['Currency', so.currency],
    ['Notes', so.notes],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  return (
    <div className={s.card + (open ? ' ' + s.cardOpen : '')}>
      <button type="button" className={s.cardHead} aria-expanded={open} onClick={onToggle}>
        <div className={s.client}>{clientOf(so)}</div>
        <div className={s.product}>{refOf(so)}</div>
        <div className={s.fields}>
          <Field label="Status"><Pill tone={tone} /> <span className={s.meta}>{pct}% through</span></Field>
          <Field label="SO number">{so.so_number || so.order_number || '—'}</Field>
          <Field label="Client PO">{so.client_po_number || '—'}</Field>
          <Field label="Order date">{dateText(so.order_date) || '—'}</Field>
          <Field label="Units" num>{soUnits(so).toLocaleString()}</Field>
          <Field label="CRD">{so.cargo_ready_date ? dateText(so.cargo_ready_date) : 'No CRD'}</Field>
          {showMoney && <Field label="Value" num>{money2(soMetrics(so).rev, cur)}</Field>}
          <Field label="Linked POs">{pos.length === 0 ? '—' : pos.length === 1 ? 'PO: ' + (pos[0].order_number || pos[0].client_po_number || '—') : pos.length + ' POs'}</Field>
        </div>
      </button>
      {open && (
        <div className={s.body}>
          <div className={s.section}>Line items ({(so.sales_order_items || []).length})</div>
          <div className={s.lines}>
            {(so.sales_order_items || []).map((it) => (
              <div key={it.id} className={s.lineItem}>
                <div className={s.lineName}>{it.description || '—'}</div>
                <div className={s.lineMeta}>
                  {[it.client_sku && 'SKU ' + it.client_sku, it.size && 'Size ' + it.size].filter(Boolean).join(' · ')}
                  {(it.client_sku || it.size) ? ' · ' : ''}<span className={s.num}>Qty {Number(it.quantity || 0).toLocaleString()}</span>
                  {showMoney && it.client_price != null && <> · <span className={s.num}>{money2(it.client_price, cur)} ea</span></>}
                </div>
              </div>
            ))}
            {(so.sales_order_items || []).length === 0 && <div className={s.meta}>No line items.</div>}
          </div>
          {details.length > 0 && (
            <div className={s.details} style={{ marginTop: 14 }}>
              {details.map(([label, value]) => <div key={label}><div className={s.dLabel}>{label}</div><div className={s.dValue}>{value}</div></div>)}
            </div>
          )}
          {pos.length > 0 && (
            <>
              <div className={s.section}>Linked factory POs</div>
              <div className={s.lines}>
                {pos.map((p) => (
                  <div key={p.id} className={s.lineItem}>
                    <div className={s.lineName}>{p.order_number || p.client_po_number || '—'}</div>
                    <div className={s.lineMeta}>{[(p.factory && p.factory.name) || '', statusLabel(p.status)].filter(Boolean).join(' · ')}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          <ExportButtons ex={ex} />
          <div className={s.note}>Exports are this sales order&apos;s record{showMoney ? '' : ', without prices or costs'}, as the desktop exports it.</div>
        </div>
      )}
    </div>
  );
}
