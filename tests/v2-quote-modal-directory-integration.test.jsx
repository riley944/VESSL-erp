// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuoteModal from '@/app/v2/quotes/QuoteModal';
import { factoryProductIds } from '@/lib/factoryProducts';

const mock = vi.hoisted(() => ({ factories: [], codes: [], insertedCodes: [], quoteUpdates: [] }));

vi.mock('@/lib/supabase', () => ({ SB: {
  auth: { getSession: async () => ({ data: { session: { user: { email: 'staff@kinguniversal.com' } } }, error: null }) },
  from: table => {
    let operation = 'read';
    let payload;
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      insert: value => { operation = 'insert'; payload = value; return chain; },
      update: value => { operation = 'update'; payload = value; return chain; },
      single: async () => {
        if (table === 'htscodes' && operation === 'insert') {
          const row = { id: 'new-code', ...payload };
          mock.insertedCodes.push(row);
          return { data: row, error: null };
        }
        throw new Error(`Unexpected single-row request: ${table} ${operation}`);
      },
      then: (resolve, reject) => {
        let result;
        if (table === 'companies' && operation === 'read') result = { data: mock.factories, error: null };
        else if (table === 'htscodes' && operation === 'read') result = { data: mock.codes, error: null };
        else if (table === 'quotes' && (operation === 'update' || operation === 'insert')) {
          mock.quoteUpdates.push(payload);
          result = { data: [{ ...quote, ...payload }], error: null };
        } else if ((table === 'tasks' || table === 'staff_profiles') && operation === 'read') result = { data: [], error: null };
        else return Promise.reject(new Error(`Unexpected request: ${table} ${operation}`)).then(resolve, reject);
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return chain;
  },
} }));

const quote = {
  id: 'q1', quote_code: 'Q-1', product: 'Bottle', client: 'Acme',
  factory: 'Original Factory', factory_contact: 'Jane', factory_email: 'jane@example.com',
  factory_phone: '555-0100', country: 'China', lead_time: '30 days',
  hts: 'old-code', notes: 'Original note',
  tiers: [{ qty: 100, landed: 10, duty: 9, dutyManual: true }],
};

beforeEach(() => {
  mock.factories = [{ id: 'f1', name: 'Original Factory' }, { id: 'f2', name: 'New Factory' }];
  mock.codes = [];
  mock.insertedCodes = [];
  mock.quoteUpdates = [];
  // The picker scrolls its panel into view in browsers; jsdom has no layout.
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('creates an HTS code through the real picker and code modal, then saves the recalculated duty', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);

  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await user.click(screen.getByText('old-code'));
  await user.type(screen.getByPlaceholderText('Filter by code or description…'), '123456');
  await user.click(screen.getByRole('button', { name: /Add code/ }));
  expect(screen.getByPlaceholderText('e.g. 6307909000').value).toBe('123456');
  await user.type(screen.getByPlaceholderText('What this code covers'), 'Example goods');
  await user.type(screen.getByPlaceholderText('e.g. 36.5'), '12.5');
  await user.click(screen.getByRole('button', { name: 'Save code' }));

  await waitFor(() => expect(mock.insertedCodes).toHaveLength(1));
  expect(mock.insertedCodes[0]).toMatchObject({ code: '123456', description: 'Example goods', total_duty: 12.5 });
  expect(await screen.findByText(/123456/)).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('manual duty overrides were cleared');
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByLabelText('Duty').value).toBe('1.25');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.quoteUpdates).toHaveLength(1));
  expect(mock.quoteUpdates[0]).toMatchObject({ hts: '123456', tiers: [expect.objectContaining({ duty: 1.25, dutyManual: false })] });
  expect(mock.quoteUpdates[0]).not.toHaveProperty('notes');
});

it('clears the previous factory details when a different factory is selected', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await screen.findByRole('option', { name: 'New Factory' });
  expect(screen.getByLabelText('Factory contact').value).toBe('Jane');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Factory' }), 'f2');
  for (const label of ['Factory contact', 'Factory email', 'Factory phone', 'Country', 'Lead time']) {
    expect(screen.getByLabelText(label).value).toBe('');
  }
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.quoteUpdates).toHaveLength(1));
  expect(mock.quoteUpdates[0]).toMatchObject({ factory: 'New Factory', factory_company_id: 'f2', factory_contact: null, factory_email: null, factory_phone: null, country: null, lead_time: null });
  expect(mock.quoteUpdates[0]).not.toHaveProperty('hts');
  const products = factoryProductIds(mock.factories, [{ ...quote, ...mock.quoteUpdates[0], product_id: 'p1' }], []);
  expect(products.get('f2').has('p1')).toBe(true);
  expect(products.has('f1')).toBe(false);
});

it('retains an unlisted saved factory when saving an unrelated edit', async () => {
  mock.factories = [{ id: 'f2', name: 'New Factory' }];
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await screen.findByRole('option', { name: 'New Factory' });
  expect(screen.getByRole('combobox', { name: 'Factory' }).value).toBe('__saved_name__');
  expect(screen.getByRole('option', { name: 'Original Factory (saved name)' })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Quote details' }));
  await user.type(screen.getByLabelText('Notes'), ' updated');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.quoteUpdates).toHaveLength(1));
  expect(mock.quoteUpdates[0]).toMatchObject({ notes: 'Original note updated' });
  expect(mock.quoteUpdates[0]).not.toHaveProperty('factory');
  expect(mock.quoteUpdates[0]).not.toHaveProperty('factory_contact');
});

it('preserves a renamed factory snapshot and clears its ID when removed', async () => {
  const user = userEvent.setup();
  mock.factories = [{ id: 'f1', name: 'Renamed Factory' }];
  render(<QuoteModal quote={{ ...quote, factory_company_id: 'f1' }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await screen.findByRole('option', { name: 'Original Factory' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Factory' }), '');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.quoteUpdates).toHaveLength(1));
  expect(mock.quoteUpdates[0]).toMatchObject({ factory: null, factory_company_id: null });
});

it('saves the selected factory ID on a new quote', async () => {
  const user = userEvent.setup();
  render(<QuoteModal newQuote={{ productId: 'p1', product: 'Bottle' }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await screen.findByRole('option', { name: 'New Factory' });
  await user.selectOptions(screen.getByRole('combobox', { name: 'Factory' }), 'f2');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.quoteUpdates).toHaveLength(1));
  expect(mock.quoteUpdates[0]).toMatchObject({ product_id: 'p1', factory: 'New Factory', factory_company_id: 'f2' });
});
