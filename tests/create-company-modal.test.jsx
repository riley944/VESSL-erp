// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';

const mock = vi.hoisted(() => ({ company: null, contact: null }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => ({
  upsert: payload => { mock.company = payload; return { select: () => ({ single: async () => ({ data: { id: '1', ...payload }, error: null }) }) }; },
  select: () => ({ eq: async () => ({ count: 0 }) }),
  insert: async payload => { if (table === 'contacts') mock.contact = payload; },
}) } }));
vi.mock('@/lib/supabaseQuotes', () => ({ SBQ: { from: () => ({ insert: () => ({ select: async () => ({}) }) }) } }));
beforeEach(() => { mock.company = null; mock.contact = null; vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('validates, navigates back without losing values, and saves grouped details', async () => {
  const user = userEvent.setup();
  const created = vi.fn();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={created} />);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(window.alert).toHaveBeenCalledWith('Company name required');
  await user.type(screen.getByLabelText('Company Name *'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Billing Address'), 'Main Street');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByLabelText('Company Name *').value).toBe('Acme');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByLabelText('Billing Address').value).toBe('Main Street');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Purchase order notes'), 'Deliver early');
  await user.type(screen.getByLabelText('Delivery request email recipients'), 'A@EXAMPLE.COM, b@example.com');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Full Name'), 'Jane Doe');
  await user.type(within(screen.getByRole('tabpanel', { name: 'Primary contact' })).getByLabelText('Phone'), '555-1234');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(mock.company).toMatchObject({ name: 'Acme', type: 'client', billing_address: 'Main Street', po_notes: 'Deliver early', delivery_request_recipients: ['a@example.com', 'b@example.com'] });
  expect(mock.contact).toMatchObject({ full_name: 'Jane Doe', phone: '555-1234', company_id: '1', is_primary: true });
  expect(created).toHaveBeenCalledWith('client', expect.objectContaining({ id: '1' }));
});

it('keeps invalid delivery recipients on the business details step', async () => {
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="client" initial={{ name: 'Acme' }} onClose={() => {}} onCreated={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.type(screen.getByLabelText('Delivery request email recipients'), 'invalid');
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(window.alert).toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: 'Business details' }).getAttribute('aria-selected')).toBe('true');
});

it('supports direct and keyboard tab navigation without bypassing required-name validation', async () => {
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Company name required');
  const tab = screen.getByRole('tab', { name: 'Company details' });
  expect(tab.getAttribute('aria-selected')).toBe('true');
  tab.focus();
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Addresses' }));
  expect(screen.getByRole('tabpanel', { name: 'Addresses' })).toBeTruthy();
});

it('can save a new company directly from the first tab', async () => {
  const user = userEvent.setup();
  const created = vi.fn();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={created} />);
  await user.type(screen.getByLabelText('Company Name *'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(created).toHaveBeenCalledWith('client', expect.objectContaining({ name: 'Acme' }));
});
