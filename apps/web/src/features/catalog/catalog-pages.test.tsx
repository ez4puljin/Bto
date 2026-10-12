import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import { PRODUCT_COLUMN_KEYS } from './product-columns';

type Schemas = components['schemas'];
const STAMP = '2026-10-01T02:00:00.000Z';
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });
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
    productCount: 0,
    childCount: 1,
  },
  {
    id: 11,
    parentId: 10,
    name: 'Гурил',
    defaultClassificationCode: '2111100',
    productCount: 2,
    childCount: 0,
  },
  {
    id: 12,
    parentId: null,
    name: 'Ундаа',
    defaultClassificationCode: null,
    productCount: 1,
    childCount: 0,
  },
];
const BRANDS: Schemas['Brand'][] = [{ id: 5, name: 'Coca-Cola', productCount: 1 }];
const MASTER_ROUTES = {
  'GET /api/v1/uoms': () => list(UOMS),
  'GET /api/v1/categories': () => list(CATEGORIES),
  'GET /api/v1/brands': () => list(BRANDS),
};

const summary = (id: number, sku: string, name: string): Schemas['ProductSummary'] => ({
  id,
  sku,
  name,
  categoryId: 12,
  brandId: 5,
  status: 'ACTIVE',
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
  brandId: 5,
  vatType: 'VAT_ABLE',
  cityTax: null,
  classificationCode: null,
  taxProductCode: null,
  status: 'ACTIVE',
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

describe('catalog menu and access', () => {
  it('shows the catalog menu to every user, the e-Barimt page to its managers only', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    const nav = await screen.findByRole('navigation');
    for (const label of [mn.nav.products, mn.nav.categories, mn.nav.brands, mn.nav.uoms]) {
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
};
const HIDDEN_COLUMNS_KEY = 'tugeel.catalog.products.hiddenColumns.v1';
const idsOf = (request: Request) => new URL(request.url).searchParams.getAll('productIds');
const columnHeader = (key: keyof typeof mn.catalog.products.columns) =>
  screen.queryByRole('columnheader', { name: mn.catalog.products.columns[key] });

describe('products list', () => {
  it('searches, keeps the search in the URL and loads the next page', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/products': (request) => {
        const query = new URL(request.url).searchParams;
        if (query.get('cursor') === 'page-2') return list([listItem(2, '10002', 'Фанта')]);
        if (query.get('q') === 'coca') return list([listItem(1, '10001', 'Кока кола')]);
        return list([listItem(1, '10001', 'Кока кола')], 'page-2');
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
    // Each page reads the suppliers and locations of its own products, once.
    await waitFor(() =>
      expect(calls(fetchMock, 'GET', '/api/v1/product-suppliers').map(idsOf)).toEqual([
        ['1'],
        ['2'],
      ]),
    );
    expect(calls(fetchMock, 'GET', '/api/v1/product-locations').map(idsOf)).toEqual([['1'], ['2']]);

    await user.type(screen.getByRole('searchbox', { name: mn.common.search }), 'coca');
    await waitFor(() => expect(router.state.location.search).toBe('?q=coca'));
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Фанта' })).toBeNull());
    expect(
      calls(fetchMock, 'GET', '/api/v1/products').some(
        (request) => new URL(request.url).searchParams.get('q') === 'coca',
      ),
    ).toBe(true);
  });

  it('shows every piece of product information in its own column', async () => {
    renderApp(
      '/catalog/products',
      signedIn(ADMIN_ME, {
        ...LIST_ROUTES,
        'GET /api/v1/products': () => list([COLA_ROW]),
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
      }),
    );
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('МСМ ХХК +1')).toBeInTheDocument();
    for (const text of [
      'Coca-Cola',
      '1 хайрцаг = 24 ш',
      COLA_CODE,
      'BOX-1 (хайрцаг)',
      mn.catalog.product.vatTypes.VAT_ABLE,
      mn.catalog.product.cityTaxValues.no,
      '0.55',
      '2211100',
      'Бөөний агуулах',
      'Бөөний агуулах: A-01-01',
    ]) {
      expect(within(table).getByText(text)).toBeInTheDocument();
    }
    for (const key of PRODUCT_COLUMN_KEYS) {
      expect(columnHeader(key)).toBeInTheDocument();
    }
  });

  it('hides a column, remembers it, and shows every column again', async () => {
    const routes = { ...LIST_ROUTES, 'GET /api/v1/products': () => list([COLA_ROW]) };
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await screen.findByRole('link', { name: 'Кока кола' });
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    expect(
      await screen.findByRole('menuitemcheckbox', { name: mn.catalog.products.columns.sku }),
    ).toHaveAttribute('aria-disabled', 'true');
    await user.click(
      screen.getByRole('menuitemcheckbox', { name: mn.catalog.products.columns.brand }),
    );
    await user.keyboard('{Escape}');
    expect(columnHeader('brand')).toBeNull();
    expect(JSON.parse(localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? '[]')).toEqual(['brand']);

    // A new visit keeps the choice until every column is shown again.
    cleanup();
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('brand')).toBeNull();
    await user.click(screen.getByRole('button', { name: mn.common.columns }));
    await user.click(await screen.findByRole('menuitem', { name: mn.common.showAllColumns }));
    expect(columnHeader('brand')).toBeInTheDocument();
    expect(localStorage.getItem(HIDDEN_COLUMNS_KEY)).toBeNull();
  });

  it('reads no suppliers or locations while their columns are hidden', async () => {
    localStorage.setItem(
      HIDDEN_COLUMNS_KEY,
      JSON.stringify(['supplier', 'homeWarehouse', 'fixedBins']),
    );
    const fetchMock = signedIn(ADMIN_ME, {
      ...LIST_ROUTES,
      'GET /api/v1/products': () => list([COLA_ROW]),
    });
    renderApp('/catalog/products', fetchMock);
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('supplier')).toBeNull();
    expect(columnHeader('category')).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/product-suppliers')).toHaveLength(0);
    expect(calls(fetchMock, 'GET', '/api/v1/product-locations')).toHaveLength(0);
  });

  it('ignores a broken or foreign stored choice and still hides when storage refuses', async () => {
    const routes = { ...LIST_ROUTES, 'GET /api/v1/products': () => list([COLA_ROW]) };
    localStorage.setItem(HIDDEN_COLUMNS_KEY, '{not json');
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('brand')).toBeInTheDocument();

    cleanup();
    localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(['sku', 'name', 'price', 'brand']));
    renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    await screen.findByRole('link', { name: 'Кока кола' });
    expect(columnHeader('sku')).toBeInTheDocument();
    expect(columnHeader('name')).toBeInTheDocument();
    expect(columnHeader('brand')).toBeNull();

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

  it('opens a product from its edit button or anywhere on its row', async () => {
    const routes = { ...LIST_ROUTES, 'GET /api/v1/products': () => list([COLA_ROW]) };
    const first = renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('link', {
        name: `${mn.common.edit}: Кока кола`,
      }),
    );
    await waitFor(() => expect(first.router.state.location.pathname).toBe('/catalog/products/1'));

    cleanup();
    const second = renderApp('/catalog/products', signedIn(ADMIN_ME, routes));
    const table = await screen.findByRole('table');
    await user.click(await within(table).findByText('Coca-Cola'));
    await waitFor(() => expect(second.router.state.location.pathname).toBe('/catalog/products/1'));

    cleanup();
    renderApp('/catalog/products', signedIn(WORKER_ME, routes));
    expect(
      await screen.findByRole('link', { name: `${mn.common.view}: Кока кола` }),
    ).toHaveAttribute('href', '/catalog/products/1');
  });
});

describe('product create', () => {
  it('suggests the SKU, checks barcodes and factors, and shows a taken SKU on its field', async () => {
    const posted: unknown[] = [];
    const created = { ...COLA, id: 8, sku: '10025', name: 'Гурил 1 кг', categoryId: 11 };
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTER_ROUTES,
      'GET /api/v1/products/next-sku': () => json({ sku: '10024' }),
      'POST /api/v1/products': async (request) => {
        posted.push(await request.json());
        return posted.length === 1
          ? problem('DUPLICATE_VALUE', 409, { constraint: 'products_sku_key' })
          : json(created, 201);
      },
      'GET /api/v1/products/8': () => json(created),
    });
    const { router } = renderApp('/catalog/products/new', fetchMock);
    const user = userEvent.setup();
    const sku = await screen.findByLabelText(mn.catalog.product.sku);
    expect(sku).toHaveValue('10024');

    await user.type(screen.getByLabelText(mn.catalog.product.name), 'Гурил 1 кг');
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.category), '11');
    expect(screen.getByLabelText(mn.catalog.product.classificationCode)).toHaveValue('2111100');
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.vatType), 'VAT_FREE');
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.cityTax), 'no');
    await user.type(screen.getByLabelText(mn.catalog.product.weight), '1');

    const baseBarcode = screen.getByLabelText(mn.catalog.product.barcodes);
    await user.type(baseBarcode, '4006381333932{Enter}');
    expect(await screen.findByText(mn.validation.barcode)).toBeInTheDocument();
    await user.clear(baseBarcode);
    const pieceCode = ean('865000100001');
    await user.type(baseBarcode, `${pieceCode}{Enter}`);
    expect(screen.getByText(pieceCode)).toBeInTheDocument();
    expect(screen.queryByText(mn.validation.barcode)).toBeNull();

    await user.click(screen.getByRole('button', { name: mn.catalog.product.addUnit }));
    await user.selectOptions(screen.getByLabelText(mn.catalog.product.unit), '3');
    await user.type(screen.getByLabelText(mn.catalog.product.factor), '2.5');
    await user.click(screen.getByLabelText(mn.catalog.product.defaultSales));
    const [, boxBarcode] = screen.getAllByLabelText(mn.catalog.product.unitBarcodes);
    if (!boxBarcode) throw new Error('no box barcode field');
    await user.type(boxBarcode, `${pieceCode}{Enter}`);
    expect(await screen.findByText(mn.validation.barcodeRepeated)).toBeInTheDocument();
    await user.clear(boxBarcode);
    const boxCode = ean('865000100002');
    await user.type(boxBarcode, `${boxCode}{Enter}`);

    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.factor)).toBeInTheDocument();
    expect(posted).toEqual([]);
    await user.clear(screen.getByLabelText(mn.catalog.product.factor));
    await user.type(screen.getByLabelText(mn.catalog.product.factor), '10');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.validation.skuTaken)).toBeInTheDocument();
    expect(screen.queryByText(mn.errors.DUPLICATE_VALUE)).toBeNull();

    await user.clear(sku);
    await user.type(sku, '10025');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/catalog/products/8'));
    expect(posted[1]).toEqual({
      sku: '10025',
      name: 'Гурил 1 кг',
      categoryId: 11,
      brandId: null,
      vatType: 'VAT_FREE',
      cityTax: false,
      classificationCode: '2111100',
      taxProductCode: null,
      weightKg: '1',
      baseUomId: 1,
      baseBarcodes: [pieceCode],
      units: [
        {
          uomId: 3,
          factorToBase: '10',
          isDefaultSales: true,
          isDefaultPurchase: false,
          barcodes: [boxCode],
        },
      ],
    });
  });

  it('reads barcode digits typed through the Mongolian keyboard layout', async () => {
    renderApp(
      '/catalog/products/new',
      signedIn(ADMIN_ME, {
        ...MASTER_ROUTES,
        'GET /api/v1/products/next-sku': () => json({ sku: '1' }),
      }),
    );
    const input = await screen.findByLabelText(mn.catalog.product.barcodes);
    fireEvent.keyDown(input, { key: '№', code: 'Digit1' });
    fireEvent.keyDown(input, { key: '₮', code: 'Digit4' });
    expect(input).toHaveValue('14');
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
    await user.click(within(box).getByRole('button', { name: mn.catalog.units.changeFactor }));
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
    await user.type(
      box.getByLabelText(mn.catalog.units.addBarcode),
      `${ean('865000100009')}{Enter}`,
    );
    expect(
      await screen.findByText(
        mn.errors.BARCODE_TAKEN.replace('{{name}}', 'Спрайт').replace('{{sku}}', '10099'),
      ),
    ).toBeInTheDocument();
    expect(box.getByLabelText(mn.catalog.units.addBarcode)).not.toHaveValue('');

    await user.click(box.getByRole('button', { name: mn.catalog.units.internalBarcode }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/product-units/71/internal-barcode')).toHaveLength(1),
    );
    const [internal] = calls(fetchMock, 'POST', '/api/v1/product-units/71/internal-barcode');
    expect(internal?.headers.get('Idempotency-Key')).toMatch(UUID);
    await waitFor(() => expect(screen.queryByText(/«Спрайт»/)).toBeNull());
  });

  it('keeps the product read-only for a worker', async () => {
    renderApp('/catalog/products/7', signedIn(WORKER_ME, productRoutes()));
    const name = await screen.findByLabelText(mn.catalog.product.name);
    expect(name).toHaveValue(COLA.name);
    expect(name).toBeDisabled();
    expect(screen.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.product.addUnit })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.images.upload })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.catalog.units.changeFactor })).toBeNull();
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
            return json({ ...COLA, cityTax: true, updatedAt: '2026-10-02T02:00:00.000Z' });
          },
        }),
      ),
    );
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText(mn.catalog.product.cityTax), 'yes');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.catalog.product.saved)).toBeInTheDocument();
    expect(patched).toEqual({
      sku: '10023',
      name: 'Кока кола 0.5 л',
      categoryId: 12,
      brandId: 5,
      vatType: 'VAT_ABLE',
      cityTax: true,
      classificationCode: null,
      taxProductCode: null,
      weightKg: '0.55',
      status: 'ACTIVE',
    });
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
    await user.click(within(food).getByRole('button', { name: mn.catalog.categories.addChild }));
    let dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByLabelText(mn.catalog.categories.parent)).toHaveValue('10');
    await user.type(dialog.getByLabelText(mn.catalog.categories.name), 'Будаа');
    await user.type(dialog.getByLabelText(mn.catalog.categories.defaultCode), '123');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(await dialog.findByText(mn.validation.classificationCode)).toBeInTheDocument();
    await user.clear(dialog.getByLabelText(mn.catalog.categories.defaultCode));
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(posted).toEqual({ name: 'Будаа', parentId: 10, defaultClassificationCode: null }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Food has products below it: no delete button; editing it hides itself and Flour as parents.
    expect(within(food).queryByRole('button', { name: mn.common.delete })).toBeNull();
    await user.click(within(food).getByRole('button', { name: mn.common.edit }));
    dialog = within(await screen.findByRole('dialog'));
    const parents = within(dialog.getByLabelText(mn.catalog.categories.parent))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(parents).toEqual([mn.catalog.categories.root, 'Ундаа']);
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
    renderApp('/catalog/ebarimt', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.catalog.readiness.gaps.measureUnit)).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Кока кола' })).toBeInTheDocument();

    const card = screen
      .getByText(mn.catalog.readiness.assign)
      .closest<HTMLElement>('[data-slot="card"]');
    if (!card) throw new Error('no assignment card');
    const form = within(card);
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
