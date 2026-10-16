import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { CASH_BOX } from '@/features/finance/finance-fixtures';
import { ACCOUNTANT_ME, bodyOf, calls, list, UUID, WAREHOUSE_ME } from '@/test/inventory-fixtures';
import { findSidebar, json, renderApp, signedIn } from '@/test/render-app';
import {
  CASHIER,
  HANDED_OVER,
  NODE,
  POS_SETTINGS,
  SALE,
  SALE_ROW,
  SHIFT,
  TILL,
} from './pos-fixtures';

const routes = () => ({
  'GET /api/v1/pos/settings': () => json(POS_SETTINGS),
  'GET /api/v1/pos/edge-nodes': () => json([NODE]),
  'GET /api/v1/pos/tills': () => json([TILL]),
  'GET /api/v1/pos/cashiers': () => json([CASHIER]),
  'GET /api/v1/pos/shifts': () => list([SHIFT]),
  'GET /api/v1/pos/shifts/21': () => json(SHIFT),
  'GET /api/v1/pos/sales': () => json({ data: [SALE_ROW], nextCursor: null, total: 1 }),
  'GET /api/v1/pos/sales/51': () => json(SALE),
  'GET /api/v1/pos/attention': () =>
    json({ openShifts: 0, shiftsToHandOver: 2, openShortfalls: 1, rejections: 0 }),
  'GET /api/v1/money-accounts': () => json([CASH_BOX]),
  'GET /api/v1/users': () => list([]),
  'GET /api/v1/warehouses': () =>
    list([
      { id: 3, code: 'SM', name: 'Супермаркет', kind: 'STORE', branchId: 1, status: 'ACTIVE' },
    ]),
  'GET /api/v1/finance/attention': () =>
    json({ overdueAmount: '0.00', overdueCustomers: 0, openAmount: '0.00', openInvoices: 0 }),
});

describe('supermarket pages (ADR-0063 #8)', () => {
  it('shows the «Супермаркет» menu to the admin and hides it from the warehouse', async () => {
    renderApp('/', signedIn(undefined, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.getByRole('button', { name: mn.nav.groups.pos })).toBeInTheDocument();
    expect(sidebar.getByRole('link', { name: mn.nav.posShifts })).toHaveAttribute(
      'href',
      '/pos/shifts',
    );
  });

  it('keeps the menu from a warehouse worker', async () => {
    renderApp('/', signedIn(WAREHOUSE_ME, routes()));
    const sidebar = within(await findSidebar());
    expect(sidebar.queryByRole('button', { name: mn.nav.groups.pos })).toBeNull();
  });

  it('shows the accountant the home tile of shifts waiting for their cash', async () => {
    renderApp(
      '/',
      signedIn(ACCOUNTANT_ME, {
        ...routes(),
        'GET /api/v1/inventory/attention': () => json({}, 403),
      }),
    );
    expect(
      await screen.findByRole('link', { name: `${mn.home.attention.shiftsToHandOver}: 2` }),
    ).toHaveAttribute('href', '/pos/shifts?status=CLOSED');
  });

  it('lists the edge servers and the tills and creates a till', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/tills': () => json({ ...TILL, id: 12, code: 'К2', name: 'Касс 2' }, 201),
    });
    renderApp('/pos/tills?new=1', fetchMock);
    expect((await screen.findAllByText('SM1')).length).toBeGreaterThan(0);
    expect(screen.getByText('192.168.1.31:9100')).toBeInTheDocument();
    const dialog = within(await screen.findByRole('dialog', { name: mn.pos.tills.dialogTitle }));
    await user.type(dialog.getByLabelText(mn.pos.fields.code), 'к2');
    await user.type(dialog.getByLabelText(mn.pos.fields.name), 'Касс 2');
    await user.type(dialog.getByLabelText(mn.pos.fields.printerHost), '192.168.1.32');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/pos/tills')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/pos/tills')[0])).toEqual({
      edgeNodeId: 1,
      code: 'К2',
      name: 'Касс 2',
      printerHost: '192.168.1.32',
      printerPort: 9100,
      drawerKick: true,
    });
    expect(await screen.findByText(mn.pos.tills.created)).toBeInTheDocument();
  });

  it('issues a new edge token and shows it once', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'POST /api/v1/pos/edge-nodes/1/token': () =>
        json({ token: 'tgs_1_secretsecretsecretsecretsecret12', prefix: 'deadbeef' }),
    });
    renderApp('/pos/tills', fetchMock);
    await user.click(
      await screen.findByRole('button', { name: `${mn.pos.actions.newToken}: SM1` }),
    );
    // The old token stops at once: a destructive question, «Болих» keeps the focus.
    const confirm = within(await screen.findByRole('dialog', { name: mn.pos.nodes.tokenTitle }));
    expect(confirm.getByRole('button', { name: mn.pos.actions.newToken })).not.toHaveFocus();
    await user.click(confirm.getByRole('button', { name: mn.pos.actions.newToken }));
    expect(await screen.findByText('tgs_1_secretsecretsecretsecretsecret12')).toBeInTheDocument();
    // A click beside the code does not lose it.
    const shown = screen
      .getByText('tgs_1_secretsecretsecretsecretsecret12')
      .closest('[role="dialog"]');
    fireEvent.pointerDown(document.body);
    expect(shown).toBeInTheDocument();
    expect(screen.getByText('tgs_1_secretsecretsecretsecretsecret12')).toBeInTheDocument();
  });

  it('sets a cashier’s PIN without ever reading it back', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'PUT /api/v1/pos/cashiers/7/pin': () => json(CASHIER),
    });
    renderApp('/pos/cashiers', fetchMock);
    const row = await screen.findByRole('row', { name: /Кассчин Болор/ });
    expect(within(row).getByText('bolor')).toBeInTheDocument();
    await user.click(
      within(row).getByRole('button', { name: `${mn.pos.actions.setPin}: Кассчин Болор` }),
    );
    const dialog = within(
      await screen.findByRole('dialog', {
        name: mn.pos.cashiers.pinTitle.replace('{{name}}', 'Кассчин Болор'),
      }),
    );
    await user.type(dialog.getByLabelText(mn.pos.fields.pin), '123456');
    await user.type(dialog.getByLabelText(mn.pos.fields.pinAgain), '123457');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.pinMismatch)).toBeInTheDocument();
    expect(calls(fetchMock, 'PUT', '/api/v1/pos/cashiers/7/pin')).toHaveLength(0);
    await user.clear(dialog.getByLabelText(mn.pos.fields.pinAgain));
    await user.type(dialog.getByLabelText(mn.pos.fields.pinAgain), '123456');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/pos/cashiers/7/pin')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/pos/cashiers/7/pin')[0])).toEqual({
      pin: '123456',
    });
    expect(await screen.findByText(mn.pos.cashiers.pinSet)).toBeInTheDocument();
  });

  it('opens a closed shift and lets the accountant receive its cash', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/pos/shifts/21/handover': () => json(HANDED_OVER),
    });
    renderApp('/pos/shifts', fetchMock);
    const row = await screen.findByRole('row', { name: /К1-261016-Э1/ });
    expect(within(row).getByText(mn.pos.shiftStatuses.CLOSED)).toBeInTheDocument();
    // A cash shortage reads in red, with the tugrik sign of every amount in a list.
    expect(within(row).getByText('-300₮')).toHaveClass('text-destructive');
    // The number is the row's link to its panel, for the keyboard.
    const number = within(row).getByRole('link', { name: 'К1-261016-Э1' });
    expect(number).toHaveAttribute('href', '/pos/shifts?shift=21');
    await user.click(number);
    const panel = within(
      await screen.findByRole('dialog', {
        name: mn.pos.shifts.panelTitle.replace('{{number}}', 'К1-261016-Э1'),
      }),
    );
    expect(panel.getByRole('link', { name: 'Ж-20261016-0007' })).toHaveAttribute(
      'href',
      '/finance/journal?entry=31',
    );
    expect(panel.getByText(`-300₮ · ${mn.pos.shifts.short}`)).toBeInTheDocument();
    await user.click(panel.getByRole('button', { name: mn.pos.actions.handover }));
    const dialog = within(await screen.findByRole('dialog', { name: mn.pos.shifts.handoverTitle }));
    // Counted − float kept, prefilled.
    expect(dialog.getByLabelText(mn.pos.fields.amount)).toHaveValue('321000.00');
    await user.click(dialog.getByRole('button', { name: mn.pos.shifts.handoverSubmit }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/pos/shifts/21/handover')).toHaveLength(1),
    );
    const request = calls(fetchMock, 'POST', '/api/v1/pos/shifts/21/handover')[0];
    expect(await bodyOf(request)).toEqual({
      moneyAccountId: 1,
      amount: '321000',
      paidOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByText(mn.pos.shifts.handedOver.replace('{{number}}', 'Т-20261016-0003')),
    ).toBeInTheDocument();
  });

  it('gives the focus back to the shift number after its panel closes', async () => {
    const user = userEvent.setup();
    renderApp('/pos/shifts', signedIn(ACCOUNTANT_ME, routes()));
    const row = await screen.findByRole('row', { name: /К1-261016-Э1/ });
    await user.click(within(row).getByRole('link', { name: 'К1-261016-Э1' }));
    await screen.findByRole('dialog', {
      name: mn.pos.shifts.panelTitle.replace('{{number}}', 'К1-261016-Э1'),
    });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The keyboard goes on from the row it opened.
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /К1-261016-Э1/ })).getByRole('link', {
          name: 'К1-261016-Э1',
        }),
      ).toHaveFocus(),
    );
  });

  it('lists sales and opens one with its lines, tender and shortfall', async () => {
    const user = userEvent.setup();
    renderApp('/pos/sales', signedIn(undefined, routes()));
    const row = await screen.findByRole('row', { name: /К1-261016-0045/ });
    // The total and the cash tender read the same.
    expect(within(row).getAllByText('2,600₮')).toHaveLength(2);
    expect(within(row).getByText(mn.pos.ebarimtStatuses.NONE)).toBeInTheDocument();
    await user.click(within(row).getByRole('link', { name: 'К1-261016-0045' }));
    const panel = within(
      await screen.findByRole('dialog', {
        name: `${mn.pos.saleKinds.SALE} К1-261016-0045`,
      }),
    );
    expect(panel.getByText('Кока кола')).toBeInTheDocument();
    expect(panel.getByRole('link', { name: 'К1-261016-Э1' })).toHaveAttribute(
      'href',
      '/pos/shifts?shift=21',
    );
    expect(
      panel.getByText(mn.pos.sales.shortfallHint.replace('{{number}}', 'ADJ-2026-000012')),
    ).toBeInTheDocument();
    expect(panel.getByRole('link', { name: mn.pos.actions.printCopy })).toHaveAttribute(
      'href',
      '/pos/sales/51/print?format=a4',
    );
  });

  it('shows and saves the settings', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(undefined, {
      ...routes(),
      'PUT /api/v1/pos/settings': () => json({ ...POS_SETTINGS, returnWindowDays: 7 }),
    });
    renderApp('/pos/settings', fetchMock);
    const card = within(await screen.findByRole('region', { name: mn.pos.settings.section }));
    expect(card.getByText('Супермаркет')).toBeInTheDocument();
    await user.click(
      card.getByRole('button', {
        name: mn.common.editRecord.replace('{{name}}', mn.pos.settings.section),
      }),
    );
    const days = screen.getByLabelText(mn.pos.fields.returnWindowDays);
    await user.clear(days);
    await user.type(days, '7');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PUT', '/api/v1/pos/settings')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/pos/settings')[0])).toEqual({
      storeWarehouseId: 3,
      handoverMoneyAccountId: 1,
      returnWindowDays: 7,
      snapshotIntervalSec: 60,
      supervisorRequired: true,
    });
    expect(await screen.findByText(mn.pos.settings.saved)).toBeInTheDocument();
  });
});
