// ── SHIPMENT STATUS, AS A PERSON READS IT ───────────────────────────────────
// The stored values (created, in_transit, at_origin_port …) are what the
// database, the triggers, the progress bar and the SO / PO status sync all key
// on, and they do not change. This is the visible label only, written out per
// value rather than derived, so "Out for Delivery" keeps its lowercase "for".
//
// A value not listed here falls back to the old rendering, underscores turned
// into spaces, so a new status still shows something rather than nothing.
//
// Three read in ShipsGo's words (3 Nov): in_transit is Sailing,
// at_destination_port Discharged, out_for_delivery Gate out -- the stored values
// do not change. Customs, Delayed and Exception have no ShipsGo word and stay.
export const SHIPMENT_STATUS_LABEL = {
  created:             'Created',
  in_transit:          'Sailing',
  at_origin_port:      'At Origin Port',
  at_transshipment:    'At Transshipment',
  at_destination_port: 'Discharged',
  customs:             'Customs',
  out_for_delivery:    'Gate out',
  delivered:           'Delivered',
  delayed:             'Delayed',
  exception:           'Exception',
  cancelled:           'Cancelled',
};

export const shipmentStatusLabel = s =>
  SHIPMENT_STATUS_LABEL[s] || String(s || '').replace(/_/g, ' ');

// The ladder a shipment climbs, then the side states -- the order both status
// dropdowns list. The database enum puts in_transit before at_origin_port; this
// is the order a shipment actually moves in.
export const SHIPMENT_STATUS_ORDER = ['created', 'at_origin_port', 'in_transit', 'at_transshipment',
  'at_destination_port', 'customs', 'out_for_delivery', 'delivered', 'delayed', 'exception', 'cancelled'];

// What the status dropdown offers. A tracked shipment moves by tracking, so staff
// get only where it is now, Delivered and Cancelled; a manual one gets the lot.
export const statusChoices = (current, tracked) => tracked
  ? SHIPMENT_STATUS_ORDER.filter(v => v === current || v === 'delivered' || v === 'cancelled')
  : SHIPMENT_STATUS_ORDER;

// WHO SET THE STATUS LAST. order_history records every status change; tracking
// writes its rows with this note (apply_tracking_group, scripts 140 to 142).
// statusSourceMap takes status rows newest first and keeps each shipment's
// latest note.
export const TRACKING_NOTE = 'tracking shipsgo';
export const statusSourceMap = rows => {
  const m = {};
  (rows || []).forEach(r => { if (!(r.row_id in m)) m[r.row_id] = r.note || ''; });
  return m;
};

// ── TRACKING EVENTS (script 137) ────────────────────────────────────────────
// ShipsGo's movement codes as words, for the Shipments row and the card's
// timeline. An unknown code shows as itself.
export const TRACKING_EVENT_LABEL = {
  EMSH: 'Empty to shipper',
  GTIN: 'Gate in',
  LOAD: 'Loaded',
  DEPA: 'Departed',
  ARRV: 'Arrived',
  DISC: 'Discharged',
  GTOT: 'Gate out',
  EMRT: 'Empty returned',
};
export const trackingEventLabel = code => TRACKING_EVENT_LABEL[code] || code || '';

// The latest ACTUAL event of a shipment's tracking_events, or null.
export const lastActualEvent = events =>
  (events || []).filter(e => e.event_status === 'ACT' && e.event_time)
    .sort((a, b) => new Date(b.event_time) - new Date(a.event_time))[0] || null;

// ShipsGo's own status word (GATE_OUT, DISCHARGED ...) as a person reads it, for
// the small grey label beside our status.
export const trackingWord = w => String(w || '').replace(/_/g, ' ').toLowerCase();

// "just now", "2h ago", "3d ago" -- how long since tracking last checked.
export function checkedAgo(iso, now = Date.now()) {
  if (!iso) return '';
  const m = Math.round((now - new Date(iso)) / 60000);
  if (isNaN(m)) return '';
  if (m < 2) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  return h < 48 ? h + 'h ago' : Math.round(h / 24) + 'd ago';
}
