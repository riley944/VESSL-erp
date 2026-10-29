'use client';
import { useEffect, useMemo, useState } from 'react';
import { SB } from '@/lib/supabase';
import { PO_CARD_SELECT, PO_CARD_FALLBACK_SELECT } from '@/lib/orderQueries';
import { PO_STATUS, statusLabel, poClient, poFactory, poProducts } from '@/lib/ordersView';
import { buildPoRecordSheets, orderFileName, orderPdfMeta, poLinesInOrder } from '@/lib/ordersExport';
import { stampToday, exportUser } from '@/lib/recordExport';
import { matches, normalizeTerm } from '@/lib/textFilter';
import { Field, Pill, dateText, money2, useCardExport, ExportButtons, ReadyBar, Filters, Count } from './shared';
import s from './m.module.css';

// ── PURCHASE ORDERS ON THE IPAD ─────────────────────────────────────────────
// Read-only. The desktop list's rows (lib/orderQueries.js PO_CARD_SELECT, and
// its fallback when the select is refused), newest first; a factory dropdown
// and a search. A card carries every field of the desktop's PO card, in its
// order -- PO number, status, client, factory, CRD, items, linked SOs, ship
// date -- plus production %; it opens to the lines (in the detail page's
// order: styles together, sizes in scale order), incoterm and notes. Unit
// costs and totals only for canSeeOrderMoney, in the card and the export.
const linkedSos = (p) => (p.sales_order_pos || []).map((l) => l.sales_orders).filter(Boolean);
const refOf = (p) => p.client_po_number || p.order_number || '—';

export function MPurchaseOrders({ user, displayName, showMoney }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [reduced, setReduced] = useState(false);
  const [factory, setFactory] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    (async () => {
      let { data, error } = await SB.from('purchase_orders').select(PO_CARD_SELECT).order('created_at', { ascending: false });
      // As the desktop: a refused select falls back, and says so.
      if (error) {
        const retry = await SB.from('purchase_orders').select(PO_CARD_FALLBACK_SELECT).order('created_at', { ascending: false });
        if (retry.error) { setErr('Could not load purchase orders: ' + retry.error.message); return; }
        data = retry.data; setReduced(true);
      }
      setRows(data || []);
    })();
  }, []);

  const factories = useMemo(() => [...new Set((rows || []).map((p) => poFactory(p) || 'No factory'))].sort((a, b) => a.localeCompare(b)), [rows]);
  const shown = useMemo(() => {
    const t = normalizeTerm(term);
    return (rows || []).filter((p) => (!factory || (poFactory(p) || 'No factory') === factory) && (!t || matches(t,
      p.client_po_number, p.order_number, poClient(p), poFactory(p), poProducts(p),
      ...(p.purchase_order_items || []).flatMap((it) => [it.product_sku, it.products && it.products.sku]),
      ...linkedSos(p).flatMap((so) => [so.so_number, so.client_po_number]))));
  }, [rows, factory, term]);

  if (err) return <div className={s.err}>{err}</div>;
  if (!rows) return <div className={s.meta}>Loading purchase orders…</div>;
  return (
    <>
      <Filters label="Factory" allLabel={'All factories (' + rows.length + ')'} options={factories} value={factory} onValue={(v) => { setFactory(v); setOpen(null); }}
        term={term} onTerm={setTerm} placeholder="Search PO number, client, factory, items" />
      {reduced && <div className={s.err} style={{ marginBottom: 10 }}>Loaded on a reduced query: some fields (production %) are missing.</div>}
      <Count shown={shown.length} total={rows.length} noun="purchase orders" />
      {shown.length === 0
        ? <div className={s.soon}>Nothing matches. Try clearing the search or the factory.</div>
        : <div className={s.list}>{shown.map((p) => (
            <PoCard key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)}
              user={user} displayName={displayName} showMoney={showMoney} onPending={setPending} />
          ))}</div>}
      <ReadyBar pending={pending} setPending={setPending} />
    </>
  );
}

function PoCard({ p, open, onToggle, user, displayName, showMoney, onPending }) {
  const tone = PO_STATUS[p.status] || { label: statusLabel(p.status) };
  const items = p.purchase_order_items || [];
  const sos = linkedSos(p);
  const cur = p.currency || 'USD';
  // The desktop card's export, exactly (Orders exportOne).
  const ex = useCardExport(() => {
    const ctx = { exportedAt: new Date(), user: exportUser(user, displayName), showMoney };
    const day = stampToday();
    return { sheets: buildPoRecordSheets(p, ctx), xlsxName: orderFileName('po', p, day, 'xlsx'),
      csvName: (sh, t, i) => orderFileName('po', p, day, 'csv', t, i), pdfMeta: orderPdfMeta('po', p, ctx) };
  }, onPending);

  const details = [
    ['Incoterm', p.incoterm],
    ['Notes', p.notes],
    ['Order date', dateText(p.order_date)],
    ['Cancel date', dateText(p.cancel_date)],
    ['Payment terms', p.payment_terms],
    ['Shipping method', p.shipping_method],
    ['Delivery address', p.delivery_address],
    ...(showMoney ? [['Mold fee', Number(p.mold_fee) > 0 ? money2(p.mold_fee, cur) : ''], ['Sample fee', Number(p.sample_fee) > 0 ? money2(p.sample_fee, cur) : '']] : []),
  ].filter(([, v]) => v != null && String(v).trim() !== '');
  const total = items.reduce((a, it) => a + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0) + (Number(p.mold_fee) || 0);

  return (
    <div className={s.card + (open ? ' ' + s.cardOpen : '')}>
      <button type="button" className={s.cardHead} aria-expanded={open} onClick={onToggle}>
        <div className={s.client}>Purchase Order</div>
        <div className={s.product}>{refOf(p)}</div>
        <div className={s.fields}>
          <Field label="Status"><Pill tone={tone} /></Field>
          <Field label="Client">{poClient(p) || 'No client'}</Field>
          <Field label="Factory">{poFactory(p) || '—'}</Field>
          <Field label="CRD">{p.cargo_ready_date ? dateText(p.cargo_ready_date) : 'No CRD'}</Field>
          <Field label="Items" num>{items.length}</Field>
          <Field label="Linked SOs">{sos.length === 0 ? '—' : sos.length === 1 ? 'SO: ' + (sos[0].client_po_number || sos[0].so_number || '—') : sos.length + ' SOs'}</Field>
          <Field label="Ship date">{dateText(p.requested_ship_date) || '—'}</Field>
          <Field label="Production" num>{p.production_pct != null ? Math.round(Number(p.production_pct) || 0) + '%' : '—'}</Field>
          {p.order_number && p.client_po_number && <Field label="PO number">{p.order_number}</Field>}
          {showMoney && <Field label="Total" num>{money2(total, cur)}</Field>}
        </div>
      </button>
      {open && (
        <div className={s.body}>
          <div className={s.section}>Items ({items.length})</div>
          <div className={s.lines}>
            {poLinesInOrder(p).map(({ it, size }) => (
              <div key={it.id || (it.description + size)} className={s.lineItem}>
                <div className={s.lineName}>{it.description || (it.products && it.products.name) || '—'}</div>
                <div className={s.lineMeta}>
                  {[(it.product_sku || (it.products && it.products.sku)) && 'SKU ' + (it.product_sku || it.products.sku), size && 'Size ' + size, it.carton_info && 'Carton ' + it.carton_info].filter(Boolean).join(' · ')}
                  {(it.product_sku || (it.products && it.products.sku) || size || it.carton_info) ? ' · ' : ''}<span className={s.num}>Qty {Number(it.quantity || 0).toLocaleString()}</span>
                  {showMoney && it.unit_price != null && <> · <span className={s.num}>{money2(it.unit_price, cur)} ea</span></>}
                </div>
              </div>
            ))}
            {items.length === 0 && <div className={s.meta}>No line items.</div>}
          </div>
          {details.length > 0 && (
            <div className={s.details} style={{ marginTop: 14 }}>
              {details.map(([label, value]) => <div key={label}><div className={s.dLabel}>{label}</div><div className={s.dValue}>{value}</div></div>)}
            </div>
          )}
          <ExportButtons ex={ex} />
          <div className={s.note}>Exports are this purchase order&apos;s record{showMoney ? '' : ', without costs'}, as the desktop exports it.</div>
        </div>
      )}
    </div>
  );
}
