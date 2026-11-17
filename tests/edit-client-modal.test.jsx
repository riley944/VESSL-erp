// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditClientModal from '@/app/v2/clients/EditClientModal';

const mock = vi.hoisted(() => ({ payload: null, filters: [], error: null, loadError: null }));
vi.mock('@/lib/supabaseQuotes', () => ({ SBQ: {} }));
vi.mock('@/lib/supabase', () => ({ SB: { from: () => {
  const chain = {
    select: () => chain,
    eq: (key, value) => { mock.filters.push([key, value]); return chain; },
    maybeSingle: async () => ({ data: mock.loadError ? null : { id: 'c1', type: 'client', name: 'Acme', email: 'old@example.com', kui_ior: false, delivery_request_recipients: ['one@example.com'] }, error: mock.loadError }),
    update: payload => { mock.payload = payload; return chain; },
    single: async () => ({ data: mock.error ? null : { id: 'c1', type: 'client', ...mock.payload }, error: mock.error }),
  };
  return chain;
} } }));
beforeEach(() => { mock.payload = null; mock.filters = []; mock.error = null; mock.loadError = null; vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('loads the client, edits existing fields, and updates the same record', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<EditClientModal id="c1" onClose={() => {}} onSaved={saved} />);
  const name = await screen.findByLabelText('Company Name *');
  expect(name.value).toBe('Acme');
  await user.clear(name);
  await user.type(name, 'New Acme');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const recipients = screen.getByLabelText('Delivery request email recipients');
  expect(recipients.value).toBe('one@example.com');
  await user.clear(recipients);
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(mock.payload).toMatchObject({ name: 'New Acme', email: 'old@example.com', kui_ior: false, delivery_request_recipients: null });
  expect(mock.filters).toContainEqual(['id', 'c1']);
  expect(mock.filters).toContainEqual(['type', 'client']);
  expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1', name: 'New Acme' }));
});

it('keeps the form open when saving fails', async () => {
  mock.error = { message: 'Duplicate name' };
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<EditClientModal id="c1" onClose={() => {}} onSaved={saved} />);
  await screen.findByLabelText('Company Name *');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Error: Duplicate name');
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save Company' }).disabled).toBe(false);
});

it('saves directly from the first step', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<EditClientModal id="c1" onClose={() => {}} onSaved={saved} />);
  await screen.findByLabelText('Company Name *');
  const email = screen.getByLabelText('Email');
  await user.clear(email);
  await user.type(email, 'new@example.com');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(mock.payload).toMatchObject({ email: 'new@example.com', delivery_request_recipients: ['one@example.com'] });
  expect(saved).toHaveBeenCalledOnce();
});

it('validates business details when saving from another step', async () => {
  const user = userEvent.setup();
  render(<EditClientModal id="c1" onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('Company Name *');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  const recipients = screen.getByLabelText('Delivery request email recipients');
  await user.clear(recipients);
  await user.type(recipients, 'invalid');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Enter valid delivery request email addresses separated by commas or new lines.');
  expect(screen.getByText(/Step 3 of 3/)).toBeTruthy();
  expect(mock.payload).toBeNull();
});

it('shows a loading error without opening an empty form', async () => {
  mock.loadError = { message: 'offline' };
  render(<EditClientModal id="c1" onClose={() => {}} onSaved={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load company.');
  expect(screen.queryByLabelText('Company Name *')).toBeNull();
});
