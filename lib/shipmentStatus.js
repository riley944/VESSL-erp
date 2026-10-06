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
