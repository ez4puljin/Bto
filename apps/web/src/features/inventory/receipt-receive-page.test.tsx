import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@tugeel/api-client';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it } from 'vitest';
import {
  BOX_LINE,
  bodyOf,
  calls,
  COLA,
  COLA_BOX,
  DRAFT,
  STAMP,
  WAREHOUSE_ME,
} from '@/test/inventory-fixtures';
import { json, renderApp, signedIn } from '@/test/render-app';
import { wedgeScan } from '@/test/scan';

type Detail = components['schemas']['ReceiptDetail'];
const receive = mn.inventory.receipt.receive;

/** A purchase order's draft (ADR-0115): cola expected 2 boxes, rice 5 pieces, nothing counted. */
const ORDER_DRAFT: Detail = {
  ...DRAFT,
  origin: 'ORDER',
  originRef: 'PO-2026-000001',
  uncheckedLines: 2,
  qtyBase: '0',
  lines: [
    { ...BOX_LINE, enteredQty: '0', qtyBase: '0', expectedQty: '2', checkedAt: null },
    {
      ...BOX_LINE,
      id: 2,
      productId: 11,
      productSku: '11',
      productName: 'Будаа',
      productUnitId: 110,
      unitName: 'ш',
      enteredQty: '0',
      factorSnapshot: '1',
      qtyBase: '0',
      expectedQty: '5',
      checkedAt: null,
    },
  ],
};

describe('receiving against an order (ADR-0115)', () => {
  it('jumps to the scanned line, saves the count, marks «Ирээгүй» and confirms', async () => {
    let current: Detail = ORDER_DRAFT;
    const counted = (lineId: number, enteredQty: string) => {
      current = {
        ...current,
        lines: current.lines.map((line) =>
          line.id === lineId
            ? {
                ...line,
                enteredQty,
                qtyBase: String(
                  Number.parseFloat(enteredQty) * Number.parseFloat(line.factorSnapshot),
                ),
                checkedAt: STAMP,
              }
            : line,
        ),
      };
      return json(current);
    };
    const fetchMock = signedIn(WAREHOUSE_ME, {
      'GET /api/v1/receipts/5': () => json(current),
      'GET /api/v1/barcodes/4006381333931': () => json(COLA_BOX),
      'PATCH /api/v1/receipt-lines/1': async (request) =>
        counted(1, ((await request.clone().json()) as { enteredQty: string }).enteredQty),
      'PATCH /api/v1/receipt-lines/2': async (request) =>
        counted(2, ((await request.clone().json()) as { enteredQty: string }).enteredQty),
      'POST /api/v1/receipts/5/post': () => json(current),
    });
    renderApp('/inventory/receipts/5/receive', fetchMock);
    const user = userEvent.setup();
    expect(
      await screen.findByRole('heading', {
        name: receive.title.replace('{{supplier}}', DRAFT.supplierName),
      }),
    ).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: receive.confirm });
    expect(confirm).toBeDisabled();

    // The scan lands on cola's count and says what was ordered.
    await wedgeScan('4006381333931');
    const colaCount = screen.getByRole('textbox', {
      name: receive.arrivedFor.replace('{{product}}', COLA.name).replace('{{unit}}', 'хайрцаг'),
    });
    await waitFor(() => expect(colaCount).toHaveFocus());
    expect(screen.getByText(/2 хайрцаг/)).toBeInTheDocument();
    await user.type(colaCount, '1{Enter}');
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')).toHaveLength(1),
    );
    expect(await bodyOf(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/1')[0])).toEqual({
      enteredQty: '1',
    });

    // Rice did not come.
    await user.click(
      screen.getByRole('button', {
        name: receive.notArrivedFor.replace('{{product}}', 'Будаа').replace('{{unit}}', 'ш'),
      }),
    );
    await waitFor(() =>
      expect(calls(fetchMock, 'PATCH', '/api/v1/receipt-lines/2')).toHaveLength(1),
    );
    const rows = screen.getAllByRole('row');
    expect(
      within(rows[2] as HTMLElement).getByText(receive.notArrived, { selector: 'span' }),
    ).toBeInTheDocument();

    // Every line checked: «Батлах» confirms the keeper's warehouse.
    await waitFor(() => expect(confirm).toBeEnabled());
    await user.click(confirm);
    await user.click(await screen.findByRole('button', { name: receive.confirm, hidden: false }));
    await waitFor(() =>
      expect(calls(fetchMock, 'POST', '/api/v1/receipts/5/post')).toHaveLength(1),
    );
  }, 15_000);
});
