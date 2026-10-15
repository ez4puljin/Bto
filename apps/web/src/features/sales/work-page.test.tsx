import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { bodyOf, calls, list, UUID, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';
const PAPER_KEY = 'tugeel.printFormat.v1';

const OFFICE_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'office',
  fullName: 'Оффис Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.OFFICE],
  roles: [{ id: 2, code: 'OFFICE', name: null, isSystem: true }],
};

const summary = (id: number, name: string): Schemas['SalesPipelineSummary'] => ({
  id,
  boardId: 1,
  name,
  position: id,
  visibility: 'PUBLIC',
  ownOrdersOnly: false,
  archivedAt: null,
  createdAt: STAMP,
  createdByName: 'Админ',
  canManage: false,
});
const TREE: Schemas['SalesBoard'][] = [
  {
    id: 1,
    name: 'Хөвсгөл',
    branchId: null,
    position: 0,
    archivedAt: null,
    pipelines: [summary(10, 'Бөөний борлуулалт'), summary(11, 'Орон нутаг')],
  },
];
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
  archivedAt: null,
  createdAt: STAMP,
  roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
  canManage: false,
  seesAll: true,
  stages: [
    stage(1, 'ХТ Захиалга'),
    stage(2, 'Нярав Хяналт', { action: 'CONFIRM', printPickList: true }),
    stage(3, 'Бэлдэх', { action: 'PICK', canMove: false }),
    stage(4, 'Цуцалсан', { action: 'CANCEL' }),
  ],
};
const CARD: Schemas['SalesOrderCard'] = {
  id: 5,
  number: '20261015_0005',
  status: 'DRAFT',
  channel: 'ADMIN',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  fulfilment: 'DELIVERY',
  paymentMethod: 'CREDIT',
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
    cards: [
      {
        ...CARD,
        id: 6,
        number: '20261015_0006',
        status: 'CONFIRMED',
        paymentMethod: 'CASH',
        total: '72000',
      },
    ],
  },
  { stageId: 3, count: 0, total: '0', cards: [] },
  {
    stageId: 4,
    count: 1,
    total: '0',
    cards: [{ ...CARD, id: 7, number: '20261015_0007', status: 'CANCELLED' }],
  },
];
const ORDER: Schemas['SalesOrderDetail'] = {
  id: 7,
  number: '20261015_0007',
  channel: 'ADMIN',
  status: 'CANCELLED',
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
  cancelledAt: STAMP,
  cancelReason: 'Татгалзсан',
  boardId: 1,
  boardName: 'Хөвсгөл',
  pipelineId: 10,
  pipelineName: 'Бөөний борлуулалт',
  stageId: 4,
  stageName: 'Цуцалсан',
  stageEnteredAt: STAMP,
  pickedAt: null,
  deliveredAt: null,
  archivedAt: null,
  createdByName: 'Оффис Сараа',
  canEdit: true,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [],
  events: [],
  moves: [],
};
const ROW: Schemas['SalesOrderSummary'] = {
  id: 5,
  number: '20261015_0005',
  status: 'DRAFT',
  channel: 'ADMIN',
  customerId: 9,
  customerCode: '1001',
  customerName: 'Номин дэлгүүр',
  fulfilment: 'DELIVERY',
  paymentMethod: 'CREDIT',
  deliveryDate: '2026-10-16',
  total: null,
  lineCount: 1,
  pipelineId: 10,
  pipelineName: 'Бөөний борлуулалт',
  stageId: 1,
  stageName: 'ХТ Захиалга',
  archivedAt: null,
  createdByName: 'Оффис Сараа',
  createdAt: STAMP,
};

const routes = (
  extra: Record<string, (request: Request) => Response | Promise<Response>> = {},
) => ({
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/sales-boards': () => json(TREE),
  'GET /api/v1/sales-pipelines/10': () => json(PIPELINE),
  'GET /api/v1/sales-pipelines/10/cards': () => json(CARDS),
  'GET /api/v1/sales-orders/7': () => json(ORDER),
  'GET /api/v1/sales-orders': () => json({ data: [ROW], nextCursor: null, total: 1 }),
  ...extra,
});
const queryOf = (request: Request | undefined) =>
  Object.fromEntries(new URL(request?.url ?? 'http://x/').searchParams);

describe('warehouse sales page', () => {
  it('shows the boards and pipelines, the stage totals, cards and «+» where it may', async () => {
    renderApp('/sales/boards', signedIn(OFFICE_ME, routes()));
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.salesWarehouse }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Бөөний борлуулалт' })).toBeInTheDocument();
    await screen.findByRole('region', { name: 'Нярав Хяналт' });
    const panel = screen.getByRole('navigation', { name: mn.sales.work.panel });
    expect(within(panel).getByRole('button', { name: 'Бөөний борлуулалт' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const confirmed = screen.getByRole('region', { name: 'Нярав Хяналт' });
    expect(await within(confirmed).findAllByText('72,000₮')).toHaveLength(2);
    expect(within(confirmed).getByText('20261015_0006')).toBeInTheDocument();
    expect(screen.getByText(mn.sales.work.count.replace('{{count}}', '3'))).toBeInTheDocument();
    // «+» on the stage without an action only.
    const first = screen.getByRole('region', { name: 'ХТ Захиалга' });
    expect(
      within(first).getByRole('button', { name: `${mn.sales.work.addHere}: ХТ Захиалга` }),
    ).toBeInTheDocument();
    expect(
      within(confirmed).queryByRole('button', { name: `${mn.sales.work.addHere}: Нярав Хяналт` }),
    ).toBeNull();
    // Every card: how it is paid and who entered it (ADR-0058).
    expect(within(first).getByText(mn.sales.paymentMethods.CREDIT)).toBeInTheDocument();
    expect(within(confirmed).getByText(mn.sales.paymentMethods.CASH)).toBeInTheDocument();
    expect(
      within(first).getByText(mn.sales.work.cardCreatedBy.replace('{{name}}', 'Оффис Сараа')),
    ).toBeInTheDocument();
  });

  it('moves a card through its menu with a key and offers the stage’s documents', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'POST /api/v1/sales-orders/5/move': () =>
          json({
            order: { ...ORDER, id: 5, status: 'CONFIRMED', stageId: 2 },
            print: ['PICK_LIST'],
          }),
      }),
    );
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const first = await screen.findByRole('region', { name: 'ХТ Захиалга' });
    await user.click(
      await within(first).findByRole('button', { name: `${mn.sales.boards.move}: 20261015_0005` }),
    );
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Бэлдэх' })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: 'Нярав Хяналт' }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move')).toHaveLength(1),
    );
    const [moved] = calls(fetchMock, 'POST', '/api/v1/sales-orders/5/move');
    expect(moved?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await bodyOf(moved)).toEqual({ stageId: 2 });
    const dialog = await screen.findByRole('dialog', { name: mn.sales.boards.printTitle });
    const paper = within(dialog).getByRole('tablist', { name: mn.sales.print.paper });
    expect(within(paper).getByRole('tab', { name: mn.sales.print.formats.A4 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(paper).getByRole('tab', { name: mn.sales.print.formats.MM80 }));
    await user.click(within(dialog).getByRole('button', { name: mn.sales.printKinds.PICK_LIST }));
    expect(open).toHaveBeenCalledWith(
      '/sales/orders/5/print/PICK_LIST?format=80mm',
      '_blank',
      'noopener',
    );
    expect(localStorage.getItem(PAPER_KEY)).toBe('80mm');
    open.mockRestore();
  });

  it('sorts a stage, prints its cards and archives the finished ones from its menu', async () => {
    localStorage.setItem(PAPER_KEY, '80mm');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'PUT /api/v1/sales-stages/1/sort': () => json(PIPELINE),
        'POST /api/v1/sales-stages/4/archive-cards': () => json({ archived: 1 }),
      }),
    );
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const stageMenu = async (name: string) => {
      await user.click(
        await screen.findByRole('button', {
          name: mn.sales.work.stageMenu.replace('{{name}}', name),
        }),
      );
      return screen.findByRole('menu');
    };
    // Sort: the stage's own order, for everyone.
    await stageMenu('ХТ Захиалга');
    await user.click(
      await screen.findByRole('menuitemradio', { name: mn.sales.cardSorts.DELIVERY }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/sales-stages/1/sort')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-stages/1/sort')[0])).toEqual({
      sort: 'DELIVERY',
    });
    // Print: the delivery note leaves the draft out.
    await user.click(
      within(await stageMenu('Нярав Хяналт')).getByRole('menuitem', {
        name: mn.sales.work.printAll,
      }),
    );
    const printing = await screen.findByRole('dialog', {
      name: mn.sales.work.printTitle.replace('{{name}}', 'Нярав Хяналт'),
    });
    await user.click(
      within(printing).getByRole('tab', { name: mn.sales.printKinds.DELIVERY_NOTE }),
    );
    await user.click(
      within(printing).getByRole('button', { name: mn.sales.work.print.replace('{{count}}', '1') }),
    );
    expect(
      within(printing).getByRole('tab', { name: mn.sales.print.formats.MM80 }),
    ).toHaveAttribute('aria-selected', 'true');
    expect(open).toHaveBeenCalledWith(
      '/sales/print/DELIVERY_NOTE?ids=6&format=80mm',
      '_blank',
      'noopener',
    );
    // Archive the finished cards of «Цуцалсан» after a question.
    await user.click(
      within(await stageMenu('Цуцалсан')).getByRole('menuitem', {
        name: mn.sales.work.archiveCards,
      }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: mn.sales.work.archiveCardsTitle.replace('{{name}}', 'Цуцалсан'),
    });
    await user.click(within(confirm).getByRole('button', { name: mn.sales.boards.archive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-stages/4/archive-cards')).toHaveLength(1),
    );
    expect(
      await screen.findByText(mn.sales.work.archivedCards.replace('{{count}}', '1')),
    ).toBeInTheDocument();
    open.mockRestore();
  });

  it('opens an order in its panel, prints on this computer’s paper and archives it', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'POST /api/v1/sales-orders/7/archive': () => json({ ...ORDER, archivedAt: STAMP }),
      }),
    );
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const cancelled = await screen.findByRole('region', { name: 'Цуцалсан' });
    await user.click(await within(cancelled).findByRole('button', { name: '20261015_0007' }));
    const panel = await screen.findByRole('dialog', { name: '20261015_0007' });
    // The sections (ADR-0059); «Бэлтгэх» only for pickers of a confirmed order.
    const sections = within(panel).getByRole('tablist', { name: mn.sales.panel.sections });
    expect(
      within(sections)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual([
      mn.sales.panel.tabs.overview,
      mn.sales.panel.tabs.properties,
      mn.sales.panel.tabs.products,
      mn.sales.panel.tabs.activity,
    ]);
    await user.click(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.properties }));
    expect(within(panel).getByText('Мөрөн, 3-р баг')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: mn.sales.printKinds.PICK_LIST }));
    expect(open).toHaveBeenCalledWith(
      '/sales/orders/7/print/PICK_LIST?format=a4',
      '_blank',
      'noopener',
    );
    await user.click(within(panel).getByRole('button', { name: mn.sales.panel.more }));
    await user.click(await screen.findByRole('menuitem', { name: mn.sales.work.archive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-orders/7/archive')).toHaveLength(1),
    );
    open.mockRestore();
  });

  it('creates an order in a stage from its «+» and opens it on its products', async () => {
    const created: Schemas['SalesOrderDetail'] = {
      ...ORDER,
      id: 8,
      number: '20261015_0008',
      status: 'DRAFT',
      stageId: 1,
      stageName: 'ХТ Захиалга',
      cancelledAt: null,
      cancelReason: null,
      lines: [],
    };
    const fetchMock = signedIn(
      OFFICE_ME,
      routes({
        'GET /api/v1/customers': () =>
          list([
            {
              id: 9,
              code: '1001',
              kind: 'COMPANY',
              name: 'Номин дэлгүүр',
              regNo: null,
              tin: null,
              phone: null,
              status: 'ACTIVE',
              creditHold: false,
            },
          ]),
        'POST /api/v1/sales-orders': () => json(created, 201),
        'GET /api/v1/sales-orders/8': () => json(created),
      }),
    );
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    const first = await screen.findByRole('region', { name: 'ХТ Захиалга' });
    await user.click(
      within(first).getByRole('button', { name: `${mn.sales.work.addHere}: ХТ Захиалга` }),
    );
    const dialog = await screen.findByRole('dialog', { name: mn.sales.create.title });
    expect(
      await within(dialog).findByText(mn.sales.order.stageFixed.replace('{{name}}', 'ХТ Захиалга')),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByPlaceholderText(mn.partners.customerPicker.search),
      'номин',
    );
    await user.click(await within(dialog).findByRole('button', { name: /Номин дэлгүүр/ }));
    await user.click(within(dialog).getByRole('button', { name: mn.sales.create.create }));
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/sales-orders')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-orders')[0])).toMatchObject({
      customerId: 9,
      pipelineId: 10,
      stageId: 1,
      paymentMethod: 'CASH',
      lines: [],
    });
    const panel = await screen.findByRole('dialog', { name: '20261015_0008' });
    expect(within(panel).getByRole('tab', { name: mn.sales.panel.tabs.products })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('filters the cards and shows the list view, remembered for the user', async () => {
    const fetchMock = signedIn(OFFICE_ME, routes());
    renderApp('/sales/boards', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('region', { name: 'ХТ Захиалга' });
    await user.click(screen.getByRole('button', { name: mn.sales.filters.menu }));
    await user.click(await screen.findByRole('menuitem', { name: mn.sales.filters.fields.mine }));
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/sales-pipelines/10/cards').some(
          (request) => queryOf(request).mine === 'true',
        ),
      ).toBe(true),
    );
    expect(
      screen.getByRole('button', {
        name: mn.sales.filters.clear.replace('{{name}}', mn.sales.filters.fields.mine),
      }),
    ).toBeInTheDocument();
    // «Харуулах» → «Жагсаалтаар».
    await user.click(screen.getByRole('button', { name: mn.sales.work.display }));
    await user.click(await screen.findByRole('menuitemradio', { name: mn.sales.work.views.LIST }));
    expect(await screen.findByRole('button', { name: '20261015_0005' })).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: mn.sales.work.columns.payment }),
    ).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: mn.sales.paymentMethods.CREDIT })).toBeInTheDocument();
    const listed = calls(fetchMock, 'GET', '/api/v1/sales-orders').at(-1);
    expect(queryOf(listed)).toMatchObject({ pipeline: '10', mine: 'true', archived: 'exclude' });
    expect(localStorage.getItem(`tugeel.salesWork.v1:${OFFICE_ME.id}`)).toContain('"view":"LIST"');
  });

  it('opens the list view for the old orders address', async () => {
    renderApp('/sales/orders', signedIn(OFFICE_ME, routes()));
    expect(await screen.findByRole('button', { name: '20261015_0005' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: mn.sales.work.scope })).toHaveValue('PIPELINE');
  });

  it('shows a reader the empty state when no pipeline is open to them', async () => {
    renderApp(
      '/sales/boards',
      signedIn(OFFICE_ME, { ...routes(), 'GET /api/v1/sales-boards': () => json([]) }),
    );
    expect(await screen.findByText(mn.sales.work.empty)).toBeInTheDocument();
  });
});
