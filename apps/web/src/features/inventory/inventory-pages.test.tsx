import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import { SYSTEM_ROLE_PERMISSIONS } from '@tugeel/shared/auth';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, type Me, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];
const STAMP = '2026-10-11T02:00:00.000Z';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const list = <T,>(data: T[], nextCursor: string | null = null) => json({ data, nextCursor });

const WAREHOUSE_ME: Me = {
  ...ADMIN_ME,
  id: 2,
  username: 'nyarav',
  fullName: 'Нярав Дорж',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.WAREHOUSE],
  roles: [{ id: 4, code: 'WAREHOUSE', name: null, isSystem: true }],
};
const ACCOUNTANT_ME: Me = {
  ...ADMIN_ME,
  id: 3,
  username: 'nyagtlan',
  fullName: 'Нягтлан Сараа',
  permissions: [...SYSTEM_ROLE_PERMISSIONS.ACCOUNTANT],
  roles: [{ id: 5, code: 'ACCOUNTANT', name: null, isSystem: true }],
};

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

const SHELF: Schemas['Bin'] = {
  id: 31,
  warehouseId: 1,
  code: 'A-01-03',
  name: null,
  type: 'STORAGE',
  sellable: true,
  status: 'ACTIVE',
  isSystem: false,
  pickSequence: null,
  archivedAt: null,
};

const COLA: Schemas['ProductSummary'] = {
  id: 10,
  sku: '10',
  name: 'Кока кола',
  categoryId: 1,
  brandId: null,
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

const DRAFT: Schemas['ReceiptDetail'] = {
  id: 5,
  number: null,
  warehouseId: 1,
  warehouseName: WH1.name,
  supplierId: 3,
  supplierCode: '010',
  supplierName: 'МСМ ХХК',
  supplierDocNo: 'П-123',
  supplierDocDate: null,
  status: 'DRAFT',
  costingStatus: null,
  note: null,
  effectiveDate: null,
  postedAt: null,
  createdAt: STAMP,
  updatedAt: STAMP,
  lines: [],
};
const BOX_LINE: Schemas['ReceiptLine'] = {
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
  lotId: null,
};

const calls = (fetchMock: ReturnType<typeof signedIn>, method: string, path: string) =>
  fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && new URL(request.url).pathname === path);
const bodyOf = async (request: Request | undefined) =>
  request ? ((await request.clone().json()) as unknown) : undefined;

describe('inventory menu', () => {
  it('shows the warehouse its documents and keeps the shelf setup for admins', async () => {
    renderApp('/system/status', signedIn(WAREHOUSE_ME));
    const nav = await screen.findByRole('navigation');
    expect(within(nav).getByText(mn.nav.groups.inventory)).toBeInTheDocument();
    for (const label of [mn.nav.stock, mn.nav.receipts, mn.nav.binMoves, mn.nav.adjustments]) {
      expect(within(nav).getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(within(nav).queryByRole('link', { name: mn.nav.bins })).toBeNull();
  });

  it('lets an accountant reach stock and receipts but not moves', async () => {
    renderApp('/system/status', signedIn(ACCOUNTANT_ME));
    const nav = await screen.findByRole('navigation');
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
    expect(await screen.findByText('48,000')).toBeInTheDocument();
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

describe('receipt editor', () => {
  it('puts a scanned product on the scanned shelf, counts repeats and posts once', async () => {
    let receipt = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/bins/lookup': (request) =>
        new URL(request.url).searchParams.get('code') === 'A-01-03'
          ? json(SHELF)
          : problem('NOT_FOUND', 404),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/receipts/5/lines': () => {
        receipt = { ...receipt, lines: [BOX_LINE] };
        return json(receipt, 201);
      },
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }] };
        return json(receipt);
      },
      'POST /api/v1/receipts/5/post': () => {
        receipt = {
          ...receipt,
          status: 'POSTED',
          number: 'GR-2026-000001',
          costingStatus: 'PENDING',
          effectiveDate: '2026-10-11',
        };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const scan = await screen.findByRole('textbox', { name: mn.inventory.scanLabel });

    await user.type(scan, 'A-01-03{Enter}');
    expect(await screen.findByText('Тавиур: A-01-03')).toBeInTheDocument();
    expect(new URL(calls(fetchMock, 'GET', '/api/v1/bins/lookup')[0]!.url).search).toBe(
      '?warehouseId=1&code=A-01-03',
    );

    await user.type(scan, '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')[0])).toEqual({
      productUnitId: 77,
      enteredQty: '1',
      binId: 31,
    });
    const qty = await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA.name}` });
    expect(qty).toHaveValue('1');

    // The same barcode again counts one more box on that line.
    await user.type(scan, '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '2',
    });

    await user.click(screen.getByRole('button', { name: mn.inventory.receipt.post }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.inventory.receipt.post }));
    expect(await screen.findByRole('heading', { name: 'GR-2026-000001' })).toBeInTheDocument();
    const posts = calls(fetchMock, 'POST', '/api/v1/receipts/5/post');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
  });

  it('sends a scan that lands in a quantity field to the scan box', async () => {
    let receipt: Schemas['ReceiptDetail'] = { ...DRAFT, lines: [BOX_LINE] };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }] };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup({ delay: null });
    const qty = await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA.name}` });
    await user.click(qty);
    await user.keyboard('4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    // The scan counted one more box; the quantity never became the barcode.
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '2',
    });
  });
});

describe('receipt costing', () => {
  it('sends line amounts and bonus lines with the version the form was opened at', async () => {
    const costing: Schemas['ReceiptCosting'] = {
      receiptId: 5,
      number: 'GR-2026-000001',
      status: 'POSTED',
      costingStatus: 'PENDING',
      costingVersion: 0,
      recostUntil: '2026-11-30',
      costedAt: null,
      total: null,
      lines: [
        {
          lineId: 1,
          productId: COLA.id,
          productName: COLA.name,
          unitName: 'хайрцаг',
          enteredQty: '2',
          qtyBase: '48',
          provisionalUnitCost: '0',
          amount: null,
          unitCost: null,
          freeGoods: false,
        },
        {
          lineId: 2,
          productId: 11,
          productName: 'Будаа',
          unitName: 'ш',
          enteredQty: '5',
          qtyBase: '5',
          provisionalUnitCost: '0',
          amount: null,
          unitCost: null,
          freeGoods: false,
        },
      ],
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/receipts/5/costing': () => json(costing),
      'PUT /api/v1/receipts/5/costs': () =>
        json({ ...costing, costingStatus: 'COSTED', costingVersion: 1, total: '48000.00' }),
    });
    renderApp('/inventory/receipts/5/costing', fetchMock);
    const user = userEvent.setup();
    const submit = await screen.findByRole('button', { name: mn.inventory.costing.submit });
    expect(submit).toBeDisabled();
    await user.type(
      screen.getByRole('textbox', { name: `${mn.inventory.costing.amount}: ${COLA.name}` }),
      '48000',
    );
    await user.click(
      screen.getByRole('checkbox', { name: `${mn.inventory.costing.freeGoods}: Будаа` }),
    );
    expect(screen.getAllByText('48,000').length).toBeGreaterThan(0);
    await user.click(submit);
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')).toHaveLength(1),
    );
    const put = calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')[0];
    expect(await bodyOf(put)).toEqual({
      costingVersion: 0,
      lines: [
        { lineId: 1, amount: '48000' },
        { lineId: 2, freeGoods: true },
      ],
    });
    expect(put!.headers.get('Idempotency-Key')).toMatch(UUID);
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
        name: `${mn.inventory.adjustment.unitCost}: ${COLA.name}`,
      }),
      '1550',
    );
    await user.click(screen.getByRole('button', { name: mn.inventory.adjustment.approve }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: mn.inventory.adjustment.approve }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/adjustments/9/post')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/adjustments/9/post')[0])).toEqual({
      costs: [{ lineId: 40, unitCost: '1550' }],
    });
  });
});

describe('shelf setup', () => {
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
    await user.click(await screen.findByRole('button', { name: mn.inventory.bins.preview }));
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
    await user.click(screen.getByRole('button', { name: mn.inventory.bins.createRange }));
    expect(await screen.findByText('29 тавиур нэмэгдлээ')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/bins/bulk')).toHaveLength(2);
  });
});
