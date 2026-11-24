import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, getSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-13T02:00:00.000Z';
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

const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
  writableWarehouseIds: [WH1.id],
};
const CLERK_ME: Me = {
  ...ADMIN_ME,
  id: 5,
  username: 'khudaldagch',
  fullName: 'Худалдагч Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.POS_CASHIER],
  roles: [{ id: 6, code: 'POS_CASHIER', name: null, isSystem: true }],
  writableWarehouseIds: [STORE.id],
};

const COLA: Schemas['LowStockRow'] = {
  product: { id: 10, sku: '10', name: 'Кока кола', baseUnitName: 'ш', thumbUrl: null },
  baseUnitId: 70,
  status: 'LOW',
  onHand: '6',
  minQty: '10',
  maxQty: '30',
  suggestedQty: '24',
  homeWarehouseId: WH1.id,
};
const WATER: Schemas['LowStockRow'] = {
  product: { id: 11, sku: '11', name: 'Ус', baseUnitName: 'ш', thumbUrl: null },
  baseUnitId: 80,
  status: 'OUT',
  onHand: '0',
  minQty: null,
  maxQty: null,
  suggestedQty: null,
  homeWarehouseId: WH1.id,
};

const requestLabel = (count: number) =>
  mn.inventory.lowStock.request.replace('{{count}}', String(count));

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('low-stock list', () => {
  it('restores the URL filters and clears selected rows on status changes and history navigation', async () => {
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/low': (request) => {
        const status = new URL(request.url).searchParams.get('status');
        return list(status === 'OUT' ? [WATER] : status === 'LOW' ? [COLA] : [WATER, COLA]);
      },
    });
    const { router } = renderApp(
      '/inventory/low-stock?warehouseId=2&supplier=main:3&status=LOW',
      fetchMock,
    );
    const user = userEvent.setup();
    await screen.findByText(COLA.product.name);
    expect(
      screen.getByRole('combobox', { name: mn.inventory.lowStock.columns.status }),
    ).toHaveValue('LOW');
    const first = new URL(calls(fetchMock, 'GET', '/api/v1/stock/low').at(-1)!.url);
    expect(first.searchParams.get('supplier')).toBe('main:3');
    expect(first.searchParams.get('status')).toBe('LOW');
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    expect(screen.getByRole('button', { name: requestLabel(1) })).toBeEnabled();
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.inventory.lowStock.columns.status }),
      'OUT',
    );
    await screen.findByText(WATER.product.name);
    expect(screen.getByRole('button', { name: requestLabel(0) })).toBeDisabled();
    expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe('main:3');
    expect(
      new URL(calls(fetchMock, 'GET', '/api/v1/stock/low').at(-1)!.url).searchParams.get('cursor'),
    ).toBeNull();
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    await user.click(screen.getByRole('button', { name: requestLabel(1) }));
    await screen.findByRole('dialog');
    await router.navigate('/inventory/low-stock?warehouseId=2&status=LOW&supplier=3');
    await screen.findByText(COLA.product.name);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/v1/transfers')).toHaveLength(0);
    expect(screen.getByRole('button', { name: requestLabel(0) })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    await router.navigate(-1);
    await screen.findByText(WATER.product.name);
    expect(screen.getByRole('button', { name: requestLabel(0) })).toBeDisabled();
    await user.selectOptions(
      screen.getByRole('combobox', { name: mn.inventory.lowStock.columns.status }),
      '',
    );
    await screen.findByText(COLA.product.name);
    expect(new URLSearchParams(router.state.location.search).has('status')).toBe(false);
  });

  it('uses the categorized searchable supplier picker, main by default, with clearing', async () => {
    const supplier = { id: 3, code: 'S3', name: 'Supplier Three', status: 'ACTIVE' };
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/low': () => list([WATER, COLA]),
      'GET /api/v1/supplier-categories': () =>
        json([
          {
            id: 9,
            parentId: null,
            name: 'Drinks',
            path: 'Drinks',
            depth: 0,
            active: true,
            sortOrder: 0,
            supplierCount: 1,
          },
        ]),
      'GET /api/v1/suppliers': () => list([supplier]),
    });
    const { router } = renderApp('/inventory/low-stock?warehouseId=2&status=OUT', fetchMock);
    const user = userEvent.setup();
    await screen.findByText(COLA.product.name);
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    await user.click(
      screen.getByRole('button', { name: mn.catalog.products.filters.fields.supplier }),
    );
    let dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('tab', { name: mn.catalog.products.filters.supplierModes.MAIN_IN }),
    ).toHaveAttribute('aria-selected', 'true');
    await user.click(await within(dialog).findByRole('button', { name: /Drinks/ }));
    await user.type(
      within(dialog).getByRole('searchbox', { name: mn.catalog.products.filters.searchSupplier }),
      'Three',
    );
    await user.click(await within(dialog).findByRole('checkbox', { name: supplier.name }));
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.filters.apply }),
    );
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe('main:3'),
    );
    expect(screen.getByRole('button', { name: requestLabel(0) })).toBeDisabled();
    expect(new URLSearchParams(router.state.location.search).get('status')).toBe('OUT');
    await waitFor(() =>
      expect(
        new URL(calls(fetchMock, 'GET', '/api/v1/stock/low').at(-1)!.url).searchParams.get(
          'supplier',
        ),
      ).toBe('main:3'),
    );
    await user.click(
      screen.getByRole('button', { name: `${mn.catalog.products.filters.fields.supplier} (1)` }),
    );
    dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('tab', {
        name: mn.catalog.products.filters.supplierModes.IN,
      }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.filters.apply }),
    );
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).get('supplier')).toBe('3'),
    );
    const clearLabel = mn.catalog.products.filters.clear.replace(
      '{{name}}',
      mn.catalog.products.filters.fields.supplier,
    );
    await user.click(screen.getByRole('button', { name: clearLabel }));
    await waitFor(() =>
      expect(new URLSearchParams(router.state.location.search).has('supplier')).toBe(false),
    );
    expect(new URLSearchParams(router.state.location.search).get('status')).toBe('OUT');
  });

  it('shows a wholesale warehouse what ran out or reached its minimum, with the supplier', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/low': () => list([WATER, COLA]),
      'GET /api/v1/product-suppliers': () =>
        list([
          {
            id: 1,
            productId: COLA.product.id,
            isMain: true,
            supplier: { id: 3, code: '3', name: 'МСМ ХХК', status: 'ACTIVE' },
          },
        ]),
    });
    renderApp('/inventory/low-stock', fetchMock);
    // The worker writes for one warehouse: its list opens at once.
    expect(await screen.findByText(COLA.product.name)).toBeInTheDocument();
    const read = calls(fetchMock, 'GET', '/api/v1/stock/low').at(-1);
    expect(new URL(read!.url).searchParams.get('warehouseId')).toBe('1');
    const nav = getSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.lowStock })).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText(mn.inventory.lowStock.statuses.OUT)).toBeInTheDocument();
    expect(table.getByText(mn.inventory.lowStock.statuses.LOW)).toBeInTheDocument();
    expect(screen.getByText('24')).toBeInTheDocument();
    expect(await screen.findByText('МСМ ХХК')).toBeInTheDocument();
    // No transfer request from a wholesale warehouse.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets the supermarket ask its home warehouse for the chosen rows in one request', async () => {
    const fetchMock = signedIn(CLERK_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/low': () => list([WATER, COLA]),
      'POST /api/v1/transfers': () =>
        json(
          {
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
          },
          201,
        ),
      'GET /api/v1/transfers/7': () =>
        json({
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
        }),
    });
    const { router } = renderApp('/inventory/low-stock', fetchMock);
    const user = userEvent.setup();
    await screen.findByText(COLA.product.name);
    // The home warehouse is shown at the store, the supplier is not.
    expect(screen.getAllByText(WH1.name).length).toBeGreaterThan(0);
    const request = screen.getByRole('button', { name: requestLabel(0) });
    expect(request).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    await user.click(screen.getByRole('button', { name: requestLabel(2) }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('combobox', { name: mn.inventory.lowStock.source }),
    ).toHaveValue(String(WH1.id));
    await user.click(
      within(dialog).getByRole('button', { name: mn.inventory.lowStock.createRequest }),
    );
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/transfers')).toHaveLength(1));
    const created = calls(fetchMock, 'POST', '/api/v1/transfers')[0];
    expect(await created!.clone().json()).toEqual({
      origin: 'REQUEST',
      sourceWarehouseId: WH1.id,
      destWarehouseId: STORE.id,
      lines: [
        { productUnitId: WATER.baseUnitId, qty: '1' },
        { productUnitId: COLA.baseUnitId, qty: '24' },
      ],
    });
    expect(created!.headers.get('Idempotency-Key')).toMatch(UUID);
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/transfers/7'));
  });
});
