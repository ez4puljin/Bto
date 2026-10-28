import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type { EdgeSaleRequest } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import { SESSION_STORAGE_KEY } from './edge-client';
import {
  BREAD_BARCODE,
  CASHIER,
  MILK_BARCODE,
  type EdgeHandler,
  fakeEdge,
  json,
  printable,
  problem,
  receiptOf,
  SESSION,
  storeRoutes,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const qtyField = (name: string) => screen.getByLabelText(k.sale.qtyFor.replace('{{name}}', name));
const lastQuote = (edge: ReturnType<typeof fakeEdge>) => edge.callsTo('POST /quote').at(-1)?.body;

async function openSale(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(storeRoutes(routes));
  renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  return edge;
}

describe('kiosk: the sale screen', () => {
  it('adds a scanned product, prices it at the edge, and makes it 2 on a second scan', async () => {
    const edge = await openSale();
    expect(screen.getByText(k.sale.empty)).toBeInTheDocument();
    expect(await screen.findByRole('status', { name: /Холбогдсон/ })).toBeInTheDocument();

    await wedgeScan(MILK_BARCODE);
    expect(await screen.findByText('Сүү 1л')).toBeInTheDocument();
    await waitFor(() =>
      expect(lastQuote(edge)).toEqual({ lines: [{ productUnitId: 11, qty: '1' }] }),
    );
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('3,500₮'));

    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(qtyField('Сүү 1л (ш)')).toHaveValue('2'));
    await waitFor(() =>
      expect(lastQuote(edge)).toEqual({ lines: [{ productUnitId: 11, qty: '2' }] }),
    );
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('7,000₮'));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(edge.callsTo(`GET /products/barcode/${MILK_BARCODE}`)).toHaveLength(2);
  });

  it('says so for an unknown barcode', async () => {
    await openSale();
    await wedgeScan('4006381333948');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      mn.scan.notFound.replace('{{code}}', '4006381333948'),
    );
  });

  it('pays the exact cash with F12, 1 and Enter twice, then shows the receipt', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('3,500₮'));

    await user.keyboard('{F12}');
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    await user.keyboard('1');
    expect(
      within(pay).getByLabelText(k.pay.rows.amount.replace('{{name}}', mn.pos.tenderKinds.CASH)),
    ).toHaveValue('3500');
    await user.keyboard('{Enter}');
    // «Баримт хэвлэх» asks the receipt: «Хувь хүн НӨАТ» has the focus.
    expect(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C })).toHaveFocus();
    await user.keyboard('{Enter}');

    const receipt = await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale.clientId).toMatch(UUID);
    expect(sale.lines).toEqual([{ productUnitId: 11, qty: '1' }]);
    expect(sale.tenders).toEqual([
      { kind: 'CASH', paymentTypeId: null, amount: '3500.00', tendered: '3500.00' },
    ]);
    expect(sale.receiptType).toBe('B2C');
    expect(within(receipt).getByText('К1-261017-0004')).toBeInTheDocument();
    expect(within(receipt).getByText(k.receipt.test)).toBeInTheDocument();
    expect(within(receipt).getByText(mn.pos.fields.change).nextElementSibling).toHaveTextContent(
      '0₮',
    );

    // «Шинэ борлуулалт (Enter)» has the focus: Enter starts the next sale with an empty cart.
    expect(within(receipt).getByRole('button', { name: k.receipt.newSale })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText(k.sale.empty)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(k.sale.scanLabel)).toHaveFocus());
  });

  it('starts the next sale when a product is scanned over the receipt', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('3,500₮'));
    await user.keyboard('{F12}');
    await screen.findByRole('dialog', { name: k.pay.title });
    await user.keyboard('1');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: k.receipt.title });

    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(qtyField('Сүү 1л (ш)')).toHaveValue('1'));
    expect(edge.callsTo('POST /sales')).toHaveLength(1);
  });

  it('adds a cash row and a card row, shows the change of a larger note', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('7,000₮'));

    await user.click(screen.getByRole('button', { name: k.sale.pay }));
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    await user.click(
      within(pay).getByRole('button', { name: new RegExp(mn.pos.tenderKinds.CASH) }),
    );
    await user.click(
      within(pay).getByRole('button', { name: new RegExp(mn.pos.tenderKinds.CARD) }),
    );
    const card = within(pay).getByLabelText(
      k.pay.rows.amount.replace('{{name}}', mn.pos.tenderKinds.CARD),
    );
    expect(card).toHaveValue('');
    await user.type(card, '2000');
    await user.click(within(pay).getByRole('button', { name: '10,000₮' }));
    expect(within(pay).getByText(k.pay.change).nextElementSibling).toHaveTextContent('5,000₮');
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));

    const receipt = await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale.tenders).toEqual([
      { kind: 'CASH', paymentTypeId: null, amount: '5000.00', tendered: '10000.00' },
      { kind: 'CARD', paymentTypeId: null, amount: '2000.00', terminalId: null, rrn: null },
    ]);
    // The change to hand back stands large above the receipt, and the receipt lists it too.
    const [strip, line] = within(receipt).getAllByText(mn.pos.fields.change);
    expect(strip?.nextElementSibling).toHaveTextContent('5,000₮');
    expect(line?.nextElementSibling).toHaveTextContent('5,000₮');
  });

  it('keeps the client id when a payment is tried again', async () => {
    let tries = 0;
    const edge = await openSale({
      'POST /sales': (call) => {
        tries += 1;
        return tries === 1
          ? problem('INTERNAL_ERROR', 500)
          : json(printable(receiptOf(call.body as EdgeSaleRequest)));
      },
    });
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('3,500₮'));
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    await user.keyboard('1');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    expect(await within(pay).findByRole('alert')).toHaveTextContent(mn.errors.INTERNAL_ERROR);
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const [first, second] = edge.callsTo('POST /sales').map((call) => call.body as EdgeSaleRequest);
    expect(first?.clientId).toMatch(UUID);
    expect(second?.clientId).toBe(first?.clientId);
  });

  it('marks a product without a price and refuses to take the payment', async () => {
    await openSale();
    await wedgeScan(BREAD_BARCODE);
    expect(await screen.findByText('Талх')).toBeInTheDocument();
    expect(await screen.findByText(k.sale.unpricedBlock)).toBeInTheDocument();
    expect(screen.getAllByText(k.sale.unpriced).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: k.sale.pay })).toBeDisabled();
  });

  it('finds a product with F6 and adds the unit chosen with the arrows', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await user.keyboard('{F6}');
    const search = await screen.findByRole('dialog', { name: k.search.title });
    await user.type(within(search).getByRole('combobox'), 'сүү');
    const options = await within(search).findAllByRole('option');
    expect(options).toHaveLength(2);
    await user.keyboard('{ArrowDown}{Enter}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(qtyField('Сүү 1л (хайрцаг)')).toHaveValue('1');
    await waitFor(() =>
      expect(lastQuote(edge)).toEqual({ lines: [{ productUnitId: 12, qty: '1' }] }),
    );
    await waitFor(() => expect(screen.getByLabelText(k.sale.scanLabel)).toHaveFocus());
  });

  it('changes the selected line with + / − and removes it with Delete', async () => {
    // Without a supervisor asked for (the store's setting), a void is only logged (ADR-0104).
    const edge = await openSale({
      'GET /session': () => json({ ...SESSION, approvalRequired: false }),
    });
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    const qty = await waitFor(() => qtyField('Сүү 1л (ш)'));

    await user.keyboard('+');
    await waitFor(() => expect(qty).toHaveValue('2'));
    await user.keyboard('-');
    await waitFor(() => expect(qty).toHaveValue('1'));
    await user.click(
      screen.getByRole('button', { name: k.sale.increase.replace('{{name}}', 'Сүү 1л (ш)') }),
    );
    await waitFor(() => expect(qty).toHaveValue('2'));
    expect(screen.getByLabelText(k.sale.scanLabel)).toHaveFocus();
    await user.keyboard('{Delete}');
    expect(await screen.findByText(k.sale.empty)).toBeInTheDocument();
    expect(edge.callsTo('POST /voids').map((call) => call.body)).toEqual([
      expect.objectContaining({
        reason: 'QTY_REDUCED',
        lines: [{ productUnitId: 11, qty: '1' }],
        approval: null,
      }),
      expect.objectContaining({
        reason: 'LINE_REMOVED',
        lines: [{ productUnitId: 11, qty: '2' }],
        approval: null,
      }),
    ]);
  });

  it('asks before cancelling the sale', async () => {
    await openSale({ 'GET /session': () => json({ ...SESSION, approvalRequired: false }) });
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await screen.findByText('Сүү 1л');
    await user.click(screen.getByRole('button', { name: k.sale.cancel }));
    const ask = await screen.findByRole('dialog', { name: k.sale.cancelTitle });
    await user.click(within(ask).getByRole('button', { name: k.sale.cancel }));
    expect(await screen.findByText(k.sale.empty)).toBeInTheDocument();
  });

  it('goes back to the same cashier’s PIN when the session expired, keeping the cart', async () => {
    const edge = await openSale({
      [`GET /products/barcode/${BREAD_BARCODE}`]: () => problem('POS_SESSION_EXPIRED', 401),
      'POST /auth/pin': () =>
        json({ token: 'session-2', expiresAt: '2026-10-18T01:00:00.000Z', cashier: CASHIER }),
    });
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await screen.findByText('Сүү 1л');
    await wedgeScan(BREAD_BARCODE);

    expect(await screen.findByText(mn.errors.POS_SESSION_EXPIRED)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: CASHIER.fullName })).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    await user.keyboard('112233');
    expect(await screen.findByText('Сүү 1л')).toBeInTheDocument();
    expect(sessionStorage.getItem(SESSION_STORAGE_KEY)).toBe('session-2');
    expect(edge.callsTo('POST /auth/pin')[0]?.body).toEqual({ userId: 7, pin: '112233' });
  });

  it('shows the edge as offline with the documents still to send', async () => {
    await openSale({
      'GET /health': () =>
        json({
          status: 'ok',
          version: 'test',
          node: null,
          snapshot: { version: 'v1', pulledAt: null, products: 2 },
          central: { reachable: false, lastPullAt: null, lastPushAt: null },
          outbox: { pending: 3, rejected: 0 },
        }),
    });
    expect(await screen.findByRole('status', { name: /3 хүлээгдэж буй/ })).toBeInTheDocument();
  });
});
