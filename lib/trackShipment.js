import { SB } from '@/lib/supabase';

// ── THE TRACK BUTTON'S CALL ─────────────────────────────────────────────────
// Only the shipment id goes over; /api/tracking/track re-reads the row as the
// caller and uses the number SAVED on it. Never throws -- returns the route's
// { ok, error, credits, created, reused, refreshed, result }.
export async function trackShipment(shipmentId) {
  try {
    const { data: { session } } = await SB.auth.getSession();
    const token = session && session.access_token;
    if (!token) return { ok: false, error: 'Your session has expired.' };
    const res = await fetch('/api/tracking/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ shipment_id: shipmentId }),
    });
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!out) return { ok: false, error: 'HTTP ' + res.status };
    return out;
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}
