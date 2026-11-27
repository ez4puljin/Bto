import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { useState } from 'react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import { BOX_LINE, DRAFT, warehouses } from '@/test/inventory-fixtures';
import { ADMIN_ME, json, renderApp, signedIn } from '@/test/render-app';
import type { ReceiptLine } from './api';
import { type CostEntry, entryAmount } from './helpers';
import { PriceCells } from './receipt-costing';
import { ReceiptDiscountsCard } from './receipt-discounts';
import { entryOfLine, sameEntry } from './receipt-prices';

function ReferenceCells({ editable }: { editable: boolean }) {
  const [entry, setEntry] = useState<CostEntry>({
    source: 'amount',
    value: '',
    free: true,
    printedUnitPrice: editable ? '' : '10000',
  });
  return (
    <I18nextProvider i18n={i18n}>
      <table>
        <tbody>
          <tr>
            <PriceCells
              name="Bonus box"
              enteredQty="2"
              entry={entry}
              editable
              referenceEditable={editable}
              onChange={(patch) => setEntry((v) => ({ ...v, ...patch }))}
            />
          </tr>
        </tbody>
      </table>
      <output>{entryAmount(entry, '2')?.toString()}</output>
    </I18nextProvider>
  );
}

describe('free receipt printed reference', () => {
  it('retains a printed unit reference without changing the free acquisition amount', () => {
    const entry = entryOfLine(
      {
        ...BOX_LINE,
        freeGoods: true,
        printedUnitPrice: '10000',
        docUnitPrice: null,
        docAmount: '0',
      },
      false,
    );
    expect(entry.printedUnitPrice).toBe('10000');
    expect(entryAmount(entry, '2')?.toString()).toBe('0');
    expect(sameEntry(entry, { ...entry, printedUnitPrice: '12000' })).toBe(false);
  });
  it('edits the printed reference at first costing while the amount stays zero', async () => {
    const user = userEvent.setup();
    render(<ReferenceCells editable />);
    const field = screen.getByLabelText(`${mn.pricing.settings.printedUnitPrice}: Bonus box`);
    await user.clear(field);
    await user.type(field, '12000');
    expect(field).toHaveValue('12000');
    expect(screen.getByRole('status')).toHaveTextContent('0');
  });
  it('keeps the reference field frozen on an accounting recost', () => {
    render(<ReferenceCells editable={false} />);
    expect(
      screen.getByLabelText(`${mn.pricing.settings.printedUnitPrice}: Bonus box`),
    ).toBeDisabled();
  });

  it('fills a missing printed reference from the real posted free-goods card and submits a free zero-cost line', async () => {
    const user = userEvent.setup();
    const line: ReceiptLine = {
      ...BOX_LINE,
      freeGoods: true,
      docUnitPrice: null,
      docAmount: '0',
      printedUnitPrice: null,
    };
    let receipt = {
      ...DRAFT,
      number: 'IN-0005',
      status: 'POSTED' as const,
      costingStatus: 'PENDING' as 'PENDING' | 'COSTED',
      lines: [line],
      qtyBase: line.qtyBase,
      discounts: [],
      totals: {
        docTotal: '0',
        discountTotal: '0',
        discountTooLarge: false,
        netTotal: '0',
        vatTotal: '0',
        costTotal: '0',
        pricedLines: 1,
      },
    };
    const writes: {
      lines: {
        lineId: number;
        freeGoods?: boolean;
        printedUnitPrice?: string;
        amount?: string;
        unitPrice?: string;
      }[];
    }[] = [];
    renderApp(
      '/inventory/receipts/5',
      signedIn(ADMIN_ME, {
        'GET /api/v1/warehouses': warehouses,
        'GET /api/v1/receipts/5': () => json(receipt),
        'GET /api/v1/receipts': () => json({ data: [], nextCursor: null }),
        'GET /api/v1/receipts/5/costing': () =>
          json({ receiptId: 5, costingVersion: receipt.costingVersion, lines: [] }),
        'PUT /api/v1/receipts/5/costs': async (request) => {
          const body = await request.json();
          writes.push(body);
          receipt = {
            ...receipt,
            costingStatus: 'COSTED',
            costingVersion: 1,
            lines: [{ ...line, printedUnitPrice: body.lines[0].printedUnitPrice }],
          };
          return json(receipt);
        },
      }),
    );
    const name = `${line.productName} (${line.unitName})`;
    const field = await screen.findByLabelText(`${mn.pricing.settings.printedUnitPrice}: ${name}`);
    await user.type(field, '24000');
    await user.click(screen.getByRole('button', { name: mn.inventory.receipt.check.confirm }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.lines).toEqual([
      { lineId: line.id, freeGoods: true, printedUnitPrice: '24000' },
    ]);
    await waitFor(() =>
      expect(
        screen.queryByLabelText(`${mn.pricing.settings.printedUnitPrice}: ${name}`),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('24,000')).toBeInTheDocument();
  });

  it('shows a stored draft reference with its original factor instead of calling it the current piece price', () => {
    const line: ReceiptLine = {
      ...BOX_LINE,
      freeGoods: true,
      factorSnapshot: '1',
      printedUnitPrice: '100',
      printedPriceFactor: '3',
    };
    render(
      <I18nextProvider i18n={i18n}>
        <ReceiptDiscountsCard lines={[line]} discounts={[]} editable={false} />
      </I18nextProvider>,
    );
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(
      screen.getByText(mn.pricing.settings.printedPriceFactorHint.replace('{{qty}}', '3')),
    ).toBeInTheDocument();
  });
});
