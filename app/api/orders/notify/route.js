import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { personName, isEveryone } from '@/lib/people';

// ── POST /api/orders/notify ──────────────────────────────────────────────────
// Emails the people picked on a note just posted on a purchase order or a sales
// order. Built the way /api/tasks/notify is: the caller's own Supabase session,
// a staff gate, and only the note's id across the wire -- the route re-reads
// the note and writes the email itself, so it can only ever describe a real
// note and cannot be handed a message or an address to relay.
//
// Replaces the browser's call to the Supabase edge function send-email.
//
// WHO. notify_to holds the staff emails picked (All is saved as the full list).
// NULL is a quiet note: no email, { skipped:true } (script 122). Every pick
// must be a staff_profiles row; the author is left out unless they are the only
// pick; anyone whose notifications_enabled is false is left out.
//
// TEST OVERRIDE. With ORDER_NOTIFY_TEST_TO set (local .env.local only), every
// message goes to that one address instead, its subject starting [TEST], and
// wouldHaveSent reports who it would have gone to.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The sender, in one place. vessl.io is verified in Resend for sending only, so
// Reply goes to the note's author instead.
const FROM = 'VESSL Orders <orders@vessl.io>';
const APP_URL = 'https://orders.vessl.io';
// A note older than this is not "just posted": the route refuses it, so a stray
// call cannot email anybody about old notes.
const FRESH_MINUTES = 15;

// Mirrors portal.is_kui_staff(), as /api/tasks/notify does.
const isStaffEmail = email =>
  typeof email === 'string' && email.trim().toLowerCase().endsWith('@kinguniversal.com');

const json = (body, status) => Response.json(body, { status });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

export async function POST(req) {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!apiKey || !url || !anon) return json({ ok:false, error:'Server is not configured to send mail.' }, 500);

    // ── 1. WHO IS CALLING ────────────────────────────────────────────────────
    // The token rides on the client too, so every read below runs as the
    // caller under RLS (order_notes and staff_profiles are staff-only).
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

    // ── 2. WHAT WAS ASKED FOR: A NOTE ID, NOTHING ELSE ───────────────────────
    let body;
    try { body = await req.json(); } catch { return json({ ok:false, error:'Malformed request.' }, 400); }
    const noteId = body && typeof body.noteId === 'string' ? body.noteId : '';
    if (!noteId) return json({ ok:false, error:'No note given.' }, 400);

    const { data:note, error:nErr } = await sb.from('order_notes')
      .select('id,purchase_order_id,sales_order_id,body,author_email,notify_to,assigned_to,created_at')
      .eq('id', noteId).maybeSingle();
    if (nErr) return json({ ok:false, error:'Could not read the note: '+(nErr.message||nErr.code) }, 502);
    if (!note) return json({ ok:false, error:'That note could not be read — it may not exist, or your session may not have access to it.' }, 404);

    // ── 3. WHETHER THIS ONE GETS AN EMAIL ────────────────────────────────────
    // Only the author can announce it, and only while it is new.
    if (!same(note.author_email, user.email)) return json({ ok:false, error:'Only the person who posted a note can send its email.' }, 403);
    const ageMin = (Date.now() - new Date(note.created_at).getTime()) / 60000;
    if (!(ageMin <= FRESH_MINUTES)) return json({ ok:false, error:'That note is not new; no email is sent for it.' }, 409);

    // THE PICKS: notify_to, or the one assigned_to of a note from before script
    // 121. Neither is a quiet note -- nothing to send.
    const raw = Array.isArray(note.notify_to) && note.notify_to.length ? note.notify_to
      : (note.assigned_to ? [note.assigned_to] : []);
    if (!raw.length) return json({ ok:true, sent:[], skipped:true }, 200);

    // Every pick must be on the staff list, and each counts once whatever its case.
    const { data:staffRows, error:sErr } = await sb.from('staff_profiles').select('email,full_name,notifications_enabled');
    if (sErr) return json({ ok:false, error:'Could not read the staff list: '+(sErr.message||sErr.code) }, 502);
    const staff = staffRows || [];
    const picks = [];
    for (const e of raw) {
      const s = staff.find(x => same(x.email, e));
      if (!s) return json({ ok:false, error:'The note names someone who is not on the staff list.' }, 400);
      if (!picks.some(p => same(p.email, s.email))) picks.push(s);
    }
    // Those people, the author left out -- unless the author is the only pick,
    // who is then mailed, as /api/tasks/notify mails a task you give yourself.
    // Then anyone who has turned notifications off (Settings) is left out.
    const others = picks.filter(s => !same(s.email, note.author_email));
    const recipients = (others.length ? others : picks)
      .filter(s => s.notifications_enabled !== false).map(s => s.email);
    if (!recipients.length) return json({ ok:true, sent:[], skipped:true }, 200);

    // ── 4. THE WORDS ─────────────────────────────────────────────────────────
    // The order number and its CLIENT -- a purchase order or a sales order.
    let orderNumber = '', clientName = '', kind = 'order';
    if (note.sales_order_id) {
      kind = 'sales order';
      const { data:so } = await sb.from('sales_orders')
        .select('so_number,client:companies!client_company_id(name)')
        .eq('id', note.sales_order_id).maybeSingle();
      orderNumber = (so && so.so_number) || '';
      clientName = (so && so.client && so.client.name) || '';
    } else if (note.purchase_order_id) {
      const { data:po } = await sb.from('purchase_orders')
        .select('order_number,client:companies!client_company_id(name)')
        .eq('id', note.purchase_order_id).maybeSingle();
      orderNumber = (po && po.order_number) || '';
      clientName = (po && po.client && po.client.name) || '';
    }
    const whoName = personName(staff, note.author_email) || 'Someone';
    // "@Riley King, @Matt Dillon" -- everyone picked, as the note on the page
    // names them; "@Everyone" when All was picked.
    const atNames = isEveryone(staff, picks.map(s => s.email)) ? '@Everyone'
      : picks.map(s => '@' + personName(staff, s.email)).join(', ');

    const testTo = (process.env.ORDER_NOTIFY_TEST_TO || '').trim();
    const subject = (testTo ? '[TEST] ' : '') + 'Task for you · ' + orderNumber;

    const text = [
      atNames + ' — task from ' + kind + ' ' + orderNumber,
      clientName ? 'Client: ' + clientName : null,
      '',
      note.body || '',
      '',
      'Posted by ' + whoName,
      '',
      'Open in Vessl: ' + APP_URL,
    ].filter(l => l !== null).join('\n');

    const prefix = '<strong style="color:#3461e0">' + esc(atNames) + '</strong> — task from ' + esc(kind) + ' ';
    const clientSuffix = clientName ? ' &middot; ' + esc(clientName) : '';
    const html = '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:8px">'
      + '<p style="font-size:13px;color:#64748b;margin:0 0 4px">' + prefix + '<strong style="color:#0b1120">' + esc(orderNumber) + '</strong>' + clientSuffix + '</p>'
      + '<div style="background:#f6f8fb;border:1px solid #e6eaf0;border-radius:10px;padding:16px 18px;margin:10px 0 16px">'
      + '<p style="margin:0;font-size:15px;color:#0b1120;line-height:1.55;white-space:pre-wrap">' + esc(note.body) + '</p></div>'
      + '<p style="font-size:12px;color:#94a3b8;margin:0 0 16px">Posted by ' + esc(whoName) + '</p>'
      + '<a href="' + APP_URL + '" style="display:inline-block;background:#0b1530;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">Open in Vessl &rarr;</a>'
      + '</div>';

    // ── 5. SEND ──────────────────────────────────────────────────────────────
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: testTo ? [testTo] : recipients,
      replyTo: note.author_email || undefined,
      subject,
      text,
      html,
    });
    if (error) return json({ ok:false, error: error.message || 'Resend rejected the message.' }, 502);
    if (!data || !data.id) return json({ ok:false, error:'Resend accepted the request but returned no id.' }, 502);
    return json({ ok:true, id:data.id, sent: testTo ? [testTo] : recipients, ...(testTo ? { wouldHaveSent: recipients } : {}) }, 200);
  } catch (e) {
    return json({ ok:false, error:'Send failed: '+(e && e.message ? e.message : String(e)) }, 502);
  }
}
