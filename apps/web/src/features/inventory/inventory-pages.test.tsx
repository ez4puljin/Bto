import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
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
  warehouses,
  WH1,
} from '@/test/inventory-fixtures';
import { WIDE_SCREEN } from '@/lib/use-media-query';
import { ADMIN_ME, findSidebar, json, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

describe('inventory menu', () => {
  it('shows the warehouse its documents and keeps the shelf setup for admins', async () => {
    renderApp('/system/status', signedIn(WAREHOUSE_ME));
    const nav = await findSidebar();
    expect(within(nav).getByText(mn.nav.groups.inventory)).toBeInTheDocument();
    for (const label of [mn.nav.stock, mn.nav.receipts, mn.nav.binMoves, mn.nav.adjustments]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('link', { name: mn.nav.bins })).toBeNull();
  });

  it('lets an accountant reach stock and receipts but not moves', async () => {
    renderApp('/system/status', signedIn(ACCOUNTANT_ME));
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.receipts })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: mn.nav.binMoves })).toBeNull();
  });
});

describe('stock page', () => {
  const row: Schemas['ProductStock'] = {
    product: { id: COLA.id, sku: COLA.sku, name: COLA.name, baseUnitName: 'ш', thumbUrl: null },
    onHand: '48',
    available: '48',
    warehouses: [
      { warehouseId: 1, onHand: '48', sellableOnHand: '48', reserved: '0', available: '48' },
    ],
  };

  it('hides costs from the warehouse', async () => {
    renderApp(
      '/inventory/stock',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/stock': () => list([row]),
      }),
    );
    expect(await screen.findByRole('link', { name: COLA.name })).toBeInTheDocument();
    expect(screen.getByText('48 ш')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: mn.inventory.stock.value })).toBeNull();
  });

  it('shows values to cost holders and the drift banner to admins', async () => {
    renderApp(
      '/inventory/stock',
      signedIn(ADMIN_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/stock': () =>
          list([
            {
              ...row,
              value: '48000.00',
              warehouses: [{ ...row.warehouses[0]!, avgCost: '1000', value: '48000.00' }],
            },
          ]),
        'GET /api/v1/stock/reconciliation/latest': () =>
          json({
            lastRun: {
              id: 4,
              status: 'DRIFT',
              diffCount: 2,
              diffs: [],
              startedAt: '2026-10-10T18:00:00.000Z',
              triggeredBy: 'NIGHTLY',
            },
          }),
      }),
    );
    // A list shows money with ₮ (ADR-0066).
    expect(await screen.findByText('48,000₮')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: mn.inventory.stock.value }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/2 газар зөрж байна/)).toBeInTheDocument();
  });
});

describe('movement history', () => {
  const PRODUCT = {
    id: COLA.id,
    sku: COLA.sku,
    name: COLA.name,
    baseUnitName: 'ш',
    thumbUrl: null,
  };
  const movement = (
    overrides: Partial<Schemas['StockMovement']> &
      Pick<Schemas['StockMovement'], 'id' | 'movementType' | 'docType' | 'docId' | 'qtyBase'>,
  ): Schemas['StockMovement'] => ({
    postedAt: STAMP,
    effectiveDate: '2026-10-11',
    warehouseId: 1,
    binId: SHELF.id,
    binCode: SHELF.code,
    product: PRODUCT,
    lotId: null,
    docNumber: null,
    enteredQty: overrides.qtyBase.replace('-', ''),
    unitName: 'ш',
    warehouseBalance: null,
    binBalance: null,
    ...overrides,
  });
  const HISTORY = [
    movement({
      id: 4,
      movementType: 'ADJUSTMENT',
      docType: 'ADJ',
      docId: 9,
      docNumber: 'ADJ-2026-000001',
      qtyBase: '-4',
      warehouseBalance: '44',
      binBalance: '44',
    }),
    movement({
      id: 2,
      movementType: 'BIN_MOVE_IN',
      docType: 'BM',
      docId: 3,
      docNumber: 'BM-2026-000001',
      qtyBase: '10',
      warehouseBalance: '48',
      binBalance: '10',
    }),
    movement({
      id: 1,
      movementType: 'RECEIPT',
      docType: 'GR',
      docId: 5,
      docNumber: 'GR-2026-000001',
      qtyBase: '48',
      enteredQty: '2',
      unitName: 'хайрцаг',
      warehouseBalance: '48',
      binBalance: '48',
    }),
  ];
  const DETAIL: Schemas['ProductStockDetail'] = {
    product: PRODUCT,
    onHand: '44',
    available: '44',
    warehouses: [
      { warehouseId: 1, onHand: '44', sellableOnHand: '44', reserved: '0', available: '44' },
    ],
    bins: [
      {
        warehouseId: 1,
        binId: SHELF.id,
        binCode: SHELF.code,
        binType: 'STORAGE',
        sellable: true,
        lotId: null,
        onHand: '44',
      },
    ],
  };

  it('shows a product’s movements with their documents and the stock left after each', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/movements': () => list(HISTORY),
      'GET /api/v1/stock/products/10': () => json(DETAIL),
    });
    renderApp('/inventory/movements?product=10', fetchMock);
    expect(await screen.findByRole('link', { name: 'GR-2026-000001' })).toHaveAttribute(
      'href',
      '/inventory/receipts/5',
    );
    expect(screen.getByRole('link', { name: 'ADJ-2026-000001' })).toHaveAttribute(
      'href',
      '/inventory/adjustments/9',
    );
    expect(screen.getByText('BM-2026-000001').closest('a')).toBeNull();
    const table = within(screen.getByRole('table'));
    for (const text of [
      mn.inventory.movements.types.RECEIPT,
      mn.inventory.movements.types.BIN_MOVE_IN,
      mn.inventory.movements.types.ADJUSTMENT,
      '+48 ш',
      '2 хайрцаг',
      '-4 ш',
      '44',
    ]) {
      expect(table.getAllByText(text).length).toBeGreaterThan(0);
    }
    expect(
      screen.getByRole('columnheader', { name: mn.inventory.movements.columns.warehouseBalance }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: mn.inventory.movements.columns.unitCost }),
    ).toBeNull();
    expect(await screen.findByText(COLA.name, { selector: 'span' })).toBeInTheDocument();
    expect(
      calls(fetchMock, 'GET', '/api/v1/stock/movements').every(
        (request) => new URL(request.url).searchParams.get('productId') === '10',
      ),
    ).toBe(true);
  });

  it('filters by document type through the URL and shows costs to cost holders', async () => {
    // A wide screen (ADR-0119): the costs start shown; a laptop would hide them.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === WIDE_SCREEN,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stock/movements': () =>
        list([
          {
            ...HISTORY[1]!,
            warehouseBalance: null,
            binBalance: null,
            unitCost: '1000',
            value: '10000.00',
          },
        ]),
    });
    const { router } = renderApp('/inventory/movements', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('BM-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('10,000')).toBeInTheDocument();
    expect(
      screen.queryByRole('columnheader', { name: mn.inventory.movements.columns.binBalance }),
    ).toBeNull();
    await user.selectOptions(screen.getByLabelText(mn.inventory.movements.docType), 'BM');
    await waitFor(() => expect(router.state.location.search).toBe('?doc=BM'));
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/stock/movements').some(
          (request) => new URL(request.url).searchParams.get('docType') === 'BM',
        ),
      ).toBe(true),
    );
    // «Баганууд» hides the costs, remembered for this user (a laptop starts without them).
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: mn.inventory.movements.columns.value }),
    );
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('columnheader', { name: mn.inventory.movements.columns.value }),
      ).toBeNull(),
    );
    expect(screen.queryByText('10,000')).toBeNull();
    expect(localStorage.getItem(`tugeel.stockMovements.hiddenColumns.v1:${ACCOUNTANT_ME.id}`)).toBe(
      JSON.stringify(['value']),
    );
    vi.unstubAllGlobals();
  });

  it('opens the history from a product’s stock page and from each of its shelves', async () => {
    renderApp(
      '/inventory/stock/10',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/stock/products/10': () => json(DETAIL),
      }),
    );
    // The menu has an entry with the same name: look in the page.
    const page = within(await screen.findByRole('main'));
    expect(await page.findByRole('link', { name: mn.inventory.movements.history })).toHaveAttribute(
      'href',
      '/inventory/movements?product=10',
    );
    expect(
      screen.getByRole('link', { name: `${mn.inventory.movements.history}: A-01-03` }),
    ).toHaveAttribute('href', '/inventory/movements?product=10&warehouse=1&bin=31');
  });
});

describe('adjustment approval', () => {
  const submitted: Schemas['AdjustmentDetail'] = {
    id: 9,
    number: null,
    warehouseId: 1,
    reason: 'SURPLUS',
    status: 'SUBMITTED',
    note: null,
    submittedAt: STAMP,
    effectiveDate: null,
    postedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    lines: [
      {
        id: 40,
        productId: COLA.id,
        productSku: COLA.sku,
        productName: COLA.name,
        productUnitId: 70,
        unitName: 'ш',
        enteredQty: '10',
        qtyBase: '10',
        binId: SHELF.id,
        binCode: SHELF.code,
        note: null,
      },
    ],
  };

  it('leaves a submitted adjustment to the approver', async () => {
    renderApp(
      '/inventory/adjustments/9',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/adjustments/9': () => json(submitted),
      }),
    );
    expect(await screen.findByText(mn.inventory.reasons.SURPLUS)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.inventory.adjustment.approve })).toBeNull();
    expect(
      screen.getByRole('button', { name: mn.inventory.adjustment.cancel }),
    ).toBeInTheDocument();
  });

  it('lets an admin price found goods and approve them', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/adjustments/9': () => json(submitted),
      'POST /api/v1/adjustments/9/post': () =>
        json({ ...submitted, status: 'POSTED', number: 'ADJ-2026-000001' }),
    });
    renderApp('/inventory/adjustments/9', fetchMock);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('textbox', {
        name: `${mn.inventory.adjustment.unitCost}: ${COLA.name} (ш)`,
      }),
      '1550',
    );
    await user.click(screen.getByRole('button', { name: mn.inventory.adjustment.approve }));
    const dialog = within(await screen.findByRole('dialog'));
    // The approval's main button holds the focus: Enter approves (ADR-0047 #3).
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: mn.inventory.adjustment.approve })).toHaveFocus(),
    );
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/adjustments/9/post')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/adjustments/9/post')[0])).toEqual({
      costs: [{ lineId: 40, unitCost: '1550' }],
    });
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.inventory.adjustment.posted.replace('{{number}}', 'ADJ-2026-000001'),
    );
  });
});

describe('adjustment drafts', () => {
  it('creates a draft in its dialog with the only warehouse chosen and remembers it', async () => {
    const draft: Schemas['AdjustmentDetail'] = {
      id: 12,
      number: null,
      warehouseId: 1,
      reason: 'EXPIRED',
      status: 'DRAFT',
      note: 'Тавиур 3',
      submittedAt: null,
      effectiveDate: null,
      postedAt: null,
      createdAt: STAMP,
      updatedAt: STAMP,
      lines: [],
    };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/adjustments': () => list([]),
      'POST /api/v1/adjustments': () => json(draft, 201),
      'GET /api/v1/adjustments/12': () => json(draft),
    });
    const { router } = renderApp('/inventory/adjustments?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByLabelText(mn.inventory.warehouse)).toHaveValue('1'));
    await user.selectOptions(
      dialog.getByLabelText(mn.inventory.adjustments.reason),
      mn.inventory.reasons.EXPIRED,
    );
    await user.click(dialog.getByLabelText(mn.inventory.note));
    await user.paste('Тавиур 3');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/adjustments/12'));
    const posts = calls(fetchMock, 'POST', '/api/v1/adjustments');
    expect(posts).toHaveLength(1);
    expect(await bodyOf(posts[0])).toEqual({ warehouseId: 1, reason: 'EXPIRED', note: 'Тавиур 3' });
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(JSON.parse(localStorage.getItem('tugeel.inventory.lastWarehouse.v1') ?? '{}')).toEqual({
      '2': { adjustment: 1 },
    });
  });
});

describe('shelf setup', () => {
  it('adds one shelf after another in the dialog', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/bins': () => list([SHELF]),
      'POST /api/v1/bins': () => json({ ...SHELF, id: 40, code: 'A-01-04' }, 201),
    });
    renderApp('/inventory/bins?warehouseId=1&new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.inventory.bins.code), 'A-01-04{Enter}');
    await waitFor(() => expect(calls(fetchMock, 'POST', '/api/v1/bins')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/bins')[0])).toEqual({
      warehouseId: 1,
      code: 'A-01-04',
      type: 'STORAGE',
    });
    // The dialog stays for the next shelf, its code box empty again.
    expect(
      await dialog.findByText(mn.inventory.bins.createdOne.replace('{{code}}', 'A-01-04')),
    ).toBeInTheDocument();
    expect(dialog.getByLabelText(mn.inventory.bins.code)).toHaveValue('');
  });

  it('previews a range of labels before creating it', async () => {
    const codes = Array.from({ length: 30 }, (_, index) => {
      const rack = String(Math.floor(index / 3) + 1).padStart(2, '0');
      return `A-${rack}-0${(index % 3) + 1}`;
    });
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/bins': () => list([SHELF]),
      'POST /api/v1/bins/bulk': async (request) => {
        const body = (await request.clone().json()) as { dryRun?: boolean };
        return json({ codes, existing: ['A-01-03'], created: body.dryRun ? 0 : 29 });
      },
    });
    renderApp('/inventory/bins?warehouseId=1', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.inventory.bins.createTitle }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.click(dialog.getByRole('tab', { name: mn.inventory.bins.rangeTitle }));
    await user.click(dialog.getByRole('button', { name: mn.inventory.bins.preview }));
    expect(await screen.findByText(/30 тавиур: A-01-01 … A-10-03/)).toBeInTheDocument();
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/bins/bulk')[0])).toEqual({
      warehouseId: 1,
      type: 'STORAGE',
      rowFrom: 'A',
      rowTo: 'A',
      rackFrom: 1,
      rackTo: 10,
      levelFrom: 1,
      levelTo: 3,
      dryRun: true,
    });
    await user.click(dialog.getByRole('button', { name: mn.inventory.bins.createRange }));
    expect(await screen.findByText('29 тавиур нэмэгдлээ')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock, 'POST', '/api/v1/bins/bulk')).toHaveLength(2);
  });
});

describe('bin moves', () => {
  it('asks before a warehouse change drops the lines not moved yet', async () => {
    const SECOND: Schemas['Warehouse'] = { ...WH1, id: 2, code: 'WH2', name: 'Хоёр' };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': () => list([WH1, SECOND]),
      'GET /api/v1/bin-moves': () => list([]),
      'GET /api/v1/bins/lookup': (request) => {
        const code = new URL(request.url).searchParams.get('code');
        if (code === 'A-01-03') return json(SHELF);
        if (code === 'A-01-04') return json({ ...SHELF, id: 32, code: 'A-01-04' });
        return problem('NOT_FOUND', 404);
      },
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
    });
    const { router } = renderApp('/inventory/moves?warehouseId=1', fetchMock);
    const user = userEvent.setup();
    const scan = await screen.findByRole('textbox', { name: mn.inventory.scanLabel });
    await user.type(scan, 'A-01-03{Enter}');
    expect(await screen.findByText('A-01-03')).toBeInTheDocument();
    await user.type(scan, '4006381333931{Enter}');
    expect(await screen.findByText(`${COLA.name} (хайрцаг)`)).toBeInTheDocument();
    await user.type(scan, 'A-01-04{Enter}');
    const add = screen.getByRole('button', { name: mn.inventory.moves.addLine });
    await waitFor(() => expect(add).toBeEnabled());
    await user.click(add);
    expect(await screen.findByRole('button', { name: mn.inventory.moves.submit })).toBeEnabled();

    // The line is not moved yet: another warehouse asks first, and «Болих» keeps it.
    const warehouse = screen.getByRole('combobox', { name: mn.inventory.warehouse });
    await user.selectOptions(warehouse, '2');
    const question = await screen.findByRole('dialog', { name: mn.inventory.moves.leaveTitle });
    await user.click(within(question).getByRole('button', { name: mn.common.cancel }));
    expect(router.state.location.search).toBe('?warehouseId=1');
    expect(screen.getByRole('button', { name: mn.inventory.moves.submit })).toBeInTheDocument();
    await user.selectOptions(warehouse, '2');
    await user.click(
      within(await screen.findByRole('dialog', { name: mn.inventory.moves.leaveTitle })).getByRole(
        'button',
        { name: mn.inventory.moves.leave },
      ),
    );
    await waitFor(() => expect(router.state.location.search).toBe('?warehouseId=2'));
    expect(screen.queryByRole('button', { name: mn.inventory.moves.submit })).toBeNull();
  });
});
