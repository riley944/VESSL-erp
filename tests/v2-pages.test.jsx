// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from '@/app/v2/page';
import QuotesPage from '@/app/v2/quotes/page';
import QuotePage from '@/app/v2/quotes/[id]/page';
import ProductPage from '@/app/v2/products/[id]/page';

const mock = vi.hoisted(() => ({
  session: null, profile: null, pages: [], detail: null, id: 'record-1',
  signOut: vi.fn(), unsubscribe: vi.fn(), from: vi.fn(), authCallback: null, queries: [],
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: mock.id }) }));
vi.mock('@/app/m/MLogin', () => ({ MLogin: () => <div>Login form</div> }));
vi.mock('@/lib/supabase', () => ({ SB: {
  auth: {
    getSession: () => mock.session,
    onAuthStateChange: callback => { mock.authCallback = callback; return { data: { subscription: { unsubscribe: mock.unsubscribe } } }; },
    signOut: mock.signOut,
  },
  from: mock.from,
} }));

const session = email => ({ data: { session: email ? { user: { email } } : null } });
const staff = (name = 'Monica') => ({ data: [{ email: 'monica@kinguniversal.com', full_name: name }], error: null });
const quote = (id, overrides = {}) => ({
  id, product_id: `product-${id}`, quote_code: `Q-${id}`, sku: `SKU-${id}`,
  product: `Product ${id}`, client: 'Typed client', factory: 'Harbor',
  created_at: '2026-01-01T12:00:00Z', updated_at: '2026-02-01T12:00:00Z',
  company: { name: 'Acme' }, product_row: { id: `product-${id}`, style_number: `ACM-${id}` }, ...overrides,
});

beforeEach(() => {
  mock.session = Promise.resolve(session('monica@kinguniversal.com'));
  mock.profile = Promise.resolve(staff());
  mock.pages = [{ data: [], error: null }];
  mock.detail = Promise.resolve({ data: null, error: null });
  mock.id = 'record-1';
  mock.queries = [];
  mock.signOut.mockReset();
  mock.unsubscribe.mockReset();
  mock.from.mockReset().mockImplementation(table => ({
    select: columns => table === 'staff_profiles'
      ? { ilike: (column, value) => { mock.queries.push({ table, columns, column, value }); return mock.profile; } }
      : {
          order: (order, options) => ({ range: (start, end) => { mock.queries.push({ table, columns, order, options, start, end }); return Promise.resolve(mock.pages[start / 1000] || { data: [], error: null }); } }),
          eq: (column, value) => ({ maybeSingle: () => { mock.queries.push({ table, columns, column, value }); return mock.detail; } }),
        },
  }));
});
afterEach(() => cleanup());

describe('V2 home and staff access', () => {
  it('shows loading before the session resolves', () => {
    mock.session = new Promise(() => {});
    render(<HomePage />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows login when signed out and unsubscribes on unmount', async () => {
    mock.session = Promise.resolve(session(null));
    const view = render(<HomePage />);
    expect(await screen.findByText('Login form')).toBeTruthy();
    view.unmount();
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });

  it('rejects client accounts and can sign out', async () => {
    mock.session = Promise.resolve(session('client@example.com'));
    render(<HomePage />);
    expect(await screen.findByText('This is a client account')).toBeTruthy();
    expect(mock.from).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mock.signOut).toHaveBeenCalledOnce();
  });

  it('shows profile errors and missing staff access', async () => {
    mock.profile = Promise.resolve({ data: null, error: { message: 'offline' } });
    const view = render(<HomePage />);
    expect(await screen.findByText('Unable to load your staff profile')).toBeTruthy();
    view.unmount();
    mock.profile = Promise.resolve({ data: [{ email: null }, { email: 'other@kinguniversal.com' }], error: null });
    render(<HomePage />);
    expect(await screen.findByText('No staff access yet')).toBeTruthy();
  });

  it('handles a profile lookup with no rows returned', async () => {
    mock.profile = Promise.resolve({ data: null, error: null });
    render(<HomePage />);
    expect(await screen.findByText('No staff access yet')).toBeTruthy();
  });

  it('shows the staff home and navigation, matching profile email case-insensitively', async () => {
    mock.profile = Promise.resolve({ data: [{ email: 'MONICA@KINGUNIVERSAL.COM', full_name: 'Monica' }], error: null });
    render(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Welcome, Monica.' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View quotes' }).getAttribute('href')).toBe('/v2/quotes');
    expect(screen.getByRole('link', { name: 'Return to VESSL' }).getAttribute('href')).toBe('/');
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(mock.signOut).toHaveBeenCalledOnce();
  });

  it('falls back to email when staff has no name', async () => {
    mock.profile = Promise.resolve(staff(''));
    render(<HomePage />);
    expect(await screen.findByRole('heading', { name: 'Welcome.' })).toBeTruthy();
    expect(screen.getByText('monica@kinguniversal.com')).toBeTruthy();
  });

  it('updates the page when the session changes', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Welcome, Monica.' });
    await act(async () => mock.authCallback('SIGNED_OUT', null));
    expect(screen.getByText('Login form')).toBeTruthy();
  });

  it('does not restore a stale session after a sign-out event', async () => {
    let resolve;
    mock.session = new Promise(r => { resolve = r; });
    render(<HomePage />);
    await act(async () => mock.authCallback('SIGNED_OUT', null));
    await act(async () => resolve(session('monica@kinguniversal.com')));
    expect(screen.getByText('Login form')).toBeTruthy();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('rechecks the profile after signing out and back in', async () => {
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Welcome, Monica.' });
    await act(async () => mock.authCallback('SIGNED_OUT', null));
    mock.profile = Promise.resolve({ data: [], error: null });
    await act(async () => mock.authCallback('SIGNED_IN', { user: { email: 'monica@kinguniversal.com' } }));
    expect(await screen.findByText('No staff access yet')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Welcome, Monica.' })).toBeNull();
  });

  it('does not render a profile response after unmount', async () => {
    let resolve;
    mock.profile = new Promise(r => { resolve = r; });
    const view = render(<HomePage />);
    await act(async () => { await mock.session; });
    view.unmount();
    await act(async () => resolve(staff()));
    expect(mock.unsubscribe).toHaveBeenCalledOnce();
  });
});

describe('V2 quotes list', () => {
  it('shows loading and an empty list', async () => {
    let resolve;
    mock.pages = [new Promise(r => { resolve = r; })];
    render(<QuotesPage />);
    expect(await screen.findByText('Loading quotes…')).toBeTruthy();
    resolve({ data: [], error: null });
    expect(await screen.findByText('No quotes found.')).toBeTruthy();
    expect(screen.getByText('0 quotes shown')).toBeTruthy();
  });

  it('shows a load error and retries', async () => {
    mock.pages = [{ data: null, error: { message: 'offline' } }];
    render(<QuotesPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('offline');
    mock.pages = [{ data: [quote('1')], error: null }];
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'ACM-1' })).toBeTruthy();
  });

  it('links each quote and only linked products, with fallback identifiers', async () => {
    mock.pages = [{ data: [quote('1'), quote('2', { product_id: null, product_row: null, quote_code: 'Q-2', company: null, client: 'Beacon' }), quote('3', { product_id: null, product_row: null, quote_code: null })], error: null }];
    render(<QuotesPage />);
    expect((await screen.findByRole('link', { name: 'ACM-1' })).getAttribute('href')).toBe('/v2/quotes/1');
    expect(screen.getByRole('link', { name: 'View product' }).getAttribute('href')).toBe('/v2/products/product-1');
    expect(screen.getByRole('link', { name: 'Q-2' }).getAttribute('href')).toBe('/v2/quotes/2');
    expect(screen.getByRole('link', { name: 'View quote' }).getAttribute('href')).toBe('/v2/quotes/3');
    expect(screen.getAllByText('No linked product')).toHaveLength(2);
    expect(screen.getAllByText('Beacon')).toHaveLength(2);
  });

  it('filters, sorts, clears filters and previews tabs without hiding quotes', async () => {
    const user = userEvent.setup();
    mock.pages = [{ data: [quote('2', { company: { name: 'Beacon' }, updated_at: '2026-03-01' }), quote('1')], error: null }];
    render(<QuotesPage />);
    await screen.findByRole('link', { name: 'ACM-1' });
    await user.click(screen.getByRole('button', { name: /Incomplete/ }));
    expect(screen.getByRole('button', { name: /Incomplete/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('2 quotes shown')).toBeTruthy();
    await user.type(screen.getByRole('searchbox'), 'harbor');
    await user.selectOptions(screen.getByLabelText('Client'), 'Beacon');
    expect(screen.getByText('1 quote shown')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'ACM-1' })).toBeNull();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'not found');
    expect(screen.getByText('No quotes match these filters.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('2 quotes shown')).toBeTruthy();
    for (const [sort, first] of [['new', 'ACM-2'], ['old', 'ACM-1'], ['client', 'ACM-1'], ['style', 'ACM-1']]) {
      await user.selectOptions(screen.getByLabelText('Sort'), sort);
      const links = screen.getAllByRole('link').filter(link => link.textContent.startsWith('ACM-'));
      expect(links[0].textContent).toBe(first);
    }
  });

  it('loads all pages of quotes', async () => {
    mock.pages = [{ data: Array.from({ length: 1000 }, (_, i) => quote(String(i))), error: null }, { data: [quote('last')], error: null }];
    render(<QuotesPage />);
    expect(await screen.findByText('1001 quotes shown', {}, { timeout: 10000 })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ACM-last' })).toBeTruthy();
    const queries = mock.queries.filter(q => q.table === 'quotes');
    expect(queries.map(q => [q.start, q.end])).toEqual([[0, 999], [1000, 1999]]);
    expect(queries[0].order).toBe('id');
    expect(queries[0].columns).toContain('product_row:products!product_id(style_number)');
  });

  it('handles missing fields and sorts quotes without dates or styles', async () => {
    mock.pages = [{ data: [quote('1'), { id: 'empty', product_id: 'missing', product_row: null }, { id: 'empty2', quote_code: 'Q-2', created_at: '2026-01-02' }], error: null }];
    const user = userEvent.setup();
    render(<QuotesPage />);
    await screen.findByRole('link', { name: 'View quote' });
    expect(screen.getAllByText('Product not entered')).toHaveLength(2);
    expect(screen.getAllByText('No linked product')).toHaveLength(2);
    await user.selectOptions(screen.getByLabelText('Sort'), 'old');
    expect(screen.getByText('3 quotes shown')).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('Sort'), 'new');
    await user.selectOptions(screen.getByLabelText('Sort'), 'client');
    await user.selectOptions(screen.getByLabelText('Sort'), 'style');
    await user.type(screen.getByRole('searchbox'), 'Q-1');
    expect(screen.getByText('1 quote shown')).toBeTruthy();
  });

  it('ignores a list response after leaving the page', async () => {
    let resolve;
    mock.pages = [new Promise(r => { resolve = r; })];
    const view = render(<QuotesPage />);
    await screen.findByText('Loading quotes…');
    view.unmount();
    await act(async () => resolve({ data: [quote('1')], error: null }));
    expect(screen.queryByRole('link', { name: 'ACM-1' })).toBeNull();
  });
});

describe.each([['quote', QuotePage], ['product', ProductPage]])('V2 %s detail page', (type, Page) => {
  it('shows loading, not found, and a link back', async () => {
    let resolve;
    mock.detail = new Promise(r => { resolve = r; });
    render(<Page />);
    expect(await screen.findByText(`Loading ${type}…`)).toBeTruthy();
    expect(screen.getByRole('link', { name: '← Quotes' }).getAttribute('href')).toBe('/v2/quotes');
    resolve({ data: null, error: null });
    expect(await screen.findByText(`${type === 'quote' ? 'Quote' : 'Product'} not found.`)).toBeTruthy();
    expect(mock.queries).toContainEqual(expect.objectContaining({ table: type === 'quote' ? 'quotes' : 'products', column: 'id', value: 'record-1' }));
  });

  it('shows database errors', async () => {
    mock.detail = Promise.resolve({ data: null, error: { message: 'offline' } });
    render(<Page />);
    expect((await screen.findByRole('alert')).textContent).toContain(`Could not load ${type}: offline`);
  });

  it('ignores a response after leaving the page', async () => {
    let resolve;
    mock.detail = new Promise(r => { resolve = r; });
    const view = render(<Page />);
    await screen.findByText(`Loading ${type}…`);
    view.unmount();
    await act(async () => resolve({ data: {}, error: null }));
    expect(screen.queryByText(`Loading ${type}…`)).toBeNull();
  });
});

describe('V2 quote detail', () => {
  it('displays linked product, quote fields, tiers, size notice and notes', async () => {
    mock.detail = Promise.resolve({ data: quote('1', { tiers: [{ qty: 1000, landed: 3.25, client: 5.25, sizeQty: [{ scale: 'bag', size: 'M', qty: 100 }, { scale: 'bag', size: 'L', qty: 200 }], sizeCost: [{ scale: 'bag', size: 'M', landed: 4, client: 6 }] }], notes: 'Factory note' }), error: null });
    render(<QuotePage />);
    expect(await screen.findByRole('heading', { name: 'ACM-1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View product' }).getAttribute('href')).toBe('/v2/products/product-1');
    expect(screen.getByText('Factory note')).toBeTruthy();
    const tier = within(screen.getByRole('heading', { name: 'Tier 1' }).parentElement);
    expect(tier.getByText('300')).toBeTruthy();
    expect(tier.queryByText('1000')).toBeNull();
    expect(tier.getByText('3.25')).toBeTruthy();
    expect(tier.getByText('Base factory price')).toBeTruthy();
    expect(tier.getByText('bag / M: 100 units')).toBeTruthy();
    expect(tier.getByText('bag / M: factory 4 · client 6')).toBeTruthy();
  });

  it.each([null, 'invalid json', '{}'])('handles missing or invalid tiers: %s', async tiers => {
    mock.detail = Promise.resolve({ data: { quote_code: 'Q-9', client: 'Typed client', tiers }, error: null });
    render(<QuotePage />);
    expect(await screen.findByRole('heading', { name: 'Q-9' })).toBeTruthy();
    expect(screen.getByText('No quantity tiers recorded.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'View product' })).toBeNull();
    expect(screen.getByText('Typed client')).toBeTruthy();
  });

  it('reads JSON-encoded tiers and size prices', async () => {
    mock.detail = Promise.resolve({ data: { tiers: JSON.stringify([{ qty: 5, sizeCost: [{ size: 'M', client: 2 }] }]) }, error: null });
    render(<QuotePage />);
    expect(await screen.findByRole('heading', { name: 'Tier 1' })).toBeTruthy();
    expect(screen.getByText('M: client 2')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Quote details', level: 1 })).toBeTruthy();
  });

  it('displays legacy quote-level quantity and factory price without inventing a client price', async () => {
    mock.detail = Promise.resolve({ data: { quote_code: 'Q-10', qty: 500, landed: 2.5 }, error: null });
    render(<QuotePage />);
    const tier = within((await screen.findByRole('heading', { name: 'Tier 1' })).parentElement);
    expect(tier.getByText('500')).toBeTruthy();
    expect(tier.getByText('2.5')).toBeTruthy();
    expect(tier.getByText('Client price').nextElementSibling.textContent).toBe('—');
  });
});

describe('V2 product detail', () => {
  it('shows product fields and linked client', async () => {
    mock.detail = Promise.resolve({ data: { style_number: 'ACM-1', name: 'Bottle', sku: 'B1', company: { name: 'Acme' }, description: 'Steel' }, error: null });
    render(<ProductPage />);
    expect(await screen.findByRole('heading', { name: 'ACM-1' })).toBeTruthy();
    expect(screen.getByText('Bottle')).toBeTruthy();
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getByText('Steel')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Quantity tiers' })).toBeNull();
  });

  it('falls back to product name and then a generic heading', async () => {
    mock.detail = Promise.resolve({ data: { name: 'Bottle' }, error: null });
    const view = render(<ProductPage />);
    expect(await screen.findByRole('heading', { name: 'Bottle' })).toBeTruthy();
    view.unmount();
    mock.detail = Promise.resolve({ data: {}, error: null });
    render(<ProductPage />);
    expect(await screen.findByRole('heading', { name: 'Product details', level: 1 })).toBeTruthy();
    expect(screen.getByText('Product name not entered')).toBeTruthy();
  });
});
