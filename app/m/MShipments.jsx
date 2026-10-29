'use client';
import { useEffect, useMemo, useState } from 'react';
import { SB } from '@/lib/supabase';
import { shipClient, etaDaysAt } from '@/lib/shipmentsView';
import { shipmentStatusLabel } from '@/lib/shipmentStatus';
import { statusLabel } from '@/lib/ordersView';
import { buildRecordSheets, recordFileName, recordPdfMeta, recordRef } from '@/lib/shipmentsExport';
import { stampToday, exportUser } from '@/lib/recordExport';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { Field, Pill, dateText, useCardExport, ExportButtons, ReadyBar, Filters, Count } from './shared';
import s from './m.module.css';

// ── SHIPMENTS ON THE IPAD: THE VOYAGE MANIFEST ──────────────────────────────
// Read-only, and only the shipments -- not Freight Quotes, not Delivery
// Requests. The desktop's shipment rows, newest first, WITHOUT the carrier
// tracking events (ShipsGo is not on every deployment; nothing here needs
// them). A client dropdown and a search. A card carries every column of the
// desktop manifest row, in its order -- reference and client, vessel and
// voyage, container, status, ETD / ETA, arrival -- plus the carrier; it opens
// to the linked POs and their sales orders. Export PDF / CSV / XLSX is the
// desktop row's own export (lib/shipmentsExport.js, 'shipment').
const SELECT = '*,companies!client_company_id(name),shipment_pos(purchase_orders(id,order_number,client_po_number,factory_company_id,status,'
  + 'client:companies!client_company_id(name),sales_order_pos(sales_orders(id,so_number,client_po_number))))';
const clientOf = (sh) => shipClient(sh) || 'No client';

export function MShipments({ user, displayName }) {
  const [rows, setRows] = useState(null);
  const [coNames, setCoNames] = useState({});
  const [err, setErr] = useState('');
  const [client, setClient] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    SB.from('shipments').select(SELECT).order('created_at', { ascending: false })
      .then(({ data, error }) => { if (error) setErr('Could not load shipments: ' + error.message); else setRows(data || []); });
    // Company id -> name, as the desktop page builds it, for carriers and factories.
    SB.from('companies').select('id,name').then(({ data }) => setCoNames(Object.fromEntries((data || []).map((c) => [c.id, c.name]))));
  }, []);

  const clients = useMemo(() => [...new Set((rows || []).map(clientOf))].sort((a, b) => a.localeCompare(b)), [rows]);
  const shown = useMemo(() => {
    const t = normalizeTerm(term);
    return (rows || []).filter((sh) => (!client || clientOf(sh) === client) && (!t || matches(t,
      sh.shipment_number, sh.booking_number, sh.bill_of_lading, sh.container_no, sh.vessel_name, sh.voyage_no, clientOf(sh),
      coNames[sh.carrier_company_id],
      ...(sh.shipment_pos || []).flatMap((x) => [x.purchase_orders && x.purchase_orders.order_number, x.purchase_orders && x.purchase_orders.client_po_number]))));
  }, [rows, client, term, coNames]);

  if (err) return <div className={s.err}>{err}</div>;
  if (!rows) return <div className={s.meta}>Loading shipments…</div>;
  return (
    <>
      <Filters label="Client" allLabel={'All clients (' + rows.length + ')'} options={clients} value={client} onValue={(v) => { setClient(v); setOpen(null); }}
        term={term} onTerm={setTerm} placeholder="Search reference, container, vessel, B/L, booking" />
      <Count shown={shown.length} total={rows.length} noun="shipments" />
      {shown.length === 0
        ? <div className={s.soon}>Nothing matches. Try clearing the search or the client.</div>
        : <div className={s.list}>{shown.map((sh) => (
            <ShipCard key={sh.id} sh={sh} coNames={coNames} open={open === sh.id} onToggle={() => setOpen(open === sh.id ? null : sh.id)}
              user={user} displayName={displayName} onPending={setPending} />
          ))}</div>}
      <ReadyBar pending={pending} setPending={setPending} />
    </>
  );
}

function ShipCard({ sh, coNames, open, onToggle, user, displayName, onPending }) {
  const pos = (sh.shipment_pos || []).map((x) => x.purchase_orders).filter(Boolean);
  const delivered = sh.status === 'delivered' || !!sh.actual_arrival;
  const days = sh.actual_arrival ? null : etaDaysAt(sh.estimated_arrival, new Date());
  const arrival = delivered ? 'Delivered'
    : days === null ? '—'
    : days < 0 ? '+' + Math.abs(days) + 'd overdue' : days + 'd to ETA';
  // The desktop row's export, exactly (Shipments exportRecord, 'shipment').
  const ex = useCardExport(() => {
    const now = new Date();
    const ctx = { exportedAt: now, user: exportUser(user, displayName), coNames, V: { etaDays: (eta) => etaDaysAt(eta, now) } };
    const day = stampToday();
    return { sheets: buildRecordSheets('shipment', sh, ctx), xlsxName: recordFileName('shipment', sh, day, 'xlsx'),
      csvName: (t0, t, i) => recordFileName('shipment', sh, day, 'csv', t, i), pdfMeta: recordPdfMeta('shipment', sh, ctx) };
  }, onPending);

  const details = [
    ['Shipment', sh.shipment_number],
    ['Booking number', sh.booking_number],
    ['Bill of lading', sh.bill_of_lading],
    ['Departed', dateText(sh.actual_departure)],
    ['Arrived', dateText(sh.actual_arrival)],
    ['Incoterm', sh.inco_term],
  ].filter(([, v]) => v != null && String(v).trim() !== '');

  return (
    <div className={s.card + (open ? ' ' + s.cardOpen : '')}>
      <button type="button" className={s.cardHead} aria-expanded={open} onClick={onToggle}>
        <div className={s.client}>{clientOf(sh)}</div>
        <div className={s.product}>{recordRef('shipment', sh) || '—'}</div>
        <div className={s.fields}>
          <Field label="Vessel">{(sh.vessel_name || 'Vessel TBD') + (sh.voyage_no ? ' · ' + sh.voyage_no : '')}</Field>
          <Field label="Container">{sh.container_no || '—'}</Field>
          <Field label="Status"><Pill tone={{ label: shipmentStatusLabel(sh.status) || '—', color: delivered ? '#059669' : '#0891b2', bg: delivered ? '#ecfdf5' : '#ecfeff' }} /></Field>
          <Field label="ETD">{dateText(sh.estimated_departure) || '—'}</Field>
          <Field label="ETA">{dateText(sh.estimated_arrival) || '—'}</Field>
          <Field label="Arrival"><span style={!delivered && days !== null && days < 0 ? { color: '#b4442c', fontWeight: 600 } : undefined}>{arrival}</span></Field>
          <Field label="Carrier">{coNames[sh.carrier_company_id] || '—'}</Field>
        </div>
      </button>
      {open && (
        <div className={s.body}>
          <div className={s.section}>Linked POs ({pos.length})</div>
          <div className={s.lines}>
            {pos.map((p) => {
              const sos = (p.sales_order_pos || []).map((l) => l.sales_orders).filter(Boolean);
              return (
                <div key={p.id || p.order_number} className={s.lineItem}>
                  <div className={s.lineName}>{p.client_po_number || p.order_number || '—'}</div>
                  <div className={s.lineMeta}>
                    {[p.client_po_number && p.order_number ? 'PO ' + p.order_number : '', coNames[p.factory_company_id] || '', (p.client && p.client.name) || '', p.status ? statusLabel(p.status) : ''].filter(Boolean).join(' · ')}
                  </div>
                  {sos.length > 0 && <div className={s.lineMeta}>{'Sales order' + (sos.length === 1 ? ': ' : 's: ') + sos.map((so) => so.client_po_number || so.so_number || '—').join(', ')}</div>}
                </div>
              );
            })}
            {pos.length === 0 && <div className={s.meta}>No POs linked.</div>}
          </div>
          {details.length > 0 && (
            <div className={s.details} style={{ marginTop: 14 }}>
              {details.map(([label, value]) => <div key={label}><div className={s.dLabel}>{label}</div><div className={s.dValue}>{value}</div></div>)}
            </div>
          )}
          <ExportButtons ex={ex} />
          <div className={s.note}>Exports are this shipment&apos;s record, as the desktop exports it.</div>
        </div>
      )}
    </div>
  );
}
