import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type {
  EdgeDayCountRequest,
  EdgeDaySummary,
  EdgeReceipt,
  EdgeSaleListItem,
} from '@tugeel/shared/pos';
import { describe, expect, it } from 'vitest';
import { todayInUb } from './day';
import {
  CASHIER,
  daySummaryOf,
  type EdgeHandler,
  fakeEdge,
  json,
  printable,
  problem,
  receiptOf,
  storeRoutes,
  TILL,
} from './test/fake-edge';
import { renderKiosk } from './test/render-kiosk';

const k = mn.posKiosk;
const SALE_ID = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const RETURN_ID = '2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f60';
const PAST_DAY = '2026-10-17';

const HISTORY: EdgeSaleListItem[] = [
  {
    clientId: RETURN_ID,
    kind: 'RETURN',
    number: 'К1-261017-0005',
    soldAt: '2026-10-17T05:30:00.000Z',
    total: '3500.00',
    payments: ['CASH'],
    customerName: null,
    receiptType: null,
    ebarimtStatus: null,
  },
  {
    clientId: SALE_ID,
    kind: 'SALE',
    number: 'К1-261017-0004',
    soldAt: '2026-10-17T03:15:00.000Z',
    total: '7000.00',
    payments: ['Бэлэн мөнгө', 'CARD'],
    customerName: 'Номин дэлгүүр',
    receiptType: 'B2C',
    ebarimtStatus: null,
  },
];

const SALE_RECEIPT: EdgeReceipt = receiptOf(
  {
    clientId: SALE_ID,
    lines: [{ productUnitId: 11, qty: '2' }],
    tenders: [{ kind: 'CASH', amount: '7000.00' }],
  },
  'К1-261017-0004',
);

async function openSale(routes: Record<string, EdgeHandler> = {}) {
  const edge = fakeEdge(storeRoutes(routes));
  const rendered = renderKiosk(edge, {
    device: 'device-1',
    session: 'session-1',
    cashierId: CASHIER.userId,
  });
  const scanBox = await screen.findByLabelText(k.sale.scanLabel);
  await waitFor(() => expect(scanBox).toHaveFocus());
  const printed: string[] = [];
  rendered.print.mockImplementation(() => {
    printed.push(screen.getByTestId('receipt-print').textContent ?? '');
  });
  return { edge, print: rendered.print, printed };
}

async function openMenuItem(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name: k.menu.label }));
  await user.click(await screen.findByRole('menuitem', { name }));
}

describe('kiosk: till records (ADR-0111)', () => {
  it('lists a chosen day’s sales and returns and prints a copy of one', async () => {
    const { edge, print } = await openSale({
      'GET /sales': (call) => json(call.url.searchParams.get('day') === PAST_DAY ? HISTORY : []),
      [`GET /receipts/${SALE_ID}/print`]: () => json(printable(SALE_RECEIPT, null, true)),
    });
    const user = userEvent.setup();
    await openMenuItem(user, k.menu.history);
    const dialog = await screen.findByRole('dialog', { name: k.history.title });
    await within(dialog).findByText(k.history.empty);
    expect(edge.callsTo('GET /sales')[0]?.url.searchParams.get('day')).toBe(todayInUb());

    const day = within(dialog).getByLabelText(k.history.day);
    // A future day is not offered.
    fireEvent.change(day, { target: { value: '2999-01-01' } });
    expect(day).toHaveValue(todayInUb());
    fireEvent.change(day, { target: { value: PAST_DAY } });
    const sale = await within(dialog).findByRole('button', {
      name: k.history.open.replace('{{number}}', 'К1-261017-0004'),
    });
    expect(sale).toHaveTextContent('Бэлэн мөнгө + Карт · Номин дэлгүүр');
    expect(sale).toHaveTextContent('7,000₮');
    const refund = within(dialog).getByRole('button', {
      name: k.history.open.replace('{{number}}', 'К1-261017-0005'),
    });
    expect(refund).toHaveTextContent(k.history.returnTag);
    expect(refund).toHaveTextContent('Бэлэн');

    await user.type(within(dialog).getByLabelText(k.history.search), '0004');
    await waitFor(() =>
      expect(edge.callsTo('GET /sales').at(-1)?.url.searchParams.get('q')).toBe('0004'),
    );
    expect(edge.callsTo('GET /sales').at(-1)?.url.searchParams.get('day')).toBe(PAST_DAY);

    await user.click(sale);
    expect(
      await within(dialog).findByRole('article', {
        name: k.receipt.label.replace('{{number}}', 'К1-261017-0004'),
      }),
    ).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: k.history.printCopy }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(edge.callsTo(`GET /receipts/${SALE_ID}/print`)).toHaveLength(2);
  });

  it('counts the banknotes, saves the count once per attempt and prints the day', async () => {
    let failNext = true;
    const { edge, print, printed } = await openSale({
      'POST /day-summary': (call) => {
        if (failNext) {
          failNext = false;
          return problem('INTERNAL_ERROR', 500);
        }
        const body = call.body as EdgeDayCountRequest;
        const counted: EdgeDaySummary = {
          ...daySummaryOf(body.day),
          counted: {
            clientId: body.clientId,
            counts: body.counts,
            total: '91500.00',
            cashierName: CASHIER.fullName,
            countedAt: '2026-10-17T10:00:00.000Z',
          },
        };
        return json(counted);
      },
    });
    const user = userEvent.setup();
    await openMenuItem(user, k.menu.daySummary);
    const dialog = await screen.findByRole('dialog', { name: k.daySummary.title });
    await within(dialog).findByText('Хаан банк');
    expect(edge.callsTo('GET /day-summary')[0]?.url.searchParams.get('day')).toBe(todayInUb());
    expect(within(dialog).getByTestId('day-expected')).toHaveTextContent('92,000₮');
    expect(within(dialog).getByText(TILL.name)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: k.daySummary.reprint })).toBeNull();

    const field = (note: string) =>
      within(dialog).getByLabelText(k.daySummary.noteCount.replace('{{note}}', note));
    await user.type(field('20,000'), '4');
    await user.type(field('10,000'), '1x');
    await user.type(field('500'), '3');
    expect(field('10,000')).toHaveValue('1');
    expect(within(dialog).getByTestId('day-counted')).toHaveTextContent('91,500₮');
    expect(within(dialog).getByTestId('day-difference')).toHaveTextContent('-500₮');

    await user.click(within(dialog).getByRole('button', { name: k.daySummary.save }));
    await within(dialog).findByRole('alert');
    expect(print).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: k.daySummary.save }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

    const posts = edge.callsTo('POST /day-summary').map((call) => call.body as EdgeDayCountRequest);
    expect(posts).toHaveLength(2);
    // The retry of the same notes keeps the count's id.
    expect(posts[1]?.clientId).toBe(posts[0]?.clientId);
    expect(posts[1]).toEqual({
      clientId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      day: todayInUb(),
      counts: [
        { note: 20000, count: 4 },
        { note: 10000, count: 1 },
        { note: 5000, count: 0 },
        { note: 1000, count: 0 },
        { note: 500, count: 3 },
        { note: 100, count: 0 },
        { note: 50, count: 0 },
      ],
    });

    const sheet = printed[0] ?? '';
    expect(sheet).toContain(`${TILL.name} касс`);
    expect(sheet).toContain('Эхэлсэн: 09:00');
    expect(sheet).toContain('Хэвлэсэн: ');
    expect(sheet).toContain('Бэлэн мөнгө нийт - 42,000 / ....................');
    expect(sheet).toContain('Карт нийт - 18,000 / ....................');
    expect(sheet).toContain('Хаан банк нийт - 5,000 / ....................');
    expect(sheet).toContain('Тушаасан бэлэн мөнгө задаргаа');
    expect(sheet).toContain('20,000 - 4 ширхэг');
    expect(sheet).toContain('10,000 - 1 ширхэг');
    expect(sheet).toContain('500 - 3 ширхэг');
    expect(sheet).not.toContain('5,000 -');
    expect(sheet).not.toContain('1,000 -');
    expect(sheet).not.toMatch(/(^|[^0-9,])100 -/);
    expect(sheet).not.toMatch(/(^|[^0-9,])50 -/);
    expect(sheet).toContain('Нийт - 91,500');
    expect(sheet).toContain(`Тушаасан ${TILL.name} касс - ______ (Гарын үсэг)`);
    expect(sheet).toContain('Хүлээн авсан Заалны зохион байгуулагч - ______ (Гарын үсэг)');

    // The kept count fills the fields and prints again without a new count.
    await user.click(await within(dialog).findByRole('button', { name: k.daySummary.reprint }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(2));
    expect(edge.callsTo('POST /day-summary')).toHaveLength(2);
    expect(field('20,000')).toHaveValue('4');
    expect(printed[1]).toContain('20,000 - 4 ширхэг');
  });

  it('prints a test slip from the menu', async () => {
    const { print, printed } = await openSale();
    const user = userEvent.setup();
    await openMenuItem(user, k.menu.printTest);
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printed[0]).toContain(`${TILL.name} касс`);
    expect(printed[0]).toContain(k.printTest.works);
  });
});
