import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, findSidebar, json, renderApp, signedIn, WORKER_ME } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-13T02:00:00.000Z';
const TODAY = businessDate();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const UOMS: Schemas['Uom'][] = [
  { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false, measureUnit: null },
];
const CATEGORIES: Schemas['Category'][] = [
  {
    id: 12,
    parentId: null,
    name: 'Ундаа',
    defaultClassificationCode: null,
    skuFrom: null,
    skuTo: null,
    productCount: 1,
    childCount: 0,
  },
];
const MASTERS = {
  'GET /api/v1/uoms': () => list(UOMS),
  'GET /api/v1/categories': () => list(CATEGORIES),
};

const unit = (
  id: number,
  uomId: number,
  factorToBase: string,
  isBase: boolean,
): Schemas['ProductUnit'] => ({
  id,
  uomId,
  uomName: UOMS.find((uom) => uom.id === uomId)?.name ?? '',
  uomCode: UOMS.find((uom) => uom.id === uomId)?.code ?? null,
  fractional: false,
  factorToBase,
  isBase,
  isDefaultSales: false,
  isDefaultPurchase: false,
  measureUnit: null,
  effectiveMeasureUnit: null,
  supersededBy: null,
  supersededAt: null,
  barcodes: [],
});
const COLA: Schemas['ProductDetail'] = {
  id: 7,
  sku: '10023',
  name: 'Кока кола',
  categoryId: 12,
  vatType: 'VAT_ABLE',
  cityTax: null,
  classificationCode: null,
  taxProductCode: null,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  tracksLots: false,
  weightKg: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  units: [unit(70, 1, '1', true), unit(72, 3, '24', false)],
  images: [],
};
const COLA_ROW: Schemas['ProductListItem'] = {
  id: 7,
  sku: '10023',
  name: 'Кока кола',
  categoryId: 12,
  status: 'ACTIVE',
  saleReadyAt: '2026-10-01T00:00:00.000Z',
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: 70, uomId: 1, uomName: 'ш' },
  thumbUrl: null,
  weightKg: null,
  classificationCode: null,
  taxProductCode: null,
  units: [
    { id: 70, uomId: 1, uomName: 'ш', factorToBase: '1', isBase: true, barcodes: [] },
    { id: 72, uomId: 3, uomName: 'хайрцаг', factorToBase: '24', isBase: false, barcodes: [] },
  ],
};

const PRICED_UNITS: Schemas['PricedUnit'][] = [
  { productUnitId: 70, uomId: 1, uomCode: 'PCS', uomName: 'ш', factorToBase: '1', isBase: true },
  {
    productUnitId: 72,
    uomId: 3,
    uomCode: 'BOX',
    uomName: 'хайрцаг',
    factorToBase: '24',
    isBase: false,
  },
];
const DRINK_VALUES: Schemas['PriceProfileValues'] = {
  looseMarkupPct: '15.00',
  retailMarkupPct: '30.00',
  retailBulkMinQty: '24',
  retailBulkMarkupPct: '20.00',
  rounding: 'UP_50',
};
const priceProfile = (
  id: number,
  name: string,
  values: Schemas['PriceProfileValues'],
): Schemas['PriceProfile'] => ({
  id,
  name,
  archivedAt: null,
  current: { ...values, id: id * 10, validFrom: '2026-10-01', validTo: null },
  scheduled: [],
  history: [],
  productsToday: 0,
  createdAt: STAMP,
  updatedAt: STAMP,
});
const DRINKS = priceProfile(4, 'Жишээ: Ундаа', DRINK_VALUES);
const FOOD = priceProfile(5, 'Хүнс', {
  looseMarkupPct: '10.00',
  retailMarkupPct: '20.00',
  retailBulkMinQty: null,
  retailBulkMarkupPct: null,
  rounding: 'WHOLE',
});
const PROFILE_ROUTES = { 'GET /api/v1/price-profiles': () => list([DRINKS, FOOD]) };
const DRINKS_SUMMARY = [
  'Задгай +15%',
  'Супермаркет +30%',
  'Супермаркет бөөний (24+) +20%',
  mn.pricing.roundings.UP_50,
].join(' · ');

const terms = (fields: Partial<Schemas['PriceTerms']> = {}): Schemas['PriceTerms'] => ({
  id: 1,
  warehousePrice: '1000',
  profileId: 4,
  profileName: 'Жишээ: Ундаа',
  wholeUomId: 3,
  validFrom: TODAY,
  validTo: null,
  ...fields,
});
/** A warehouse price of 1,000₮ a piece on the drinks profile, the box counted whole. */
const priceView = (
  productId: number,
  fields: Partial<Schemas['ProductPriceView']> = {},
): Schemas['ProductPriceView'] => ({
  productId,
  today: TODAY,
  units: PRICED_UNITS,
  current: terms(),
  profile: { id: 4, name: 'Жишээ: Ундаа', archived: false, values: DRINK_VALUES },
  wholeUnitId: 72,
  problems: [],
  table: [
    {
      productUnitId: 70,
      wholesale: '1150',
      wholesaleBasis: 'LOOSE',
      retail: '1300',
      retailBulk: '1200',
    },
    {
      productUnitId: 72,
      wholesale: '24000',
      wholesaleBasis: 'WAREHOUSE',
      retail: '31200',
      retailBulk: '28800',
    },
  ],
  scheduled: [],
  history: [],
  ...fields,
});
const withoutTerms = (productId: number) =>
  priceView(productId, {
    current: null,
    profile: null,
    wholeUnitId: null,
    problems: ['NO_TERMS'],
    table: [],
  });

const program = (fields: Partial<Schemas['DiscountProgram']>): Schemas['DiscountProgram'] => ({
  id: 1,
  name: 'Хямдрал',
  list: 'WHOLESALE',
  scope: 'ORDER',
  measure: 'AMOUNT',
  effect: 'PERCENT',
  product: null,
  productUnit: null,
  thresholdUnit: null,
  categoryId: null,
  countUomId: null,
  validFrom: TODAY,
  validTo: null,
  status: 'ACTIVE',
  steps: [],
  createdAt: STAMP,
  updatedAt: STAMP,
  ...fields,
});
const BOX_UNIT = { id: 72, uomName: 'хайрцаг', factorToBase: '24' };
const BOX_PRICE = program({
  id: 9,
  name: 'Кока бөөний',
  scope: 'PRODUCT',
  measure: 'QTY',
  effect: 'PRICE',
  product: { id: 7, sku: '10023', name: 'Кока кола' },
  productUnit: BOX_UNIT,
  thresholdUnit: BOX_UNIT,
  steps: [
    { threshold: '240', value: '22800' },
    { threshold: '480', value: '22000' },
  ],
});

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);

describe('pricing menu', () => {
  it('shows discounts and the calculator to every user', async () => {
    renderApp('/system/status', signedIn(WORKER_ME));
    const nav = await findSidebar();
    expect(within(nav).getByRole('link', { name: mn.nav.discounts })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: mn.nav.priceQuote })).toBeInTheDocument();
  });
});

describe('product prices card', () => {
  it('shows the warehouse price, the profile and each unit, and sets new terms', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      ...PROFILE_ROUTES,
      'GET /api/v1/products/7': () => json(COLA),
      'GET /api/v1/product-prices': () =>
        json(
          priceView(7, {
            scheduled: [terms({ id: 2, warehousePrice: '1100', validFrom: '2026-11-01' })],
          }),
        ),
      'POST /api/v1/product-prices': () =>
        json(priceView(7, { current: terms({ id: 3, warehousePrice: '1100' }) })),
    });
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('1,000₮ / ш')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Жишээ: Ундаа' })).toHaveAttribute(
      'href',
      '/pricing/profiles/4',
    );
    expect(screen.getByText(DRINKS_SUMMARY)).toBeInTheDocument();
    for (const text of ['1,150₮', '1,300₮', '1,200₮', '24,000₮', '31,200₮', '28,800₮']) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
    expect(screen.getByText(mn.pricing.card.bases.LOOSE)).toBeInTheDocument();
    expect(screen.getByText('2026-11-01-с 1,100₮ · Жишээ: Ундаа')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.pricing.card.set }));
    const dialog = within(await screen.findByRole('dialog'));
    const price = await dialog.findByLabelText(mn.pricing.dialog.warehousePrice);
    expect(price).toHaveValue('1000');
    expect(dialog.getByLabelText(mn.pricing.dialog.profile)).toHaveValue('4');
    expect(dialog.getByLabelText(mn.pricing.dialog.wholeUnit)).toHaveValue('3');
    // The same terms from today change nothing.
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(dialog.getByText(mn.pricing.dialog.noChanges)).toBeInTheDocument();

    // 1,100₮ a piece: the box 26,400₮, loose 1,265₮ up to 1,300₮, supermarket 1,450₮ (bulk 1,350₮).
    await user.clear(price);
    await user.type(price, '1100');
    const preview = within(dialog.getByRole('region', { name: mn.pricing.dialog.preview }));
    for (const text of ['1,300₮', '1,450₮', '1,350₮', '26,400₮', '34,800₮', '32,400₮']) {
      expect(preview.getByText(text)).toBeInTheDocument();
    }
    // A profile without a bulk price has no bulk column.
    await user.selectOptions(dialog.getByLabelText(mn.pricing.dialog.profile), 'Хүнс');
    expect(preview.getByText('1,210₮')).toBeInTheDocument();
    expect(preview.queryByText(mn.pricing.card.columns.retailBulk)).toBeNull();
    await user.selectOptions(dialog.getByLabelText(mn.pricing.dialog.profile), 'Жишээ: Ундаа');

    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [posted] = calls(fetchMock, 'POST', '/api/v1/product-prices');
    expect(await posted?.clone().json()).toEqual({
      productId: 7,
      validFrom: TODAY,
      warehousePrice: '1100',
      profileId: 4,
      wholeUomId: 3,
    });
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent(mn.pricing.dialog.saved);
    expect(await screen.findByText('1,100₮ / ш')).toBeInTheDocument();
  });

  it('prices a product without packs at the warehouse price, without a whole unit', async () => {
    const piecesOnly = { ...COLA, units: [unit(70, 1, '1', true)] };
    const pieces = PRICED_UNITS.filter((priced) => priced.isBase);
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      ...PROFILE_ROUTES,
      'GET /api/v1/products/7': () => json(piecesOnly),
      'GET /api/v1/product-prices': () => json({ ...withoutTerms(7), units: pieces }),
      'POST /api/v1/product-prices': () => json(priceView(7, { units: pieces, wholeUnitId: null })),
    });
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText(mn.pricing.card.problems.NO_TERMS)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.pricing.card.set }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(await dialog.findByText(mn.pricing.dialog.noPacks)).toBeInTheDocument();
    expect(dialog.queryByLabelText(mn.pricing.dialog.wholeUnit)).toBeNull();
    await user.type(dialog.getByLabelText(mn.pricing.dialog.warehousePrice), '500');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    expect(dialog.getByText(mn.pricing.dialog.profileRequired)).toBeInTheDocument();
    await user.selectOptions(dialog.getByLabelText(mn.pricing.dialog.profile), 'Хүнс');
    await user.click(dialog.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [posted] = calls(fetchMock, 'POST', '/api/v1/product-prices');
    expect(await posted?.clone().json()).toEqual({
      productId: 7,
      validFrom: TODAY,
      warehousePrice: '500',
      profileId: 5,
      wholeUomId: null,
    });
  });

  it('lets only the price clerk change the terms and says what is wrong with them', async () => {
    renderApp(
      '/catalog/products/7',
      signedIn(WORKER_ME, {
        ...MASTERS,
        'GET /api/v1/products/7': () => json(COLA),
        'GET /api/v1/product-prices': () =>
          json(priceView(7, { wholeUnitId: null, problems: ['GONE'] })),
      }),
    );
    expect(await screen.findByText(mn.pricing.card.problems.GONE)).toBeInTheDocument();
    expect(screen.getByText('1,000₮ / ш')).toBeInTheDocument();
    expect(screen.queryByText(mn.pricing.card.noPacks)).toBeNull();
    expect(screen.queryByRole('button', { name: mn.pricing.card.set })).toBeNull();
  });
});

describe('discount programs', () => {
  it('lists programs with their targets, steps and dates', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/discount-programs': () =>
        list([
          BOX_PRICE,
          program({
            id: 2,
            name: 'Ундааны хямдрал',
            scope: 'CATEGORY',
            measure: 'QTY',
            categoryId: 12,
            countUomId: 3,
            validFrom: '2026-11-01',
            validTo: '2026-12-01',
            status: 'SCHEDULED',
            steps: [{ threshold: '50', value: '2' }],
          }),
          program({
            id: 3,
            name: 'Их захиалга',
            effect: 'AMOUNT',
            steps: [{ threshold: '1000000', value: '20000' }],
          }),
        ]),
    });
    renderApp('/pricing/discounts', fetchMock);
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('10 хайрцаг+ → 22,800₮')).toBeInTheDocument();
    for (const text of [
      'Кока кола (хайрцаг)',
      '20 хайрцаг+ → 22,000₮',
      '«Ундаа» ангилал',
      '50 хайрцаг+ → 2%',
      '2026-11-01 – 2026-11-30',
      'Захиалгын нийт дүн',
      '1,000,000₮+ → −20,000₮',
    ]) {
      expect(within(table).getByText(text)).toBeInTheDocument();
    }
    const [request] = calls(fetchMock, 'GET', '/api/v1/discount-programs');
    expect(new URL(request?.url ?? '').searchParams.get('status')).toBe('ACTIVE');
  });

  it('creates a product program: thresholds typed in boxes, sent in pieces', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/products': () => list([COLA_ROW]),
      'GET /api/v1/products/7': () => json(COLA),
      'POST /api/v1/discount-programs': () => json(BOX_PRICE, 201),
      'GET /api/v1/discount-programs/9': () => json(BOX_PRICE),
    });
    const { router } = renderApp('/pricing/discounts/new', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.common.save }));
    expect(screen.getByRole('alert')).toHaveTextContent(mn.pricing.programs.issues.NAME_REQUIRED);

    await user.type(screen.getByLabelText(mn.pricing.programs.fields.name), 'Кока бөөний');
    await user.type(screen.getByRole('searchbox', { name: mn.inventory.productSearch }), 'кока');
    await user.click(
      await screen.findByRole('button', { name: `${mn.pricing.programs.pickProduct}: Кока кола` }),
    );
    const productUnit = await screen.findByLabelText(mn.pricing.programs.fields.productUnit);
    await user.selectOptions(
      productUnit,
      await within(productUnit).findByRole('option', { name: '1 хайрцаг = 24 ш' }),
    );
    const thresholdUnit = screen.getByLabelText(mn.pricing.programs.fields.thresholdUnit);
    await user.selectOptions(
      thresholdUnit,
      within(thresholdUnit).getByRole('option', { name: '1 хайрцаг = 24 ш' }),
    );
    await user.selectOptions(screen.getByLabelText(mn.pricing.programs.fields.effect), 'PRICE');
    await user.type(screen.getByLabelText('Хэдээс (хайрцаг)'), '10');
    await user.type(screen.getByLabelText(mn.pricing.programs.stepHeads.PRICE), '22800');
    await user.click(screen.getByRole('button', { name: mn.common.save }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/pricing/discounts/9'));
    const [posted] = calls(fetchMock, 'POST', '/api/v1/discount-programs');
    expect(await posted?.clone().json()).toEqual({
      name: 'Кока бөөний',
      list: 'WHOLESALE',
      scope: 'PRODUCT',
      measure: 'QTY',
      effect: 'PRICE',
      productId: 7,
      productUnitId: 72,
      thresholdUnitId: 72,
      categoryId: null,
      countUomId: null,
      validFrom: TODAY,
      validTo: null,
      steps: [{ threshold: '240', value: '22800' }],
    });
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
  });
});

describe('price calculator', () => {
  it('prices a test cart in whole packs and loose pieces and explains every discount', async () => {
    const applied = (
      programId: number,
      name: string,
      fields: Partial<Schemas['AppliedDiscount']>,
    ): Schemas['AppliedDiscount'] => ({
      programId,
      name,
      scope: 'CATEGORY',
      effect: 'PERCENT',
      threshold: '1',
      value: '2',
      amount: null,
      ...fields,
    });
    const fetchMock = signedIn(WORKER_ME, {
      ...MASTERS,
      'GET /api/v1/products': () => list([COLA_ROW]),
      'GET /api/v1/products/7': () => json(COLA),
      'POST /api/v1/pricing/quote': () =>
        json({
          list: 'WHOLESALE',
          date: TODAY,
          lines: [
            {
              productId: 7,
              productUnitId: 70,
              qty: '25',
              qtyBase: '25',
              priced: true,
              problem: null,
              parts: [
                {
                  productUnitId: 72,
                  uomName: 'хайрцаг',
                  factorSnapshot: '24',
                  qty: '1',
                  qtyBase: '24',
                  basis: 'WAREHOUSE',
                  listPrice: '24000',
                  unitPrice: '22800',
                  subtotal: '22800',
                  discountAmount: '456',
                  total: '22344',
                  applied: [
                    applied(1, 'Бөөний', {
                      scope: 'PRODUCT',
                      effect: 'PRICE',
                      threshold: '24',
                      value: '22800',
                    }),
                    applied(2, 'Ундаа', { amount: '456' }),
                  ],
                },
                {
                  productUnitId: 70,
                  uomName: 'ш',
                  factorSnapshot: '1',
                  qty: '1',
                  qtyBase: '1',
                  basis: 'LOOSE',
                  listPrice: '1150',
                  unitPrice: '1150',
                  subtotal: '1150',
                  discountAmount: '23',
                  total: '1127',
                  applied: [applied(2, 'Ундаа', { amount: '23' })],
                },
              ],
              subtotal: '23950',
              discountAmount: '479',
              total: '23471',
            },
          ],
          subtotal: '23950',
          discountTotal: '479',
          total: '23471',
        }),
    });
    renderApp('/pricing/quote', fetchMock);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: mn.inventory.productSearch }),
      'кока',
    );
    await user.click(await screen.findByRole('button', { name: `${mn.inventory.add}: Кока кола` }));
    const qty = await screen.findByLabelText(`${mn.pricing.quote.qty}: Кока кола`);
    await user.clear(qty);
    await user.type(qty, '25');
    await user.click(screen.getByRole('button', { name: mn.pricing.quote.calculate }));

    // 25 pieces: one whole box at the warehouse price and one loose piece.
    expect(await screen.findByText('1 хайрцаг')).toBeInTheDocument();
    expect(screen.getByText('1 ш')).toBeInTheDocument();
    expect(screen.getByText(mn.pricing.bases.WAREHOUSE)).toBeInTheDocument();
    expect(screen.getByText(mn.pricing.bases.LOOSE)).toBeInTheDocument();
    expect(screen.getByText('Бөөний: 22,800₮')).toBeInTheDocument();
    expect(screen.getByText('Ундаа: 2% (−456₮)')).toBeInTheDocument();
    expect(screen.getByText('Ундаа: 2% (−23₮)')).toBeInTheDocument();
    expect(screen.getByText('Нийт: 23,950₮ − 479₮ хямдрал = 23,471₮')).toBeInTheDocument();
    const [posted] = calls(fetchMock, 'POST', '/api/v1/pricing/quote');
    expect(await posted?.clone().json()).toEqual({
      list: 'WHOLESALE',
      date: TODAY,
      lines: [{ productUnitId: 70, qty: '25' }],
    });
  });
});

describe('products waiting for their prices', () => {
  const waiting = (id: number, sku: string, name: string): Schemas['ProductListItem'] => ({
    ...COLA_ROW,
    id,
    sku,
    name,
    saleReadyAt: null,
  });
  const ROWS = [waiting(7, '10023', 'Кока кола'), waiting(8, '10024', 'Цай')];

  it('lists the waiting products, completes one from its prices and refuses one without them', async () => {
    let completions = 0;
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      ...PROFILE_ROUTES,
      'GET /api/v1/products': (request) => {
        const query = new URL(request.url).searchParams;
        expect([query.get('saleReady'), query.get('status')]).toEqual(['false', 'ACTIVE']);
        return list(ROWS);
      },
      'GET /api/v1/product-prices/current': () =>
        json([
          {
            productId: 7,
            warehousePrice: '1000',
            profileId: 4,
            profileName: 'Жишээ: Ундаа',
            wholeUomId: 3,
          },
        ]),
      'GET /api/v1/product-prices': (request) =>
        new URL(request.url).searchParams.get('productId') === '8'
          ? json(withoutTerms(8))
          : json(priceView(7)),
      'POST /api/v1/product-prices': () =>
        json(priceView(8, { current: terms({ id: 9, warehousePrice: '1200' }) })),
      'POST /api/v1/pricing/sale-ready': async (request) => {
        completions += 1;
        const { productIds } = (await request.clone().json()) as { productIds: number[] };
        return completions === 2
          ? json({ completed: productIds, alreadyComplete: [] })
          : json(
              {
                type: 'https://tugeel.local/errors/PRICE_MISSING',
                title: 'PRICE_MISSING',
                status: 422,
                code: 'PRICE_MISSING',
                params: { count: 1 },
                errors: [
                  {
                    path: 'productIds.0',
                    constraint: 'priced',
                    message: productIds[0] === 7 ? '10023' : '10024',
                  },
                ],
              },
              422,
            );
      },
    });
    renderApp('/catalog/pending', fetchMock);
    const user = userEvent.setup();

    expect(
      await screen.findByRole('heading', { name: mn.pricing.pending.title }),
    ).toBeInTheDocument();
    expect(
      within(await findSidebar()).getByRole('link', { name: mn.nav.pendingProducts }),
    ).toBeInTheDocument();
    const cola = (await screen.findByText('Кока кола')).closest('tr');
    const tea = screen.getByText('Цай').closest('tr');
    if (!cola || !tea) throw new Error('no row');
    expect(await within(cola).findByText('1,000₮')).toBeInTheDocument();
    expect(within(cola).getByText('Жишээ: Ундаа')).toBeInTheDocument();
    expect(within(tea).getByText(mn.pricing.card.none)).toBeInTheDocument();

    // The price dialog starts today, proposes the box as whole and names what is missing.
    await user.click(screen.getByRole('button', { name: 'Үнэ оруулах: 10024' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('10024 Цай')).toBeInTheDocument();
    expect(await dialog.findByText(`Өнөөдрөөс (${TODAY}) эхэлнэ`)).toBeInTheDocument();
    expect(dialog.getByLabelText(mn.pricing.dialog.wholeUnit)).toHaveValue('3');
    const complete = dialog.getByRole('button', { name: mn.pricing.saleReady.complete });
    await user.click(complete);
    expect(dialog.getByText(mn.pricing.dialog.invalidPrice)).toBeInTheDocument();
    await user.type(dialog.getByLabelText(mn.pricing.dialog.warehousePrice), '1200');
    await user.click(complete);
    expect(dialog.getByText(mn.pricing.dialog.profileRequired)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/product-prices')).toHaveLength(0);
    await user.selectOptions(dialog.getByLabelText(mn.pricing.dialog.profile), 'Жишээ: Ундаа');
    expect(dialog.getByText(DRINKS_SUMMARY)).toBeInTheDocument();
    expect(dialog.getByText('28,800₮')).toBeInTheDocument();

    // The terms are saved; a refused completion says what it needs and a retry keeps its key.
    await user.click(complete);
    expect(await dialog.findByText(mn.pricing.dialog.termsRequired)).toBeInTheDocument();
    await user.click(complete);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('status')).toHaveTextContent(mn.pricing.saleReady.completed);
    const saved = calls(fetchMock, 'POST', '/api/v1/product-prices');
    expect(saved).toHaveLength(1);
    expect(await saved[0]?.clone().json()).toEqual({
      productId: 8,
      validFrom: TODAY,
      warehousePrice: '1200',
      profileId: 4,
      wholeUomId: 3,
    });
    const [refusedFirst, completed] = calls(fetchMock, 'POST', '/api/v1/pricing/sale-ready');
    expect(await completed?.clone().json()).toEqual({ productIds: [8] });
    expect(completed?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(completed?.headers.get('Idempotency-Key')).toBe(
      refusedFirst?.headers.get('Idempotency-Key'),
    );

    // The ticked rows complete at once; a product whose terms do not work is named.
    const bulk = screen.getByRole('button', { name: mn.pricing.saleReady.complete });
    expect(bulk).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: '10023 сонгох' }));
    await user.click(screen.getByRole('button', { name: 'Сонгосон 1 барааг бүрэн болгох' }));
    expect(
      await screen.findByText(mn.pricing.pending.missing.replace('{{skus}}', '10023')),
    ).toBeInTheDocument();
    const [, , refused] = calls(fetchMock, 'POST', '/api/v1/pricing/sale-ready');
    expect(await refused?.clone().json()).toEqual({ productIds: [7] });
  }, 15_000);

  it('keeps the list from a user who does not enter prices', async () => {
    const fetchMock = signedIn(WORKER_ME, MASTERS);
    renderApp('/catalog/pending', fetchMock);
    expect(await screen.findByText(mn.errors.FORBIDDEN)).toBeInTheDocument();
    expect(
      within(await findSidebar()).queryByRole('link', { name: mn.nav.pendingProducts }),
    ).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/products')).toHaveLength(0);
  });
});
