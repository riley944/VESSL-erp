// ── ShipsGo ocean tracking (server only) ─────────────────────────────────────
// The client for https://api.shipsgo.com/v2 and the one function that turns a
// ShipsGo shipment into the jsonb vessl.apply_tracking_group (script 140)
// takes. Imported by the three /api/tracking routes and nothing in the browser:
// the key is SHIPSGO_API_KEY and must never reach a client bundle.
//
// CREDITS. Creating a tracking costs 1 credit; ShipsGo answers a duplicate
// (same booking or container number) with 409 and the existing shipment, free.
// Every read is free. The balance only travels back as a header on a create,
// X-Shipsgo-Credits-Remaining -- there is no endpoint that reports it.

const BASE = 'https://api.shipsgo.com/v2';

export class ShipsgoError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
  // Worth a retry: rate limit, ShipsGo down, or the network.
  get transient() { return !this.status || this.status === 429 || this.status >= 500; }
}

async function call(method, path, body) {
  const key = process.env.SHIPSGO_API_KEY;
  if (!key) throw new ShipsgoError('SHIPSGO_API_KEY is not set', 0);
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'X-Shipsgo-User-Token': key, Accept: 'application/json',
                 ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (err) {
    throw new ShipsgoError('ShipsGo unreachable: ' + ((err && err.message) || err), 0);
  }
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  const credits = res.headers.get('x-shipsgo-credits-remaining');
  const cost = res.headers.get('x-shipsgo-credits-cost');
  return { status: res.status, json, credits: credits == null ? null : Number(credits), cost: cost == null ? null : Number(cost) };
}

const fail = (what, r) => new ShipsgoError(what + ' failed: HTTP ' + r.status
  + (r.json && r.json.message ? ' ' + r.json.message : ''), r.status, r.json);

// The full shipment: route, containers and their movements.
export async function getShipment(id) {
  const r = await call('GET', '/ocean/shipments/' + encodeURIComponent(id));
  if (r.status !== 200 || !r.json || !r.json.shipment) throw fail('Reading ShipsGo shipment ' + id, r);
  return r.json.shipment;
}

// { booking_number } or { container_number }, optionally { carrier }.
// Returns { id, existed, credits, cost } -- existed is the free 409 reuse.
export async function createShipment(fields) {
  const r = await call('POST', '/ocean/shipments', fields);
  if ((r.status === 200 || r.status === 409) && r.json && r.json.shipment) {
    return { id: r.json.shipment.id, existed: r.status === 409, credits: r.credits, cost: r.cost };
  }
  if (r.status === 402) throw new ShipsgoError('No ShipsGo credits left', 402, r.json);
  throw fail('Creating the ShipsGo tracking', r);
}

// The carrier with this SCAC code, or null. ShipsGo uses its own codes for some
// lines (Wan Hai came back as 22AA, not WHLC), so a prefix that is not on the
// list is simply left out and ShipsGo detects the line itself.
export async function carrierByCode(code) {
  if (!/^(SG_)?[A-Z0-9]{4}$/.test(code || '')) return null;
  const r = await call('GET', '/ocean/carriers?filters[code]=eq:' + encodeURIComponent(code) + '&take=1');
  if (r.status !== 200 || !r.json) return null;
  const c = (r.json.carriers || [])[0];
  return c && c.scac === code && c.status !== 'PASSIVE' ? c : null;
}

// ── THE MAPPING ──────────────────────────────────────────────────────────────
// Each container's state comes from its latest ACTUAL movement. Decision (b):
// nothing before departure moves the shipment -- empty pickup, gate in and
// loading at the port of loading leave target_status null, and only the
// tracking columns and events record them. Never delivered: gate out and empty
// return stop at out_for_delivery. apply_tracking_group enforces both again
// and only ever moves a status forward, so this is the proposal, not the gate.
const LADDER = ['in_transit', 'at_transshipment', 'at_destination_port', 'customs', 'out_for_delivery'];

function containerTarget(c, pol, pod) {
  const acts = (c.movements || []).filter(m => m.status === 'ACT' && m.timestamp)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const last = acts[acts.length - 1];
  if (!last) return null;
  const at = (last.location || {}).code || '';
  switch (last.event) {
    case 'DEPA': return 'in_transit';
    case 'LOAD': return at && at !== pol ? 'at_transshipment' : null;
    case 'ARRV':
    case 'DISC': return at && at === pod ? 'at_destination_port' : 'at_transshipment';
    case 'GTOT': return at && at === pod ? 'out_for_delivery' : null;
    case 'EMRT': return 'out_for_delivery';
    default:     return null;   // EMSH, GTIN -- before departure
  }
}

const iso = t => (t ? new Date(t).toISOString() : null);
const byTime = (a, b) => new Date(a.m.timestamp || 0) - new Date(b.m.timestamp || 0);
const atPort = (x, pod) => ((x.m.location || {}).code || '') === pod;

// The vessel the cargo is on or last was: the latest actual movement naming
// one, else the first estimate that does.
function vesselOf(moves) {
  const acts = moves.filter(x => x.m.status === 'ACT').sort(byTime);
  const hit = [...acts].reverse().find(x => x.m.vessel)
    || moves.filter(x => x.m.status === 'EST' && x.m.vessel).sort(byTime)[0];
  return hit ? { vessel: hit.m.vessel.name || null, voyage: hit.m.voyage || null } : { vessel: null, voyage: null };
}

// Actual arrival at the port of discharge, the first one.
function ataOf(moves, pod) {
  const hit = moves.filter(x => x.m.status === 'ACT' && x.m.event === 'ARRV' && atPort(x, pod)).sort(byTime)[0];
  return hit ? iso(hit.m.timestamp) : null;
}

const eventRow = ({ c, m }) => ({
  container_number: c,
  event_code: m.event,
  event_status: m.status === 'ACT' ? 'ACT' : 'EST',
  location_code: (m.location || {}).code || '',
  location_name: (m.location || {}).name || null,
  vessel_name: (m.vessel || {}).name || null,
  vessel_imo: m.vessel && m.vessel.imo != null ? String(m.vessel.imo) : null,
  voyage: m.voyage || null,
  event_time: iso(m.timestamp),
  raw: m,
});

// detail is the `shipment` object of GET /ocean/shipments/{id}. The top level
// describes the shipment as a whole -- the least advanced container -- and is
// what a row with no container number takes; containers[] carries each
// container's own state, which is what a row with that container number takes
// (script 140).
export function mapShipsgoToUpdate(detail) {
  const s = detail || {};
  const route = s.route || {};
  const pol = ((route.port_of_loading || {}).location || {}).code || '';
  const pod = ((route.port_of_discharge || {}).location || {}).code || '';
  const routeEta = iso((route.port_of_discharge || {}).date_of_discharge);
  const containers = (s.containers || []).filter(c => c && c.number);

  // Least advanced container decides. One still before departure holds the
  // shipment back, so the target is null until every container has gone.
  let target = null;
  let least = null;
  if (containers.length) {
    const ranks = containers.map(c => {
      const t = containerTarget(c, pol, pod);
      return t ? LADDER.indexOf(t) : -1;
    });
    const min = Math.min(...ranks);
    target = min >= 0 ? LADDER[min] : null;
    least = containers[ranks.indexOf(min)];
  }

  const movesOf = c => (c.movements || []).map(m => ({ c: c.number, m }));
  const moves = containers.flatMap(movesOf);
  const all = vesselOf(moves);

  return {
    provider: 'shipsgo',
    ref: String(s.id),
    // The least advanced container's own status word, so the raw word and the
    // mapped status describe the same container.
    tracking_status: (least && least.status) || s.status || null,
    vessel: all.vessel,
    voyage: all.voyage,
    eta: routeEta,
    ata: ataOf(moves, pod),
    error: s.status === 'UNTRACKED' ? 'ShipsGo could not track this shipment (UNTRACKED)' : null,
    target_status: target,
    events: moves.map(eventRow).filter(e => e.event_code),
    containers: containers.map(c => {
      const own = movesOf(c);
      const v = vesselOf(own);
      // Its own discharge at the port of discharge, actual or estimated, else
      // its arrival there, else the route's discharge date.
      const disc = own.filter(x => x.m.event === 'DISC' && atPort(x, pod) && x.m.timestamp).sort(byTime)[0]
        || own.filter(x => x.m.event === 'ARRV' && atPort(x, pod) && x.m.timestamp).sort(byTime)[0];
      return {
        number: c.number,
        tracking_status: c.status || null,
        vessel: v.vessel,
        voyage: v.voyage,
        eta: disc ? iso(disc.m.timestamp) : routeEta,
        ata: ataOf(own, pod),
        target_status: containerTarget(c, pol, pod),
        events: own.map(eventRow).filter(e => e.event_code),
      };
    }),
  };
}
