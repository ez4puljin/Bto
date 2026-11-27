import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { addDays, businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import { formatTugrik } from '@/lib/money';
import { ADMIN_ME, json, problem, renderApp, signedIn, WORKER_ME } from '@/test/render-app';
import type {
  BasePriceEvent,
  BasePriceView,
  LocationPriceRule,
  SupplierPriceRule,
} from './supplier-pricing-api';

const text = mn.pricing.settings;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const requestKey = (request: Request) => {
  const key = request.headers.get('Idempotency-Key');
  expect(key).toMatch(UUID);
  return key ?? '';
};
const STAMP = '2026-11-23T03:00:00.000Z';
const supplier: SupplierPriceRule = {
  supplierId: 3,
  supplierName: 'Нийлүүлэгч А',
  enabled: true,
  markupPct: '10',
  markupAmount: '100',
  rounding: 'WHOLE',
  version: 7,
  updatedAt: STAMP,
};
const location: LocationPriceRule = {
  warehouseId: 2,
  warehouseName: 'Дэлгүүр',
  enabled: true,
  priceType: 'ADDITIONAL',
  markupPct: '15',
  markupAmount: '0',
  rounding: 'UP_50',
  version: 3,
  updatedAt: STAMP,
};
const event: BasePriceEvent = {
  id: 10,
  productId: 7,
  sku: '10007',
  name: 'Гурил',
  kind: 'RECEIPT',
  reason: null,
  oldBasePrice: '11000',
  newBasePrice: '12100',
  overrodeManual: true,
  receiptId: 5,
  receiptNumber: 'IN-0005',
  createdAt: STAMP,
  createdBy: 1,
};
const product: BasePriceView = {
  productId: 7,
  sku: '10007',
  name: 'Гурил',
  baseUomName: 'ш',
  basePrice: '11000',
  source: 'MANUAL',
  lastEventId: 10,
  receiptId: null,
  receiptNumber: null,
  history: [
    { ...event, kind: 'MANUAL', receiptId: null, receiptNumber: null, newBasePrice: '11000' },
  ],
};
const warehouses = [
  {
    id: 2,
    name: 'Дэлгүүр',
    kind: 'RETAIL',
    status: 'ACTIVE',
    branchId: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  },
];
const common = {
  'GET /api/v1/me/notifications/summary': () => json({ unread: 0, notices: [] }),
  'GET /api/v1/me/notifications': () => json({ data: [], nextCursor: null }),
  'GET /api/v1/pricing/supplier-rules': () => json([supplier]),
  'GET /api/v1/pricing/location-rules': () => json([location]),
  'GET /api/v1/pricing/base-prices/7': () => json(product),
  'GET /api/v1/warehouses': () => json({ data: warehouses, nextCursor: null }),
};

describe('supplier receipt and location pricing settings', () => {
  it('marks a future legacy price as planned while keeping today’s base and immediate manual form unchanged', async () => {
    const validFrom = addDays(businessDate(), 2);
    renderApp(
      '/pricing/settings?tab=products&productId=7',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/base-prices/7': () =>
          json({
            ...product,
            history: [
              {
                ...event,
                kind: 'MANUAL',
                receiptId: null,
                receiptNumber: null,
                newBasePrice: '14000',
                validFrom,
              },
            ],
          }),
      }),
    );
    expect(
      await screen.findByText(text.effectiveFrom.replace('{{date}}', validFrom)),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(text.manualPrice)).toHaveValue('11,000');
    expect(screen.getByText(formatTugrik('14000'))).toBeInTheDocument();
  });
  it('saves a supplier percentage and amount using the displayed rule version', async () => {
    const user = userEvent.setup();
    let current = supplier;
    const writes: unknown[] = [];
    renderApp(
      '/pricing/settings',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/supplier-rules': () => json([current]),
        'PUT /api/v1/pricing/supplier-rules/3': async (request) => {
          requestKey(request);
          const body = await request.json();
          writes.push(body);
          current = { ...current, ...body, version: 8 };
          return json(current);
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Нийлүүлэгч А/ }));
    const pct = await screen.findByLabelText(text.markupPct);
    await user.clear(pct);
    await user.type(pct, '12.5');
    const amount = screen.getByLabelText(text.markupAmount);
    await user.clear(amount);
    await user.type(amount, '300');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(writes).toEqual([
        {
          expectedVersion: 7,
          enabled: true,
          markupPct: '12.5',
          markupAmount: '300',
          rounding: 'WHOLE',
        },
      ]),
    );
  });

  it('switches a configured location to the base price without carrying its old uplift', async () => {
    const user = userEvent.setup();
    let current = location;
    const writes: unknown[] = [];
    renderApp(
      '/pricing/settings?tab=locations',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/location-rules': () => json([current]),
        'PUT /api/v1/pricing/location-rules/2': async (request) => {
          requestKey(request);
          const body = await request.json();
          writes.push(body);
          current = { ...current, ...body, version: 4 };
          return json(current);
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Дэлгүүр/ }));
    await user.click(await screen.findByRole('tab', { name: text.types.BASE }));
    expect(screen.queryByLabelText(text.markupPct)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(writes).toEqual([
        {
          expectedVersion: 3,
          enabled: true,
          priceType: 'BASE',
          markupPct: '0',
          markupAmount: '0',
          rounding: 'WHOLE',
        },
      ]),
    );
  });

  it('preserves manual price and reason across a same-price source conflict, then explicitly reviews the new event', async () => {
    const user = userEvent.setup();
    let current = product;
    const writes: Record<string, unknown>[] = [];
    const keys: string[] = [];
    renderApp(
      '/pricing/settings?tab=products&productId=7',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/base-prices/7': () => json(current),
        'PUT /api/v1/pricing/base-prices/7': async (request) => {
          keys.push(requestKey(request));
          const body = await request.json();
          writes.push(body);
          if (writes.length === 1) {
            current = { ...current, lastEventId: 11, source: 'RECEIPT' };
            return problem('CONFLICT', 409);
          }
          current = { ...current, lastEventId: 12, basePrice: body.price, source: 'MANUAL' };
          return json(current);
        },
      }),
    );
    const price = await screen.findByLabelText(text.manualPrice);
    await user.clear(price);
    await user.type(price, '12000');
    await user.type(screen.getByLabelText(text.reason), 'Зах зээлийн үнэ');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await screen.findByRole('button', { name: text.reviewCurrent });
    expect(price).toHaveValue('12,000');
    expect(screen.getByLabelText(text.reason)).toHaveValue('Зах зээлийн үнэ');
    expect(screen.getByRole('button', { name: mn.common.save })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: text.reviewCurrent }));
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toEqual({
      expectedPrice: '11000',
      expectedEventId: 10,
      price: '12000',
      reason: 'Зах зээлийн үнэ',
    });
    expect(writes[1]).toEqual({
      expectedPrice: '11000',
      expectedEventId: 11,
      price: '12000',
      reason: 'Зах зээлийн үнэ',
    });
    expect(keys[1]).not.toBe(keys[0]);
  });

  it('reuses a request key for the same failed intent and replaces it when the edited body changes', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let current = supplier;
    renderApp(
      '/pricing/settings',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/supplier-rules': () => json([current]),
        'PUT /api/v1/pricing/supplier-rules/3': async (request) => {
          keys.push(requestKey(request));
          if (keys.length < 3) throw new TypeError('response lost');
          current = { ...current, ...(await request.json()), version: 8 };
          return json(current);
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Нийлүүлэгч А/ }));
    const pct = await screen.findByLabelText(text.markupPct);
    await user.clear(pct);
    await user.type(pct, '12.5');
    const save = screen.getByRole('button', { name: mn.common.save });
    await user.click(save);
    await waitFor(() => {
      expect(keys).toHaveLength(1);
      expect(save).toBeEnabled();
    });
    await user.click(save);
    await waitFor(() => {
      expect(keys).toHaveLength(2);
      expect(save).toBeEnabled();
    });
    expect(keys[1]).toBe(keys[0]);
    await user.clear(pct);
    await user.type(pct, '14');
    await user.click(save);
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('keeps the location type disabled while its save is pending', async () => {
    const user = userEvent.setup();
    let release: (() => void) | undefined;
    let current = location;
    renderApp(
      '/pricing/settings?tab=locations',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/location-rules': () => json([current]),
        'PUT /api/v1/pricing/location-rules/2': async (request) => {
          requestKey(request);
          const body = await request.json();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          current = { ...current, ...body, version: 4 };
          return json(current);
        },
      }),
    );
    await user.click(await screen.findByRole('button', { name: /Дэлгүүр/ }));
    await user.click(await screen.findByRole('tab', { name: text.types.BASE }));
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(release).toBeDefined());
    try {
      const other = screen.getByRole('tab', { name: text.types.ADDITIONAL });
      expect(other).toBeDisabled();
      await user.click(other);
      expect(screen.getByRole('tab', { name: text.types.BASE })).toHaveAttribute(
        'aria-selected',
        'true',
      );
    } finally {
      release?.();
    }
  });

  it('protects a manual draft when switching settings sections', async () => {
    const user = userEvent.setup();
    const { router } = renderApp(
      '/pricing/settings?tab=products&productId=7',
      signedIn(ADMIN_ME, common),
    );
    await user.type(await screen.findByLabelText(text.reason), 'Хадгалаагүй тайлбар');
    await user.click(screen.getByRole('tab', { name: text.tabs.locations }));
    const dialog = await screen.findByRole('dialog', { name: text.unsavedTitle });
    await user.click(within(dialog).getByRole('button', { name: mn.common.cancel }));
    expect(router.state.location.search).toContain('productId=7');
    expect(screen.getByLabelText(text.reason)).toHaveValue('Хадгалаагүй тайлбар');
  });

  it('opens receipt price changes from the bell with old/new and manual overwrite evidence', async () => {
    const user = userEvent.setup();
    const mine = {
      id: 99,
      kind: 'PRICE_CHANGED',
      orderId: null,
      orderNumber: '',
      customerName: '',
      orderTotal: null,
      invoiceNumber: null,
      callId: null,
      callbackId: null,
      phone: null,
      read: false,
      createdAt: STAMP,
      priceChange: {
        receiptId: 5,
        receiptNumber: 'IN-0005',
        changeCount: 1,
        warningCount: 0,
        overwrittenManualCount: 1,
        changes: [
          {
            eventId: 10,
            productId: 7,
            sku: '10007',
            name: 'Гурил',
            oldBasePrice: '11000',
            newBasePrice: '12100',
            overrodeManual: true,
          },
        ],
        warnings: [],
      },
    };
    const { router } = renderApp(
      '/pricing/settings?tab=products',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/me/notifications/summary': () => json({ unread: 1, notices: [] }),
        'GET /api/v1/me/notifications': () => json({ data: [mine], nextCursor: null }),
        'POST /api/v1/me/notifications/read': () => json({ unread: 0 }),
        'GET /api/v1/pricing/receipt-price-changes/5': () => json([event]),
      }),
    );
    await user.click(await screen.findByTitle(mn.shell.notifications));
    await user.click(await screen.findByRole('menuitem', { name: /IN-0005/ }));
    await waitFor(() => expect(router.state.location.search).toBe('?receiptId=5'));
    expect(await screen.findByText(text.overrodeManual)).toBeInTheDocument();
    expect(screen.getByText(formatTugrik('11000'))).toBeInTheDocument();
    expect(screen.getByText(formatTugrik('12100'))).toBeInTheDocument();
  });

  it('shows unknown printed price as a localized warning without a fabricated new price', async () => {
    renderApp(
      '/pricing/settings?receiptId=5',
      signedIn(ADMIN_ME, {
        ...common,
        'GET /api/v1/pricing/receipt-price-changes/5': () =>
          json([
            {
              ...event,
              kind: 'SKIPPED',
              reason: 'PRINTED_PRICE_MISSING',
              newBasePrice: null,
              overrodeManual: false,
            },
          ]),
      }),
    );
    expect(await screen.findByText(text.warnings.PRINTED_PRICE_MISSING)).toBeInTheDocument();
    expect(screen.getByText(text.notUpdated)).toBeInTheDocument();
  });

  it('keeps profile reading in the unified hub without admitting a reader to private price tabs', async () => {
    const fetchMock = signedIn(WORKER_ME, {
      ...common,
      'GET /api/v1/price-profiles': () => json({ data: [], nextCursor: null }),
    });
    renderApp('/pricing/settings', fetchMock);
    expect(await screen.findByRole('heading', { name: text.title })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: text.tabs.profiles })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of [text.tabs.suppliers, text.tabs.locations, text.tabs.products]) {
      expect(screen.queryByRole('tab', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: mn.common.save })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([request]) =>
        /\/pricing\/(supplier-rules|location-rules|base-prices)/.test(request.url),
      ),
    ).toBe(false);
  });

  it.each(['suppliers', 'locations', 'products'])(
    'refuses a direct %s tab URL for an employee without price rights',
    async (tab) => {
      const fetchMock = signedIn(WORKER_ME, common);
      renderApp(`/pricing/settings?tab=${tab}`, fetchMock);
      expect(await screen.findByText(mn.errors.forbiddenTitle)).toBeInTheDocument();
      expect(screen.queryByText(text.description)).not.toBeInTheDocument();
      expect(fetchMock.mock.calls.some(([request]) => /\/pricing\//.test(request.url))).toBe(false);
    },
  );

  it('refuses a receipt-change deep link for an employee without price rights', async () => {
    renderApp('/pricing/settings?receiptId=5', signedIn(WORKER_ME, common));
    expect(await screen.findByText(mn.errors.forbiddenTitle)).toBeInTheDocument();
    expect(screen.queryByText(text.description)).not.toBeInTheDocument();
  });

  it('prints the selected warehouse price instead of an unqualified global profile price', async () => {
    const bodies: unknown[] = [];
    renderApp(
      '/pricing/labels/print?ids=7&warehouseId=2',
      signedIn(ADMIN_ME, {
        ...common,
        'POST /api/v1/product-prices/labels': async (request) => {
          bodies.push(await request.json());
          return json({
            date: '2026-11-23',
            labels: [
              {
                productId: 7,
                sku: '10007',
                name: 'Гурил',
                unitName: 'ш',
                retail: '12650',
                retailBulk: null,
                retailBulkMinQty: null,
              },
            ],
            missing: [],
          });
        },
      }),
    );
    expect(await screen.findByText(formatTugrik('12650'))).toBeInTheDocument();
    expect(bodies).toEqual([{ productIds: [7], warehouseId: 2 }]);
    expect(await screen.findByRole('option', { name: 'Дэлгүүр' })).toBeInTheDocument();
  });
});
