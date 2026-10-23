import { screen, waitFor, within } from '@testing-library/react';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { BOX_LINE, DRAFT, WAREHOUSE_ME, WH1, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';

type Detail = components['schemas']['ReceiptDetail'];

const print = mn.inventory.receipt.print;
const form = mn.inventory.receipt.form;
const WH2 = { id: 2, name: 'Хоёрдугаар агуулах' };

/** A posted receipt of two warehouses: boxes of cola at 24,000 and rice for 5,000, 10% off. */
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
  discountPct: '10',
  totals: {
    docTotal: '53000',
    discountTotal: '5300',
    netTotal: '47700',
    vatTotal: '0',
    costTotal: '47700',
    pricedLines: 2,
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
  ],
};

let printSpy: MockInstance<() => void>;
beforeEach(() => {
  printSpy = vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => printSpy.mockRestore());

describe('a goods receipt on paper (ADR-0099 #6)', () => {
  it('prints the delivery note with its prices, the discount and the payable', async () => {
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
    const cola = within(table.getByRole('row', { name: /Кока кола/ }));
    expect(cola.getByRole('cell', { name: '24,000' })).toBeInTheDocument();
    expect(cola.getByRole('cell', { name: '48,000' })).toBeInTheDocument();
    // 48 pieces of 0.26 kg.
    expect(cola.getByRole('cell', { name: '12.48' })).toBeInTheDocument();
    // An amount alone shows the price it comes to.
    const rice = within(table.getByRole('row', { name: /Будаа/ }));
    expect(rice.getByRole('cell', { name: '1,000' })).toBeInTheDocument();
    expect(rice.getByRole('cell', { name: '5,000' })).toBeInTheDocument();

    expect(screen.getByText(form.docTotal)).toBeInTheDocument();
    expect(screen.getByText('53,000')).toBeInTheDocument();
    expect(screen.getByText(form.discountTotal)).toBeInTheDocument();
    expect(screen.getByText('-5,300')).toBeInTheDocument();
    expect(screen.getByText(form.netTotal)).toBeInTheDocument();
    expect(screen.getByText('47,700')).toBeInTheDocument();
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
    expect(first.getByRole('cell', { name: 'Кока кола' })).toBeInTheDocument();
    expect(first.getByRole('cell', { name: 'A-01-03' })).toBeInTheDocument();
    expect(first.queryByRole('cell', { name: 'Будаа' })).toBeNull();
    expect(first.getByText('48')).toBeInTheDocument();

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
