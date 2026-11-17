// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateCompanyModal } from '@/app/components/CreateCompanyModal';

const mock = vi.hoisted(() => ({ company: null, contact: null, contactError: null, countError: null, companyError: null, carriers: [], presets: [] }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => ({
  upsert: payload => { mock.company = payload; return { select: () => ({ single: async () => ({ data: mock.companyError ? null : { id: '1', ...payload }, error: mock.companyError }) }) }; },
  select: () => ({ eq: async () => table === 'companies' ? { data: mock.carriers } : { count: 0, error: mock.countError } }),
  insert: async payload => { if (table === 'contacts') mock.contact = payload; return { error: mock.contactError }; },
}) } }));
vi.mock('@/lib/supabaseQuotes', () => ({ SBQ: { from: table => ({ insert: payload => ({ select: async () => { mock.presets.push([table, payload]); return {}; } }) }) } }));
beforeEach(() => { mock.company = null; mock.contact = null; mock.contactError = null; mock.countError = null; mock.companyError = null; mock.carriers = []; mock.presets = []; vi.spyOn(window, 'alert').mockImplementation(() => {}); });
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
  expect(mock.company).toEqual({ name: 'Acme', type: 'client' });
});

it('does not silently discard contact details without a name', async () => {
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={() => {}} />);
  await user.type(screen.getByLabelText('Company Name *'), 'Acme');
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.type(screen.getByLabelText('Email', { selector: '#company-contact-email' }), 'jane@example.com');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Enter a name for the primary contact.');
  expect(mock.company).toBeNull();
});

it('reports contact insertion errors after saving the company', async () => {
  mock.contactError = { message: 'Contact unavailable' };
  const user = userEvent.setup();
  const created = vi.fn();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={created} />);
  await user.type(screen.getByLabelText('Company Name *'), 'Acme');
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.type(screen.getByLabelText('Full Name'), 'Jane');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Error: Company saved, but its contact could not be added: Contact unavailable');
  expect(created).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Save Company' }).disabled).toBe(false);
});

it('does not insert a contact when the existing-contact lookup fails', async () => {
  mock.countError = { message: 'Lookup unavailable' };
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="client" noun="Company" onClose={() => {}} onCreated={() => {}} />);
  await user.type(screen.getByLabelText('Company Name *'), 'Acme');
  await user.click(screen.getByRole('tab', { name: 'Primary contact' }));
  await user.type(screen.getByLabelText('Full Name'), 'Jane');
  await user.click(screen.getByRole('button', { name: 'Save Company' }));
  expect(window.alert).toHaveBeenCalledWith('Error: Company saved, but its contact could not be checked: Lookup unavailable');
  expect(mock.contact).toBeNull();
});

it('validates carrier tracking URLs and adopts existing names case-insensitively', async () => {
  mock.carriers = [{ name: 'FedEx' }];
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="carrier" onClose={() => {}} onCreated={() => {}} />);
  await user.type(screen.getByLabelText('Carrier Name *'), 'fedex');
  await user.click(screen.getByRole('tab', { name: 'Business details' }));
  const tracking = screen.getByPlaceholderText('https://www.example.com/track?n={number}');
  await user.type(tracking, 'https://example.com/track');
  await user.click(screen.getByRole('button', { name: 'Save Carrier' }));
  expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('contain {number}'));
  expect(mock.company).toBeNull();
  await user.clear(tracking);
  await user.type(tracking, 'https://example.com/track?n=');
  await user.paste('{number}');
  await user.click(screen.getByRole('button', { name: 'Save Carrier' }));
  expect(mock.company).toMatchObject({ name: 'FedEx', type: 'carrier', tracking_url: 'https://example.com/track?n={number}' });
});

it('saves factory country to the quote directory', async () => {
  const user = userEvent.setup();
  render(<CreateCompanyModal initialType="factory" onClose={() => {}} onCreated={() => {}} />);
  await user.type(screen.getByLabelText('Factory Name *'), 'Factory One');
  await user.type(screen.getByPlaceholderText('e.g. China'), 'China');
  await user.click(screen.getByRole('button', { name: 'Save Factory' }));
  expect(mock.presets).toContainEqual(['factory_presets', expect.objectContaining({ factory: 'Factory One', country: 'China' })]);
});

it('leaves the company form open when the company save fails', async () => {
  mock.companyError = { message: 'Unavailable' };
  const user = userEvent.setup();
  const created = vi.fn();
  render(<CreateCompanyModal initialType="client" onClose={() => {}} onCreated={created} />);
  await user.type(screen.getByLabelText('Client Name *'), 'Acme');
  await user.click(screen.getByRole('button', { name: 'Save Client' }));
  expect(window.alert).toHaveBeenCalledWith('Error: Unavailable');
  expect(created).not.toHaveBeenCalled();
});
