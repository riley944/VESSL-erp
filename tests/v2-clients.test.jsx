// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClientsPage from '@/app/v2/clients/page';

const mock = vi.hoisted(() => ({ queries: [], fail: false }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/app/v2/V2Shell', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/app/v2/clients/EditClientModal', () => ({ default: ({ id, onSaved }) => <button onClick={() => onSaved({ id, name: 'Renamed' })}>Save test edit</button> }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => {
  const chain = {
    select: () => chain,
    eq: (column, value) => { mock.queries.push([table, column, value]); return chain; },
    order: () => chain,
    range: () => Promise.resolve(mock.fail ? { error: { message: 'Failed' } } : { error: null, data: table === 'companies'
      ? [{ id: 'c2', name: 'Zebra' }, { id: 'c1', name: 'Acme & Co' }]
      : [{ id: 'p1', client_company_id: 'c1' }, { id: 'p2', client_company_id: 'c1' }] }),
  };
  return chain;
} } }));
beforeEach(() => { mock.fail = false; mock.queries = []; });
afterEach(cleanup);

it('lists clients with active product counts and links to their filtered quotes', async () => {
  const user = userEvent.setup();
  render(<ClientsPage />);
  const link = await screen.findByRole('link', { name: 'Acme & Co' });
  expect(link.getAttribute('href')).toBe('/v2/clients/c1');
  const row = link.parentElement;
  expect(within(row).getByText('2')).toBeTruthy();
  expect(within(row).getByRole('link', { name: '2 active products for Acme & Co' }).getAttribute('href')).toBe('/v2/products?clientId=c1');
  expect(within(row).getByRole('link', { name: '2 active products for Acme & Co' }).getAttribute('title')).toBe('See products');
  expect(within(row).getByRole('link', { name: 'See quotes for Acme & Co' }).getAttribute('href')).toBe('/v2/quotes?clientId=c1&clientName=Acme+%26+Co');
  expect(within(row).getByRole('link', { name: 'See quotes for Acme & Co' }).querySelector('svg').classList.contains('lucide-file-text')).toBe(true);
  expect(within(row).getByRole('button', { name: 'Edit Acme & Co' }).querySelector('svg').classList.contains('lucide-pencil')).toBe(true);
  const actions = within(row).getByRole('button', { name: 'Edit Acme & Co' }).parentElement;
  expect(actions.children[0]).toBe(within(row).getByRole('button', { name: 'Edit Acme & Co' }));
  expect(actions.children[1]).toBe(within(row).getByRole('link', { name: 'See quotes for Acme & Co' }));
  const emptyRow = screen.getByRole('link', { name: 'Zebra' }).parentElement;
  expect(within(emptyRow).getByText('0').tagName).not.toBe('A');
  expect(within(emptyRow).queryByRole('link', { name: '0 active products for Zebra' })).toBeNull();
  expect(mock.queries).toContainEqual(['products', 'active', true]);
  expect(mock.queries).toContainEqual(['companies', 'type', 'client']);
  expect(screen.queryByText('Needs attention')).toBeNull();
  await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'zeb');
  expect(screen.queryByText('Acme & Co')).toBeNull();
  expect(screen.getByRole('link', { name: 'Zebra' })).toBeTruthy();
  await user.type(screen.getByRole('searchbox', { name: 'Search clients' }), 'x');
  expect(screen.getByText('No clients match your search.')).toBeTruthy();
});

it('shows a retryable error when loading fails', async () => {
  mock.fail = true;
  const user = userEvent.setup();
  render(<ClientsPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  mock.fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('link', { name: 'Zebra' })).toBeTruthy();
});

it('opens the new company wizard from the clients page', async () => {
  const user = userEvent.setup();
  render(<ClientsPage />);
  await user.click(screen.getByRole('button', { name: '+ New company' }));
  expect(screen.getByRole('dialog', { name: 'New Company' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: 'Company details' }).getAttribute('aria-selected')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('edits the chosen client and updates its name and quotes link', async () => {
  const user = userEvent.setup();
  render(<ClientsPage />);
  await screen.findByRole('link', { name: 'Acme & Co' });
  await user.click(screen.getByRole('button', { name: 'Edit Acme & Co' }));
  await user.click(screen.getByRole('button', { name: 'Save test edit' }));
  expect(screen.getByRole('link', { name: 'Renamed' }).getAttribute('href')).toBe('/v2/clients/c1');
  expect(screen.getByRole('link', { name: 'See quotes for Renamed' }).getAttribute('href')).toContain('clientName=Renamed');
});
