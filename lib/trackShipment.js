import { SB } from '@/lib/supabase';

// ── THE TRACK BUTTON'S CALL ─────────────────────────────────────────────────
// Only the shipment id goes over; /api/tracking/track re-reads the row as the
// caller and uses the number SAVED on it. Never throws -- returns the route's
// { ok, error, credits, created, reused, refreshed, result }.
export async function trackShipment(shipmentId) {
  return post({ shipment_id: shipmentId });
}

async function post(body) {
  try {
    const { data: { session } } = await SB.auth.getSession();
    const token = session && session.access_token;
    if (!token) return { ok: false, error: 'Your session has expired.' };
    const res = await fetch('/api/tracking/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    });
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!out) return { ok: false, error: 'HTTP ' + res.status };
    return out;
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// ── REFRESH ON VIEW ─────────────────────────────────────────────────────────
// The Shipments page calls this with the rows it just loaded. Every active
// tracked ref last checked more than MAX_AGE_HOURS ago is refreshed through the
// track route's refresh_only path -- free, never a create -- one row per ref,
// at most LIMIT per load, one at a time, in the background. Resolves true when
// any call wrote a row, so the page reloads once; never throws, never notifies.
//
// The guards live here, at module scope, so they outlast the page: one sweep at
// a time (a second call while one runs resolves false at once), and a ref tried
// in the last RETRY_MS is left alone, so a failing ref is not asked again on
// every visit. The route checks the age again on the row it reads, which covers
// other people and other tabs.
const MAX_AGE_HOURS = 2;
const LIMIT = 10;
const RETRY_MS = 30 * 60 * 1000;
const triedAt = new Map();   // tracking_ref -> last attempt, ms
let sweeping = false;

export async function refreshStale(rows) {
  if (sweeping) return false;
  const now = Date.now();
  const pick = new Map();    // tracking_ref -> one shipment id
  for (const r of rows || []) {
    if (r.tracking_provider !== 'shipsgo' || !r.tracking_ref) continue;
    if (r.status === 'delivered' || r.status === 'cancelled') continue;
    const checked = r.tracking_checked_at ? Date.parse(r.tracking_checked_at) : 0;
    if (checked && now - checked < MAX_AGE_HOURS * 3600000) continue;
    if (now - (triedAt.get(r.tracking_ref) || 0) < RETRY_MS) continue;
    if (!pick.has(r.tracking_ref)) pick.set(r.tracking_ref, r.id);
  }
  const due = [...pick].slice(0, LIMIT);
  if (!due.length) return false;

  sweeping = true;
  let wrote = false;
  try {
    for (const [ref, id] of due) {
      triedAt.set(ref, Date.now());
      const out = await post({ shipment_id: id, refresh_only: true, max_age_hours: MAX_AGE_HOURS });
      if (!out.ok) console.warn('Tracking refresh for ' + ref + ' failed: ' + out.error);
      else if (out.result && (out.result.rows || []).length) wrote = true;
    }
  } finally {
    sweeping = false;
  }
  return wrote;
}
