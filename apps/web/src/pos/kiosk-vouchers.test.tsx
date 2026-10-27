import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import {
  type EdgeQuoteRequest,
  type EdgeQuotedVoucher,
  type EdgeSaleRequest,
  formatVoucherCode,
  voucherCodeOf,
} from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  CASHIER,
  type EdgeHandler,
  fakeEdge,
  json,
  MILK_BARCODE,
  problem,
  quoteOf,
  storeRoutes,
  SUPERVISOR,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;
const COUPON = voucherCodeOf('COUPON', '000000000001');
const VOUCHER = voucherCodeOf('PARTNER', '000000000002');
const UNKNOWN = voucherCodeOf('COUPON', '999999999999');

const facts: Record<string, Omit<EdgeQuotedVoucher, 'amount'>> = {
  [COUPON]: {
    code: COUPON,
    kind: 'COUPON',
    name: 'Арван хувь',
    effect: 'PERCENT',
    value: '10.00',
    partnerName: null,
    validTo: '2026-12-31',
  },
  [VOUCHER]: {
    code: VOUCHER,
    kind: 'PARTNER',
    name: 'Банкны ажилчдад',
    effect: 'AMOUNT',
    value: '5000.00',
    partnerName: 'Хамтрагч банк',
    validTo: '2026-12-31',
  },
};

/** The fake edge's quote with codes: the coupon 10 % off, then the voucher pays up to 5 000. */
function quoteWithCodes(request: EdgeQuoteRequest) {
  const base = quoteOf({ lines: request.lines });
  let total = new Decimal(base.total);
  const vouchers: EdgeQuotedVoucher[] = [];
  for (const code of request.codes ?? []) {
    const one = facts[code];
    if (one?.kind === 'COUPON') {
      const cut = total.times(one.value).div(100).toDecimalPlaces(0);
      total = total.minus(cut);
      vouchers.push({ ...one, amount: cut.toFixed(2) });
    }
  }
  let left = total;
  for (const code of request.codes ?? []) {
    const one = facts[code];
    if (one?.kind === 'PARTNER') {
      const paid = Decimal.min(new Decimal(one.value), left);
      left = left.minus(paid);
      vouchers.push({ ...one, amount: paid.toFixed(2) });
    }
  }
  const voucherTotal = total.minus(left);
  return {
    ...base,
    discountTotal: new Decimal(base.total).minus(total).toFixed(2),
    total: total.toFixed(2),
    vouchers,
    voucherTotal: voucherTotal.toFixed(2),
    due: left.toFixed(2),
  };
}

async function openSale(milks: number) {
  const routes: Record<string, EdgeHandler> = {
    'POST /quote': (call) => json(quoteWithCodes(call.body as EdgeQuoteRequest)),
    'POST /approvals/check': (call) => {
      const body = call.body as { pin: string };
      return body.pin === '654321'
        ? json({ approvedByName: SUPERVISOR.fullName })
        : problem('POS_PIN_INVALID', 401, { attemptsLeft: 4 });
    },
    [`GET /vouchers/${UNKNOWN}`]: () =>
      problem('POS_VOUCHER_INVALID', 422, { code: UNKNOWN, reason: 'UNKNOWN' }),
  };
  for (const code of [COUPON, VOUCHER]) {
    routes[`GET /vouchers/${code}`] = () => json(facts[code]);
  }
  const edge = fakeEdge(storeRoutes(routes));
  renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  for (let index = 0; index < milks; index += 1) await wedgeScan(MILK_BARCODE);
  const total = (3500 * milks).toLocaleString('en-US');
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent(`${total}₮`));
  return { edge, user: userEvent.setup() };
}

async function approve(user: ReturnType<typeof userEvent.setup>) {
  const dialog = await screen.findByRole('dialog', { name: k.approval.titles.VOUCHERS });
  await user.type(within(dialog).getByLabelText(k.approval.pin), '654321');
  await user.click(within(dialog).getByRole('button', { name: k.approval.approve }));
}

describe('kiosk: coupons and partner vouchers (ADR-0110)', () => {
  it('takes a scanned coupon and a typed voucher, then pays what is left', async () => {
    const { edge, user } = await openSale(2);
    await wedgeScan(COUPON);
    const dialog = await screen.findByRole('dialog', { name: k.vouchers.title });
    await waitFor(() => expect(within(dialog).getByTestId('voucher-due')).toHaveTextContent('6,300₮'));
    await user.type(within(dialog).getByLabelText(k.vouchers.codeLabel), `${VOUCHER}{Enter}`);
    await waitFor(() => expect(within(dialog).getByTestId('voucher-due')).toHaveTextContent('1,300₮'));
    expect(within(dialog).getByText(formatVoucherCode(VOUCHER), { exact: false })).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: k.vouchers.toPayment }));
    await approve(user);

    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    expect(within(pay).getByText(k.vouchers.due)).toBeInTheDocument();
    expect(within(pay).getAllByText('1,300₮').length).toBeGreaterThan(0);
    // No credit beside a partner voucher.
    expect(within(pay).queryByRole('radio', { name: k.pay.mode.CREDIT })).toBeNull();
    await user.click(within(pay).getByRole('button', { name: k.pay.exact }));
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({
      codes: [COUPON, VOUCHER],
      voucherApproval: { supervisorUserId: SUPERVISOR.userId, pin: '654321' },
      tenders: [{ kind: 'CASH', amount: '1300.00', tendered: '1300.00' }],
    });
  });

  it('refuses an unknown code in the till’s words', async () => {
    const { user } = await openSale(1);
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: k.vouchers.title });
    await user.type(within(dialog).getByLabelText(k.vouchers.codeLabel), `${UNKNOWN}{Enter}`);
    expect(
      await within(dialog).findByText(
        k.vouchers.refused.UNKNOWN.replace('{{code}}', formatVoucherCode(UNKNOWN)),
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: k.vouchers.toPayment })).toBeDisabled();
  });

  it('pays nothing more when the voucher covers the sale', async () => {
    const { edge, user } = await openSale(1);
    await user.keyboard('{F2}');
    const dialog = await screen.findByRole('dialog', { name: k.vouchers.title });
    await user.type(within(dialog).getByLabelText(k.vouchers.codeLabel), `${VOUCHER}{Enter}`);
    await waitFor(() => expect(within(dialog).getByTestId('voucher-due')).toHaveTextContent('0₮'));
    await user.click(within(dialog).getByRole('button', { name: k.vouchers.toPayment }));
    await approve(user);
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    expect(within(pay).queryByRole('radiogroup', { name: k.pay.mode.title })).toBeNull();
    await user.click(within(pay).getByRole('button', { name: k.pay.confirm }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    const sale = edge.callsTo('POST /sales')[0]?.body as EdgeSaleRequest;
    expect(sale).toMatchObject({ codes: [VOUCHER], tenders: [] });
  });
});
