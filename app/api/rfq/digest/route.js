import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ── GET /api/rfq/digest ──────────────────────────────────────────────────────
// The weekly RFQ reminder. Lists sent freight RFQs with no bid recorded against
// them, oldest first, and mails the list to Kristy.
//
// SCHEDULED, SO THERE IS NO CALLER TO RUN AS. /api/rfq/send authenticates the
// person who pressed the button and runs every read under their token, which is
// why it can refuse the service-role key -- a read it makes can never see a row
// the caller could not open themselves. A cron invocation has no session, so that
// property is not available here and something else has to take its place.
//
// What takes its place is script 21. service_role carries rolbypassrls, so RLS
// does not constrain it and GRANTS are the only limit -- and the only grants it
// holds on this schema are USAGE and EXECUTE on vessl.rfq_digest_rows(). It can
// call one function returning one list. It cannot read shipment_quotes,
// forwarder_bids or companies, verified after that script committed. So the key
// below is not a skeleton key; it opens one door.
//
// Node runtime for parity with the send route. Never cached -- it has side
// effects and reads a secret header.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same verified sender as the RFQ itself.
const FROM = 'King Universal Freight <rfq@vessl.io>';
// Kristy runs the RFQ round and chases the forwarders, so the digest is hers to
// act on.
const DIGEST_TO = 'kristy@kinguniversal.com';
// Copied, not blind-copied. Everyone on this mail is internal and it helps for
// Kristy to see that the list is also being watched.
const DIGEST_CC = 'mattdillon@kinguniversal.com';
// Where ?onlyMe=1 sends instead. Deliberately not DIGEST_CC even though both are
// the same address today -- one is who else sees the real digest, the other is
// who receives a rehearsal, and collapsing them means a test send could one day
// reach Kristy because somebody edited the wrong constant.
const REHEARSAL_TO = 'mattdillon@kinguniversal.com';

const json = (body, status) => Response.json(body, { status });

// Buckets come from the database so the thresholds live in one place. The order
// here is the order they print, worst first.
const BUCKETS = [
  ['stale',      'Stale — needs a decision, not a chase', '22 days or more'],
  ['chase',      'Worth chasing',                         '8 to 21 days'],
  ['awaiting',   'Awaiting reply',                        '2 to 7 days'],
  ['unassigned', 'No forwarder recorded — assign one',    'cannot be chased until a forwarder is set'],
];

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[c]));

function renderDigest(rows) {
  const groups = BUCKETS
    .map(([key, heading, note]) => [heading, note, rows.filter(r => r.bucket === key)])
    .filter(([, , list]) => list.length > 0);

  const sections = groups.map(([heading, note, list]) => `
    <div style="margin-bottom:22px">
      <div style="font-size:13px;font-weight:600;color:#1d1d1f">${esc(heading)}
        <span style="font-weight:400;color:#86868b">— ${esc(note)}</span></div>
      <table style="border-collapse:collapse;margin-top:8px;font-size:13px">
        <tr style="color:#86868b;text-align:left">
          <th style="padding:4px 18px 4px 0;font-weight:500">RFQ</th>
          <th style="padding:4px 18px 4px 0;font-weight:500">Forwarder</th>
          <th style="padding:4px 18px 4px 0;font-weight:500">Sent</th>
          <th style="padding:4px 0;font-weight:500">Days</th>
        </tr>
        ${list.map(r => `
        <tr>
          <td style="padding:3px 18px 3px 0">${esc(r.quote_number)}</td>
          <td style="padding:3px 18px 3px 0">${r.forwarder ? esc(r.forwarder) : '<i style="color:#86868b">none recorded</i>'}</td>
          <td style="padding:3px 18px 3px 0;color:#86868b">${esc(r.sent_on)}</td>
          <td style="padding:3px 0">${esc(r.days_outstanding)}</td>
        </tr>`).join('')}
      </table>
    </div>`).join('');

  // THE HONEST SENTENCE, and it is not decoration. Bids are entered by hand when
  // the replies are imported, so an empty forwarder_bids row means no bid has
  // been RECORDED -- it cannot distinguish a forwarder who never answered from
  // one whose reply is sitting unentered. Saying "no response received" would be
  // a claim this data cannot support, and would send somebody to chase a
  // forwarder who already replied.
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1d1d1f;max-width:640px">
    <div style="font-size:17px;font-weight:600;margin-bottom:4px">RFQs with no bid recorded in VESSL</div>
    <div style="font-size:13px;color:#86868b;margin-bottom:20px">
      ${rows.length} open ${rows.length === 1 ? 'RFQ' : 'RFQs'}, oldest first.
      A bid may have been replied to and not yet entered — this lists what VESSL has, not what has arrived.
    </div>
    ${sections}
    <div style="font-size:12px;color:#86868b;margin-top:24px">Weekly from VESSL. Counts come straight from the freight quote records.</div>
  </div>`;
}

export async function GET(req) {
  // ── 1. THE SECRET, BEFORE ANYTHING ELSE ────────────────────────────────────
  // Vercel sends Authorization: Bearer $CRON_SECRET on scheduled invocations
  // when CRON_SECRET is set on the project. Checked first so an unauthenticated
  // caller cannot even learn whether the route is configured, and so ?dryRun=1
  // is not a way to read the client list without the secret.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ ok:false, error:'Not configured.' }, 500);
  const authz = req.headers.get('authorization') || '';
  if (authz !== 'Bearer ' + secret) return json({ ok:false, error:'Not authorised.' }, 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // SUPABASE_SERVICE_ROLE_KEY currently holds the LEGACY service_role JWT. The
  // project is on Supabase's newer API-key system, where the equivalent is an
  // sb_secret_... key, and the legacy key still works alongside it.
  //
  // IF LEGACY KEYS ARE EVER DISABLED, this route stops with the 500 below rather
  // than failing at the read -- so the symptom will be a digest that never
  // arrives and a log line saying the server is not configured, which points
  // here rather than at Supabase. The fix is to swap this variable's VALUE for
  // the new sb_secret key in Vercel. The name does not change and nor does any
  // code, because script 21 grants EXECUTE to the service_role ROLE, and the new
  // secret key resolves to that same role.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !serviceKey || !apiKey) return json({ ok:false, error:'Server is not configured to send the digest.' }, 500);

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get('dryRun') === '1';
  const onlyMe = searchParams.get('onlyMe') === '1';

  // ── 2. READ, THROUGH THE ONE DOOR THE KEY OPENS ────────────────────────────
  const sb = createClient(url, serviceKey, {
    db:{ schema:'vessl' },
    auth:{ persistSession:false, autoRefreshToken:false },
  });
  const { data:rows, error } = await sb.rpc('rfq_digest_rows');
  if (error) return json({ ok:false, error:'Could not read the RFQ list: '+error.message }, 502);

  // NOTHING OUTSTANDING IS A REAL OUTCOME AND IS NOT MAILED. A weekly note
  // saying there is nothing to report trains people to ignore the weekly note.
  if (!rows || rows.length === 0) return json({ ok:true, sent:false, reason:'nothing outstanding', count:0 }, 200);

  const html = renderDigest(rows);
  const subject = 'RFQs with no bid recorded — ' + rows.length + ' open';

  // ── 3. DRY RUN RETURNS, IT DOES NOT SEND ───────────────────────────────────
  if (dryRun) return json({ ok:true, sent:false, dryRun:true, count:rows.length, subject, html }, 200);

  // ── 4. SEND ────────────────────────────────────────────────────────────────
  try {
    const resend = new Resend(apiKey);
    const { data, error:sendErr } = await resend.emails.send({
      from: FROM,
      // onlyMe is the rehearsal path -- one recipient, no cc, so a test cannot
      // reach Kristy however the query string is mangled.
      to: onlyMe ? [REHEARSAL_TO] : [DIGEST_TO],
      ...(onlyMe ? {} : { cc: [DIGEST_CC] }),
      subject: onlyMe ? '[TEST] ' + subject : subject,
      html,
    });
    // Resend reports failures in `error` rather than throwing, so this is the
    // common branch and must not be left to the catch below.
    if (sendErr) return json({ ok:false, error: sendErr.message || 'Resend rejected the message.' }, 502);
    if (!data || !data.id) return json({ ok:false, error:'Resend accepted the request but returned no id.' }, 502);
    return json({ ok:true, sent:true, onlyMe, count:rows.length, id:data.id }, 200);
  } catch (e) {
    return json({ ok:false, error:'Send failed: '+(e && e.message ? e.message : String(e)) }, 502);
  }
}
