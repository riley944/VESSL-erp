import { createClient } from '@supabase/supabase-js';
import { getShipment, mapShipsgoToUpdate } from '@/lib/shipsgo';

// ── SERVER SIDE OF TRACKING ─────────────────────────────────────────────────
// Shared by the three /api/tracking routes. Every tracking write goes through
// vessl.apply_tracking_group (script 140), which only the service role may
// call: it attaches the live shipments on one B/L, writes each from its own
// container, silences client notifications for its own cascade and moves
// status forward only. Nothing here writes a vessl table directly.

// null when the server is missing the URL or the key -- the caller answers 500.
export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { db:{ schema:'vessl' }, auth:{ persistSession:false, autoRefreshToken:false } });
}

// Reads the ShipsGo shipment and applies it to every shipment carrying that
// ref. number (the B/L, else the booking number) also attaches the live
// siblings that do not carry it yet; null for the webhook and the refresh.
// Returns the function's own summary: { ref, rows[], moved, skipped[] }.
export async function applyShipsgo(sb, shipsgoId, number = null) {
  const detail = await getShipment(shipsgoId);
  const data = mapShipsgoToUpdate(detail);
  const { data: out, error } = await sb.rpc('apply_tracking_group',
    { p_ref: String(shipsgoId), p_number: number || null, p_data: data });
  if (error) { const e = new Error(error.message); e.code = error.code; throw e; }
  return out;
}
