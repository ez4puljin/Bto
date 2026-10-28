import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type { EdgeMember, EdgeSaleRequest, SnapshotPaymentType } from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  CASHIER,
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
const TYPES: SnapshotPaymentType[] = [
  { id: 1, name: 'Бэлэн', kind: 'CASH' },
  { id: 4, name: 'Зээл', kind: 'CREDIT' },
];
const MEMBER: EdgeMember = {
  id: 31,
  name: 'Батбаяр',
  phone: '99••••33',
  status: 'ACTIVE',
  balance: '1200.00',
  lifetime: '8000000.00',
  tier: { name: 'Энгийн', percent: '1.00' },
  nextTier: { name: 'Мөнгөн', percent: '2.00', fromAmount: '20000000.00', left: '12000000.00' },
};
const typeButton = (pay: HTMLElement, name: string) =>
  within(pay).queryByRole('button', { name: new RegExp(`^[0-9]+ ?${name}$`) });

async function openSale(member: EdgeMember = MEMBER) {
  const edge = fakeEdge(
    storeRoutes({
      'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }),
      'GET /members': (call) =>
        call.url.searchParams.get('phone') === '99112233'
          ? json(member)
          : problem('POS_MEMBER_NOT_FOUND', 404, {}),
      'POST /sales': (call) => {
        const body = call.body as EdgeSaleRequest;
        if (body.member?.pin && body.member.pin !== '1234') {
          return problem('POS_MEMBER_PIN_INVALID', 401, { attemptsLeft: 4 });
        }
        return json(
          printable({
            ...receiptOf(body),
            loyalty: {
              memberName: member.name,
              phone: member.phone,
              tierName: 'Энгийн',
              percent: '1.00',
              earned: '58.00',
              spent: '1200.00',
              givenBack: '0.00',
              clawback: '0.00',
              balance: '58.00',
            },
          }),
        );
      },
    }),
  );
  renderKiosk(edge, { device: 'device-1', session: 'session-1', cashierId: CASHIER.userId });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  await wedgeScan(MILK_BARCODE);
  await wedgeScan(MILK_BARCODE);
  await waitFor(() => expect(screen.getByTestId('sale-total')).toHaveTextContent('7,000₮'));
  return { edge, user: userEvent.setup() };
}

async function attach(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{F3}');
  const dialog = await screen.findByRole('dialog', { name: k.loyalty.title });
  await user.type(within(dialog).getByLabelText(k.loyalty.phone), '88000000{Enter}');
  expect(await within(dialog).findByText(mn.errors.POS_MEMBER_NOT_FOUND)).toBeInTheDocument();
  await user.clear(within(dialog).getByLabelText(k.loyalty.phone));
  await user.type(within(dialog).getByLabelText(k.loyalty.phone), '99112233{Enter}');
  expect(await within(dialog).findByTestId('member-balance')).toHaveTextContent('1,200');
  expect(within(dialog).getByText('Батбаяр')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: k.loyalty.attach }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: k.loyalty.title })).not.toBeInTheDocument(),
  );
}

describe('kiosk: the bonus card (ADR-0112)', () => {
  it('attaches a member by phone, spends points with the PIN and pays the rest', async () => {
    const { edge, user } = await openSale();
    await attach(user);
    expect(screen.getByRole('button', { name: /Батбаяр/ })).toBeInTheDocument();
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    // A member never buys on credit; points are a row of their own.
    await waitFor(() => expect(typeButton(pay, 'Бэлэн')).not.toBeNull());
    expect(typeButton(pay, 'Зээл')).toBeNull();
    await user.click(typeButton(pay, mn.pos.tenderKinds.POINTS) as HTMLElement);
    expect(
      within(pay).getByLabelText(k.pay.rows.amount.replace('{{name}}', mn.pos.tenderKinds.POINTS)),
    ).toHaveValue('1200');
    // Not ready until the member types the four-digit PIN.
    await user.click(typeButton(pay, 'Бэлэн') as HTMLElement);
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
    await user.type(within(pay).getByLabelText(k.loyalty.pin), '0000');
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    expect(await within(pay).findByText(mn.errors.POS_MEMBER_PIN_INVALID)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.back }));
    await user.clear(within(pay).getByLabelText(k.loyalty.pin));
    await user.type(within(pay).getByLabelText(k.loyalty.pin), '1234');
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    const receipt = await screen.findByRole('dialog', { name: k.receipt.title });
    const sales = edge.callsTo('POST /sales');
    expect(sales.at(-1)?.body).toMatchObject({
      member: { id: MEMBER.id, pin: '1234' },
      tenders: [
        { kind: 'CASH', paymentTypeId: 1, amount: '5800.00' },
        { kind: 'POINTS', paymentTypeId: null, amount: '1200.00' },
      ],
    });
    const card = within(receipt).getByRole('region', { name: k.loyalty.title });
    expect(within(card).getByText(k.loyalty.receipt.earned)).toBeInTheDocument();
    expect(within(card).getByText('+58')).toBeInTheDocument();
  });

  it('earns without a PIN when no points are spent', async () => {
    const { edge, user } = await openSale();
    await attach(user);
    await user.keyboard('{F12}');
    const pay = await screen.findByRole('dialog', { name: k.pay.title });
    await waitFor(() => expect(typeButton(pay, 'Бэлэн')).not.toBeNull());
    await user.click(typeButton(pay, 'Бэлэн') as HTMLElement);
    expect(within(pay).getByText(k.loyalty.toEarn.replace('{{points}}', '70'))).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(edge.callsTo('POST /sales').at(-1)?.body).toMatchObject({
      member: { id: MEMBER.id, pin: null },
    });
  });

  it('will not attach a blocked card', async () => {
    const { user } = await openSale({ ...MEMBER, status: 'BLOCKED' });
    await user.keyboard('{F3}');
    const dialog = await screen.findByRole('dialog', { name: k.loyalty.title });
    await user.type(within(dialog).getByLabelText(k.loyalty.phone), '99112233{Enter}');
    expect(await within(dialog).findByText(k.loyalty.blocked)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: k.loyalty.attach })).toBeDisabled();
  });
});
