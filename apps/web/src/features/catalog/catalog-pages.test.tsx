import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import { PRODUCT_LIST_COLUMNS } from '@tugeel/shared/catalog';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ME,
  findSidebar,
  json,
  problem,
  renderApp,
  signedIn,
  WORKER_ME,
} from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-01T02:00:00.000Z';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });
/** A page of `POST /products/query`: the total comes with the first page only. */
const queryPage = <T,>(
  data: T[],
  nextCursor: string | null = null,
  total: number | null = data.length,
) => json({ data, nextCursor, total });
/** The JSON body a request sent, read from a copy so its handler may read it too. */
const sent = async (request: Request) => (await request.clone().json()) as Record<string, unknown>;
/** A valid EAN-13 from its first twelve digits. */
const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const UOMS: Schemas['Uom'][] = [
  { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  { id: 2, code: 'BLOCK', name: 'блок', fractional: false, measureUnit: null },
  { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false, measureUnit: null },
  { id: 4, code: 'KG', name: 'кг', fractional: true, measureUnit: null },
];
const CATEGORIES: Schemas['Category'][] = [
  {
    id: 10,
    parentId: null,
    name: 'Хүнс',
    defaultClassificationCode: null,
    skuFrom: null,
    skuTo: null,
    productCount: 0,
    childCount: 1,
    imageUrl: null,
  },
  {
    id: 11,
    parentId: 10,
    name: 'Гурил',
    defaultClassificationCode: '2111100',
    skuFrom: null,
    skuTo: null,
    productCount: 2,
    childCount: 0,
    imageUrl: null,
  },
  {
    id: 12,
    parentId: null,
    name: 'Ундаа',
    defaultClassificationCode: null,
    skuFrom: null,
    skuTo: null,
    productCount: 1,
    childCount: 0,
    imageUrl: null,
  },
];
const MASTER_ROUTES = {
  'GET /api/v1/uoms': () => list(UOMS),
  'GET /api/v1/categories': () => list(CATEGORIES),
};

const summary = (id: number, sku: string, name: string): Schemas['ProductSummary'] => ({
  id,
  sku,
  name,
  categoryId: 12,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: id * 10, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
});
const COLA_CODE = ean('544900000099');
const unit = (
  overrides: Partial<Schemas['ProductUnit']> & Pick<Schemas['ProductUnit'], 'id' | 'uomId'>,
): Schemas['ProductUnit'] => ({
  uomName: UOMS.find((uom) => uom.id === overrides.uomId)?.name ?? '',
  uomCode: UOMS.find((uom) => uom.id === overrides.uomId)?.code ?? null,
  fractional: false,
  factorToBase: '1',
  isBase: false,
  isDefaultSales: false,
  isDefaultPurchase: false,
  measureUnit: null,
  effectiveMeasureUnit: null,
  supersededBy: null,
  supersededAt: null,
  barcodes: [],
  ...overrides,
});
const COLA: Schemas['ProductDetail'] = {
  id: 7,
  sku: '10023',
  name: 'Кока кола 0.5 л',
  categoryId: 12,
  vatType: 'VAT_ABLE',
  cityTax: null,
  classificationCode: null,
  taxProductCode: null,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  tracksLots: false,
  weightKg: '0.55',
  createdAt: STAMP,
  updatedAt: STAMP,
  units: [
    unit({
      id: 70,
      uomId: 1,
      isBase: true,
      barcodes: [
        {
          id: 700,
          code: COLA_CODE,
          gtin14: `0${COLA_CODE}`,
          barcodeType: 'GS1',
          isPrimary: true,
          isInternal: false,
        },
      ],
    }),
    unit({ id: 71, uomId: 3, factorToBase: '24', isDefaultSales: true, isDefaultPurchase: true }),
    unit({ id: 69, uomId: 3, factorToBase: '12', supersededBy: 71, supersededAt: STAMP }),
  ],
  images: [],
};

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
/** The accessible name of a unit's «⋯» menu button. */
const unitMenu = (unitName: string) => mn.catalog.units.menu.replace('{{unit}}', unitName);

describe('catalog menu and access', () => {
  it('shows the catalog menu to every user, the e-Barimt page to its managers only', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    const nav = await findSidebar();
    for (const label of [mn.nav.products, mn.nav.categories, mn.nav.uoms]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('link', { name: mn.nav.ebarimt })).toBeNull();
    // The group label and its first entry are both «Бараа».
    expect(within(nav).getAllByText(mn.nav.groups.catalog)).toHaveLength(2);
  });

  it('opens the menu on a phone with the menu button', async () => {
    renderApp('/system/status', signedIn(ADMIN_ME));
    const toggle = await screen.findByRole('button', { name: mn.nav.menu });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

const listItem = (
  id: number,
  sku: string,
  name: string,
  overrides: Partial<Schemas['ProductListItem']> = {},
): Schemas['ProductListItem'] => ({
  ...summary(id, sku, name),
  weightKg: null,
  classificationCode: null,
  taxProductCode: null,
  units: [{ id: id * 10, uomId: 1, uomName: 'ш', factorToBase: '1', isBase: true, barcodes: [] }],
  ...overrides,
});
const WH: Schemas['Warehouse'] = {
  id: 4,
  code: 'WH1',
  name: 'Бөөний агуулах',
  kind: 'WHOLESALE',
  branchId: 1,
  status: 'ACTIVE',
  createdAt: STAMP,
  updatedAt: STAMP,
};
const COLA_ROW = listItem(1, '10001', 'Кока кола', {
  cityTax: false,
  weightKg: '0.55',
  classificationCode: '2211100',
  units: [
    { id: 10, uomId: 1, uomName: 'ш', factorToBase: '1', isBase: true, barcodes: [COLA_CODE] },
    {
      id: 11,
      uomId: 3,
      uomName: 'хайрцаг',
      factorToBase: '24',
      isBase: false,
      barcodes: ['BOX-1'],
    },
  ],
});
const supplierLink = (
  id: number,
  productId: number,
  name: string,
  isMain: boolean,
): Schemas['ProductSupplierLink'] => ({
  id,
  productId,
  isMain,
  supplier: { id: id + 100, code: String(id), name, status: 'ACTIVE' },
});
const LIST_ROUTES = {
  ...MASTER_ROUTES,
  'GET /api/v1/warehouses': () => list([WH]),
  'GET /api/v1/product-suppliers': () => list([]),
  'GET /api/v1/product-locations': () => list([]),
  'GET /api/v1/product-prices/current': () => json([]),
};
/** The column choice every user of a browser shared before ADR-0050, and the admin's own. */
const SHARED_COLUMNS_KEY = 'tugeel.catalog.products.hiddenColumns.v1';
const HIDDEN_COLUMNS_KEY = `${SHARED_COLUMNS_KEY}:${ADMIN_ME.id}`;
const idsOf = (request: Request) => new URL(request.url).searchParams.getAll('productIds');
const columnHeader = (key: keyof typeof mn.catalog.products.columns) =>
  screen.queryByRole('columnheader', { name: mn.catalog.products.columns[key] });
/** A hand-picked product segment (ADR-0052). */
const LIST_SEGMENT: Schemas['Segment'] = {
  id: 20,
  entity: 'PRODUCT',
  kind: 'LIST',
  name: 'Түмний бараа',
  description: null,
  definition: null,
  appRank: null,
  appShownCount: null,
  createdAt: STAMP,
  updatedAt: STAMP,
};

describe('products list', () => {
  it('searches, keeps the search in the URL and loads the next page', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': async (request) => {
        const body = await sent(request);
        if (body.cursor === 'page-2') return queryPage([listItem(2, '10002', 'Фанта')], null, null);
        if (body.q === 'coca') return queryPage([listItem(1, '10001', 'Кока кола')]);
        return queryPage([listItem(1, '10001', 'Кока кола')], 'page-2', 2);
      },
    });
    const { router } = renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'Кока кола' })).toHaveAttribute(
      'href',
      '/catalog/products/1',
    );
    expect(screen.getAllByText('Ундаа').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: mn.common.loadMore }));
    expect(await screen.findByRole('link', { name: 'Фанта' })).toBeInTheDocument();
    // Each page reads the suppliers and prices of its own products, once; the locations' columns
    // are hidden until a user shows them (ADR-0066), so no page reads them.
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/product-suppliers').map(idsOf)).toEqual([
        ['1'],
        ['2'],
      ]),
    );
    expect(calls(fetchMock, 'GET', '/api/v1/product-prices/current').map(idsOf)).toEqual([
      ['1'],
      ['2'],
    ]);
    expect(calls(fetchMock, 'GET', '/api/v1/product-locations')).toHaveLength(0);

    await user.type(screen.getByRole('searchbox', { name: mn.common.search }), 'coca');
    await waitFor(() => expect(router.state.location.search).toBe('?q=coca'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Фанта' })).toBeNull());
    const bodies = await Promise.all(calls(fetchMock, 'POST', '/api/v1/products/query').map(sent));
    expect(bodies.some((body) => body.q === 'coca')).toBe(true);
  });

  it('filters the products waiting for their prices and marks them', async () => {
    const waiting = listItem(3, '10003', 'Шинэ ус', { saleReadyAt: null });
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([waiting]),
    });
    renderApp('/catalog/products?status=PENDING', fetchMock);
    const table = await screen.findByRole('table');
    expect(await within(table).findByText(mn.catalog.products.status.PENDING)).toBeInTheDocument();
    const [request] = calls(fetchMock, 'POST', '/api/v1/products/query');
    const body = request ? await sent(request) : {};
    expect([body.status, body.saleReady]).toEqual(['ACTIVE', false]);
  });

  it('filters with «Шүүлтүүр», counts the products and keeps the filters in the URL', async () => {
    const supplierRow = (id: number, name: string): Schemas['SupplierListItem'] => ({
      id,
      code: String(id),
      name,
      tin: null,
      phone: null,
      vatPayer: false,
      status: 'ACTIVE',
      regNo: null,
      email: null,
      address: null,
      bankName: null,
      bankAccount: null,
      paymentTermDays: null,
      note: null,
      contact: null,
      productCount: 1,
    });
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/suppliers': (request) =>
        new URL(request.url).searchParams.getAll('ids').length > 0
          ? list([supplierRow(7, 'МСМ ХХК')])
          : list([supplierRow(7, 'МСМ ХХК'), supplierRow(8, 'АПУ ХК')]),
      'POST /api/v1/products/query': () => queryPage([COLA_ROW], null, 1751),
    });
    const { router } = renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(
      screen.getByText(mn.catalog.products.count.replace('{{total}}', '1,751')),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.catalog.products.filters.menu }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.filters.fields.supplier }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.click(
      within(dialog).getByRole('tab', { name: mn.catalog.products.filters.supplierModes.MAIN_IN }),
    );
    await user.click(await within(dialog).findByRole('checkbox', { name: 'МСМ ХХК' }));
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.filters.apply }),
    );
    await waitFor(() => expect(router.state.location.search).toBe('?supplier=main%3A7'));
    const chipName = `${mn.catalog.products.filters.supplierModes.MAIN_IN}: МСМ ХХК`;
    expect(await screen.findByRole('button', { name: chipName })).toBeInTheDocument();
    await waitFor(async () => {
      const bodies = await Promise.all(
        calls(fetchMock, 'POST', '/api/v1/products/query').map(sent),
      );
      expect(bodies.at(-1)).toMatchObject({
        where: {
          match: 'ALL',
          groups: [{ match: 'ALL', conditions: [{ field: 'supplier', op: 'MAIN_IN', ids: [7] }] }],
        },
      });
    });

    // The chip opens its dialog again; its button removes the filter.
    await user.click(screen.getByRole('button', { name: chipName }));
    expect(
      within(await screen.findByRole('dialog')).getByRole('checkbox', { name: 'МСМ ХХК' }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: mn.common.cancel }));
    await user.click(
      screen.getByRole('button', {
        name: mn.catalog.products.filters.clear.replace(
          '{{name}}',
          mn.catalog.products.filters.supplierModes.MAIN_IN,
        ),
      }),
    );
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('reads the filters of a shared link, names them and clears them all', async () => {
    const segment: Schemas['Segment'] = {
      id: 5,
      entity: 'PRODUCT',
      kind: 'RULES',
      name: 'Ундааны бараа',
      description: null,
      definition: { match: 'ALL', groups: [] },
      appRank: null,
      appShownCount: null,
      createdAt: STAMP,
      updatedAt: STAMP,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/segments': () => list([segment]),
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
    });
    const { router } = renderApp(
      '/catalog/products?segment=5&stock=out&price=1000~&created=30d&missing=photo,price',
      fetchMock,
    );
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    const filters = mn.catalog.products.filters;
    for (const name of [
      `${filters.fields.segment}: Ундааны бараа`,
      `${filters.fields.stock}: ${filters.stockKinds.out}`,
      `${filters.fields.price}: ≥ 1,000₮`,
      `${filters.fields.created}: ${filters.lastDays.replace('{{count}}', '30')}`,
      `${filters.fields.missing}: ${mn.segments.missing.PHOTO}, ${filters.missingNone.price}`,
    ]) {
      expect(await screen.findByRole('button', { name })).toBeInTheDocument();
    }
    const [request] = calls(fetchMock, 'POST', '/api/v1/products/query');
    expect(request ? await sent(request) : {}).toMatchObject({
      segmentId: 5,
      where: {
        match: 'ALL',
        groups: [
          {
            match: 'ALL',
            conditions: [
              { field: 'warehousePrice', op: 'BETWEEN', min: '1000' },
              { field: 'stock', op: 'OUT_OF_STOCK' },
              { field: 'createdAt', op: 'LAST_DAYS', days: 30 },
            ],
          },
          {
            match: 'ANY',
            conditions: [
              { field: 'missing', op: 'IS', values: ['PHOTO'] },
              { field: 'priceProfile', op: 'NONE' },
            ],
          },
        ],
      },
    });
    await user.click(screen.getByRole('button', { name: filters.clearAll }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('checks a price range before filtering by it', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
    });
    const { router } = renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(screen.getByRole('button', { name: mn.catalog.products.filters.menu }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.filters.fields.price }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(mn.catalog.products.filters.minPrice), '5000');
    await user.type(within(dialog).getByLabelText(mn.catalog.products.filters.maxPrice), '1,000');
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.filters.apply }),
    );
    expect(within(dialog).getByRole('alert')).toHaveTextContent(mn.segments.issues.MONEY_ORDER);
    await user.clear(within(dialog).getByLabelText(mn.catalog.products.filters.minPrice));
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.filters.apply }),
    );
    await waitFor(() => expect(router.state.location.search).toBe('?price=%7E1000'));
  });

  it('ticks rows and writes the ticked ones, or every filtered one, to Excel', async () => {
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(['weight']));
    const fanta = listItem(2, '10002', 'Фанта');
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW, fanta]),
      'POST /api/v1/exports/products': () =>
        new Response(new Blob(['xlsx']), {
          headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        }),
    });
    URL.createObjectURL = vi.fn(() => 'blob:export');
    URL.revokeObjectURL = vi.fn();
    const saved: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      saved.push(this.download);
    });
    const { router } = renderApp('/catalog/products?status=PENDING', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Фанта' });
    const exports = () => calls(fetchMock, 'POST', '/api/v1/exports/products');
    const visible = PRODUCT_LIST_COLUMNS.filter((key) => key !== 'image' && key !== 'weight');

    // Nothing ticked: every product the filters keep, with the visible columns.
    await user.click(screen.getByRole('button', { name: mn.catalog.products.export.button }));
    await waitFor(() => expect(exports()).toHaveLength(1));
    expect(await sent(exports()[0] as Request)).toEqual({
      status: 'ACTIVE',
      saleReady: false,
      columns: visible,
    });
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatch(/\.xlsx$/);

    // A tick beside the box does not open the product; the bar counts and exports the ticked rows.
    await user.click(
      screen.getByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10002'),
      }),
    );
    expect(router.state.location.pathname).toBe('/catalog/products');
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '1'));
    expect(screen.getAllByRole('button', { name: mn.catalog.products.export.button })).toHaveLength(
      1,
    );
    await user.click(within(bar).getByRole('button', { name: mn.catalog.products.export.button }));
    await waitFor(() => expect(exports()).toHaveLength(2));
    expect(await sent(exports()[1] as Request)).toEqual({ productIds: [2], columns: visible });

    // «Бүгдийг сонгох» ticks every loaded row, again clears them.
    const all = screen.getByRole('checkbox', { name: mn.common.selectAll });
    expect(all).toHaveAttribute('data-state', 'indeterminate');
    await user.click(all);
    expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '2'));
    await user.click(all);
    expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull();

    // A new filter keeps the ticks (ADR-0052): the ticks of several searches go together.
    await user.click(
      screen.getByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10001'),
      }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: mn.catalog.product.status }), '');
    await waitFor(() => expect(router.state.location.search).toBe(''));
    expect(screen.getByRole('region', { name: mn.common.selection })).toHaveTextContent(
      mn.common.selected.replace('{{count}}', '1'),
    );
  });

  it('keeps the ticks of several searches through a reload, for each user apart', async () => {
    const fanta = listItem(2, '10002', 'Фанта');
    const routes = {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': async (request: Request) =>
        queryPage((await sent(request)).q === 'фанта' ? [fanta] : [COLA_ROW]),
    };
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    const tick = async (sku: string) =>
      user.click(
        await screen.findByRole('checkbox', { name: mn.common.selectRow.replace('{{name}}', sku) }),
      );
    const bar = () => screen.getByRole('region', { name: mn.common.selection });
    await tick('10001');
    await user.type(screen.getByRole('searchbox', { name: mn.common.search }), 'фанта');
    await tick('10002');
    expect(bar()).toHaveTextContent(mn.common.selected.replace('{{count}}', '2'));

    // A reload (or «back» from a product opened by mistake) keeps them.
    cleanup();
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(bar()).toHaveTextContent(mn.common.selected.replace('{{count}}', '2'));
    expect(
      screen.getByRole('checkbox', { name: mn.common.selectRow.replace('{{name}}', '10001') }),
    ).toBeChecked();

    // Another user signed in to the tab starts with none.
    cleanup();
    renderApp('/catalog/products', signedIn({ ...ADMIN_ME, id: 9 }, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull();
  });

  it('ticks every product the filters keep beyond the loaded rows, never past 20,000', async () => {
    const fanta = listItem(2, '10002', 'Фанта');
    let total = 3;
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW, fanta], 'page-2', total),
      'POST /api/v1/products/query/ids': () => json({ ids: [1, 2, 3] }),
    });
    renderApp('/catalog/products?q=кола', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Фанта' });
    const header = () => screen.getByRole('checkbox', { name: mn.common.selectAll });
    await user.click(header());
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '2'));
    await user.click(
      within(bar).getByRole('button', {
        name: mn.catalog.products.selection.allMatching.replace('{{total}}', '3'),
      }),
    );
    await waitFor(() =>
      expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '3')),
    );
    expect(bar).toHaveTextContent(
      mn.catalog.products.selection.allMatchingDone.replace('{{total}}', '3'),
    );
    // The list's filters without a page.
    const [request] = calls(fetchMock, 'POST', '/api/v1/products/query/ids');
    expect(request ? await sent(request) : {}).toEqual({ q: 'кола' });
    // Unticking the header unticks every match, the one not loaded too.
    await user.click(header());
    expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull();

    // Past the limit there is nothing to click, only the reason.
    total = 20_001;
    cleanup();
    renderApp('/catalog/products', fetchMock);
    await screen.findByRole('link', { name: 'Фанта' });
    await user.click(header());
    expect(screen.getByRole('region', { name: mn.common.selection })).toHaveTextContent(
      mn.catalog.products.selection.tooMany
        .replace('{{total}}', '20,001')
        .replace('{{limit}}', '20,000'),
    );
    expect(screen.queryByRole('button', { name: /^Таарсан бүгдийг сонгох/ })).toBeNull();
    expect(calls(fetchMock, 'POST', '/api/v1/products/query/ids')).toHaveLength(1);
  });

  it('only explains the limit when more than 500 ticked products are to change', async () => {
    const ticked = Array.from({ length: 501 }, (_, index) => index + 1);
    sessionStorage.setItem(
      `tugeel.catalog.products.selection.v1:${ADMIN_ME.id}`,
      JSON.stringify(ticked),
    );
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '501'));
    await user.click(within(bar).getByRole('button', { name: mn.catalog.products.bulk.edit }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.bulk.actions.category }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      mn.catalog.products.bulk.tooMany.replace('{{limit}}', '500').replace('{{total}}', '501'),
    );
    expect(within(dialog).queryByRole('button', { name: mn.common.save })).toBeNull();
    await user.click(within(dialog).getAllByRole('button', { name: mn.common.close })[0]!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock, 'POST', '/api/v1/products/bulk/category')).toHaveLength(0);
  });

  it('starts without ticks from broken storage and keeps ticking when storage refuses', async () => {
    const key = `tugeel.catalog.products.selection.v1:${ADMIN_ME.id}`;
    sessionStorage.setItem(key, 'not json');
    const routes = {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
    };
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull();
    // Ids that are not products' ids are dropped.
    sessionStorage.setItem(key, JSON.stringify([1, -2, 'x', 1.5]));
    cleanup();
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(screen.getByRole('region', { name: mn.common.selection })).toHaveTextContent(
      mn.common.selected.replace('{{count}}', '1'),
    );
    // Storage that refuses writes: the ticks last while the page is open.
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    await user.click(screen.getByRole('button', { name: mn.common.clearSelection }));
    expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull();
    await user.click(
      screen.getByRole('checkbox', { name: mn.common.selectRow.replace('{{name}}', '10001') }),
    );
    expect(screen.getByRole('region', { name: mn.common.selection })).toBeInTheDocument();
    vi.restoreAllMocks();
  });

  it('offers neither ticks nor Excel without the export right', async () => {
    renderApp(
      '/catalog/products',
      signedIn(WORKER_ME, {
        ...LIST_ROUTES,
        'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
      }),
    );
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.products.export.button })).toBeNull();
  });

  it('makes a segment of the ticks of two searches (ADR-0052)', async () => {
    const fanta = listItem(2, '10002', 'Фанта');
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/segments': () => list([]),
      'POST /api/v1/products/query': async (request) =>
        queryPage((await sent(request)).q === 'фанта' ? [fanta] : [COLA_ROW]),
      'POST /api/v1/segments/lists': async (request) =>
        json({ ...LIST_SEGMENT, id: 21, ...(await sent(request)) }, 201),
      'GET /api/v1/segments/21': () => json({ ...LIST_SEGMENT, id: 21 }),
      'GET /api/v1/segments/counts': () => json([{ segmentId: 21, count: 2 }]),
    });
    const { router } = renderApp('/catalog/products?q=кока', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('checkbox', { name: mn.common.selectAll }));
    const search = screen.getByRole('searchbox', { name: mn.common.search });
    await user.clear(search);
    await user.type(search, 'фанта');
    await user.click(
      await screen.findByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10002'),
      }),
    );
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(bar).toHaveTextContent(mn.common.selected.replace('{{count}}', '2'));
    await user.click(within(bar).getByRole('button', { name: mn.segments.list.menu }));
    await user.click(await screen.findByRole('menuitem', { name: mn.segments.list.create }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(mn.segments.list.count.replace('{{total}}', '2'));
    await user.type(within(dialog).getByLabelText(mn.segments.name), 'Түмний ба Хараа');
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/segments/21'));
    expect(await screen.findByRole('status')).toHaveTextContent(mn.segments.list.created);
    const [request] = calls(fetchMock, 'POST', '/api/v1/segments/lists');
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(request ? await sent(request) : {}).toEqual({
      name: 'Түмний ба Хараа',
      description: null,
      productIds: [1, 2],
    });
    // The ticks went into the segment.
    expect(
      sessionStorage.getItem(`tugeel.catalog.products.selection.v1:${ADMIN_ME.id}`),
    ).toBeNull();
  });

  it('adds ticked products to a hand-picked segment and takes them out of the one shown', async () => {
    const rules: Schemas['Segment'] = {
      ...LIST_SEGMENT,
      id: 30,
      kind: 'RULES',
      name: 'Ундаа',
      definition: { match: 'ALL', groups: [] },
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/segments': () => list([rules, LIST_SEGMENT]),
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
      'POST /api/v1/segments/20/products': () => json({ changed: 0, unchanged: 1, count: 5 }),
      'POST /api/v1/segments/20/products/remove': () =>
        json({ changed: 1, unchanged: 0, count: 4 }),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10001'),
      }),
    );
    const bar = screen.getByRole('region', { name: mn.common.selection });
    await user.click(within(bar).getByRole('button', { name: mn.segments.list.menu }));
    // Not filtered by a hand-picked segment: nothing to take out of.
    expect(screen.queryByRole('menuitem', { name: mn.segments.list.remove })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: mn.segments.list.add }));
    const dialog = await screen.findByRole('dialog');
    const choice = within(dialog).getByLabelText(mn.segments.list.segment);
    // Only hand-picked segments are offered.
    expect(
      within(choice)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([mn.segments.list.chooseSegment, LIST_SEGMENT.name]);
    await user.selectOptions(choice, '20');
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      `${mn.segments.list.added.replace('{{changed}}', '0')}. ${mn.segments.list.alreadyIn.replace('{{unchanged}}', '1')}`,
    );
    const [added] = calls(fetchMock, 'POST', '/api/v1/segments/20/products');
    expect(added ? await sent(added) : {}).toEqual({ productIds: [1] });

    // Filtered by the segment, the menu takes ticked products out of it, after a question.
    cleanup();
    renderApp('/catalog/products?segment=20', fetchMock);
    await user.click(
      await screen.findByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10001'),
      }),
    );
    // The sidebar's «Сегмент» group is a button too: the menu is the selection bar's.
    const shownBar = screen.getByRole('region', { name: mn.common.selection });
    await user.click(within(shownBar).getByRole('button', { name: mn.segments.list.menu }));
    await user.click(await screen.findByRole('menuitem', { name: mn.segments.list.remove }));
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent(mn.segments.list.removeTitle.replace('{{total}}', '1'));
    await user.click(within(confirm).getByRole('button', { name: mn.segments.list.remove }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.segments.list.removed.replace('{{changed}}', '1'),
    );
    expect(calls(fetchMock, 'POST', '/api/v1/segments/20/products/remove')).toHaveLength(1);
  });

  it('lets an admin of segments tick rows, and hides the segment menu from others', async () => {
    renderApp(
      '/catalog/products',
      signedIn(
        { ...WORKER_ME, permissions: ['segments.manage'] },
        {
          ...LIST_ROUTES,
          'GET /api/v1/segments': () => list([]),
          'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
        },
      ),
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10001'),
      }),
    );
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(within(bar).getByRole('button', { name: mn.segments.list.menu })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: mn.catalog.products.bulk.edit })).toBeNull();

    // Someone else (ticks are kept per user) who may only export: no segment menu.
    cleanup();
    renderApp(
      '/catalog/products',
      signedIn(
        { ...WORKER_ME, id: 3, permissions: ['catalog.products.export'] },
        { ...LIST_ROUTES, 'POST /api/v1/products/query': () => queryPage([COLA_ROW]) },
      ),
    );
    await user.click(
      await screen.findByRole('checkbox', {
        name: mn.common.selectRow.replace('{{name}}', '10001'),
      }),
    );
    expect(
      within(screen.getByRole('region', { name: mn.common.selection })).queryByRole('button', {
        name: mn.segments.list.menu,
      }),
    ).toBeNull();
  });

  it('moves ticked products to another category and clears the ticks', async () => {
    const fanta = listItem(2, '10002', 'Фанта');
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW, fanta]),
      'POST /api/v1/products/bulk/category': () => json({ changed: [1], unchanged: [2] }),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Фанта' });
    await user.click(screen.getByRole('checkbox', { name: mn.common.selectAll }));
    const bar = screen.getByRole('region', { name: mn.common.selection });
    await user.click(within(bar).getByRole('button', { name: mn.catalog.products.bulk.edit }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.bulk.actions.category }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(mn.catalog.products.bulk.count.replace('{{count}}', '2'));
    await user.selectOptions(
      within(dialog).getByLabelText(mn.catalog.products.bulk.category),
      '11',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      `${mn.catalog.products.bulk.done.replace('{{count}}', '1')}. ${mn.catalog.products.bulk.same.replace('{{count}}', '1')}`,
    );
    const [request] = calls(fetchMock, 'POST', '/api/v1/products/bulk/category');
    expect(request?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(request ? await sent(request) : {}).toEqual({ productIds: [1, 2], categoryId: 11 });
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: mn.common.selection })).toBeNull(),
    );
  });

  it('names the products holding stock elsewhere before moving their home', async () => {
    const fanta = listItem(2, '10002', 'Фанта');
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/warehouses': () =>
        list([WH, { ...WH, id: 5, code: 'WH2', name: 'Шинэ агуулах' }]),
      'POST /api/v1/products/query': () => queryPage([COLA_ROW, fanta]),
      'POST /api/v1/product-locations/bulk/home': () =>
        json({ changed: [1, 2], unchanged: [], withStock: [{ productId: 1, warehouseId: 4 }] }),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Фанта' });
    await user.click(screen.getByRole('checkbox', { name: mn.common.selectAll }));
    await user.click(screen.getByRole('button', { name: mn.catalog.products.bulk.edit }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.bulk.actions.home }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(mn.catalog.products.bulk.warehouse),
      '5',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    const warning = await within(dialog).findByRole('alert');
    expect(warning).toHaveTextContent(mn.catalog.products.bulk.withStock.replace('{{count}}', '1'));
    expect(warning).toHaveTextContent('10001 Кока кола');
    const requests = () => calls(fetchMock, 'POST', '/api/v1/product-locations/bulk/home');
    expect(requests()).toHaveLength(1);
    expect(await sent(requests()[0] as Request)).toEqual({
      productIds: [1, 2],
      warehouseId: 5,
      dryRun: true,
    });
    await user.click(within(dialog).getByRole('button', { name: mn.catalog.products.bulk.move }));
    await waitFor(() => expect(requests()).toHaveLength(2));
    expect(await sent(requests()[1] as Request)).toEqual({ productIds: [1, 2], warehouseId: 5 });
    expect(requests()[0]?.headers.get('Idempotency-Key')).not.toBe(
      requests()[1]?.headers.get('Idempotency-Key'),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      mn.catalog.products.bulk.done.replace('{{count}}', '2'),
    );
  });

  it('names a product with stock elsewhere that the list has not loaded', async () => {
    sessionStorage.setItem(
      `tugeel.catalog.products.selection.v1:${ADMIN_ME.id}`,
      JSON.stringify([1, 99]),
    );
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/warehouses': () =>
        list([WH, { ...WH, id: 5, code: 'WH2', name: 'Шинэ агуулах' }]),
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
      'GET /api/v1/products/99': () =>
        json({ ...COLA, id: 99, sku: '10099', name: 'Өмнөх хайлтын бараа' }),
      'POST /api/v1/product-locations/bulk/home': () =>
        json({ changed: [1, 99], unchanged: [], withStock: [{ productId: 99, warehouseId: 4 }] }),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(screen.getByRole('button', { name: mn.catalog.products.bulk.edit }));
    await user.click(
      await screen.findByRole('menuitem', { name: mn.catalog.products.bulk.actions.home }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(mn.catalog.products.bulk.count.replace('{{count}}', '2'));
    await user.selectOptions(
      within(dialog).getByLabelText(mn.catalog.products.bulk.warehouse),
      '5',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    expect(await within(dialog).findByText('10099 Өмнөх хайлтын бараа')).toBeInTheDocument();
    const [request] = calls(fetchMock, 'POST', '/api/v1/product-locations/bulk/home');
    expect(request ? await sent(request) : {}).toEqual({
      productIds: [1, 99],
      warehouseId: 5,
      dryRun: true,
    });
  });

  it('deactivates ticked products after a question, and offers each change by its right', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
      'POST /api/v1/products/bulk/status': () => json({ changed: [1], unchanged: [] }),
    });
    renderApp('/catalog/products', fetchMock);
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(
      screen.getByRole('checkbox', { name: mn.common.selectRow.replace('{{name}}', '10001') }),
    );
    // The status of ticks from other searches is unknown: both changes sit in «Засах».
    await user.click(screen.getByRole('button', { name: mn.catalog.products.bulk.edit }));
    const actions = mn.catalog.products.bulk.actions;
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      actions.category,
      actions.mainSupplier,
      actions.profile,
      actions.home,
      actions.deactivate,
      actions.activate,
    ]);
    await user.click(screen.getByRole('menuitem', { name: actions.deactivate }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(
      mn.catalog.products.bulk.deactivateTitle.replace('{{count}}', '1'),
    );
    await user.click(
      within(dialog).getByRole('button', { name: mn.catalog.products.bulk.actions.deactivate }),
    );
    const [request] = await waitFor(() => {
      const found = calls(fetchMock, 'POST', '/api/v1/products/bulk/status');
      expect(found).toHaveLength(1);
      return found;
    });
    expect(request ? await sent(request) : {}).toEqual({ productIds: [1], status: 'INACTIVE' });

    // A price clerk ticks rows to change their price profile, and nothing else.
    cleanup();
    renderApp(
      '/catalog/products',
      signedIn(
        { ...WORKER_ME, permissions: ['pricing.prices.manage'] },
        {
          ...LIST_ROUTES,
          'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
        },
      ),
    );
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(
      screen.getByRole('checkbox', { name: mn.common.selectRow.replace('{{name}}', '10001') }),
    );
    const bar = screen.getByRole('region', { name: mn.common.selection });
    expect(
      within(bar).queryByRole('button', { name: mn.catalog.products.export.button }),
    ).toBeNull();
    expect(
      within(bar).queryByRole('button', { name: mn.catalog.products.bulk.actions.deactivate }),
    ).toBeNull();
    await user.click(within(bar).getByRole('button', { name: mn.catalog.products.bulk.edit }));
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([
      mn.catalog.products.bulk.actions.profile,
    ]);
  });

  it('shows a default set of columns that fits a laptop, and every other one on request', async () => {
    renderApp(
      '/catalog/products',
      signedIn(ADMIN_ME, {
        ...LIST_ROUTES,
        'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
        'GET /api/v1/product-suppliers': () =>
          list([supplierLink(1, 1, 'МСМ ХХК', true), supplierLink(2, 1, 'АПУ ХК', false)]),
        'GET /api/v1/product-locations': () =>
          list([
            {
              id: 1,
              warehouseId: WH.id,
              productId: 1,
              isHome: true,
              defaultBinId: 40,
              defaultBinCode: 'A-01-01',
              minQty: null,
              maxQty: null,
            },
          ]),
        'GET /api/v1/product-prices/current': () =>
          json([
            {
              productId: 1,
              warehousePrice: '990',
              profileId: 4,
              profileName: 'Ундааны үнэ',
              wholeUomId: 3,
            },
          ]),
      }),
    );
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('МСМ ХХК +1')).toBeInTheDocument();
    expect(await within(table).findByText('990₮')).toBeInTheDocument();
    // A user who never chose sees the photo, code, name, category, price, supplier and status.
    const shown = ['image', 'sku', 'name', 'category', 'warehousePrice', 'supplier', 'status'];
    for (const key of PRODUCT_LIST_COLUMNS) {
      if (shown.includes(key)) expect(columnHeader(key)).toBeInTheDocument();
      else expect(columnHeader(key)).toBeNull();
    }
    // The price reads right-aligned, head and cell alike.
    expect(columnHeader('warehousePrice')).toHaveClass('text-right');
    expect(within(table).getByText('990₮')).toHaveClass('text-right');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.showAllColumns }));
    for (const text of [
      'Ундааны үнэ',
      '1 хайрцаг = 24 ш',
      COLA_CODE,
      'BOX-1 (хайрцаг)',
      '0.55',
      'Бөөний агуулах',
      'Бөөний агуулах: A-01-01',
    ]) {
      expect(await within(table).findByText(text)).toBeInTheDocument();
    }
    for (const key of PRODUCT_LIST_COLUMNS) {
      expect(columnHeader(key)).toBeInTheDocument();
    }
    // The tax data lives on the product's e-Barimt card, not in the list (ADR-0048).
    expect(within(table).queryByText(mn.catalog.product.vatTypes.VAT_ABLE)).toBeNull();
    expect(within(table).queryByText('2211100')).toBeNull();
    expect(screen.queryByRole('columnheader', { name: mn.catalog.product.vatType })).toBeNull();
  });

  it('hides a column, remembers it, and shows every column again', async () => {
    const routes = { ...LIST_ROUTES, 'POST /api/v1/products/query': () => queryPage([COLA_ROW]) };
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    expect(
      await screen.findByRole('menuitemcheckbox', { name: mn.catalog.products.columns.sku }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: mn.catalog.products.columns.category }),
    );
    await user.keyboard('{Escape}');
    expect(columnHeader('category')).toBeNull();
    // The choice is stored with the columns hidden by default (ADR-0066).
    const stored: unknown = JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '[]');
    expect(stored).toEqual(expect.arrayContaining(['category', 'weight', 'units']));
    expect(stored).not.toContain('supplier');

    // A new visit keeps the choice until every column is shown again.
    cleanup();
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('category')).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.showAllColumns }));
    expect(columnHeader('category')).toBeInTheDocument();
    // An empty list, not a missing key: the old shared choice must not come back.
    expect(localStorage.getItem(HIDDEN_COLUMNS_KEY)).toBe('[]');
  });

  it("keeps each user's columns, starting from the browser's old shared choice", async () => {
    localStorage.setItem(SHARED_COLUMNS_KEY, JSON.stringify(['category']));
    const routes = { ...LIST_ROUTES, 'POST /api/v1/products/query': () => queryPage([COLA_ROW]) };
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('category')).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: mn.catalog.products.columns.weight }),
    );
    await user.keyboard('{Escape}');
    expect(JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '[]')).toEqual([
      'category',
      'weight',
    ]);
    expect(localStorage.getItem(SHARED_COLUMNS_KEY)).toBe('["category"]');

    // Another user of the same browser starts from the old shared choice, not the admin's.
    cleanup();
    renderApp('/catalog/products', signedIn(WORKER_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('category')).toBeNull();
    expect(columnHeader('weight')).toBeInTheDocument();
  });

  it('reads no suppliers, locations or prices while their columns are hidden', async () => {
    localStorage.setItem(
      HIDDEN_COLUMNS_KEY,
      JSON.stringify(['supplier', 'homeWarehouse', 'fixedBins', 'warehousePrice', 'priceProfile']),
    );
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'POST /api/v1/products/query': () => queryPage([COLA_ROW]),
    });
    renderApp('/catalog/products', fetchMock);
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('supplier')).toBeNull();
    expect(columnHeader('category')).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/product-suppliers')).toHaveLength(0);
    expect(calls(fetchMock, 'GET', '/api/v1/product-locations')).toHaveLength(0);
    expect(calls(fetchMock, 'GET', '/api/v1/product-prices/current')).toHaveLength(0);
  });

  it('ignores a broken or foreign stored choice and still hides when storage refuses', async () => {
    const routes = { ...LIST_ROUTES, 'POST /api/v1/products/query': () => queryPage([COLA_ROW]) };
    localStorage.setItem(HIDDEN_COLUMNS_KEY, '{not json');
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('category')).toBeInTheDocument();

    cleanup();
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(['sku', 'name', 'price', 'category']));
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('sku')).toBeInTheDocument();
    expect(columnHeader('name')).toBeInTheDocument();
    expect(columnHeader('category')).toBeNull();

    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(
      await screen.findByRole('menuitemcheckbox', { name: mn.catalog.products.columns.weight }),
    );
    await user.keyboard('{Escape}');
    expect(columnHeader('weight')).toBeNull();
    setItem.mockRestore();
  });

  it('opens a product from its name or anywhere on its row', async () => {
    const routes = { ...LIST_ROUTES, 'POST /api/v1/products/query': () => queryPage([COLA_ROW]) };
    const first = renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Кока кола' }));
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/catalog/products/1'));

    cleanup();
    const second = renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const table = await screen.findByRole('table');
    await user.click(await within(table).findByText('Ундаа'));
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/catalog/products/1'));

    cleanup();
    renderApp('/catalog/products', signedIn(WORKER_ME, routes));
    expect(await screen.findByRole('link', { name: 'Кока кола' })).toHaveAttribute(
      'href',
      '/catalog/products/1',
    );
  });
});

describe('product page', () => {
  const productRoutes = (extra = {}) => ({
    ...MASTER_ROUTES,
    'GET /api/v1/products/7': () => json(COLA),
    ...extra,
  });

  it('changes a box factor with one Idempotency-Key per dialog, resent after an error', async () => {
    const supersedes: { key: string | null; body: unknown }[] = [];
    const fetchMock = signedIn(
      ADMIN_ME,
      productRoutes({
        'POST /api/v1/product-units/71/supersede': async (request: Request) => {
          supersedes.push({
            key: request.headers.get('Idempotency-Key'),
            body: await request.json(),
          });
          return supersedes.length === 1
            ? problem('UNIT_SUPERSEDED', 409)
            : json(unit({ id: 72, uomId: 3, factorToBase: '20' }), 201);
        },
      }),
    );
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    const box = await screen.findByRole('region', { name: 'хайрцаг' });
    expect(within(box).getByText('1 хайрцаг = 24 ш')).toBeInTheDocument();
    // The unit's actions sit in its «⋯» menu.
    await user.click(within(box).getByRole('button', { name: unitMenu('хайрцаг') }));
    await user.click(await screen.findByRole('menuitem', { name: mn.catalog.units.changeFactor }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.catalog.units.newFactor), '20');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.errors.UNIT_SUPERSEDED)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(supersedes).toHaveLength(2);
    expect(supersedes[0]?.key).toMatch(UUID);
    expect(supersedes[1]?.key).toBe(supersedes[0]?.key);
    expect(supersedes[1]?.body).toEqual({ factorToBase: '20' });
  });

  it('adds a barcode, issues an internal one and shows who owns a taken code', async () => {
    const fetchMock = signedIn(
      ADMIN_ME,
      productRoutes({
        'POST /api/v1/product-units/71/barcodes': () =>
          problem('BARCODE_TAKEN', 409, { sku: '10099', name: 'Спрайт' }),
        'POST /api/v1/product-units/71/internal-barcode': () =>
          json(
            {
              id: 701,
              code: '2000000000015',
              gtin14: '02000000000015',
              barcodeType: 'UNDEFINED',
              isPrimary: true,
              isInternal: true,
            },
            201,
          ),
      }),
    );
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    const box = within(await screen.findByRole('region', { name: 'хайрцаг' }));
    await user.click(box.getByRole('button', { name: mn.catalog.units.addBarcode }));
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(
      dialog.getByLabelText(mn.catalog.units.addBarcode),
      `${ean('865000100009')}{Enter}`,
    );
    expect(
      await dialog.findByText(
        mn.errors.BARCODE_TAKEN.replace('{{name}}', 'Спрайт').replace('{{sku}}', '10099'),
      ),
    ).toBeInTheDocument();
    expect(dialog.getByLabelText(mn.catalog.units.addBarcode)).not.toHaveValue('');

    await user.click(dialog.getByRole('button', { name: mn.catalog.units.generateInternal }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('status')).toHaveTextContent(mn.catalog.units.barcodeAdded);
    // The focus goes back to the button that opened the dialog.
    await waitFor(() =>
      expect(box.getByRole('button', { name: mn.catalog.units.addBarcode })).toHaveFocus(),
    );
    const [internal, ...more] = calls(
      fetchMock,
      'POST',
      '/api/v1/product-units/71/internal-barcode',
    );
    expect(more).toHaveLength(0);
    expect(internal?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(screen.queryByText(/«Спрайт»/)).toBeNull();
  });

  it('retires a unit from its menu after asking', async () => {
    const retired: (string | null)[] = [];
    const fetchMock = signedIn(
      ADMIN_ME,
      productRoutes({
        'POST /api/v1/product-units/71/retire': (request: Request) => {
          retired.push(request.headers.get('Idempotency-Key'));
          return json({ ...unit({ id: 71, uomId: 3, factorToBase: '24' }), supersededAt: STAMP });
        },
      }),
    );
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    // The base unit cannot be retired or change its factor: its menu only edits.
    const piece = within(await screen.findByRole('region', { name: 'ш' }));
    await user.click(piece.getByRole('button', { name: unitMenu('ш') }));
    expect(
      await screen.findByRole('menuitem', { name: mn.catalog.units.edit }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: mn.catalog.units.retire })).toBeNull();
    await user.keyboard('{Escape}');

    const box = within(screen.getByRole('region', { name: 'хайрцаг' }));
    await user.click(box.getByRole('button', { name: unitMenu('хайрцаг') }));
    await user.click(await screen.findByRole('menuitem', { name: mn.catalog.units.retire }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(mn.catalog.units.retireConfirm.replace('{{unit}}', 'хайрцаг')),
    ).toBeInTheDocument();
    expect(retired).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: mn.catalog.units.retire }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(retired).toHaveLength(1);
    expect(retired[0]).toMatch(UUID);
  });

  it('deletes a barcode only after a question that names it, then says so', async () => {
    const fetchMock = signedIn(
      ADMIN_ME,
      productRoutes({
        'DELETE /api/v1/product-barcodes/700': () => new Response(null, { status: 204 }),
      }),
    );
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    const piece = within(await screen.findByRole('region', { name: 'ш' }));
    await user.click(
      piece.getByRole('button', { name: `${mn.catalog.units.deleteBarcode}: ${COLA_CODE}` }),
    );
    const dialog = within(
      await screen.findByRole('dialog', {
        name: mn.catalog.units.deleteBarcodeTitle.replace('{{code}}', COLA_CODE),
      }),
    );
    expect(calls(fetchMock, 'DELETE', '/api/v1/product-barcodes/700')).toHaveLength(0);
    await user.click(dialog.getByRole('button', { name: mn.common.delete }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls(fetchMock, 'DELETE', '/api/v1/product-barcodes/700')).toHaveLength(1);
    expect(await screen.findByRole('status')).toHaveTextContent(mn.catalog.units.barcodeDeleted);
  });

  it('keeps the product read-only for a worker', async () => {
    renderApp('/catalog/products/7', signedIn(WORKER_ME, productRoutes()));
    // The card is read first (ADR-0042); a worker gets no «Засах» and no form.
    const info = within(await screen.findByRole('region', { name: mn.catalog.product.info }));
    expect(info.getByText(COLA.name)).toBeInTheDocument();
    expect(info.queryByRole('textbox')).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${mn.common.edit}: ${mn.catalog.product.info}` }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.product.addUnit })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.images.upload })).toBeNull();
    expect(screen.queryByRole('button', { name: unitMenu('хайрцаг') })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.units.addBarcode })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.units.deleteBarcode })).toBeNull();
    expect(screen.getByText(COLA_CODE)).toBeInTheDocument();
  });

  it('sends the edited product and shows that it was saved', async () => {
    let patched: unknown;
    renderApp(
      '/catalog/products/7',
      signedIn(
        ADMIN_ME,
        productRoutes({
          'PATCH /api/v1/products/7': async (request: Request) => {
            patched = await request.json();
            return json({ ...COLA, weightKg: '0.6', updatedAt: '2026-10-02T02:00:00.000Z' });
          },
        }),
      ),
    );
    const user = userEvent.setup();
    const edit = `${mn.common.edit}: ${mn.catalog.product.info}`;
    await user.click(await screen.findByRole('button', { name: edit }));
    // e-Barimt fields live in their own card (ADR-0044).
    expect(screen.queryByLabelText(mn.catalog.product.cityTax)).toBeNull();
    const weight = await screen.findByLabelText(mn.catalog.product.weight);
    await user.clear(weight);
    await user.type(weight, '0.6');
    // The status is a switch, on while the product is active.
    const status = screen.getByRole('switch', { name: mn.catalog.product.status });
    expect(status).toBeChecked();
    await user.click(status);
    expect(status).not.toBeChecked();
    expect(screen.getByText(mn.catalog.products.status.INACTIVE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    // A toast says so and the card is read again.
    expect(await screen.findByRole('status')).toHaveTextContent(mn.catalog.product.saved);
    expect(await screen.findByRole('button', { name: edit })).toBeInTheDocument();
    expect(patched).toEqual({
      sku: '10023',
      name: 'Кока кола 0.5 л',
      categoryId: 12,
      weightKg: '0.6',
      status: 'INACTIVE',
    });
  });

  it('lets the accountant set the e-Barimt data in its own card', async () => {
    let patched: unknown;
    const accountant = { ...WORKER_ME, permissions: ['catalog.ebarimt.manage' as const] };
    renderApp(
      '/catalog/products/7',
      signedIn(
        accountant,
        productRoutes({
          'PATCH /api/v1/products/7/ebarimt': async (request: Request) => {
            patched = await request.json();
            return json({ ...COLA, cityTax: true, classificationCode: '2211100' });
          },
        }),
      ),
    );
    const user = userEvent.setup();
    // Product data stays read-only; only the e-Barimt card has «Засах».
    expect(
      await screen.findByRole('button', {
        name: `${mn.common.edit}: ${mn.catalog.ebarimtCard.title}`,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: `${mn.common.edit}: ${mn.catalog.product.info}` }),
    ).toBeNull();
    await user.click(
      screen.getByRole('button', { name: `${mn.common.edit}: ${mn.catalog.ebarimtCard.title}` }),
    );
    await user.selectOptions(await screen.findByLabelText(mn.catalog.product.cityTax), 'yes');
    await user.type(screen.getByLabelText(mn.catalog.product.classificationCode), '2211100');
    // The units card is a region named «ш» too: ask for the field.
    await user.type(screen.getByRole('textbox', { name: 'ш' }), 'ш');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByRole('status')).toHaveTextContent(mn.catalog.ebarimtCard.saved);
    expect(patched).toEqual({
      vatType: 'VAT_ABLE',
      cityTax: true,
      classificationCode: '2211100',
      taxProductCode: null,
      units: [
        { unitId: 70, measureUnit: 'ш' },
        { unitId: 71, measureUnit: null },
      ],
    });
  });

  it('completes a product waiting for its prices from the prices card', async () => {
    const posted: { key: string | null; body: unknown }[] = [];
    const waiting = { ...COLA, saleReadyAt: null };
    const routes = {
      ...MASTER_ROUTES,
      'GET /api/v1/products/7': () => json(waiting),
      'POST /api/v1/pricing/sale-ready': async (request: Request) => {
        posted.push({ key: request.headers.get('Idempotency-Key'), body: await request.json() });
        return json({ completed: [7], alreadyComplete: [] });
      },
    };
    renderApp('/catalog/products/7', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    expect(await screen.findByText(mn.pricing.saleReady.pendingNote)).toBeInTheDocument();
    expect(screen.getAllByText(mn.catalog.products.status.PENDING).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: mn.pricing.saleReady.complete }));
    expect(await screen.findByRole('status')).toHaveTextContent(mn.pricing.saleReady.completed);
    expect(posted).toEqual([{ key: expect.stringMatching(UUID), body: { productIds: [7] } }]);

    // A worker sees that the product waits but cannot complete it.
    cleanup();
    renderApp('/catalog/products/7', signedIn(WORKER_ME, routes));
    expect(await screen.findByText(mn.pricing.saleReady.pendingNote)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: mn.pricing.saleReady.complete })).toBeNull();
  });
});

describe('categories', () => {
  it('adds a subcategory and never offers a category its own subtree as a parent', async () => {
    let posted: unknown;
    renderApp(
      '/catalog/categories',
      signedIn(ADMIN_ME, {
        ...MASTER_ROUTES,
        'POST /api/v1/categories': async (request) => {
          posted = await request.json();
          return json({ ...CATEGORIES[1], id: 13, name: 'Будаа' }, 201);
        },
      }),
    );
    const user = userEvent.setup();
    const food = (await screen.findByText('Хүнс')).closest('tr');
    if (!food) throw new Error('no row');
    // Each row's icon buttons carry its name.
    await user.click(
      within(food).getByRole('button', { name: `${mn.catalog.categories.addChild}: Хүнс` }),
    );
    let dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(mn.catalog.categories.parent)).toHaveValue('10');
    await user.type(dialog.getByLabelText(mn.catalog.categories.name), 'Будаа');
    await user.type(dialog.getByLabelText(mn.catalog.categories.defaultCode), '123');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.classificationCode)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText(mn.catalog.categories.defaultCode));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(posted).toEqual({
        name: 'Будаа',
        parentId: 10,
        defaultClassificationCode: null,
        skuFrom: null,
        skuTo: null,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Food has products below it: no delete button; editing it hides itself and Flour as parents.
    expect(within(food).queryByRole('button', { name: `${mn.common.delete}: Хүнс` })).toBeNull();
    await user.click(
      within(food).getByRole('button', { name: mn.common.editRecord.replace('{{name}}', 'Хүнс') }),
    );
    dialog = within(await screen.findByRole('dialog'));
    const parents = within(dialog.getByLabelText(mn.catalog.categories.parent))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(parents).toEqual([mn.catalog.categories.root, 'Ундаа']);
  });
});

describe('category delete', () => {
  it('asks first, and «Болих» gives the focus back to the row’s button', async () => {
    const empty: Schemas['Category'] = {
      id: 14,
      parentId: null,
      name: 'Хоосон',
      defaultClassificationCode: null,
      skuFrom: null,
      skuTo: null,
      productCount: 0,
      childCount: 0,
      imageUrl: null,
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTER_ROUTES,
      'GET /api/v1/categories': () => list([...CATEGORIES, empty]),
      'DELETE /api/v1/categories/14': () => new Response(null, { status: 204 }),
    });
    renderApp('/catalog/categories', fetchMock);
    const user = userEvent.setup();
    const remove = await screen.findByRole('button', { name: `${mn.common.delete}: Хоосон` });
    await user.click(remove);
    const dialog = within(await screen.findByRole('dialog'));
    expect(
      dialog.getByText(mn.catalog.categories.deleteConfirm.replace('{{name}}', 'Хоосон')),
    ).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: mn.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(remove).toHaveFocus();
    expect(calls(fetchMock, 'DELETE', '/api/v1/categories/14')).toHaveLength(0);
  });
});

describe('category code ranges', () => {
  it('shows a range a subcategory uses from its parent and sets one with both ends', async () => {
    let patched: unknown;
    const ranged = CATEGORIES.map((category) =>
      category.id === 10 ? { ...category, skuFrom: '20000', skuTo: '29999' } : category,
    );
    renderApp(
      '/catalog/categories',
      signedIn(ADMIN_ME, {
        ...MASTER_ROUTES,
        'GET /api/v1/categories': () => list(ranged),
        'PATCH /api/v1/categories/12': async (request) => {
          patched = await request.json();
          return json({ ...CATEGORIES[2], skuFrom: '10000', skuTo: '19999' });
        },
      }),
    );
    const user = userEvent.setup();
    const flour = (await screen.findByText('Гурил')).closest('tr');
    if (!flour) throw new Error('no row');
    expect(within(flour).getByText('20000–29999')).toBeInTheDocument();
    expect(
      within(flour).getByText(mn.catalog.categories.inheritedFrom.replace('{{name}}', 'Хүнс')),
    ).toBeInTheDocument();

    const drinks = screen.getByText('Ундаа').closest('tr');
    if (!drinks) throw new Error('no row');
    await user.click(
      within(drinks).getByRole('button', {
        name: mn.common.editRecord.replace('{{name}}', 'Ундаа'),
      }),
    );
    const dialog = within(await screen.findByRole('dialog'));
    await user.type(dialog.getByLabelText(mn.catalog.categories.skuFrom), '10000');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.skuRangePair)).toBeInTheDocument();
    await user.type(dialog.getByLabelText(mn.catalog.categories.skuTo), '9999');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.skuRangeOrder)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText(mn.catalog.categories.skuTo));
    await user.type(dialog.getByLabelText(mn.catalog.categories.skuTo), '19999');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(patched).toEqual({
        name: 'Ундаа',
        parentId: null,
        defaultClassificationCode: null,
        skuFrom: '10000',
        skuTo: '19999',
      }),
    );
  });
});

describe('e-Barimt readiness', () => {
  it('counts first, then fills the empty attributes of a category', async () => {
    const assigned: { key: string | null; body: unknown }[] = [];
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTER_ROUTES,
      'GET /api/v1/catalog/ebarimt-readiness': () =>
        json({
          activeProducts: 3,
          missing: { classificationCode: 2, taxProductCode: 1, measureUnit: 3, cityTax: 2 },
        }),
      'GET /api/v1/catalog/ebarimt-readiness/products': () =>
        list([{ product: summary(1, '10001', 'Кока кола'), missing: ['classificationCode'] }]),
      'POST /api/v1/catalog/ebarimt-readiness/assign': async (request) => {
        assigned.push({
          key: request.headers.get('Idempotency-Key'),
          body: await request.json(),
        });
        return json({ classificationCode: 2, taxProductCode: 0, cityTax: 1 });
      },
    });
    const { router } = renderApp('/catalog/ebarimt', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.catalog.readiness.gaps.measureUnit)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Кока кола' })).toBeInTheDocument();

    // A gap's tile filters the list by it, through the URL; a second click clears it.
    const tile = screen.getByRole('button', {
      name: new RegExp(mn.catalog.readiness.gaps.measureUnit),
    });
    await user.click(tile);
    await waitFor(() => expect(router.state.location.search).toBe('?gap=measureUnit'));
    expect(tile).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() =>
      expect(
        calls(fetchMock, 'GET', '/api/v1/catalog/ebarimt-readiness/products').some(
          (request) => new URL(request.url).searchParams.get('gap') === 'measureUnit',
        ),
      ).toBe(true),
    );
    await user.click(tile);
    await waitFor(() => expect(router.state.location.search).toBe(''));

    // The assignment opens from the header, so the list starts under the tiles.
    await user.click(screen.getByRole('button', { name: mn.catalog.readiness.assign }));
    const form = within(await screen.findByRole('dialog', { name: mn.catalog.readiness.assign }));
    const apply = form.getByRole('button', { name: mn.catalog.readiness.apply });
    expect(apply).toBeDisabled();
    await user.selectOptions(form.getByLabelText(mn.catalog.readiness.category), '11');
    expect(form.getByLabelText(mn.catalog.product.classificationCode)).toHaveValue('2111100');
    await user.selectOptions(form.getByLabelText(mn.catalog.product.cityTax), 'no');
    await user.click(form.getByRole('button', { name: mn.catalog.readiness.count }));
    expect(await screen.findByRole('status')).toHaveTextContent('2');
    await user.click(apply);
    expect(await screen.findByText(new RegExp(mn.catalog.readiness.done))).toBeInTheDocument();

    expect(assigned.map((call) => call.body)).toEqual([
      {
        categoryId: 11,
        includeSubcategories: true,
        classificationCode: '2111100',
        cityTax: false,
        dryRun: true,
      },
      { categoryId: 11, includeSubcategories: true, classificationCode: '2111100', cityTax: false },
    ]);
    expect(assigned.every((call) => UUID.test(call.key ?? ''))).toBe(true);
  });

  it('refuses the page to a worker without calling the API', async () => {
    const fetchMock = signedIn(WORKER_ME);
    renderApp('/catalog/ebarimt', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/catalog/ebarimt-readiness')).toHaveLength(0);
  });
});

describe('barcode lookup', () => {
  const resolution: Schemas['BarcodeResolution'] = {
    product: summary(7, '10023', 'Кока кола 0.5 л'),
    unit: { id: 71, uomId: 3, uomName: 'хайрцаг', factorToBase: '24', isBase: false },
    barcode: {
      id: 710,
      code: '2000000000015',
      gtin14: '02000000000015',
      barcodeType: 'UNDEFINED',
      isPrimary: true,
      isInternal: true,
    },
  };
  const lookupRoutes = {
    'GET /api/v1/barcodes/2000000000015': () => json(resolution),
  };

  it('shows the product and unit of a typed code, and says when a code is unknown', async () => {
    const fetchMock = signedIn(WORKER_ME, lookupRoutes);
    renderApp('/catalog/scan', fetchMock);
    const user = userEvent.setup();
    const box = await screen.findByRole('textbox', { name: mn.scan.label });
    await user.type(box, ' 2000000000015 {Enter}');
    expect(await screen.findByRole('link', { name: 'Кока кола 0.5 л' })).toHaveAttribute(
      'href',
      '/catalog/products/7',
    );
    expect(screen.getByText('1 хайрцаг = 24 ш')).toBeInTheDocument();
    expect(box).toHaveValue('');

    await user.type(box, '4006381333931{Enter}');
    expect(
      await screen.findByText(mn.scan.notFound.replace('{{code}}', '4006381333931')),
    ).toBeInTheDocument();
    // The earlier scan moves to the recent list.
    expect(screen.getByRole('heading', { name: mn.scan.recent })).toBeInTheDocument();
    // No camera in jsdom: the button stays hidden.
    expect(screen.queryByRole('button', { name: mn.scan.camera })).toBeNull();
  });

  it('takes a keyboard-wedge scan while nothing is focused', async () => {
    const fetchMock = signedIn(WORKER_ME, lookupRoutes);
    renderApp('/catalog/scan', fetchMock);
    await screen.findByRole('textbox', { name: mn.scan.label });
    for (const key of '2000000000015') {
      fireEvent.keyDown(document.body, { key, code: `Digit${key}` });
    }
    fireEvent.keyDown(document.body, { key: 'Enter', code: 'Enter' });
    expect(await screen.findByRole('link', { name: 'Кока кола 0.5 л' })).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/barcodes/2000000000015')).toHaveLength(1);
  });
});
