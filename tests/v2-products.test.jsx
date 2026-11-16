// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from '@/app/v2/products/page';

const mock = vi.hoisted(() => ({ products: [], quotes: [], fail: false, ranges: [] }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }) => <a href={href} {...props}>{children}</a> }));
vi.mock('@/app/v2/V2Shell', () => ({ default: ({ children }) => <>{children}</> }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => ({ select: () => ({ order: () => ({ range: (start, end) => {
  mock.ranges.push([table, start, end]);
  return Promise.resolve(mock.fail === table ? { data: null, error: { message: 'Unavailable' } } : { data: mock[table].slice(start, end + 1), error: null });
} }) }) }) } }));

beforeEach(() => {
  mock.fail = false; mock.ranges = [];
  mock.products = [
    { id: 'p1', style_number: 'ABC-2', name: 'Tote', active: true, company: { name: 'Acme' } },
    { id: 'p2', style_number: 'ABC-10', name: 'Cap', active: false, company: { name: 'Beta' } },
    { id: 'p3', style_number: null, name: 'Sample', active: null, company: null },
  ];
  mock.quotes = [
    { id: 'q-old', product_id: 'p1', quote_code: 'Q-1', created_at: '2025-01-01' },
    { id: 'q-new', product_id: 'p1', quote_code: 'Q-2', created_at: '2026-01-01' },
    { id: 'q-other', product_id: 'p2', quote_code: 'Q-3', created_at: '2026-01-01' },
  ];
});
afterEach(cleanup);

it('links styles to products and each linked quote to its own page', async () => {
  const user = userEvent.setup();
  render(<ProductsPage />);
  const style = await screen.findByRole('link', { name: 'ABC-2' });
  expect(style.getAttribute('href')).toBe('/v2/products/p1');
  const row = style.parentElement.parentElement;
  expect(style.previousElementSibling.querySelector('svg').classList.contains('lucide-shopping-bag')).toBe(true);
  expect(within(row).getByRole('link', { name: 'View quote for ABC-2' }).getAttribute('href')).toBe('/v2/quotes/q-new');
  expect(within(row).getByText('Latest quote')).toBeTruthy();
  await user.click(within(row).getByText('1 more quote'));
  expect(within(row).getByRole('link', { name: 'Q-1' }).getAttribute('href')).toBe('/v2/quotes/q-old');
  expect(screen.getByRole('link', { name: 'Style number not assigned' }).getAttribute('href')).toBe('/v2/products/p3');
  expect(screen.getByText('No linked quote')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Style number not assigned' }).previousElementSibling.querySelector('svg').classList.contains('lucide-package')).toBe(true);
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
