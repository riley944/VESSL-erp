import { SB } from '@/lib/supabase';

// ── THE ORDER NOTE'S EMAIL, FROM THE SERVER ─────────────────────────────────
// Called once a note on a purchase order is saved. Only the note's id goes
// over: /api/orders/notify re-reads the row, picks the recipients from the team
// list and writes the email itself, from orders@vessl.io with Reply going to
// the author.
//
// Returns rather than toasting, so the order page keeps its own status line:
//   { ok, sent, skipped } -- skipped when nobody but the author would get it --
//   plus wouldHaveSent when the route is in test mode (ORDER_NOTIFY_TEST_TO),
//   so the status still names the real recipients.
// Never throws: a note is never lost to its email.
//
// assigneeName is accepted for symmetry with notifyTaskAssigned and to name
// the person in an error; the route works out the recipients itself.
export async function notifyOrderNote(noteId, assigneeName) {
  try {
    if (!noteId) return { ok:false, sent:[], skipped:false, error:"the new note's id did not come back" };
    const { data: { session } } = await SB.auth.getSession();
    const token = session && session.access_token;
    if (!token) return { ok:false, sent:[], skipped:false, error:'your session has expired' };
    const res = await fetch('/api/orders/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ noteId }),
    });
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!res.ok || !out || !out.ok) {
      return { ok:false, sent:[], skipped:false, error:(out && out.error) || 'HTTP ' + res.status, to: assigneeName || null };
    }
    return { ok:true, sent: out.sent || [], skipped: !!out.skipped,
      ...(out.wouldHaveSent ? { wouldHaveSent: out.wouldHaveSent } : {}) };
  } catch (err) {
    return { ok:false, sent:[], skipped:false, error:(err && err.message) || String(err) };
  }
}
