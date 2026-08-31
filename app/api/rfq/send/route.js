import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import ExcelJS from 'exceljs';
import { buildRfqWorkbook, rfqFileName, rfqSubject, rfqBody } from '@/lib/rfqSheet';

// ── POST /api/rfq/send ───────────────────────────────────────────────────────
// Emails the freight RFQ workbook to one forwarder contact, via Resend.
//
// THIS IS THE APP'S FIRST SERVER-SIDE CODE, and the first thing in it that a
// stranger could reach. Everything else runs in the browser behind a Supabase
// session; a route does not. Unauthenticated, this endpoint would let anyone
// send mail from a verified vessl.io address -- the fastest possible route to
// having the domain blacklisted. The gate below is not defence in depth, it is
// the only defence.
//
// Node runtime, not Edge: ExcelJS needs Node streams.
export const runtime = 'nodejs';
// Never prerendered or cached. It has side effects and reads a bearer token.
export const dynamic = 'force-dynamic';

const FROM = 'King Universal Freight <rfq@vessl.io>';
// vessl.io is verified for SENDING only -- receiving is off -- so a forwarder
// hitting Reply must be pointed somewhere that actually accepts mail.
//
// Kristy, per Riley: she runs the RFQ round and imports the replies, so the
// filled sheets should land in her mailbox rather than being forwarded on. This
// is the address a FORWARDER sees, not an internal one -- changing it changes
// who receives every bid.
const DEFAULT_REPLY_TO = 'kristy@kinguniversal.com';
// Kristy keeps a copy of every RFQ she sends. BCC rather than a second `to`:
// the forwarder must not see an internal address on the recipient line, and one
// that replies to it instead of to Reply-To sends the bid to the wrong place.
//
// A SEPARATE CONSTANT FROM DEFAULT_REPLY_TO even though both are her address
// today. "Who receives the bids" and "who keeps a file copy" are different
// decisions and will not necessarily move together -- collapsing them into one
// name is how the next person changes one and silently changes the other.
const ARCHIVE_BCC = 'kristy@kinguniversal.com';

// The same test page.jsx applies at the UI, mirroring portal.is_kui_staff() in
// Postgres: auth.jwt()->>'email' ilike '%@kinguniversal.com'. Three copies of one
// rule is two too many, but the alternative is the server importing a client
// module -- so it is repeated here and named as a mirror, the way
// CreateProductModal repeats the eFiling strings.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

const json = (body, status) => Response.json(body, { status });

export async function POST(req) {
  // Fail closed on a missing key rather than letting the SDK throw something
  // shaped like a send failure -- those mean different things to a caller.
  const apiKey = process.env.RESEND_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !url || !anon) return json({ ok:false, error:'Server is not configured to send mail.' }, 500);

  // ── 1. WHO IS CALLING ──────────────────────────────────────────────────────
  // The access token comes from the caller's Supabase session. getUser() checks
  // it against Supabase rather than decoding it here: a JWT this route parsed
  // itself would be trusting a string the caller supplied.
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return json({ ok:false, error:'Not signed in.' }, 401);

  // ┌───────────────────────────────────────────────────────────────────────┐
  // │ THE TOKEN GOES ON THE CLIENT, NOT JUST THROUGH getUser().             │
  // │                                                                       │
  // │ getUser(token) VALIDATES a token; it does not authenticate the client  │
  // │ that called it. Without the Authorization header below, every query    │
  // │ this route makes goes out as `anon` -- and every policy on             │
  // │ shipment_quotes (kui_staff_only, shipment_quotes_auth_all, staff_only) │
  // │ targets the `authenticated` role. RLS then matches nothing, .single()  │
  // │ returns no rows, and the route reports "quote could not be found" for  │
  // │ a quote sitting in plain sight on the board.                          │
  // │                                                                       │
  // │ Passing it here also means the read runs AS THE CALLER: this route can │
  // │ never see a quote the person who invoked it could not open themselves. │
  // │ That is the property worth having -- it is why this uses the anon key  │
  // │ plus a user token rather than a service-role key, which would bypass   │
  // │ RLS entirely and make the staff gate above the only thing standing     │
  // │ between a bug and every row in the table.                             │
  // └───────────────────────────────────────────────────────────────────────┘
  const sb = createClient(url, anon, {
    db:{ schema:'vessl' },
    auth:{ persistSession:false, autoRefreshToken:false },
    global:{ headers:{ Authorization: 'Bearer '+token } },
  });
  const { data:{ user }, error:authErr } = await sb.auth.getUser(token);
  if (authErr || !user) return json({ ok:false, error:'Session is not valid.' }, 401);
  if (!isStaffEmail(user.email)) return json({ ok:false, error:'Not authorised to send.' }, 401);

  // ── 2. WHAT WAS ASKED FOR ──────────────────────────────────────────────────
  let body;
  try { body = await req.json(); } catch { return json({ ok:false, error:'Malformed request.' }, 400); }
  const quoteId = body && body.quoteId;
  const contact = (body && body.contact) || {};
  const to = typeof contact.email === 'string' ? contact.email.trim() : '';
  if (!quoteId) return json({ ok:false, error:'No quote given.' }, 400);
  // Deliberately shallow -- a real address is Resend's to judge, and a regex
  // here would reject valid ones while a determined caller passes anything.
  if (!to || !to.includes('@')) return json({ ok:false, error:'No valid recipient address.' }, 400);
  // Sanitised unconditionally: a malformed reply-to falls back to the default
  // rather than reaching Resend. There is no environment-gated variant of this
  // line -- a dev-only pass-through lived here to exercise the rejection path
  // during testing and was removed before shipping, per PRESHIP.md.
  const replyTo = (typeof body.replyTo === 'string' && body.replyTo.includes('@')) ? body.replyTo.trim() : DEFAULT_REPLY_TO;

  // ── 3. THE QUOTE IS RE-READ, NEVER TAKEN FROM THE REQUEST ──────────────────
  // The client posts an id and nothing else about the cargo. If it posted the
  // quote fields, this route would build whatever workbook it was handed and
  // mail it from a verified domain -- which is an open relay with extra steps.
  // Reading it here also means the attachment always matches what is stored,
  // even if the modal is showing something stale.
  const { data:quote, error:qErr } = await sb
    .from('shipment_quotes')
    .select('*, client:companies!client_company_id(name)')
    .eq('id', quoteId)
    .single();
  // A missing row and a refused read are different failures and must not report
  // the same sentence. PostgREST answers .single() with PGRST116 when it matched
  // nothing -- which is ALSO what an RLS refusal looks like from here, since a
  // policy that does not match makes the row invisible rather than forbidden.
  // Saying so is what turns the next occurrence into a one-line diagnosis
  // instead of a dev-server log dive; the first one cost exactly that.
  if (qErr && qErr.code !== 'PGRST116') {
    return json({ ok:false, error:'Could not read that freight quote: '+(qErr.message||qErr.code) }, 502);
  }
  if (!quote) {
    return json({ ok:false, error:'That freight quote could not be read — it may not exist, or your session may not have access to it.' }, 404);
  }

  // ── 4. BUILD AND SEND ──────────────────────────────────────────────────────
  let buffer;
  try {
    buffer = await buildRfqWorkbook(ExcelJS, quote, (quote.client||{}).name);
  } catch (e) {
    return json({ ok:false, error:'Could not build the RFQ sheet: '+(e && e.message ? e.message : String(e)) }, 500);
  }

  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      bcc: [ARCHIVE_BCC],
      replyTo: replyTo,
      subject: rfqSubject(quote),
      // The RESOLVED replyTo, not DEFAULT_REPLY_TO: the body names the address a
      // Reply actually reaches, so the two cannot drift. With no override in the
      // request these are the same value; with one, the sentence follows the
      // header instead of contradicting it.
      text: rfqBody(quote, replyTo),
      attachments: [{ filename: rfqFileName(quote), content: Buffer.from(buffer) }],
    });
    // Resend reports failures in `error` rather than by throwing, so this branch
    // is the common one and must not be left to the catch below.
    if (error) return json({ ok:false, error: error.message || 'Resend rejected the message.' }, 502);
    // No id means no evidence it was accepted, and the client writes 'sent' only
    // on an id -- so a missing one is a failure here rather than a silent pass.
    if (!data || !data.id) return json({ ok:false, error:'Resend accepted the request but returned no id.' }, 502);
    // This route does NOT write the quote row. The client owns that write, so
    // the status, the timestamp, the forwarder and the message id all land
    // together under one session -- and a send whose row-write fails is visible
    // to the person who pressed the button rather than swallowed on the server.
    return json({ ok:true, id:data.id, to }, 200);
  } catch (e) {
    return json({ ok:false, error:'Send failed: '+(e && e.message ? e.message : String(e)) }, 502);
  }
}
