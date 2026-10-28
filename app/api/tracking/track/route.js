import { createClient } from '@supabase/supabase-js';
import { createShipment, carrierByCode, ShipsgoError } from '@/lib/shipsgo';
import { serviceClient, applyShipsgo } from '@/lib/trackingServer';

// ── POST /api/tracking/track ─────────────────────────────────────────────────
// The Track button on a shipment. Body { shipment_id }, nothing else: the route
// re-reads the row as the caller, so it can only track a shipment that staff
// can see, with the number that is SAVED on it.
//
// A shipment already tracked is refreshed -- a free read, no new tracking.
// Otherwise it creates the ShipsGo tracking: 1 credit, or free when ShipsGo
// already has that number (409, the existing tracking is reused).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mirrors portal.is_kui_staff(), as the other staff routes do.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');
const json = (body, status) => Response.json(body, { status });
const clean = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');

export async function POST(req) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const svc = serviceClient();
  if (!url || !anon || !svc || !process.env.SHIPSGO_API_KEY) {
    return json({ ok:false, error:'Server is not configured for tracking.' }, 500);
  }

  // ── 1. WHO IS CALLING ──────────────────────────────────────────────────────
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return json({ ok:false, error:'Not signed in.' }, 401);
  const sb = createClient(url, anon, {
    db:{ schema:'vessl' },
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization: 'Bearer '+token } },
  });
  const { data:{ user }, error:authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ ok:false, error:'Session is not valid.' }, 401);
  if (!isStaffEmail(user.email)) return json({ ok:false, error:'Not authorised to track.' }, 401);

  // ── 2. THE SHIPMENT, AS THE CALLER SEES IT ─────────────────────────────────
  let body;
  try { body = await req.json(); } catch { return json({ ok:false, error:'Malformed request.' }, 400); }
  const id = body && typeof body.shipment_id === 'string' ? body.shipment_id : '';
  if (!id) return json({ ok:false, error:'No shipment given.' }, 400);
  const { data:sh, error:shErr } = await sb.from('shipments')
    .select('id,bill_of_lading,booking_number,container_no,tracking_provider,tracking_ref').eq('id', id).maybeSingle();
  if (shErr) return json({ ok:false, error:'Could not read the shipment: '+shErr.message }, 502);
  if (!sh) return json({ ok:false, error:'That shipment could not be read.' }, 404);

  try {
    // ── 3. ALREADY TRACKED: REFRESH, FREE ────────────────────────────────────
    if (sh.tracking_provider === 'shipsgo' && sh.tracking_ref) {
      const result = await applyShipsgo(svc, sh.id, sh.tracking_ref);
      return json({ ok:true, created:false, refreshed:true, credits:null, result }, 200);
    }

    // ── 4. THE NUMBER: B/L, ELSE BOOKING, AS A BOOKING NUMBER; ELSE CONTAINER ──
    const bl = clean(sh.bill_of_lading) || clean(sh.booking_number);
    const box = clean(sh.container_no);
    let fields;
    if (bl) {
      if (!/^[A-Z0-9/-]+$/.test(bl)) return json({ ok:false, error:'The bill of lading has characters ShipsGo does not accept.' }, 400);
      fields = { booking_number: bl };
      const carrier = await carrierByCode(bl.slice(0, 4));
      if (carrier) fields.carrier = carrier.scac;
    } else if (/^[A-Z]{4}[0-9]{7}$/.test(box)) {
      fields = { container_number: box };
    } else {
      return json({ ok:false, error:'Save a bill of lading, booking number or container number (4 letters and 7 digits) first.' }, 400);
    }

    const made = await createShipment(fields);
    const ref = String(made.id);

    // ONE SHIPMENT PER TRACKING. The unique index would refuse a second row
    // with the same ref; saying which shipment has it is more use than that.
    const { data:other } = await sb.from('shipments').select('id,shipment_number')
      .eq('tracking_provider', 'shipsgo').eq('tracking_ref', ref).neq('id', sh.id).limit(1);
    if (other && other[0]) {
      return json({ ok:false, error:'That number is already tracked on shipment '+(other[0].shipment_number || other[0].id)+'.',
                    credits: made.credits }, 409);
    }

    const result = await applyShipsgo(svc, sh.id, ref);
    return json({ ok:true, created:!made.existed, reused:made.existed, credits:made.credits, cost:made.cost, result }, 200);
  } catch (err) {
    const status = err instanceof ShipsgoError ? (err.status === 402 ? 402 : 502) : 500;
    return json({ ok:false, error: (err && err.message) || String(err) }, status);
  }
}
