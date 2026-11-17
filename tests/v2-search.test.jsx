// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import GlobalSearch from '@/app/v2/GlobalSearch';

const mock = vi.hoisted(() => ({ queries: [], error: false, empty: false }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => {
  const chain = {
    select: () => chain,
    eq: (column, value) => { mock.queries.push([table, column, value]); return chain; },
    ilike: (column, value) => { mock.queries.push([table, column, value]); return chain; },
    order: () => chain,
    limit: () => Promise.resolve({ data: mock.empty ? [] : table === 'products' ? [{ id: 'p1', style_number: 'ABC-1', name: 'Shirt' }] : [{ id: 'c1', name: 'ABC Company' }], error: mock.error ? { message: 'Unavailable' } : null }),
  };
  return chain;
} } }));
afterEach(() => { cleanup(); mock.queries = []; mock.error = false; mock.empty = false; });

it('shows matching products and clients with links to their detail pages', async () => {
  const user = userEvent.setup();
  render(<GlobalSearch />);
  await user.type(screen.getByRole('textbox'), 'ABC');
  expect((await screen.findByRole('link', { name: /ABC-1/ })).getAttribute('href')).toBe('/v2/products/ABC-1');
  expect(screen.getByRole('link', { name: /ABC Company/ }).getAttribute('href')).toBe('/v2/clients/c1');
  expect(mock.queries).toContainEqual(['companies', 'type', 'client']);
  expect(mock.queries).toContainEqual(['products', 'style_number', '%ABC%']);
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('link', { name: /ABC-1/ })).toBeNull();
});

it('shows an empty state and escapes search wildcard characters', async () => {
  mock.empty = true;
  const user = userEvent.setup();
  render(<GlobalSearch />);
  await user.type(screen.getByRole('textbox'), 'A%_');
  expect(await screen.findByText('No matching products or clients.')).toBeTruthy();
  expect(mock.queries).toContainEqual(['products', 'style_number', '%A\\%\\_%']);
});

it('shows a useful message when a search fails', async () => {
  mock.error = true;
  const user = userEvent.setup();
  render(<GlobalSearch />);
  await user.type(screen.getByRole('textbox'), 'ABC');
  expect(await screen.findByText('Search unavailable. Try again.')).toBeTruthy();
});
