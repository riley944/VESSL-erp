import { createClient } from '@supabase/supabase-js';
import { getShipment, mapShipsgoToUpdate } from '@/lib/shipsgo';

// ── SERVER SIDE OF TRACKING ─────────────────────────────────────────────────
// Shared by the three /api/tracking routes. Every tracking write goes through
// vessl.apply_tracking_update (script 137), which only the service role may
// call: it silences client notifications for its own cascade and moves status
// forward only. Nothing here writes a vessl table directly.

// null when the server is missing the URL or the key -- the caller answers 500.
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { db:{ schema:'vessl' }, auth:{ persistSession:false, autoRefreshToken:false } });
}

// Reads the ShipsGo shipment and applies it. shipmentId null finds our row by
// provider and ref -- the webhook case. Returns the function's own summary.
export async function applyShipsgo(sb, shipmentId, shipsgoId) {
  const detail = await getShipment(shipsgoId);
  const data = mapShipsgoToUpdate(detail);
  const { data: out, error } = await sb.rpc('apply_tracking_update', { p_shipment_id: shipmentId, p_data: data });
  if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  return out;
}
