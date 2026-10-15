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

const ORDER: Schemas['SalesOrderDetail'] = {
  id: 5,
  number: 'SO-2026-000001',
  channel: 'ADMIN',
  status: 'CONFIRMED',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  fulfilment: 'DELIVERY',
  deliveryDate: '2026-10-16',
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
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [
    {
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
      subtotal: '30000',
      discountAmount: '0',
      total: '30000',
      parts: [
        {
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
        },
      ],
    },
  ],
  events: [
    { fromStatus: null, toStatus: 'DRAFT', reason: null, actorId: 3, createdAt: STAMP },
    { fromStatus: 'SUBMITTED', toStatus: 'CONFIRMED', reason: null, actorId: 3, createdAt: STAMP },
  ],
};

describe('orders menu', () => {
  it('shows orders to the office and hides them from people without the right', async () => {
    renderApp('/system/status', signedIn(OFFICE_ME));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.salesOrders }),
    ).toBeInTheDocument();
  });

  it('keeps them from a user without sales rights', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    expect(
      within(await findSidebar()).queryByRole('link', { name: mn.nav.salesOrders }),
    ).toBeNull();
  });
});

describe('new order', () => {
  it('enters a delivery for a customer, then submits it once with its keys', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/customers': () => list([CUSTOMER_ROW]),
      'GET /api/v1/customers/9': () => json(CUSTOMER),
      'GET /api/v1/products': () => list([PRODUCT_ROW]),
      'GET /api/v1/products/7': () =>
        json({
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
        }),
      'GET /api/v1/sales-orders/product-info': () =>
        json([{ productId: 7, homeWarehouseId: 1, sellable: true, available: '20' }]),
      'POST /api/v1/sales-orders': () => json({ ...ORDER, status: 'DRAFT', number: null }, 201),
      'POST /api/v1/sales-orders/5/submit': () => json(ORDER),
      'GET /api/v1/sales-orders/5': () => json(ORDER),
    });
    renderApp('/sales/orders/new', fetchMock);
    const user = userEvent.setup();
    await user.type(await screen.findByPlaceholderText(mn.partners.customerPicker.search), 'номин');
    await user.click(await screen.findByRole('button', { name: /Номин дэлгүүр/ }));
    await user.selectOptions(screen.getByLabelText(mn.sales.order.fulfilment), 'DELIVERY');
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLSelectElement>(mn.sales.order.address).value).toBe('50'),
    );
    await user.selectOptions(screen.getByLabelText(mn.sales.order.paymentMethod), 'CREDIT');
    await user.type(screen.getByLabelText(mn.sales.order.contactName), 'Бат');
    await user.type(
      await screen.findByRole('searchbox', { name: mn.inventory.productSearch }),
      'кока',
    );
    await user.click(await screen.findByRole('button', { name: `${mn.inventory.add}: Кока кола` }));
    const qty = await screen.findByLabelText(`${mn.sales.order.qty}: Кока кола`);
    await user.clear(qty);
    await user.type(qty, '30');
    expect(await screen.findByText('20')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.sales.order.submit }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.sales.order.submit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/submit')).toHaveLength(1),
    );
    const [created] = calls(fetchMock, 'POST', '/api/v1/sales-orders');
    expect(created?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(created)).toEqual({
      customerId: 9,
      fulfilment: 'DELIVERY',
      deliveryDate: defaultDeliveryDate(),
      addressId: 50,
      contactName: 'Бат',
      contactPhone: '+97688112233',
      paymentMethod: 'CREDIT',
      note: null,
      lines: [{ productUnitId: 70, qty: '30' }],
    });
    expect(
      calls(fetchMock, 'POST', '/api/v1/sales-orders/5/submit')[0]?.headers.get('Idempotency-Key'),
    ).toMatch(UUID);
    expect(await screen.findByText('SO-2026-000001 захиалга батлагдлаа')).toBeInTheDocument();
  });
});

describe('confirmed order', () => {
  it('shows what was reserved and backordered and cancels with a reason', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/sales-orders/5': () => json(ORDER),
      'POST /api/v1/sales-orders/5/cancel': () =>
        json({ ...ORDER, status: 'CANCELLED', cancelReason: 'Харилцагч цуцалсан' }),
    });
    renderApp('/sales/orders/5', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'SO-2026-000001' })).toBeInTheDocument();
    expect(
      screen.getByText('1 мөрөнд үлдэгдэл хүрэлцээгүй тул хойшилсон тоо бий'),
    ).toBeInTheDocument();
    expect(screen.getByText('20 ш')).toBeInTheDocument();
    expect(screen.getByText('10 ш')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.sales.order.cancel }));
    const dialog = await screen.findByRole('dialog');
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

  it('lets a user who only reads open an order without the cancel button', async () => {
    const reader: Me = {
      ...OFFICE_ME,
      permissions: ['sales.orders.read'],
      roles: [],
    };
    renderApp(
      '/sales/orders/5',
      signedIn(reader, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/sales-orders/5': () => json(ORDER),
      }),
    );
    expect(await screen.findByRole('heading', { name: 'SO-2026-000001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.sales.order.cancel })).toBeNull();
  });
});
