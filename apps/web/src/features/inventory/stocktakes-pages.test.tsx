import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, findSidebar, json, type Me, renderApp, signedIn } from '@/test/render-app';

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
const warehouses = () => list([WH1]);

const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
  writableWarehouseIds: [WH1.id],
};
const ACCOUNTANT_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'nyagtlan',
  fullName: 'Нягтлан Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.ACCOUNTANT],
  roles: [{ id: 5, code: 'ACCOUNTANT', name: null, isSystem: true }],
};

const COLA: Schemas['ProductSummary'] = {
  id: 10,
  sku: '10',
  name: 'Кока кола',
  categoryId: 1,
  status: 'ACTIVE',
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: 70, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
};
const COLA_BOX: Schemas['BarcodeResolution'] = {
  product: COLA,
  unit: { id: 77, uomId: 2, uomName: 'хайрцаг', factorToBase: '24', isBase: false },
  barcode: {
    id: 5,
    code: '4006381333931',
    gtin14: '04006381333931',
    barcodeType: 'GS1',
    isPrimary: true,
    isInternal: false,
  },
};

/** A counter's view of a bin: no line totals, no differences (ADR-0038). */
const BIN_A: Schemas['StocktakeBin'] = {
  id: 31,
  code: 'A-01-01',
  type: 'STORAGE',
  finishedAt: null,
  countedCount: 0,
};
const BIN_B: Schemas['StocktakeBin'] = { ...BIN_A, id: 32, code: 'A-01-02' };
const COUNTING: Schemas['StocktakeDetail'] = {
  id: 5,
  number: null,
  warehouseId: WH1.id,
  status: 'COUNTING',
  note: null,
  startedAt: STAMP,
  effectiveDate: null,
  postedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  bins: [BIN_A, BIN_B],
  countedCount: 0,
};
const COLA_LINE: Schemas['StocktakeLine'] = {
  id: 900,
  binId: BIN_A.id,
  binCode: BIN_A.code,
  productId: COLA.id,
  productSku: COLA.sku,
  productName: COLA.name,
  baseUnitId: 70,
  baseUnitName: 'ш',
  countedQty: '24',
  countedAt: STAMP,
};

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
const bodyOf = async (request: Request | undefined) =>
  request ? ((await request.clone().json()) as unknown) : undefined;

describe('stocktakes menu', () => {
  it('shows stocktakes to the warehouse, not to accountants', async () => {
    renderApp('/system/status', signedIn(WAREHOUSE_ME));
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.stocktakes })).toBeInTheDocument();
  });

  it('keeps the entry from accountants', async () => {
    renderApp('/system/status', signedIn(ACCOUNTANT_ME));
    const nav = await findSidebar();
    expect(within(nav).queryByRole('link', { name: mn.nav.stocktakes })).toBeNull();
  });
});

describe('a new stocktake', () => {
  it('previews the shelves of a code prefix and creates the draft once', async () => {
    const draft: Schemas['StocktakeDetail'] = { ...COUNTING, status: 'DRAFT', startedAt: null };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stocktakes': () => list([]),
      'GET /api/v1/stocktakes/bin-preview': () =>
        json({ binCount: 2, countingCount: 1, firstCode: 'A-01-01', lastCode: 'A-01-02' }),
      'POST /api/v1/stocktakes': () => json(draft, 201),
      'GET /api/v1/stocktakes/5': () => json(draft),
    });
    const { router } = renderApp('/inventory/stocktakes', fetchMock);
    const user = userEvent.setup();
    // The draft is made in a dialog opened from the page header; it lives in the address, so the
    // home page's shortcut (`?new=1`) opens it too (ADR-0042).
    await user.click(await screen.findByRole('button', { name: mn.inventory.stocktake.newTitle }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(router.state.location.search).toBe('?new=1');
    // The worker writes for one warehouse only: it is chosen already.
    const prefix = await dialog.findByRole('textbox', { name: mn.inventory.stocktake.prefix });
    await user.type(prefix, 'a-01');
    expect(await dialog.findByText('2 тавиур: A-01-01 … A-01-02')).toBeInTheDocument();
    expect(
      dialog.getByText('1 нь өөр тооллогод тоологдож байгаа тул эхлүүлэх боломжгүй'),
    ).toBeInTheDocument();
    const preview = calls(fetchMock, 'GET', '/api/v1/stocktakes/bin-preview').at(-1);
    expect(Object.fromEntries(new URL(preview!.url).searchParams)).toEqual({
      warehouseId: '1',
      prefix: 'a-01',
    });

    await user.click(dialog.getByRole('button', { name: mn.inventory.stocktake.createDraft }));
    expect(await screen.findByRole('heading', { name: 'Тооллого №5' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventory/stocktakes/5');
    const created = calls(fetchMock, 'POST', '/api/v1/stocktakes');
    expect(created).toHaveLength(1);
    expect(await bodyOf(created[0])).toEqual({ warehouseId: 1, prefix: 'a-01' });
    expect(created[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(screen.getByRole('button', { name: mn.inventory.stocktake.start })).toBeInTheDocument();
  });
});

describe('counting', () => {
  it('counts a shelf by scanning, never showing what the system expects', async () => {
    let lines: Schemas['StocktakeLine'][] = [];
    let detail = COUNTING;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stocktakes/5': () => json(detail),
      'GET /api/v1/stocktakes/5/lines': () => list(lines),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/stocktakes/5/scan': () => {
        lines = [COLA_LINE];
        return json({
          line: COLA_LINE,
          added: { qty: '1', unitName: 'хайрцаг', qtyBase: '24' },
          bin: { ...BIN_A, countedCount: 1 },
        });
      },
      'POST /api/v1/stocktakes/5/counts': () => {
        lines = [{ ...COLA_LINE, countedQty: '0' }];
        return json({ lines });
      },
      'POST /api/v1/stocktakes/5/bins/31/finish': () => {
        const finished = { ...BIN_A, countedCount: 1, finishedAt: STAMP };
        detail = { ...detail, bins: [finished, BIN_B] };
        return json(finished);
      },
    });
    const { router } = renderApp('/inventory/stocktakes/5', fetchMock);
    const user = userEvent.setup();
    const scan = await screen.findByRole('textbox', { name: mn.inventory.stocktake.scanLabel });
    expect(screen.getByRole('heading', { name: 'Тооллого №5' })).toBeInTheDocument();

    // A product before any shelf: the counter is asked for the shelf first.
    await user.type(scan, '4006381333931{Enter}');
    expect(await screen.findByText(mn.inventory.needBin)).toBeInTheDocument();
    // A shelf of another count is refused on the spot, without asking the server.
    await user.type(scan, 'B-09-09{Enter}');
    expect(await screen.findByText('«B-09-09» тавиур энэ тооллогод ороогүй')).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/bins/lookup')).toHaveLength(0);

    await user.type(scan, 'A-01-01{Enter}');
    expect(await screen.findByText('Тавиур: A-01-01')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?bin=31');
    await user.type(scan, '4006381333931{Enter}');
    expect(
      await screen.findByText('Кока кола: +1 хайрцаг (+24 ш) · нийт 24 ш'),
    ).toBeInTheDocument();
    const scanned = calls(fetchMock, 'POST', '/api/v1/stocktakes/5/scan');
    expect(scanned).toHaveLength(1);
    expect(await bodyOf(scanned[0])).toEqual({ binId: 31, productUnitId: 77, qty: '1' });
    expect(scanned[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    // Blind: neither an expected column nor a difference anywhere.
    expect(screen.queryByText(mn.inventory.stocktake.columns.expected)).toBeNull();
    expect(screen.queryByText(mn.inventory.stocktake.columns.difference)).toBeNull();

    // Nothing was there after all: a typed 0 says what it replaces.
    const count = screen.getByRole('textbox', { name: `Тоо: ${COLA.name}` });
    expect(count).toHaveValue('24');
    await user.clear(count);
    await user.type(count, '0{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/counts')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/counts')[0])).toEqual({
      entries: [{ binId: 31, productId: COLA.id, countedQty: '0', previousQty: '24' }],
    });

    await user.click(screen.getByRole('button', { name: mn.inventory.stocktake.finishBin }));
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('button', { name: mn.inventory.stocktake.finishBin }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/bins/31/finish')).toHaveLength(1),
    );
    // One shelf is left: the stocktake cannot be finished yet.
    expect(
      await screen.findByRole('button', { name: mn.inventory.stocktake.finishCount }),
    ).toBeDisabled();
    expect(screen.getByText('1 тавиур дуусаагүй')).toBeInTheDocument();
  });

  it('shows the counter only a waiting note while the count is reviewed', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stocktakes/5': () =>
        json({ ...COUNTING, status: 'REVIEW', bins: [{ ...BIN_A, finishedAt: STAMP }] }),
    });
    renderApp('/inventory/stocktakes/5', fetchMock);
    expect(await screen.findByText(mn.inventory.stocktake.waiting)).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/stocktakes/5/lines')).toHaveLength(0);
  });
});

describe('review', () => {
  const REVIEW: Schemas['StocktakeDetail'] = {
    ...COUNTING,
    status: 'REVIEW',
    bins: [
      { ...BIN_A, finishedAt: STAMP, countedCount: 2, lineCount: 2, differenceCount: 2 },
      { ...BIN_B, finishedAt: STAMP, countedCount: 0, lineCount: 0, differenceCount: 0 },
    ],
    countedCount: 2,
    lineCount: 2,
    differenceCount: 2,
    shortageValue: '4000',
    surplusValue: '3000',
  };
  const SHORT: Schemas['StocktakeLine'] = {
    ...COLA_LINE,
    countedQty: '20',
    expectedQty: '24',
    difference: '-4',
    unitCost: null,
    avgCost: '1000',
  };
  const FOUND: Schemas['StocktakeLine'] = {
    ...COLA_LINE,
    id: 901,
    productId: 11,
    productSku: '11',
    productName: 'Ус',
    countedQty: '3',
    expectedQty: '0',
    difference: '3',
    unitCost: null,
    avgCost: '1000',
  };

  it('lets the approver cost a surplus, approve once and send a shelf back', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/stocktakes/5': () => json(REVIEW),
      'GET /api/v1/stocktakes/5/lines': () => list([SHORT, FOUND]),
      'POST /api/v1/stocktakes/5/approve': () =>
        json({ ...REVIEW, status: 'APPROVED', number: 'ST-2026-000001' }),
      'POST /api/v1/stocktakes/5/recount': () => json({ ...REVIEW, status: 'COUNTING' }),
    });
    renderApp('/inventory/stocktakes/5', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('Дутагдал: 4,000 ₮')).toBeInTheDocument();
    expect(screen.getByText('Илүүдэл: 3,000 ₮')).toBeInTheDocument();
    const differences = calls(fetchMock, 'GET', '/api/v1/stocktakes/5/lines')[0];
    expect(new URL(differences!.url).searchParams.get('differences')).toBe('true');
    expect(await screen.findByText('-4 ш')).toBeInTheDocument();
    expect(screen.getByText('+3 ш')).toBeInTheDocument();
    // Only the surplus takes a cost.
    expect(screen.getAllByPlaceholderText(mn.inventory.stocktake.unitCostHint)).toHaveLength(1);
    await user.type(screen.getByRole('textbox', { name: 'Илүүдлийн өртөг: A-01-01 Ус' }), '700');

    await user.click(screen.getByRole('button', { name: mn.inventory.stocktake.recount }));
    let dialog = await screen.findByRole('dialog');
    // The shelf with differences is chosen already.
    expect(within(dialog).getByRole('checkbox', { name: 'A-01-01: 2 зөрүү' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'A-01-02: 0 зөрүү' })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: mn.inventory.stocktake.recount }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/recount')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/recount')[0])).toEqual({
      binIds: [31],
    });

    await user.click(screen.getByRole('button', { name: mn.inventory.stocktake.approve }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.inventory.stocktake.approve }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/stocktakes/5/approve')).toHaveLength(1),
    );
    const approved = calls(fetchMock, 'POST', '/api/v1/stocktakes/5/approve')[0];
    expect(await bodyOf(approved)).toEqual({ costs: [{ lineId: 901, unitCost: '700' }] });
    expect(approved!.headers.get('Idempotency-Key')).toMatch(UUID);
  });
});
