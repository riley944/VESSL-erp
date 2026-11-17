// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EditProductModal from '@/app/v2/products/EditProductModal';

const mock = vi.hoisted(() => ({ payload: null, id: null, error: null, loadError: null, updated: [{ id: 'p1' }] }));
vi.mock('@/app/components/HtsField', () => ({ HtsField: () => null, useHtsCodes: () => ({ codes: [], addCode: () => {} }) }));
vi.mock('@/app/components/CodeModal', () => ({ CodeModal: () => null }));
vi.mock('@/app/components/LifecyclePanel', () => ({ LifecyclePanel: () => null }));
vi.mock('@/lib/supabase', () => ({ SB: { from: table => {
  if (table === 'quotes') return { select: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }) }) };
  return {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mock.loadError ? null : { id: 'p1', name: 'Bottle', sku: 'ABC', weight_kg: 0, active: true, ships_to: ['US'] }, error: mock.loadError }) }) }),
    update: payload => { mock.payload = payload; return { eq: (_, id) => { mock.id = id; return { select: async () => ({ data: mock.updated, error: mock.error }) }; } }; },
  };
} } }));
beforeEach(() => { mock.payload = null; mock.id = null; mock.error = null; mock.loadError = null; mock.updated = [{ id: 'p1' }]; vi.spyOn(window, 'alert').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('saves from the first step and only updates changed fields', async () => {
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={saved} />);
  const name = await screen.findByLabelText('Product Name *');
  await user.clear(name);
  await user.type(name, 'New bottle');
  await user.selectOptions(screen.getByLabelText('Status'), 'inactive');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mock.id).toBe('p1');
  expect(mock.payload).toEqual({ name: 'New Bottle', active: false });
  expect(saved).toHaveBeenCalledOnce();
});

it('preserves a zero entered for a numeric product field', async () => {
  const user = userEvent.setup();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('Product Name *');
  await user.click(screen.getByRole('tab', { name: 'Specifications' }));
  const weight = screen.getByLabelText('Weight (kg)');
  await user.clear(weight);
  await user.type(weight, '0.0');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(mock.payload).toEqual({ weight_kg: 0 });
});

it('preserves form values across steps and requires a name when saving', async () => {
  const user = userEvent.setup();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={() => {}} />);
  const name = await screen.findByLabelText('Product Name *');
  await user.clear(name);
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(window.alert).toHaveBeenCalledWith('Product name required');
  expect(screen.getByRole('tab', { name: 'Product details' }).getAttribute('aria-selected')).toBe('true');
  expect(screen.getByLabelText('Product Name *').value).toBe('');
  expect(mock.payload).toBeNull();
});

it('allows jumping between product tabs with save on each', async () => {
  const user = userEvent.setup();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={() => {}} />);
  await screen.findByLabelText('Product Name *');
  for (const label of ['Carton / case pack', 'Specifications', 'Testing & certification', 'Trade', 'Product details']) {
    await user.click(screen.getByRole('tab', { name: label }));
    expect(screen.getByRole('tab', { name: label }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Save Changes' })).toBeTruthy();
  }
  await user.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('tab', { name: 'Specifications' }).getAttribute('aria-selected')).toBe('true');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('tab', { name: 'Product details' }).getAttribute('aria-selected')).toBe('true');
  screen.getByRole('tab', { name: 'Product details' }).focus();
  await user.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Specifications' }));
  expect(screen.getByRole('tabpanel', { name: 'Specifications' })).toBeTruthy();
});

it('shows load and save errors', async () => {
  mock.loadError = { message: 'offline' };
  const view = render(<EditProductModal id="p1" onClose={() => {}} onSaved={() => {}} />);
  expect((await screen.findByRole('alert')).textContent).toBe('Could not load product.');
  view.unmount();
  mock.loadError = null;
  mock.error = { message: 'Cannot save' };
  const user = userEvent.setup();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={() => {}} />);
  const name = await screen.findByLabelText('Product Name *');
  await user.type(name, ' new');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(window.alert).toHaveBeenCalledWith('Error: Cannot save');
  expect(screen.getByRole('button', { name: 'Save Changes' }).disabled).toBe(false);
});

it('keeps the draft open when an update matches no product', async () => {
  mock.updated = [];
  const user = userEvent.setup();
  const saved = vi.fn();
  render(<EditProductModal id="p1" onClose={() => {}} onSaved={saved} />);
  const name = await screen.findByLabelText('Product Name *');
  await user.type(name, ' new');
  await user.click(screen.getByRole('button', { name: 'Save Changes' }));
  expect(window.alert).toHaveBeenCalledWith('Error: No product was updated. It may no longer exist or you may not have permission.');
  expect(saved).not.toHaveBeenCalled();
  expect(name.value).toBe('Bottle new');
  expect(screen.getByRole('button', { name: 'Save Changes' }).disabled).toBe(false);
});
