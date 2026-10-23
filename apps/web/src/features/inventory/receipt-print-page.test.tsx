import { screen, waitFor, within } from '@testing-library/react';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { BOX_LINE, DRAFT, WAREHOUSE_ME, WH1, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Detail = components['schemas']['ReceiptDetail'];

const print = mn.inventory.receipt.print;
const form = mn.inventory.receipt.form;
const discounts = mn.inventory.receipt.discounts;
const WH2 = { id: 2, name: 'Хоёрдугаар агуулах' };

/**
 * A posted receipt of two warehouses: boxes of cola at 24,000, rice for 5,000 with 300 off and a
 * free box of cola, then 10% off the whole note (ADR-0103).
 */
const RECEIPT: Detail = {
  ...DRAFT,
  status: 'POSTED',
  number: 'GR-2026-000005',
  costingStatus: 'COSTED',
  effectiveDate: '2026-10-11',
  supplierDocDate: '2026-10-10',
  warehouses: [{ id: WH1.id, name: WH1.name }, WH2],
  weightKg: '12.5',
  weightMissing: 1,
  discounts: [
    { id: 1, kind: 'LINES', pct: null, amount: '300', lineIds: [2], total: '300' },
    { id: 2, kind: 'NOTE', pct: '10', amount: null, lineIds: [], total: '5270' },
  ],
  totals: {
    docTotal: '53000',
    discountTotal: '5570',
    discountTooLarge: false,
    netTotal: '47430',
    vatTotal: '0',
    costTotal: '47430',
    pricedLines: 3,
  },
  lines: [
    {
      ...BOX_LINE,
      enteredQty: '2',
      qtyBase: '48',
      weightKg: '0.26',
      docUnitPrice: '24000',
      docAmount: '48000',
    },
    {
      ...BOX_LINE,
      id: 2,
      productId: 11,
      productSku: '11',
      productName: 'Будаа',
      productUnitId: 110,
      unitName: 'ш',
      enteredQty: '5',
      factorSnapshot: '1',
      qtyBase: '5',
      warehouseId: WH2.id,
      warehouseName: WH2.name,
      binCode: 'B-02-01',
      docUnitPrice: null,
      docAmount: '5000',
    },
    { ...BOX_LINE, id: 3, productSku: '10', freeGoods: true, docUnitPrice: null, docAmount: null },
  ],
};

let printSpy: MockInstance<() => void>;
beforeEach(() => {
  printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => printSpy.mockRestore());

describe('a goods receipt on paper (ADR-0099 #6)', () => {
  it('prints the delivery note with its prices, each discount and the payable', async () => {
    renderApp(
      '/inventory/receipts/5/print/document',
      signedIn(ADMIN_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts/5': () => json(RECEIPT),
      }),
    );
    expect(await screen.findByRole('heading', { name: print.documentTitle })).toBeInTheDocument();
    expect(screen.getByText('GR-2026-000005')).toBeInTheDocument();
    expect(screen.getByText('2026-10-10')).toBeInTheDocument();
    expect(screen.getByText('МСМ ХХК · 010')).toBeInTheDocument();
    expect(screen.getByText(`${WH1.name}, ${WH2.name}`)).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.receipt.paymentMethods.CREDIT)).toBeInTheDocument();

    const table = within(screen.getByRole('table'));
    expect(table.getByRole('columnheader', { name: form.unitPrice })).toBeInTheDocument();
    const [cola, freeCola] = table
      .getAllByRole('row', { name: /Кока кола/ })
      .map((row) => within(row));
    if (!cola || !freeCola) throw new Error('two rows of cola');
    expect(cola.getByRole('cell', { name: '24,000' })).toBeInTheDocument();
    expect(cola.getByRole('cell', { name: '48,000' })).toBeInTheDocument();
    // 48 pieces of 0.26 kg.
    expect(cola.getByRole('cell', { name: '12.48' })).toBeInTheDocument();
    // An amount alone shows the price it comes to.
    const rice = within(table.getByRole('row', { name: /Будаа/ }));
    expect(rice.getByRole('cell', { name: '1,000' })).toBeInTheDocument();
    expect(rice.getByRole('cell', { name: '5,000' })).toBeInTheDocument();
    // Free goods say so instead of a price.
    expect(freeCola.getByRole('cell', { name: print.free })).toBeInTheDocument();

    expect(screen.getByText(form.docTotal)).toBeInTheDocument();
    expect(screen.getByText('53,000')).toBeInTheDocument();
    // Each discount above the payable: the chosen lines' first, then the whole note's.
    expect(screen.getByText(discounts.kinds.LINES)).toBeInTheDocument();
    expect(screen.getByText('-300')).toBeInTheDocument();
    expect(screen.getByText(`${discounts.kinds.NOTE} (10%)`)).toBeInTheDocument();
    expect(screen.getByText('-5,270')).toBeInTheDocument();
    expect(screen.getByText(form.netTotal)).toBeInTheDocument();
    expect(screen.getByText('47,430')).toBeInTheDocument();
    expect(screen.queryByText(form.vatTotal)).toBeNull();
    expect(screen.getByText('12.5 кг')).toBeInTheDocument();
    expect(screen.getByText(form.weightMissing.replace('{{count}}', '1'))).toBeInTheDocument();
    expect(screen.getByText(`${print.accountant}:`)).toBeInTheDocument();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it('prints the delivery note without prices for the warehouse, marked as a draft', async () => {
    const { totals: _totals, ...noTotals } = RECEIPT;
    renderApp(
      '/inventory/receipts/5/print/document',
      signedIn(WAREHOUSE_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts/5': () => json({ ...noTotals, status: 'DRAFT', number: null }),
      }),
    );
    expect(await screen.findByRole('heading', { name: print.documentTitle })).toBeInTheDocument();
    expect(screen.getByText(print.draft)).toBeInTheDocument();
    expect(screen.getByText(mn.inventory.draftNo.replace('{{id}}', '5'))).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: form.unitPrice })).toBeNull();
    expect(screen.queryByText('48,000')).toBeNull();
    expect(screen.queryByText(form.netTotal)).toBeNull();
    expect(screen.getByText('12.5 кг')).toBeInTheDocument();
  });

  it('prints one list per warehouse, its lines by shelf and no prices', async () => {
    renderApp(
      '/inventory/receipts/5/print/warehouse',
      signedIn(ADMIN_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts/5': () => json(RECEIPT),
      }),
    );
    const sheets = await screen.findAllByRole('article');
    expect(sheets).toHaveLength(2);
    expect(screen.getAllByRole('heading', { name: print.warehouseTitle })).toHaveLength(2);

    const first = within(sheets[0]!);
    expect(first.getByText(WH1.name)).toBeInTheDocument();
    // The free box is counted in too.
    expect(first.getAllByRole('cell', { name: 'Кока кола' })).toHaveLength(2);
    expect(first.getAllByRole('cell', { name: 'A-01-03' })).toHaveLength(2);
    expect(first.queryByRole('cell', { name: 'Будаа' })).toBeNull();
    // 48 pieces bought and 24 free.
    expect(first.getByText('72')).toBeInTheDocument();

    const second = within(sheets[1]!);
    expect(second.getByText(WH2.name)).toBeInTheDocument();
    expect(second.getByRole('cell', { name: 'Будаа' })).toBeInTheDocument();
    expect(second.getByRole('cell', { name: 'B-02-01' })).toBeInTheDocument();
    expect(second.queryByRole('cell', { name: 'Кока кола' })).toBeNull();

    expect(screen.queryByRole('columnheader', { name: form.unitPrice })).toBeNull();
    expect(screen.queryByText('24,000')).toBeNull();
    expect(screen.getAllByRole('columnheader', { name: print.checked })).toHaveLength(2);
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });
});
