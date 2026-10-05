import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import ExcelJS from 'exceljs';
import {
  groupBySheet, countsOf, buildTestingWorkbook, testingFileName, testingSubject,
  testingText, testingHtml, previewRow, todayIn, TESTING_SHEETS,
} from '@/lib/testingDigest';

// ── GET /api/testing/digest ───────────────────────────────────────────────────
// The weekly testing email. Four lists of products whose stage or compliance
// still needs Jenn -- nothing set, compliance only, stage only, compliance TBD --
// as one workbook attached to a short email with the four counts.
//
// THE SAME SHAPE AS /api/rfq/digest, deliberately. A scheduled call has no
// session to run as, so it reads with the service-role key, and script 108 is
// what makes that safe: the key can execute vessl.testing_digest_rows() and
// rfq_digest_rows() and read no table at all. Which product lands on which sheet
// is decided in that function, once, to the Testing page rules.
//
// THREE TEST MODES, all behind the cron secret:
//   ?dryRun=1          sends nothing; returns the counts, subject, body and the
//                      first rows of each sheet as JSON
//   ?dryRun=1&file=1   sends nothing; returns the workbook itself. file=1 on its
//                      own is treated as a dry run too, so a mistyped test URL
//                      can never reach Jenn
//   ?onlyMe=1          sends the real email to REHEARSAL_TO alone, [TEST] in
//                      the subject, no cc
// With no query string -- which is what the cron sends -- it goes to Jenn with
// Matt copied. It sends even when every count is zero.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Same verified domain as the RFQ mail and the portal notifications.
const FROM = 'King Universal <notify@vessl.io>';
// Jenn owns compliance and stage on the Testing page, so the list is hers.
const DIGEST_TO = 'jenn@kinguniversal.com';
const DIGEST_CC = 'mattdillon@kinguniversal.com';
// Where ?onlyMe=1 sends instead. Kept apart from DIGEST_CC for the reason the RFQ
// digest gives -- one is who else sees the real mail, the other is who receives a
// rehearsal, and merging them is how a test could one day reach Jenn.
const REHEARSAL_TO = 'mattdillon@kinguniversal.com';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const json = (body, status) => Response.json(body, { status });

export async function GET(req) {
  // ── 1. THE SECRET, BEFORE ANYTHING ELSE ────────────────────────────────────
  // Vercel sends Authorization: Bearer $CRON_SECRET on scheduled invocations.
  // Checked first, so no mode -- dry runs included -- shows the list without it.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ ok:false, error:'Not configured.' }, 500);
  const authz = req.headers.get('authorization') || '';
  if (authz !== 'Bearer ' + secret) return json({ ok:false, error:'Not authorised.' }, 401);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiKey = process.env.RESEND_API_KEY;
  if (!url || !serviceKey || !apiKey) return json({ ok:false, error:'Server is not configured to send the testing email.' }, 500);

  const { searchParams } = new URL(req.url);
  const wantFile = searchParams.get('file') === '1';
  const dryRun = searchParams.get('dryRun') === '1' || wantFile;
  const onlyMe = searchParams.get('onlyMe') === '1';

  // ── 2. READ, THROUGH THE ONE DOOR SCRIPT 108 OPENS ─────────────────────────
  const sb = createClient(url, serviceKey, {
    db:{ schema:'vessl' },
    auth:{ persistSession:false, autoRefreshToken:false },
  });
  const { data:rows, error } = await sb.rpc('testing_digest_rows');
  if (error) return json({ ok:false, error:'Could not read the testing list: '+error.message }, 502);

  const bySheet = groupBySheet(rows);
  const counts = countsOf(bySheet);
  const subject = testingSubject(counts);
  const day = todayIn();
  const filename = testingFileName(day);

  // ── 3. DRY RUNS RETURN, THEY DO NOT SEND ───────────────────────────────────
  if (dryRun && !wantFile) {
    return json({
      ok:true, sent:false, dryRun:true, subject,
      counts: Object.fromEntries(counts.map(c => [c.name, c.count])),
      text: testingText(counts),
      preview: Object.fromEntries(TESTING_SHEETS.map(s => [s.name, (bySheet[s.key] || []).slice(0, 5).map(previewRow)])),
    }, 200);
  }

  let buffer;
  try {
    buffer = await buildTestingWorkbook(ExcelJS, bySheet);
  } catch (e) {
    return json({ ok:false, error:'Could not build the workbook: '+(e && e.message ? e.message : String(e)) }, 500);
  }

  if (dryRun) {
    return new Response(Buffer.from(buffer), { status:200, headers:{
      'Content-Type': XLSX,
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Cache-Control': 'no-store',
    }});
  }

  // ── 4. SEND ────────────────────────────────────────────────────────────────
  try {
    const resend = new Resend(apiKey);
    const { data, error:sendErr } = await resend.emails.send({
      from: FROM,
      // onlyMe is the rehearsal path -- one recipient, no cc, so a test cannot
      // reach Jenn however the query string is mangled.
      to: onlyMe ? [REHEARSAL_TO] : [DIGEST_TO],
      ...(onlyMe ? {} : { cc: [DIGEST_CC] }),
      subject: onlyMe ? '[TEST] ' + subject : subject,
      text: testingText(counts),
      html: testingHtml(counts),
      attachments: [{ filename, content: Buffer.from(buffer) }],
    });
    // Resend reports failures in `error` rather than throwing.
    if (sendErr) return json({ ok:false, error: sendErr.message || 'Resend rejected the message.' }, 502);
    if (!data || !data.id) return json({ ok:false, error:'Resend accepted the request but returned no id.' }, 502);
    return json({ ok:true, sent:true, onlyMe, counts: Object.fromEntries(counts.map(c => [c.name, c.count])), id:data.id }, 200);
  } catch (e) {
    return json({ ok:false, error:'Send failed: '+(e && e.message ? e.message : String(e)) }, 502);
  }
}
