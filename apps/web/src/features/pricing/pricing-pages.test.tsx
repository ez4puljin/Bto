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

const priceView = (
  productUnitId: number,
  uomName: string,
  factorToBase: string,
  current: Schemas['UnitPriceView']['current'],
  scheduled: Schemas['PricePeriod'][] = [],
): Schemas['UnitPriceView'] => ({
  productUnitId,
  uomName,
  factorToBase,
  isBase: factorToBase === '1',
  current,
  scheduled,
  history: [],
});
const PRICES: Schemas['ProductPrices'] = {
  productId: 7,
  today: TODAY,
  wholesale: [
    priceView(
      70,
      'ш',
      '1',
      {
        price: '1000',
        source: 'UNIT',
        period: { id: 1, price: '1000', validFrom: TODAY, validTo: null },
      },
      [{ id: 2, price: '1100', validFrom: '2026-11-01', validTo: null }],
    ),
    priceView(72, 'хайрцаг', '24', { price: '24000', source: 'DERIVED', period: null }),
  ],
  retail: [priceView(70, 'ш', '1', null), priceView(72, 'хайрцаг', '24', null)],
};

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
  it('shows each unit in both lists and sets the changed prices from a day', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...MASTERS,
      'GET /api/v1/products/7': () => json(COLA),
      'GET /api/v1/unit-prices': () => json(PRICES),
      'POST /api/v1/unit-prices': () =>
        json({
          ...PRICES,
          wholesale: [
            PRICES.wholesale[0],
            priceView(72, 'хайрцаг', '24', {
              price: '22800',
              source: 'UNIT',
              period: { id: 3, price: '22800', validFrom: TODAY, validTo: null },
            }),
          ],
        }),
    });
    renderApp('/catalog/products/7', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByText('1,000₮')).toBeInTheDocument();
    expect(screen.getByText('24,000₮')).toBeInTheDocument();
    expect(screen.getByText(mn.pricing.card.derived)).toBeInTheDocument();
    expect(screen.getByText('2026-11-01-с 1,100₮')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: mn.pricing.card.set }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(`${mn.pricing.lists.WHOLESALE}: 1 хайрцаг = 24 ш`),
      '22800',
    );
    await user.click(within(dialog).getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const [posted] = calls(fetchMock, 'POST', '/api/v1/unit-prices');
    expect(await posted?.clone().json()).toEqual({
      productId: 7,
      validFrom: TODAY,
      entries: [{ list: 'WHOLESALE', productUnitId: 72, price: '22800' }],
    });
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByText('22,800₮')).toBeInTheDocument();
  });

  it('lets only pricing managers change prices', async () => {
    renderApp(
      '/catalog/products/7',
      signedIn(WORKER_ME, {
        ...MASTERS,
        'GET /api/v1/products/7': () => json(COLA),
        'GET /api/v1/unit-prices': () => json(PRICES),
      }),
    );
    expect(await screen.findByText('1,000₮')).toBeInTheDocument();
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
  it('prices a test cart and explains every discount', async () => {
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
              productUnitId: 72,
              qty: '50',
              qtyBase: '1200',
              priced: true,
              problem: null,
              listPrice: '24000',
              priceSource: 'UNIT',
              unitPrice: '22800',
              subtotal: '1140000',
              discountAmount: '33972',
              total: '1106028',
              applied: [
                {
                  programId: 1,
                  name: 'Бөөний',
                  scope: 'PRODUCT',
                  effect: 'PRICE',
                  threshold: '240',
                  value: '22800',
                  amount: null,
                },
                {
                  programId: 2,
                  name: 'Ундаа',
                  scope: 'CATEGORY',
                  effect: 'PERCENT',
                  threshold: '50',
                  value: '2',
                  amount: '22800',
                },
                {
                  programId: 3,
                  name: 'Их захиалга',
                  scope: 'ORDER',
                  effect: 'PERCENT',
                  threshold: '1000000',
                  value: '1',
                  amount: '11172',
                },
              ],
            },
          ],
          subtotal: '1140000',
          discountTotal: '33972',
          total: '1106028',
        }),
    });
    renderApp('/pricing/quote', fetchMock);
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole('searchbox', { name: mn.inventory.productSearch }),
      'кока',
    );
    await user.click(await screen.findByRole('button', { name: `${mn.inventory.add}: Кока кола` }));
    await user.selectOptions(
      await screen.findByLabelText(`${mn.pricing.quote.unit}: Кока кола`),
      await screen.findByRole('option', { name: '1 хайрцаг = 24 ш' }),
    );
    const qty = screen.getByLabelText(`${mn.pricing.quote.qty}: Кока кола`);
    await user.clear(qty);
    await user.type(qty, '50');
    await user.click(screen.getByRole('button', { name: mn.pricing.quote.calculate }));

    expect(await screen.findByText('Бөөний: 22,800₮')).toBeInTheDocument();
    expect(screen.getByText('Ундаа: 2% (−22,800₮)')).toBeInTheDocument();
    expect(screen.getByText('Их захиалга: 1% (−11,172₮)')).toBeInTheDocument();
    expect(screen.getByText('Нийт: 1,140,000₮ − 33,972₮ хямдрал = 1,106,028₮')).toBeInTheDocument();
    const [posted] = calls(fetchMock, 'POST', '/api/v1/pricing/quote');
    expect(await posted?.clone().json()).toEqual({
      list: 'WHOLESALE',
      date: TODAY,
      lines: [{ productUnitId: 72, qty: '50' }],
    });
  });
});
