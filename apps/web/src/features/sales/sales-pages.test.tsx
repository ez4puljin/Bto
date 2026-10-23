import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { defaultDeliveryDate } from '@tugeel/shared/sales';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls, list, UUID, warehouses } from '@/test/inventory-fixtures';
import {
  ADMIN_ME,
  findSidebar,
  json,
  type Me,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';

const OFFICE_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'office',
  fullName: 'Оффис Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.OFFICE],
  roles: [{ id: 2, code: 'OFFICE', name: null, isSystem: true }],
};

const CUSTOMER_ROW = {
  id: 9,
  code: '1001',
  kind: 'COMPANY',
  name: 'Номин дэлгүүр',
  regNo: null,
  tin: null,
  phone: null,
  status: 'ACTIVE',
  creditHold: false,
};
const CUSTOMER = {
  ...CUSTOMER_ROW,
  addresses: [
    {
      id: 50,
      label: 'Дэлгүүр',
      address: 'Мөрөн, 3-р баг',
      lat: null,
      lng: null,
      gpsSource: null,
      zoneId: null,
      note: null,
      isDefault: true,
      archivedAt: null,
    },
  ],
  contacts: [{ id: 60, name: 'Бат', position: null, phone: '+97688112233', note: null }],
};
const PRODUCT_ROW = {
  id: 7,
  sku: '10023',
  name: 'Кока кола',
  categoryId: 12,
  status: 'ACTIVE',
  saleReadyAt: STAMP,
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: 70, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
  weightKg: null,
  classificationCode: null,
  taxProductCode: null,
  units: [],
};
const PRODUCT = {
  ...PRODUCT_ROW,
  tracksLots: false,
  createdAt: STAMP,
  updatedAt: STAMP,
  images: [],
  units: [
    {
      id: 70,
      uomId: 1,
      uomName: 'ш',
      uomCode: 'PCS',
      fractional: false,
      factorToBase: '1',
      isBase: true,
      isDefaultSales: false,
      isDefaultPurchase: false,
      measureUnit: null,
      effectiveMeasureUnit: null,
      supersededBy: null,
      supersededAt: null,
      barcodes: [],
    },
  ],
};
const PART: Schemas['SalesOrderPart'] = {
  productUnitId: 70,
  uomName: 'ш',
  basis: 'LOOSE',
  qty: '30',
  factorSnapshot: '1',
  qtyBase: '30',
  listPrice: '1000',
  unitPrice: '1000',
  subtotal: '30000',
  discountAmount: '0',
  total: '30000',
  applied: [],
};
const LINE: Schemas['SalesOrderLine'] = {
  id: 11,
  lineNo: 1,
  productId: 7,
  productSku: '10023',
  productName: 'Кока кола',
  productUnitId: 70,
  unitName: 'ш',
  qty: '30',
  factorSnapshot: '1',
  qtyBase: '30',
  baseUnitName: 'ш',
  warehouseId: 1,
  qtyApproved: '20',
  qtyBackordered: '10',
  qtyPicked: null,
  pickBinId: null,
  pickBinCode: null,
  qtyDelivered: null,
  subtotal: '30000',
  discountAmount: '0',
  total: '30000',
  parts: [PART],
};

const CREATED: Schemas['SalesOrderEvent'] = {
  fromStatus: null,
  toStatus: 'DRAFT',
  reason: null,
  actorId: 3,
  actorName: 'Оффис Сараа',
  createdAt: STAMP,
};
const EDIT_HEADER = mn.common.editRecord.replace('{{name}}', mn.sales.order.header);

const ORDER: Schemas['SalesOrderDetail'] = {
  id: 5,
  number: 'SO-2026-000001',
  channel: 'ADMIN',
  status: 'CONFIRMED',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  customerOverdue: null,
  fulfilment: 'DELIVERY',
  deliveryDate: '2099-10-16',
  addressId: 50,
  addressText: 'Мөрөн, 3-р баг',
  addressLat: null,
  addressLng: null,
  contactName: 'Бат',
  contactPhone: '+97688112233',
  paymentMethod: 'CREDIT',
  note: null,
  priceDate: '2026-10-15',
  subtotal: '30000',
  discountTotal: '0',
  total: '30000',
  submittedAt: STAMP,
  confirmedAt: STAMP,
  cancelledAt: null,
  cancelReason: null,
  boardId: null,
  boardName: null,
  pipelineId: null,
  pipelineName: null,
  stageId: null,
  stageName: null,
  stageEnteredAt: null,
  pickedAt: null,
  deliveredAt: null,
  archivedAt: null,
  createdByName: 'Оффис Сараа',
  canEdit: true,
  createdAt: STAMP,
  updatedAt: STAMP,
  moves: [],
  lines: [LINE],
  events: [
    CREATED,
    {
      fromStatus: 'SUBMITTED',
      toStatus: 'CONFIRMED',
      reason: null,
      actorId: 3,
      actorName: 'Оффис Сараа',
      createdAt: STAMP,
    },
  ],
};

const QUOTE: Schemas['Quote'] = {
  list: 'WHOLESALE',
  date: '2026-10-15',
  lines: [
    {
      productId: 7,
      productUnitId: 70,
      qty: '30',
      qtyBase: '30',
      priced: true,
      problem: null,
      parts: [{ ...PART, applied: [] }],
      subtotal: '30000',
      discountAmount: '0',
      total: '30000',
    },
  ],
  subtotal: '30000',
  discountTotal: '0',
  total: '30000',
};

const base = {
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/sales-boards': () => json([]),
  'GET /api/v1/branches': () => json({ data: [] }),
};

describe('orders menu', () => {
  it('shows orders to the office and hides them from people without the right', async () => {
    renderApp('/system/status', signedIn(OFFICE_ME));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.salesWarehouse }),
    ).toBeInTheDocument();
  });

  it('keeps them from a user without sales rights', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    expect(
      within(await findSidebar()).queryByRole('link', { name: mn.nav.salesWarehouse }),
    ).toBeNull();
  });
});

describe('new order (ADR-0059)', () => {
  it('creates a draft from its customer, adds the products in the panel and submits it once', async () => {
    const draft: Schemas['SalesOrderDetail'] = {
      ...ORDER,
      number: '20261015_0005',
      status: 'DRAFT',
      fulfilment: 'PICKUP',
      addressId: null,
      addressText: null,
      contactName: null,
      contactPhone: null,
      subtotal: null,
      discountTotal: null,
      total: null,
      priceDate: null,
      submittedAt: null,
      confirmedAt: null,
      lines: [],
      events: [CREATED],
    };
    let current = draft;
    const fetchMock = signedIn(OFFICE_ME, {
      ...base,
      'GET /api/v1/customers': () => list([CUSTOMER_ROW]),
      'GET /api/v1/customers/9': () => json(CUSTOMER),
      'GET /api/v1/products': () => list([PRODUCT_ROW]),
      'GET /api/v1/products/7': () => json(PRODUCT),
      'GET /api/v1/sales-orders/product-info': () =>
        json([{ productId: 7, homeWarehouseId: 1, sellable: true, available: '20' }]),
      'POST /api/v1/pricing/quote': () => json(QUOTE),
      'POST /api/v1/sales-orders': () => json(current, 201),
      'GET /api/v1/sales-orders/5': () => json(current),
      'PUT /api/v1/sales-orders/5': () => {
        current = {
          ...draft,
          lines: [{ ...LINE, qtyApproved: '0', qtyBackordered: '0', total: null, parts: [] }],
        };
        return json(current);
      },
      'POST /api/v1/sales-orders/5/submit': () => {
        current = { ...ORDER, number: '20261015_0005' };
        return json(current);
      },
    });
    // The old page's address opens the work page's create dialog.
    renderApp('/sales/orders/new', fetchMock);
    const user = userEvent.setup();
    const create = await screen.findByRole('dialog', { name: mn.sales.create.title });
    await user.type(
      await within(create).findByPlaceholderText(mn.partners.customerPicker.search),
      'номин',
    );
    await user.click(await within(create).findByRole('button', { name: /Номин дэлгүүр/ }));
    await user.selectOptions(within(create).getByLabelText(mn.sales.order.paymentMethod), 'CREDIT');
    await user.click(within(create).getByRole('button', { name: mn.sales.create.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/sales-orders')).toHaveLength(1));
    const [created] = calls(fetchMock, 'POST', '/api/v1/sales-orders');
    expect(created?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(created)).toEqual({
      customerId: 9,
      pipelineId: null,
      stageId: null,
      fulfilment: 'PICKUP',
      deliveryDate: defaultDeliveryDate(),
      addressId: null,
      contactName: null,
      contactPhone: null,
      paymentMethod: 'CREDIT',
      note: null,
      lines: [],
    });

    // The panel opens on its products, the search ready for the first one.
    const panel = await screen.findByRole('dialog', { name: '20261015_0005' });
    expect(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.products })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const search = await within(panel).findByRole('searchbox', {
      name: mn.inventory.productSearch,
    });
    expect(search).toHaveFocus();
    await user.type(search, 'кока');
    // The matches open over the panel; Enter adds the first one (ADR-0066).
    expect(
      await screen.findByRole('button', { name: `${mn.inventory.add}: Кока кола` }),
    ).toBeInTheDocument();
    await user.keyboard('{Enter}');
    const qty = await within(panel).findByLabelText(`${mn.sales.order.qty}: Кока кола`);
    expect(search).toHaveValue('');
    await user.clear(qty);
    await user.type(qty, '30');
    // The rules' price, marked as an estimate until the order is confirmed.
    expect(await within(panel).findByText('30,000₮')).toBeInTheDocument();
    expect(within(panel).getByText(mn.sales.panel.products.estimated)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/sales-orders/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-orders/5')[0])).toEqual({
      customerId: 9,
      pipelineId: null,
      stageId: null,
      fulfilment: 'PICKUP',
      deliveryDate: ORDER.deliveryDate,
      addressId: null,
      contactName: null,
      contactPhone: null,
      paymentMethod: 'CREDIT',
      note: null,
      lines: [{ productUnitId: 70, qty: '30' }],
    });

    // A draft outside every pipeline is submitted from «⋯».
    await user.click(within(panel).getByRole('button', { name: mn.sales.panel.more }));
    await user.click(await screen.findByRole('menuitem', { name: mn.sales.order.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/submit')).toHaveLength(1),
    );
    expect(
      calls(fetchMock, 'POST', '/api/v1/sales-orders/5/submit')[0]?.headers.get('Idempotency-Key'),
    ).toMatch(UUID);
    expect(
      await screen.findByText(mn.sales.order.confirmed.replace('{{number}}', '20261015_0005')),
    ).toBeInTheDocument();
  });
});

describe('confirmed order in the panel (ADR-0059)', () => {
  it('shows what was reserved and backordered and cancels with a reason', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      ...base,
      'GET /api/v1/sales-orders/5': () => json(ORDER),
      'POST /api/v1/sales-orders/5/cancel': () =>
        json({ ...ORDER, status: 'CANCELLED', cancelReason: 'Харилцагч цуцалсан' }),
    });
    // The old page's address opens the order's panel.
    renderApp('/sales/orders/5', fetchMock);
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: 'SO-2026-000001' });
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.products }));
    expect(
      within(panel).getByText(mn.sales.order.backorderedLines.replace('{{count}}', '1')),
    ).toBeInTheDocument();
    expect(within(panel).getByText('20 ш')).toBeInTheDocument();
    expect(within(panel).getByText('10 ш')).toBeInTheDocument();
    // Frozen prices: no estimate.
    expect(within(panel).queryByText(mn.sales.panel.products.estimated)).toBeNull();

    await user.click(within(panel).getByRole('button', { name: mn.sales.panel.more }));
    await user.click(await screen.findByRole('menuitem', { name: mn.sales.order.cancel }));
    const dialog = await screen.findByRole('dialog', { name: mn.sales.order.cancelTitle });
    const confirm = within(dialog).getByRole('button', { name: mn.sales.order.cancel });
    expect(confirm).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText(mn.sales.order.cancelReason),
      'Харилцагч цуцалсан',
    );
    await user.click(confirm);
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/cancel')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/cancel')[0])).toEqual({
      reason: 'Харилцагч цуцалсан',
    });
  });

  it('edits the header in «Мэдээлэл» and saves it with the stored lines', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      ...base,
      'GET /api/v1/customers/9': () => json(CUSTOMER),
      'GET /api/v1/sales-orders/5': () => json(ORDER),
      'PUT /api/v1/sales-orders/5': () => json({ ...ORDER, paymentMethod: 'CASH', note: 'Өглөө' }),
    });
    renderApp('/sales/boards?order=5&tab=properties', fetchMock);
    const user = userEvent.setup();
    const panel = await screen.findByRole('dialog', { name: 'SO-2026-000001' });
    await user.click(await within(panel).findByRole('button', { name: EDIT_HEADER }));
    await user.selectOptions(within(panel).getByLabelText(mn.sales.order.paymentMethod), 'CASH');
    await user.type(within(panel).getByLabelText(mn.sales.order.note), 'Өглөө');
    // A confirmed order is priced and reserved again when saved.
    expect(within(panel).getByText(mn.sales.panel.properties.repriceHint)).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/sales-orders/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-orders/5')[0])).toEqual({
      customerId: 9,
      pipelineId: null,
      stageId: null,
      fulfilment: 'DELIVERY',
      deliveryDate: ORDER.deliveryDate,
      addressId: 50,
      contactName: 'Бат',
      contactPhone: '+97688112233',
      paymentMethod: 'CASH',
      note: 'Өглөө',
      lines: [{ productUnitId: 70, qty: '30' }],
    });
    expect(await screen.findByText(mn.sales.panel.properties.saved)).toBeInTheDocument();
  });

  it('lets a user who only reads open an order without editing or cancelling', async () => {
    const reader: Me = {
      ...OFFICE_ME,
      permissions: ['sales.orders.read'],
      roles: [],
    };
    renderApp(
      '/sales/orders/5',
      signedIn(reader, {
        ...base,
        'GET /api/v1/sales-orders/5': () => json({ ...ORDER, canEdit: false }),
      }),
    );
    const panel = await screen.findByRole('dialog', { name: 'SO-2026-000001' });
    expect(within(panel).queryByRole('button', { name: mn.sales.panel.more })).toBeNull();
    const user = userEvent.setup();
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.products }));
    expect(within(panel).queryByLabelText(`${mn.sales.order.qty}: Кока кола`)).toBeNull();
    expect(within(panel).queryByRole('button', { name: mn.sales.panel.products.add })).toBeNull();
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.properties }));
    expect(within(panel).queryByRole('button', { name: EDIT_HEADER })).toBeNull();
  });
});
