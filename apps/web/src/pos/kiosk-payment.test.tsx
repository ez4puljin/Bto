import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type { EdgeCustomer, EdgeSaleRequest } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  CASHIER,
  type EdgeHandler,
  fakeEdge,
  json,
  MILK_BARCODE,
  printable,
  problem,
  receiptOf,
  storeRoutes,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;

const SHOP: EdgeCustomer = {
  id: 501,
  code: '10501',
  name: 'Туршилтын дэлгүүр',
  tin: null,
  phone: '99110001',
  creditHold: false,
  creditLimit: '50000.00',
  available: '42000.00',
};
const HELD: EdgeCustomer = {
  ...SHOP,
  id: 502,
  code: '10502',
  name: 'Хаалттай дэлгүүр',
  creditHold: true,
};

/** The edge's answer to a sale with credit: the credit slip (no e-Barimt). */
function creditReceipt(request: EdgeSaleRequest) {
  const credit = request.tenders.find((tender) => tender.kind === 'CREDIT');
  return {
    ...receiptOf(request),
    ebarimt: { mode: 'TEST' as const, ddtd: null, status: 'NONE' as const },
    credit: credit
      ? {
          customerId: SHOP.id,
          customerCode: SHOP.code,
          customerName: SHOP.name,
          amount: credit.amount,
        }
      : null,
  };
}

async function openSale(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(
    storeRoutes({
      'GET /customers': () => json([SHOP, HELD]),
      'POST /sales': (call) => json(printable(creditReceipt(call.body as EdgeSaleRequest))),
      ...routes,
    }),
  );
  const rendered = renderKiosk(edge, {
    device: 'device-1',
    session: 'session-1',
    cashierId: CASHIER.userId,
  });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  const user = userEvent.setup();
  await wedgeScan(MILK_BARCODE);
  await wedgeScan(MILK_BARCODE);
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('7,000₮'));
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('dialog', { name: k.pay.title });
  return { edge, user, pay, print: rendered.print };
}

describe('kiosk: the payment step (ADR-0109)', () => {
  it('takes the whole total by card when the cashier chooses card', async () => {
    const { edge, user, pay } = await openSale();
    expect(within(pay).getByRole('radio', { name: k.pay.mode.CASH })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(within(pay).getByRole('radio', { name: k.pay.mode.CARD }));
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({
      receiptType: 'B2C',
      buyer: null,
      customerId: null,
      tenders: [{ kind: 'CARD', amount: '7000.00', terminalId: null, rrn: null }],
    });
  });

  it('needs a found company for «Байгууллага»', async () => {
    const { user, pay } = await openSale();
    await user.click(within(pay).getByRole('button', { name: k.pay.exact }));
    await user.click(within(pay).getByRole('radio', { name: k.pay.receiptType.B2B }));
    expect(within(pay).getByText(k.pay.receiptType.buyerNeeded)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: k.pay.confirm })).toBeDisabled();
    await user.click(within(pay).getByRole('radio', { name: k.pay.receiptType.B2C }));
    expect(within(pay).getByRole('button', { name: k.pay.confirm })).toBeEnabled();
  });

  it('sells on credit to a chosen customer, part paid in cash, and prints two signed slips', async () => {
    const printed: string[] = [];
    const { edge, user, pay, print } = await openSale();
    print.mockImplementation(() => {
      printed.push(screen.getByTestId('receipt-print').textContent ?? '');
    });
    await user.click(within(pay).getByRole('radio', { name: k.pay.mode.CREDIT }));
    expect(within(pay).getByText(k.pay.receiptType.none)).toBeInTheDocument();
    expect(within(pay).queryByRole('radio', { name: k.pay.receiptType.B2B })).toBeNull();
    expect(within(pay).getByRole('button', { name: k.pay.confirm })).toBeDisabled();

    await user.type(within(pay).getByLabelText(k.pay.credit.search), 'дэлгүүр{Enter}');
    const held = await within(pay).findByRole('button', { name: /Хаалттай дэлгүүр/ });
    expect(held).toBeDisabled();
    await user.click(within(pay).getByRole('button', { name: /Туршилтын дэлгүүр/ }));
    expect(within(pay).getByText(/10501/)).toBeInTheDocument();
    await user.type(within(pay).getByPlaceholderText(k.pay.credit.paidNow), '2000');
    expect(within(pay).getByRole('status')).toHaveTextContent('5,000₮');
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));

    const receipt = await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({
      customerId: SHOP.id,
      receiptType: 'B2C',
      buyer: null,
      tenders: [
        { kind: 'CASH', amount: '2000.00', tendered: '2000.00' },
        { kind: 'CREDIT', amount: '5000.00' },
      ],
    });
    expect(within(receipt).getByText(k.receipt.creditSlip)).toBeInTheDocument();
    expect(within(receipt).getByText(SHOP.name)).toBeInTheDocument();
    expect(within(receipt).queryByText(k.receipt.vatIncluded)).toBeNull();
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(printed[0]).toContain(k.receipt.copyCustomer);
    expect(printed[0]).toContain(k.receipt.copyStore);
    expect(printed[0]?.split(k.receipt.creditSlip)).toHaveLength(3);
  });

  it('offline past the limit: warns, then sells with the same client id when the cashier goes on', async () => {
    let tries = 0;
    const { edge, user, pay } = await openSale({
      'POST /sales': (call) => {
        tries += 1;
        return tries === 1
          ? problem('POS_CREDIT_OFFLINE_OVER_LIMIT', 409, {
              available: '4000.00',
              excess: '3000.00',
              limit: '50000.00',
            })
          : json(printable(creditReceipt(call.body as EdgeSaleRequest)));
      },
    });
    await user.click(within(pay).getByRole('radio', { name: k.pay.mode.CREDIT }));
    await user.type(within(pay).getByLabelText(k.pay.credit.search), '10501{Enter}');
    await user.click(await within(pay).findByRole('button', { name: /Туршилтын дэлгүүр/ }));
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));
    const warning = await within(pay).findByRole('alert');
    expect(warning).toHaveTextContent(k.pay.credit.overLimitTitle);
    await user.click(within(warning).getByRole('button', { name: k.pay.credit.overLimitConfirm }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const [first, second] = edge.callsTo('POST /sales').map((call) => call.body as EdgeSaleRequest);
    expect(first?.acceptOverLimit).toBeUndefined();
    expect(second).toMatchObject({ clientId: first?.clientId, acceptOverLimit: true });
  });

  it('says why the centre refused the credit, in the till’s words', async () => {
    const { user, pay } = await openSale({
      'POST /sales': () => problem('CREDIT_BLOCKED', 409, { reason: 'LIMIT', excess: '3000.00' }),
    });
    await user.click(within(pay).getByRole('radio', { name: k.pay.mode.CREDIT }));
    await user.type(within(pay).getByLabelText(k.pay.credit.search), '10501{Enter}');
    await user.click(await within(pay).findByRole('button', { name: /Туршилтын дэлгүүр/ }));
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));
    expect(await within(pay).findByRole('alert')).toHaveTextContent('3,000₮');
  });
});
