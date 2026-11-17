// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from '@/app/v2/page';
import QuotesPage from '@/app/v2/quotes/page';
import QuotePage from '@/app/v2/quotes/[id]/page';
import ProductPage from '@/app/v2/products/[id]/page';
import ClientPage from '@/app/v2/clients/[id]/page';
import SectionPage from '@/app/v2/[section]/page';

const mock = vi.hoisted(() => ({
  session: null, profile: null, pages: [], detail: null, id: 'record-1', pathname: '/v2',
  signOut: vi.fn(), unsubscribe: vi.fn(), from: vi.fn(), authCallback: null, queries: [], searchParams: '', deleted: [], editProductId: null,
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: mock.id }), usePathname: () => mock.pathname, useSearchParams: () => new URLSearchParams(mock.searchParams), notFound: () => { throw new Error('NEXT_NOT_FOUND'); } }));
vi.mock('@/app/m/MLogin', () => ({ MLogin: () => <div>Login form</div> }));
vi.mock('@/app/v2/clients/EditClientModal', () => ({ default: ({ id, onSaved }) => <button onClick={() => onSaved({ id, name: 'Updated client', email: 'new@example.com' })}>Save test edit</button> }));
vi.mock('@/app/v2/products/EditProductModal', () => ({ default: ({ id, onSaved }) => { mock.editProductId = id; return <button onClick={() => { mock.detail = Promise.resolve({ data: { name: 'Updated product' }, error: null }); onSaved(); }}>Save test product</button>; } }));
vi.mock('@/app/v2/quotes/EditQuoteModal', () => ({ default: ({ id, onSaved, onClose }) => <div role="dialog" aria-label="Edit Quote"><span>Editing {id}</span><button onClick={() => { mock.pages = [{ data: [quote(id, { factory: 'Updated factory' })], error: null }]; onSaved(); }}>Save test quote edit</button><button onClick={onClose}>Close test quote edit</button></div> }));
vi.mock('@/app/v2/quotes/QuoteModal', () => ({ default: ({ onSaved, onClose }) => <div role="dialog" aria-label="New Quote"><button onClick={() => { mock.pages = [{ data: [quote('new')], error: null }]; onSaved(); }}>Finish test quote</button><button onClick={onClose}>Cancel test quote</button></div> }));
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
  mock.pathname = '/v2';
  mock.searchParams = '';
  mock.deleted = [];
  mock.editProductId = null;
  localStorage.clear();
  mock.queries = [];
  mock.signOut.mockReset();
  mock.unsubscribe.mockReset();
  mock.from.mockReset().mockImplementation(table => ({
    delete: () => { mock.deleted.push(table); throw new Error('Unexpected deletion'); },
    select: columns => table === 'staff_profiles'
      ? { ilike: (column, value) => { mock.queries.push({ table, columns, column, value }); return mock.profile; } }
      : {
          order: (order, options) => ({ range: (start, end) => { mock.queries.push({ table, columns, order, options, start, end }); return Promise.resolve(mock.pages[start / 1000] || { data: [], error: null }); } }),
          eq: (column, value) => {
            mock.queries.push({ table, columns, column, value });
            const detail = { maybeSingle: () => mock.detail, eq: (nextColumn, nextValue) => { mock.queries.push({ table, columns, column: nextColumn, value: nextValue }); return detail; } };
            return detail;
          },
        },
  }));
});
afterEach(() => cleanup());

describe('V2 client details', () => {
  it('loads a client by id and shows its details', async () => {
    mock.detail = Promise.resolve({ data: { id: 'record-1', name: 'Acme', email: 'hello@acme.test', phone: '2125550100', website: 'acme.test' }, error: null });
    render(<ClientPage />);
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'hello@acme.test' }).getAttribute('href')).toBe('mailto:hello@acme.test');
    expect(screen.getByText('(212) 555-0100')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'acme.test' }).getAttribute('href')).toBe('https://acme.test/');
    expect(mock.queries).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: 'companies', column: 'id', value: 'record-1' }),
      expect.objectContaining({ table: 'companies', column: 'type', value: 'client' }),
    ]));
  });

  it('preserves international phone numbers and existing website schemes', async () => {
    mock.detail = Promise.resolve({ data: { name: 'Acme', phone: '+44 20 7946 0958', website: 'http://acme.test/contact' }, error: null });
    render(<ClientPage />);
    expect(await screen.findByText('+44 20 7946 0958')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'http://acme.test/contact' }).getAttribute('href')).toBe('http://acme.test/contact');
  });

  it('opens editing and shows the saved client', async () => {
    mock.detail = Promise.resolve({ data: { id: 'record-1', name: 'Acme' }, error: null });
    const user = userEvent.setup();
    render(<ClientPage />);
    await screen.findByRole('heading', { name: 'Acme' });
    await user.click(screen.getByRole('button', { name: 'Edit client' }));
    await user.click(screen.getByRole('button', { name: 'Save test edit' }));
    expect(screen.getByRole('heading', { name: 'Updated client' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'new@example.com' }).getAttribute('href')).toBe('mailto:new@example.com');
  });

  it('shows when a client cannot be found', async () => {
    render(<ClientPage />);
    expect(await screen.findByText('Client not found.')).toBeTruthy();
  });

  it('shows client loading errors', async () => {
    mock.detail = Promise.resolve({ data: null, error: { message: 'Database unavailable' } });
    render(<ClientPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable');
  });
});

it('opens quotes filtered by client id, including legacy unlinked quotes, and can clear the filter', async () => {
  mock.searchParams = 'clientId=client-1&clientName=Acme';
  mock.pages = [{ data: [
    quote('1', { client_company_id: 'client-1' }),
    quote('2', { client_company_id: 'client-2', company: { name: 'Acme' } }),
    quote('3', { client_company_id: null, company: null, client: 'Acme' }),
  ], error: null }];
  const user = userEvent.setup();
  render(<QuotesPage />);
  expect(await screen.findByText('Q-1')).toBeTruthy();
  expect(screen.getByText('Q-3')).toBeTruthy();
  expect(screen.queryByText('Q-2')).toBeNull();
  expect(screen.getByLabelText('Client').value).toBe('Acme');
  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByText('Q-2')).toBeTruthy();
});

it('keeps the selected client visible when it has no quotes', async () => {
  mock.searchParams = 'clientId=client-1&clientName=Acme';
  mock.pages = [{ data: [quote('2', { client_company_id: 'client-2', company: { name: 'Other' } })], error: null }];
  render(<QuotesPage />);
  expect(await screen.findByText('No quotes match these filters.')).toBeTruthy();
  expect(screen.getByLabelText('Client').value).toBe('Acme');
});

describe('V2 home and staff access', () => {
  it('shows navigation, highlights the current section and remembers the hidden menu', async () => {
    mock.pathname = '/v2/quotes/record-1';
    render(<HomePage />);
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const quotes = within(nav).getByRole('link', { name: /Quotes/ });
    expect(quotes.getAttribute('href')).toBe('/v2/quotes');
    expect(quotes.getAttribute('aria-current')).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Samples' }).getAttribute('href')).toBe('/v2/samples');
    await userEvent.click(screen.getByRole('button', { name: 'Hide menu' }));
    expect(localStorage.getItem('vessl-v2-menu-hidden')).toBe('1');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show menu' }));
    await userEvent.click(screen.getByRole('button', { name: 'Show menu' }));
    expect(localStorage.getItem('vessl-v2-menu-hidden')).toBe('0');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide menu' }));
  });

  it('restores a hidden menu and closes the drawer on Escape, backdrop, and navigation', async () => {
    localStorage.setItem('vessl-v2-menu-hidden', '1');
    const user = userEvent.setup();
    render(<HomePage />);
    await screen.findByRole('heading', { name: 'Welcome, Monica.' });
    expect(screen.getByRole('button', { name: 'Show menu' })).toBeTruthy();
    const menu = screen.getByRole('button', { name: 'Menu', hidden: true });
    // jsdom does not apply media queries; exercise the mobile control directly.
    await act(async () => { menu.click(); });
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    await user.keyboard('{Escape}');
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { menu.click(); });
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    await act(async () => { menu.click(); });
    const samples = screen.getByRole('link', { name: 'Samples' });
    samples.addEventListener('click', event => event.preventDefault(), { once: true });
    await user.click(samples);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('renders all mockup destinations with placeholder counts', async () => {
    render(<HomePage />);
    const nav = await screen.findByRole('navigation', { name: 'Main navigation' });
    const links = within(nav).getAllByRole('link');
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/v2/todos', '/v2/quotes', '/v2/samples', '/v2/orders', '/v2/production',
      '/v2/shipments', '/v2/freight-quotes', '/v2/clients', '/v2/products',
      '/v2/factories', '/v2/forwarders', '/v2/codes',
    ]);
    expect(within(nav).getByLabelText('8 need attention (placeholder)')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Help' }).getAttribute('href')).toBe('/v2/help');
  });

  it('renders known placeholder destinations and rejects unknown routes', async () => {
    mock.pathname = '/v2/samples';
    render(await SectionPage({ params: Promise.resolve({ section: 'samples' }) }));
    expect(await screen.findByRole('heading', { name: 'Samples' })).toBeTruthy();
    expect(screen.getByText('This page is coming soon.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Samples' }).getAttribute('aria-current')).toBe('page');
    await expect(SectionPage({ params: Promise.resolve({ section: 'unknown' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

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
  it('opens quote creation and refreshes the unfiltered list after saving', async () => {
    mock.pages = [{ data: [quote('1')], error: null }];
    const user = userEvent.setup();
    render(<QuotesPage />);
    await screen.findByRole('link', { name: 'ACM-1' });
    await user.type(screen.getByRole('searchbox', { name: 'Search quotes' }), 'missing');
    await user.click(screen.getByRole('button', { name: '+ Create quote' }));
    expect(screen.getByRole('dialog', { name: 'New Quote' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Finish test quote' }));
    expect(await screen.findByRole('link', { name: 'ACM-new' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search quotes' }).value).toBe('');
  });

  it('closes quote creation without refreshing when cancelled', async () => {
    const user = userEvent.setup();
    render(<QuotesPage />);
    await screen.findByText('No quotes found.');
    const before = mock.queries.filter(query => query.table === 'quotes').length;
    await user.click(screen.getByRole('button', { name: '+ Create quote' }));
    await user.click(screen.getByRole('button', { name: 'Cancel test quote' }));
    expect(screen.queryByRole('dialog', { name: 'New Quote' })).toBeNull();
    expect(mock.queries.filter(query => query.table === 'quotes')).toHaveLength(before);
  });

  it('opens the selected quote editor and refreshes after saving', async () => {
    mock.pages = [{ data: [quote('1')], error: null }];
    const user = userEvent.setup();
    render(<QuotesPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit Q-1' }));
    expect(screen.getByRole('dialog', { name: 'Edit Quote' }).textContent).toContain('Editing 1');
    await user.click(screen.getByRole('button', { name: 'Save test quote edit' }));
    expect(await screen.findByText('Updated factory')).toBeTruthy();
  });

  it('shows an unavailable archive action without deleting or hiding quotes', async () => {
    mock.pages = [{ data: [quote('1'), quote('2')], error: null }];
    const user = userEvent.setup();
    render(<QuotesPage />);
    const archive = await screen.findByRole('button', { name: 'Archive Q-1 (coming soon)' });
    expect(archive.disabled).toBe(true);
    expect(archive.title).toBe('Archive quote (coming soon)');
    await user.click(archive);
    expect(mock.deleted).toEqual([]);
    expect(screen.getByRole('link', { name: 'ACM-1' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'ACM-2' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /delete/i })).toBeNull();
  });
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
    const user = userEvent.setup();
    render(<QuotesPage />);
    expect((await screen.findByRole('link', { name: 'ACM-1' })).getAttribute('href')).toBe('/v2/quotes/Q-1');
    expect(screen.getByRole('link', { name: 'Product 1' }).getAttribute('href')).toBe('/v2/products/ACM-1');
    expect(screen.getByRole('link', { name: 'ACM-1' }).getAttribute('title')).toBe('View quote Q-1');
    expect(screen.getByRole('link', { name: 'Product 1' }).getAttribute('title')).toBe('View product Product 1');
    await user.hover(screen.getByRole('link', { name: 'ACM-1' }));
    await user.hover(screen.getByRole('link', { name: 'Product 1' }));
    expect(screen.queryByRole('link', { name: 'View product' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Q-2' }).getAttribute('href')).toBe('/v2/quotes/Q-2');
    expect(screen.getByRole('link', { name: 'View quote' }).getAttribute('href')).toBe('/v2/quotes/3');
    expect(screen.getAllByText('No linked product')).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Product 2' })).toBeNull();
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
  it('looks up legacy UUID URLs by database id', async () => {
    mock.id = '123e4567-e89b-12d3-a456-426614174000';
    render(<Page />);
    await screen.findByText(`${type === 'quote' ? 'Quote' : 'Product'} not found.`);
    expect(mock.queries).toContainEqual(expect.objectContaining({ table: type === 'quote' ? 'quotes' : 'products', column: 'id', value: mock.id }));
  });

  it('shows loading, not found, and a link back', async () => {
    let resolve;
    mock.detail = new Promise(r => { resolve = r; });
    render(<Page />);
    expect(await screen.findByText(`Loading ${type}…`)).toBeTruthy();
    expect(screen.getByRole('link', { name: type === 'quote' ? '← Quotes' : '← Products' }).getAttribute('href')).toBe(type === 'quote' ? '/v2/quotes' : '/v2/products');
    resolve({ data: null, error: null });
    expect(await screen.findByText(`${type === 'quote' ? 'Quote' : 'Product'} not found.`)).toBeTruthy();
    expect(mock.queries).toContainEqual(expect.objectContaining({ table: type === 'quote' ? 'quotes' : 'products', column: type === 'quote' ? 'quote_code' : 'style_number', value: 'record-1' }));
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
    expect(screen.getByRole('link', { name: 'View product' }).getAttribute('href')).toBe('/v2/products/ACM-1');
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
  it('opens the editor and reloads the product after saving', async () => {
    mock.detail = Promise.resolve({ data: { id: 'product-uuid', name: 'Bottle' }, error: null });
    const user = userEvent.setup();
    render(<ProductPage />);
    await screen.findByRole('heading', { name: 'Bottle' });
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(mock.editProductId).toBe('product-uuid');
    await user.click(screen.getByRole('button', { name: 'Save test product' }));
    expect(await screen.findByRole('heading', { name: 'Updated product' })).toBeTruthy();
  });
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
