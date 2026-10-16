import { periodRange } from '@/lib/analytics';
import { SHIPPING_METHOD_OPTS } from '@/lib/productOptions';

// ── The Inventory page: what it shows, as pure functions ─────────────────────
// The page's rows, its filters and its totals, kept out of app/page.jsx so the
// page and its export read the very same list. Nothing here writes or fetches.
//
// A ROW IS ONE PURCHASE-ORDER LINE on a live PO: one whose status is not draft,
// cancelled, closed or delivered, and none of whose shipments has arrived (an
// actual arrival, or status delivered). Its quantity is the ordered quantity.

// The PO statuses a live order can be in, in the lists' order.
export const INV_PO_STATUSES = ['received', 'confirmed', 'testing', 'in_production', 'shipped', 'invoiced'];
// "Dates by": which date the range and the timeline read. ETA is a shipment's
// estimated arrival; a PO can have none (no shipment yet) or several.
export const INV_DATES_BY = [['order', 'Order Date'], ['crd', 'Cargo Ready Date'], ['eta', 'ETA']];
export const INV_DATES_WORD = { order: 'order date', crd: 'cargo ready date', eta: 'ETA' };

// Everything the page remembers for the session (usePageState('inventory')).
// poStatusF is the PO status; catalogF is the catalog bucket the page used to
// call Status. A stored statusF from before is simply ignored.
export const INV_DEFAULTS = {
  tab: 'overview', clientF: [], factoryF: [], poStatusF: [], catalogF: [], methodF: [], search: '',
  period: 'all', from: '', to: '', datesBy: 'order',
};
const FILTER_KEYS = ['clientF', 'factoryF', 'poStatusF', 'catalogF', 'methodF', 'search', 'period', 'from', 'to', 'datesBy'];
export const clearInventoryFilters = set => FILTER_KEYS.forEach(k => set(k, INV_DEFAULTS[k]));

const inSel = (sel, v) => !Array.isArray(sel) || sel.length === 0 || sel.includes(v);
const day = s => (s ? String(s).slice(0, 10) : '');
// A shipping method as the filter names it: one of the list, Other, or "—" for none.
export const invMethod = v => { const t = String(v || '').trim(); return !t ? '—' : SHIPPING_METHOD_OPTS.includes(t) ? t : 'Other'; };

// Purchase orders, as the page reads them, to rows.
export function inventoryLines(pos) {
  const out = [];
  (pos || []).forEach(po => {
    const ships = (po.shipment_pos || []).map(sp => sp.shipments).filter(Boolean);
    if (ships.some(s => s.actual_arrival || s.status === 'delivered')) return;
    const etas = [...new Set(ships.map(s => day(s.estimated_arrival)).filter(Boolean))].sort();
    (po.purchase_order_items || []).forEach(it => {
      out.push({
        client: (po.client && po.client.name) || 'Unassigned',
        // FACTORY IS A PROPERTY OF THE PO, NOT THE LINE: a product ordered from two
        // factories belongs to both, so the factory filter narrows contributing lines.
        factory: (po.factory && po.factory.name) || 'Unassigned',
        prod: (it.products && it.products.name) || it.description || '—',
        sku: (it.products && it.products.sku) || '',
        qty: Number(it.quantity) || 0,
        po: po.client_po_number || po.order_number || String(po.id).slice(0, 8),
        poId: po.id,
        status: po.status,
        // `bucket`, the catalog state, is unrelated to the PO's status above.
        bucket: !it.products ? 'noprod' : it.products.active == null ? 'notset' : it.products.active ? 'active' : 'inactive',
        method: invMethod(po.shipping_method),
        orderDate: day(po.order_date),
        crd: day(po.cargo_ready_date),
        etas,
      });
    });
  });
  return out;
}

// The dates a line has for "Dates by": one, or for ETA every shipment's.
export const datesOf = (l, by) => (by === 'eta' ? l.etas : by === 'crd' ? (l.crd ? [l.crd] : []) : (l.orderDate ? [l.orderDate] : []));

export const isInventoryFiltered = ui => !!(['clientF', 'factoryF', 'poStatusF', 'catalogF', 'methodF'].some(k => (ui[k] || []).length)
  || (ui.search || '').trim() || ui.period !== 'all');

// The lines the filters keep. range is the period's (lib/analytics periodRange).
// noDate counts the lines that pass every other filter but have no date of the
// "Dates by" kind while the range is limited -- left out, and said so.
export function filterInventory(lines, ui, now) {
  const range = periodRange(ui.period, now, ui.from, ui.to);
  const term = (ui.search || '').trim().toLowerCase();
  let noDate = 0;
  const shown = lines.filter(l => {
    if (!inSel(ui.clientF, (l.client || '').trim() || '—')) return false;
    if (!inSel(ui.factoryF, (l.factory || '').trim() || '—')) return false;
    if (!inSel(ui.poStatusF, l.status)) return false;
    if (!inSel(ui.catalogF, l.bucket)) return false;
    if (!inSel(ui.methodF, l.method)) return false;
    if (term && !((l.prod + ' ' + l.sku).toLowerCase().includes(term))) return false;
    if (range.limited) {
      const ds = datesOf(l, ui.datesBy);
      if (!ds.length) { noDate += 1; return false; }
      if (!ds.some(d => (!range.from || d >= range.from) && (!range.to || d <= range.to))) return false;
    }
    return true;
  });
  return { shown, range, noDate };
}

// Units by a field, largest first, as [name, units].
export function sumBy(rows, key) {
  const m = {};
  rows.forEach(l => { const v = (l[key] || '').trim() || '—'; m[v] = (m[v] || 0) + l.qty; });
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

// The three tiles. Active SKUs is distinct product + SKU across clients.
export function inventoryTiles(rows) {
  const skus = new Set(rows.map(l => l.prod + '|||' + l.sku));
  const clients = new Set(rows.map(l => l.client));
  return { units: rows.reduce((a, l) => a + l.qty, 0), skus: skus.size, clients: clients.size };
}
