import { serviceClient, applyShipsgo, TRACKING_PROVIDERS, kindOf } from '@/lib/trackingServer';
import { withCronRun } from '@/lib/cronRuns';

// ── GET /api/tracking/refresh ────────────────────────────────────────────────
// Daily at 12:00 UTC (vercel.json). The backstop behind the webhook: re-reads
// every tracking ref that still has a shipment not delivered or cancelled, and
// applies it to all the shipments carrying that ref -- one read per B/L, not
// per container. Reads are free at ShipsGo; the company limit is 100 requests
// a minute, so the run is sequential and stops at MAX refs, oldest check
// first -- whatever is left goes first tomorrow.
//
// The list comes from vessl.tracking_refs_due() (script 140, one row per ref),
// the one read the service role has, and every write goes through
// apply_tracking_group.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// No fetch in this route is ever served from Next's data cache (lib/cronRuns).
export const fetchCache = 'force-no-store';
export const maxDuration = 300;

const MAX = 80;
const json = (body, status) => Response.json(body, { status });

export async function GET(req) {
  // Vercel sends Authorization: Bearer $CRON_SECRET on scheduled invocations.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ ok:false, error:'Not configured.' }, 500);
  if ((req.headers.get('authorization') || '') !== 'Bearer ' + secret) return json({ ok:false, error:'Not authorised.' }, 401);

  // Recorded in vessl.cron_runs from here on (lib/cronRuns.js, script 144).
  return withCronRun('/api/tracking/refresh', req, () => run());
}

async function run() {
  const svc = serviceClient();
  if (!svc || !process.env.SHIPSGO_API_KEY) return json({ ok:false, error:'Server is not configured for tracking.' }, 500);

  const { data:due, error } = await svc.rpc('tracking_refs_due');
  if (error) return json({ ok:false, error:'Could not read the tracked shipments: '+error.message }, 502);

  // Ocean and air refs (script 148), each read from its own ShipsGo API.
  const refs = (due || []).filter(r => TRACKING_PROVIDERS.includes(r.tracking_provider)).slice(0, MAX);
  const out = { ok:true, due:(due || []).length, checked:0, shipments:0, moved:0, failed:[] };
  for (const r of refs) {
    try {
      const res = await applyShipsgo(svc, r.tracking_ref, null, kindOf(r.tracking_provider));
      out.checked += 1;
      out.shipments += ((res && res.rows) || []).length;
      out.moved += Number((res && res.moved) || 0);
    } catch (err) {
      out.failed.push({ tracking_ref:r.tracking_ref, error:(err && err.message) || String(err) });
      // Rate limited: stop here rather than burn the rest of the minute.
      if (err && err.status === 429) break;
    }
  }
  return json(out, 200);
}
