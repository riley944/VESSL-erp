// ── THE FREIGHT / OPS DISTRIBUTION LIST ─────────────────────────────────────
// Who runs the freight side of the Shipments tab: the RFQ round, the forwarder
// replies and the Monday chase list. Every Shipments-tab email that goes to
// "ops" reads this list -- /api/rfq/send (Reply-To and the file-copy BCC) and
// /api/rfq/digest (To) -- so adding or removing a person is one line here.
//
// Plain constants, no server-only imports: lib/rfqSheet.js is bundled into the
// browser, and anything it may one day import from here must stay safe there.
export const OPS_TEAM = ['kristy@kinguniversal.com', 'monica@kinguniversal.com'];
