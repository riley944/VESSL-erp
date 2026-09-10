'use client';
import { useState, useEffect } from 'react';
import { SB } from '@/lib/supabase';

// ── The derived lifecycle for one product ────────────────────────────────────
// Read-only. Nothing here writes, and Phase 1 adds no table and no column -- every
// event below comes from a foreign key that already existed.
//
// KEYED ON product_id, NOT ON A QUOTE, and that is the point of the component
// existing at all. The Products page renders quotes, so the same product appears
// on three rows when three quotes name it; its `ProductDetailModal` takes a quote
// despite the name. This takes a product, so Phase 2 can embed the same component
// on a program page instead of copying it -- the mistake lib/tierCost.js and
// lib/bankFields.js were both created to undo.
//
// FOUR QUERIES, ON DEMAND. They run when the panel mounts, for one product.
// Shipped and Delivered are not two of them -- both come from the same
// product-to-PO-to-shipment embed, so they cost nothing extra. Doing any of this
// for a list would be a fan-out nobody wants; for one product it is four indexed
// lookups against keys that already exist.
export const LIFECYCLE_STAGES = [
  ['quoted',    'Quoted'],
  ['tested',    'Tested'],
  ['ordered',   'Ordered'],
  ['sold',      'Sold'],
  ['shipped',   'Shipped'],
  ['delivered', 'Delivered'],
];

// ── The exception badges are OFF ─────────────────────────────────────────────
// Deliberately, and this constant is the whole switch. PLM.md records product
// identity as a PREREQUISITE of the badges, because several of the contradictions
// are duplicate-product problems in a lifecycle costume -- LLF-1617 declares
// passed on BOTH twins with a report on neither, and JON-106 needed a report
// relinked rather than a status changed.
//
// A badge whose first output is "you have two products" teaches people to ignore
// badges. So the timeline shipped first and this turned on once Kristy had
// answered LLF-1617, BUC-157 and LL1-1618.
//
// ON since 2026-09-10. All three were settled:
//   LLF-1617  script 37 retired the twin holding no quote; one row is active.
//   BUC-157   script 42 moved the PO line and retired the duplicate.
//   LL1-1618  renamed by hand to LL1-1618 Green and LL1-1618 Pink, both kept.
//
// MEASURED BEFORE FLIPPING, which is the point of the gate rather than a
// formality: across 184 selectable products, ONE fires a badge -- LLW-1388,
// declared Production with no purchase order and no sales order, which is the row
// Phase 0.5 flagged for exactly this. The ordered-or-sold-but-never-quoted rule
// fires on nothing, because scripts 39 and 14 linked the orders that would have
// tripped it.
//
// One badge on 184 products is the outcome the gate was for. If a future change
// makes these fire on dozens, that is the signal to narrow the rule rather than
// to hide the badge -- see the two classes deleted below for the precedent.
export const LIFECYCLE_EXCEPTIONS_ENABLED = true;

const fmt = d => {
  if (!d) return null;
  try { return new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }); }
  catch { return String(d); }
};

export function LifecyclePanel({ product, exceptionsEnabled = LIFECYCLE_EXCEPTIONS_ENABLED }) {
  const [state, setState] = useState({ loading:true, ev:null, err:null });
  const pid = product && product.id;

  useEffect(() => {
    if (!pid) { setState({ loading:false, ev:null, err:null }); return; }
    let cancelled = false;
    (async () => {
      setState({ loading:true, ev:null, err:null });
      try {
        // Shipped and Delivered share one traversal -- product to PO line to PO to
        // the shipment junction -- so they are one query returning both dates
        // rather than two walking the same four tables.
        const [q, t, poi, soi] = await Promise.all([
          SB.from('quotes').select('id,quote_date,created_at,client').eq('product_id', pid)
            .order('created_at', { ascending:true }),
          SB.from('test_reports').select('id,test_date,issue_date,expiry_date,overall_result,report_number')
            .eq('product_id', pid).order('test_date', { ascending:true }),
          SB.from('purchase_order_items')
            .select('id,quantity,purchase_orders(id,order_number,order_date,issued_at,status,shipment_pos(shipments(actual_departure,actual_arrival,status)))')
            .eq('product_id', pid),
          SB.from('sales_order_items')
            .select('id,quantity,sales_orders(id,so_number,order_date,status)')
            .eq('product_id', pid),
        ]);
        if (cancelled) return;
        setState({ loading:false, err:null, ev:{
          quotes: q.data || [], reports: t.data || [], poItems: poi.data || [], soItems: soi.data || [],
        }});
      } catch (e) {
        if (!cancelled) setState({ loading:false, ev:null, err: e && e.message ? e.message : String(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [pid]);

  if (!pid) return null;
  if (state.loading) return <div style={{padding:'14px 0',fontSize:'13px',color:'#86868B'}}>Reading lifecycle…</div>;
  if (state.err) return <div style={{padding:'14px 0',fontSize:'13px',color:'var(--hot)'}}>Could not read the lifecycle — {state.err}</div>;

  const { quotes, reports, poItems, soItems } = state.ev;

  // Every shipment this product reached, through its purchase orders.
  const ships = poItems.flatMap(i => ((i.purchase_orders || {}).shipment_pos || [])
    .map(sp => sp.shipments).filter(Boolean));
  // ── FIRST IS THE MILESTONE, LATEST IS THE RECENCY ─────────────────────────
  // The headline date on each row stays the FIRST occurrence, because that is when
  // the product reached that stage and it never changes. The subtitle carries the
  // latest, because "quoted in March" and "quoted again last week" are different
  // facts and only one of them is a milestone.
  //
  // ISO date strings sort lexically, so a plain sort is correct here and does not
  // need Date parsing -- the same reason the timeline reads dates as strings
  // throughout.
  const datesOf = (arr, pick) => arr.map(pick).filter(Boolean).sort();
  const firstOf = (arr, pick) => datesOf(arr, pick)[0] || null;
  const lastOf  = (arr, pick) => { const d = datesOf(arr, pick); return d.length ? d[d.length - 1] : null; };
  // Appended only when there is a SECOND event AND it lands on a different day.
  // Two quotes raised the same afternoon would otherwise print the headline date
  // twice, which reads as a bug rather than as recency.
  const withLatest = (text, arr, pick) => {
    if (arr.length < 2) return text;
    const first = firstOf(arr, pick), last = lastOf(arr, pick);
    return (last && last !== first) ? text + ' · latest ' + fmt(last) : text;
  };

  const uniqSorted = xs => [...new Set(xs.filter(Boolean))].sort();
  const shipDates = {
    dep: uniqSorted(ships.map(s => s.actual_departure)),
    arr: uniqSorted(ships.map(s => s.actual_arrival)),
  };

  const events = {
    quoted:    quotes.length    ? { on: firstOf(quotes, q => q.quote_date || q.created_at), n: quotes.length,
                                    detail: withLatest(quotes.length + (quotes.length === 1 ? ' quote' : ' quotes'),
                                                       quotes, q => q.quote_date || q.created_at) } : null,
    tested:    reports.length   ? { on: firstOf(reports, r => r.test_date || r.issue_date), n: reports.length,
                                    detail: withLatest(reports.length + (reports.length === 1 ? ' report' : ' reports')
                                            + (reports.some(r => r.overall_result === 'pass') ? ', passing' : ''),
                                                       reports, r => r.test_date || r.issue_date) } : null,
    ordered:   poItems.length   ? { on: firstOf(poItems, i => (i.purchase_orders || {}).issued_at || (i.purchase_orders || {}).order_date),
                                    n: poItems.length, detail: withLatest(poItems.length + ' purchase order '
                                            + (poItems.length === 1 ? 'line' : 'lines'),
                                            poItems, i => (i.purchase_orders || {}).issued_at || (i.purchase_orders || {}).order_date) } : null,
    sold:      soItems.length   ? { on: firstOf(soItems, i => (i.sales_orders || {}).order_date),
                                    n: soItems.length, detail: withLatest(soItems.length + ' sales order '
                                            + (soItems.length === 1 ? 'line' : 'lines'),
                                            soItems, i => (i.sales_orders || {}).order_date) } : null,
    // Same rule as the four above, on DISTINCT dates rather than rows. A product
    // with two PO lines in one shipment is one shipping event, not two, and the
    // embed returns the shipment once per line -- so counting rows here would
    // report a second departure that never happened.
    shipped:   shipDates.dep.length ? { on: shipDates.dep[0], n: shipDates.dep.length,
                                        detail: shipDates.dep.length > 1
                                          ? shipDates.dep.length + ' shipments · latest '
                                            + fmt(shipDates.dep[shipDates.dep.length - 1]) : null } : null,
    delivered: shipDates.arr.length ? { on: shipDates.arr[0], n: shipDates.arr.length,
                                        detail: shipDates.arr.length > 1
                                          ? shipDates.arr.length + ' arrivals · latest '
                                            + fmt(shipDates.arr[shipDates.arr.length - 1]) : null } : null,
  };

  const anyEvent = LIFECYCLE_STAGES.some(([k]) => events[k]);

  // ── EXCEPTIONS, computed always, rendered only behind the flag ─────────────
  // Computed regardless so switching the constant needs no other change, and so
  // the logic is exercised rather than sitting untested until the day it ships.
  const exceptions = [];
  if (product.product_stage === 'production' && !events.ordered && !events.sold)
    exceptions.push('Declared Production, but there is no purchase order and no sales order.');
  // COMPLIANT-WITH-NO-REPORT AND eFILED-WITH-NO-REPORT ARE NOT EXCEPTIONS HERE,
  // and both were removed rather than hidden on 2026-09-09. Declared compliance is
  // trusted at KUI, and 73 of 84 reports will stay unlinked for a long time --
  // 71 of them name SKUs the catalogue does not hold. A badge that fires on most
  // of the catalogue for a reason nobody accepts is worse than no badge, because
  // it teaches people to dismiss the two below that do mean something.
  if ((events.ordered || events.sold) && !events.quoted)
    exceptions.push('Has been ordered or sold, but no quote points at it.');
  // The sample-already-moved case is DELIBERATELY NOT HERE. It applies to 32 of
  // 185 products, and 32 badges saying the same thing is noise -- the Testing page
  // states it once, at page level, with a filter. See PLM.md.

  return (
    <div style={{marginTop:'6px'}}>
      {/* PERSISTENT, NOT DISMISSABLE. Without it "no test report" reads as
          "untested" when it usually means "untracked", which is a
          compliance-shaped misreading. 73 of 84 reports carry no product and 71
          of those name SKUs the catalogue does not hold, so the Tested row below
          can only ever be right for a handful of products. */}
      <div style={{background:'#F4F4F6',border:'1px solid #E5E5EA',borderRadius:'8px',
                   padding:'9px 12px',marginBottom:'14px',fontSize:'12px',color:'#5A5A5E',lineHeight:1.5}}>
        Testing coverage is incomplete — 73 of 84 test reports are not linked to any product,
        and 71 of those name SKUs that are not in the catalogue. A missing Tested row below
        may mean untracked rather than untested.
      </div>

      {exceptionsEnabled && exceptions.length > 0 && (
        <div style={{background:'#FEF3C7',border:'1px solid #f0d9a8',borderRadius:'8px',
                     padding:'10px 12px',marginBottom:'14px',fontSize:'12.5px',color:'#8a5a00',lineHeight:1.55}}>
          <div style={{fontWeight:600,marginBottom:'3px'}}>Declared and recorded do not agree</div>
          {exceptions.map((x,i) => <div key={i}>{x}</div>)}
        </div>
      )}

      {!anyEvent ? (
        /* NOT AN EMPTY STATE. An explicit inventory of what is absent, because
           these 21 products are invisible on the Products page -- it renders from
           quotes and they have none -- so this panel is the first place they can
           be seen at all. A blank box would repeat the invisibility. */
        <div style={{border:'1px solid #E5E5EA',borderRadius:'10px',padding:'14px'}}>
          <div style={{fontSize:'13.5px',fontWeight:600,color:'#1D1D1F',marginBottom:'8px'}}>
            No lifecycle events recorded
          </div>
          <div style={{fontSize:'12.5px',color:'#86868B',lineHeight:1.7}}>
            No quote names this product.<br />
            No test report is linked to it.<br />
            It appears on no purchase order.<br />
            It appears on no sales order.
          </div>
          <div style={{fontSize:'12px',color:'#A0A0A4',marginTop:'10px',lineHeight:1.5}}>
            The product exists in the catalogue and can still be matched by SKU. It is simply
            not referenced by anything yet.
          </div>
        </div>
      ) : (
        <div>
          {LIFECYCLE_STAGES.map(([key, label]) => {
            const e = events[key];
            return (
              <div key={key} style={{display:'flex',alignItems:'flex-start',gap:'11px',padding:'7px 0'}}>
                <span style={{width:'9px',height:'9px',borderRadius:'50%',flexShrink:0,marginTop:'4px',
                  boxSizing:'border-box',
                  ...(e ? {background:'var(--ok)'} : {background:'transparent',border:'1.5px solid #D6D6DA'})}} />
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:'13.5px',color: e ? '#1D1D1F' : '#A0A0A4',fontWeight: e ? 600 : 400}}>
                    {label}
                    {e && e.on && <span style={{fontWeight:400,color:'#86868B'}}> · {fmt(e.on)}</span>}
                  </div>
                  {e && e.detail && (
                    <div style={{fontSize:'12px',color:'#86868B',marginTop:'1px'}}>{e.detail}</div>
                  )}
                  {!e && (
                    <div style={{fontSize:'12px',color:'#C0C0C4',marginTop:'1px'}}>not recorded</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
