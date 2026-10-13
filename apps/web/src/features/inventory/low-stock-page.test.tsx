import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, type Me, renderApp, signedIn } from '@/test/render-app';

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

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('low-stock list', () => {
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
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: mn.nav.lowStock })).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.lowStock.statuses.OUT)).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.lowStock.statuses.LOW)).toBeInTheDocument();
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
    const request = screen.getByRole('button', { name: 'Шилжүүлэг хүсэх (0)' });
    expect(request).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: mn.inventory.lowStock.selectAll }));
    await user.click(screen.getByRole('button', { name: 'Шилжүүлэг хүсэх (2)' }));
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
