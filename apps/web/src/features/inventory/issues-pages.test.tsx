import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  calls,
  COLA,
  COLA_BOX,
  list,
  SHELF,
  STAMP,
  UUID,
  WAREHOUSE_ME,
  WH1,
  warehouses,
} from '@/test/inventory-fixtures';
import { ADMIN_ME, findSidebar, json, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
type Detail = Schemas['IssueDetail'];

const issues = mn.inventory.issues;
const COLA_UNIT = `${COLA.name} (хайрцаг)`;

const TYPES: Schemas['IssueExpenseType'][] = [
  { id: 1, name: 'Дотоод хэрэглээ', code: 'INTERNAL_USE', active: true, sortOrder: 10 },
  { id: 2, name: 'Урамшуулал', code: 'BONUS', active: true, sortOrder: 20 },
  { id: 3, name: 'Хуучин төрөл', code: null, active: false, sortOrder: 30 },
];

const LINE: Schemas['IssueLine'] = {
  id: 1,
  productId: COLA.id,
  productSku: COLA.sku,
  productName: COLA.name,
  productUnitId: 77,
  unitName: 'хайрцаг',
  enteredQty: '1',
  factorSnapshot: '24',
  qtyBase: '24',
  binId: SHELF.id,
  binCode: SHELF.code,
};

const DRAFT: Detail = {
  id: 7,
  number: null,
  warehouseId: 1,
  warehouseName: WH1.name,
  issuedOn: '2026-10-18',
  expenseTypeId: 1,
  expenseTypeName: 'Дотоод хэрэглээ',
  recipientKind: 'OTHER',
  recipientUserId: null,
  recipientCustomerId: null,
  recipientSupplierId: null,
  recipientName: 'Бат',
  status: 'DRAFT',
  note: null,
  effectiveDate: null,
  postedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [LINE],
};

const POSTED: Detail = {
  ...DRAFT,
  status: 'POSTED',
  number: 'GI-2026-000001',
  effectiveDate: '2026-10-18',
  postedAt: STAMP,
};

const summary = (id: number): Schemas['IssueSummary'] => ({
  id,
  number: `GI-2026-00000${id}`,
  warehouseId: 1,
  issuedOn: '2026-10-18',
  expenseTypeId: 2,
  expenseTypeName: 'Урамшуулал',
  recipientKind: 'CUSTOMER',
  recipientName: 'Номин дэлгүүр',
  status: 'POSTED',
  lineCount: 3,
  effectiveDate: '2026-10-18',
  createdAt: STAMP,
});

const editorRoutes = {
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/issues/expense-types': () => json(TYPES),
};

const scanBox = () => screen.getByRole('textbox', { name: mn.inventory.scanLabel });
const header = async () => within(await screen.findByRole('region', { name: issues.header }));

describe('goods issues list (ADR-0081)', () => {
  it('lists issues with their type and recipient and opens one', async () => {
    renderApp(
      '/inventory/issues',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/issues': () => list([summary(1), summary(2)], 'next'),
      }),
    );
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.issues })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const link = await screen.findByRole('link', { name: 'GI-2026-000001' });
    expect(link).toHaveAttribute('href', '/inventory/issues/1');
    expect(screen.getAllByText('Урамшуулал').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Харилцагч · Номин дэлгүүр')).toHaveLength(2);
    expect(screen.getByRole('button', { name: mn.common.loadMore })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: issues.create })).toHaveAttribute(
      'href',
      '/inventory/issues/new',
    );
    // Only those who set up the warehouse manage the expense types.
    expect(screen.queryByRole('button', { name: issues.types.open })).toBeNull();
  });

  it('sends the filters to the list', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues': () => list([]),
    });
    renderApp('/inventory/issues?status=DRAFT&type=2', fetchMock);
    expect(await screen.findByText(issues.empty)).toBeInTheDocument();
    const query = new URL(calls(fetchMock, 'GET', '/api/v1/issues')[0]!.url).searchParams;
    expect(query.get('status')).toBe('DRAFT');
    expect(query.get('expenseTypeId')).toBe('2');
  });

  it('keeps the menu entry from people who do not issue goods', async () => {
    renderApp('/inventory/stock', signedIn({ ...WAREHOUSE_ME, permissions: [] }));
    const nav = await findSidebar();
    expect(within(nav).queryByRole('link', { name: mn.nav.issues })).toBeNull();
  });
});

describe('expense types', () => {
  it('adds, renames and retires a type in one dialog', async () => {
    let types = TYPES;
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/issues': () => list([]),
      'GET /api/v1/issues/expense-types': () => json(types),
      'POST /api/v1/issues/expense-types': async (request) => {
        const body = (await request.clone().json()) as { name: string };
        const created = { id: 4, name: body.name, code: null, active: true, sortOrder: 40 };
        types = [...types, created];
        return json(created, 201);
      },
      'PATCH /api/v1/issues/expense-types/2': async (request) => {
        const body = (await request.clone().json()) as Partial<Schemas['IssueExpenseType']>;
        types = types.map((type) => (type.id === 2 ? { ...type, ...body } : type));
        return json(types.find((type) => type.id === 2));
      },
    });
    renderApp('/inventory/issues', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.types.open }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText('Хуучин төрөл')).toBeInTheDocument();
    expect(dialog.getByText(issues.types.inactive)).toBeInTheDocument();

    await user.type(dialog.getByLabelText(issues.types.newName), 'Дээж{Enter}');
    expect(
      await dialog.findByText(issues.types.added.replace('{{name}}', 'Дээж')),
    ).toBeInTheDocument();
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/issues/expense-types')[0])).toEqual({
      name: 'Дээж',
    });
    expect(dialog.getByLabelText(issues.types.newName)).toHaveValue('');

    await user.click(
      dialog.getByRole('button', { name: issues.types.rename.replace('{{name}}', 'Урамшуулал') }),
    );
    const field = dialog.getByRole('textbox', { name: issues.types.name });
    await user.clear(field);
    await user.type(field, 'Бэлэг{Enter}');
    expect(
      await dialog.findByText(issues.types.renamed.replace('{{name}}', 'Бэлэг')),
    ).toBeInTheDocument();
    await user.click(
      await dialog.findByRole('button', { name: issues.types.retire.replace('{{name}}', 'Бэлэг') }),
    );
    expect(
      await dialog.findByText(issues.types.retired.replace('{{name}}', 'Бэлэг')),
    ).toBeInTheDocument();
    const patches = calls(fetchMock, 'PATCH', '/api/v1/issues/expense-types/2');
    expect(await bodyOf(patches[0])).toEqual({ name: 'Бэлэг' });
    expect(await bodyOf(patches[1])).toEqual({ active: false });
  }, 15_000);
});

describe('a new issue (one window like the receipt)', () => {
  it('creates the draft with its header on the first scan', async () => {
    const issue: Detail = { ...DRAFT, issuedOn: businessDate() };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'GET /api/v1/bins/lookup': () => problem('NOT_FOUND', 404),
      'POST /api/v1/issues': () => json(issue, 201),
      'GET /api/v1/issues/7': () => json(issue),
    });
    const { router } = renderApp('/inventory/issues/new', fetchMock);
    const user = userEvent.setup();
    const card = await header();
    await waitFor(() => expect(card.getByLabelText(mn.inventory.warehouse)).toHaveValue('1'));
    expect(card.getByLabelText(mn.inventory.date)).toHaveValue(businessDate());
    expect(card.getByLabelText(mn.inventory.date)).toHaveAttribute('max', businessDate());
    // A retired type is not offered to a new issue.
    expect(await card.findByRole('option', { name: 'Урамшуулал' })).toBeInTheDocument();
    expect(card.queryByRole('option', { name: /Хуучин төрөл/ })).toBeNull();

    // A product before the header is complete asks for it and makes nothing.
    await user.type(scanBox(), '4006381333931{Enter}');
    expect(await screen.findByText(issues.needHeader)).toBeInTheDocument();
    expect(card.getAllByText(mn.validation.required)).toHaveLength(2);
    expect(calls(fetchMock, 'POST', '/api/v1/issues')).toHaveLength(0);

    await user.selectOptions(card.getByLabelText(issues.expenseType), 'Дотоод хэрэглээ');
    await user.click(card.getByRole('tab', { name: issues.recipientKinds.OTHER }));
    await user.type(card.getByLabelText(issues.recipient), 'Бат');
    await user.type(card.getByLabelText(issues.note), 'Оффисын хэрэгцээ');
    await user.type(scanBox(), '4006381333931{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/issues/7'));
    const posts = calls(fetchMock, 'POST', '/api/v1/issues');
    expect(posts).toHaveLength(1);
    expect(await bodyOf(posts[0])).toEqual({
      warehouseId: 1,
      issuedOn: businessDate(),
      expenseTypeId: 1,
      recipient: { kind: 'OTHER', name: 'Бат' },
      note: 'Оффисын хэрэгцээ',
      lines: [{ productUnitId: 77, enteredQty: '1' }],
    });
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByRole('heading', { name: mn.inventory.draftNo.replace('{{id}}', '7') }),
    ).toBeInTheDocument();
    expect(screen.getByText('+1 хайрцаг (24 ш) · Кока кола')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('tugeel.inventory.lastWarehouse.v1') ?? '{}')).toEqual({
      '2': { issue: 1 },
    });
  }, 20_000);

  it('refuses a date in the future', async () => {
    renderApp('/inventory/issues/new', signedIn(WAREHOUSE_ME, editorRoutes));
    const user = userEvent.setup();
    const card = await header();
    const date = card.getByLabelText(mn.inventory.date);
    await user.clear(date);
    await user.type(date, '2999-01-01');
    expect(await card.findByText(mn.validation.notFuture)).toBeInTheDocument();
  });

  it('finds a staff member as the recipient and saves the choice on the draft', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(issue),
      'GET /api/v1/users/lookup': () => json([{ id: 9, fullName: 'Бат-Эрдэнэ Дорж' }]),
      'PATCH /api/v1/issues/7': () => {
        issue = {
          ...issue,
          recipientKind: 'USER',
          recipientUserId: 9,
          recipientName: 'Бат-Эрдэнэ Дорж',
        };
        return json(issue);
      },
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    const card = await header();
    expect(card.getByLabelText(issues.recipient)).toHaveValue('Бат');
    expect(card.getByRole('tab', { name: issues.recipientKinds.OTHER })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(card.getByRole('tab', { name: issues.recipientKinds.USER }));
    // Switching the kind alone changes nothing on the draft.
    expect(calls(fetchMock, 'PATCH', '/api/v1/issues/7')).toHaveLength(0);
    await user.type(card.getByLabelText(issues.recipient), 'Бат');
    await user.click(await card.findByRole('button', { name: 'Бат-Эрдэнэ Дорж' }));
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/issues/7')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/issues/7')[0])).toEqual({
      recipient: { kind: 'USER', userId: 9 },
    });
    const lookups = calls(fetchMock, 'GET', '/api/v1/users/lookup');
    expect(new URL(lookups.at(-1)!.url).searchParams.get('q')).toBe('Бат');
    expect(card.getByLabelText(issues.recipient)).toHaveValue('Бат-Эрдэнэ Дорж');
    expect(card.getByRole('button', { name: issues.picker.change })).toBeInTheDocument();
  }, 15_000);
});

describe('posting an issue', () => {
  it('posts with Enter and an Idempotency-Key, then reads only', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(issue),
      'POST /api/v1/issues/7/post': () => {
        issue = POSTED;
        return json(issue);
      },
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.post }));
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: issues.post })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'GI-2026-000001' })).toBeInTheDocument();
    const posts = calls(fetchMock, 'POST', '/api/v1/issues/7/post');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent('GI-2026-000001');
    expect(screen.queryByRole('textbox', { name: mn.inventory.scanLabel })).toBeNull();
    expect(screen.queryByRole('button', { name: issues.post })).toBeNull();
  });

  it('shows the shelf that is short in the posting dialog', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(DRAFT),
      'POST /api/v1/issues/7/post': () =>
        problem('STOCK_INSUFFICIENT', 409, {
          binCode: 'A-01-03',
          available: '3',
          requested: '24',
        }),
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.post }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: issues.post }));
    expect(
      await dialog.findByText(
        mn.errors.STOCK_INSUFFICIENT.replace('{{binCode}}', 'A-01-03')
          .replace('{{available}}', '3')
          .replace('{{requested}}', '24'),
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancels a draft and goes back to the list', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(DRAFT),
      'GET /api/v1/issues': () => list([]),
      'POST /api/v1/issues/7/cancel': () => json({ ...DRAFT, status: 'CANCELLED' }),
    });
    const { router } = renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.cancel }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: issues.cancel }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/issues'));
    expect(calls(fetchMock, 'POST', '/api/v1/issues/7/cancel')).toHaveLength(1);
  });
});

describe('issue lines and costs', () => {
  it('saves a changed quantity and removes a line', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(issue),
      'PATCH /api/v1/issue-lines/1': () => {
        issue = { ...issue, lines: [{ ...LINE, enteredQty: '3', qtyBase: '72' }] };
        return json(issue);
      },
      'DELETE /api/v1/issue-lines/1': () => {
        issue = { ...issue, lines: [] };
        return json(issue);
      },
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    const qty = await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` });
    await user.clear(qty);
    await user.type(qty, '3{Enter}');
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1')[0])).toEqual({
      enteredQty: '3',
    });
    await user.click(screen.getByRole('button', { name: `${mn.inventory.remove}: ${COLA_UNIT}` }));
    expect(await screen.findByText(issues.linesEmpty)).toBeInTheDocument();
  });

  it('hides the cost columns from people without the costs right', async () => {
    renderApp(
      '/inventory/issues/7',
      signedIn(WAREHOUSE_ME, { ...editorRoutes, 'GET /api/v1/issues/7': () => json(POSTED) }),
    );
    expect(await screen.findByRole('heading', { name: 'GI-2026-000001' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: issues.unitCost })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: issues.amount })).toBeNull();
    expect(screen.queryByText(new RegExp(issues.total))).toBeNull();
  });

  it('shows the costs the API sends to cost holders', async () => {
    renderApp(
      '/inventory/issues/7',
      signedIn(ADMIN_ME, {
        ...editorRoutes,
        'GET /api/v1/issues/7': () =>
          json({
            ...POSTED,
            lines: [{ ...LINE, unitCost: '1000', amount: '24000.00' }],
            total: '24000.00',
          }),
      }),
    );
    expect(await screen.findByRole('columnheader', { name: issues.unitCost })).toBeInTheDocument();
    expect(screen.getByText('1,000₮')).toBeInTheDocument();
    expect(screen.getAllByText('24,000₮')).toHaveLength(2);
  });

  it('reads a posted issue with its number, status and recipient', async () => {
    renderApp(
      '/inventory/issues/7',
      signedIn(WAREHOUSE_ME, { ...editorRoutes, 'GET /api/v1/issues/7': () => json(POSTED) }),
    );
    expect(await screen.findByRole('heading', { name: 'GI-2026-000001' })).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.docStatus.POSTED)).toBeInTheDocument();
    const card = await header();
    expect(card.getByText('Бусад · Бат')).toBeInTheDocument();
    expect(card.getByText('Дотоод хэрэглээ')).toBeInTheDocument();
    expect(card.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` })).toBeNull();
    expect(screen.queryByRole('button', { name: issues.cancel })).toBeNull();
  });
});

describe('movement history', () => {
  it('links a goods issue movement to its issue', async () => {
    const movement: Schemas['StockMovement'] = {
      id: 1,
      postedAt: STAMP,
      effectiveDate: '2026-10-18',
      warehouseId: 1,
      binId: SHELF.id,
      binCode: SHELF.code,
      product: { id: COLA.id, sku: COLA.sku, name: COLA.name, baseUnitName: 'ш', thumbUrl: null },
      lotId: null,
      movementType: 'GOODS_ISSUE',
      docType: 'GI',
      docId: 7,
      docNumber: 'GI-2026-000001',
      qtyBase: '-24',
      enteredQty: '1',
      unitName: 'хайрцаг',
      warehouseBalance: null,
      binBalance: null,
    };
    renderApp(
      '/inventory/movements',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/stock/movements': () => list([movement]),
      }),
    );
    expect(await screen.findByRole('link', { name: 'GI-2026-000001' })).toHaveAttribute(
      'href',
      '/inventory/issues/7',
    );
    expect(
      screen.getByRole('option', { name: mn.inventory.movements.docTypes.GI }),
    ).toBeInTheDocument();
  });
});
