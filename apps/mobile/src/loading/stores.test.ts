import { describe, expect, it } from 'vitest';
import { keptTicks, type LoadingOrder, loadingSections, ordersToLoad, storeTotal } from './stores';

const order = (
  orderId: number,
  customerId: number,
  customerName: string,
  fields: Partial<LoadingOrder> = {},
): LoadingOrder => ({
  orderId,
  orderNumber: `20261110_000${orderId}`,
  status: 'PACKED',
  customerId,
  customerCode: `C${customerId}`,
  customerName,
  customerPhone: null,
  addressText: null,
  contactPhone: null,
  deliveryDate: '2026-11-11',
  paymentMethod: 'CASH',
  total: '1000',
  lineCount: 2,
  pickedAt: '2026-11-10T02:00:00.000Z',
  pipelineName: 'Мөрөн Борлуулалт',
  loading: null,
  ...fields,
});

describe('the driver loading list (ADR-0179)', () => {
  const loaded = {
    loadId: 1,
    driverId: 7,
    driverName: 'Бат',
    loadedAt: '2026-11-10T03:00:00.000Z',
  };
  const orders = [
    order(1, 10, 'Цэцэг'),
    order(2, 20, 'Алтай', { addressText: 'Мөрөн, 3-р баг' }),
    order(3, 10, 'Цэцэг', { total: '2500' }),
    order(4, 30, 'Багануур', { loading: loaded }),
  ];

  it('groups waiting orders by store, by name, and the loaded ones apart', () => {
    const sections = loadingSections(orders);
    expect(sections.waiting.map((store) => [store.customerName, store.orders.length])).toEqual([
      ['Алтай', 1],
      ['Цэцэг', 2],
    ]);
    expect(sections.waiting[0]?.addressText).toBe('Мөрөн, 3-р баг');
    expect(sections.loaded.map((store) => store.customerId)).toEqual([30]);
    expect(storeTotal(sections.waiting[1]!)).toBe('3500');
  });

  it('sends every waiting order of the ticked stores and drops stale ticks', () => {
    const sections = loadingSections(orders);
    expect(ordersToLoad(sections, new Set([10, 30]))).toEqual([1, 3]);
    expect([...keptTicks(sections, new Set([10, 30, 99]))]).toEqual([10]);
  });
});
