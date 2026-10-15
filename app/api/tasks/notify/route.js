import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

// ── POST /api/tasks/notify ───────────────────────────────────────────────────
// Emails the person a task was just assigned to, via Resend. Built the way
// /api/rfq/send is: the caller's own Supabase session, a staff gate, and only an
// id across the wire -- the route re-reads the task, so it can only ever
// describe a real row and cannot be handed a message to relay.
//
// Replaces the Supabase edge function send-email, which took to, from and html
// from any signed-in caller -- an open relay on a verified domain.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The sender, in one place. vessl.io is verified in Resend for sending only, so
// Reply goes to the assigner instead (set per message below).
const FROM = 'VESSL Tasks <tasks@vessl.io>';
const APP_URL = 'https://orders.vessl.io';
// A task older than this is not "just assigned": the route refuses it, so a
// stray call -- or a curious one -- cannot email anybody about the old tasks.
const FRESH_MINUTES = 15;
const SUBJECT_TASK_CHARS = 60;

// Mirrors portal.is_kui_staff(), as /api/rfq/send does.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

const json = (body, status) => Response.json(body, { status });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
// The stored name, else the mailbox: kristy@ -> Kristy.
const nameOf = (email, staff) => {
  const p = staff.find(s => same(s.email, email));
  if (p && p.full_name) return p.full_name;
  return (email || '').split('@')[0].replace(/[._-]+/g, ' ').trim().replace(/\b\w/g, c => c.toUpperCase());
};
const firstName = full => (full || '').trim().split(/\s+/)[0] || full;
// Cut at a word near the limit, so the subject does not end mid-word.
const clip = (s, n) => {
  const t = (s || '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const sp = cut.lastIndexOf(' ');
  return (sp > n * 0.6 ? cut.slice(0, sp) : cut) + '…';
};
const when = iso => new Date(iso).toLocaleString('en-US', { timeZone:'America/New_York', weekday:'short', month:'short',
  day:'numeric', hour:'numeric', minute:'2-digit' }) + ' ET';

export async function POST(req) {
  const apiKey = process.env.RESEND_API_KEY;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!apiKey || !url || !anon) return json({ ok:false, error:'Server is not configured to send mail.' }, 500);

  // ── 1. WHO IS CALLING ──────────────────────────────────────────────────────
  // The token rides on the client as well as through getUser(), so every read
  // below runs as the caller under RLS -- see the box in /api/rfq/send.
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
  if (!isStaffEmail(user.email)) return json({ ok:false, error:'Not authorised to send.' }, 401);

  // ── 2. WHAT WAS ASKED FOR: A TASK ID, NOTHING ELSE ─────────────────────────
  let body;
  try { body = await req.json(); } catch { return json({ ok:false, error:'Malformed request.' }, 400); }
  const taskId = body && typeof body.taskId === 'string' ? body.taskId : '';
  if (!taskId) return json({ ok:false, error:'No task given.' }, 400);

  const { data:task, error:tErr } = await sb.from('tasks')
    .select('id,quote_id,quote_label,assigned_to,assigned_by,task,done,created_at')
    .eq('id', taskId).single();
  if (tErr && tErr.code !== 'PGRST116') return json({ ok:false, error:'Could not read the task: '+(tErr.message||tErr.code) }, 502);
  if (!task) return json({ ok:false, error:'That task could not be read — it may not exist, or your session may not have access to it.' }, 404);

  // ── 3. WHETHER THIS ONE GETS AN EMAIL ──────────────────────────────────────
  // Only the person who assigned it can announce it, and only while it is new.
  if (!same(task.assigned_by, user.email)) return json({ ok:false, error:'Only the person who assigned a task can send its email.' }, 403);
  const ageMin = (Date.now() - new Date(task.created_at).getTime()) / 60000;
  if (!(ageMin <= FRESH_MINUTES)) return json({ ok:false, error:'That task is not new; no email is sent for it.' }, 409);
  const to = (task.assigned_to || '').trim();
  if (!to || !to.includes('@')) return json({ ok:false, error:'The task has no assignee address.' }, 400);
  // A task you give yourself needs no email. Not a failure.
  if (same(to, task.assigned_by)) return json({ ok:true, skipped:'self' }, 200);

  // ── 4. THE WORDS ───────────────────────────────────────────────────────────
  // Names from staff_profiles; a refused or empty read falls back to the mailbox.
  const { data:staffRows } = await sb.from('staff_profiles').select('email,full_name');
  const staff = staffRows || [];
  const fromName = nameOf(task.assigned_by, staff);
  const toName = nameOf(to, staff);
  // The quote's number beside its label, when the quote can be read.
  let quoteCode = '';
  if (task.quote_id) {
    const { data:q } = await sb.from('quotes').select('quote_code').eq('id', task.quote_id).maybeSingle();
    quoteCode = (q && q.quote_code) || '';
  }
  const ref = [task.quote_label, quoteCode].filter(Boolean).join(' · ');
  const stamp = when(task.created_at);
  const subject = 'New task from ' + firstName(fromName) + ': ' + clip(task.task, SUBJECT_TASK_CHARS);

  const text = [
    'Hi ' + firstName(toName) + ',',
    '',
    fromName + ' assigned you a task in VESSL:',
    '',
    task.task || '',
    '',
    ref ? 'Quote: ' + ref : null,
    'Assigned by ' + fromName + ', ' + stamp,
    '',
    'Open VESSL: ' + APP_URL,
    '',
    'Reply to this email to reach ' + firstName(fromName) + '.',
  ].filter(l => l !== null).join('\n');

  const row = (label, value) => value ? '<tr><td style="padding:3px 14px 3px 0;color:#64748b;font-size:13px;white-space:nowrap;vertical-align:top">' + label
    + '</td><td style="padding:3px 0;color:#0b1120;font-size:13px">' + esc(value) + '</td></tr>' : '';
  const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:8px;color:#0b1120">'
    + '<p style="font-size:15px;margin:0 0 4px">Hi ' + esc(firstName(toName)) + ',</p>'
    + '<p style="font-size:15px;margin:0 0 16px"><strong>' + esc(fromName) + '</strong> assigned you a task in VESSL:</p>'
    + '<div style="background:#f6f8fb;border:1px solid #e6eaf0;border-radius:10px;padding:16px 18px;margin:0 0 14px">'
    + '<p style="margin:0;font-size:15px;line-height:1.5;white-space:pre-wrap">' + esc(task.task) + '</p></div>'
    + '<table style="border-collapse:collapse;margin:0 0 20px">' + row('Quote', ref) + row('Assigned by', fromName) + row('When', stamp) + '</table>'
    + '<a href="' + APP_URL + '" style="display:inline-block;background:#0b1530;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open VESSL</a>'
    + '<p style="color:#94a3b8;font-size:11px;margin:22px 0 0">Reply to this email to reach ' + esc(firstName(fromName)) + '. King Universal · VESSL</p>'
    + '</div>';

  // ── 5. SEND ────────────────────────────────────────────────────────────────
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      replyTo: task.assigned_by,
      subject,
      text,
      html,
    });
    if (error) return json({ ok:false, error: error.message || 'Resend rejected the message.' }, 502);
    if (!data || !data.id) return json({ ok:false, error:'Resend accepted the request but returned no id.' }, 502);
    return json({ ok:true, id:data.id, to }, 200);
  } catch (e) {
    return json({ ok:false, error:'Send failed: '+(e && e.message ? e.message : String(e)) }, 502);
  }
}
