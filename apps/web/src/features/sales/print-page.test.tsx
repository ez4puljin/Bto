import { screen, waitFor } from '@testing-library/react';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { calls, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';

const order = (id: number, fields: Partial<Schemas['SalesOrderDetail']> = {}) =>
  ({
    id,
    number: `20261015_000${id}`,
    channel: 'ADMIN',
    status: 'CONFIRMED',
    customerId: 9,
    customerCode: '1001',
    customerName: 'Номин дэлгүүр',
    fulfilment: 'PICKUP',
    deliveryDate: '2026-10-16',
    addressId: null,
    addressText: null,
    addressLat: null,
    addressLng: null,
    contactName: null,
    contactPhone: null,
    paymentMethod: 'CASH',
    note: null,
    priceDate: '2026-10-15',
    subtotal: '1000',
    discountTotal: '0',
    total: '1000',
    submittedAt: STAMP,
    confirmedAt: STAMP,
    cancelledAt: null,
    cancelReason: null,
    boardId: 1,
    boardName: 'Хөвсгөл',
    pipelineId: 10,
    pipelineName: 'Бөөний борлуулалт',
    stageId: 2,
    stageName: 'Нярав Хяналт',
    stageEnteredAt: STAMP,
    pickedAt: null,
    deliveredAt: null,
    archivedAt: null,
    createdByName: null,
    canEdit: true,
    createdAt: STAMP,
    updatedAt: STAMP,
    lines: [],
    events: [],
    moves: [],
    ...fields,
  }) satisfies Schemas['SalesOrderDetail'];

describe('printing several orders', () => {
  it('prints one document per order, the delivery note without the drafts', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/sales-orders/batch': () =>
        json([
          order(5),
          order(6, { status: 'DRAFT', total: null, subtotal: null, priceDate: null }),
        ]),
    });
    renderApp('/sales/print/DELIVERY_NOTE?ids=5,6', fetchMock);
    expect(
      await screen.findByRole('heading', {
        name: `${mn.sales.printKinds.DELIVERY_NOTE} · 20261015_0005`,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/20261015_0006/)).toBeNull();
    const [request] = calls(fetchMock, 'GET', '/api/v1/sales-orders/batch');
    expect(new URL(request?.url ?? '').searchParams.get('ids')).toBe('5,6');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    print.mockRestore();
  });
});
