// ── The Shipments page: what is shown and counted ────────────────────────────
// Every list and count the page draws, as one pure function: the client filter,
// the search box, the freight quote status filter, the In transit / Delivered /
// All buttons and the Arriving / Overdue tiles. Moved out of app/page.jsx
// unchanged, so the page and its Excel export read the very same lists. Nothing
// here writes; everything that writes or resolves a reference on the page keeps
// reading the full quotes, rows and dreqs.
//
// `now` replaces the page's `new Date()`, so the same code can be checked
// against a snapshot.

// The freight quote status filter's default -- see the note where the page
// imports it. Every status but Archived (5 Nov): a fresh visit and a tile
// cleared show every live quote, Not selected included.
export const QF_DEFAULT = ['draft','awaiting','bidsin','awarded','notselected'];
export const SHIP_TERMINAL = ['delivered','cancelled'];

// The freight quote status badge, by stored status -- keyed, so a new status
// shows as itself in muted grey rather than as whichever branch came last.
export const RFQ_PILL = {
  draft:        { label:'Draft',        color:'#B45309', bg:'#FEF3C7' },
  sent:         { label:'Sent',         color:'#0A84FF', bg:'#EAF3FE' },
  awarded:      { label:'Awarded',      color:'#15803D', bg:'#DCFCE7' },
  not_selected: { label:'Not selected', color:'#86868B', bg:'#F2F2F4' },
  archived:     { label:'Archived',     color:'#86868B', bg:'#F2F2F4' },
};
export const rfqPill = st => RFQ_PILL[st] || { label:(st||'unknown'), color:'#86868B', bg:'#F2F2F4' };
// The status filter's groups, as the dropdown names them.
export const QF_LABEL = { draft:'Draft', awaiting:'Awaiting bids', bidsin:'Bids in', awarded:'Awarded', notselected:'Not selected', archived:'Archived' };

// TRACKED OR MANUAL. A shipment is tracked while it carries a ShipsGo ref
// (scripts 137 and 140). Once tracking has the container gated out -- our status
// moved to out_for_delivery by tracking, or ShipsGo's own word for it -- it is
// on the road to the client, and a passed ETA is not a delay worth a red flag.
export const isTracked = s => !!(s && s.tracking_ref);
export const GATED_OUT_WORDS = ['GATE_OUT', 'EMPTY_RETURN', 'EMPTY_RETURNED'];
export const gatedOut = s => isTracked(s)
  && (s.status === 'out_for_delivery' || GATED_OUT_WORDS.includes(String(s.tracking_status || '').toUpperCase()));
// AT PORT. Tracking has the container discharged at the port of discharge
// (tracking_ata) and not yet gated out: the ship has arrived, so a passed ETA
// is not a delay either. The row reads "At port · N days", N counted from the
// ATA, and the row is neither Overdue nor Arriving. Closed rows are never at
// port. Manual rows are judged by their dates as before.
export const atPort = s => isTracked(s) && !!s.tracking_ata && !gatedOut(s)
  && !SHIP_TERMINAL.includes(String(s.status || '').toLowerCase()) && !s.actual_arrival;
export const portDaysAt = (s, now) => {
  const d = Math.floor((now - new Date(s.tracking_ata)) / 86400000);
  return isNaN(d) ? null : Math.max(0, d);
};

// The Mode filter beside Tracked / Manual (script 147). Read here rather than
// imported, the same rule as lib/shipmentStatus modeOf: courier (offered no
// more) is air, missing or unknown is ocean.
const rowMode = s => {
  const m = s && s.transport_mode;
  return m === 'courier' || m === 'air' ? 'air' : 'ocean';
};

export const etaDaysAt = (eta, now) => { if (!eta) return null; const d = Math.round((new Date(eta) - now) / 86400000); return isNaN(d) ? null : d; };
const inSel = (sel, v) => !Array.isArray(sel) || sel.length === 0 || sel.includes(v);
const norm = t => (t||'').toLowerCase();

// Each record's client is the one its card already shows: a freight quote or a
// delivery request its own; a shipment its first linked Purchase Order's
// client, falling back to the shipment's own. A record with no client appears
// only under All Clients.
export const quoteClient = q => (q.client||{}).name || '';
export const shipClient = sh => ((((sh.shipment_pos||[])[0]||{}).purchase_orders||{}).client||{}).name || (sh.companies||{}).name || '';

// ── WHAT A SHIPMENT CARRIES: the Orders, Products and Companies columns ──────
// Its POs (shipment_pos); the distinct SKUs on their lines, in line order -- the
// line's product_sku, else its product's SKU, as the orders export reads it; and
// the companies connected, the client first and then each PO's factory (coNames
// is company id -> name). The page, /m and the export all read these. Display
// only.
export const shipPOs = sh => ((sh && sh.shipment_pos) || []).map(x => x.purchase_orders).filter(Boolean);
export const shipSkus = sh => {
  const out = [];
  shipPOs(sh).forEach(p => (p.purchase_order_items || []).forEach(it => {
    const k = String(it.product_sku || (it.products || {}).sku || '').trim();
    if (k && !out.includes(k)) out.push(k);
  }));
  return out;
};
export const shipCompanies = (sh, coNames = {}) => {
  const out = [];
  const add = n => { const v = String(n || '').trim(); if (v && !out.includes(v)) out.push(v); };
  add(shipClient(sh));
  shipPOs(sh).forEach(p => add(coNames[p.factory_company_id]));
  return out;
};
// What the list's Products column shows: the distinct SKUs (shipSkus), and how
// many PO lines are linked to no product -- neither product_sku nor a product --
// with their trimmed descriptions for the tooltip. lines is every PO line, so
// the column can tell "no lines at all" from "none linked".
export const shipProductSummary = sh => {
  const descs = [];
  let unlinked = 0, lines = 0;
  shipPOs(sh).forEach(p => (p.purchase_order_items || []).forEach(it => {
    lines += 1;
    const sku = String(it.product_sku || (it.products || {}).sku || '').trim();
    if (sku || it.product_id) return;
    unlinked += 1;
    const d = String(it.description || '').trim() || 'No description';
    if (!descs.includes(d)) descs.push(d);
  }));
  return { skus: shipSkus(sh), unlinked, descs, lines };
};
// The first two, then "+n" for the rest.
export const firstTwo = list => list.length <= 2 ? list.join(', ') : list.slice(0, 2).join(', ') + ' +' + (list.length - 2);

export function shipmentsView({ quotes, rows, dreqs, bids, coNames }, ui, now) {
  const dreqClient = d => coNames[d.client_company_id] || '';
  const cSel = ui.client || '';
  const quotesV = cSel ? quotes.filter(q => quoteClient(q) === cSel) : quotes;
  const rowsV = cSel ? rows.filter(sh => shipClient(sh) === cSel) : rows;
  const dreqsV = cSel ? dreqs.filter(d => dreqClient(d) === cSel) : dreqs;
  const openDreqsV = dreqsV.filter(d => (d.status||'requested') === 'requested');
  const clientChoices = [...new Set([...quotes.map(quoteClient), ...rows.map(shipClient), ...dreqs.map(dreqClient)].filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  const bidCount = id => bids.filter(b=>b.shipment_quote_id===id).length;
  const winnerOf = id => bids.find(b=>b.shipment_quote_id===id && b.selected);
  const etaDays = eta => etaDaysAt(eta, now);
  const activeShips = rowsV.filter(s => !SHIP_TERMINAL.includes((s.status||'').toLowerCase()) && !s.actual_arrival);
  const doneShips = rowsV.filter(s => SHIP_TERMINAL.includes((s.status||'').toLowerCase()) || s.actual_arrival);
  const arriving = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d>=0 && d<=14 && !atPort(s); });
  const overdueShips = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d<0 && !gatedOut(s) && !atPort(s); });
  // ONE bucket per quote, decided in one place. Awaiting and Bids in are the two
  // derived halves of 'sent'.
  const qKey = q => q.status==='sent' ? (bidCount(q.id)===0 ? 'awaiting' : 'bidsin')
                  : q.status==='not_selected' ? 'notselected'
                  : q.status==='archived' ? 'archived'
                  : q.status==='awarded' ? 'awarded'
                  : 'draft';
  const awaiting = quotesV.filter(q => q.status==='sent' && bidCount(q.id)===0);
  const bidsIn = quotesV.filter(q => q.status==='sent' && bidCount(q.id)>0);
  const awarded = quotesV.filter(q => q.status==='awarded');
  const drafts = quotesV.filter(q => q.status==='draft');
  const notSelected = quotesV.filter(q => q.status==='not_selected');
  const archivedQ = quotesV.filter(q => q.status==='archived');
  // The default (all but Archived) and empty (All statuses) both read as
  // unfiltered; anything else is a deliberate narrowing.
  const isDefaultQ = ui.qSel.length === 0
    || (ui.qSel.length === QF_DEFAULT.length && QF_DEFAULT.every(v => ui.qSel.includes(v)));

  const matchQ = (q) => {
    if (ui.search) {
      const hay = norm(q.quote_number)+' '+norm((q.client||{}).name)+' '+norm(q.origin)+' '+norm(q.destination)+' '+norm((winnerOf(q.id)||{}).forwarder_name);
      if (!hay.includes(norm(ui.search))) return false;
    }
    // Membership, never a NOT. inSel reads an empty array as All.
    return inSel(ui.qSel, qKey(q));
  };
  const shownQuotes = quotesV.filter(matchQ);
  // ignoreTrack / ignoreMode: the same test without the Tracked / Manual chip,
  // or without the Mode chip, for those chips' own counts.
  const matchS = (sp, ignoreTrack = false, ignoreMode = false) => {
    if (ui.search) {
      const po = ((sp.shipment_pos||[])[0]||{}).purchase_orders||{};
      const hay = norm(sp.shipment_number)+' '+norm(po.client_po_number)+' '+norm(po.order_number)+' '+norm((po.client||{}).name)+' '+norm((sp.companies||{}).name)+' '+norm(sp.vessel_name)+' '+norm(sp.container_no);
      if (!hay.includes(norm(ui.search))) return false;
    }
    if (ui.shipFilter==='arriving') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d>=0&&d<=14&&!sp.actual_arrival&&!atPort(sp))) return false; }
    if (ui.shipFilter==='overdue') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d<0&&!sp.actual_arrival&&!gatedOut(sp)&&!atPort(sp))) return false; }
    if (!ignoreTrack && ui.track==='tracked' && !isTracked(sp)) return false;
    if (!ignoreTrack && ui.track==='manual' && isTracked(sp)) return false;
    if (!ignoreMode && ui.mode && rowMode(sp) !== ui.mode) return false;
    return true;
  };
  const baseShips = ui.tab==='active' ? activeShips : ui.tab==='delivered' ? doneShips : rowsV;
  const shownShips = baseShips.filter(s => matchS(s));
  // The Tracked / Manual chips count within whatever else is applied.
  const beforeTrack = baseShips.filter(s => matchS(s, true));
  const trackedCount = beforeTrack.filter(isTracked).length;
  const manualCount = beforeTrack.length - trackedCount;
  const beforeMode = baseShips.filter(s => matchS(s, false, true));
  const modeCounts = { ocean: 0, air: 0 };
  beforeMode.forEach(s => { modeCounts[rowMode(s)] += 1; });

  // The six tiles, in page order.
  const tiles = [
    { key:'transit',  k:'In transit',         v:activeShips.length },
    { key:'arriving', k:'Arriving ≤14d', v:arriving.length },
    { key:'overdue',  k:'Overdue',            v:overdueShips.length },
    { key:'awaiting', k:'Awaiting bids',      v:awaiting.length },
    { key:'bidsin',   k:'Bids in',            v:bidsIn.length },
    { key:'awarded',  k:'Awarded',            v:awarded.length },
  ];

  return { cSel, quotesV, rowsV, dreqsV, openDreqsV, clientChoices, bidCount, winnerOf, etaDays, qKey,
    activeShips, doneShips, arriving, overdueShips, awaiting, bidsIn, awarded, drafts, notSelected, archivedQ,
    isDefaultQ, shownQuotes, shownShips, trackedCount, manualCount, modeCounts, tiles };
}
