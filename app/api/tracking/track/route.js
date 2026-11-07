import { createClient } from '@supabase/supabase-js';
import { createShipment, carrierByCode, ShipsgoError, createAirShipment, awbDigits } from '@/lib/shipsgo';
import { serviceClient, applyShipsgo, TRACKING_PROVIDERS, kindOf } from '@/lib/trackingServer';
import { isCourierNumber, COURIER_NUMBER_ERROR } from '@/lib/shipmentStatus';

// ── POST /api/tracking/track ─────────────────────────────────────────────────
// The Track button on a shipment. Body { shipment_id }, nothing else: the route
// re-reads the row as the caller, so it can only track a shipment that staff
// can see, with the number that is SAVED on it.
//
// ONE CREDIT PER B/L (script 140). Every live shipment on the same B/L -- or
// booking number when there is no B/L -- follows one ShipsGo shipment, each
// row its own container. So:
//   already tracked             refresh by its ref, free; siblings added
//                               since are attached too
//   a sibling is tracked        use that ref -- no ShipsGo create at all
//   otherwise                   create the tracking (1 credit, or free when
//                               ShipsGo already has the number: 409, reused)
//                               and attach every live sibling in one call
// A shipment with only a container number is tracked on its own.
//
// REFRESH ONLY. { shipment_id, refresh_only:true, max_age_hours } is the
// Shipments page keeping tracked rows current as it loads (refreshStale in
// lib/trackShipment.js). It only ever takes the free refresh: a row that is not
// tracked, is delivered or cancelled, or was checked within max_age_hours
// answers ok with skipped, and the request never reaches a create. The check is
// made on the row as read here, so two people opening the page at once cost
// one ShipsGo read.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Mirrors portal.is_kui_staff(), as the other staff routes do.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');
const json = (body, status) => Response.json(body, { status });
// The same normalising as apply_tracking_group: uppercase, no spaces.
const clean = v => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
const numberOf = r => clean(r.bill_of_lading) || clean(r.booking_number);

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
  const refreshOnly = body.refresh_only === true;
  const maxAgeHours = Number(body.max_age_hours) || 0;
  const { data:sh, error:shErr } = await sb.from('shipments')
    .select('id,status,bill_of_lading,booking_number,container_no,tracking_provider,tracking_ref,tracking_checked_at').eq('id', id).maybeSingle();
  if (shErr) return json({ ok:false, error:'Could not read the shipment: '+shErr.message }, 502);
  if (!sh) return json({ ok:false, error:'That shipment could not be read.' }, 404);

  if (refreshOnly) {
    if (!TRACKING_PROVIDERS.includes(sh.tracking_provider) || !sh.tracking_ref) return json({ ok:true, skipped:'not tracked' }, 200);
    if (['delivered', 'cancelled'].includes(sh.status)) return json({ ok:true, skipped:sh.status }, 200);
    const checked = sh.tracking_checked_at ? Date.parse(sh.tracking_checked_at) : 0;
    if (maxAgeHours > 0 && checked && Date.now() - checked < maxAgeHours * 3600000) {
      return json({ ok:true, skipped:'fresh' }, 200);
    }
  }

  // How it travels (script 147): ocean by B/L, booking or container; air by
  // AWB (script 148). Read on its own so a database without the column still
  // tracks; missing reads as ocean. A courier row (offered no more) reads air.
  const { data:modeRow, error:modeErr } = await sb.from('shipments').select('transport_mode').eq('id', id).maybeSingle();
  const rawMode = (!modeErr && modeRow && modeRow.transport_mode) || 'ocean';
  const mode = rawMode === 'courier' ? 'air' : rawMode;
  if (mode !== 'ocean' && mode !== 'air') {
    return json({ ok:false, error:'Tracking for this mode is coming.' }, 400);
  }

  const number = numberOf(sh);

  try {
    // ── 3. ALREADY TRACKED: REFRESH, FREE ────────────────────────────────────
    // By the row's own provider -- air refreshes its ref alone, no siblings.
    if (TRACKING_PROVIDERS.includes(sh.tracking_provider) && sh.tracking_ref) {
      const kind = kindOf(sh.tracking_provider);
      const result = await applyShipsgo(svc, sh.tracking_ref, kind === 'air' ? null : (number || null), kind);
      return json({ ok:true, created:false, refreshed:true, credits:null, result }, 200);
    }

    // Tracking is for shipments still moving -- a credit on a delivered or
    // cancelled one buys nothing, and apply_tracking_group would not attach it.
    if (['delivered', 'cancelled'].includes(sh.status)) {
      return json({ ok:false, error:'This shipment is '+sh.status+'; tracking is for shipments still on the way.' }, 400);
    }

    // ── AIR: THE AWB, ONE SHIPMENT ───────────────────────────────────────────
    // The AWB is kept in bill_of_lading (labelled AWB on an air card). Created at
    // ShipsGo, or reused free on a 409; the row is marked with the air provider
    // and ref as the caller (under RLS), then applied with no number, so an AWB
    // never attaches another row.
    if (mode === 'air') {
      const awb = awbDigits(sh.bill_of_lading);
      if (!awb) return json({ ok:false, error:'Save the AWB first -- the airline prefix and 8 digits, e.g. 160-12345678.' }, 400);
      const made = await createAirShipment({ awb_number: awb });
      const ref = String(made.id);
      const { error:mErr } = await sb.from('shipments')
        .update({ tracking_provider:'shipsgo_air', tracking_ref:ref }).eq('id', sh.id);
      if (mErr) return json({ ok:false, error:'Tracking was created but could not be saved: '+mErr.message, credits:made.credits }, 502);
      const result = await applyShipsgo(svc, ref, null, 'air');
      return json({ ok:true, created:!made.existed, reused:made.existed, credits:made.credits, cost:made.cost, result }, 200);
    }

    // Ocean from here. A courier parcel number is not a B/L or booking: refused
    // before any ShipsGo call (lib/shipmentStatus isCourierNumber).
    if (isCourierNumber(number)) return json({ ok:false, error:COURIER_NUMBER_ERROR }, 400);

    // ── 4. A SIBLING ALREADY TRACKED: ITS REF, NO CREDIT ─────────────────────
    if (number) {
      const { data:tracked, error:tErr } = await sb.from('shipments')
        .select('id,bill_of_lading,booking_number,tracking_ref')
        .eq('tracking_provider', 'shipsgo').not('tracking_ref', 'is', null);
      if (tErr) return json({ ok:false, error:'Could not read the tracked shipments: '+tErr.message }, 502);
      const sib = (tracked || []).find(r => numberOf(r) === number);
      if (sib) {
        const result = await applyShipsgo(svc, sib.tracking_ref, number);
        return json({ ok:true, created:false, reused:true, sibling:true, credits:null, result }, 200);
      }
    }

    // ── 5. THE NUMBER: B/L, ELSE BOOKING, AS A BOOKING NUMBER; ELSE CONTAINER ──
    const box = clean(sh.container_no);
    let fields;
    if (number) {
      if (!/^[A-Z0-9/-]+$/.test(number)) return json({ ok:false, error:'The bill of lading has characters ShipsGo does not accept.' }, 400);
      fields = { booking_number: number };
      const carrier = await carrierByCode(number.slice(0, 4));
      if (carrier) fields.carrier = carrier.scac;
    } else if (/^[A-Z]{4}[0-9]{7}$/.test(box)) {
      fields = { container_number: box };
    } else {
      return json({ ok:false, error:'Save a bill of lading, booking number or container number (4 letters and 7 digits) first.' }, 400);
    }

    const made = await createShipment(fields);
    const ref = String(made.id);

    // A container-only shipment has no number to attach siblings by, so the
    // caller marks this one row with the ref (as staff, under RLS) and the
    // function finds it by that.
    if (!number) {
      const { error:mErr } = await sb.from('shipments')
        .update({ tracking_provider:'shipsgo', tracking_ref:ref }).eq('id', sh.id);
      if (mErr) return json({ ok:false, error:'Tracking was created but could not be saved: '+mErr.message, credits:made.credits }, 502);
    }

    const result = await applyShipsgo(svc, ref, number || null);
    return json({ ok:true, created:!made.existed, reused:made.existed, credits:made.credits, cost:made.cost, result }, 200);
  } catch (err) {
    const status = err instanceof ShipsgoError ? (err.status === 402 ? 402 : 502) : 500;
    return json({ ok:false, error: (err && err.message) || String(err) }, status);
  }
}
