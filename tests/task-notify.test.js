// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { notifyTaskAssigned } from '@/lib/taskNotify';

vi.mock('@/lib/supabase', () => ({ SB: { auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) } } }));
afterEach(() => vi.unstubAllGlobals());

it('reports a notification failure separately from the saved task', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }));
  const failed = vi.fn();
  await notifyTaskAssigned('t1', 'Person', failed);
  expect(failed).toHaveBeenCalledWith("Task saved, but the email to Person didn't send — Unavailable");
});
