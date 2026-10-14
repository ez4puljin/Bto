import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  json,
  type Me,
  problem,
  renderApp,
  signedIn,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-11T02:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const WH1: Schemas['Warehouse'] = {
  id: 1,
  code: 'WH1',
  name: 'Төв агуулах',
  kind: 'WHOLESALE',
  branchId: 1,
  status: 'ACTIVE',
  createdAt: STAMP,
  updatedAt: STAMP,
};
const STORE: Schemas['Warehouse'] = {
  ...WH1,
  id: 2,
  code: 'S1',
  name: 'Супермаркет',
  kind: 'STORE',
};
const warehouses = () => list([WH1, STORE]);

/** The supermarket's sales clerk: transfers only, for the store alone. */
const CLERK_ME: Me = {
  ...ADMIN_ME,
  id: 5,
  username: 'khudaldagch',
  fullName: 'Худалдагч Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.POS_CASHIER],
  roles: [{ id: 6, code: 'POS_CASHIER', name: null, isSystem: true }],
  writableWarehouseIds: [STORE.id],
};
const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
  writableWarehouseIds: [WH1.id],
};
const ACCOUNTANT_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'nyagtlan',
  fullName: 'Нягтлан Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.ACCOUNTANT],
  roles: [{ id: 5, code: 'ACCOUNTANT', name: null, isSystem: true }],
};

const SHELF: Schemas['Bin'] = {
  id: 32,
  warehouseId: 1,
  code: 'A-01-04',
  name: null,
  type: 'STORAGE',
  sellable: true,
  status: 'ACTIVE',
  isSystem: false,
  pickSequence: null,
  archivedAt: null,
};
const COLA: Schemas['ProductSummary'] = {
  id: 10,
  sku: '10',
  name: 'Кока кола',
  categoryId: 1,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: 70, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
};
const WATER: Schemas['ProductSummary'] = { ...COLA, id: 11, sku: '11', name: 'Ус' };
const resolution = (
  product: Schemas['ProductSummary'],
  unit: Schemas['BarcodeResolution']['unit'],
  code: string,
): Schemas['BarcodeResolution'] => ({
  product,
  unit,
  barcode: {
    id: 5,
    code,
    gtin14: code.padStart(14, '0'),
    barcodeType: 'GS1',
    isPrimary: true,
    isInternal: false,
  },
});
const COLA_BOX = resolution(
  COLA,
  { id: 77, uomId: 2, uomName: 'хайрцаг', factorToBase: '24', isBase: false },
  '4006381333931',
);
const WATER_PCS = resolution(
  WATER,
  { id: 80, uomId: 1, uomName: 'ш', factorToBase: '1', isBase: true },
  '5449000000996',
);

const COLA_LINE: Schemas['TransferLine'] = {
  id: 1,
  productId: COLA.id,
  productSku: COLA.sku,
  productName: COLA.name,
  requestUnitId: 77,
  unitName: 'хайрцаг',
  requestFactor: '24',
  requestedQty: '1',
  baseUnitId: 70,
  baseUnitName: 'ш',
  shippedQtyBase: null,
  receivedQtyBase: null,
  fromBinId: 31,
  fromBinCode: 'A-01-03',
  toBinId: null,
  toBinCode: null,
};
const WATER_LINE: Schemas['TransferLine'] = {
  ...COLA_LINE,
  id: 2,
  productId: WATER.id,
  productSku: WATER.sku,
  productName: WATER.name,
  requestUnitId: 80,
  unitName: 'ш',
  requestFactor: '1',
  requestedQty: '10',
  baseUnitId: 80,
  fromBinId: null,
  fromBinCode: null,
};
const DRAFT: Schemas['TransferDetail'] = {
  id: 7,
  number: null,
  origin: 'REQUEST',
  status: 'DRAFT',
  sourceWarehouseId: WH1.id,
  destWarehouseId: STORE.id,
  note: null,
  requestedAt: null,
  shippedAt: null,
  shipDate: null,
  receivedAt: null,
  receiveDate: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [],
};

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
const bodyOf = async (request: Request | undefined) =>
  request ? ((await request.clone().json()) as unknown) : undefined;

describe('transfers menu', () => {
  it('shows transfers to the supermarket clerk and the warehouse, not to accountants', async () => {
    renderApp('/system/status', signedIn(CLERK_ME));
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.transfers })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: mn.nav.adjustments })).toBeNull();
  });

  it('keeps the entry from accountants', async () => {
    renderApp('/system/status', signedIn(ACCOUNTANT_ME));
    const nav = await findSidebar();
    expect(within(nav).queryByRole('link', { name: mn.nav.transfers })).toBeNull();
  });
});

describe('transfer request', () => {
  it('lets the clerk ask the warehouse for goods and send the request', async () => {
    let transfer = DRAFT;
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers': () => list([]),
      'POST /api/v1/transfers': () => json(transfer, 201),
      'GET /api/v1/transfers/7': () => json(transfer),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/transfers/7/lines': () => {
        transfer = { ...transfer, lines: [COLA_LINE] };
        return json(transfer, 201);
      },
      'PATCH /api/v1/transfer-lines/1': () => {
        transfer = { ...transfer, lines: [{ ...COLA_LINE, requestedQty: '2' }] };
        return json(transfer);
      },
      'POST /api/v1/transfers/7/request': () => {
        transfer = { ...transfer, status: 'REQUESTED', number: 'TR-2026-000001' };
        return json(transfer);
      },
    });
    renderApp('/inventory/transfers', fetchMock);
    const user = userEvent.setup();
    // The new transfer is made in a dialog opened from the page header (ADR-0042).
    await user.click(await screen.findByRole('button', { name: mn.inventory.transfer.newTitle }));
    const createDialog = within(await screen.findByRole('dialog'));
    const from = await createDialog.findByRole('combobox', { name: mn.inventory.transfers.from });
    await waitFor(() =>
      expect(within(from).getByRole('option', { name: WH1.name })).toBeInTheDocument(),
    );
    await user.selectOptions(from, String(WH1.id));
    const to = createDialog.getByRole('combobox', { name: mn.inventory.transfers.to });
    // The clerk asks only for the store, which is chosen already.
    expect(within(to).queryByRole('option', { name: WH1.name })).toBeNull();
    expect(to).toHaveValue(String(STORE.id));
    await user.click(createDialog.getByRole('button', { name: mn.inventory.transfer.createDraft }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/transfers')).toHaveLength(1));
    const created = calls(fetchMock, 'POST', '/api/v1/transfers')[0];
    expect(await bodyOf(created)).toEqual({
      origin: 'REQUEST',
      sourceWarehouseId: WH1.id,
      destWarehouseId: STORE.id,
    });
    expect(created!.headers.get('Idempotency-Key')).toMatch(UUID);

    const scan = await screen.findByRole('textbox', { name: mn.inventory.transfer.scanProduct });
    await user.type(scan, '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/transfers/7/lines')[0])).toEqual({
      productUnitId: 77,
      qty: '1',
    });
    // The same box again asks for one more.
    await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA.name}` });
    await user.type(scan, '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/transfer-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/transfer-lines/1')[0])).toEqual({
      qty: '2',
    });

    // Sending asks nothing: the request can be taken back (ADR-0047 #7).
    await user.click(screen.getByRole('button', { name: mn.inventory.transfer.sendRequest }));
    expect(await screen.findByRole('heading', { name: 'TR-2026-000001' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/request')).toHaveLength(1);
    expect(await screen.findByRole('status')).toHaveTextContent('TR-2026-000001');
  }, 15_000);

  it('takes a sent request back to edit it and sends it again under its number', async () => {
    let transfer: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'REQUESTED',
      number: 'TR-2026-000001',
      requestedAt: STAMP,
      lines: [COLA_LINE],
    };
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(transfer),
      'POST /api/v1/transfers/7/reopen': () => {
        transfer = { ...transfer, status: 'DRAFT', requestedAt: null };
        return json(transfer);
      },
      'POST /api/v1/transfers/7/request': () => {
        transfer = { ...transfer, status: 'REQUESTED', requestedAt: STAMP };
        return json(transfer);
      },
    });
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.inventory.transfer.reopen }));
    // No question: the request becomes a draft that keeps its number.
    expect(await screen.findByText(mn.inventory.transfer.reopenedOwnerNote)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'TR-2026-000001' })).toBeInTheDocument();
    expect(screen.getAllByText(mn.inventory.transfer.reopenedBadge).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: mn.inventory.transfer.resendRequest }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/request')).toHaveLength(1),
    );
    expect(
      await screen.findByRole('button', { name: mn.inventory.transfer.reopen }),
    ).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/reopen')).toHaveLength(1);
  });

  it('tells the sender to wait while a request is being edited', async () => {
    renderApp(
      '/inventory/transfers/7',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/transfers/7': () =>
          json({ ...DRAFT, number: 'TR-2026-000001', lines: [COLA_LINE] }),
      }),
    );
    expect(await screen.findByText(mn.inventory.transfer.reopenedSourceNote)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.inventory.transfer.ship })).toBeNull();
  });
});

describe('shipping', () => {
  it('needs a shelf for every line it ships and sends the counted quantities once', async () => {
    const requested: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'REQUESTED',
      number: 'TR-2026-000001',
      requestedAt: STAMP,
      lines: [COLA_LINE, WATER_LINE],
    };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(requested),
      'GET /api/v1/bins/lookup': (request) =>
        new URL(request.url).searchParams.get('code') === 'A-01-04'
          ? json(SHELF)
          : problem('NOT_FOUND', 404),
      'GET /api/v1/barcodes/5449000000996': () => json(WATER_PCS),
      'POST /api/v1/transfers/7/ship': () => json({ ...requested, status: 'SHIPPED' }),
    });
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    const ship = await screen.findByRole('button', { name: mn.inventory.transfer.ship });
    // Water has no fixed shelf in the warehouse: it waits for a scanned one.
    expect(ship).toBeDisabled();
    expect(screen.getByText(mn.inventory.transfer.scanShelf)).toBeInTheDocument();

    const scan = screen.getByRole('textbox', { name: mn.inventory.scanLabel });
    await user.type(scan, 'A-01-04{Enter}');
    expect(await screen.findByText('Тавиур: A-01-04')).toBeInTheDocument();
    await user.type(scan, '5449000000996{Enter}');
    expect(await screen.findByText(`${WATER.name} → A-01-04`)).toBeInTheDocument();

    const colaQty = screen.getByRole('textbox', {
      name: `${mn.inventory.transfer.toShip}: ${COLA.name}`,
    });
    await user.clear(colaQty);
    await user.type(colaQty, '0.5');
    await waitFor(() => expect(ship).toBeEnabled());
    await user.click(ship);
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Кока кола: 12 ш дутуу илгээнэ')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.inventory.transfer.ship }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/ship')).toHaveLength(1),
    );
    const post = calls(fetchMock, 'POST', '/api/v1/transfers/7/ship')[0];
    expect(await bodyOf(post)).toEqual({
      lines: [
        { lineId: 1, productUnitId: 77, qty: '0.5', binId: 31 },
        { lineId: 2, productUnitId: 80, qty: '10', binId: 32 },
      ],
    });
    expect(post!.headers.get('Idempotency-Key')).toMatch(UUID);
  }, 15_000);

  it('ships as asked without a question and declines in one dialog', async () => {
    const requested: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'REQUESTED',
      number: 'TR-2026-000001',
      requestedAt: STAMP,
      lines: [COLA_LINE],
    };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(requested),
      'POST /api/v1/transfers/7/cancel': () =>
        json({ ...requested, status: 'CANCELLED', cancelReason: 'Үлдэгдэлгүй' }),
      'POST /api/v1/transfers/7/ship': () => json({ ...requested, status: 'SHIPPED' }),
    });
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.inventory.transfer.decline }));
    const dialog = within(await screen.findByRole('dialog'));
    const confirm = dialog.getByRole('button', { name: mn.inventory.transfer.decline });
    expect(confirm).toBeDisabled();
    await user.type(dialog.getByLabelText(mn.inventory.transfer.declineReason), 'Үлдэгдэлгүй');
    await user.click(confirm);
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/cancel')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/transfers/7/cancel')[0])).toEqual({
      reason: 'Үлдэгдэлгүй',
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.inventory.transfer.declined);

    // A shipment exactly as asked goes on the click.
    cleanup();
    renderApp('/inventory/transfers/7', fetchMock);
    await user.click(await screen.findByRole('button', { name: mn.inventory.transfer.ship }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/ship')).toHaveLength(1),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  }, 15_000);

  it('keeps typed counts on this device until they are sent', async () => {
    const requested: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'REQUESTED',
      number: 'TR-2026-000001',
      requestedAt: STAMP,
      lines: [COLA_LINE],
    };
    const key = `tugeel.inventory.stepCounts.v1:${WAREHOUSE_ME.id}:7:ship`;
    const routes = {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(requested),
      'POST /api/v1/transfers/7/ship': () => json({ ...requested, status: 'SHIPPED' }),
    };
    // Another user's and an old entry are never used; the old one is swept.
    localStorage.setItem(
      `tugeel.inventory.stepCounts.v1:99:7:ship`,
      JSON.stringify({ savedAt: Date.now(), lines: {} }),
    );
    localStorage.setItem(
      `tugeel.inventory.stepCounts.v1:${WAREHOUSE_ME.id}:8:ship`,
      JSON.stringify({ savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, lines: {} }),
    );
    const fetchMock = signedIn(WAREHOUSE_ME, routes);
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    const qty = await screen.findByRole('textbox', {
      name: `${mn.inventory.transfer.toShip}: ${COLA.name}`,
    });
    await user.clear(qty);
    await user.type(qty, '0.5');
    await waitFor(() => expect(localStorage.getItem(key)).not.toBeNull());
    expect(
      localStorage.getItem(`tugeel.inventory.stepCounts.v1:${WAREHOUSE_ME.id}:8:ship`),
    ).toBeNull();

    // A reload brings the count back.
    cleanup();
    renderApp('/inventory/transfers/7', signedIn(WAREHOUSE_ME, routes));
    expect(
      await screen.findByRole('textbox', { name: `${mn.inventory.transfer.toShip}: ${COLA.name}` }),
    ).toHaveValue('0.5');
    expect(
      screen.getByText(mn.inventory.transfer.restored.replace('{{count}}', '1')),
    ).toBeInTheDocument();

    // Leaving asks first; «Болих» stays on the page.
    const nav = await findSidebar();
    await user.click(within(nav).getByRole('link', { name: mn.nav.transfers }));
    const leave = within(await screen.findByRole('dialog'));
    expect(leave.getByText(mn.inventory.transfer.leaveTitle)).toBeInTheDocument();
    await user.click(leave.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Shipped: the kept counts go.
    await user.click(screen.getByRole('button', { name: mn.inventory.transfer.ship }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: mn.inventory.transfer.ship,
      }),
    );
    await waitFor(() => expect(localStorage.getItem(key)).toBeNull());
  }, 20_000);
});

describe('receiving', () => {
  it('counts in the unit shipped and shows what goes back to the sender before receiving', async () => {
    const shipped: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'SHIPPED',
      number: 'TR-2026-000001',
      shipDate: '2026-10-11',
      lines: [
        {
          ...COLA_LINE,
          requestedQty: '2',
          shippedQtyBase: '48',
          toBinId: 50,
          toBinCode: 'SALESFLOOR',
        },
      ],
    };
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(shipped),
      'POST /api/v1/transfers/7/receive': () => json({ ...shipped, status: 'RECEIVED' }),
    });
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    const arrived = await screen.findByRole('textbox', {
      name: `${mn.inventory.transfer.arrived}: ${COLA.name}`,
    });
    expect(arrived).toHaveValue('2');
    await user.clear(arrived);
    await user.type(arrived, '1.5');
    expect(await screen.findByText('-12 ш')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.inventory.transfer.receive }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Кока кола: 12 ш дутуу/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: mn.inventory.transfer.receive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/receive')).toHaveLength(1),
    );
    const post = calls(fetchMock, 'POST', '/api/v1/transfers/7/receive')[0];
    expect(await bodyOf(post)).toEqual({
      lines: [{ lineId: 1, productUnitId: 77, qty: '1.5', binId: 50 }],
    });
    expect(post!.headers.get('Idempotency-Key')).toMatch(UUID);
  });

  it('receives a transfer without differences at once', async () => {
    const shipped: Schemas['TransferDetail'] = {
      ...DRAFT,
      status: 'SHIPPED',
      number: 'TR-2026-000001',
      shipDate: '2026-10-11',
      lines: [{ ...COLA_LINE, shippedQtyBase: '24', toBinId: 50, toBinCode: 'SALESFLOOR' }],
    };
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/transfers/7': () => json(shipped),
      'POST /api/v1/transfers/7/receive': () => json({ ...shipped, status: 'RECEIVED' }),
    });
    renderApp('/inventory/transfers/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.inventory.transfer.receive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/transfers/7/receive')).toHaveLength(1),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(await screen.findByRole('status')).toHaveTextContent('TR-2026-000001');
  });
});
