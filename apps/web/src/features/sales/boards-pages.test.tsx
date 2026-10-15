import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { bodyOf, calls, UUID, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

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

const stage = (
  id: number,
  name: string,
  fields: Partial<Schemas['SalesStage']> = {},
): Schemas['SalesStage'] => ({
  id,
  boardId: 1,
  name,
  position: id,
  action: 'NONE',
  printPickList: false,
  printDeliveryNote: false,
  archivedAt: null,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
  canView: true,
  canEdit: true,
  canMove: true,
  ...fields,
});
const BOARD: Schemas['SalesBoard'] = {
  id: 1,
  name: 'Мөрөн Борлуулалт',
  branchId: null,
  position: 0,
  archivedAt: null,
  roles: { VIEW: [], MANAGE: [] },
  canManage: false,
  stages: [
    stage(1, 'ХТ Захиалга'),
    stage(2, 'Нярав Хяналт', { action: 'CONFIRM', printPickList: true }),
    stage(3, 'Бэлдэх', { action: 'PICK', canMove: false }),
    stage(4, 'Цуцалсан', { action: 'CANCEL' }),
  ],
};
const CARD: Schemas['SalesOrderCard'] = {
  id: 5,
  number: null,
  status: 'DRAFT',
  channel: 'ADMIN',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  fulfilment: 'DELIVERY',
  deliveryDate: '2026-10-16',
  total: null,
  lineCount: 1,
  createdByName: 'Оффис Сараа',
  stageEnteredAt: STAMP,
};
const CARDS: Schemas['SalesStageCards'][] = [
  { stageId: 1, count: 1, total: '0', cards: [CARD] },
  {
    stageId: 2,
    count: 1,
    total: '72000',
    cards: [{ ...CARD, id: 6, number: 'SO-2026-000002', status: 'CONFIRMED', total: '72000' }],
  },
  { stageId: 3, count: 0, total: '0', cards: [] },
  { stageId: 4, count: 0, total: '0', cards: [] },
];
const ORDER: Schemas['SalesOrderDetail'] = {
  id: 5,
  number: null,
  channel: 'ADMIN',
  status: 'DRAFT',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  fulfilment: 'DELIVERY',
  deliveryDate: '2026-10-16',
  addressId: 50,
  addressText: 'Мөрөн, 3-р баг',
  addressLat: null,
  addressLng: null,
  contactName: null,
  contactPhone: null,
  paymentMethod: 'CASH',
  note: null,
  priceDate: null,
  subtotal: null,
  discountTotal: null,
  total: null,
  submittedAt: null,
  confirmedAt: null,
  cancelledAt: null,
  cancelReason: null,
  boardId: 1,
  boardName: 'Мөрөн Борлуулалт',
  stageId: 1,
  stageName: 'ХТ Захиалга',
  stageEnteredAt: STAMP,
  pickedAt: null,
  deliveredAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [],
  events: [],
  moves: [],
};

const boardRoutes = (fetchMock?: ReturnType<typeof signedIn>) => ({
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/branches': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/sales-boards': () => json([BOARD]),
  'GET /api/v1/sales-boards/1/cards': () => json(CARDS),
  'GET /api/v1/sales-orders/5': () => json(ORDER),
  'POST /api/v1/sales-orders/5/move': () =>
    json({ order: { ...ORDER, status: 'CONFIRMED', stageId: 2 }, print: ['PICK_LIST'] }),
  ...(fetchMock ? {} : {}),
});

describe('order boards', () => {
  it('shows the board, its stage totals and the cards; the menu to the office', async () => {
    renderApp('/sales/boards', signedIn(OFFICE_ME, boardRoutes()));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.salesBoards }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Мөрөн Борлуулалт' })).toBeInTheDocument();
    const confirmed = screen.getByRole('region', { name: 'Нярав Хяналт' });
    expect(await within(confirmed).findAllByText('72,000₮')).toHaveLength(2);
    expect(within(confirmed).getByText('SO-2026-000002')).toBeInTheDocument();
    const first = screen.getByRole('region', { name: 'ХТ Захиалга' });
    expect(within(first).getByText('Номин дэлгүүр')).toBeInTheDocument();
    expect(within(first).getByText(/Оффис Сараа/)).toBeInTheDocument();
  });

  it('moves a card through its menu with a key and offers the stage’s documents', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = signedIn(OFFICE_ME, boardRoutes());
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const first = await screen.findByRole('region', { name: 'ХТ Захиалга' });
    await user.click(
      await within(first).findByRole('button', { name: `${mn.sales.boards.move}: Ноорог №5` }),
    );
    const menu = await screen.findByRole('menu');
    // «Бэлдэх» is not offered: the office may not move cards into it.
    expect(within(menu).queryByRole('menuitem', { name: 'Бэлдэх' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Нярав Хяналт' }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')).toHaveLength(1),
    );
    const [moved] = calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move');
    expect(moved?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(moved)).toEqual({ stageId: 2 });
    const dialog = await screen.findByRole('dialog', { name: mn.sales.boards.printTitle });
    await user.click(within(dialog).getByRole('button', { name: mn.sales.printKinds.PICK_LIST }));
    expect(open).toHaveBeenCalledWith('/sales/orders/5/print/PICK_LIST', '_blank', 'noopener');
    open.mockRestore();
  });

  it('asks a reason before a CANCEL stage and opens the order beside the board', async () => {
    const fetchMock = signedIn(OFFICE_ME, {
      ...boardRoutes(),
      'POST /api/v1/sales-orders/5/move': () =>
        json({ order: { ...ORDER, status: 'CANCELLED', stageId: 4 }, print: [] }),
    });
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const first = await screen.findByRole('region', { name: 'ХТ Захиалга' });
    await user.click(
      await within(first).findByRole('button', { name: `${mn.sales.boards.move}: Ноорог №5` }),
    );
    await user.click(
      within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Цуцалсан' }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: mn.sales.order.cancel });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText(mn.sales.order.cancelReason), 'Татгалзсан');
    await user.click(confirm);
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')[0])).toEqual({
      stageId: 4,
      reason: 'Татгалзсан',
    });
    await user.click(within(first).getByRole('button', { name: 'Ноорог №5' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ноорог №5' });
    expect(within(sheet).getByText('Мөрөн, 3-р баг')).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: mn.sales.boards.openOrder })).toHaveAttribute(
      'href',
      '/sales/orders/5',
    );
  });
});

describe('board settings', () => {
  it('adds a stage with its action, documents and roles', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/branches': () => json({ data: [], nextCursor: null }),
      'GET /api/v1/roles': () =>
        json({
          data: [
            { id: 2, code: 'OFFICE', name: null, isSystem: true, permissions: [], userCount: 1 },
            { id: 4, code: 'WAREHOUSE', name: null, isSystem: true, permissions: [], userCount: 1 },
          ],
          nextCursor: null,
        }),
      'GET /api/v1/sales-boards': () => json([{ ...BOARD, canManage: true }]),
      'GET /api/v1/sales-boards/defaults': () => json([]),
      'POST /api/v1/sales-boards/1/stages': () => json({ ...BOARD, canManage: true }, 201),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('ХТ Захиалга')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.sales.boards.newStage }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(mn.sales.boards.name), 'Борлуулалт');
    await user.selectOptions(within(dialog).getByLabelText(mn.sales.boards.action), 'SALE');
    expect(within(dialog).getByText(mn.sales.stageActionHints.SALE)).toBeInTheDocument();
    await user.click(within(dialog).getByLabelText(mn.sales.printKinds.DELIVERY_NOTE));
    const move = within(dialog).getByRole('group', { name: mn.sales.stageRights.MOVE });
    await user.click(within(move).getByLabelText(mn.roles.system.WAREHOUSE));
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-boards/1/stages')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-boards/1/stages')[0])).toEqual({
      name: 'Борлуулалт',
      action: 'SALE',
      printPickList: false,
      printDeliveryNote: true,
      roles: { VIEW: [], EDIT: [], MOVE: [4] },
    });
  });
});
