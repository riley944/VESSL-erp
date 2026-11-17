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

it('saves a typed shipping country when Save is clicked without pressing Enter', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<NewProductModal onClose={() => {}} onSaved={saved} />);
  await user.type(await screen.findByLabelText('Product Name *'), 'Bottle');
  await user.selectOptions(screen.getByLabelText('Client *'), 'c1');
  await user.click(screen.getByRole('tab', { name: 'Trade' }));
  await user.type(screen.getByPlaceholderText('US'), 'US');
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(mock.payload).toMatchObject({ ships_to: ['US'] });
  expect(saved).toHaveBeenCalledOnce();
});

it('saves specification, certification, trade and carton details together', async () => {
  const user = userEvent.setup();
  render(<NewProductModal onClose={() => {}} onSaved={() => {}} />);
  await user.type(await screen.findByLabelText('Product Name *'), 'Bottle');
  await user.selectOptions(screen.getByLabelText('Client *'), 'c1');
  await user.click(screen.getByRole('tab', { name: 'Specifications' }));
  await user.type(screen.getByLabelText('Unit'), 'pcs');
  await user.type(screen.getByLabelText('Weight (kg)'), '0.5');
  await user.click(screen.getByRole('tab', { name: 'Testing & certification' }));
  await user.selectOptions(screen.getByLabelText('CPSC'), 'CPC');
  await user.click(screen.getByRole('tab', { name: 'Trade' }));
  await user.type(screen.getByPlaceholderText('US'), 'US, JP');
  await user.keyboard('{Enter}');
  await user.type(screen.getByLabelText('Domestic / Import / Export'), 'Import');
  await user.selectOptions(screen.getByLabelText('Importer of record'), 'kui');
  await user.type(screen.getByLabelText('Who Pays for Testing'), 'Client');
  await user.click(screen.getByRole('tab', { name: 'Carton / case pack' }));
  await user.type(screen.getByLabelText('Units/Carton'), '24');
  await user.type(screen.getByLabelText('Carton Wt (kg)'), '10');
  await user.type(screen.getByLabelText('L (cm)'), '40');
  await user.type(screen.getByLabelText('W (cm)'), '30');
  await user.type(screen.getByLabelText('H (cm)'), '20');
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(mock.payload).toMatchObject({ unit_of_measure: 'pcs', weight_kg: 0.5, cpsc_type: 'CPC', ships_to: ['US', 'JP'], trade_direction: 'Import', kui_ior: true, testing_paid_by: 'Client', units_per_carton: 24, carton_weight_kg: 10, carton_l_cm: 40, carton_w_cm: 30, carton_h_cm: 20 });
});

it('blocks an invalid shipping country until corrected', async () => {
  const user = userEvent.setup();
  render(<NewProductModal onClose={() => {}} onSaved={() => {}} />);
  await user.type(await screen.findByLabelText('Product Name *'), 'Bottle');
  await user.selectOptions(screen.getByLabelText('Client *'), 'c1');
  await user.click(screen.getByRole('tab', { name: 'Trade' }));
  await user.type(screen.getByPlaceholderText('US'), 'UK');
  await user.keyboard('{Enter}');
  expect(screen.getByText('The ISO code for the United Kingdom is GB.')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save Product' }));
  expect(mock.payload).toBeNull();
});
