import { SB } from '@/lib/supabase';

// ── WHETHER A TASK HAS BEEN SEEN (seen_at, script 115) ──────────────────────
// Shared by the bell's Tasks panel and the Quotes page's Tasks modal. Opening
// either list marks every open task assigned to you as seen -- once, only where
// seen_at is empty, and never with an email. The badges count what is left:
// open tasks assigned to you that you have not seen.
//
// BEFORE 115 RUNS the column does not exist. Rows then arrive without a seen_at
// key, and a task with no key counts as seen -- so no badge lights up on a
// database that cannot record the opposite. The update is refused for the
// same reason; that refusal is swallowed and nothing is said.

const same = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();
const isMissingCol = error => !!error && /seen_at/.test(error.message || '');

// Unseen: open, yours, and a seen_at the database says is empty.
export const isUnseen = (t, email) =>
  !!t && !t.done && same(t.assigned_to, email) && Object.prototype.hasOwnProperty.call(t, 'seen_at') && t.seen_at === null;

export const unseenCount = (tasks, email) => (tasks || []).filter(t => isUnseen(t, email)).length;

// Marks the given rows seen. Returns the ids it marked, [] when there was
// nothing to mark or the column is missing.
export async function markSeen(tasks, email) {
  const ids = (tasks || []).filter(t => isUnseen(t, email)).map(t => t.id);
  if (!ids.length) return [];
  const { error } = await SB.from('tasks').update({ seen_at: new Date().toISOString() }).in('id', ids).is('seen_at', null);
  if (error) {
    if (!isMissingCol(error)) console.warn('Could not mark tasks seen:', error.message);
    return [];
  }
  return ids;
}

// Inserts a task and returns { data, error } as .select().single() would. A task
// you give yourself starts seen. Before 115 the insert naming seen_at is
// refused, and it is sent again without it.
export async function insertTask(task, select = '*') {
  const self = !!task.assigned_to && same(task.assigned_to, task.assigned_by);
  if (self) {
    const res = await SB.from('tasks').insert({ ...task, seen_at: new Date().toISOString() }).select(select).single();
    if (!isMissingCol(res.error)) return res;
  }
  return SB.from('tasks').insert(task).select(select).single();
}

// MM/DD/YYYY, as a date field shows it.
export const taskDay = s => { const d = s ? new Date(s) : null; return d && !isNaN(d) ? d.toLocaleDateString('en-US', { month:'2-digit', day:'2-digit', year:'numeric' }) : ''; };

// Oldest first, ties by id.
export const byCreated = (a, b) => (a.created_at || '') < (b.created_at || '') ? -1 : (a.created_at || '') > (b.created_at || '') ? 1
  : String(a.id) < String(b.id) ? -1 : 1;

// Open is red, done is green -- the Testing tab's Expired and OK.
export const TASK_TONE = { open: { color:'#B91C1C', bg:'#FEE2E2' }, done: { color:'#15803D', bg:'#15803D' } };
