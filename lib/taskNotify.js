import { SB } from '@/lib/supabase';

// ── THE ASSIGNEE'S EMAIL, FROM THE SERVER ───────────────────────────────────
// One call for every place a task is created -- the Quotes page's Assign, the
// tasks queued on the quote form, and the bell panel's own Add box. Only the
// new task's id goes over: /api/tasks/notify re-reads the row and writes the
// email itself, from tasks@vessl.io with Reply going to the assigner.
//
// The task is already saved by now, so a failed send says so in a toast that
// stays until it is closed -- the assigner may need to tell the person some
// other way. Never throws: a task is never lost to its email.
//
// who: the assignee's name, for that toast.
export async function notifyTaskAssigned(taskId, who) {
  const failed = why => window._toast?.('Task saved, but the email to ' + (who || 'them') + " didn't send"
    + (why ? ' — ' + why : ''), 'err', null, { sticky: true });
  try {
    if (!taskId) { failed("the new task's id did not come back"); return; }
    const { data: { session } } = await SB.auth.getSession();
    const token = session && session.access_token;
    if (!token) { failed('your session has expired'); return; }
    const res = await fetch('/api/tasks/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ taskId }),
    });
    let out = null;
    try { out = await res.json(); } catch { out = null; }
    if (!res.ok || !out || !out.ok) { failed((out && out.error) || 'HTTP ' + res.status); return; }
  } catch (err) {
    failed((err && err.message) || String(err));
  }
}
