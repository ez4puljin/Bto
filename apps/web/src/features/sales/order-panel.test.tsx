import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls, list, UUID, WH1 } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';
const LATER = '2026-10-15T03:00:00.000Z';
const WH2: Schemas['Warehouse'] = { ...WH1, id: 2, code: 'WH2', name: 'Хоёрдугаар агуулах' };

const OFFICE_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'office',
  fullName: 'Оффис Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.OFFICE],
  roles: [{ id: 2, code: 'OFFICE', name: null, isSystem: true }],
};

const stage = (
  id: number,
  name: string,
  fields: Partial<Schemas['SalesStage']> = {},
): Schemas['SalesStage'] => ({
  id,
  pipelineId: 10,
  name,
  position: id,
  action: 'NONE',
  printPickList: false,
  printDeliveryNote: false,
  cardSort: 'NEWEST',
  archivedAt: null,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
  canView: true,
  canEdit: true,
  canMove: true,
  ...fields,
});
const PIPELINE: Schemas['SalesPipeline'] = {
  id: 10,
  boardId: 1,
  name: 'Бөөний борлуулалт',
  position: 0,
  visibility: 'PUBLIC',
  ownOrdersOnly: false,
  transferWarehouseId: null,
  kind: 'SALES',
  archivedAt: null,
  createdAt: STAMP,
  roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
  canManage: false,
  seesAll: true,
  stages: [
    stage(1, 'ХТ Захиалга'),
    stage(2, 'Нярав Хяналт', { action: 'CONFIRM', printPickList: true }),
    stage(3, 'Бэлдэх', { action: 'PICK' }),
    stage(4, 'Цуцалсан', { action: 'CANCEL' }),
  ],
};

const line = (
  id: number,
  name: string,
  sku: string,
  warehouseId: number,
  fields: Partial<Schemas['SalesOrderLine']> = {},
): Schemas['SalesOrderLine'] => ({
  id,
  lineNo: id,
  productId: 100 + id,
  productSku: sku,
  productName: name,
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
  parts: [
    {
      productUnitId: 200 + id,
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
    },
  ],
  ...fields,
});

const ORDER: Schemas['SalesOrderDetail'] = {
  id: 5,
  number: '20261015_0005',
  channel: 'ADMIN',
  status: 'CONFIRMED',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  customerOverdue: null,
  fulfilment: 'PICKUP',
  deliveryDate: '2099-10-16',
  addressId: null,
  addressText: null,
  addressLat: null,
  addressLng: null,
  contactName: null,
  contactPhone: null,
  paymentMethod: 'CREDIT',
  note: 'Өглөө авна',
  priceDate: '2026-10-15',
  subtotal: '36000',
  discountTotal: '0',
  total: '36000',
  submittedAt: LATER,
  confirmedAt: LATER,
  cancelledAt: null,
  cancelReason: null,
  boardId: 1,
  boardName: 'Хөвсгөл',
  pipelineId: 10,
  pipelineName: 'Бөөний борлуулалт',
  stageId: 2,
  stageName: 'Нярав Хяналт',
  stageEnteredAt: LATER,
  pickedAt: null,
  deliveredAt: null,
  archivedAt: null,
  createdByName: 'Оффис Сараа',
  canEdit: true,
  createdAt: STAMP,
  updatedAt: LATER,
  lines: [
    line(1, 'Номин Цэвэр ус 3л', '900000029', 2),
    line(2, 'Coca-Cola 0.5л', '1', 1),
    line(3, 'Говь Цэвэр ус 0.5л', '900000033', 2),
  ],
  events: [
    {
      fromStatus: null,
      toStatus: 'DRAFT',
      reason: null,
      actorId: 3,
      actorName: 'Оффис Сараа',
      createdAt: STAMP,
    },
    {
      fromStatus: 'SUBMITTED',
      toStatus: 'CONFIRMED',
      reason: null,
      actorId: 1,
      actorName: 'Систем Админ',
      createdAt: LATER,
    },
  ],
  picks: [],
  moves: [
    {
      fromStageId: null,
      toStageId: 1,
      fromStageName: null,
      toStageName: 'ХТ Захиалга',
      actorId: 3,
      actorName: 'Оффис Сараа',
      createdAt: STAMP,
    },
    {
      fromStageId: 1,
      toStageId: 2,
      fromStageName: 'ХТ Захиалга',
      toStageName: 'Нярав Хяналт',
      actorId: 1,
      actorName: 'Систем Админ',
      createdAt: LATER,
    },
  ],
};

const routes = (
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/warehouses': () => list([WH1, WH2]),
  'GET /api/v1/sales-boards': () => json([]),
  'GET /api/v1/branches': () => json({ data: [] }),
  'GET /api/v1/sales-pipelines/10': () => json(PIPELINE),
  'GET /api/v1/sales-orders/5': () => json(ORDER),
  'GET /api/v1/sales-orders/product-info': () =>
    json([
      { productId: 101, homeWarehouseId: 2, sellable: true, available: '200' },
      { productId: 102, homeWarehouseId: 1, sellable: true, available: '40' },
      { productId: 103, homeWarehouseId: 2, sellable: true, available: '100' },
    ]),
  ...extra,
});

const productNames = (panel: HTMLElement) =>
  within(within(panel).getByRole('tabpanel', { name: mn.sales.panel.tabs.products }))
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');

describe('order panel (ADR-0059)', () => {
  it('shows where the order stands and moves it along its stages from the steps', async () => {
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'POST /api/v1/sales-orders/5/move': () =>
          json({ order: { ...ORDER, stageId: 3, status: 'PICKING' }, print: [] }),
      }),
    );
    renderApp('/sales/boards?order=5', fetchMock);
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    const steps = await within(panel).findByRole('region', { name: mn.sales.panel.stageSteps });
    expect(within(steps).getByRole('button', { name: 'Нярав Хяналт' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    await user.click(
      within(steps).getByRole('button', {
        name: mn.sales.panel.moveTo.replace('{{name}}', 'Бэлдэх'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')).toHaveLength(1),
    );
    const [moved] = calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move');
    expect(moved?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(moved)).toEqual({ stageId: 3 });

    // A CANCEL stage asks its reason first.
    await user.click(
      within(steps).getByRole('button', {
        name: mn.sales.panel.moveTo.replace('{{name}}', 'Цуцалсан'),
      }),
    );
    expect(
      await screen.findByRole('dialog', { name: mn.sales.order.cancelTitle }),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')).toHaveLength(1);
  });

  it('reminds of the customer’s overdue debt in red and still confirms (ADR-0101)', async () => {
    const customerOverdue = { amount: '120000', oldestDueDate: '2026-09-20' };
    const draft = { ...ORDER, stageId: 1, status: 'SUBMITTED' as const, customerOverdue };
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'GET /api/v1/sales-orders/5': () => json(draft),
        'POST /api/v1/sales-orders/5/move': () =>
          json({ order: { ...ORDER, customerOverdue }, print: [] }),
      }),
    );
    renderApp('/sales/boards?order=5', fetchMock);
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    expect(
      await within(panel).findByText(
        mn.sales.overdue.since.replace('{{amount}}', '120,000₮').replace('{{date}}', '2026-09-20'),
      ),
    ).toBeInTheDocument();
    const steps = await within(panel).findByRole('region', { name: mn.sales.panel.stageSteps });
    await user.click(
      within(steps).getByRole('button', {
        name: mn.sales.panel.moveTo.replace('{{name}}', 'Нярав Хяналт'),
      }),
    );
    expect(
      await screen.findByText(mn.sales.overdue.confirmed.replace('{{amount}}', '120,000₮')),
    ).toBeInTheDocument();
  });

  it('names who did what in the activity, newest first', async () => {
    renderApp('/sales/boards?order=5&tab=activity', signedIn(OFFICE_ME, routes()));
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    const activity = await within(panel).findByRole('tabpanel', {
      name: mn.sales.panel.tabs.activity,
    });
    const entries = within(activity)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('p')?.textContent ?? '');
    expect(entries).toEqual([
      `Систем Админ ${mn.sales.panel.activity.moved.replace('{{from}}', 'ХТ Захиалга').replace('{{to}}', 'Нярав Хяналт')}`,
      `Систем Админ ${mn.sales.panel.activity.status.replace('{{status}}', mn.sales.statuses.CONFIRMED)}`,
      `Оффис Сараа ${mn.sales.panel.activity.createdIn.replace('{{stage}}', 'ХТ Захиалга')}`,
    ]);
  });

  it('searches the products by name or code and filters them by warehouse and picking', async () => {
    const picked: Schemas['SalesOrderDetail'] = {
      ...ORDER,
      lines: [
        line(1, 'Номин Цэвэр ус 3л', '900000029', 2, { qtyPicked: '12', pickBinCode: 'B-01-01' }),
        line(2, 'Coca-Cola 0.5л', '1', 1, { qtyPicked: '0' }),
        line(3, 'Говь Цэвэр ус 0.5л', '900000033', 2),
      ],
    };
    renderApp(
      '/sales/boards?order=5&tab=products',
      signedIn(OFFICE_ME, routes({ 'GET /api/v1/sales-orders/5': () => json(picked) })),
    );
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    await waitFor(() => expect(productNames(panel)).toHaveLength(3));
    const search = within(panel).getByRole('searchbox', { name: mn.sales.panel.products.search });
    await user.type(search, 'ус');
    expect(productNames(panel)).toEqual([
      '900000029Номин Цэвэр ус 3л',
      '900000033Говь Цэвэр ус 0.5л',
    ]);
    await user.clear(search);
    await user.type(search, '900000033');
    expect(productNames(panel)).toEqual(['900000033Говь Цэвэр ус 0.5л']);
    await user.clear(search);
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: mn.sales.order.warehouse }),
      WH1.name,
    );
    expect(productNames(panel)).toEqual(['1Coca-Cola 0.5л']);
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: mn.sales.order.warehouse }),
      mn.sales.panel.products.allWarehouses,
    );
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: mn.sales.panel.products.pickedFilter }),
      mn.sales.panel.products.picked.PICKED,
    );
    expect(productNames(panel)).toEqual(['900000029Номин Цэвэр ус 3л']);
    await user.selectOptions(
      within(panel).getByRole('combobox', { name: mn.sales.panel.products.pickedFilter }),
      mn.sales.panel.products.picked.NOT_PICKED,
    );
    expect(productNames(panel)).toEqual(['1Coca-Cola 0.5л', '900000033Говь Цэвэр ус 0.5л']);
  });

  it('keeps unsaved quantities while the sections change and asks before closing', async () => {
    renderApp('/sales/boards?order=5&tab=products', signedIn(OFFICE_ME, routes()));
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    const qty = await within(panel).findByLabelText(`${mn.sales.order.qty}: Coca-Cola 0.5л`);
    await user.clear(qty);
    await user.type(qty, '3');
    // A confirmed order is priced and reserved again when saved.
    expect(within(panel).getByText(mn.sales.panel.products.repriceHint)).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.overview }));
    // The stage waits for the edits to be saved.
    expect(await within(panel).findByText(mn.sales.panel.saveFirst)).toBeInTheDocument();
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.products }));
    expect(within(panel).getByLabelText(`${mn.sales.order.qty}: Coca-Cola 0.5л`)).toHaveValue('3');
    await user.click(within(panel).getByRole('button', { name: mn.common.close }));
    const leave = await screen.findByRole('dialog', { name: mn.sales.panel.leaveTitle });
    await user.click(within(leave).getByRole('button', { name: mn.sales.panel.leave }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '20261015_0005' })).toBeNull());
  });

  it("heads the products with each warehouse's part and lets a picker take theirs", async () => {
    const picker: Me = {
      ...OFFICE_ME,
      permissions: [...SYSTEM_ROLE_PERMISSIONS.OFFICE, 'sales.orders.pick'],
    };
    const part = (warehouseId: number, warehouseName: string) => ({
      orderId: 5,
      warehouseId,
      warehouseName,
      status: 'OPEN' as const,
      pickerId: null,
      pickerName: null,
      startedAt: null,
      doneAt: null,
    });
    const withParts: Schemas['SalesOrderDetail'] = {
      ...ORDER,
      picks: [part(2, 'Бөөний агуулах'), part(1, 'Заал')],
    };
    renderApp(
      '/sales/boards?order=5&tab=pick',
      signedIn(
        picker,
        routes({
          'GET /api/v1/sales-orders/5': () => json(withParts),
          'GET /api/v1/sales-orders/5/pick-info': () => json([]),
        }),
      ),
    );
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    // The old pick address lands in the products tab, which is now the only one.
    expect(within(panel).queryByRole('tab', { name: 'Бэлтгэх' })).not.toBeInTheDocument();
    const products = within(panel).getByRole('tabpanel', { name: mn.sales.panel.tabs.products });
    expect(
      await within(products).findAllByRole('button', { name: mn.sales.pick.take }),
    ).toHaveLength(2);
    expect(within(products).getByRole('heading', { name: 'Бөөний агуулах' })).toBeInTheDocument();
    expect(within(products).getByRole('heading', { name: 'Заал' })).toBeInTheDocument();
  });
});
