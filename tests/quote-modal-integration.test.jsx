// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Quotes from '@/app/quotes';

const mock = vi.hoisted(() => ({ inserted: null, updated: null, saved: null, saveError: null, quoteRow: null, updates: [] }));
vi.mock('@/lib/supabaseQuotes', () => ({ SBQ: {} }));
vi.mock('@/app/components/HtsField', () => ({ HtsField: () => null, useHtsCodes: () => ({ codes: [], addCode: () => {} }) }));
vi.mock('@/app/components/HtsRuleHints', () => ({ HtsRuleHints: () => null, useHtsRuleMap: () => ({ chapters: [], rules: [] }) }));
vi.mock('@/app/components/ProductCpscRules', async importOriginal => ({ ...(await importOriginal()), useProductCpscRules: () => ({ products: [], links: [], regs: [] }) }));
vi.mock('@/app/components/FactorySelect', () => ({ FactorySelect: () => null, ContactPickModal: () => null, useFactoryCompanies: () => ({ companies: [], contacts: [], presets: [], addCompany: () => {} }), factoryFillFor: () => ({}), contactFieldsFrom: () => ({}) }));
vi.mock('@/app/components/CompanySelect', () => ({ CompanySelect: () => null, useCompanyDirectory: () => ({ companies: [], contacts: [], addCompany: () => {} }), contactsOf: () => [] }));
vi.mock('@/lib/supabase', () => ({ SB: {
  auth: { getSession: async () => ({ data: { session: null } }) },
  channel: () => { const ch = { on: () => ch, subscribe: () => ch }; return ch; },
  removeChannel: () => {},
  from: table => {
    let op = 'read', payload = null;
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, ilike: () => chain,
      order: () => chain, limit: () => chain, not: () => chain, in: () => chain,
      insert: value => { op = 'insert'; payload = value; mock.inserted = value; return chain; },
      update: value => { op = 'update'; payload = value; mock.updated = value; mock.updates.push([table, value]); return chain; },
      maybeSingle: async () => ({ data: null, error: null }),
      then: resolve => resolve(op === 'read' ? { data: [], error: null } : mock.saveError ? { data: null, error: mock.saveError } : { data: [{ id: 'q1', quote_code: 'Q-1', ...(op === 'update' ? mock.quoteRow : {}), ...payload }], error: null }),
    };
    return chain;
  },
} }));

const session = { user: { email: 'staff@kinguniversal.com' } };
beforeEach(() => { mock.inserted = null; mock.updated = null; mock.saved = vi.fn(); mock.saveError = null; mock.quoteRow = null; mock.updates = []; });
afterEach(cleanup);

it('saves a quote from a product with its exact product and client IDs', async () => {
  const user = userEvent.setup();
  render(<Quotes session={session} modalOnly newQuote={{ productId: 'p1', product: 'Bottle', sku: '', clientId: 'c1', client: 'Acme' }} onClose={() => {}} onSaved={mock.saved} />);
  await screen.findByRole('dialog', { name: 'New Quote' });
  await user.click(screen.getByRole('button', { name: 'Save Quote' }));
  await waitFor(() => expect(mock.saved).toHaveBeenCalledOnce());
  expect(mock.inserted).toMatchObject({ product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme' });
});

it('opens an existing quote and updates it instead of inserting a new one', async () => {
  const user = userEvent.setup();
  render(<Quotes session={session} modalOnly editQuote={{ id: 'q1', quote_code: 'Q-1', product: 'Bottle', client: 'Acme', tiers: [] }} onClose={() => {}} onSaved={mock.saved} />);
  await screen.findByRole('dialog', { name: 'Edit Quote' });
  await user.click(screen.getByRole('button', { name: 'Save Quote' }));
  await waitFor(() => expect(mock.saved).toHaveBeenCalledOnce());
  expect(mock.inserted).toBeNull();
  expect(mock.updated).toMatchObject({ product: 'Bottle', client: 'Acme' });
});

it('keeps a quote draft open if the database rejects the save', async () => {
  mock.saveError = { message: 'Database unavailable' };
  const user = userEvent.setup();
  render(<Quotes session={session} modalOnly newQuote={{ productId: 'p1', product: 'Bottle', clientId: 'c1', client: 'Acme' }} onClose={() => {}} onSaved={mock.saved} />);
  await screen.findByRole('dialog', { name: 'New Quote' });
  await user.click(screen.getByRole('button', { name: 'Save Quote' }));
  expect(await screen.findByText('Save failed: Database unavailable')).toBeTruthy();
  expect(screen.getByRole('dialog', { name: 'New Quote' })).toBeTruthy();
  expect(mock.saved).not.toHaveBeenCalled();
});

it('preserves the existing client link when editing a quote without changing its client', async () => {
  const user = userEvent.setup();
  mock.quoteRow = { id: 'q1', quote_code: 'Q-1', product: 'Bottle', client: 'Acme', client_company_id: 'c1', product_id: 'p1', tiers: [] };
  render(<Quotes session={session} modalOnly editQuote={mock.quoteRow} onClose={() => {}} onSaved={mock.saved} />);
  await screen.findByRole('dialog', { name: 'Edit Quote' });
  await user.click(screen.getByRole('button', { name: 'Save Quote' }));
  await waitFor(() => expect(mock.saved).toHaveBeenCalledOnce());
  expect(mock.updates.filter(([table]) => table === 'quotes')).toHaveLength(1);
  expect(mock.updates[0][1]).not.toHaveProperty('client_company_id');
});
