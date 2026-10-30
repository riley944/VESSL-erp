// ── SHIPMENT STATUS, AS A PERSON READS IT ───────────────────────────────────
// The stored values (created, in_transit, at_origin_port …) are what the
// database, the triggers, the progress bar and the SO / PO status sync all key
// on, and they do not change. This is the visible label only, written out per
// value rather than derived, so "Out for Delivery" keeps its lowercase "for".
//
// A value not listed here falls back to the old rendering, underscores turned
// into spaces, so a new status still shows something rather than nothing.
export const SHIPMENT_STATUS_LABEL = {
  created:             'Created',
  in_transit:          'In Transit',
  at_origin_port:      'At Origin Port',
  at_transshipment:    'At Transshipment',
  at_destination_port: 'At Destination Port',
  customs:             'Customs',
  out_for_delivery:    'Out for Delivery',
  delivered:           'Delivered',
  delayed:             'Delayed',
  exception:           'Exception',
  cancelled:           'Cancelled',
};

export const shipmentStatusLabel = s =>
  SHIPMENT_STATUS_LABEL[s] || String(s || '').replace(/_/g, ' ');

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

// The departure tracking reports: the first DEPA, actual if there is one, else
// the first estimated one. The first departure is from the port of loading --
// a later one is a transshipment leg. null when there is none yet.
export function trackingEtd(events) {
  const deps = (events || []).filter(e => e.event_code === 'DEPA' && e.event_time)
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));
  const act = deps.find(e => e.event_status === 'ACT');
  return (act || deps[0] || {}).event_time || null;
}

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
