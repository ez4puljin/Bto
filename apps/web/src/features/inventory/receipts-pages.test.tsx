import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { businessDate } from '@tugeel/shared/time';
import { describe, expect, it } from 'vitest';
import {
  ACCOUNTANT_ME,
  BOX_LINE,
  bodyOf,
  calls,
  COLA,
  COLA_BOX,
  DRAFT,
  list,
  SHELF,
  STAMP,
  UUID,
  WAREHOUSE_ME,
  WH1,
  warehouses,
} from '@/test/inventory-fixtures';
import { ADMIN_ME, json, type Me, problem, renderApp, signedIn } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';

type Schemas = components['schemas'];
type Detail = Schemas['ReceiptDetail'];
type Handler = (request: Request) => Response | Promise<Response>;

const form = mn.inventory.receipt.form;
const panelText = mn.inventory.receipt.panel;
const COLA_UNIT = `${COLA.name} (хайрцаг)`;
const RICE_UNIT = 'Будаа (ш)';

/** A warehouse clerk who also keeps the delivery-note prices, but sets no sale prices. */
const COST_CLERK_ME: Me = {
  ...WAREHOUSE_ME,
  id: 6,
  username: 'clerk',
  permissions: [...WAREHOUSE_ME.permissions, 'inventory.costs.manage'],
};

const SUPPLIER: Schemas['SupplierListItem'] = {
  id: 3,
  code: '010',
  name: 'МСМ ХХК',
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
  productCount: 0,
};

const ACCOUNTS: Schemas['ReceiptPaymentAccount'][] = [
  { id: 21, code: '101', name: 'Касс', kind: 'CASH' },
  { id: 22, code: '111', name: 'Хаан банк', kind: 'BANK' },
  { id: 23, code: '112', name: 'Голомт банк', kind: 'BANK' },
];

const WH2 = { id: 2, name: 'Хоёрдугаар агуулах' };

const RICE_LINE: Schemas['ReceiptLine'] = {
  id: 2,
  productId: 11,
  productSku: '11',
  productName: 'Будаа',
  productUnitId: 110,
  unitName: 'ш',
  enteredQty: '5',
  factorSnapshot: '1',
  qtyBase: '5',
  warehouseId: WH1.id,
  warehouseName: WH1.name,
  binId: SHELF.id,
  binCode: SHELF.code,
  lotId: null,
  weightKg: null,
  salePrice: null,
};

const NO_TOTALS: Schemas['ReceiptTotals'] = {
  docTotal: '0',
  discountTotal: '0',
  netTotal: '0',
  vatTotal: '0',
  costTotal: '0',
  pricedLines: 0,
};

/** A product as the panel's search finds it. */
const item = (
  id: number,
  name: string,
  units: Schemas['ProductListUnit'][],
): Schemas['ProductListItem'] => ({
  id,
  sku: String(id),
  name,
  categoryId: 1,
  status: 'ACTIVE',
  saleReadyAt: null,
  vatType: 'VAT_ABLE',
  cityTax: null,
  baseUnit: { id: units[0]!.id, uomId: 1, uomName: units[0]!.uomName },
  thumbUrl: null,
  weightKg: null,
  classificationCode: null,
  taxProductCode: null,
  units,
});
const piece = (id: number): Schemas['ProductListUnit'] => ({
  id,
  uomId: 1,
  uomName: 'ш',
  factorToBase: '1',
  isBase: true,
  barcodes: [],
});
const RICE_ITEM = item(11, 'Будаа', [piece(110)]);
const COLA_ITEM = item(COLA.id, COLA.name, [
  piece(70),
  { id: 77, uomId: 2, uomName: 'хайрцаг', factorToBase: '24', isBase: false, barcodes: [] },
]);
/** A new product nobody gave a home warehouse yet. */
const TEA_ITEM = item(12, 'Цай', [piece(120)]);

const home = (productId: number): Schemas['ProductLocation'] => ({
  id: productId,
  warehouseId: WH1.id,
  productId,
  isHome: true,
  defaultBinId: SHELF.id,
  defaultBinCode: SHELF.code,
  minQty: null,
  maxQty: null,
});

const stockOf = (product: Schemas['ProductListItem'], onHand: string): Schemas['ProductStock'] => ({
  product: {
    id: product.id,
    sku: product.sku,
    name: product.name,
    baseUnitName: 'ш',
    thumbUrl: null,
  },
  onHand,
  available: onHand,
  warehouses: [
    { warehouseId: WH1.id, onHand, sellableOnHand: onHand, reserved: '0', available: onHand },
  ],
});

/** The routes the line panel reads: the search, the home warehouse, stock, last and sale prices. */
const panelRoutes: Record<string, Handler> = {
  'GET /api/v1/products/lookup': (request) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    return json(
      [RICE_ITEM, COLA_ITEM, TEA_ITEM].filter((product) => product.name.toLowerCase().includes(q)),
    );
  },
  'GET /api/v1/product-locations': (request) => {
    const productId = Number.parseInt(new URL(request.url).searchParams.get('productId') ?? '', 10);
    return list(productId === TEA_ITEM.id ? [] : [home(productId)]);
  },
  'GET /api/v1/stock/products/11': () => json(stockOf(RICE_ITEM, '44')),
  'GET /api/v1/stock/products/10': () => json(stockOf(COLA_ITEM, '240')),
  'GET /api/v1/receipts/last-prices': () =>
    json([
      {
        productId: 11,
        receiptId: 4,
        receiptNumber: 'GR-2026-000004',
        date: '2026-10-01',
        supplierName: SUPPLIER.name,
        unitName: 'ш',
        unitPrice: '1100',
        basePrice: '1100',
      },
    ] satisfies Schemas['LastReceiptPrice'][]),
  'GET /api/v1/product-prices/current': (request) =>
    json(
      new URL(request.url).searchParams
        .getAll('productIds')
        .filter((id) => id === '11')
        .map((id) => ({
          productId: Number.parseInt(id, 10),
          warehousePrice: '1500',
          profileId: 1,
          profileName: 'Үндсэн',
          wholeUomId: null,
        })) satisfies Schemas['CurrentTerms'][],
    ),
};

/** The routes every receipt editor reads: warehouses, the money accounts and the panel's. */
const editorRoutes: Record<string, Handler> = {
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/receipts/payment-accounts': () => json(ACCOUNTS),
  'GET /api/v1/suppliers': () => list([SUPPLIER]),
  ...panelRoutes,
};

const POSTED: Detail = {
  ...DRAFT,
  status: 'POSTED',
  number: 'GR-2026-000005',
  costingStatus: 'PENDING',
  recostUntil: '2026-11-30',
  effectiveDate: '2026-10-11',
  lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }],
};

const COSTED_POSTED: Detail = {
  ...POSTED,
  totals: NO_TOTALS,
  lines: [
    { ...BOX_LINE, enteredQty: '2', qtyBase: '48', docUnitPrice: null, docAmount: null },
    { ...RICE_LINE, docUnitPrice: null, docAmount: null },
  ],
};

const summary = (id: number, fields: Partial<Schemas['ReceiptSummary']> = {}) =>
  ({
    id,
    number: `GR-2026-00000${id}`,
    supplierId: 3,
    supplierName: SUPPLIER.name,
    supplierDocNo: null,
    supplierDocDate: '2026-10-10',
    status: 'POSTED',
    costingStatus: 'PENDING',
    paymentMethod: 'CREDIT',
    lineCount: 1,
    effectiveDate: '2026-10-11',
    createdAt: STAMP,
    ...fields,
  }) satisfies Schemas['ReceiptSummary'];

const panel = () => within(screen.getByRole('region', { name: panelText.title }));
const findPanel = async () => within(await screen.findByRole('region', { name: panelText.title }));
const productSearch = () => panel().getByRole('searchbox', { name: mn.inventory.product });

/**
 * Types a figure, then Enter as a person would: four keys or more followed by Enter within 50 ms
 * read as a scanner's burst (WEDGE_DEFAULTS), which the panel looks up as a code.
 */
async function typeThenEnter(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.keyboard(text);
  await new Promise((resolve) => setTimeout(resolve, 80));
  await user.keyboard('{Enter}');
}

/** Types a product name into the panel's search and takes the first match with Enter. */
async function pickByKeyboard(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(productSearch());
  await user.keyboard(name);
  expect(await screen.findByRole('option', { name: new RegExp(name) })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await user.keyboard('{Enter}');
}

describe('the receipts list (ADR-0099)', () => {
  it('filters by the note dates, the supplier and a product, amounts for cost holders', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/suppliers/3': () => json(SUPPLIER),
      'GET /api/v1/stock/products/11': () => json(stockOf(RICE_ITEM, '44')),
      'GET /api/v1/receipts': () =>
        list([summary(5, { netAmount: '47700', paymentMethod: 'CASH', supplierDocNo: 'П-1' })]),
    });
    renderApp(
      '/inventory/receipts?from=2026-10-01&to=2026-10-31&supplierId=3&productId=11',
      fetchMock,
    );
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'GR-2026-000005' })).toHaveAttribute(
      'href',
      '/inventory/receipts/5',
    );
    const query = () =>
      new URL(calls(fetchMock, 'GET', '/api/v1/receipts').at(-1)!.url).searchParams;
    expect(query().get('from')).toBe('2026-10-01');
    expect(query().get('to')).toBe('2026-10-31');
    expect(query().get('supplierId')).toBe('3');
    expect(query().get('productId')).toBe('11');
    // The chips name what they filter by.
    const chip = (label: string) => screen.getByRole('button', { name: label }).parentElement!;
    await waitFor(() =>
      expect(chip(mn.inventory.receipts.clearSupplier)).toHaveTextContent(SUPPLIER.name),
    );
    await waitFor(() =>
      expect(chip(mn.inventory.receipts.clearProduct)).toHaveTextContent('11 Будаа'),
    );

    // The row: the note's date, the payment and the payable.
    expect(screen.getByRole('columnheader', { name: mn.inventory.receipts.amount })).toBeVisible();
    expect(screen.getByText('47,700₮')).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.receipt.paymentMethods.CASH)).toBeInTheDocument();
    expect(screen.getByText('2026-10-10')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: mn.inventory.warehouse })).toBeNull();

    // Clearing the supplier and the product takes them off the request.
    await user.click(screen.getByRole('button', { name: mn.inventory.receipts.clearSupplier }));
    await waitFor(() => expect(query().get('supplierId')).toBeNull());
    await user.click(screen.getByRole('button', { name: mn.inventory.receipts.clearProduct }));
    await waitFor(() => expect(query().get('productId')).toBeNull());
    expect(query().get('from')).toBe('2026-10-01');

    const to = screen.getByLabelText(mn.inventory.receipts.to);
    await user.clear(to);
    await waitFor(() => expect(query().get('to')).toBeNull());
    await user.type(to, '2026-10-15');
    await waitFor(() => expect(query().get('to')).toBe('2026-10-15'));
  }, 20_000);

  it('picks the supplier and the product to filter by', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/suppliers': () => list([SUPPLIER]),
      'GET /api/v1/suppliers/3': () => json(SUPPLIER),
      'GET /api/v1/products': () => list([COLA]),
      'GET /api/v1/stock/products/10': () => json(stockOf(COLA_ITEM, '240')),
      'GET /api/v1/receipts': () => list([summary(5, { netAmount: undefined })]),
    });
    renderApp('/inventory/receipts', fetchMock);
    const user = userEvent.setup();
    expect(await screen.findByRole('link', { name: 'GR-2026-000005' })).toBeInTheDocument();
    // The warehouse never sees an amount.
    expect(screen.queryByRole('columnheader', { name: mn.inventory.receipts.amount })).toBeNull();
    const query = () =>
      new URL(calls(fetchMock, 'GET', '/api/v1/receipts').at(-1)!.url).searchParams;

    await user.type(
      screen.getByPlaceholderText(mn.partners.supplierPicker.search),
      SUPPLIER.name.slice(0, 3),
    );
    await user.click(await screen.findByRole('button', { name: /МСМ ХХК/ }));
    await waitFor(() => expect(query().get('supplierId')).toBe('3'));

    await user.type(screen.getByLabelText(mn.inventory.receipts.product), 'Кока');
    await user.click(
      await screen.findByRole('button', {
        name: `${mn.inventory.receipts.pickProduct}: ${COLA.name}`,
      }),
    );
    await waitFor(() => expect(query().get('productId')).toBe(String(COLA.id)));
  }, 15_000);
});

describe('a new receipt (owner 2026-10-18 and 2026-10-23: one window like Erkhet)', () => {
  it('opens old links on the page and on the receipt', async () => {
    const { router } = renderApp(
      '/inventory/receipts?new=1',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts': () => list([]),
      }),
    );
    expect(
      await screen.findByRole('heading', { name: mn.inventory.receipt.newTitle }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/inventory/receipts/new');
    expect(screen.queryByRole('dialog')).toBeNull();
    await router.navigate('/inventory/receipts/5/costing');
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
  });

  it('asks for the supplier before the first line and makes nothing', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, editorRoutes);
    renderApp('/inventory/receipts/new', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    expect(header.getByLabelText(form.date)).toHaveValue(businessDate());
    // No warehouse to choose: each line goes to its product's home warehouse.
    expect(header.queryByLabelText(mn.inventory.warehouse)).toBeNull();
    await waitFor(() =>
      expect(header.getByLabelText(mn.inventory.receipts.supplier)).toHaveFocus(),
    );

    await pickByKeyboard(user, 'Будаа');
    const qty = panel().getByLabelText(mn.inventory.qty);
    await waitFor(() => expect(qty).toHaveFocus());
    // The warehouse never sees a price field.
    expect(panel().queryByLabelText(form.unitPrice)).toBeNull();
    expect(panel().queryByLabelText(panelText.salePrice)).toBeNull();
    await user.keyboard('{Enter}');
    expect(await header.findByText(mn.validation.required)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/receipts')).toHaveLength(0);
    // The chosen product stays in the panel.
    expect(panel().getByText('Будаа')).toBeInTheDocument();
  });

  it('creates the draft with its first line by keyboard and adds the same unit onto it', async () => {
    let receipt: Detail = {
      ...DRAFT,
      supplierDocDate: businessDate(),
      lines: [
        { ...RICE_LINE, enteredQty: '3', qtyBase: '3', docUnitPrice: '1200', docAmount: '3600' },
      ],
      totals: {
        ...NO_TOTALS,
        docTotal: '3600',
        costTotal: '3600',
        netTotal: '3600',
        pricedLines: 1,
      },
    };
    const fetchMock = signedIn(COST_CLERK_ME, {
      ...editorRoutes,
      'POST /api/v1/receipts': () => json(receipt, 201),
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipt-lines/2': () => {
        receipt = {
          ...receipt,
          lines: [{ ...receipt.lines[0]!, enteredQty: '5', qtyBase: '5', docAmount: '6000' }],
        };
        return json(receipt);
      },
    });
    const { router } = renderApp('/inventory/receipts/new', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    await user.type(header.getByLabelText(mn.inventory.receipts.supplier), 'МСМ');
    await user.click(await header.findByRole('button', { name: /МСМ ХХК/ }));

    // Search → Enter takes the match → «Тоо» → Enter → «Нэгж үнэ» → Enter adds the line.
    await pickByKeyboard(user, 'Будаа');
    const qty = panel().getByLabelText(mn.inventory.qty);
    await waitFor(() => expect(qty).toHaveFocus());
    // Under the fields: the home warehouse and its stock, the last receipt and the sale price.
    const info = within(await screen.findByLabelText(panelText.infoLabel));
    expect(await info.findByText(`${WH1.name} · үлдэгдэл 44`)).toBeInTheDocument();
    expect(await info.findByText('1,100₮/ш (1,100₮/ш) · 2026-10-01 · МСМ ХХК')).toBeInTheDocument();
    expect(await info.findByText('1,500₮')).toBeInTheDocument();
    await user.keyboard('3{Enter}');
    expect(qty).toHaveValue('3');
    const price = panel().getByLabelText(form.unitPrice);
    expect(price).toHaveFocus();
    await user.keyboard('1200');
    // The amount shows what the price comes to, and the markup on the sale price.
    expect(panel().getByLabelText(form.amount)).toHaveAttribute('placeholder', '3,600');
    expect(info.getByText('25.0%')).toBeInTheDocument();
    // A cost holder without the price right sets no sale price: «Нэгж үнэ» is the last field.
    expect(panel().queryByLabelText(panelText.salePrice)).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 80));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
    const posts = calls(fetchMock, 'POST', '/api/v1/receipts');
    expect(posts).toHaveLength(1);
    expect(await bodyOf(posts[0])).toEqual({
      supplierId: 3,
      supplierDocDate: businessDate(),
      paymentMethod: 'CREDIT',
      lines: [{ productUnitId: 110, enteredQty: '3', docUnitPrice: '1200' }],
    });
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByRole('heading', { name: mn.inventory.draftNo.replace('{{id}}', '5') }),
    ).toBeInTheDocument();
    // The cursor is back in the search box for the next product.
    await waitFor(() =>
      expect(panel().getByPlaceholderText(mn.inventory.productSearchPlaceholder)).toHaveFocus(),
    );
    // The panel empties for the next product.
    expect(await panel().findByRole('searchbox', { name: mn.inventory.product })).toHaveValue('');
    const lines = within(screen.getByRole('region', { name: form.linesTitle }));
    expect(lines.getByRole('cell', { name: WH1.name })).toBeInTheDocument();
    expect(lines.getByRole('cell', { name: '3,600' })).toBeInTheDocument();

    // The same product and unit again adds onto its line.
    await pickByKeyboard(user, 'Будаа');
    await waitFor(() => expect(panel().getByLabelText(mn.inventory.qty)).toHaveFocus());
    await user.keyboard('2{Enter}{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')[0])).toEqual({
      enteredQty: '5',
    });
    expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(0);
    expect(calls(fetchMock, 'POST', '/api/v1/receipts')).toHaveLength(1);
  }, 25_000);

  it('saves a new receipt with its header alone', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'POST /api/v1/receipts': () => json(DRAFT, 201),
      'GET /api/v1/receipts/5': () => json(DRAFT),
    });
    const { router } = renderApp('/inventory/receipts/new', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await header.findByText(mn.validation.required)).toBeInTheDocument();
    await user.type(header.getByLabelText(mn.inventory.receipts.supplier), 'МСМ');
    await user.click(await header.findByRole('button', { name: /МСМ ХХК/ }));
    await user.type(header.getByLabelText(mn.inventory.receipt.supplierDocNo), 'П-123');
    await user.type(header.getByLabelText(form.note), 'Сарын татан авалт');
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts')[0])).toEqual({
      supplierId: 3,
      supplierDocNo: 'П-123',
      supplierDocDate: businessDate(),
      note: 'Сарын татан авалт',
      paymentMethod: 'CREDIT',
    });
  });
});

describe('the line panel (ADR-0099 #3)', () => {
  it('reads a scan into the panel and counts the same code again', async () => {
    let receipt: Detail = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/receipts/5/lines': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }] };
        return json(receipt, 201);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    await findPanel();
    await user.click(productSearch());
    await wedgeScan('4006381333931');
    // The scanned unit is chosen; the cursor waits in «Тоо».
    expect(await panel().findByText(COLA.name)).toBeInTheDocument();
    const qty = panel().getByLabelText(mn.inventory.qty);
    await waitFor(() => expect(qty).toHaveFocus());
    expect(panel().getByLabelText(mn.inventory.unit)).toHaveValue('77');
    expect(
      await within(screen.getByLabelText(panelText.infoLabel)).findByText(
        `${WH1.name} · үлдэгдэл 240`,
      ),
    ).toBeInTheDocument();

    // The same code again counts one more box, never a quantity of the barcode's digits.
    await wedgeScan('4006381333931');
    await waitFor(() => expect(qty).toHaveValue('2'));
    expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(0);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')[0])).toEqual({
      productUnitId: 77,
      enteredQty: '2',
    });
    const lines = within(screen.getByRole('region', { name: form.linesTitle }));
    expect(await lines.findByRole('cell', { name: COLA.name })).toBeInTheDocument();
  }, 15_000);

  it('looks a typed code up with Enter and names an unknown one', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(DRAFT),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    await findPanel();
    await user.type(productSearch(), '999{Enter}');
    expect(
      await panel().findByText(mn.inventory.scanNotFound.replace('{{code}}', '999')),
    ).toBeInTheDocument();
    await user.type(productSearch(), '4006381333931{Enter}');
    expect(await panel().findByText(COLA.name)).toBeInTheDocument();
    expect(calls(fetchMock, 'GET', '/api/v1/barcodes/4006381333931')).toHaveLength(1);
  });

  it('asks a product without a home for its warehouse and sends it', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(DRAFT),
      'POST /api/v1/receipts/5/lines': () => json(DRAFT, 201),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    await findPanel();
    await pickByKeyboard(user, 'Цай');
    const warehouse = await panel().findByLabelText(panelText.homeLabel);
    expect(
      within(screen.getByLabelText(panelText.infoLabel)).getByText(panelText.noHome),
    ).toBeInTheDocument();
    // The warehouse is asked first, once the product's locations are in.
    await waitFor(() => expect(warehouse).toHaveFocus());
    // Without the warehouse nothing is added.
    await user.click(panel().getByRole('button', { name: mn.inventory.add }));
    expect(await panel().findByText(panelText.pickHome)).toBeInTheDocument();
    expect(warehouse).toHaveFocus();
    expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(0);

    await user.selectOptions(warehouse, WH1.name);
    await user.click(panel().getByRole('button', { name: mn.inventory.add }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')[0])).toEqual({
      productUnitId: 120,
      enteredQty: '1',
      warehouseId: 1,
    });
  });

  it('takes a unit and a new sale price from a price holder', async () => {
    const fetchMock = signedIn(ADMIN_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json({ ...DRAFT, totals: NO_TOTALS }),
      'POST /api/v1/receipts/5/lines': () => json(DRAFT, 201),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    await findPanel();
    await pickByKeyboard(user, 'Кока');
    // Two units: the cursor goes to «Нэгж» first.
    const unit = panel().getByLabelText(mn.inventory.unit);
    await waitFor(() => expect(unit).toHaveFocus());
    await user.selectOptions(unit, '77');
    expect(unit).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(panel().getByLabelText(mn.inventory.qty)).toHaveFocus();
    await user.keyboard('2{Enter}');
    expect(panel().getByLabelText(form.unitPrice)).toHaveFocus();
    await typeThenEnter(user, '24000');
    const sale = panel().getByLabelText(panelText.salePrice);
    expect(sale).toHaveFocus();
    await user.keyboard('abc{Enter}');
    expect(await panel().findByText(panelText.salePriceInvalid)).toBeInTheDocument();
    await user.clear(sale);
    await typeThenEnter(user, '1300');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')[0])).toEqual({
      productUnitId: 77,
      enteredQty: '2',
      docUnitPrice: '24000',
      salePrice: '1300',
    });
  }, 15_000);

  it('opens a line with «Засах» and saves its quantity and prices', async () => {
    let receipt: Detail = {
      ...DRAFT,
      totals: NO_TOTALS,
      lines: [
        BOX_LINE,
        { ...RICE_LINE, docUnitPrice: '1000', docAmount: '5000', salePrice: '1400' },
      ],
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipt-lines/2': () => {
        receipt = {
          ...receipt,
          lines: [
            BOX_LINE,
            {
              ...RICE_LINE,
              enteredQty: '7',
              qtyBase: '7',
              docUnitPrice: '1500',
              docAmount: '10500',
              salePrice: '2000',
            },
          ],
        };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const lines = within(await screen.findByRole('region', { name: form.linesTitle }));
    // The table only reads; a new sale price shows bold, else the one in force.
    expect(lines.queryByRole('textbox')).toBeNull();
    expect(lines.getByText('1,400')).toHaveClass('font-semibold');
    expect(lines.getByRole('columnheader', { name: form.markup })).toBeInTheDocument();

    await user.click(lines.getByRole('button', { name: `${mn.common.edit}: ${RICE_UNIT}` }));
    const edit = within(screen.getByRole('region', { name: panelText.editTitle }));
    const qty = edit.getByLabelText(mn.inventory.qty);
    expect(qty).toHaveValue('5');
    expect(edit.getByLabelText(form.unitPrice)).toHaveValue('1000');
    expect(edit.getByLabelText(panelText.salePrice)).toHaveValue('1400');
    // The line keeps its product and unit.
    expect(edit.getByLabelText(mn.inventory.unit)).toBeDisabled();
    expect(edit.queryByRole('button', { name: panelText.changeProduct })).toBeNull();

    await user.clear(qty);
    await user.type(qty, '7');
    await user.clear(edit.getByLabelText(form.unitPrice));
    await user.type(edit.getByLabelText(form.unitPrice), '1500');
    await user.clear(edit.getByLabelText(panelText.salePrice));
    await user.type(edit.getByLabelText(panelText.salePrice), '2000');
    await user.click(edit.getByRole('button', { name: mn.common.save }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')[0])).toEqual({
      enteredQty: '7',
      docUnitPrice: '1500',
      salePrice: '2000',
    });
    // The edit ends: the panel is for new lines again.
    expect(await screen.findByRole('region', { name: panelText.title })).toBeInTheDocument();
    expect(await lines.findByText('2,000')).toBeInTheDocument();
  }, 15_000);

  it('removes a line', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json({ ...DRAFT, lines: [BOX_LINE, RICE_LINE] }),
      'DELETE /api/v1/receipt-lines/2': () => json({ ...DRAFT, lines: [BOX_LINE] }),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const lines = within(await screen.findByRole('region', { name: form.linesTitle }));
    await user.click(lines.getByRole('button', { name: `${mn.inventory.remove}: ${RICE_UNIT}` }));
    await waitFor(() => expect(lines.queryByRole('cell', { name: 'Будаа' })).toBeNull());
    expect(calls(fetchMock, 'DELETE', '/api/v1/receipt-lines/2')).toHaveLength(1);
  });

  it('reads no scan while the posting dialog is open', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json({ ...DRAFT, lines: [BOX_LINE] }),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: mn.inventory.receipt.post }));
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: mn.inventory.receipt.post })).toHaveFocus(),
    );
    await wedgeScan('4006381333931');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls(fetchMock, 'GET', '/api/v1/barcodes/4006381333931')).toHaveLength(0);
    expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/post')).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('the delivery note header', () => {
  it('saves each change of a draft and asks for the account before posting', async () => {
    let receipt: Detail = { ...DRAFT, paymentMethod: 'BANK', lines: [BOX_LINE] };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipts/5': async (request) => {
        const body = (await request.clone().json()) as Partial<Detail>;
        receipt = { ...receipt, ...body };
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
    const header = within(await screen.findByRole('region', { name: form.header }));
    // The bank accounts are offered; none is chosen yet.
    expect(await header.findByRole('option', { name: 'Хаан банк' })).toBeInTheDocument();
    expect(header.queryByRole('option', { name: 'Касс' })).toBeNull();
    // The warehouse never sees the discount.
    expect(header.queryByLabelText(form.discount)).toBeNull();

    await user.click(screen.getByRole('button', { name: mn.inventory.receipt.post }));
    expect(header.getByText(mn.validation.moneyAccountRequired)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Cash has one box: it is chosen with the method.
    await user.selectOptions(header.getByLabelText(form.payment), 'CASH');
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[0])).toEqual({
      paymentMethod: 'CASH',
      moneyAccountId: 21,
    });
    expect(header.getByLabelText(form.account)).toHaveValue('21');
    expect(header.queryByText(mn.validation.moneyAccountRequired)).toBeNull();

    const docNo = header.getByLabelText(mn.inventory.receipt.supplierDocNo);
    expect(docNo).toHaveValue('П-123');
    await user.clear(docNo);
    await user.type(docNo, 'П-124');
    await user.tab();
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(2));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[1])).toEqual({
      supplierDocNo: 'П-124',
    });

    await user.click(screen.getByRole('button', { name: mn.inventory.receipt.post }));
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() =>
      expect(dialog.getByRole('button', { name: mn.inventory.receipt.post })).toHaveFocus(),
    );
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: 'GR-2026-000001' })).toBeInTheDocument();
    const posts = calls(fetchMock, 'POST', '/api/v1/receipts/5/post');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('status')).toHaveTextContent('GR-2026-000001');
  }, 15_000);

  it('saves the discount when it is left, as a percentage or an amount', async () => {
    let receipt: Detail = {
      ...DRAFT,
      totals: { ...NO_TOTALS, docTotal: '48000', netTotal: '48000', costTotal: '48000' },
      lines: [
        { ...BOX_LINE, enteredQty: '2', qtyBase: '48', docUnitPrice: '24000', docAmount: '48000' },
      ],
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipts/5': async (request) => {
        const body = (await request.clone().json()) as Partial<Detail>;
        const discountTotal = body.discountPct ? '2400' : (body.discountAmount ?? '0');
        receipt = {
          ...receipt,
          ...body,
          totals: {
            ...receipt.totals!,
            discountTotal,
            netTotal: String(48000 - Number.parseInt(discountTotal, 10)),
          },
        };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    const discount = header.getByLabelText(form.discount);
    await user.type(discount, '5{Enter}');
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[0])).toEqual({
      discountPct: '5',
      discountAmount: null,
    });
    // The totals show the discount and the payable.
    const totals = within(screen.getByLabelText(mn.inventory.costing.total));
    expect(await totals.findByText(form.netTotal)).toBeInTheDocument();
    expect(totals.getByText('-2,400₮')).toBeInTheDocument();
    expect(totals.getByText('45,600₮')).toBeInTheDocument();
    // Leaving the same value saves nothing more.
    await user.tab();
    expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(1);

    // «₮» turns the figure into an amount at once; a new amount is saved with Enter.
    await user.selectOptions(header.getByLabelText(form.discountKind), '₮');
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(2));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[1])).toEqual({
      discountPct: null,
      discountAmount: '5',
    });
    await user.clear(discount);
    await user.type(discount, '1000{Enter}');
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(3));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[2])).toEqual({
      discountPct: null,
      discountAmount: '1000',
    });
    expect(await totals.findByText('47,000₮')).toBeInTheDocument();
  }, 15_000);

  it('shows a refused account on its field', async () => {
    const receipt: Detail = {
      ...DRAFT,
      paymentMethod: 'CASH',
      moneyAccountId: 21,
      lines: [BOX_LINE],
    };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipts/5': () =>
        json(
          {
            type: 'https://tugeel.local/errors/VALIDATION_FAILED',
            title: 'VALIDATION_FAILED',
            status: 422,
            code: 'VALIDATION_FAILED',
            errors: [{ path: 'moneyAccountId', constraint: 'kind', message: 'cash box' }],
          },
          422,
        ),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    await user.selectOptions(await header.findByLabelText(form.payment), 'BANK');
    expect(await header.findByText(mn.validation.moneyAccountRequired)).toBeInTheDocument();
    // The refusal undoes the change.
    expect(header.getByLabelText(form.payment)).toHaveValue('CASH');
  });

  it('reads only once posted, with the print links', async () => {
    renderApp(
      '/inventory/receipts/5',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts/5': () =>
          json({
            ...POSTED,
            paymentMethod: 'CASH',
            moneyAccountName: 'Касс',
            warehouses: [{ id: WH1.id, name: WH1.name }, WH2],
          }),
      }),
    );
    const header = within(await screen.findByRole('region', { name: form.header }));
    expect(header.getByText('П-123')).toBeInTheDocument();
    expect(header.getByText(mn.inventory.receipt.paymentMethods.CASH)).toBeInTheDocument();
    expect(header.getByText('Касс')).toBeInTheDocument();
    expect(header.getByText(`${WH1.name}, ${WH2.name}`)).toBeInTheDocument();
    expect(header.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('region', { name: panelText.title })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.inventory.receipt.post })).toBeNull();
    // Both papers open in a new tab.
    const document = screen.getByRole('link', { name: mn.inventory.receipt.print.document });
    expect(document).toHaveAttribute('href', '/inventory/receipts/5/print/document');
    expect(document).toHaveAttribute('target', '_blank');
    const lists = screen.getByRole('link', { name: mn.inventory.receipt.print.warehouse });
    expect(lists).toHaveAttribute('href', '/inventory/receipts/5/print/warehouse');
    expect(lists).toHaveAttribute('target', '_blank');
  });

  it('prints a draft too', async () => {
    renderApp(
      '/inventory/receipts/5',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts/5': () => json({ ...DRAFT, lines: [BOX_LINE] }),
      }),
    );
    expect(
      await screen.findByRole('link', { name: mn.inventory.receipt.print.document }),
    ).toHaveAttribute('href', '/inventory/receipts/5/print/document');
    expect(
      screen.getByRole('link', { name: mn.inventory.receipt.print.warehouse }),
    ).toHaveAttribute('href', '/inventory/receipts/5/print/warehouse');
  });
});

describe('delivery-note prices (ADR-0078, ADR-0099)', () => {
  it('shows the totals with the VAT taken out', async () => {
    renderApp(
      '/inventory/receipts/5',
      signedIn(ADMIN_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts/5': () =>
          json({
            ...DRAFT,
            supplierVatPayer: true,
            vatRatePct: '10',
            totals: {
              docTotal: '48000',
              discountTotal: '0',
              netTotal: '48000',
              vatTotal: '4363.64',
              costTotal: '43636.36',
              pricedLines: 1,
            },
            lines: [
              {
                ...BOX_LINE,
                enteredQty: '2',
                qtyBase: '48',
                docUnitPrice: '24000',
                docAmount: '48000',
              },
              { ...RICE_LINE, docUnitPrice: null, docAmount: null },
            ],
          }),
      }),
    );
    expect(await screen.findByText(form.vatNote.replace('{{rate}}', '10'))).toBeInTheDocument();
    const totals = within(screen.getByLabelText(mn.inventory.costing.total));
    expect(totals.getByText('48,000₮')).toBeInTheDocument();
    expect(totals.getByText(form.vatTotal)).toBeInTheDocument();
    expect(totals.getByText('4,363.64₮')).toBeInTheDocument();
    expect(totals.getByText('43,636.36₮')).toBeInTheDocument();
    // No discount: no payable line.
    expect(totals.queryByText(form.netTotal)).toBeNull();
    expect(
      screen.getByText(form.pricedHint.replace('{{priced}}', '1').replace('{{count}}', '2')),
    ).toBeInTheDocument();
    const lines = within(screen.getByRole('region', { name: form.linesTitle }));
    expect(lines.getByRole('cell', { name: '24,000' })).toBeInTheDocument();
  });

  it('never shows prices to the warehouse', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json({ ...DRAFT, lines: [BOX_LINE] }),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const lines = within(await screen.findByRole('region', { name: form.linesTitle }));
    expect(lines.getByRole('cell', { name: COLA.name })).toBeInTheDocument();
    expect(lines.queryByRole('columnheader', { name: form.unitPrice })).toBeNull();
    expect(lines.queryByRole('columnheader', { name: form.markup })).toBeNull();
    // The sale price per piece is for everyone.
    expect(lines.getByRole('columnheader', { name: form.salePrice })).toBeInTheDocument();
    expect(screen.queryByLabelText(form.unitPrice)).toBeNull();
    expect(screen.queryByLabelText(mn.inventory.costing.total)).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/receipts/last-prices')).toHaveLength(0);
  });
});

describe('costs of a posted receipt (ADR-0047 #1)', () => {
  it('takes a unit price or an amount per line and opens the next receipt waiting', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/warehouses': () => list([WH1]),
      'GET /api/v1/receipts/5': () => json(COSTED_POSTED),
      'GET /api/v1/receipts': () => list([summary(7), summary(5), summary(4)]),
      'PUT /api/v1/receipts/5/costs': () =>
        json({ ...COSTED_POSTED, costingStatus: 'COSTED', costingVersion: 1 }),
      'GET /api/v1/receipts/4': () => json({ ...COSTED_POSTED, id: 4, number: 'GR-2026-000004' }),
    });
    const { router } = renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const price = await screen.findByRole('textbox', { name: `${form.unitPrice}: ${COLA_UNIT}` });
    const next = screen.getByRole('button', { name: mn.inventory.costing.saveAndNext });
    expect(next).toBeDisabled();
    // Quantities stay as posted.
    expect(screen.queryByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` })).toBeNull();
    await user.type(price, '24000');
    expect(screen.getByRole('textbox', { name: `${form.amount}: ${COLA_UNIT}` })).toHaveAttribute(
      'placeholder',
      '48,000',
    );
    await user.click(
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: ${RICE_UNIT}` }),
    );
    await user.click(next);

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/4'));
    const put = calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')[0];
    expect(await bodyOf(put)).toEqual({
      costingVersion: 0,
      lines: [
        { lineId: 1, unitPrice: '24000' },
        { lineId: 2, freeGoods: true },
      ],
    });
    expect(put!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(await screen.findByRole('heading', { name: 'GR-2026-000004' })).toBeInTheDocument();
  }, 15_000);

  it('sends a changed discount with the costs', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/warehouses': () => list([WH1]),
      'GET /api/v1/receipts/5': () =>
        json({
          ...COSTED_POSTED,
          discountPct: '5',
          lines: [
            {
              ...BOX_LINE,
              enteredQty: '2',
              qtyBase: '48',
              docUnitPrice: '24000',
              docAmount: '48000',
            },
            { ...RICE_LINE, freeGoods: true },
          ],
        }),
      'GET /api/v1/receipts': () => list([summary(5)]),
      'PUT /api/v1/receipts/5/costs': () =>
        json({ ...COSTED_POSTED, costingStatus: 'COSTED', costingVersion: 1 }),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    const discount = header.getByLabelText(form.discount);
    expect(discount).toHaveValue('5');
    await user.clear(discount);
    await user.type(discount, '2500');
    await user.selectOptions(header.getByLabelText(form.discountKind), '₮');
    await user.click(screen.getByRole('button', { name: form.saveCosts }));
    await waitFor(() =>
      expect(calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')[0])).toEqual({
      costingVersion: 0,
      discountPct: null,
      discountAmount: '2500',
      lines: [
        { lineId: 1, unitPrice: '24000' },
        { lineId: 2, freeGoods: true },
      ],
    });
  });

  it('keeps what was typed when someone else costed it meanwhile', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/warehouses': () => list([WH1]),
      'GET /api/v1/receipts/5': () => json(COSTED_POSTED),
      'GET /api/v1/receipts': () => list([summary(5)]),
      'PUT /api/v1/receipts/5/costs': () => problem('CONFLICT', 409),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const amount = await screen.findByRole('textbox', { name: `${form.amount}: ${COLA_UNIT}` });
    await user.type(amount, '48000');
    await user.click(
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: ${RICE_UNIT}` }),
    );
    // The discount is not touched: it is not sent.
    await user.click(screen.getByRole('button', { name: form.saveCosts }));
    expect(await screen.findByText(mn.errors.CONFLICT)).toBeInTheDocument();
    expect(amount).toHaveValue('48000');
    expect(
      Object.keys((await bodyOf(calls(fetchMock, 'PUT', '/api/v1/receipts/5/costs')[0])) as object),
    ).toEqual(['costingVersion', 'lines']);
  });

  it('never shows costs to the warehouse', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(POSTED),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    expect(await screen.findByRole('heading', { name: POSTED.number ?? '' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: form.unitPrice })).toBeNull();
    expect(screen.queryByRole('button', { name: form.saveCosts })).toBeNull();
    expect(screen.queryByLabelText(form.discount)).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/receipts/5/costing')).toHaveLength(0);
  });
});
