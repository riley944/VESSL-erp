import { createHmac, timingSafeEqual } from 'node:crypto';
import { ShipsgoError } from '@/lib/shipsgo';
import { serviceClient, applyShipsgo } from '@/lib/trackingServer';

// ── POST /api/tracking/shipsgo ───────────────────────────────────────────────
// ShipsGo's webhook, registered in its dashboard as
// https://orders.vessl.io/api/tracking/shipsgo. Public by necessity, so nothing
// is trusted until the signature checks: HMAC-SHA256 of the RAW body with
// SHIPSGO_WEBHOOK_SECRET, hex, against X-Shipsgo-Webhook-Signature, compared in
// constant time.
//
// The payload is only a pointer. The route re-reads the shipment from ShipsGo
// by its id and applies that to every shipment carrying it as their ref -- all
// the containers of one B/L (script 140) -- so a replayed or reordered event
// can only ever apply the current state.
//
// RETRIES. ShipsGo retries a 5xx (after 1, 5 and 10 minutes) and nothing else,
// so 5xx is kept for failures a retry can fix -- ShipsGo or the database
// unreachable. A shipment that is not ours, or an event we do not act on, is a
// 200: retrying it would never succeed.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body, status) => Response.json(body, { status });
const ACTED_ON = ['OCEAN.SHIPMENTS.SHIPMENT_UPDATED', 'OCEAN.SHIPMENTS.SHIPMENT_CREATED'];

function signatureOk(raw, given, secret) {
  if (!given || !secret) return false;
  const want = createHmac('sha256', secret).update(raw, 'utf8').digest('hex');
  const a = Buffer.from(want, 'utf8');
  const b = Buffer.from(String(given).trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req) {
  const secret = process.env.SHIPSGO_WEBHOOK_SECRET;
  const svc = serviceClient();
  if (!secret || !svc || !process.env.SHIPSGO_API_KEY) return json({ ok:false, error:'Not configured.' }, 500);

  const raw = await req.text();
  if (!signatureOk(raw, req.headers.get('x-shipsgo-webhook-signature'), secret)) {
    return json({ ok:false, error:'Bad signature.' }, 401);
  }

  let payload;
  try { payload = JSON.parse(raw); } catch { return json({ ok:false, error:'Malformed body.' }, 400); }
  const event = (payload && payload.event && payload.event.name) || '';
  const shipsgoId = payload && payload.shipment && payload.shipment.id;
  if (!ACTED_ON.includes(event) || !shipsgoId) return json({ ok:true, ignored:event || 'no event' }, 200);

  try {
    const result = await applyShipsgo(svc, String(shipsgoId));
    return json({ ok:true, result }, 200);
  } catch (err) {
    // Not one of ours: apply_tracking_group raises P0002 when no shipment
    // carries this ref. Tracked from the ShipsGo dashboard, say -- nothing to do.
    if (err && err.code === 'P0002') return json({ ok:true, ignored:'not tracked here' }, 200);
    if (err instanceof ShipsgoError) {
      if (err.status === 404) return json({ ok:true, ignored:'gone at ShipsGo' }, 200);
      if (err.transient) return json({ ok:false, error:err.message }, 503);
      return json({ ok:false, error:err.message }, 200);
    }
    // The database or the network on our side -- worth the retry.
    return json({ ok:false, error:(err && err.message) || String(err) }, 503);
  }
}
