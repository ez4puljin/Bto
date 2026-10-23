import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type {
  EdgeParkedBasket,
  EdgeQuickGroup,
  EdgeReceipt,
  EdgeReturnRequest,
  EdgeReturnSale,
} from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  CASHIER,
  COMPANY,
  type EdgeHandler,
  fakeEdge,
  json,
  MILK,
  MILK_BARCODE,
  storeRoutes,
  SUPERVISOR,
  TILL,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;
const qtyField = (name: string) => screen.getByLabelText(k.sale.qtyFor.replace('{{name}}', name));

async function openSale(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(storeRoutes(routes));
  renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  return edge;
}

const PARKED_ID = '0d6c2f4a-8b1e-4c3d-9f2a-7e5b1c0a9d11';
const SALE_ID = '7a1f3c2e-5d4b-4a6c-8e9f-0b1c2d3e4f50';

const RETURN_SALE: EdgeReturnSale = {
  clientId: SALE_ID,
  number: 'К1-261017-0002',
  soldAt: '2026-10-17T02:00:00.000Z',
  soldDay: '2026-10-17',
  tillCode: TILL.code,
  total: '7000.00',
  windowDays: 14,
  withinWindow: true,
  lines: [
    {
      lineNo: 1,
      productId: MILK.productId,
      productUnitId: 11,
      name: MILK.name,
      uomName: 'ш',
      qty: '2',
      unitPrice: '3500.00',
      total: '7000.00',
      returnable: '2',
    },
  ],
};

function refundOf(request: EdgeReturnRequest): EdgeReceipt {
  return {
    clientId: request.clientId,
    kind: 'RETURN',
    refundsNumber: RETURN_SALE.number,
    number: 'К1-261017-0005',
    soldAt: '2026-10-17T04:00:00.000Z',
    tillCode: TILL.code,
    cashierName: CASHIER.fullName,
    companyName: COMPANY,
    lines: [{ name: MILK.name, uomName: 'ш', qty: '1', unitPrice: '3500.00', total: '3500.00' }],
    subtotal: '3500.00',
    discountTotal: '0.00',
    total: '3500.00',
    vatTotal: '318.18',
    tenders: [{ kind: 'CASH', amount: '3500.00', tendered: null }],
    change: '0.00',
    ebarimt: { mode: 'TEST', ddtd: null },
  };
}

/** The supervisor's name is the only one, so only the PIN is typed. */
async function approve(user: ReturnType<typeof userEvent.setup>, pin = '654321') {
  const dialog = await screen.findByRole('dialog', { name: /./ });
  expect(within(dialog).getByText(SUPERVISOR.fullName)).toBeInTheDocument();
  const field = within(dialog).getByLabelText(k.approval.pin);
  await waitFor(() => expect(field).toHaveFocus());
  await user.type(field, pin);
  await user.click(within(dialog).getByRole('button', { name: k.approval.approve }));
  return dialog;
}

describe('kiosk: the till tools (ADR-0104)', () => {
  it('asks a supervisor before removing a line, refusing a wrong PIN', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => qtyField('Сүү 1л (ш)'));
    await user.keyboard('{Delete}');

    const dialog = await screen.findByRole('dialog', { name: k.approval.titles.LINE_REMOVED });
    expect(within(dialog).getByText(/Сүү 1л — 1 ш/)).toBeInTheDocument();
    await approve(user, '111111');
    expect(await within(dialog).findByText(mn.errors.POS_PIN_INVALID)).toBeInTheDocument();
    expect(screen.getByText('Сүү 1л')).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText(k.approval.pin), '654321');
    await user.click(within(dialog).getByRole('button', { name: k.approval.approve }));
    expect(await screen.findByText(k.sale.empty)).toBeInTheDocument();
    const [wrong, right] = edge.callsTo('POST /voids').map((call) => call.body);
    expect(right).toEqual({
      clientId: expect.any(String),
      reason: 'LINE_REMOVED',
      lines: [{ productUnitId: 11, qty: '1' }],
      approval: { supervisorUserId: SUPERVISOR.userId, pin: '654321' },
    });
    // The retry of one void keeps its client id.
    expect((wrong as { clientId: string }).clientId).toBe((right as { clientId: string }).clientId);
  });

  it('cancels the whole cart only with an approval', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => expect(qtyField('Сүү 1л (ш)')).toHaveValue('2'));
    await user.click(screen.getByRole('button', { name: k.sale.cancel }));
    await screen.findByRole('dialog', { name: k.approval.titles.CART_CANCELLED });
    await approve(user);
    expect(await screen.findByText(k.sale.empty)).toBeInTheDocument();
    expect(edge.callsTo('POST /voids')[0]?.body).toEqual(
      expect.objectContaining({
        reason: 'CART_CANCELLED',
        lines: [{ productUnitId: 11, qty: '2' }],
      }),
    );
  });

  it('adds from the F7 quick buttons and keeps the panel open', async () => {
    const groups: EdgeQuickGroup[] = [
      { id: 1, name: 'Сүүн', buttons: [{ label: 'Сүү', unitId: 11, product: MILK }] },
    ];
    await openSale({ 'GET /quick-buttons': () => json(groups) });
    const user = userEvent.setup();
    await user.keyboard('{F7}');
    const panel = await screen.findByRole('dialog', { name: k.quick.title });
    const button = await within(panel).findByRole('button', {
      name: k.quick.add.replace('{{name}}', 'Сүү'),
    });
    await user.click(button);
    await user.click(button);
    expect(screen.getByRole('dialog', { name: k.quick.title })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(qtyField('Сүү 1л (ш)')).toHaveValue('2'));
  });

  it('checks a price with F8 without touching the cart', async () => {
    const edge = await openSale();
    const user = userEvent.setup();
    await user.keyboard('{F8}');
    const check = await screen.findByRole('dialog', { name: k.priceCheck.title });
    await user.type(within(check).getByLabelText(k.search.label), `${MILK_BARCODE}{Enter}`);
    const prices = await within(check).findByRole('region', { name: MILK.name });
    expect(within(prices).getByText('3,500₮')).toBeInTheDocument();
    expect(within(prices).getByText('40,000₮')).toBeInTheDocument();
    expect(within(prices).getByText(MILK_BARCODE)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByText(k.sale.empty)).toBeInTheDocument();
    expect(edge.callsTo('POST /quote')).toHaveLength(0);
  });

  it('parks the cart with F9 and resumes it from F10', async () => {
    let held: EdgeParkedBasket[] = [];
    const edge = await openSale({
      'GET /parked': () => json(held),
      'POST /parked': (call) => {
        const body = call.body as { clientId: string; lines: EdgeParkedBasket['lines'] };
        held = [
          {
            clientId: PARKED_ID,
            tillCode: TILL.code,
            cashierName: CASHIER.fullName,
            parkedAt: '2026-10-17T03:00:00.000Z',
            lines: body.lines,
            itemCount: body.lines.length,
            total: '3500.00',
            preview: MILK.name,
          },
        ];
        return json(held[0]);
      },
      [`POST /parked/${PARKED_ID}/resume`]: () => {
        const lines = held[0]?.lines ?? [];
        held = [];
        return json(lines);
      },
    });
    const user = userEvent.setup();
    await wedgeScan(MILK_BARCODE);
    await waitFor(() => qtyField('Сүү 1л (ш)'));
    await user.keyboard('{F9}');
    expect(await screen.findByText(k.sale.parkedToast)).toBeInTheDocument();
    expect(screen.getByText(k.sale.empty)).toBeInTheDocument();
    expect(edge.callsTo('POST /parked')[0]?.body).toEqual({
      clientId: expect.any(String),
      lines: [{ productUnitId: 11, qty: '1' }],
    });

    await user.keyboard('{F10}');
    const list = await screen.findByRole('dialog', { name: k.parked.title });
    await user.click(
      await within(list).findByRole('button', {
        name: k.parked.resumeLabel.replace('{{time}}', '11:00'),
      }),
    );
    await waitFor(() => expect(qtyField('Сүү 1л (ш)')).toHaveValue('1'));
    expect(await screen.findByText(k.sale.resumedToast)).toBeInTheDocument();
  });

  it('returns a sold item by its receipt number, paid back in cash', async () => {
    const edge = await openSale({
      'GET /returns/sale': () => json(RETURN_SALE),
      'POST /returns': (call) => json(refundOf(call.body as EdgeReturnRequest)),
    });
    const user = userEvent.setup();
    await user.keyboard('{F4}');
    const dialog = await screen.findByRole('dialog', { name: k.returns.title });
    await user.type(within(dialog).getByLabelText(k.returns.number), 'K1-261017-0002{Enter}');
    const qty = await within(dialog).findByLabelText(k.returns.qty.replace('{{name}}', MILK.name));
    await user.type(qty, '1');
    expect(within(dialog).getByTestId('return-total')).toHaveTextContent('3,500₮');
    await user.click(within(dialog).getByRole('button', { name: k.returns.submit }));
    await approve(user);

    const receipt = await screen.findByRole('dialog', { name: k.receipt.returnTitle });
    expect(within(receipt).getByText(k.receipt.returnBanner)).toBeInTheDocument();
    expect(edge.callsTo('GET /returns/sale')[0]?.url.searchParams.get('number')).toBe(
      'K1-261017-0002',
    );
    expect(edge.callsTo('POST /returns')[0]?.body).toEqual({
      clientId: expect.any(String),
      refundsSaleClientId: SALE_ID,
      lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
      approval: { supervisorUserId: SUPERVISOR.userId, pin: '654321' },
    });
  });
});
