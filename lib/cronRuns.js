import { createClient } from '@supabase/supabase-js';

// ── A RECORD OF EVERY SCHEDULED RUN ─────────────────────────────────────────
// withCronRun wraps the work of a cron route in a vessl.cron_runs row (script
// 144): started before the work, finished with the route's own JSON result
// after it, so a row with no finish is a run that timed out or crashed. The
// routes call it AFTER their CRON_SECRET check, so a stranger's request leaves
// no row. Used by /api/tracking/refresh, /api/rfq/digest and /api/testing/digest.
//
// THE RECORD IS A BYSTANDER. Every database call here is caught and logged,
// never thrown: a missing table (144 not run), a bad key or a slow Supabase
// cannot fail or change the run, and the route's response goes back untouched.
// Both functions are service_role only, as tracking_refs_due is.

// NO CACHING. In a GET route handler Next 14 can keep a fetch response in its
// data cache, and Vercel keeps that cache across deployments -- so a Supabase
// call with the same body (tracking_refs_due's is always empty) could be
// answered from an earlier run instead of the database. That happened on 4 Nov:
// the 12:00 refresh got the ref list of the 3 Nov 18:48 run. Every server
// Supabase client used by a cron route passes this fetch.
export const noStoreFetch = (input, init) => fetch(input, { ...(init || {}), cache: 'no-store' });

// Kept out of the stored result: bulky, or message content rather than outcome.
const DROP = ['html', 'text', 'preview'];

function client() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { db:{ schema:'vessl' }, auth:{ persistSession:false, autoRefreshToken:false },
    global:{ fetch: noStoreFetch } });
}

const warn = (what, err) => console.warn('cron_runs: could not ' + what + ': ' + ((err && err.message) || String(err)));

async function start(sb, route, req) {
  if (!sb) return null;
  try {
    const { data, error } = await sb.rpc('cron_run_start', {
      p_route: route,
      p_deployment: process.env.VERCEL_GIT_COMMIT_SHA || null,
      p_user_agent: req.headers.get('user-agent') || null,
    });
    if (error) { warn('start the record', error); return null; }
    return data || null;
  } catch (err) {
    warn('start the record', err);
    return null;
  }
}

async function finish(sb, id, ok, status, detail) {
  if (!sb || !id) return;
  try {
    const { error } = await sb.rpc('cron_run_finish', { p_id: id, p_ok: ok, p_http_status: status, p_detail: detail });
    if (error) warn('finish the record', error);
  } catch (err) {
    warn('finish the record', err);
  }
}

// The route's JSON body, without DROP; a file answer (the testing digest's
// ?file=1) is recorded by its type only.
async function resultOf(res) {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return { content_type: type };
  try {
    const body = await res.clone().json();
    if (!body || typeof body !== 'object') return null;
    for (const k of DROP) delete body[k];
    return body;
  } catch {
    return null;
  }
}

export async function withCronRun(route, req, work) {
  const sb = client();
  const id = await start(sb, route, req);
  let res;
  try {
    res = await work();
  } catch (err) {
    await finish(sb, id, false, 500, { error: (err && err.message) || String(err) });
    throw err;
  }
  const detail = await resultOf(res);
  await finish(sb, id, res.ok && !(detail && detail.ok === false), res.status, detail);
  return res;
}
