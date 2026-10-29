import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-29T02:00:00.000Z';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const KEEPER_ME: Me = {
  ...ADMIN_ME,
  id: 4,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
  writableWarehouseIds: [1],
};

const SUMMARY: Schemas['PurchaseOrderSummary'] = {
  id: 7,
  number: 'PO-2026-000007',
  orderDate: '2026-10-29',
  note: 'Сарын эцсийн захиалга',
  status: 'PREPARING',
  supplierCount: 2,
  supplierNames: ['МСМ ХХК', 'Сүү ХК'],
  createdAt: STAMP,
};

const MSM: Schemas['PurchaseOrderSupplier'] = {
  supplierId: 31,
  supplierCode: 'S031',
  supplierName: 'МСМ ХХК',
  status: 'PREPARING',
  statusChangedAt: STAMP,
  ordererId: 1,
  ordererName: 'Админ Бат',
  lineCount: 1,
  qtyBase: '24',
  weightKg: '12',
  estimatedCost: '48000.00',
  receiptId: null,
  receiptNumber: null,
  canEdit: true,
  canMoveNext: true,
  canMoveBack: false,
};
const MILK: Schemas['PurchaseOrderSupplier'] = {
  ...MSM,
  supplierId: 32,
  supplierCode: 'S032',
  supplierName: 'Сүү ХК',
  status: 'ARRIVED',
  lineCount: 3,
  receiptId: 55,
  receiptNumber: null,
  canEdit: false,
  canMoveNext: false,
  canMoveBack: true,
};

const DETAIL: Schemas['PurchaseOrderDetail'] = {
  id: 7,
  number: 'PO-2026-000007',
  orderDate: '2026-10-29',
  note: null,
  status: 'PREPARING',
  createdBy: 'Админ Бат',
  createdAt: STAMP,
  updatedAt: STAMP,
  suppliers: [MSM, MILK],
};

const units = (id: number, box: string): Schemas['PurchaseOrderGridUnit'][] => [
  { id: id * 10, name: 'ш', factor: '1', isBase: true },
  { id: id * 10 + 1, name: 'хайрцаг', factor: box, isBase: false },
];

const COLA: Schemas['PurchaseOrderGridRow'] = {
  productId: 10,
  sku: '1001',
  name: 'Кока кола 0.5л',
  weightKg: '0.5',
  units: units(10, '12'),
  homeWarehouseId: 1,
  homeWarehouseName: 'Төв агуулах',
  onHand: '6',
  minQty: '24',
  lastMonthOut: '120',
  lastBasePrice: '2000.00',
  lastPriceDate: '2026-10-01',
  line: { productUnitId: 101, qty: '2', qtyBase: '24' },
  editable: true,
};
const WATER: Schemas['PurchaseOrderGridRow'] = {
  ...COLA,
  productId: 11,
  sku: '1002',
  name: 'Ус 1л',
  units: units(11, '6'),
  onHand: '40',
  minQty: '10',
  lastMonthOut: '30',
  lastBasePrice: '800.00',
  line: null,
};
const JUICE: Schemas['PurchaseOrderGridRow'] = {
  ...COLA,
  productId: 12,
  sku: '1003',
  name: 'Жүүс 1л',
  units: units(12, '8'),
  onHand: '0',
  minQty: null,
  lastMonthOut: '0',
  lastBasePrice: null,
  line: null,
};

const gridPage = (rows: Schemas['PurchaseOrderGridRow'][]) =>
  json({
    data: rows,
    nextCursor: null,
    total: rows.length,
    outflowFrom: '2026-09-29',
    outflowTo: '2026-10-28',
  });

/** The rows as a keeper reads them: no prices at all. */
const withoutPrices = (row: Schemas['PurchaseOrderGridRow']) => {
  const copy: Partial<Schemas['PurchaseOrderGridRow']> = { ...row };
  delete copy.lastBasePrice;
  delete copy.lastPriceDate;
  return copy;
};

const ROWS_PATH = '/api/v1/purchase-orders/7/suppliers/31/rows';

describe('purchase orders', () => {
  it('lists orders with their suppliers and lowest status', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/purchase-orders': () => list([SUMMARY]),
    });
    renderApp('/procurement/orders', fetchMock);

    const link = await screen.findByRole('link', { name: SUMMARY.number });
    expect(link).toHaveAttribute('href', '/procurement/orders/7');
    const row = link.closest('tr');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText('МСМ ХХК, Сүү ХК')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(mn.procurement.status.PREPARING)).toBeVisible();
    expect(screen.getByRole('button', { name: mn.procurement.orders.create })).toBeInTheDocument();
  });

  it('shows the supplier strip and the grid, and saves only the edited cells', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/purchase-orders/7': () => json(DETAIL),
      [`GET ${ROWS_PATH}`]: () => gridPage([COLA, WATER, JUICE]),
      'PUT /api/v1/purchase-orders/7/suppliers/31/lines': async (request) => {
        saved.push(await request.json());
        return json({ applied: 2, conflicts: [], refused: [] });
      },
    });
    renderApp('/procurement/orders/7', fetchMock);

    const strip = await screen.findByRole('region', { name: mn.procurement.order.suppliers });
    expect(within(strip).getByRole('button', { name: 'МСМ ХХК' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(strip).getByText(mn.procurement.status.ARRIVED)).toBeInTheDocument();
    expect(within(strip).getByRole('link', { name: 'Ноорог №55' })).toHaveAttribute(
      'href',
      '/inventory/receipts/55',
    );
    expect(
      within(strip).getByRole('button', { name: `${mn.procurement.supplier.next}: МСМ ХХК` }),
    ).toBeInTheDocument();

    const cola = await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' });
    expect(cola).toHaveValue('2');
    // A box is the default unit of a product not ordered yet.
    expect(screen.getByRole('combobox', { name: 'Нэгж: 1002 Ус 1л' })).toHaveValue('111');
    expect(screen.getByRole('columnheader', { name: mn.procurement.grid.lastPrice })).toBeVisible();

    await user.clear(cola);
    await user.type(cola, '3{Enter}');
    const water = screen.getByRole('textbox', { name: 'Тоо: 1002 Ус 1л' });
    expect(water).toHaveFocus();
    await user.paste('5');

    const save = screen.getByRole('button', { name: 'Хадгалах (2)' });
    await user.click(save);

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      changes: [
        { productId: 10, productUnitId: 101, qty: '3', previousUnitId: 101, previousQty: '2' },
        {
          productId: 11,
          productUnitId: 111,
          qty: '5',
          previousUnitId: null,
          previousQty: null,
        },
      ],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('2 мөр хадгалагдлаа');
  }, 15_000);

  it('names the cells someone else changed and keeps their value', async () => {
    const user = userEvent.setup();
    let rows = [COLA, WATER];
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/purchase-orders/7': () => json(DETAIL),
      [`GET ${ROWS_PATH}`]: () => gridPage(rows),
      'PUT /api/v1/purchase-orders/7/suppliers/31/lines': () => {
        rows = [{ ...COLA, line: { productUnitId: 101, qty: '4', qtyBase: '48' } }, WATER];
        return json({
          applied: 0,
          conflicts: [{ productId: 10, productUnitId: 101, qty: '4' }],
          refused: [],
        });
      },
    });
    renderApp('/procurement/orders/7?supplier=31', fetchMock);

    const cola = await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' });
    await user.clear(cola);
    await user.paste('9');
    await user.click(screen.getByRole('button', { name: 'Хадгалах (1)' }));

    const notice = await screen.findByText(mn.procurement.grid.notSavedTitle);
    expect(notice.closest('[role="alert"]') ?? notice.parentElement).toHaveTextContent(
      '1001 Кока кола 0.5л: одоо 4 хайрцаг',
    );
    await waitFor(() => expect(cola).toHaveValue('4'));
    expect(screen.getByRole('button', { name: 'Хадгалах (0)' })).toBeDisabled();
  }, 15_000);

  it('shows a keeper no prices and no estimated cost', async () => {
    const fetchMock = signedIn(KEEPER_ME, {
      'GET /api/v1/purchase-orders/7': () =>
        json({
          ...DETAIL,
          suppliers: [
            { ...MSM, estimatedCost: null },
            { ...MILK, estimatedCost: null },
          ],
        }),
      [`GET ${ROWS_PATH}`]: () => gridPage([COLA, WATER].map(withoutPrices) as never),
    });
    renderApp('/procurement/orders/7', fetchMock);

    expect(
      await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: mn.procurement.grid.onHand })).toBeVisible();
    expect(
      screen.queryByRole('columnheader', { name: mn.procurement.grid.lastPrice }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: mn.procurement.grid.estimatedCost }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(mn.procurement.supplier.estimatedCost)).not.toBeInTheDocument();
    // Keepers do not manage the order.
    expect(
      screen.queryByRole('button', { name: mn.procurement.order.addSuppliers }),
    ).not.toBeInTheDocument();
  });
});
