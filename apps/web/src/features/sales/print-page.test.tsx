import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { calls, list, WH1, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';
const WH2: Schemas['Warehouse'] = { ...WH1, id: 2, code: 'WH2', name: 'Хоёрдугаар агуулах' };
const PAPER_KEY = 'tugeel.printFormat.v1';

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

const part: Schemas['SalesOrderPart'] = {
  productUnitId: 201,
  uomName: 'хайрцаг',
  basis: 'WAREHOUSE',
  qty: '1',
  factorSnapshot: '12',
  qtyBase: '12',
  listPrice: '12000',
  unitPrice: '12000',
  subtotal: '12000',
  discountAmount: '0',
  total: '12000',
  applied: [],
};

const line = (id: number, warehouseId: number, fields: Partial<Schemas['SalesOrderLine']> = {}) =>
  ({
    id,
    lineNo: id,
    productId: 100 + id,
    productSku: `90${id}`,
    productName: `Цэвэр ус ${id}л`,
    productUnitId: 200 + id,
    unitName: 'хайрцаг',
    qty: '1',
    factorSnapshot: '12',
    qtyBase: '12',
    baseUnitName: 'ш',
    warehouseId,
    qtyApproved: '12',
    qtyBackordered: '0',
    qtyPicked: null,
    pickBinId: null,
    pickBinCode: null,
    qtyDelivered: null,
    subtotal: '12000',
    discountAmount: '0',
    total: '12000',
    parts: [part],
    ...fields,
  }) satisfies Schemas['SalesOrderLine'];

const lineCount = (count: number) => mn.sales.order.lineCount.replace('{{count}}', String(count));

describe('printing orders', () => {
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
    // No paper named and none chosen on this computer: A4.
    expect(document.querySelector('[data-format]')).toHaveAttribute('data-format', 'A4');
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    print.mockRestore();
  });

  it('prints the pick list per warehouse on the 80 mm roll, with the payment and the author', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': () => list([WH1, WH2]),
      'GET /api/v1/sales-orders/5': () =>
        json(
          order(5, {
            paymentMethod: 'CREDIT',
            createdByName: 'Систем Админ',
            lines: [
              line(1, 1),
              line(2, 2),
              line(3, 1, { pickBinCode: 'A-01-01', qtyPicked: '12' }),
            ],
          }),
        ),
    });
    renderApp('/sales/orders/5/print/PICK_LIST?format=80mm', fetchMock);
    // A section per warehouse, its lines counted (ADR-0058).
    expect(
      await screen.findByRole('heading', { name: `${WH1.name} · ${lineCount(2)}` }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: `${WH2.name} · ${lineCount(1)}` }),
    ).toBeInTheDocument();
    expect(screen.getByText(mn.sales.paymentMethods.CREDIT)).toBeInTheDocument();
    expect(screen.getByText('Систем Админ')).toBeInTheDocument();
    expect(screen.getByText(`${mn.sales.pick.bin}: A-01-01`)).toBeInTheDocument();
    // The roll: no margins and no size of its own, the printer's driver gives them.
    expect(document.querySelector('[data-format]')).toHaveAttribute('data-format', 'MM80');
    expect(
      [...document.querySelectorAll('style')].some((style) =>
        style.innerHTML.includes('@page { margin: 0; }'),
      ),
    ).toBe(true);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // Switching to A4 here keeps A4 for this computer.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: mn.sales.print.formats.A4 }));
    expect(document.querySelector('[data-format]')).toHaveAttribute('data-format', 'A4');
    expect(localStorage.getItem(PAPER_KEY)).toBe('a4');
    expect(
      screen.getByRole('heading', { name: `${WH2.name} · ${lineCount(1)}` }),
    ).toBeInTheDocument();
    print.mockRestore();
  });

  it('takes the paper this computer chose when the address names none', async () => {
    localStorage.setItem(PAPER_KEY, '80mm');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/sales-orders/5': () =>
        json(order(5, { subtotal: '12000', total: '12000', lines: [line(1, 1)] })),
    });
    renderApp('/sales/orders/5/print/DELIVERY_NOTE', fetchMock);
    expect(
      await screen.findByRole('heading', {
        name: `${mn.sales.printKinds.DELIVERY_NOTE} · 20261015_0005`,
      }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-format]')).toHaveAttribute('data-format', 'MM80');
    expect(screen.getByRole('tab', { name: mn.sales.print.formats.MM80 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // A row per priced part: the quantity times the price, then its total.
    expect(
      screen.getByText(
        mn.sales.print.partLine
          .replace('{{qty}}', '1')
          .replace('{{unit}}', 'хайрцаг')
          .replace('{{price}}', '12,000'),
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    print.mockRestore();
  });

  it('prints once although the page draws again while the print is pending', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fetchMock = signedIn(ADMIN_ME, {
      // The names arrive after the order: the print waits for them.
      'GET /api/v1/warehouses': () =>
        new Promise<Response>((resolve) => setTimeout(() => resolve(list([WH1, WH2])), 120)),
      'GET /api/v1/sales-orders/5': () => json(order(5, { lines: [line(1, 1), line(2, 2)] })),
    });
    renderApp('/sales/orders/5/print/PICK_LIST?format=a4', fetchMock);
    expect(
      await screen.findByRole('heading', { name: `${WH2.name} · ${lineCount(1)}` }),
    ).toBeInTheDocument();
    // A new paper within the 300 ms draws the page again; the pending print still comes.
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: mn.sales.print.formats.MM80 }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(document.title).toBe(`20261015_0005 · ${mn.sales.printKinds.PICK_LIST}`);
    print.mockRestore();
  });
});
