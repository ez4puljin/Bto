import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type {
  EdgeEbarimtQueue,
  EdgeReceipt,
  EdgeSaleRequest,
  EdgeTaxpayer,
} from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  CASHIER,
  type EdgeHandler,
  fakeEdge,
  HEALTH,
  json,
  MILK_BARCODE,
  noContent,
  printable,
  problem,
  receiptOf,
  storeRoutes,
  SUPERVISOR,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;
/** Synthetic PosAPI answers: a ДДТД of 33 digits, a lottery, QR data (never real ones). */
const DDTD = '000000000000000000000000000000123';
const LOTTERY = 'АБ 12345678';
const QR = 'TEST-QR-DATA-0001';
const COMPANY_TIN = '10000000001';
const BUYER: EdgeTaxpayer = { tin: COMPANY_TIN, name: 'Туршилт ХХК', vatPayer: true };

function realReceipt(request: EdgeSaleRequest): EdgeReceipt {
  const base = receiptOf(request);
  return {
    ...base,
    title: 'Оргил супермаркет',
    footer: 'Баярлалаа!',
    ebarimt: {
      mode: 'REAL',
      status: 'CONFIRMED',
      ddtd: DDTD,
      posapiDate: '2026-10-17 11:15:00',
      receiptType: request.buyer ? 'B2B' : 'B2C',
      customerTin: request.buyer?.tin ?? null,
      customerName: request.buyer ? BUYER.name : null,
      merchantTin: '20000000002',
      merchantName: 'Туршилтын худалдагч',
      inactiveId: null,
      message: null,
    },
  };
}

/** Routes that answer any `GET /receipts/<id>/print` with `handler`. */
function withPrintRoute(
  routes: Record<string, EdgeHandler>,
  handler: EdgeHandler,
): Record<string, EdgeHandler> {
  return new Proxy(routes, {
    get(target, key) {
      if (typeof key === 'string' && /^GET \/receipts\/[^/]+\/print$/.test(key)) return handler;
      return target[key as string];
    },
  });
}

async function openSale(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(routes);
  const rendered = renderKiosk(edge, {
    device: 'device-1',
    session: 'session-1',
    cashierId: CASHIER.userId,
  });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  return { edge, print: rendered.print };
}

async function payExact(user: ReturnType<typeof userEvent.setup>) {
  await wedgeScan(MILK_BARCODE);
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('3,500₮'));
  await user.keyboard('{F12}');
  const pay = await screen.findByRole('dialog', { name: k.pay.title });
  // One cash row for the total, then «Баримт хэвлэх»: the receipt is chosen next.
  await user.keyboard('1');
  await user.keyboard('{Enter}');
  return pay;
}

describe('kiosk: e-Barimt and printing (ADR-0065)', () => {
  it('prints a real receipt at once with its lottery and QR, then a copy on a reprint', async () => {
    const { edge, print } = await openSale(
      withPrintRoute(
        storeRoutes({
          'POST /sales': (call) => {
            const request = call.body as EdgeSaleRequest;
            return json(printable(realReceipt(request), { lottery: LOTTERY, qrData: QR }));
          },
        }),
        (call) => {
          const id = call.path.split('/')[2] ?? '';
          const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
          return json(printable(realReceipt({ ...sale, clientId: id }), null, true));
        },
      ),
    );
    const printed: string[] = [];
    print.mockImplementation(() => {
      printed.push(screen.getByTestId('receipt-print').textContent ?? '');
    });
    const user = userEvent.setup();
    await payExact(user);
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: k.receipt.title });
    expect(
      within(dialog).getByText(k.receipt.lottery.replace('{{lottery}}', LOTTERY)),
    ).toBeVisible();
    expect(within(dialog).getByRole('img', { name: k.receipt.qr })).toBeInTheDocument();
    expect(within(dialog).getByText(DDTD)).toBeInTheDocument();
    expect(within(dialog).queryByText(k.receipt.test)).not.toBeInTheDocument();
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    // The printed sheet carried the lottery; once printed, the page drops it.
    expect(printed[0]).toContain(LOTTERY);
    expect(printed[0]).toContain('Баярлалаа!');
    await waitFor(() => expect(screen.getByTestId('receipt-print')).not.toHaveTextContent(LOTTERY));

    await user.click(within(dialog).getByRole('button', { name: k.print.again }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    expect(edge.calls.filter((call) => call.path.endsWith('/print'))).toHaveLength(1);
    // The edge answered a copy: «ХУУЛБАР», no lottery.
    expect(printed[1]).toContain(k.receipt.copy);
    expect(printed[1]).not.toContain(LOTTERY);
  });

  it('makes a company receipt from the registration number the lookup finds', async () => {
    const { edge } = await openSale(
      storeRoutes({
        'GET /ebarimt/taxpayer': (call) =>
          call.url.searchParams.get('no') === '1234567'
            ? json(BUYER)
            : problem('EBARIMT_TAXPAYER_NOT_FOUND', 404),
        'POST /sales': (call) =>
          json(printable(realReceipt(call.body as EdgeSaleRequest), { lottery: null, qrData: QR })),
      }),
    );
    const user = userEvent.setup();
    const pay = await payExact(user);
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2B }));
    await user.type(within(pay).getByLabelText(k.pay.buyer.number), '1234567{Enter}');
    expect(await within(pay).findByText(BUYER.name)).toBeInTheDocument();
    expect(edge.callsTo('POST /sales')).toHaveLength(0);
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    const dialog = await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale.buyer).toEqual({ tin: COMPANY_TIN });
    expect(within(dialog).getByText(k.receipt.buyer)).toBeInTheDocument();
  });

  it('says a company receipt waits for the internet when the lookup cannot be reached', async () => {
    await openSale(
      storeRoutes({ 'GET /ebarimt/taxpayer': () => problem('EBARIMT_LOOKUP_UNAVAILABLE', 503) }),
    );
    const user = userEvent.setup();
    const pay = await payExact(user);
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2B }));
    await user.type(within(pay).getByLabelText(k.pay.buyer.number), '1234567');
    await user.click(within(pay).getByRole('button', { name: k.pay.buyer.find }));
    expect(await within(pay).findByRole('alert')).toHaveTextContent(
      mn.errors.EBARIMT_LOOKUP_UNAVAILABLE,
    );
  });

  it('lets a supervisor send an unanswered receipt again after checking it', async () => {
    const queue: EdgeEbarimtQueue = {
      provider: 'posapi',
      posapi: {
        version: '3.2.50',
        lastSentDate: '2026-10-17 09:00:00',
        leftLotteries: 9000,
        checkedAt: '2026-10-17T03:00:00.000Z',
        error: null,
      },
      items: [
        {
          id: 41,
          group: 'CHECK',
          op: 'ISSUE',
          saleClientId: '0f0e0d0c-0b0a-4908-8706-050403020100',
          number: 'К1-261017-0003',
          kind: 'SALE',
          tillCode: 'К1',
          soldAt: '2026-10-17T02:00:00.000Z',
          total: '3500.00',
          receiptType: 'B2C',
          status: 'INDETERMINATE',
          ddtd: null,
          message: 'no answer within 20000 ms',
          attempts: 1,
          createdAt: '2026-10-17T02:00:00.000Z',
        },
      ],
    };
    const { edge } = await openSale(
      storeRoutes({
        'GET /health': () =>
          json({ ...HEALTH, ebarimt: { provider: 'posapi', ready: 0, attention: 1 } }),
        'GET /ebarimt/queue': () => json(queue),
        'POST /ebarimt/41/resolve': () => noContent(),
      }),
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: k.menu.label }));
    await user.click(await screen.findByRole('menuitem', { name: new RegExp(k.menu.ebarimt) }));
    const dialog = await screen.findByRole('dialog', { name: k.ebarimt.title });
    expect(await within(dialog).findByText('К1-261017-0003')).toBeInTheDocument();
    expect(within(dialog).getByText('no answer within 20000 ms')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: k.ebarimt.notIssued }));
    const field = await within(dialog).findByLabelText(k.approval.pin);
    expect(within(dialog).getByText(SUPERVISOR.fullName)).toBeInTheDocument();
    await user.type(field, '654321');
    await user.click(within(dialog).getByRole('button', { name: k.approval.approve }));
    await waitFor(() => expect(edge.callsTo('POST /ebarimt/41/resolve')).toHaveLength(1));
    expect(edge.callsTo('POST /ebarimt/41/resolve')[0]?.body).toEqual({
      outcome: 'NOT_ISSUED',
      approval: { supervisorUserId: SUPERVISOR.userId, pin: '654321' },
    });
  });
});
