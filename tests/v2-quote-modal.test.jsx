// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuoteModal from '@/app/v2/quotes/QuoteModal';

const mock = vi.hoisted(() => ({ writes: [], quoteError: null, empty: false, taskError: null, products: [], productError: null, ranges: [] }));
vi.mock('@/app/components/HtsField', () => ({ HtsField: ({ value, onChange }) => <button type="button" onClick={() => onChange('123456')}>HTS: {value || 'not set'}</button>, useHtsCodes: () => ({ codes: [], addCode: () => {} }) }));
vi.mock('@/app/components/CodeModal', () => ({ CodeModal: () => null }));
vi.mock('@/lib/taskNotify', () => ({ notifyTaskAssigned: vi.fn() }));
vi.mock('@/lib/taskSeen', () => ({ insertTask: async task => { mock.writes.push(['tasks', task]); return mock.taskError ? { error: mock.taskError } : { data: { id: 't1', ...task } }; } }));
vi.mock('@/lib/supabase', () => ({ SB: {
  auth: { getSession: async () => ({ data: { session: { user: { email: 'staff@example.com' } } } }) },
  from: table => {
    let operation = '', payload;
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      range: async (start, end) => { mock.ranges.push([start, end]); return mock.productError ? { data: null, error: mock.productError } : { data: mock.products.slice(start, end + 1), error: null }; },
      insert: value => { operation = 'insert'; payload = value; return chain; },
      update: value => { operation = 'update'; payload = value; return chain; },
      then: resolve => {
        if (!operation) return Promise.resolve({ data: table === 'staff_profiles' ? [{ email: 'person@example.com', full_name: 'Person' }] : [], error: null }).then(resolve);
        mock.writes.push([table, operation, payload]);
        return Promise.resolve(mock.quoteError ? { data: null, error: mock.quoteError } : { data: mock.empty ? [] : [{ id: 'q1', quote_code: 'Q-1', product: 'Bottle', client: 'Acme', ...payload }], error: null }).then(resolve);
      },
    };
    return chain;
  },
} }));

const quote = { id: 'q1', quote_code: 'Q-1', product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme', sku: 'SKU-1', notes: 'Original', tiers: [{ qty: 100, landed: 2, ship: 'ocean', freightOcean: 1, sizeQty: [{ scale: 'bag', size: 'M', qty: 100 }], fb: [{ rate: 4 }] }] };
beforeEach(() => { mock.writes = []; mock.quoteError = null; mock.empty = false; mock.taskError = null; mock.products = [{ id: 'p1', style_number: 'ABC-1', name: 'Bottle', sku: 'SKU-1', client_company_id: 'c1', company: { name: 'Acme' } }, { id: 'p2', style_number: 'XYZ-2', name: 'Tote', client_company_id: null, company: null }]; mock.productError = null; mock.ranges = []; vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('creates a product-linked quote and saves without writing tasks', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<QuoteModal newQuote={{ productId: 'p1', product: 'Bottle', clientId: 'c1', client: 'Acme', sku: 'SKU-1' }} onClose={() => {}} onSaved={saved} />);
  await user.click(screen.getByRole('tab', { name: 'Tasks' }));
  expect(screen.getByText('Save the quote before adding a task.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect(await screen.findByText('Quote saved.')).toBeTruthy();
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toEqual(['quotes', 'insert', expect.objectContaining({ product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme' })]);
  await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  expect(saved).toHaveBeenCalledOnce();
});

it('selects a product on a new quote and saves its exact product and client', async () => {
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Select a product');
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'abc 1');
  await user.click(screen.getByRole('option', { name: 'ABC-1 · Bottle · Acme' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('SKU-1')).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: 'Client' }));
  expect(screen.getByText('Acme')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2]).toMatchObject({ product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme', sku: 'SKU-1' });
});

it('retries a failed product lookup and supports a product with no client', async () => {
  mock.productError = { message: 'Offline' };
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toContain('Could not load products');
  mock.productError = null;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'tote');
  await user.click(screen.getByRole('option', { name: 'XYZ-2 · Tote' }));
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2]).toMatchObject({ product_id: 'p2', client_company_id: null, client: null, product: 'Tote', sku: null });
});

it('loads all product pages and explains when no products exist', async () => {
  mock.products = [];
  const view = render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  expect(await screen.findByText('No products found. Create a product first.')).toBeTruthy();
  view.unmount();
  mock.products = Array.from({ length: 1001 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}` }));
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await userEvent.type(search, 'Product 1000');
  expect(screen.getByRole('option', { name: 'Style not assigned · Product 1000' })).toBeTruthy();
  expect(mock.ranges).toContainEqual([1000, 1999]);
});

it('confirms before replacing client contact details when the product changes', async () => {
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'bottle');
  await user.click(screen.getByRole('option', { name: 'ABC-1 · Bottle · Acme' }));
  await user.click(screen.getByRole('tab', { name: 'Client' }));
  await user.type(screen.getByLabelText('Client contact'), 'Jane');
  await user.click(screen.getByRole('tab', { name: 'Quote details' }));
  window.confirm.mockReturnValue(false);
  await user.type(search, 'tote');
  await user.click(screen.getByRole('option', { name: 'XYZ-2 · Tote' }));
  expect(screen.getByText('Selected: ABC-1 · Bottle · Acme')).toBeTruthy();
  window.confirm.mockReturnValue(true);
  await user.click(screen.getByRole('option', { name: 'XYZ-2 · Tote' }));
  await user.click(screen.getByRole('tab', { name: 'Client' }));
  expect(screen.getByLabelText('Client contact').value).toBe('');
});

it('filters by SKU or client and lets keyboard users choose a result', async () => {
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'sku-1');
  expect(screen.getByRole('option', { name: 'ABC-1 · Bottle · Acme' })).toBeTruthy();
  expect(screen.queryByRole('option', { name: 'XYZ-2 · Tote' })).toBeNull();
  await user.clear(search);
  await user.type(search, 'acme');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(screen.getByText('Selected: ABC-1 · Bottle · Acme')).toBeTruthy();
  expect(search.getAttribute('aria-expanded')).toBe('false');
  await user.type(search, 'no match');
  expect(screen.getByText('No matching products.')).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(screen.queryByText('No matching products.')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2].product_id).toBe('p1');
});

it('does not treat typed search text as a selected product', async () => {
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'Bottle');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Select a product');
  expect(mock.writes).toHaveLength(0);
});

it('updates only changed quote fields and keeps detailed pricing intact', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  await user.clear(screen.getByLabelText('Notes'));
  await user.type(screen.getByLabelText('Notes'), 'Updated');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2]).toMatchObject({ notes: 'Updated' });
  expect(mock.writes[0][2]).not.toHaveProperty('tiers');
  expect(mock.writes[0][2]).not.toHaveProperty('client_company_id');
  expect(mock.writes[0][2]).not.toHaveProperty('product_id');
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.clear(screen.getByLabelText('Factory price'));
  await user.type(screen.getByLabelText('Factory price'), '3');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(2));
  expect(mock.writes[1][2].tiers[0]).toMatchObject({ landed: 3, sizeQty: quote.tiers[0].sizeQty, fb: quote.tiers[0].fb });
});

it('keeps quote and task failures independent and allows retrying a task', async () => {
  mock.taskError = { message: 'Task unavailable' };
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Tasks' }));
  await user.type(await screen.findByLabelText('New task'), 'Ask factory');
  await user.selectOptions(screen.getByLabelText('Assign to'), 'person@example.com');
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Task unavailable');
  expect(screen.getByLabelText('New task').value).toBe('Ask factory');
  await user.click(screen.getByRole('tab', { name: 'Quote details' }));
  await user.clear(screen.getByLabelText('Notes'));
  await user.type(screen.getByLabelText('Notes'), 'Quote saved separately');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  await user.click(screen.getByRole('tab', { name: 'Tasks' }));
  expect(screen.getByLabelText('New task').value).toBe('Ask factory');
  mock.taskError = null;
  await user.click(screen.getByRole('button', { name: 'Add task' }));
  expect(await screen.findByText('Ask factory · person@example.com')).toBeTruthy();
  expect(mock.writes.filter(write => write[0] === 'quotes')).toHaveLength(1);
});

it('keeps the draft open on save errors and zero-row updates', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={saved} />);
  await user.type(screen.getByLabelText('Notes'), ' changed');
  mock.quoteError = { message: 'Offline' };
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect((await screen.findByRole('alert')).textContent).toBe('Offline');
  mock.quoteError = null; mock.empty = true;
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect((await screen.findByRole('alert')).textContent).toContain('No quote was saved');
  expect(screen.getByLabelText('Notes').value).toBe('Original changed');
  expect(saved).not.toHaveBeenCalled();
});

it('asks before discarding an unsaved task and preserves the draft when cancelled', async () => {
  const user = userEvent.setup();
  const close = vi.fn();
  window.confirm.mockReturnValue(false);
  render(<QuoteModal quote={quote} onClose={close} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Tasks' }));
  await user.type(await screen.findByLabelText('New task'), 'Call factory');
  await user.click(screen.getAllByRole('button', { name: 'Close' })[0]);
  expect(window.confirm).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByLabelText('New task').value).toBe('Call factory');
});

it('retains legacy combined freight when a tier is edited', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, tiers: [{ qty: 100, landed: 2, ship: 'ocean', freightDuty: 1.5 }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByLabelText('Ocean freight').value).toBe('1.5');
  await user.clear(screen.getByLabelText('Factory price'));
  await user.type(screen.getByLabelText('Factory price'), '3');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2]).toMatchObject({ freight_duty: 1.5, tiers: [expect.objectContaining({ freightDuty: 1.5, freightOcean: 1.5 })] });
});

it('does not restore legacy freight after it is explicitly cleared', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, tiers: [{ qty: 100, landed: 2, ship: 'ocean', freightDuty: 1.5 }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.clear(screen.getByLabelText('Ocean freight'));
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].freight_duty).toBeNull();
  expect(mock.writes[0][2].tiers[0]).not.toHaveProperty('freightDuty');
});

it('preserves unreadable tier data while allowing unrelated quote edits', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, tiers: [null] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByRole('alert').textContent).toContain('Pricing tiers could not be read');
  expect(screen.queryByRole('button', { name: '+ Add tier' })).toBeNull();
  await user.click(screen.getByRole('tab', { name: 'Quote details' }));
  await user.type(screen.getByLabelText('Notes'), ' changed');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2]).not.toHaveProperty('tiers');
});

it('retains the legacy freight timestamp when saving unrelated changes', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, updated_at: '2025-01-01T00:00:00Z', freight_duty_updated_at: null }} onClose={() => {}} onSaved={() => {}} />);
  await user.type(screen.getByLabelText('Notes'), ' changed');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].freight_duty_updated_at).toBe('2025-01-01T00:00:00Z');
});
