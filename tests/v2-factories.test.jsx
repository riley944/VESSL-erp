// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FactoriesPage from '@/app/v2/factories/page';
import FactoryPage from '@/app/v2/factories/[id]/page';

const mock = vi.hoisted(() => ({ fail: false, missing: false, noContact: false, contactFail: false, queries: [], updates: [] }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'f1' }) }));
vi.mock('@/app/v2/V2Shell', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/lib/supabaseQuotes', () => ({ SBQ: {} }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => {
  const filters = [];
  let payload;
  let operation;
  const company = { id: 'f1', type: 'factory', name: 'Acme Factory', email: 'hello@example.com', website: 'example.com' };
  const chain = {
    select: () => chain,
    eq: (column, value) => { filters.push([column, value]); mock.queries.push([table, column, value]); return chain; },
    order: () => chain,
    update: value => { payload = value; operation = 'update'; return chain; },
    insert: value => { payload = value; operation = 'insert'; return chain; },
    range: () => Promise.resolve(mock.fail ? { error: { message: 'failed' } } : { data: table === 'companies' ? [company, { id: 'f2', name: 'Zebra' }] : [{ id: 'ct1', company_id: 'f1', full_name: 'Jenny' }] }),
    maybeSingle: () => Promise.resolve(mock.fail ? { error: { message: 'failed' } } : { data: mock.missing ? null : company }),
    limit: () => Promise.resolve(mock.fail ? { error: { message: 'failed' } } : { data: mock.noContact ? [] : [{ id: 'ct1', full_name: 'Jenny', email: 'jenny@example.com', phone: '123' }] }),
    single: () => { mock.updates.push({ table, operation, payload, filters }); return Promise.resolve(table === 'contacts' && mock.contactFail ? { error: { message: 'failed' } } : { data: table === 'contacts' ? { id: 'ct1', email: 'jenny@example.com', phone: '123', ...payload } : { ...company, ...payload } }); },
  };
  return chain;
} } }));

beforeEach(() => { mock.fail = false; mock.missing = false; mock.noContact = false; mock.contactFail = false; mock.queries = []; mock.updates = []; });
afterEach(cleanup);

it('lists factories with linked names, primary contacts, search and edit icons', async () => {
  const user = userEvent.setup();
  render(<FactoriesPage />);
  const link = await screen.findByRole('link', { name: 'Acme Factory' });
  expect(link.getAttribute('href')).toBe('/v2/factories/f1');
  expect(within(link.parentElement).getByText('Jenny')).toBeTruthy();
  expect(within(link.parentElement).getByRole('button', { name: 'Edit Acme Factory' }).querySelector('.lucide-pencil')).toBeTruthy();
  expect(mock.queries).toContainEqual(['companies', 'type', 'factory']);
  expect(mock.queries).toContainEqual(['contacts', 'is_primary', true]);
  await user.type(screen.getByRole('searchbox', { name: 'Search factories' }), 'jenny');
  expect(screen.queryByRole('link', { name: 'Zebra' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Acme Factory' })).toBeTruthy();
});

it('retries a failed list and opens the factory creation form', async () => {
  mock.fail = true;
  const user = userEvent.setup();
  render(<FactoriesPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  mock.fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('link', { name: 'Acme Factory' });
  await user.click(screen.getByRole('button', { name: '+ New factory' }));
  expect(screen.getByRole('dialog', { name: 'New Factory' })).toBeTruthy();
});

it('updates the factory name in the list after editing', async () => {
  const user = userEvent.setup();
  render(<FactoriesPage />);
  await user.click(await screen.findByRole('button', { name: 'Edit Acme Factory' }));
  const name = await screen.findByLabelText('Factory Name *');
  await user.clear(name);
  await user.type(name, 'Updated Factory');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect((await screen.findByRole('link', { name: 'Updated Factory' })).getAttribute('href')).toBe('/v2/factories/f1');
});

it('shows factory details and saves edits against the factory type', async () => {
  const user = userEvent.setup();
  render(<FactoryPage />);
  expect(await screen.findByRole('heading', { name: 'Acme Factory' })).toBeTruthy();
  expect(screen.getByText('Jenny')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'example.com' }).getAttribute('href')).toBe('https://example.com/');
  const edit = screen.getByRole('button', { name: 'Edit factory' });
  expect(edit.querySelector('.lucide-pencil')).toBeTruthy();
  await user.click(edit);
  const name = await screen.findByLabelText('Factory Name *');
  await user.clear(name);
  await user.type(name, 'Updated Factory');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect(await screen.findByRole('heading', { name: 'Updated Factory' })).toBeTruthy();
  expect(mock.updates[0].filters).toContainEqual(['type', 'factory']);
  expect(mock.updates[0].payload).toEqual({ name: 'Updated Factory' });
});

it('shows a missing factory state', async () => {
  mock.missing = true;
  render(<FactoryPage />);
  expect(await screen.findByText('Factory not found.')).toBeTruthy();
});

it('updates the primary contact and immediately reflects it on the detail page', async () => {
  const user = userEvent.setup();
  render(<FactoryPage />);
  await screen.findByRole('heading', { name: 'Acme Factory' });
  await user.click(screen.getByRole('button', { name: 'Edit factory' }));
  await screen.findByRole('dialog', { name: 'Edit Factory' });
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  const name = screen.getByLabelText('Full Name');
  expect(name.value).toBe('Jenny');
  await user.clear(name);
  await user.type(name, 'Alex');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect(await screen.findByText('Alex')).toBeTruthy();
  expect(mock.updates).toHaveLength(1);
  expect(mock.updates[0]).toMatchObject({ table: 'contacts', operation: 'update', payload: { full_name: 'Alex' } });
  expect(mock.updates[0].payload).toEqual({ full_name: 'Alex' });
  expect(mock.updates[0].filters).toContainEqual(['company_id', 'f1']);
});

it('creates a primary contact when the factory has none and updates the list', async () => {
  mock.noContact = true;
  const user = userEvent.setup();
  render(<FactoriesPage />);
  await user.click(await screen.findByRole('button', { name: 'Edit Acme Factory' }));
  await screen.findByRole('dialog', { name: 'Edit Factory' });
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.type(screen.getByLabelText('Full Name'), 'Taylor');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect(await screen.findByText('Taylor')).toBeTruthy();
  expect(mock.updates[0]).toMatchObject({ table: 'contacts', operation: 'insert', payload: { company_id: 'f1', full_name: 'Taylor', is_primary: true } });
});

it('keeps the modal open when saving a contact fails', async () => {
  mock.contactFail = true;
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
  const user = userEvent.setup();
  render(<FactoryPage />);
  await screen.findByRole('heading', { name: 'Acme Factory' });
  await user.click(screen.getByRole('button', { name: 'Edit factory' }));
  await screen.findByRole('dialog', { name: 'Edit Factory' });
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.type(screen.getByLabelText('Full Name'), ' Smith');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect(alert).toHaveBeenCalledWith(expect.stringContaining('primary contact could not be saved'));
  expect(screen.getByRole('dialog', { name: 'Edit Factory' })).toBeTruthy();
  alert.mockRestore();
});
