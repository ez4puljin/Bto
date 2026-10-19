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
import { ADMIN_ME, json, problem, renderApp, signedIn } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';

type Schemas = components['schemas'];
type Detail = Schemas['ReceiptDetail'];

const form = mn.inventory.receipt.form;
const COLA_UNIT = `${COLA.name} (хайрцаг)`;

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
  binId: SHELF.id,
  binCode: SHELF.code,
  lotId: null,
};

const NO_TOTALS: Schemas['ReceiptTotals'] = {
  docTotal: '0',
  vatTotal: '0',
  costTotal: '0',
  pricedLines: 0,
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

const summary = (id: number, warehouseId = 1): Schemas['ReceiptSummary'] => ({
  id,
  number: `GR-2026-00000${id}`,
  warehouseId,
  supplierId: 3,
  supplierName: SUPPLIER.name,
  supplierDocNo: null,
  status: 'POSTED',
  costingStatus: 'PENDING',
  lineCount: 1,
  effectiveDate: '2026-10-11',
  createdAt: STAMP,
});

/** The routes every receipt editor reads: warehouses and the money accounts. */
const editorRoutes = {
  'GET /api/v1/warehouses': warehouses,
  'GET /api/v1/receipts/payment-accounts': () => json(ACCOUNTS),
};

const scanBox = () => screen.getByRole('textbox', { name: mn.inventory.scanLabel });

describe('a new receipt (owner 2026-10-18: one window like Erkhet)', () => {
  it('opens old links on the page and on the receipt', async () => {
    const { router } = renderApp(
      '/inventory/receipts?new=1',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts': () => list([]),
        'GET /api/v1/suppliers': () => list([SUPPLIER]),
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

  it('creates the draft with its header on the first scan and carries on', async () => {
    let receipt: Detail = { ...DRAFT, supplierDocDate: businessDate(), lines: [BOX_LINE] };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/suppliers': () => list([SUPPLIER]),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/receipts': () => json(receipt, 201),
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }] };
        return json(receipt);
      },
    });
    const { router } = renderApp('/inventory/receipts/new', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    await waitFor(() => expect(header.getByLabelText(mn.inventory.warehouse)).toHaveValue('1'));
    expect(header.getByLabelText(form.date)).toHaveValue(businessDate());
    // The supplier search has the cursor: the warehouse is chosen already.
    const supplier = header.getByLabelText(mn.inventory.receipts.supplier);
    await waitFor(() => expect(supplier).toHaveFocus());

    // A product before the supplier asks for the header and makes nothing.
    await user.click(scanBox());
    await wedgeScan('4006381333931');
    expect(await screen.findByText(form.needHeader)).toBeInTheDocument();
    expect(header.getByText(mn.validation.required)).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/v1/receipts')).toHaveLength(0);

    await user.type(header.getByLabelText(mn.inventory.receipts.supplier), 'МСМ');
    await user.click(await header.findByRole('button', { name: /МСМ ХХК/ }));
    await user.type(header.getByLabelText(mn.inventory.receipt.supplierDocNo), 'П-123');
    // Warehouse staff never see a price field.
    expect(screen.queryByLabelText(form.unitPrice)).toBeNull();
    await user.click(scanBox());
    await wedgeScan('4006381333931');

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
    const posts = calls(fetchMock, 'POST', '/api/v1/receipts');
    expect(posts).toHaveLength(1);
    expect(await bodyOf(posts[0])).toEqual({
      warehouseId: 1,
      supplierId: 3,
      supplierDocNo: 'П-123',
      supplierDocDate: businessDate(),
      paymentMethod: 'CREDIT',
      lines: [{ productUnitId: 77, enteredQty: '1' }],
    });
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    expect(
      await screen.findByRole('heading', { name: mn.inventory.draftNo.replace('{{id}}', '5') }),
    ).toBeInTheDocument();
    // The same page carries on: the scan box keeps the cursor and the next scan counts on.
    expect(scanBox()).toHaveFocus();
    expect(screen.getByText('+1 хайрцаг (24 ш) · Кока кола')).toBeInTheDocument();
    await wedgeScan('4006381333931');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '2',
    });
    expect(JSON.parse(localStorage.getItem('tugeel.inventory.lastWarehouse.v1') ?? '{}')).toEqual({
      '2': { receipt: 1 },
    });
  }, 20_000);
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
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const header = within(await screen.findByRole('region', { name: form.header }));
    // The bank accounts are offered; none is chosen yet.
    expect(await header.findByRole('option', { name: 'Хаан банк' })).toBeInTheDocument();
    expect(header.queryByRole('option', { name: 'Касс' })).toBeNull();

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
    // The warehouse stays as the draft was made.
    expect(header.getByLabelText(mn.inventory.warehouse)).toHaveAttribute('readonly');

    await user.click(screen.getByRole('button', { name: mn.inventory.receipt.post }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
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

  it('reads only once posted', async () => {
    renderApp(
      '/inventory/receipts/5',
      signedIn(WAREHOUSE_ME, {
        ...editorRoutes,
        'GET /api/v1/receipts/5': () =>
          json({ ...POSTED, paymentMethod: 'CASH', moneyAccountName: 'Касс' }),
      }),
    );
    const header = within(await screen.findByRole('region', { name: form.header }));
    expect(header.getByText('П-123')).toBeInTheDocument();
    expect(header.getByText(mn.inventory.receipt.paymentMethods.CASH)).toBeInTheDocument();
    expect(header.getByText('Касс')).toBeInTheDocument();
    expect(header.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` })).toBeNull();
    expect(screen.queryByRole('button', { name: mn.inventory.receipt.post })).toBeNull();
  });
});

describe('receipt lines', () => {
  it('puts a scanned product on the scanned shelf, counts repeats and posts with Enter', async () => {
    let receipt = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
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
    expect(await screen.findByText('+1 хайрцаг (24 ш) · Кока кола')).toBeInTheDocument();

    // The same barcode again counts one more box on that line.
    await user.type(scan, '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '2',
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

  it('adds «Тоо» of the scanned unit and returns to 1', async () => {
    let receipt: Detail = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/bins/lookup': () => problem('NOT_FOUND', 404),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/receipts/5/lines': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '24', qtyBase: '576' }] };
        return json(receipt, 201);
      },
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '26', qtyBase: '624' }] };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const qty = await screen.findByLabelText(mn.inventory.scanQty);
    await user.clear(qty);
    await user.type(qty, '24');
    await user.type(scanBox(), '4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'POST', '/api/v1/receipts/5/lines')[0])).toEqual({
      productUnitId: 77,
      enteredQty: '24',
    });
    expect(await screen.findByText('+24 хайрцаг (576 ш) · Кока кола')).toBeInTheDocument();
    expect(qty).toHaveValue('1');

    // A scan that lands in «Тоо» uses the typed quantity, never the barcode's digits.
    await user.clear(qty);
    await user.type(qty, '2');
    await new Promise((resolve) => setTimeout(resolve, 80));
    await wedgeScan('4006381333931');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '26',
    });
    expect(qty).toHaveValue('1');
  }, 15_000);

  it('sends a scan that lands in a line quantity to the scan box', async () => {
    let receipt: Detail = { ...DRAFT, lines: [BOX_LINE] };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = { ...receipt, lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }] };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const qty = await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` });
    await user.click(qty);
    await wedgeScan('4006381333931');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    // The scan counted one more box; the quantity never became the barcode.
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '2',
    });
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

describe('delivery-note prices (ADR-0078)', () => {
  /** A cost holder's draft: a unit price makes the amount, an amount stays as typed. */
  const pricedDraft = () => {
    let receipt: Detail = {
      ...DRAFT,
      totals: NO_TOTALS,
      lines: [
        { ...BOX_LINE, enteredQty: '2', qtyBase: '48', docUnitPrice: null, docAmount: null },
        { ...RICE_LINE, docUnitPrice: null, docAmount: null },
      ],
    };
    const fetchMock = signedIn(ADMIN_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json(receipt),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'POST /api/v1/receipts/5/lines': () => json(receipt, 201),
      'PATCH /api/v1/receipt-lines/1': () => {
        receipt = {
          ...receipt,
          lines: [
            {
              ...BOX_LINE,
              enteredQty: '2',
              qtyBase: '48',
              docUnitPrice: '24000',
              docAmount: '48000',
            },
            receipt.lines[1]!,
          ],
          totals: { docTotal: '48000', vatTotal: '0', costTotal: '48000', pricedLines: 1 },
        };
        return json(receipt);
      },
      'PATCH /api/v1/receipt-lines/2': () => {
        receipt = {
          ...receipt,
          lines: [receipt.lines[0]!, { ...RICE_LINE, docUnitPrice: null, docAmount: '5000' }],
          totals: { docTotal: '53000', vatTotal: '0', costTotal: '53000', pricedLines: 2 },
        };
        return json(receipt);
      },
    });
    return fetchMock;
  };

  it('saves a typed unit price or amount on the line as the field is left', async () => {
    const fetchMock = pricedDraft();
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const price = await screen.findByRole('textbox', { name: `${form.unitPrice}: ${COLA_UNIT}` });
    await user.type(price, '24000');
    // The amount shows what the price comes to.
    expect(screen.getByRole('textbox', { name: `${form.amount}: ${COLA_UNIT}` })).toHaveAttribute(
      'placeholder',
      '48,000',
    );
    await user.tab();
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      docUnitPrice: '24000',
    });

    const amount = screen.getByRole('textbox', { name: `${form.amount}: Будаа (ш)` });
    await user.type(amount, '5000{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')[0])).toEqual({
      docAmount: '5000',
    });
    const totals = within(screen.getByLabelText(mn.inventory.costing.total));
    expect(await totals.findAllByText('53,000₮')).toHaveLength(2);
    expect(totals.queryByText(form.vatTotal)).toBeNull();
    expect(
      screen.getByText(form.pricedHint.replace('{{priced}}', '2').replace('{{count}}', '2')),
    ).toBeInTheDocument();
  }, 15_000);

  it('adds a scanned product at «Нэгж үнэ», which then empties', async () => {
    const fetchMock = pricedDraft();
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const price = await screen.findByLabelText(form.unitPrice);
    await user.type(price, '1200');
    await user.click(scanBox());
    await wedgeScan('4006381333931');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    // The scanned box is on the first line already: one more at the typed price.
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '3',
      docUnitPrice: '1200',
    });
    expect(price).toHaveValue('');
  });

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
    expect(
      screen.getByText(form.pricedHint.replace('{{priced}}', '1').replace('{{count}}', '2')),
    ).toBeInTheDocument();
  });

  it('never shows prices to the warehouse', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      ...editorRoutes,
      'GET /api/v1/receipts/5': () => json({ ...DRAFT, lines: [BOX_LINE] }),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    expect(
      await screen.findByRole('textbox', { name: `${mn.inventory.qty}: ${COLA_UNIT}` }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(form.unitPrice)).toBeNull();
    expect(screen.queryByRole('columnheader', { name: form.unitPrice })).toBeNull();
    expect(screen.queryByLabelText(mn.inventory.costing.total)).toBeNull();
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
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: Будаа (ш)` }),
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
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: Будаа (ш)` }),
    );
    await user.click(screen.getByRole('button', { name: form.saveCosts }));
    expect(await screen.findByText(mn.errors.CONFLICT)).toBeInTheDocument();
    expect(amount).toHaveValue('48000');
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
    expect(calls(fetchMock, 'GET', '/api/v1/receipts/5/costing')).toHaveLength(0);
  });
});
