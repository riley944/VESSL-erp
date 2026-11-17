// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QuoteModal from '@/app/v2/quotes/QuoteModal';
import { QUOTES_CHANGED } from '@/app/v2/quoteEvents';

const mock = vi.hoisted(() => ({ writes: [], quoteError: null, empty: false, taskError: null, products: [], productError: null, ranges: [], codes: [], savePending: null }));
vi.mock('@/app/components/HtsField', () => ({ HtsField: ({ value, onChange }) => <button type="button" onClick={() => onChange('123456')}>HTS: {value || 'not set'}</button>, useHtsCodes: () => ({ codes: mock.codes, addCode: () => {} }) }));
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
        const result = mock.quoteError ? { data: null, error: mock.quoteError } : { data: mock.empty ? [] : [{ id: 'q1', quote_code: 'Q-1', product: 'Bottle', client: 'Acme', ...payload }], error: null };
        return (mock.savePending || Promise.resolve(result)).then(resolve);
      },
    };
    return chain;
  },
} }));

const quote = { id: 'q1', quote_code: 'Q-1', product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme', sku: 'SKU-1', notes: 'Original', tiers: [{ qty: 100, landed: 2, ship: 'ocean', freightOcean: 1, sizeQty: [{ scale: 'bag', size: 'M', qty: 100 }], fb: [{ rate: 4 }] }] };
beforeEach(() => { mock.writes = []; mock.quoteError = null; mock.empty = false; mock.taskError = null; mock.products = [{ id: 'p1', style_number: 'ABC-1', name: 'Bottle', sku: 'SKU-1', client_company_id: 'c1', company: { name: 'Acme' } }, { id: 'p2', style_number: 'XYZ-2', name: 'Tote', client_company_id: null, company: null }]; mock.productError = null; mock.ranges = []; mock.codes = []; mock.savePending = null; vi.spyOn(window, 'confirm').mockReturnValue(true); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('creates a product-linked quote and saves without writing tasks', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  const changed = vi.fn();
  window.addEventListener(QUOTES_CHANGED, changed, { once: true });
  render(<QuoteModal newQuote={{ productId: 'p1', product: 'Bottle', clientId: 'c1', client: 'Acme', sku: 'SKU-1' }} onClose={() => {}} onSaved={saved} />);
  await user.click(screen.getByRole('tab', { name: 'Tasks' }));
  expect(screen.getByText('Save the quote before adding a task.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect(await screen.findByText('Quote saved.')).toBeTruthy();
  expect(mock.writes).toHaveLength(1);
  expect(mock.writes[0]).toEqual(['quotes', 'insert', expect.objectContaining({ product_id: 'p1', client_company_id: 'c1', product: 'Bottle', client: 'Acme' })]);
  expect(changed).toHaveBeenCalledOnce();
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
  expect((await screen.findByRole('alert')).textContent).toContain('Select a product from the search results or clear the search');
  expect(mock.writes).toHaveLength(0);
  await user.click(screen.getByRole('button', { name: 'Clear product search' }));
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2].product_id).toBe('p1');
});

it('requires a new selection when searching after choosing a product, even from another tab', async () => {
  const user = userEvent.setup();
  render(<QuoteModal onClose={() => {}} onSaved={() => {}} />);
  const search = screen.getByRole('combobox', { name: 'Product *' });
  await waitFor(() => expect(search.disabled).toBe(false));
  await user.type(search, 'bottle');
  await user.click(screen.getByRole('option', { name: 'ABC-1 · Bottle · Acme' }));
  await user.type(search, 'tote');
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  expect(screen.getByRole('tab', { name: 'Quote details' }).getAttribute('aria-selected')).toBe('true');
  expect((await screen.findByRole('alert')).textContent).toContain('Select a product from the search results');
  expect(mock.writes).toHaveLength(0);
  await user.click(search);
  await user.click(screen.getByRole('option', { name: 'XYZ-2 · Tote' }));
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await screen.findByText('Quote saved.');
  expect(mock.writes[0][2].product_id).toBe('p2');
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

it('keeps edits made while a quote save is pending for a second save', async () => {
  let finish;
  mock.savePending = new Promise(resolve => { finish = resolve; });
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  const notes = screen.getByLabelText('Notes');
  await user.clear(notes);
  await user.type(notes, 'First');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  await user.type(notes, ' later');
  mock.savePending = null;
  finish({ data: [{ ...quote, notes: 'First' }], error: null });
  await screen.findByText('Quote saved.');
  expect(notes.value).toBe('First later');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(2));
  expect(mock.writes[1][2].notes).toBe('First later');
});

it('keeps quote and pricing drafts across keyboard tab navigation', async () => {
  const user = userEvent.setup();
  render(<QuoteModal quote={quote} onClose={() => {}} onSaved={() => {}} />);
  await user.clear(screen.getByLabelText('Notes'));
  await user.type(screen.getByLabelText('Notes'), 'Draft note');
  screen.getByRole('tab', { name: 'Quote details' }).focus();
  await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}');
  expect(screen.getByRole('tabpanel', { name: 'Pricing' })).toBeTruthy();
  await user.clear(screen.getByLabelText('Factory price'));
  await user.type(screen.getByLabelText('Factory price'), '5');
  await user.click(screen.getByRole('tab', { name: 'Quote details' }));
  expect(screen.getByLabelText('Notes').value).toBe('Draft note');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2]).toMatchObject({ notes: 'Draft note', tiers: [expect.objectContaining({ landed: 5 })] });
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

it('recalculates automatic duty on price changes and preserves manual duty', async () => {
  mock.codes = [{ code: '123456', total_duty: 10 }];
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, hts: '123456', tiers: [{ qty: 100, landed: 10, duty: 1, dutyManual: false }, { qty: 200, landed: 10, duty: 7, dutyManual: true }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  const prices = screen.getAllByLabelText('Factory price');
  await user.clear(prices[0]);
  await user.type(prices[0], '20');
  await user.clear(prices[1]);
  await user.type(prices[1], '20');
  expect(screen.getAllByLabelText('Duty').map(input => input.value)).toEqual(['2', '7']);
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].tiers).toEqual([expect.objectContaining({ landed: 20, duty: 2, dutyManual: false }), expect.objectContaining({ landed: 20, duty: 7, dutyManual: true })]);
  expect(mock.writes[0][2].tiers[0]).not.toHaveProperty('__v2TierKey');
  expect(mock.writes[0][2].tiers[0]).not.toHaveProperty('__v2LegacyDuty');
});

it('recalculates duty for a changed HTS code and explains cleared overrides', async () => {
  mock.codes = [{ code: '123456', total_duty: 12.5 }];
  const user = userEvent.setup();
  render(<QuoteModal quote={{ ...quote, hts: 'old', tiers: [{ landed: 10, duty: 9, dutyManual: true }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await user.click(screen.getByRole('button', { name: 'HTS: old' }));
  expect(screen.getByRole('status').textContent).toContain('manual duty overrides were cleared');
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByLabelText('Duty').value).toBe('1.25');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2]).toMatchObject({ hts: '123456', tiers: [expect.objectContaining({ duty: 1.25, dutyManual: false })] });
});

it('keeps duty blank for ambiguous rates and restores automatic duty after clearing an override', async () => {
  mock.codes = [{ code: '123456', total_duty: 10 }];
  const user = userEvent.setup();
  const view = render(<QuoteModal quote={{ ...quote, hts: '123456', tiers: [{ landed: 10, duty: 7, dutyManual: true }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.clear(screen.getByLabelText('Duty'));
  await user.tab();
  expect(screen.getByLabelText('Duty').value).toBe('1');
  view.unmount();
  mock.codes = [{ code: '123456', total_duty: 10 }, { code: '123456', total_duty: 20 }];
  render(<QuoteModal quote={{ ...quote, hts: 'old', tiers: [{ landed: 10, duty: 7, dutyManual: true }] }} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Factory' }));
  await user.click(screen.getByRole('button', { name: 'HTS: old' }));
  expect(screen.getByRole('status').textContent).toContain('No single HTS rate is available');
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByLabelText('Duty').value).toBe('');
});

it('retains the legacy freight timestamp when adding or removing an unrelated tier', async () => {
  const user = userEvent.setup();
  const legacy = { ...quote, updated_at: '2025-01-01T00:00:00Z', freight_duty_updated_at: null, tiers: [{ qty: 100, landed: 2, ship: 'ocean', freightOcean: 1 }, { qty: 200, landed: 3, ship: 'ocean', freightOcean: 2 }] };
  render(<QuoteModal quote={legacy} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.click(screen.getByRole('button', { name: '+ Add tier' }));
  await user.type(screen.getAllByLabelText('Quantity')[2], '300');
  await user.click(screen.getAllByRole('button', { name: 'Remove tier' })[1]);
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].freight_duty_updated_at).toBe('2025-01-01T00:00:00Z');
  expect(mock.writes[0][2]).not.toHaveProperty('freight_duty_updated_by');
  expect(mock.writes[0][2].tiers).toHaveLength(2);
});

it('preserves a legacy combined freight tier when another tier gets automatic duty', async () => {
  mock.codes = [{ code: '123456', total_duty: 10 }];
  const user = userEvent.setup();
  const legacy = { ...quote, hts: '123456', updated_at: '2025-01-01T00:00:00Z', freight_duty_updated_at: null, tiers: [{ qty: 100, landed: 10, ship: 'ocean', freightOcean: 1 }] };
  render(<QuoteModal quote={legacy} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  expect(screen.getByText(/Older freight includes duty/)).toBeTruthy();
  await user.clear(screen.getByLabelText('Factory price'));
  await user.type(screen.getByLabelText('Factory price'), '20');
  expect(screen.getByLabelText('Duty').value).toBe('');
  await user.click(screen.getByRole('button', { name: '+ Add tier' }));
  await user.type(screen.getAllByLabelText('Factory price')[1], '30');
  expect(screen.getAllByLabelText('Duty')[1].value).toBe('3');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].freight_duty_updated_at).toBe('2025-01-01T00:00:00Z');
  expect(mock.writes[0][2].tiers[0].duty).toBeUndefined();
  expect(mock.writes[0][2].tiers[1].duty).toBe(3);
});

it('updates the timestamp and calculates duty when the last legacy freight is edited', async () => {
  mock.codes = [{ code: '123456', total_duty: 10 }];
  const user = userEvent.setup();
  const legacy = { ...quote, hts: '123456', updated_at: '2025-01-01T00:00:00Z', freight_duty_updated_at: null, tiers: [{ qty: 100, landed: 10, ship: 'ocean', freightOcean: 1 }] };
  render(<QuoteModal quote={legacy} onClose={() => {}} onSaved={() => {}} />);
  await user.click(screen.getByRole('tab', { name: 'Pricing' }));
  await user.clear(screen.getByLabelText('Ocean freight'));
  await user.type(screen.getByLabelText('Ocean freight'), '2');
  expect(screen.getByLabelText('Duty').value).toBe('1');
  await user.click(screen.getByRole('button', { name: 'Save quote' }));
  await waitFor(() => expect(mock.writes).toHaveLength(1));
  expect(mock.writes[0][2].freight_duty_updated_at).not.toBe('2025-01-01T00:00:00Z');
  expect(mock.writes[0][2].freight_duty_updated_at).toBe(mock.writes[0][2].updated_at);
});
