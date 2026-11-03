import { describe, expect, it } from 'vitest';
import { lastActualEvent, shipmentStatusLabel } from '@/lib/shipmentStatus';

describe('shipment status', () => {
  it('uses readable labels and falls back for unknown statuses', () => {
    expect(shipmentStatusLabel('out_for_delivery')).toBe('Out for Delivery');
    expect(shipmentStatusLabel('awaiting_pickup')).toBe('awaiting pickup');
  });

  it('finds the latest actual event, ignoring estimates and missing dates', () => {
    const latest = { event_status: 'ACT', event_time: '2026-01-02T00:00:00Z' };
    const events = [
      { event_status: 'ACT', event_time: '2026-01-01T00:00:00Z' },
      { event_status: 'EST', event_time: '2026-01-03T00:00:00Z' },
      { event_status: 'ACT', event_time: null },
      latest,
    ];
    expect(lastActualEvent(events)).toEqual(latest);
    expect(lastActualEvent([])).toBeNull();
  });
});
