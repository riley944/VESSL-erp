import { serviceClient, applyShipsgo } from '@/lib/trackingServer';

// ── GET /api/tracking/refresh ────────────────────────────────────────────────
// Daily at 12:00 UTC (vercel.json). The backstop behind the webhook: re-reads
// every tracked shipment that is not delivered or cancelled and applies it.
// Reads are free at ShipsGo; the company limit is 100 requests a minute, so the
// run is sequential and stops at MAX, oldest check first -- whatever is left
// goes first tomorrow.
//
// The list comes from vessl.tracking_refs_due() (script 138), the one read the
// service role has, and every write goes through apply_tracking_update.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX = 80;
const json = (body, status) => Response.json(body, { status });

export async function GET(req) {
  // Vercel sends Authorization: Bearer $CRON_SECRET on scheduled invocations.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ ok:false, error:'Not configured.' }, 500);
  if ((req.headers.get('authorization') || '') !== 'Bearer ' + secret) return json({ ok:false, error:'Not authorised.' }, 401);

  const svc = serviceClient();
  if (!svc || !process.env.SHIPSGO_API_KEY) return json({ ok:false, error:'Server is not configured for tracking.' }, 500);

  const { data:due, error } = await svc.rpc('tracking_refs_due');
  if (error) return json({ ok:false, error:'Could not read the tracked shipments: '+error.message }, 502);

  const rows = (due || []).filter(r => r.tracking_provider === 'shipsgo').slice(0, MAX);
  const out = { ok:true, due:(due || []).length, checked:0, moved:0, failed:[] };
  for (const r of rows) {
    try {
      const res = await applyShipsgo(svc, r.shipment_id, r.tracking_ref);
      out.checked += 1;
      if (res && res.moved) out.moved += 1;
    } catch (err) {
      out.failed.push({ shipment_id:r.shipment_id, error:(err && err.message) || String(err) });
      // Rate limited: stop here rather than burn the rest of the minute.
      if (err && err.status === 429) break;
    }
  }
  return json(out, 200);
}
