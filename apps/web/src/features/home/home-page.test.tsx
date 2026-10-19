import { cleanup, screen, waitFor, within } from '@testing-library/react';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ACCOUNTANT_ME, calls, WAREHOUSE_ME } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const NOTHING: Schemas['InventoryAttention'] = {
  transfersToShip: 0,
  transfersToReceive: 0,
  adjustmentsToApprove: 0,
  stocktakesToReview: 0,
  receiptsToCost: 0,
  lowStock: { count: 0, warehouseId: null },
  cap: 100,
};
const tiles = () => screen.findByRole('region', { name: mn.home.attention.title });
const tile = (label: string, count: string) =>
  screen.findByRole('link', { name: `${label}: ${count}` });

describe('«Анхаарах» tiles (ADR-0047 #7)', () => {
  it('shows each count above zero as a link to its filtered list', async () => {
    renderApp(
      '/',
      signedIn(ADMIN_ME, {
        'GET /api/v1/inventory/attention': () =>
          json({
            ...NOTHING,
            transfersToReceive: 2,
            adjustmentsToApprove: 100,
            lowStock: { count: 3, warehouseId: 4 },
          }),
        'GET /api/v1/pricing/attention': () => json({ productsWaitingForPrices: 5, cap: 100 }),
      }),
    );
    expect(await tile(mn.home.attention.transfersToReceive, '2')).toHaveAttribute(
      'href',
      '/inventory/transfers?direction=INCOMING&status=SHIPPED',
    );
    // At the cap the count reads «99+».
    expect(await tile(mn.home.attention.adjustments, '99+')).toHaveAttribute(
      'href',
      '/inventory/adjustments?status=SUBMITTED',
    );
    expect(await tile(mn.home.attention.lowStock, '3')).toHaveAttribute(
      'href',
      '/inventory/low-stock?warehouseId=4',
    );
    expect(await tile(mn.home.attention.productsWaitingForPrices, '5')).toHaveAttribute(
      'href',
      '/catalog/pending',
    );
    // Zero counts stay hidden.
    const region = within(await tiles());
    expect(
      region.queryByRole('link', { name: new RegExp(mn.home.attention.transfersToShip) }),
    ).toBeNull();
    expect(region.getAllByRole('link')).toHaveLength(4);
  });

  it('asks only for the counts a person may act on', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/inventory/attention': () => json({ ...NOTHING, receiptsToCost: 1 }),
    });
    renderApp('/', fetchMock);
    expect(await tile(mn.home.attention.receiptsToCost, '1')).toHaveAttribute(
      'href',
      '/inventory/receipts?costing=pending',
    );
    expect(calls(fetchMock, 'GET', '/api/v1/pricing/attention')).toHaveLength(0);

    const sales: Me = { ...ADMIN_ME, id: 9, permissions: [], roles: [] };
    const quiet = signedIn(sales);
    renderApp('/', quiet);
    await screen.findAllByRole('heading', { level: 1 });
    expect(calls(quiet, 'GET', '/api/v1/inventory/attention')).toHaveLength(0);
  });

  it('shows nothing when nothing waits or the counts fail', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/inventory/attention': () => problem('INTERNAL', 500),
    });
    renderApp('/', fetchMock);
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/inventory/attention').length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole('region', { name: mn.home.attention.title })).toBeNull();
  });
});

describe('the customer app warning (ADR-0079 #5)', () => {
  it('warns the boards admin while app orders have no stage to land on', async () => {
    renderApp(
      '/',
      signedIn(ADMIN_ME, {
        'GET /api/v1/customer/attention': () => json({ activeAccounts: 4, ordersOpen: false }),
      }),
    );
    const warning = (await screen.findByText(mn.home.customerApp.warning)).closest<HTMLElement>(
      '[data-slot="alert"]',
    );
    if (!warning) throw new Error('no alert');
    expect(
      within(warning).getByText(mn.home.customerApp.hint.replace('{{n}}', '4')),
    ).toBeInTheDocument();
    expect(within(warning).getByRole('link', { name: mn.home.customerApp.open })).toHaveAttribute(
      'href',
      '/sales/boards/settings',
    );
  });

  it('stays quiet when orders land, when no store uses the app, or without the right', async () => {
    const open = signedIn(ADMIN_ME, {
      'GET /api/v1/customer/attention': () => json({ activeAccounts: 4, ordersOpen: true }),
    });
    renderApp('/', open);
    await waitFor(() =>
      expect(calls(open, 'GET', '/api/v1/customer/attention').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(mn.home.customerApp.warning)).toBeNull();
    cleanup();

    const unused = signedIn(ADMIN_ME, {
      'GET /api/v1/customer/attention': () => json({ activeAccounts: 0, ordersOpen: false }),
    });
    renderApp('/', unused);
    await waitFor(() =>
      expect(calls(unused, 'GET', '/api/v1/customer/attention').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(mn.home.customerApp.warning)).toBeNull();
    cleanup();

    const office = signedIn({
      ...ADMIN_ME,
      id: 9,
      permissions: ['sales.orders.read'],
      roles: [],
    });
    renderApp('/', office);
    await screen.findAllByRole('heading', { level: 1 });
    expect(calls(office, 'GET', '/api/v1/customer/attention')).toHaveLength(0);
  });
});
