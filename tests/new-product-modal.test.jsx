// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NewProductModal from '@/app/v2/products/NewProductModal';

const mock = vi.hoisted(() => ({ payload: null, loadError: false, saveError: null }));
vi.mock('@/app/components/HtsField', () => ({ HtsField: () => null, useHtsCodes: () => ({ codes: [], addCode: () => {} }) }));
vi.mock('@/app/components/CodeModal', () => ({ CodeModal: () => null }));
vi.mock('@/app/components/LifecyclePanel', () => ({ LifecyclePanel: () => null }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => {
  if (table === 'companies') return { select: () => ({ eq: () => ({ order: () => ({ range: async () => mock.loadError ? { error: { message: 'offline' } } : { data: [{ id: 'c1', name: 'Acme' }], error: null } }) }) }) };
  if (table === 'quotes') return { select: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) };
  return { insert: async payload => { mock.payload = payload; return { error: mock.saveError }; } };
} } }));
beforeEach(() => { mock.payload = null; mock.loadError = false; mock.saveError = null; vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('creates a product for the selected client with details from multiple tabs', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<NewProductModal onClose={() => {}} onSaved={saved} />);
  await screen.findByRole('dialog', { name: 'New Product' });
  const name = await screen.findByLabelText('Product Name *');
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(window.alert).toHaveBeenCalledWith('Product name required');
  await user.type(name, 'travel bottle');
  await user.selectOptions(screen.getByLabelText('Client *'), 'c1');
  await user.selectOptions(screen.getByLabelText('Status'), 'active');
  await user.click(screen.getByRole('tab', { name: 'Specifications' }));
  await user.type(screen.getByPlaceholderText('e.g. 51% Cotton 49% Polyester'), 'Steel');
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(mock.payload).toMatchObject({ name: 'Travel Bottle', client_company_id: 'c1', active: true, composition: 'Steel' });
  expect(mock.payload).not.toHaveProperty('style_number');
  expect(saved).toHaveBeenCalledOnce();
});

it('allows retrying a failed client lookup', async () => {
  mock.loadError = true;
  const user = userEvent.setup();
  render(<NewProductModal onClose={() => {}} onSaved={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load clients.');
  mock.loadError = false;
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByLabelText('Client *')).toBeTruthy();
});

it('keeps a product draft open when the insert fails', async () => {
  mock.saveError = { code: '23505', message: 'duplicate key' };
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<NewProductModal onClose={() => {}} onSaved={saved} />);
  await user.type(await screen.findByLabelText('Product Name *'), 'Bottle');
  await user.selectOptions(screen.getByLabelText('Client *'), 'c1');
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(window.alert).toHaveBeenCalledWith('That SKU already exists');
  expect(saved).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Product Name *').value).toBe('Bottle');
});

it('requires a client even when saving from another tab', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<NewProductModal onClose={() => {}} onSaved={saved} />);
  await user.type(await screen.findByLabelText('Product Name *'), 'Bottle');
  await user.click(screen.getByRole('tab', { name: 'Trade' }));
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(window.alert).toHaveBeenCalledWith('Select a client to create a product.');
  expect(screen.getByRole('tab', { name: 'Product details' }).getAttribute('aria-selected')).toBe('true');
  expect(mock.payload).toBeNull();
  expect(saved).not.toHaveBeenCalled();
});
