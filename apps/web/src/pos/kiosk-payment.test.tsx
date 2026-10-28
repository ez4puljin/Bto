import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type { EdgeCustomer, EdgeSaleRequest, SnapshotPaymentType } from '@tugeel/shared/pos';
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
  SESSION,
  storeRoutes,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;

/** The admin's payment types (ADR-0111), as the session carries them. */
const TYPES: SnapshotPaymentType[] = [
  { id: 1, name: 'Бэлэн', kind: 'CASH' },
  { id: 2, name: 'Khaanbank terminal', kind: 'CARD' },
  { id: 3, name: 'Шилжүүлэг', kind: 'TRANSFER' },
  { id: 4, name: 'Зээл', kind: 'CREDIT' },
];

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

const amountOf = (name: string) => k.pay.rows.amount.replace('{{name}}', name);

/** The edge's answer: a credit slip when the sale has credit (no e-Barimt), else a receipt. */
function answer(request: EdgeSaleRequest) {
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

async function openPayment(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(
    storeRoutes({
      'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }),
      'GET /customers': () => json([SHOP, HELD]),
      'POST /sales': (call) => json(printable(answer(call.body as EdgeSaleRequest))),
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
  await within(pay).findByRole('button', { name: /Khaanbank terminal/ });
  return { edge, user, pay, print: rendered.print };
}

const typeButton = (pay: HTMLElement, name: string) =>
  // A type's button reads its place and its name ("4 Зээл"); a row's remove button differs.
  within(pay).getByRole('button', { name: new RegExp(`^[0-9]+ ?${name}$`) });

describe('kiosk: the payment rows (ADR-0111)', () => {
  it('lists the admin’s types; a tapped one takes what is left, «Хольсон» is gone', async () => {
    const { edge, user, pay } = await openPayment();
    expect(within(pay).queryByRole('radio')).toBeNull();
    expect(within(pay).getByText(k.pay.rows.empty)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
    await user.click(typeButton(pay, 'Бэлэн'));
    const cash = within(pay).getByLabelText(amountOf('Бэлэн'));
    expect(cash).toHaveValue('7000');
    await user.clear(cash);
    await user.type(cash, '5000');
    await user.click(typeButton(pay, 'Шилжүүлэг'));
    expect(within(pay).getByLabelText(amountOf('Шилжүүлэг'))).toHaveValue('2000');
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({
      receiptType: 'B2C',
      buyer: null,
      customerId: null,
      tenders: [
        { kind: 'CASH', paymentTypeId: 1, amount: '5000.00', tendered: '5000.00' },
        { kind: 'TRANSFER', paymentTypeId: 3, amount: '2000.00' },
      ],
    });
  });

  it('adds the type by its place with 1–9 and takes a card by the terminal', async () => {
    const { edge, user, pay } = await openPayment();
    await user.keyboard('2');
    expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toHaveValue('7000');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale.tenders).toEqual([
      { kind: 'CARD', paymentTypeId: 2, amount: '7000.00', terminalId: null, rrn: null },
    ]);
  });

  it('never lets a non-cash row pass the total', async () => {
    const { user, pay } = await openPayment();
    await user.click(typeButton(pay, 'Khaanbank terminal'));
    const card = within(pay).getByLabelText(amountOf('Khaanbank terminal'));
    await user.clear(card);
    await user.type(card, '9000');
    expect(within(pay).getByText(k.pay.rows.over)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
  });

  it('asks the receipt at «Баримт хэвлэх»: «Байгууллага НӨАТ» needs a found company', async () => {
    const { user, pay } = await openPayment();
    await user.keyboard('1');
    await user.keyboard('{Enter}');
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2B }));
    expect(within(pay).getByText(k.pay.receiptType.buyerNeeded)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.back }));
    expect(within(pay).getByLabelText(amountOf('Бэлэн'))).toHaveValue('7000');
  });

  it('puts the rest on credit to a chosen customer and prints its slip without VAT', async () => {
    const printed: string[] = [];
    const { edge, user, pay, print } = await openPayment();
    print.mockImplementation(() => {
      printed.push(screen.getByTestId('receipt-print').textContent ?? '');
    });
    await user.click(typeButton(pay, 'Бэлэн'));
    const cash = within(pay).getByLabelText(amountOf('Бэлэн'));
    await user.clear(cash);
    await user.type(cash, '2000');
    await user.click(typeButton(pay, 'Зээл'));
    expect(within(pay).getByLabelText(amountOf('Зээл'))).toHaveValue('5000');
    expect(typeButton(pay, 'Зээл')).toBeDisabled();
    expect(within(pay).getByText(k.pay.receiptChoice.noVat)).toBeInTheDocument();
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
    await user.type(within(pay).getByLabelText(k.pay.credit.search), 'дэлгүүр{Enter}');
    const held = await within(pay).findByRole('button', { name: /Хаалттай дэлгүүр/ });
    expect(held).toBeDisabled();
    await user.click(within(pay).getByRole('button', { name: /Туршилтын дэлгүүр/ }));
    // With credit, «Баримт хэвлэх» prints the slip at once: no receipt to choose.
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    const receipt = await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({
      customerId: SHOP.id,
      receiptType: 'B2C',
      buyer: null,
      tenders: [
        { kind: 'CASH', paymentTypeId: 1, amount: '2000.00', tendered: '2000.00' },
        { kind: 'CREDIT', paymentTypeId: 4, amount: '5000.00' },
      ],
    });
    expect(within(receipt).getByText(k.receipt.creditSlip)).toBeInTheDocument();
    expect(within(receipt).queryByText(k.receipt.vatIncluded)).toBeNull();
    await waitFor(() => expect(printed).toHaveLength(1));
    expect(printed[0]?.split(k.receipt.creditSlip)).toHaveLength(3);
  });

  it('offline past the limit: warns, then sells with the same client id when the cashier goes on', async () => {
    let tries = 0;
    const { edge, user, pay } = await openPayment({
      'POST /sales': (call) => {
        tries += 1;
        return tries === 1
          ? problem('POS_CREDIT_OFFLINE_OVER_LIMIT', 409, {
              available: '4000.00',
              excess: '3000.00',
              limit: '50000.00',
            })
          : json(printable(answer(call.body as EdgeSaleRequest)));
      },
    });
    await user.click(typeButton(pay, 'Зээл'));
    await user.type(within(pay).getByLabelText(k.pay.credit.search), '10501{Enter}');
    await user.click(await within(pay).findByRole('button', { name: /Туршилтын дэлгүүр/ }));
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    const warning = await within(pay).findByRole('alert');
    expect(warning).toHaveTextContent(k.pay.credit.overLimitTitle);
    await user.click(within(warning).getByRole('button', { name: k.pay.credit.overLimitConfirm }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const [first, second] = edge.callsTo('POST /sales').map((call) => call.body as EdgeSaleRequest);
    expect(first?.acceptOverLimit).toBeUndefined();
    expect(second).toMatchObject({ clientId: first?.clientId, acceptOverLimit: true });
  });

  it('says why the centre refused the credit, in the till’s words', async () => {
    const { user, pay } = await openPayment({
      'POST /sales': () => problem('CREDIT_BLOCKED', 409, { reason: 'LIMIT', excess: '3000.00' }),
    });
    await user.click(typeButton(pay, 'Зээл'));
    await user.type(within(pay).getByLabelText(k.pay.credit.search), '10501{Enter}');
    await user.click(await within(pay).findByRole('button', { name: /Туршилтын дэлгүүр/ }));
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    expect(await within(pay).findByRole('alert')).toHaveTextContent('3,000₮');
  });
});
