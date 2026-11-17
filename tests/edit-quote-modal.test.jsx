// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import EditQuoteModal from '@/app/v2/quotes/EditQuoteModal';

const mock = vi.hoisted(() => ({ id: null, result: null }));
vi.mock('@/app/quotes', () => ({ default: ({ editQuote, modalOnly }) => <div>Editing {editQuote.quote_code}: {String(modalOnly)}</div> }));
vi.mock('@/lib/supabase', () => ({ SB: { from: () => ({ select: () => ({ eq: (_, id) => { mock.id = id; return { maybeSingle: async () => mock.result }; } }) }) } }));
beforeEach(() => { mock.id = null; mock.result = { data: { id: 'q1', quote_code: 'Q-1', tiers: [{ qty: 50 }] }, error: null }; });
afterEach(cleanup);

it('loads the full quote and opens the existing editor', async () => {
  render(<EditQuoteModal id="q1" onClose={() => {}} onSaved={() => {}} />);
  expect(await screen.findByText('Editing Q-1: true')).toBeTruthy();
  expect(mock.id).toBe('q1');
});

it('shows a load error rather than opening an empty editor', async () => {
  mock.result = { data: null, error: { message: 'offline' } };
  render(<EditQuoteModal id="q1" onClose={() => {}} onSaved={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load quote.');
});
