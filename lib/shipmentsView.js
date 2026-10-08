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
// imports it. Four of the six ticked, so resolved RFQs are out of the way.
export const QF_DEFAULT = ['draft','awaiting','bidsin','awarded'];
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

export const etaDaysAt = (eta, now) => { if (!eta) return null; const d = Math.round((new Date(eta) - now) / 86400000); return isNaN(d) ? null : d; };
const inSel = (sel, v) => !Array.isArray(sel) || sel.length === 0 || sel.includes(v);
const norm = t => (t||'').toLowerCase();

// Each record's client is the one its card already shows: a freight quote or a
// delivery request its own; a shipment its first linked Purchase Order's
// client, falling back to the shipment's own. A record with no client appears
// only under All Clients.
export const quoteClient = q => (q.client||{}).name || '';
export const shipClient = sh => ((((sh.shipment_pos||[])[0]||{}).purchase_orders||{}).client||{}).name || (sh.companies||{}).name || '';

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
  const arriving = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d>=0 && d<=14; });
  const overdueShips = activeShips.filter(s => { const d=etaDays(s.estimated_arrival); return d!==null && d<0; });
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
  // Default and empty both read as unfiltered; anything else is a deliberate
  // narrowing.
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
  const matchS = (sp) => {
    if (ui.search) {
      const po = ((sp.shipment_pos||[])[0]||{}).purchase_orders||{};
      const hay = norm(sp.shipment_number)+' '+norm(po.client_po_number)+' '+norm(po.order_number)+' '+norm((po.client||{}).name)+' '+norm((sp.companies||{}).name)+' '+norm(sp.vessel_name)+' '+norm(sp.container_no);
      if (!hay.includes(norm(ui.search))) return false;
    }
    if (ui.shipFilter==='arriving') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d>=0&&d<=14&&!sp.actual_arrival)) return false; }
    if (ui.shipFilter==='overdue') { const d=etaDays(sp.estimated_arrival); if(!(d!==null&&d<0&&!sp.actual_arrival)) return false; }
    return true;
  };
  const baseShips = ui.tab==='active' ? activeShips : ui.tab==='delivered' ? doneShips : rowsV;
  const shownShips = baseShips.filter(matchS);

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
    isDefaultQ, shownQuotes, shownShips, tiles };
}
