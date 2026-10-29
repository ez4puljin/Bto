import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTANT_ME,
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
import { DRAFT, LINE, POSTED, SENT, summary, TYPES } from '@/test/issue-fixtures';
import { ADMIN_ME, findSidebar, json, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
type Detail = Schemas['IssueDetail'];

const issues = mn.inventory.issues;
const COLA_UNIT = `${COLA.name} (хайрцаг)`;

const editorRoutes = {
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/issues/expense-types': () => json(TYPES),
};

const scanBox = () => screen.getByRole('textbox', { name: mn.inventory.scanLabel });
const header = async () => within(await screen.findByRole('region', { name: issues.header }));

describe('goods issues list (ADR-0081, ADR-0117)', () => {
  it('lists issues with their type, recipient and parts, and lets the accountant create one', async () => {
    renderApp(
      '/inventory/issues',
      signedIn(ACCOUNTANT_ME, {
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
    expect(screen.getAllByText('1/1')).toHaveLength(2);
    expect(screen.getByRole('button', { name: mn.common.loadMore })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: issues.create })).toHaveAttribute(
      'href',
      '/inventory/issues/new',
    );
    // Only those who set up the warehouse manage the expense types.
    expect(screen.queryByRole('button', { name: issues.types.open })).toBeNull();
    // The accountant sends issues; the pending filter is the keeper's.
    expect(screen.queryByRole('checkbox', { name: issues.pendingOnly })).toBeNull();
  });

  it('shows the keeper the issues waiting for their confirmation', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/issues': () =>
        list([{ ...summary(3), status: 'SENT', confirmedWarehouseIds: [] }]),
    });
    renderApp('/inventory/issues', fetchMock);
    expect(await screen.findByRole('link', { name: 'GI-2026-000003' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: issues.pendingOnly })).toBeChecked();
    const query = new URL(calls(fetchMock, 'GET', '/api/v1/issues')[0]!.url).searchParams;
    expect(query.get('pending')).toBe('true');
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: issues.create })).toBeNull();
  });

  it('sends the filters to the list', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/issues': () => list([]),
    });
    renderApp('/inventory/issues?status=SENT&type=2', fetchMock);
    expect(await screen.findByText(issues.empty)).toBeInTheDocument();
    const query = new URL(calls(fetchMock, 'GET', '/api/v1/issues')[0]!.url).searchParams;
    expect(query.get('status')).toBe('SENT');
    expect(query.get('expenseTypeId')).toBe('2');
    expect(query.get('pending')).toBeNull();
  });

  it('keeps the menu entry from people who neither send nor confirm issues', async () => {
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
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/issues': () => json(issue, 201),
      'GET /api/v1/issues/7': () => json(issue),
    });
    const { router } = renderApp('/inventory/issues/new', fetchMock);
    const user = userEvent.setup();
    const card = await header();
    await waitFor(() => expect(card.getByLabelText(issues.defaultWarehouse)).toHaveValue('1'));
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
      '3': { issue: 1 },
    });
  }, 20_000);

  it('refuses a date in the future', async () => {
    renderApp('/inventory/issues/new', signedIn(ACCOUNTANT_ME, editorRoutes));
    const user = userEvent.setup();
    const card = await header();
    const date = card.getByLabelText(mn.inventory.date);
    await user.clear(date);
    await user.type(date, '2999-01-01');
    expect(await card.findByText(mn.validation.notFuture)).toBeInTheDocument();
  });

  it('finds a staff member as the recipient and saves the choice on the draft', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(ACCOUNTANT_ME, {
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

  it('shows the type’s account to a reader of the books', async () => {
    renderApp(
      '/inventory/issues/7',
      signedIn(ACCOUNTANT_ME, {
        ...editorRoutes,
        'GET /api/v1/issues/7': () => json(DRAFT),
        'GET /api/v1/finance/issue-expense-accounts': () =>
          json([
            {
              typeId: 1,
              name: 'Дотоод хэрэглээ',
              active: true,
              seeded: true,
              own: true,
              accountId: 21,
              accountCode: '730201',
              accountName: 'Дотоод хэрэгцээний бараа',
            },
          ]),
      }),
    );
    const card = await header();
    expect(await card.findByText('730201 · Дотоод хэрэгцээний бараа')).toBeInTheDocument();
  });
});

describe('sending an issue (ADR-0117 #1)', () => {
  it('sends with Enter and an Idempotency-Key; the keepers take it from there', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(issue),
      'POST /api/v1/issues/7/send': () => {
        issue = SENT;
        return json(issue);
      },
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.send }));
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: issues.send })).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(issues.sent);
    const posts = calls(fetchMock, 'POST', '/api/v1/issues/7/send');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByText(mn.inventory.docStatus.SENT)).toBeInTheDocument();
    // A sent issue is still the accountant's to edit until a keeper confirms a part.
    expect(screen.getByRole('textbox', { name: mn.inventory.scanLabel })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: issues.send })).toBeNull();
    expect(
      screen.getByText(
        issues.confirmations.checked
          .replace('{{warehouse}}', WH1.name)
          .replace('{{checked}}', '0')
          .replace('{{total}}', '1'),
      ),
    ).toBeInTheDocument();
  });

  it('names the product without a sale price in the sending dialog', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () =>
        json({
          ...DRAFT,
          expenseTypeId: 7,
          expenseTypeName: 'Хүнд тооцох',
          expenseTypeCode: 'DAMAGE_CHARGE',
        }),
      'POST /api/v1/issues/7/send': () =>
        problem('PRICE_MISSING', 422, { productId: 10, product: COLA.name, sku: COLA.sku }),
    });
    renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('columnheader', { name: issues.salePrice })).toBeInTheDocument();
    expect(screen.getByText(issues.salePending)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: issues.send }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('button', { name: issues.send }));
    expect(await dialog.findByText(mn.errors.PRICE_MISSING)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cancels a draft and goes back to the list', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
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

  it('shows the keeper’s note on an issue sent back and freezes a confirmed warehouse', async () => {
    const returned: Detail = {
      ...SENT,
      status: 'RETURNED',
      returnNote: 'Ус дутуу байна',
      returnedBy: 'Нярав Дорж',
      returnedAt: STAMP,
      lines: [
        { ...LINE, binId: SHELF.id, binCode: SHELF.code, checkedAt: STAMP },
        { ...LINE, id: 2, productUnitId: 78, warehouseId: 2, warehouseName: 'Хоёр дахь агуулах' },
      ],
      warehouses: [
        { warehouseId: 1, warehouseName: WH1.name, lineCount: 1, checkedCount: 1, confirmed: true },
        {
          warehouseId: 2,
          warehouseName: 'Хоёр дахь агуулах',
          lineCount: 1,
          checkedCount: 0,
          confirmed: false,
        },
      ],
      confirmations: [POSTED.confirmations[0]!],
    };
    renderApp(
      '/inventory/issues/7',
      signedIn(ACCOUNTANT_ME, { ...editorRoutes, 'GET /api/v1/issues/7': () => json(returned) }),
    );
    expect(
      await screen.findByText(
        issues.returnedBanner.replace('{{by}}', 'Нярав Дорж').replace('{{note}}', 'Ус дутуу байна'),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        issues.confirmations.done
          .replace('{{warehouse}}', WH1.name)
          .replace('{{by}}', 'Нярав Дорж'),
      ),
    ).toBeInTheDocument();
    // The confirmed warehouse's line reads only; the other one still takes a quantity.
    expect(
      screen.getAllByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` }),
    ).toHaveLength(1);
    expect(screen.getByLabelText(issues.lockedLine)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: issues.send })).toBeEnabled();
    expect(screen.getByRole('button', { name: issues.cancel })).toBeDisabled();
  });
});

describe('issue lines and costs', () => {
  it('saves a changed quantity, moves a line to another warehouse and removes a line', async () => {
    let issue = DRAFT;
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/warehouses': () =>
        list([WH1, { ...WH1, id: 2, code: 'WH2', name: 'Хоёр дахь агуулах' }]),
      'GET /api/v1/issues/7': () => json(issue),
      'PATCH /api/v1/issue-lines/1': async (request) => {
        const body = (await request.clone().json()) as {
          enteredQty?: string;
          warehouseId?: number;
        };
        issue = {
          ...issue,
          lines: [
            {
              ...LINE,
              ...(body.enteredQty ? { enteredQty: '3', qtyBase: '72' } : {}),
              ...(body.warehouseId ? { warehouseId: 2, warehouseName: 'Хоёр дахь агуулах' } : {}),
            },
          ],
        };
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
    await user.selectOptions(
      screen.getByRole('combobox', { name: issues.moveLineTo.replace('{{product}}', COLA_UNIT) }),
      '2',
    );
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1')).toHaveLength(2));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/issue-lines/1')[1])).toEqual({
      warehouseId: 2,
    });
    await user.click(screen.getByRole('button', { name: `${mn.inventory.remove}: ${COLA_UNIT}` }));
    expect(await screen.findByText(issues.linesEmpty)).toBeInTheDocument();
  }, 15_000);

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
            lines: [{ ...POSTED.lines[0], unitCost: '1000', amount: '24000.00' }],
            total: '24000.00',
          }),
      }),
    );
    expect(await screen.findByRole('columnheader', { name: issues.unitCost })).toBeInTheDocument();
    expect(screen.getByText('1,000₮')).toBeInTheDocument();
    expect(screen.getAllByText('24,000₮')).toHaveLength(2);
  });

  it('reads a posted issue with its number, status, recipient and confirmation', async () => {
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
    expect(screen.queryByRole('button', { name: issues.createCorrection })).toBeNull();
    expect(
      screen.getByText(
        issues.confirmations.done
          .replace('{{warehouse}}', WH1.name)
          .replace('{{by}}', 'Нярав Дорж'),
      ),
    ).toBeInTheDocument();
  });

  it('lets the accountant start a correction of a posted issue (ADR-0117 #5)', async () => {
    const child: Detail = {
      ...DRAFT,
      id: 8,
      correctsIssueId: 7,
      correctsIssueNumber: 'GI-2026-000001',
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...editorRoutes,
      'GET /api/v1/issues/7': () => json(POSTED),
      'GET /api/v1/issues/8': () => json(child),
      'POST /api/v1/issues/7/corrections': () => json(child, 201),
    });
    const { router } = renderApp('/inventory/issues/7', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: issues.createCorrection }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/issues/8'));
    const posts = calls(fetchMock, 'POST', '/api/v1/issues/7/corrections');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByRole('link', {
        name: issues.correctsOf.replace('{{number}}', 'GI-2026-000001'),
      }),
    ).toHaveAttribute('href', '/inventory/issues/7');
    expect(screen.getByText(issues.correctionHint)).toBeInTheDocument();
  });

  it('points the keeper to the confirmation screen of a sent issue', async () => {
    renderApp(
      '/inventory/issues/7',
      signedIn(WAREHOUSE_ME, { ...editorRoutes, 'GET /api/v1/issues/7': () => json(SENT) }),
    );
    expect(await screen.findByRole('link', { name: issues.openConfirm })).toHaveAttribute(
      'href',
      '/inventory/issues/7/confirm',
    );
    expect(screen.queryByRole('textbox', { name: mn.inventory.scanLabel })).toBeNull();
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
