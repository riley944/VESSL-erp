import { SB } from '@/lib/supabase';
import { notifyOrderNote } from '@/lib/orderNotify';
import { peopleNames, isEveryone } from '@/lib/people';

// ── POSTING A NOTE ON AN ORDER ──────────────────────────────────────────────
// One path for the Notes & Activity card (app/components/OrderNotesPanel) and
// the note box on the Create PO / Create SO modals: insert the order_notes row,
// then, when anyone was picked, ask /api/orders/notify to email them.
//
// column: 'purchase_order_id' | 'sales_order_id'. picked: staff emails, or []
// for a quiet note (notify_to NULL, no email). Never throws.
//
// Returns { saved, note, mail, error }:
//   saved false -- nothing was inserted (an empty box, or the insert failed:
//                  error says why)
//   mail null   -- a quiet note, nothing to send
//   mail        -- lib/orderNotify's { ok, sent, skipped, wouldHaveSent, error }
export async function postOrderNote({ column, orderId, body, picked = [] }) {
  const text = (body || '').trim();
  if (!text || !orderId) return { saved:false, note:null, mail:null, error:null };
  try {
    let author = null;
    try { const { data } = await SB.auth.getUser(); author = data?.user?.email || null; } catch (e) {}
    const { data:note, error } = await SB.from('order_notes')
      .insert({ [column]: orderId, body: text, author_email: author, notify_to: picked.length ? picked : null })
      .select().single();
    if (error || !note) return { saved:false, note:null, mail:null, error:(error && error.message) || 'the note did not come back' };
    if (!picked.length) return { saved:true, note, mail:null, error:null };
    const mail = await notifyOrderNote(note.id);
    return { saved:true, note, mail, error:null };
  } catch (e) {
    return { saved:false, note:null, mail:null, error:(e && e.message) || String(e) };
  }
}

// What happened, in the card's words: "Note posted.", "Note posted & Riley
// King notified.", "Note posted & everyone notified.", "Note posted (email
// skipped)." The names are who the route actually mailed -- the author left out
// -- or, with the local test address on, who it would have mailed.
export function noteOutcome(res, staff, picked = []) {
  if (!res || !res.saved) return null;
  const m = res.mail;
  if (!m || m.skipped) return 'Note posted.';
  if (!m.ok) return 'Note posted (email skipped).';
  const mailed = m.wouldHaveSent || m.sent || [];
  return 'Note posted & ' + (isEveryone(staff, picked) ? 'everyone' : peopleNames(staff, mailed)) + ' notified.';
}

// The note typed on a Create PO / Create SO modal, posted once the order
// exists. The order is already saved, so nothing here can undo it: the outcome
// is said in a toast -- a failure in one that stays until it is closed. An
// empty box posts nothing and says nothing.
// what: 'Purchase order' | 'Sales order'.
export async function postNoteAfterCreate({ what, column, orderId, body, picked = [], staff = [] }) {
  if (!(body || '').trim()) return;
  const res = await postOrderNote({ column, orderId, body, picked });
  const toast = (msg, type, sticky) => window._toast?.(msg, type, null, sticky ? { sticky:true } : null);
  if (!res.saved) {
    toast(what + ' created, but the note wasn’t saved' + (res.error ? ' — ' + res.error : '') + '. Add it from the order’s Notes & Activity.', 'err', true);
    return;
  }
  if (res.mail && !res.mail.ok) {
    toast(what + ' created and the note saved, but its email didn’t send' + (res.mail.error ? ' — ' + res.mail.error : '') + '.', 'err', true);
    return;
  }
  toast(what + ' created · ' + noteOutcome(res, staff, picked), 'ok', false);
}
