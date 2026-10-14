import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
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
import { json, problem, renderApp, signedIn } from '@/test/render-app';

type Schemas = components['schemas'];

const SUPPLIER: Schemas['SupplierListItem'] = {
  id: 3,
  code: '010',
  name: 'МСМ ХХК',
  tin: null,
  phone: null,
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

const POSTED: Schemas['ReceiptDetail'] = {
  ...DRAFT,
  status: 'POSTED',
  number: 'GR-2026-000005',
  costingStatus: 'PENDING',
  effectiveDate: '2026-10-11',
  lines: [{ ...BOX_LINE, enteredQty: '2', qtyBase: '48' }],
};

const COSTING: Schemas['ReceiptCosting'] = {
  receiptId: 5,
  number: 'GR-2026-000005',
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

describe('creating a receipt (ADR-0047 #1)', () => {
  it('opens old links in the dialog and on the receipt', async () => {
    const { router } = renderApp(
      '/inventory/receipts/new',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts': () => list([]),
        'GET /api/v1/suppliers': () => list([SUPPLIER]),
      }),
    );
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(router.state.location.search).toBe('?new=1');
    await router.navigate('/inventory/receipts/5/costing');
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
  });

  it('starts with the warehouse chosen, then scans at once', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/receipts': () => list([]),
      'GET /api/v1/suppliers': () => list([SUPPLIER]),
      'POST /api/v1/receipts': () => json(DRAFT, 201),
      'GET /api/v1/receipts/5': () => json(DRAFT),
    });
    const { router } = renderApp('/inventory/receipts?new=1', fetchMock);
    const user = userEvent.setup();
    const dialog = within(await screen.findByRole('dialog'));
    await waitFor(() => expect(dialog.getByLabelText(mn.inventory.warehouse)).toHaveValue('1'));
    // The supplier search has the cursor: the warehouse is chosen already.
    const supplier = dialog.getByLabelText(mn.inventory.receipts.supplier);
    await waitFor(() => expect(supplier).toHaveFocus());
    await user.type(supplier, 'МСМ');
    await user.click(await dialog.findByRole('button', { name: /МСМ ХХК/ }));
    await user.type(dialog.getByLabelText(mn.inventory.receipt.supplierDocNo), 'П-123');
    await user.click(dialog.getByRole('button', { name: mn.inventory.receipt.createDraft }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/receipts/5'));
    const posts = calls(fetchMock, 'POST', '/api/v1/receipts');
    expect(posts).toHaveLength(1);
    expect(await bodyOf(posts[0])).toEqual({
      warehouseId: 1,
      supplierId: 3,
      supplierDocNo: 'П-123',
    });
    expect(posts[0]!.headers.get('Idempotency-Key')).toMatch(UUID);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: mn.inventory.scanLabel })).toHaveFocus(),
    );
    expect(JSON.parse(localStorage.getItem('tugeel.inventory.lastWarehouse.v1') ?? '{}')).toEqual({
      '2': { receipt: 1 },
    });
  }, 15_000);
});

describe('receipt editor', () => {
  it('puts a scanned product on the scanned shelf, counts repeats and posts with Enter', async () => {
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
    let receipt: Schemas['ReceiptDetail'] = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
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
    await user.type(
      screen.getByRole('textbox', { name: mn.inventory.scanLabel }),
      '4006381333931{Enter}',
    );
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
    await userEvent.setup({ delay: null }).keyboard('4006381333931{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '26',
    });
    expect(qty).toHaveValue('1');
  }, 15_000);

  it('sends a scan that lands in a line quantity to the scan box', async () => {
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

  it('reads no scan while the posting dialog is open', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
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
    await userEvent.setup({ delay: null }).keyboard('4006381333931{Enter}');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls(fetchMock, 'GET', '/api/v1/barcodes/4006381333931')).toHaveLength(0);
    expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/post')).toHaveLength(0);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('the delivery note', () => {
  it('is corrected in its card while the receipt is a draft', async () => {
    let receipt = DRAFT;
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/receipts/5': () => json(receipt),
      'PATCH /api/v1/receipts/5': async (request) => {
        const body = (await request.clone().json()) as { supplierDocNo: string | null };
        receipt = { ...receipt, supplierDocNo: body.supplierDocNo };
        return json(receipt);
      },
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const title = mn.inventory.receipt.headerTitle;
    await user.click(
      await screen.findByRole('button', {
        name: mn.common.editRecord.replace('{{name}}', title),
      }),
    );
    const card = within(screen.getByRole('region', { name: title }));
    const docNo = card.getByLabelText(mn.inventory.receipt.supplierDocNo);
    await user.clear(docNo);
    await user.type(docNo, 'П-124');
    await user.click(card.getByRole('button', { name: mn.common.save }));
    await waitFor(() => expect(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipts/5')[0])).toEqual({
      supplierId: 3,
      supplierDocNo: 'П-124',
      supplierDocDate: null,
      note: null,
    });
    expect(await screen.findByRole('status')).toHaveTextContent(mn.inventory.receipt.headerSaved);
    expect(
      await within(screen.getByRole('region', { name: title })).findByText('П-124'),
    ).toBeInTheDocument();
  });

  it('stays read-only once posted', async () => {
    renderApp(
      '/inventory/receipts/5',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts/5': () => json(POSTED),
      }),
    );
    expect(
      await screen.findByRole('region', { name: mn.inventory.receipt.headerTitle }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: new RegExp(mn.common.edit) })).toBeNull();
  });
});

describe('costs on the receipt (ADR-0047 #1)', () => {
  it('takes a unit price or an amount per line and opens the next receipt waiting', async () => {
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      'GET /api/v1/warehouses': () => list([WH1]),
      'GET /api/v1/receipts/5': () => json(POSTED),
      'GET /api/v1/receipts/5/costing': () => json(COSTING),
      'GET /api/v1/receipts': () => list([summary(7), summary(5), summary(4)]),
      'PUT /api/v1/receipts/5/costs': () =>
        json({ ...COSTING, costingStatus: 'COSTED', costingVersion: 1, total: '48000.00' }),
      'GET /api/v1/receipts/4': () => json({ ...POSTED, id: 4, number: 'GR-2026-000004' }),
      'GET /api/v1/receipts/4/costing': () =>
        json({ ...COSTING, receiptId: 4, number: 'GR-2026-000004' }),
    });
    const { router } = renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const price = await screen.findByRole('textbox', {
      name: `${mn.inventory.costing.unitPrice}: ${COLA.name}`,
    });
    const next = screen.getByRole('button', { name: mn.inventory.costing.saveAndNext });
    expect(next).toBeDisabled();
    await user.type(price, '24000');
    // The other field shows what the price comes to.
    expect(
      screen.getByRole('textbox', { name: `${mn.inventory.costing.amount}: ${COLA.name}` }),
    ).toHaveAttribute('placeholder', '48,000');
    await user.click(
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: Будаа` }),
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
      'GET /api/v1/receipts/5': () => json(POSTED),
      'GET /api/v1/receipts/5/costing': () => json(COSTING),
      'GET /api/v1/receipts': () => list([summary(5)]),
      'PUT /api/v1/receipts/5/costs': () => problem('CONFLICT', 409),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    const user = userEvent.setup();
    const amount = await screen.findByRole('textbox', {
      name: `${mn.inventory.costing.amount}: ${COLA.name}`,
    });
    await user.type(amount, '48000');
    await user.click(
      screen.getByRole('switch', { name: `${mn.inventory.costing.freeGoods}: Будаа` }),
    );
    await user.click(screen.getByRole('button', { name: mn.common.save }));
    expect(await screen.findByText(mn.errors.CONFLICT)).toBeInTheDocument();
    expect(amount).toHaveValue('48000');
  });

  it('never shows costs to the warehouse', async () => {
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/warehouses': warehouses,
      'GET /api/v1/receipts/5': () => json(POSTED),
    });
    renderApp('/inventory/receipts/5', fetchMock);
    expect(await screen.findByRole('heading', { name: POSTED.number ?? '' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: mn.inventory.receipts.costing })).toBeNull();
    expect(calls(fetchMock, 'GET', '/api/v1/receipts/5/costing')).toHaveLength(0);
  });
});
