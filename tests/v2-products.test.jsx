// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from '@/app/v2/products/page';

const mock = vi.hoisted(() => ({ products: [], quotes: [], companies: [], purchase_order_items: [], factoryId: '', clientId: '', fail: false, ranges: [], deleteError: null, deleteEmpty: false, deletedIds: [] }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams({ ...(mock.factoryId ? { factoryId: mock.factoryId } : {}), ...(mock.clientId ? { clientId: mock.clientId } : {}) }) }));
vi.mock('@/app/v2/V2Shell', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/app/v2/products/EditProductModal', () => ({ default: ({ id, onSaved }) => <button onClick={() => { mock.products = mock.products.map(p => p.id === id ? { ...p, name: 'Updated tote' } : p); onSaved(); }}>Save test product</button> }));
vi.mock('@/app/v2/products/NewProductModal', () => ({ default: ({ onSaved }) => <button onClick={() => { mock.products.push({ id: 'new', name: 'New product', style_number: 'NEW-1' }); onSaved(); }}>Create test product</button> }));
vi.mock('@/app/v2/quotes/QuoteModal', () => ({ default: ({ newQuote, onSaved, onClose }) => <div role="dialog" aria-label="New Quote"><span>{newQuote.productId} / {newQuote.product} / {newQuote.clientId} / {newQuote.client}</span><button onClick={() => { mock.quotes.push({ id: 'q-added', product_id: newQuote.productId, quote_code: 'Q-NEW' }); onSaved(); }}>Save test quote</button><button onClick={onClose}>Close test quote</button></div> }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => ({ delete: () => ({ eq: (column, id) => ({ select: async () => {
  mock.deletedIds.push([column, id]);
  return mock.deleteError ? { data: null, error: mock.deleteError } : { data: mock.deleteEmpty ? [] : [{ id }], error: null };
} }) }), select: () => ({ order: () => ({ range: (start, end) => {
  mock.ranges.push([table, start, end]);
  return Promise.resolve(mock.fail === table ? { data: null, error: { message: 'Unavailable' } } : { data: mock[table].slice(start, end + 1), error: null });
} }) }) }) } }));

beforeEach(() => {
  mock.fail = false; mock.ranges = []; mock.deleteError = null; mock.deleteEmpty = false; mock.deletedIds = []; mock.factoryId = ''; mock.clientId = '';
  mock.companies = [{ id: 'f1', name: 'Factory One', type: 'factory' }, { id: 'f2', name: 'Factory Two', type: 'factory' }, { id: 'c1', name: 'Acme', type: 'client' }];
  mock.purchase_order_items = [];
  mock.products = [
    { id: 'p1', style_number: 'ABC-2', name: 'Tote', sku: 'SKU-2', active: true, client_company_id: 'c1', company: { name: 'Acme' } },
    { id: 'p2', style_number: 'ABC-10', name: 'Cap', active: false, company: { name: 'Beta' } },
    { id: 'p3', style_number: null, name: 'Sample', active: null, client_company_id: 'c3', company: { name: 'Gamma' } },
  ];
  mock.quotes = [
    { id: 'q-old', product_id: 'p1', quote_code: 'Q-1', created_at: '2025-01-01' },
    { id: 'q-new', product_id: 'p1', quote_code: 'Q-2', created_at: '2026-01-01' },
    { id: 'q-other', product_id: 'p2', quote_code: 'Q-3', created_at: '2026-01-01' },
  ];
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('links styles to products and each linked quote to its own page', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  const style = await screen.findByRole('link', { name: 'ABC-2' });
  expect(screen.getByRole('link', { name: '← Clients' }).getAttribute('href')).toBe('/v2/clients');
  expect(style.getAttribute('href')).toBe('/v2/products/ABC-2');
  const row = style.parentElement.parentElement;
  expect(within(row).getByRole('link', { name: 'Acme' }).getAttribute('href')).toBe('/v2/clients/c1');
  const unlinkedRow = screen.getByRole('link', { name: 'ABC-10' }).parentElement.parentElement;
  expect(within(unlinkedRow).getByText('Beta').tagName).not.toBe('A');
  expect(style.previousElementSibling.querySelector('svg').classList.contains('lucide-shopping-bag')).toBe(true);
  expect(within(row).getByRole('link', { name: 'View quote for ABC-2' }).getAttribute('href')).toBe('/v2/quotes/Q-2');
  expect(within(row).getByRole('button', { name: 'Delete ABC-2' }).className).toContain('delete');
  expect(within(row).getByText('Latest quote')).toBeTruthy();
  await user.click(within(row).getByText('1 more quote'));
  expect(within(row).getByRole('link', { name: 'Q-1' }).getAttribute('href')).toBe('/v2/quotes/Q-1');
  expect(screen.getByRole('link', { name: 'Style number not assigned' }).getAttribute('href')).toBe('/v2/products/p3');
  expect(screen.getByRole('button', { name: 'Add quote for Sample' })).toBeTruthy();
  const unquotedActions = screen.getByRole('button', { name: 'Delete Sample' }).parentElement;
  expect(unquotedActions.children[0]).toBe(screen.getByRole('button', { name: 'Add quote for Sample' }));
  expect(unquotedActions.children[2]).toBe(screen.getByRole('button', { name: 'Delete Sample' }));
  expect(within(row).getByRole('button', { name: 'Delete ABC-2' }).parentElement.children[2]).toBe(within(row).getByRole('button', { name: 'Delete ABC-2' }));
  expect(screen.getByRole('link', { name: 'Style number not assigned' }).previousElementSibling.querySelector('svg').classList.contains('lucide-package')).toBe(true);
});

it('opens the quote form for the chosen unquoted product and refreshes after saving', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  await user.click(await screen.findByRole('button', { name: 'Add quote for Sample' }));
  expect(screen.getByRole('dialog', { name: 'New Quote' }).textContent).toContain('p3 / Sample / c3 / Gamma');
  await user.click(screen.getByRole('button', { name: 'Save test quote' }));
  expect((await screen.findByRole('link', { name: 'View quote for Sample' })).getAttribute('href')).toBe('/v2/quotes/Q-NEW');
  expect(screen.getByRole('button', { name: 'Add quote for Sample' })).toBeTruthy();
});

it('adds another quote to a product while retaining its existing quotes', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  await user.click(await screen.findByRole('button', { name: 'Add quote for ABC-2' }));
  expect(screen.getByRole('dialog', { name: 'New Quote' }).textContent).toContain('p1 / Tote / c1 / Acme');
  await user.click(screen.getByRole('button', { name: 'Save test quote' }));
  await user.click(await screen.findByText('2 more quotes'));
  expect(screen.getByRole('link', { name: 'Q-1' }).getAttribute('href')).toBe('/v2/quotes/Q-1');
  expect(screen.getByRole('link', { name: 'Q-NEW' }).getAttribute('href')).toBe('/v2/quotes/Q-NEW');
  expect(screen.getByRole('link', { name: 'View quote for ABC-2' }).getAttribute('href')).toBe('/v2/quotes/Q-2');
  expect(screen.getByRole('button', { name: 'Add quote for ABC-2' })).toBeTruthy();
});

it('filters by catalog status and searches styles, names and clients', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  await screen.findByRole('link', { name: 'ABC-2' });
  await user.click(screen.getByRole('button', { name: /Inactive/ }));
  expect(screen.getByRole('link', { name: 'ABC-10' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'ABC-2' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /All products/ }));
  const search = screen.getByRole('searchbox', { name: 'Search products' });
  await user.type(search, 'abc 2');
  expect(screen.getByRole('link', { name: 'ABC-2' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'ABC-10' })).toBeNull();
  await user.clear(search);
  await user.type(search, 'beta');
  expect(screen.getByRole('link', { name: 'ABC-10' })).toBeTruthy();
  await user.type(search, 'missing');
  expect(screen.getByText('No products match these filters.')).toBeTruthy();
});

it('opens a factory-filtered list on active products and allows other statuses', async () => {
  mock.factoryId = 'f1';
  mock.quotes = [
    { id: 'q1', product_id: 'p1', factory: 'Old factory name', factory_company_id: 'f1' },
    { id: 'q2', product_id: 'p1', factory: 'Factory One' },
    { id: 'q3', product_id: 'p3', factory: 'Factory One', factory_company_id: 'f2' },
  ];
  mock.purchase_order_items = [{ id: 'i1', product_id: 'p1', purchase_orders: { factory_company_id: 'f1' } }, { id: 'i2', product_id: 'p2', purchase_orders: { factory_company_id: 'f1' } }];
  const user = userEvent.setup();
  render(<ProductsPage />);
  expect(await screen.findByRole('link', { name: 'ABC-2' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'ABC-10' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Style number not assigned' })).toBeNull();
  expect(screen.getByText('Factory One')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Clear factory filter' }).getAttribute('href')).toBe('/v2/products');
  expect(screen.getByRole('button', { name: /Active/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('1 product shown')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /All products/ }));
  expect(screen.getByRole('link', { name: 'ABC-10' })).toBeTruthy();
  expect(screen.getByText('2 products shown')).toBeTruthy();
});

it('shows no products for a factory with no links and handles association query errors', async () => {
  mock.factoryId = 'f2';
  mock.fail = 'purchase_order_items';
  const user = userEvent.setup();
  render(<ProductsPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  mock.fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No products match these filters.')).toBeTruthy();
  expect(screen.getByText('0 products shown')).toBeTruthy();
});

it('filters products by client ID and starts on the active tab', async () => {
  mock.clientId = 'c1';
  mock.products.push({ id: 'p4', style_number: 'ABC-11', name: 'Inactive Acme', active: false, client_company_id: 'c1', company: { name: 'Acme' } });
  mock.products.push({ id: 'p5', style_number: 'OTHER-1', name: 'Other Acme', active: true, client_company_id: 'other', company: { name: 'Acme' } });
  const user = userEvent.setup();
  render(<ProductsPage />);
  expect(await screen.findByRole('link', { name: 'ABC-2' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'ABC-11' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'OTHER-1' })).toBeNull();
  expect(screen.getByRole('button', { name: /Active/ }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText('1 product shown')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Clear client filter' }).getAttribute('href')).toBe('/v2/products');
  await user.click(screen.getByRole('button', { name: /All products/ }));
  expect(screen.getByRole('link', { name: 'ABC-11' })).toBeTruthy();
  expect(screen.getByText('2 products shown')).toBeTruthy();
});

it('combines client and factory filters and clears each independently', async () => {
  mock.clientId = 'c1'; mock.factoryId = 'f1';
  mock.quotes = [{ id: 'q1', product_id: 'p1', factory_company_id: 'f1' }, { id: 'q2', product_id: 'p3', factory_company_id: 'f1' }];
  render(<ProductsPage />);
  expect(await screen.findByRole('link', { name: 'ABC-2' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Clear factory filter' }).getAttribute('href')).toBe('/v2/products?clientId=c1');
  expect(screen.getByRole('link', { name: 'Clear client filter' }).getAttribute('href')).toBe('/v2/products?factoryId=f1');
  expect(screen.getByText('1 product shown')).toBeTruthy();
});

it('loads all pages and offers retry when either query fails', async () => {
  mock.products = Array.from({ length: 1000 }, (_, i) => ({ id: `p${i}`, style_number: `P-${i}` }));
  mock.fail = 'quotes';
  const user = userEvent.setup();
  render(<ProductsPage />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  mock.fail = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('1000 products shown')).toBeTruthy();
  expect(mock.ranges).toContainEqual(['products', 1000, 1999]);
});

it('opens editing for a product and reloads the updated list', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  await screen.findByRole('link', { name: 'ABC-2' });
  await user.click(screen.getByRole('button', { name: 'Edit ABC-2' }));
  await user.click(screen.getByRole('button', { name: 'Save test product' }));
  expect(await screen.findByText('Updated tote')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Edit Sample' })).toBeTruthy();
});

it('opens creation and shows the new product after saving', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  await screen.findByRole('link', { name: 'ABC-2' });
  await user.click(screen.getByRole('button', { name: '+ New product' }));
  await user.click(screen.getByRole('button', { name: 'Create test product' }));
  expect(await screen.findByRole('link', { name: 'NEW-1' })).toBeTruthy();
});

it('deletes only the confirmed product and updates the counts', async () => {
  const user = userEvent.setup();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<ProductsPage />);
  await user.click(await screen.findByRole('button', { name: 'Delete ABC-2' }));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('ABC-2'));
  expect(mock.deletedIds).toEqual([['id', 'p1']]);
  expect(screen.queryByRole('link', { name: 'ABC-2' })).toBeNull();
  expect(screen.getByRole('link', { name: 'ABC-10' })).toBeTruthy();
  expect(screen.getByText('2 products shown')).toBeTruthy();
});

it('does not delete if confirmation is cancelled', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const user = userEvent.setup();
  render(<ProductsPage />);
  await user.click(await screen.findByRole('button', { name: 'Delete ABC-2' }));
  expect(mock.deletedIds).toEqual([]);
  expect(screen.getByRole('link', { name: 'ABC-2' })).toBeTruthy();
});

it.each([
  [{ code: '23503', message: 'foreign key violation' }, false, 'This product is linked to other records and cannot be deleted.'],
  [null, true, 'No product was deleted'],
  [{ message: 'Database unavailable' }, false, 'Database unavailable'],
])('keeps the product visible when deletion fails', async (error, empty, message) => {
  mock.deleteError = error; mock.deleteEmpty = empty;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = userEvent.setup();
  render(<ProductsPage />);
  await user.click(await screen.findByRole('button', { name: 'Delete ABC-2' }));
  expect((await screen.findByRole('alert')).textContent).toContain(message);
  expect(screen.getByRole('link', { name: 'ABC-2' })).toBeTruthy();
});
