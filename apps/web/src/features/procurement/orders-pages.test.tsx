import { focusManager } from '@tanstack/react-query';
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
  archivedAt: null,
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
  shippedBase: '0',
  arrivedBase: null,
  uncheckedLines: 0,
  estimatedCost: '48000.00',
  finalAmount: null,
  priceDiffCount: null,
  noteTotalQty: null,
  noteTotalAmount: null,
  receiptId: null,
  receiptNumber: null,
  canEdit: true,
  canShip: false,
  canCount: false,
  canPrice: false,
  canMoveNext: true,
  canMoveBack: false,
};
const MILK: Schemas['PurchaseOrderSupplier'] = {
  ...MSM,
  supplierId: 32,
  supplierCode: 'S032',
  supplierName: 'Сүү ХК',
  status: 'ARRIVED',
  lineCount: 1,
  receiptId: 55,
  receiptNumber: null,
  canEdit: false,
  canCount: true,
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
  archivedAt: null,
  archivedBy: null,
  canArchive: false,
  suppliers: [MSM, MILK],
};
const VERSION: Schemas['PurchaseOrderVersion'] = { updatedAt: STAMP, receiptsUpdatedAt: null };

const units = (id: number, box: string): Schemas['PurchaseOrderGridUnit'][] => [
  { id: id * 10, name: 'ш', factor: '1', isBase: true },
  { id: id * 10 + 1, name: 'хайрцаг', factor: box, isBase: false },
];
const SALES = { avg12: '96', avg3: '120', lastMonth: '120', sameMonthLastYear: '84' };

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
  sales: SALES,
  lastBasePrice: '2000.00',
  lastPriceDate: '2026-10-01',
  line: { productUnitId: 101, qty: '2', qtyBase: '24', shippedQty: null },
  editable: true,
  canShip: false,
  receipt: null,
  extra: false,
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
/** The milk supplier's one product, arrived: 4 boxes of 12 expected, not counted yet. */
const MILK_ROW: Schemas['PurchaseOrderGridRow'] = {
  ...COLA,
  productId: 20,
  sku: '2001',
  name: 'Сүү 1л',
  units: units(20, '12'),
  line: { productUnitId: 201, qty: '4', qtyBase: '48', shippedQty: '4' },
  editable: false,
  receipt: {
    lineId: 501,
    warehouseId: 1,
    unitName: 'хайрцаг',
    factor: '12',
    expectedBase: '48',
    arrivedBase: null,
    checkedAt: null,
    note: null,
    confirmed: false,
    canCount: true,
    docUnitPrice: '24000.00',
    docAmount: null,
    previousUnitPrice: null,
    previousDate: null,
  },
};

const RIGHTS = { order: true, shipped: false, count: false, price: false };
const gridPage = (
  rows: Schemas['PurchaseOrderGridRow'][],
  extra: Partial<Schemas['PurchaseOrderGridPage']> = {},
) =>
  json({
    data: rows,
    nextCursor: null,
    total: rows.length,
    outflowFrom: '2026-09-01',
    outflowTo: '2026-09-30',
    salesFrom: '2025-10',
    salesTo: '2026-09',
    rights: RIGHTS,
    receipt: null,
    extra: [],
    ...extra,
  });

/** The rows as a keeper reads them: no prices at all. */
const withoutPrices = (row: Schemas['PurchaseOrderGridRow']) => {
  const copy: Partial<Schemas['PurchaseOrderGridRow']> = { ...row };
  delete copy.lastBasePrice;
  delete copy.lastPriceDate;
  return copy;
};

const MSM_ROWS = '/api/v1/purchase-orders/7/suppliers/31/rows';
const MILK_ROWS = '/api/v1/purchase-orders/7/suppliers/32/rows';
const base = (extra: Record<string, (request: Request) => Response | Promise<Response>> = {}) => ({
  'GET /api/v1/purchase-orders/7': () => json(DETAIL),
  'GET /api/v1/purchase-orders/7/version': () => json(VERSION),
  'GET /api/v1/warehouses': () => list([{ id: 1, code: 'WH1', name: 'Төв агуулах' }]),
  [`GET ${MSM_ROWS}`]: () => gridPage([COLA, WATER]),
  [`GET ${MILK_ROWS}`]: () =>
    gridPage([MILK_ROW], {
      rights: { order: false, shipped: false, count: true, price: false },
      receipt: {
        id: 55,
        number: null,
        status: 'DRAFT',
        costingVersion: 0,
        noteTotalQty: null,
        noteTotalAmount: null,
        confirmedWarehouseIds: [],
      },
    }),
  ...extra,
});

describe('purchase orders', () => {
  it('lists orders with their suppliers and lowest status, and the archive toggle', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/purchase-orders': (request) =>
        new URL(request.url).searchParams.get('archived') === 'true'
          ? list([{ ...SUMMARY, id: 8, number: 'PO-2026-000008', archivedAt: STAMP }])
          : list([SUMMARY]),
    });
    renderApp('/procurement/orders', fetchMock);

    const link = await screen.findByRole('link', { name: SUMMARY.number });
    expect(link).toHaveAttribute('href', '/procurement/orders/7');
    const row = link.closest('tr');
    expect(within(row as HTMLElement).getByText('МСМ ХХК, Сүү ХК')).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(mn.procurement.status.PREPARING)).toBeVisible();
    expect(screen.getByRole('button', { name: mn.procurement.orders.create })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: mn.procurement.orders.archived }));
    const archived = await screen.findByRole('link', { name: 'PO-2026-000008' });
    expect(
      within(archived.closest('tr') as HTMLElement).getByText(mn.procurement.detail.archived),
    ).toBeVisible();
  });

  it('shows every supplier in one table and saves each supplier’s changed cells with one request', async () => {
    const user = userEvent.setup();
    const saved: Record<string, unknown[]> = { 31: [], 32: [] };
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'PUT /api/v1/purchase-orders/7/suppliers/31/lines': async (request) => {
          saved[31]?.push(await request.json());
          return json({ applied: 2, conflicts: [], refused: [] });
        },
        'PUT /api/v1/purchase-orders/7/suppliers/32/arrivals': async (request) => {
          saved[32]?.push(await request.json());
          return json({ applied: 1, conflicts: [], refused: [] });
        },
      }),
    );
    renderApp('/procurement/orders/7', fetchMock);

    // Both suppliers' group rows sit in the one table, with the status steps above.
    expect((await screen.findAllByText('МСМ ХХК')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Сүү ХК').length).toBeGreaterThan(0);
    expect(screen.getByRole('list', { name: mn.procurement.detail.steps })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: `${mn.procurement.supplier.next}: МСМ ХХК` }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ноорог №55' })).toHaveAttribute(
      'href',
      '/inventory/receipts/55',
    );

    // The ordering cells of МСМ: cola typed in boxes, water newly ordered.
    const cola = await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' });
    expect(cola).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: 'Нэгж: 1002 Ус 1л' })).toHaveValue('111');
    await user.clear(cola);
    await user.type(cola, '3{Enter}');
    const water = screen.getByRole('textbox', { name: 'Тоо: 1002 Ус 1л' });
    expect(water).toHaveFocus();
    await user.paste('5');

    // The receiving cells of Сүү: 4 boxes + 2 pieces of 12 → 50; the difference shows a note field.
    const boxes = screen.getByRole('textbox', { name: 'Ирсэн хайрцаг: 2001 Сүү 1л' });
    await user.type(boxes, '4');
    await user.type(screen.getByRole('textbox', { name: 'Ирсэн ширхэг: 2001 Сүү 1л' }), '2');
    const note = await screen.findByRole('textbox', { name: 'Тайлбар: 2001 Сүү 1л' });
    await user.type(note, 'Нэг хайрцаг задгай');

    await user.click(screen.getByRole('button', { name: 'Хадгалах (3)' }));
    await waitFor(() => expect(saved[31]).toHaveLength(1));
    expect(saved[31]?.[0]).toEqual({
      changes: [
        {
          productId: 10,
          field: 'ORDERED',
          productUnitId: 101,
          qty: '3',
          previousUnitId: 101,
          previousQty: '2',
        },
        {
          productId: 11,
          field: 'ORDERED',
          productUnitId: 111,
          qty: '5',
          previousUnitId: null,
          previousQty: null,
        },
      ],
    });
    await waitFor(() => expect(saved[32]).toHaveLength(1));
    expect(saved[32]?.[0]).toEqual({
      changes: [
        {
          lineId: 501,
          arrivedQtyBase: '50',
          note: 'Нэг хайрцаг задгай',
          previousArrivedQtyBase: null,
        },
      ],
    });
    expect(await screen.findByRole('status')).toHaveTextContent('3 мөр хадгалагдлаа');
  }, 20_000);

  it('names the cells someone else changed and keeps their value', async () => {
    const user = userEvent.setup();
    let rows = [COLA, WATER];
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        [`GET ${MSM_ROWS}`]: () => gridPage(rows),
        'PUT /api/v1/purchase-orders/7/suppliers/31/lines': () => {
          rows = [
            { ...COLA, line: { productUnitId: 101, qty: '4', qtyBase: '48', shippedQty: null } },
            WATER,
          ];
          return json({
            applied: 0,
            conflicts: [{ productId: 10, field: 'ORDERED', productUnitId: 101, qty: '4' }],
            refused: [],
          });
        },
      }),
    );
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

  it('types the shipped quantities in «Ачигдаж байна» and sends them as SHIPPED cells', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    const shipping = { ...MSM, status: 'SHIPPING' as const, canShip: true };
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'GET /api/v1/purchase-orders/7': () =>
          json({ ...DETAIL, status: 'SHIPPING', suppliers: [shipping] }),
        [`GET ${MSM_ROWS}`]: () =>
          gridPage([{ ...COLA, canShip: true }], { rights: { ...RIGHTS, shipped: true } }),
        'PUT /api/v1/purchase-orders/7/suppliers/31/lines': async (request) => {
          saved.push(await request.json());
          return json({ applied: 1, conflicts: [], refused: [] });
        },
      }),
    );
    renderApp('/procurement/orders/7', fetchMock);

    const shipped = await screen.findByRole('textbox', { name: 'Ачигдсан: 1001 Кока кола 0.5л' });
    await user.type(shipped, '1');
    await user.click(screen.getByRole('button', { name: 'Хадгалах (1)' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({
      changes: [
        {
          productId: 10,
          field: 'SHIPPED',
          productUnitId: 101,
          qty: '1',
          previousUnitId: 101,
          previousQty: null,
        },
      ],
    });
    // The column chooser cannot hide the shipping group while a supplier is at that stage.
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    const shippingItem = await screen.findByRole('menuitemcheckbox', {
      name: mn.procurement.detail.groups.shipping,
    });
    expect(shippingItem).toHaveAttribute('aria-disabled', 'true');
  }, 15_000);

  it('runs the accountant’s price check from the page through the receipt’s costs', async () => {
    const user = userEvent.setup();
    const costed: unknown[] = [];
    const accounting = {
      ...MILK,
      status: 'ACCOUNTING' as const,
      canCount: false,
      canPrice: true,
      canMoveBack: false,
      receiptNumber: 'GR-2026-000055',
    };
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'GET /api/v1/purchase-orders/7': () =>
          json({ ...DETAIL, status: 'ACCOUNTING', suppliers: [accounting] }),
        [`GET ${MILK_ROWS}`]: () =>
          gridPage(
            [
              {
                ...MILK_ROW,
                receipt: {
                  ...(MILK_ROW.receipt as Schemas['PurchaseOrderGridReceiptLine']),
                  arrivedBase: '50',
                  checkedAt: STAMP,
                  canCount: false,
                  unitName: 'ш',
                  factor: '1',
                  docUnitPrice: '2000.00',
                  docAmount: '100000.00',
                  previousUnitPrice: '1900.00',
                  previousDate: '2026-09-10',
                },
              },
            ],
            {
              rights: { order: false, shipped: false, count: false, price: true },
              receipt: {
                id: 55,
                number: 'GR-2026-000055',
                status: 'POSTED',
                costingVersion: 0,
                noteTotalQty: '50',
                noteTotalAmount: '100000.00',
                confirmedWarehouseIds: [1],
              },
            },
          ),
        'GET /api/v1/receipts/55/costing': () =>
          json({
            receiptId: 55,
            number: 'GR-2026-000055',
            status: 'POSTED',
            costingStatus: 'PENDING',
            costingVersion: 0,
            recostUntil: null,
            costedAt: null,
            vatRatePct: '10',
            discounts: [],
            total: null,
            docTotal: null,
            noteTotalQty: '50',
            noteTotalAmount: '100000.00',
            hasNotePhoto: false,
            lines: [
              {
                lineId: 501,
                productId: 20,
                productName: 'Сүү 1л',
                unitName: 'ш',
                enteredQty: '50',
                qtyBase: '50',
                provisionalUnitCost: '1818.1818',
                amount: null,
                docAmount: '100000.00',
                discountAmount: null,
                unitCost: null,
                freeGoods: false,
                docUnitPrice: '2000.00',
                previousUnitPrice: '1900.00',
                previousBasePrice: '1900.00',
                previousDate: '2026-09-10',
                previousSupplierName: 'Сүү ХК',
              },
            ],
          }),
        'PUT /api/v1/receipts/55/costs': async (request) => {
          costed.push(await request.json());
          return json({});
        },
      }),
    );
    renderApp('/procurement/orders/7', fetchMock);

    const price = await screen.findByRole('textbox', { name: 'Нэгж үнэ: 2001 Сүү 1л' });
    expect(price).toHaveValue('2000');
    expect(screen.getByText((text) => text.startsWith('Хуучин: 1'))).toBeInTheDocument();
    await user.clear(price);
    await user.type(price, '1950');
    await user.click(screen.getByRole('button', { name: 'Хадгалах (1)' }));
    await waitFor(() => expect(costed).toHaveLength(1));
    expect(costed[0]).toEqual({
      costingVersion: 0,
      lines: [{ lineId: 501, unitPrice: '1950' }],
    });
  }, 15_000);

  it('shows the yellow bar when another user changed the order and reloads on request', async () => {
    const user = userEvent.setup();
    let changed = false;
    let calls = 0;
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'GET /api/v1/purchase-orders/7/version': () => {
          calls += 1;
          return json(changed ? { ...VERSION, updatedAt: '2026-10-29T03:00:00.000Z' } : VERSION);
        },
      }),
    );
    renderApp('/procurement/orders/7', fetchMock);
    await screen.findAllByText('МСМ ХХК');
    expect(screen.queryByText(mn.procurement.detail.staleTitle)).not.toBeInTheDocument();

    // The poll's next answer differs from the one the page loaded with.
    // The page loaded with the first answer before the poll's next one differs.
    await waitFor(() => expect(calls).toBe(1));
    const before = calls;
    changed = true;
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(calls).toBeGreaterThan(before));
    expect(await screen.findByText(mn.procurement.detail.staleTitle)).toBeVisible();
    await user.click(screen.getByRole('button', { name: mn.procurement.detail.reload }));
    await waitFor(() =>
      expect(screen.queryByText(mn.procurement.detail.staleTitle)).not.toBeInTheDocument(),
    );
  }, 15_000);

  it('shows a keeper no prices and no estimated cost', async () => {
    const fetchMock = signedIn(KEEPER_ME, {
      ...base({
        'GET /api/v1/purchase-orders/7': () =>
          json({
            ...DETAIL,
            suppliers: [
              { ...MSM, estimatedCost: null },
              { ...MILK, estimatedCost: null },
            ],
          }),
        [`GET ${MSM_ROWS}`]: () => gridPage([COLA, WATER].map(withoutPrices) as never),
        [`GET ${MILK_ROWS}`]: () => gridPage([MILK_ROW].map(withoutPrices) as never),
      }),
    });
    renderApp('/procurement/orders/7', fetchMock);

    expect(
      await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: mn.procurement.detail.columns.onHand }),
    ).toBeVisible();
    expect(
      screen.queryByRole('columnheader', { name: mn.procurement.detail.columns.lastPrice }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: mn.procurement.detail.columns.unitPrice }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(mn.procurement.detail.estimated)).not.toBeInTheDocument();
    // Keepers do not manage the order.
    expect(
      screen.queryByRole('button', { name: mn.procurement.order.addSuppliers }),
    ).not.toBeInTheDocument();
  });
});

const CANDIDATES: Schemas['PurchaseOrderSupplierCandidate'][] = [
  { id: 31, code: 'S031', name: 'МСМ ХХК', phone: null, tin: null, mainProductCount: 12 },
  { id: 32, code: 'S032', name: 'Сүү ХК', phone: null, tin: null, mainProductCount: 3 },
  { id: 33, code: 'S033', name: 'Шинэ ХХК', phone: null, tin: null, mainProductCount: 0 },
];

describe('a new order with every supplier', () => {
  it('ticks every supplier with main products, names the skipped ones and creates in one request', async () => {
    const user = userEvent.setup();
    const posted: { body: unknown; key: string | null }[] = [];
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'GET /api/v1/purchase-orders': () => list([]),
        'GET /api/v1/procurement/supplier-candidates': () => list(CANDIDATES),
        'POST /api/v1/purchase-orders': async (request) => {
          posted.push({
            body: await request.json(),
            key: request.headers.get('idempotency-key'),
          });
          return json(DETAIL, 201);
        },
      }),
    );
    renderApp('/procurement/orders?new=1', fetchMock);

    const selectAll = await screen.findByRole('button', { name: mn.procurement.ticks.selectAll });
    // The list shows each supplier's main-product count.
    expect(await screen.findByText('12 бараа')).toBeInTheDocument();
    expect(screen.getByText(mn.procurement.ticks.noMainProducts)).toBeInTheDocument();
    await user.click(selectAll);
    expect(screen.getByText('2 нийлүүлэгч сонгосон')).toBeInTheDocument();
    expect(screen.getByText(/1 нийлүүлэгч үндсэн бараагүй тул орохгүй/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: mn.procurement.ticks.clearAll })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Шинэ ХХК/ })).not.toBeChecked();

    // A search narrows the list in the browser; the ticks stay.
    await user.type(screen.getByRole('searchbox', { name: mn.procurement.ticks.search }), 'сүү');
    await waitFor(() =>
      expect(screen.queryByRole('checkbox', { name: /МСМ ХХК/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('checkbox', { name: /Сүү ХК/ })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Захиалга үүсгэх (2)' }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]?.body).toMatchObject({ note: null, supplierIds: [31, 32] });
    expect(posted[0]?.key).toMatch(/[0-9a-f-]{36}/);
    expect(await screen.findByRole('status')).toHaveTextContent('PO-2026-000007 захиалга үүслээ');
  }, 20_000);

  it('keeps the groups of a large order closed until one is opened or filtered', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, index) => ({
      ...MSM,
      supplierId: 31 + index,
      supplierCode: `S0${31 + index}`,
      supplierName: index === 0 ? 'МСМ ХХК' : `Нийлүүлэгч ${31 + index}`,
      lineCount: index === 1 ? 0 : 1,
    }));
    const requested: string[] = [];
    const fetchMock = signedIn(
      ADMIN_ME,
      base({
        'GET /api/v1/purchase-orders/7': () => json({ ...DETAIL, suppliers: many }),
        ...Object.fromEntries(
          many.map((supplier) => [
            `GET /api/v1/purchase-orders/7/suppliers/${supplier.supplierId}/rows`,
            () => {
              requested.push(String(supplier.supplierId));
              return gridPage([COLA]);
            },
          ]),
        ),
      }),
    );
    renderApp('/procurement/orders/7', fetchMock);

    // Eight closed headers, their counts, and not one rows request.
    expect(await screen.findByRole('button', { name: 'Дэлгэх: МСМ ХХК' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByText('1 бараа захиалсан')).toHaveLength(7);
    expect(screen.getByText(mn.procurement.detail.noLines)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Тоо:/ })).not.toBeInTheDocument();
    expect(requested).toEqual([]);
    expect(
      screen.getByRole('button', { name: mn.procurement.detail.expandAll }),
    ).toBeInTheDocument();

    // Opening one loads its rows only.
    await user.click(screen.getByRole('button', { name: 'Дэлгэх: МСМ ХХК' }));
    expect(await screen.findByRole('textbox', { name: 'Тоо: 1001 Кока кола 0.5л' })).toHaveValue(
      '2',
    );
    expect(requested).toEqual(['31']);
    expect(screen.getByRole('button', { name: 'Хураах: МСМ ХХК' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    // «Зөвхөн захиалсан» hides the supplier with nothing ordered.
    await user.click(screen.getByRole('checkbox', { name: mn.procurement.detail.orderedOnly }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Дэлгэх: Нийлүүлэгч 32' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Дэлгэх: Нийлүүлэгч 33' })).toBeInTheDocument();

    // The supplier filter opens the chosen group.
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.procurement.detail.supplierFilter }),
      '33',
    );
    await waitFor(() => expect(requested).toContain('33'));
  }, 20_000);
});

describe('purchase order history', () => {
  it('lists the changes with who, when and from → to, and filters by supplier', async () => {
    const rows: Schemas['PurchaseOrderHistoryRow'][] = [
      {
        id: 3,
        at: STAMP,
        userId: 1,
        userName: 'Админ Бат',
        kind: 'STATUS',
        supplierId: 31,
        supplierName: 'МСМ ХХК',
        productId: null,
        productSku: null,
        productName: null,
        from: 'PREPARING',
        to: 'SENT',
        detail: null,
      },
      {
        id: 2,
        at: STAMP,
        userId: 4,
        userName: 'Нярав Дорж',
        kind: 'ORDER_QTY',
        supplierId: 31,
        supplierName: 'МСМ ХХК',
        productId: 10,
        productSku: '1001',
        productName: 'Кока кола 0.5л',
        from: null,
        to: '2 хайрцаг',
        detail: null,
      },
    ];
    const seen: string[] = [];
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/purchase-orders/7': () => json(DETAIL),
      'GET /api/v1/purchase-orders/7/history': (request) => {
        seen.push(new URL(request.url).search);
        return list(rows);
      },
    });
    renderApp('/procurement/orders/7/history', fetchMock);

    expect(await screen.findByText(mn.procurement.history.kind.ORDER_QTY)).toBeInTheDocument();
    expect(screen.getByText(mn.procurement.status.SENT)).toBeInTheDocument();
    expect(screen.getByText('2 хайрцаг')).toBeInTheDocument();
    expect(screen.getAllByText('Нярав Дорж').length).toBeGreaterThan(0);

    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.procurement.history.supplier }),
      '31',
    );
    await waitFor(() => expect(seen.some((search) => search.includes('supplierId=31'))).toBe(true));
  });
});
