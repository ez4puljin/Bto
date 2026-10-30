import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { bodyOf, calls } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-15T02:00:00.000Z';
const NAME = (template: string, name: string) => template.replace('{{name}}', name);

const TREE: Schemas['SalesBoard'][] = [
  {
    id: 1,
    name: 'Хөвсгөл',
    branchId: null,
    position: 0,
    archivedAt: null,
    pipelines: [
      {
        id: 10,
        boardId: 1,
        name: 'Бөөний борлуулалт',
        position: 0,
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        archivedAt: null,
        createdAt: STAMP,
        createdByName: 'Админ',
        canManage: true,
      },
    ],
  },
];
const PIPELINE: Schemas['SalesPipeline'] = {
  id: 10,
  boardId: 1,
  name: 'Бөөний борлуулалт',
  position: 0,
  visibility: 'PUBLIC',
  ownOrdersOnly: false,
  transferWarehouseId: null,
  archivedAt: null,
  createdAt: STAMP,
  roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
  canManage: true,
  seesAll: true,
  stages: [
    {
      id: 1,
      pipelineId: 10,
      name: 'Ирсэн',
      position: 0,
      action: 'NONE',
      printPickList: false,
      printDeliveryNote: false,
      cardSort: 'NEWEST',
      archivedAt: null,
      roles: { VIEW: [], EDIT: [], MOVE: [] },
      canView: true,
      canEdit: true,
      canMove: true,
    },
  ],
};
const routes = {
  'GET /api/v1/sales-boards': () => json(TREE),
  'GET /api/v1/sales-pipelines/10': () => json(PIPELINE),
  'GET /api/v1/sales-settings/numbering': () =>
    json({ pattern: '{year}{month}{day}_', digits: 4, updatedAt: null }),
  'GET /api/v1/sales-settings/channels': () => json([]),
  'GET /api/v1/branches': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/warehouses': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/roles': () =>
    json({
      data: [
        { id: 2, code: 'OFFICE', name: null, isSystem: true, permissions: [], userCount: 1 },
        { id: 4, code: 'WAREHOUSE', name: null, isSystem: true, permissions: [], userCount: 1 },
      ],
      nextCursor: null,
    }),
};

describe('boards and pipelines settings', () => {
  it('creates a private, own-orders-only pipeline with its stages in one save', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'POST /api/v1/sales-pipelines': () => json(PIPELINE, 201),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('button', { name: 'Бөөний борлуулалт' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.sales.pipelines.newPipeline }));
    const sheet = await screen.findByRole('dialog', { name: mn.sales.pipelines.newPipeline });
    await user.type(within(sheet).getByLabelText(mn.sales.boards.name), 'Орон нутаг');
    await user.click(
      within(sheet).getByRole('tab', { name: mn.sales.pipelines.visibilities.PRIVATE }),
    );
    const view = within(sheet).getByRole('group', { name: mn.sales.pipelines.rights.VIEW });
    await user.click(within(view).getByLabelText(mn.roles.system.OFFICE));
    await user.click(within(sheet).getByRole('switch', { name: mn.sales.pipelines.ownOrdersOnly }));
    const all = within(sheet).getByRole('group', { name: mn.sales.pipelines.rights.ALL_ORDERS });
    await user.click(within(all).getByLabelText(mn.roles.system.WAREHOUSE));
    // The stages tab: two stages, the second moved up.
    await user.click(
      within(sheet).getByRole('tab', { name: new RegExp(mn.sales.pipelines.tabs.stages) }),
    );
    for (const [name, action] of [
      ['Ирсэн', 'NONE'],
      ['Нөөцөлсөн', 'CONFIRM'],
    ] as const) {
      await user.click(within(sheet).getByRole('button', { name: mn.sales.boards.newStage }));
      const dialog = await screen.findByRole('dialog', { name: mn.sales.boards.newStage });
      await user.type(within(dialog).getByLabelText(mn.sales.boards.name), name);
      await user.selectOptions(within(dialog).getByLabelText(mn.sales.boards.action), action);
      await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: mn.sales.boards.newStage })).toBeNull(),
      );
    }
    await user.click(
      within(sheet).getByRole('button', { name: `${mn.sales.boards.up}: Нөөцөлсөн` }),
    );
    await user.click(within(sheet).getByRole('button', { name: mn.sales.pipelines.create }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-pipelines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-pipelines')[0])).toEqual({
      boardId: 1,
      name: 'Орон нутаг',
      visibility: 'PRIVATE',
      ownOrdersOnly: true,
      transferWarehouseId: null,
      roles: { VIEW: [2], MANAGE: [], ALL_ORDERS: [4] },
      stages: [
        {
          name: 'Нөөцөлсөн',
          action: 'CONFIRM',
          printPickList: false,
          printDeliveryNote: false,
          roles: { VIEW: [], EDIT: [], MOVE: [] },
        },
        {
          name: 'Ирсэн',
          action: 'NONE',
          printPickList: false,
          printDeliveryNote: false,
          roles: { VIEW: [], EDIT: [], MOVE: [] },
        },
      ],
    });
  });

  it('says why a pipeline cannot be added before a board exists', async () => {
    renderApp(
      '/sales/boards/settings',
      signedIn(ADMIN_ME, { ...routes, 'GET /api/v1/sales-boards': () => json([]) }),
    );
    expect(await screen.findByText(mn.sales.pipelines.needBoard)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: mn.sales.pipelines.newPipeline })).toBeDisabled();
  });

  it('asks before a pipeline with unsaved edits closes', async () => {
    const fetchMock = signedIn(ADMIN_ME, routes);
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.sales.pipelines.newPipeline }));
    const sheet = await screen.findByRole('dialog', { name: mn.sales.pipelines.newPipeline });
    await user.type(within(sheet).getByLabelText(mn.sales.boards.name), 'Орон нутаг');
    // Escape (or «Болих») asks first; staying keeps the typed name.
    await user.keyboard('{Escape}');
    const question = await screen.findByRole('dialog', { name: mn.sales.panel.leaveTitle });
    expect(within(question).getByText(mn.sales.pipelines.leaveDescription)).toBeInTheDocument();
    await user.click(within(question).getByRole('button', { name: mn.common.cancel }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: mn.sales.panel.leaveTitle })).toBeNull(),
    );
    expect(within(sheet).getByLabelText(mn.sales.boards.name)).toHaveValue('Орон нутаг');
    await user.click(within(sheet).getByRole('button', { name: mn.common.cancel }));
    await user.click(
      within(await screen.findByRole('dialog', { name: mn.sales.panel.leaveTitle })).getByRole(
        'button',
        { name: mn.sales.panel.leave },
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: mn.sales.pipelines.newPipeline })).toBeNull(),
    );
  });

  it('copies and archives a pipeline from its row menu', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'POST /api/v1/sales-pipelines/10/copy': () => json({ ...PIPELINE, id: 11 }, 201),
      'GET /api/v1/sales-pipelines/11': () => json({ ...PIPELINE, id: 11 }),
      'POST /api/v1/sales-pipelines/10/archive': () => new Response(null, { status: 204 }),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    const rowMenu = async () => {
      await user.click(
        await screen.findByRole('button', {
          name: NAME(mn.sales.pipelines.rowMenu, 'Бөөний борлуулалт'),
        }),
      );
      return screen.findByRole('menu');
    };
    await user.click(
      within(await rowMenu()).getByRole('menuitem', { name: mn.sales.pipelines.copy }),
    );
    const copy = await screen.findByRole('dialog', {
      name: NAME(mn.sales.pipelines.copyTitle, 'Бөөний борлуулалт'),
    });
    await user.click(within(copy).getByRole('button', { name: mn.sales.pipelines.copy }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-pipelines/10/copy')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/sales-pipelines/10/copy')[0])).toEqual({
      name: NAME(mn.sales.pipelines.copyName, 'Бөөний борлуулалт'),
      boardId: 1,
    });
    // The copy opens in the sheet; close it and archive the original after a question.
    const sheet = await screen.findByRole('dialog', { name: mn.sales.pipelines.editPipeline });
    await user.click(within(sheet).getByRole('button', { name: mn.common.cancel }));
    await user.click(
      within(await rowMenu()).getByRole('menuitem', { name: mn.sales.pipelines.archive }),
    );
    const confirm = await screen.findByRole('dialog', {
      name: NAME(mn.sales.pipelines.archiveTitle, 'Бөөний борлуулалт'),
    });
    await user.click(within(confirm).getByRole('button', { name: mn.sales.pipelines.archive }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/sales-pipelines/10/archive')).toHaveLength(1),
    );
  });

  it('refuses a number format that could repeat and saves a good one', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'PUT /api/v1/sales-settings/numbering': () =>
        json({ pattern: 'ORD-{year}-', digits: 5, updatedAt: STAMP }),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.sales.numbering.button }));
    const dialog = await screen.findByRole('dialog', { name: mn.sales.numbering.title });
    const pattern = within(dialog).getByLabelText(mn.sales.numbering.pattern);
    await user.clear(pattern);
    await user.type(pattern, 'ORD-');
    await user.click(
      within(dialog).getByRole('button', {
        name: mn.sales.numbering.insertToken.replace('{{token}}', mn.sales.numbering.tokens.year),
      }),
    );
    expect(within(dialog).getByText(mn.sales.numbering.issues.ENDS_WITH_DIGIT)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: mn.common.save })).toBeDisabled();
    await user.type(pattern, '-');
    const digits = within(dialog).getByLabelText(mn.sales.numbering.digits);
    await user.clear(digits);
    await user.type(digits, '5');
    expect(
      within(dialog).getByText(
        mn.sales.numbering.example.replace('{{number}}', `ORD-${businessDate().slice(0, 4)}-00001`),
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/sales-settings/numbering')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-settings/numbering')[0])).toEqual({
      pattern: 'ORD-{year}-',
      digits: 5,
    });
  });

  it('sets where a channel’s new orders land: a pipeline, then its stage', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'PUT /api/v1/sales-settings/channels': () =>
        json([{ channel: 'ADMIN', pipelineId: 10, stageId: 1 }]),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.sales.channelsDialog.button }));
    const dialog = await screen.findByRole('dialog', { name: mn.sales.channelsDialog.title });
    const office = mn.sales.channels.ADMIN;
    await user.selectOptions(
      within(dialog).getByLabelText(`${mn.sales.channelsDialog.pipeline}: ${office}`),
      '10',
    );
    expect(calls(fetchMock, 'PUT', '/api/v1/sales-settings/channels')).toHaveLength(0);
    const stage = within(dialog).getByLabelText(`${mn.sales.channelsDialog.stage}: ${office}`);
    await within(stage).findByRole('option', { name: 'Ирсэн' });
    await user.selectOptions(stage, '1');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/sales-settings/channels')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-settings/channels')[0])).toEqual({
      channel: 'ADMIN',
      pipelineId: 10,
      stageId: 1,
    });
  });

  it('offers the customer app only stages without an action in pipelines of every order', async () => {
    const [board] = TREE;
    const [wholesale] = board?.pipelines ?? [];
    const [arrived] = PIPELINE.stages;
    if (!board || !wholesale || !arrived) throw new Error('fixtures');
    const tree: Schemas['SalesBoard'][] = [
      {
        ...board,
        pipelines: [
          wholesale,
          { ...wholesale, id: 11, name: 'Миний захиалга', position: 1, ownOrdersOnly: true },
        ],
      },
    ];
    const pipeline: Schemas['SalesPipeline'] = {
      ...PIPELINE,
      stages: [arrived, { ...arrived, id: 2, name: 'Нөөцөлсөн', position: 1, action: 'CONFIRM' }],
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...routes,
      'GET /api/v1/sales-boards': () => json(tree),
      'GET /api/v1/sales-pipelines/10': () => json(pipeline),
      'PUT /api/v1/sales-settings/channels': () =>
        json([{ channel: 'CUSTOMER_APP', pipelineId: 10, stageId: 1 }]),
    });
    renderApp('/sales/boards/settings', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.sales.channelsDialog.button }));
    const dialog = within(
      await screen.findByRole('dialog', { name: mn.sales.channelsDialog.title }),
    );
    const names = (select: HTMLElement) =>
      within(select)
        .getAllByRole('option')
        .map((option) => option.textContent);
    const app = mn.sales.channels.CUSTOMER_APP;
    const office = mn.sales.channels.ADMIN;
    expect(dialog.getByText(mn.sales.channelsDialog.customerAppHint)).toBeInTheDocument();
    // The office's channel keeps every pipeline; the app's leaves out the own-orders-only one.
    const appPipeline = dialog.getByLabelText(`${mn.sales.channelsDialog.pipeline}: ${app}`);
    expect(names(dialog.getByLabelText(`${mn.sales.channelsDialog.pipeline}: ${office}`))).toEqual([
      mn.sales.channelsDialog.none,
      'Бөөний борлуулалт',
      'Миний захиалга',
    ]);
    expect(names(appPipeline)).toEqual([mn.sales.channelsDialog.none, 'Бөөний борлуулалт']);

    await user.selectOptions(appPipeline, '10');
    const appStage = dialog.getByLabelText(`${mn.sales.channelsDialog.stage}: ${app}`);
    await within(appStage).findByRole('option', { name: 'Ирсэн' });
    // A CONFIRM stage would reserve stock before the office checks the order.
    expect(names(appStage)).toEqual([mn.sales.channelsDialog.chooseStage, 'Ирсэн']);
    await user.selectOptions(appStage, '1');
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/sales-settings/channels')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/sales-settings/channels')[0])).toEqual({
      channel: 'CUSTOMER_APP',
      pipelineId: 10,
      stageId: 1,
    });
  });
});
