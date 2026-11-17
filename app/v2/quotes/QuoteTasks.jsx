'use client';

import { useEffect, useState } from 'react';
import { SB } from '@/lib/supabase';
import { insertTask } from '@/lib/taskSeen';
import { notifyTaskAssigned } from '@/lib/taskNotify';

export default function QuoteTasks({ quote, draft, setDraft, busy, setBusy }) {
  const [tasks, setTasks] = useState(null);
  const [staff, setStaff] = useState([]);
  const [assignee, setAssignee] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    setTasks(null); setError('');
    Promise.all([SB.from('tasks').select('*').eq('quote_id', quote.id).order('created_at'), SB.from('staff_profiles').select('email,full_name').order('full_name')])
      .then(([taskResult, staffResult]) => { if (!active) return; if (taskResult.error || staffResult.error) throw taskResult.error || staffResult.error; setTasks(taskResult.data || []); setStaff(staffResult.data || []); })
      .catch(err => { if (active) setError(err.message || 'Could not load tasks.'); });
    return () => { active = false; };
  }, [quote.id, retry]);

  const add = async () => {
    if (busy || !draft.trim() || !assignee) return;
    setBusy(true); setError('');
    try {
      const { data: auth, error: authError } = await SB.auth.getSession();
      if (authError) throw authError;
      const task = { quote_id: quote.id, quote_label: `${quote.product || 'Quote'}${quote.sku ? ` · ${quote.sku}` : ''}`, assigned_to: assignee, assigned_by: auth?.session?.user?.email || null, task: draft.trim(), done: false };
      const { data, error: taskError } = await insertTask(task);
      if (taskError) throw taskError;
      setTasks(previous => [...previous, data]); setDraft(''); setAssignee('');
      void notifyTaskAssigned(data?.id, staff.find(person => person.email === assignee)?.full_name || assignee, setError);
    } catch (err) { setError(err.message || 'Could not save task.'); }
    finally { setBusy(false); }
  };

  return <>
    <p>Tasks save separately from quote changes.</p>
    {error && <p role="alert">{error}</p>}
    {tasks === null ? <>
      <p>Loading tasks…</p>
      {error && <button type="button" className="btn btn-ghost" onClick={() => setRetry(n => n + 1)}>Try again</button>}
    </> : <>
      <ul>{tasks.map(task => <li key={task.id}>{task.task} · {task.assigned_to || 'Unassigned'}{task.done ? ' · Done' : ''}</li>)}</ul>
      <div className="form-row"><label htmlFor="quote-task">New task</label><input id="quote-task" className="form-input" value={draft} onChange={e => setDraft(e.target.value)} /></div>
      <div className="form-row"><label htmlFor="quote-task-assignee">Assign to</label><select id="quote-task-assignee" className="form-select" value={assignee} onChange={e => setAssignee(e.target.value)}><option value="">Select a person</option>{staff.filter(person => person.email).map(person => <option key={person.email} value={person.email}>{person.full_name || person.email}</option>)}</select></div>
      <button type="button" className="btn btn-ghost" disabled={busy || !draft.trim() || !assignee} onClick={add}>{busy ? 'Adding…' : 'Add task'}</button>
    </>}
  </>;
}
