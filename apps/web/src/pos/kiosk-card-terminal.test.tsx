import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import type {
  EdgeCardAttempt,
  EdgeCardAttemptRequest,
  EdgeCardAttemptResult,
  EdgeSaleRequest,
  SnapshotPaymentType,
} from '@tugeel/shared/pos';
import { describe, expect, it, vi } from 'vitest';
import { wedgeScan } from '@/test/scan';
import {
  type CardTerminalClient,
  type TerminalInfo,
  type TerminalLookup,
  type TerminalOutcome,
  type TerminalSale,
  TerminalUnavailable,
} from './khan-terminal';
import {
  CASHIER,
  type EdgeCall,
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
const c = k.pay.card;
const pill = (status: string) => k.terminal.label.replace('{{status}}', status);

/** «Khaanbank terminal» drives the bank's terminal on the till PC (ADR-0208). */
const TYPES: SnapshotPaymentType[] = [
  { id: 1, name: 'Бэлэн', kind: 'CASH' },
  { id: 2, name: 'Khaanbank terminal', kind: 'CARD', terminal: 'KHAN' },
  { id: 3, name: 'Шилжүүлэг', kind: 'TRANSFER' },
];

const INFO: TerminalInfo = {
  terminalId: '70107480',
  terminalName: 'Orgil buunii tuv 1',
  port: 'COM7',
  version: '2.1.5.199',
};

const APPROVED: TerminalOutcome = {
  outcome: 'APPROVED',
  response: { status: true, response: { response_code: '000', response_msg: 'Approved' } },
};

/**
 * `getLastTransaction` as the real terminal answered it on 2026-11-17 (the owner's test), with the
 * reference and the amount of the charge asked about.
 */
const foundOf = (refNo: string, amount: string): TerminalLookup => ({
  found: 'APPROVED',
  amount,
  response: {
    status: true,
    response: {
      amount,
      app_name: 'PASS',
      batch_no: '000000001529',
      db_ref_no: refNo,
      entry_mode: 'Qr',
      pan: '438054XXXXXX5538',
      response_code: '000',
      response_msg: 'Гүйлгээ зөвшөөрөгдсөн.',
      rrn: '008209672971',
      terminal_id: '70107480',
      trace_no: '183607',
    },
  },
});
const NOT_FOUND: TerminalLookup = {
  found: 'NONE',
  response: { status: true, response: { response_code: '38B', response_msg: 'Гүйлгээ олдсонгүй' } },
};

const amountOf = (name: string) => k.pay.rows.amount.replace('{{name}}', name);
const typeButton = (pay: HTMLElement, name: string) =>
  within(pay).getByRole('button', { name: new RegExp(`^[0-9]+ ?${name}$`) });

/**
 * A terminal that never touches a real one: `answers` are given in order (a function is called
 * when the sale arrives, so a test can hold the answer back), `ready` is what the status says.
 */
function fakeTerminal(
  answers: (TerminalOutcome | (() => Promise<TerminalOutcome>))[] = [],
  /** What the terminal says of a reference when asked; nothing readable unless given. */
  lookups: ((refNo: string) => TerminalLookup)[] = [],
) {
  const state = { ready: true };
  const sales: TerminalSale[] = [];
  const settlements: string[] = [];
  const asked: string[] = [];
  const next = async (): Promise<TerminalOutcome> => {
    const answer = answers.shift();
    if (!answer) throw new Error('the fake terminal has no answer left');
    return typeof answer === 'function' ? answer() : answer;
  };
  const terminal: CardTerminalClient = {
    checkStatus: vi.fn(() =>
      state.ready ? Promise.resolve(INFO) : Promise.reject(new TerminalUnavailable()),
    ),
    sale: vi.fn(async (request: TerminalSale) => {
      sales.push(request);
      return next();
    }),
    settlement: vi.fn(async (refNo: string) => {
      settlements.push(refNo);
      return next();
    }),
    lookup: vi.fn((refNo: string) => {
      asked.push(refNo);
      const answer = lookups.shift();
      return Promise.resolve<TerminalLookup>(
        answer ? answer(refNo) : { found: 'UNKNOWN', message: null },
      );
    }),
  };
  return { terminal, sales, settlements, asked, state };
}

/** The edge's record of the till's card charges, as its routes keep it. */
function cardRoutes(seed: EdgeCardAttempt[] = []) {
  const attempts: EdgeCardAttempt[] = [...seed];
  const idOf = (call: EdgeCall) => call.path.split('/')[2] ?? '';
  const find = (call: EdgeCall) => attempts.find((attempt) => attempt.id === idOf(call));
  const make = (id: string, patch: Partial<EdgeCardAttempt>): EdgeCardAttempt => ({
    id,
    kind: 'SALE',
    status: 'PENDING',
    refNo: `202611179${String(attempts.length + 1).padStart(5, '0')}`,
    saleClientId: null,
    paymentTypeId: null,
    amount: '0.00',
    cashierName: CASHIER.fullName,
    createdAt: '2026-11-17T06:32:00.000Z',
    usedAt: null,
    source: null,
    message: null,
    ...patch,
  });
  const begin = (attempt: EdgeCardAttempt) => {
    const pending = attempts.find((entry) => entry.status === 'PENDING');
    if (pending) {
      return problem('POS_CARD_PENDING', 409, { refNo: pending.refNo, amount: pending.amount });
    }
    attempts.push(attempt);
    return json(attempt);
  };
  const routes: Record<string, EdgeHandler> = {
    'GET /card-attempts/open': () =>
      json(
        attempts.filter(
          (attempt) =>
            attempt.status === 'PENDING' || (attempt.status === 'APPROVED' && !attempt.usedAt),
        ),
      ),
    'POST /card-attempts': (call) => {
      const body = call.body as EdgeCardAttemptRequest;
      return begin(
        make(body.id, {
          saleClientId: body.saleClientId,
          paymentTypeId: body.paymentTypeId,
          amount: body.amount,
        }),
      );
    },
    'POST /card-settlements': (call) =>
      begin(make((call.body as { id: string }).id, { kind: 'SETTLEMENT' })),
    'POST /card-attempts/:id/result': (call) => {
      const attempt = find(call);
      if (!attempt) return problem('NOT_FOUND', 404);
      const body = call.body as EdgeCardAttemptResult;
      Object.assign(attempt, { status: body.outcome, source: body.source, message: body.message });
      return json(attempt);
    },
    'GET /card-attempts': () => json([...attempts].reverse()),
    'POST /card-attempts/:id/lookup': (call) => {
      const attempt = find(call);
      if (!attempt) return problem('NOT_FOUND', 404);
      const told = (call.body as { response: { response?: Record<string, string> } }).response
        .response;
      if (told?.response_code === '000') {
        attempt.details = {
          maskedPan: told.pan ?? null,
          rrn: told.rrn ?? null,
          traceNo: told.trace_no ?? null,
          batchNo: told.batch_no ?? null,
          entryMode: told.entry_mode ?? null,
          appName: told.app_name ?? null,
        };
      }
      return json(attempt);
    },
    'POST /card-attempts/:id/void': (call) => {
      const attempt = find(call);
      if (!attempt) return problem('NOT_FOUND', 404);
      attempt.status = 'VOIDED';
      return json(attempt);
    },
  };
  return { attempts, routes };
}

async function openPayment(
  terminal: CardTerminalClient,
  routes: Record<string, EdgeHandler> = {},
  seed: EdgeCardAttempt[] = [],
) {
  const cards = cardRoutes(seed);
  const edge = fakeEdge(
    storeRoutes({
      'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }),
      'POST /sales': (call) => {
        const request = call.body as EdgeSaleRequest;
        for (const tender of request.tenders) {
          const attempt = cards.attempts.find((entry) => entry.id === tender.cardAttemptId);
          if (attempt) attempt.usedAt = '2026-11-17T06:33:00.000Z';
        }
        return json(printable(receiptOf(request)));
      },
      ...cards.routes,
      ...routes,
    }),
  );
  renderKiosk(edge, {
    device: 'device-1',
    session: 'session-1',
    cashierId: CASHIER.userId,
    terminal,
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
  return { edge, user, pay, cards };
}

/** The whole 7,000₮ on the card: the terminal's type, «Баримт хэвлэх», «Хувь хүн». */
async function payByCard(user: ReturnType<typeof userEvent.setup>, pay: HTMLElement) {
  await waitFor(() => expect(typeButton(pay, 'Khaanbank terminal')).toBeEnabled());
  await user.click(typeButton(pay, 'Khaanbank terminal'));
  expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toHaveValue('7000');
  await user.click(within(pay).getByRole('button', { name: k.pay.print }));
  await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
}

const resultsOf = (edge: ReturnType<typeof fakeEdge>) =>
  edge.calls
    .filter((call) => call.method === 'POST' && call.path.endsWith('/result'))
    .map((call) => call.body as EdgeCardAttemptResult);
const salesOf = (edge: ReturnType<typeof fakeEdge>) =>
  edge.callsTo('POST /sales').map((call) => call.body as EdgeSaleRequest);

describe('kiosk: a card type that drives the bank terminal (ADR-0208)', () => {
  it('sends the amount to the terminal, waits, and writes the sale only after the approval', async () => {
    let answer: (outcome: TerminalOutcome) => void = () => undefined;
    const held = () => new Promise<TerminalOutcome>((resolve) => (answer = resolve));
    const { terminal, sales } = fakeTerminal([held]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);

    // The terminal has the amount; the payment waits and nothing can be pressed twice.
    const waiting = await within(pay).findByRole('status');
    expect(waiting).toHaveTextContent(c.waitingTitle);
    expect(waiting).toHaveTextContent('7,000₮');
    expect(sales).toEqual([{ refNo: '20261117900001', amount: '7000.00', billType: '1' }]);
    expect(cards.attempts).toMatchObject([{ status: 'PENDING', amount: '7000.00' }]);
    expect(within(pay).getByRole('button', { name: mn.common.cancel })).toBeDisabled();
    expect(within(pay).queryByRole('button', { name: k.pay.receiptChoice.B2C })).toBeNull();
    await user.keyboard('{Enter}');
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: k.pay.title })).toBeInTheDocument();
    expect(terminal.sale).toHaveBeenCalledTimes(1);
    expect(salesOf(edge)).toHaveLength(0);

    answer(APPROVED);
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(1);
    // The terminal's whole answer is kept with the charge.
    expect(resultsOf(edge)).toEqual([
      { outcome: 'APPROVED', source: 'TERMINAL', response: APPROVED.response, message: null },
    ]);
    const attempt = cards.attempts[0];
    expect(salesOf(edge)).toHaveLength(1);
    expect(salesOf(edge)[0]?.tenders).toEqual([
      {
        kind: 'CARD',
        paymentTypeId: 2,
        amount: '7000.00',
        terminalId: null,
        rrn: null,
        cardAttemptId: attempt?.id,
      },
    ]);
    // The charge was written before the terminal was asked.
    const begun = edge.calls.findIndex((call) => call.path === '/card-attempts');
    const recorded = edge.calls.findIndex((call) => call.path.endsWith('/result'));
    expect(begun).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(begun);
  });

  it('declined on the terminal: no payment, the terminal’s words, and the cashier may try again', async () => {
    const { terminal } = fakeTerminal([
      {
        outcome: 'DECLINED',
        response: { status: true, response: { response_code: '051' } },
        message: 'Үлдэгдэл хүрэлцэхгүй',
      },
      APPROVED,
    ]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    expect(await within(pay).findByText(/Үлдэгдэл хүрэлцэхгүй/)).toBeInTheDocument();
    expect(salesOf(edge)).toHaveLength(0);
    expect(resultsOf(edge)).toMatchObject([{ outcome: 'DECLINED', source: 'TERMINAL' }]);
    expect(cards.attempts).toMatchObject([{ status: 'DECLINED' }]);

    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(2);
    expect(cards.attempts).toHaveLength(2);
    expect(salesOf(edge)[0]?.tenders[0]).toMatchObject({ cardAttemptId: cards.attempts[1]?.id });
  });

  it('the service’s own Exception: no payment, its message, kept as failed', async () => {
    const { terminal } = fakeTerminal([
      {
        outcome: 'FAILED',
        response: { status: false, response: { Exception: { ErrorMessage: 'COM7 нээгдсэнгүй' } } },
        message: 'COM7 нээгдсэнгүй',
      },
    ]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    expect(await within(pay).findByText(/COM7 нээгдсэнгүй/)).toBeInTheDocument();
    expect(salesOf(edge)).toHaveLength(0);
    expect(cards.attempts).toMatchObject([{ status: 'FAILED', message: 'COM7 нээгдсэнгүй' }]);
  });

  it('no answer from the terminal: nothing is paid, nothing is sent again until the slip is read', async () => {
    const { terminal } = fakeTerminal([
      { outcome: 'UNKNOWN', response: null, message: 'Failed to fetch' },
      APPROVED,
    ]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    const panel = await within(pay).findByText(c.unknown.title);
    expect(panel).toBeInTheDocument();
    expect(within(pay).getByText(/20261117900001/)).toBeInTheDocument();
    expect(salesOf(edge)).toHaveLength(0);
    expect(resultsOf(edge)).toHaveLength(0);
    expect(cards.attempts).toMatchObject([{ status: 'PENDING' }]);
    // The charge stays open: paying again is not possible.
    expect(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C })).toBeEnabled();
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.back }));
    expect(within(pay).getByRole('button', { name: k.pay.print })).toBeDisabled();
    expect(typeButton(pay, 'Khaanbank terminal')).toBeDisabled();
    expect(terminal.sale).toHaveBeenCalledTimes(1);

    // The slip did not come out: the cashier says so and may charge again.
    await user.click(within(pay).getByRole('button', { name: c.unknown.notCharged }));
    await waitFor(() => expect(within(pay).queryByText(c.unknown.title)).toBeNull());
    expect(resultsOf(edge)).toEqual([
      { outcome: 'FAILED', source: 'CASHIER', response: null, message: null },
    ]);
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(2);
  });

  it('no answer, but the slip came out: the charge pays the sale without a second one', async () => {
    const { terminal } = fakeTerminal([
      { outcome: 'UNKNOWN', response: null, message: 'Failed to fetch' },
    ]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    await user.click(await within(pay).findByRole('button', { name: c.unknown.charged }));
    await waitFor(() => expect(within(pay).queryByText(c.unknown.title)).toBeNull());
    expect(resultsOf(edge)).toMatchObject([{ outcome: 'APPROVED', source: 'CASHIER' }]);
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.back }));
    // The row is the charge now: its amount cannot be changed.
    expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toBeDisabled();
    expect(within(pay).getByText(c.charged)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(1);
    expect(salesOf(edge)[0]?.tenders[0]).toMatchObject({ cardAttemptId: cards.attempts[0]?.id });
  });

  it('no answer, then the terminal is asked about the reference: approved there, paid here', async () => {
    const { terminal, asked } = fakeTerminal(
      [{ outcome: 'UNKNOWN', response: null, message: 'Failed to fetch' }],
      [(refNo) => foundOf(refNo, '7000')],
    );
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    await user.click(await within(pay).findByRole('button', { name: c.unknown.lookup }));
    await waitFor(() => expect(within(pay).queryByText(c.unknown.title)).toBeNull());
    expect(asked).toEqual(['20261117900001']);
    // The terminal's own word, kept with the charge: its answer, then approved by the terminal.
    expect(edge.callsTo(`POST /card-attempts/${cards.attempts[0]?.id}/lookup`)).toHaveLength(1);
    expect(resultsOf(edge)).toEqual([
      { outcome: 'APPROVED', source: 'TERMINAL', response: null, message: null },
    ]);
    expect(cards.attempts[0]?.details).toMatchObject({
      rrn: '008209672971',
      maskedPan: '438054XXXXXX5538',
    });
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.back }));
    expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toBeDisabled();
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(1);
    expect(salesOf(edge)[0]?.tenders[0]).toMatchObject({ cardAttemptId: cards.attempts[0]?.id });
  });

  it('asked and not found, or found for another amount: nothing is decided for the cashier', async () => {
    const { terminal } = fakeTerminal(
      [{ outcome: 'UNKNOWN', response: null, message: 'Failed to fetch' }],
      [() => NOT_FOUND, (refNo) => foundOf(refNo, '300')],
    );
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    await user.click(await within(pay).findByRole('button', { name: c.unknown.lookup }));
    expect(await within(pay).findByText(c.unknown.lookupNone)).toBeInTheDocument();
    // Still open: the card may be in the terminal yet. Only the cashier says it was not paid.
    expect(cards.attempts).toMatchObject([{ status: 'PENDING' }]);
    expect(resultsOf(edge)).toHaveLength(0);
    expect(within(pay).getByText(c.unknown.title)).toBeInTheDocument();

    await user.click(within(pay).getByRole('button', { name: c.unknown.lookup }));
    expect(await within(pay).findByText(/300₮/)).toBeInTheDocument();
    expect(cards.attempts).toMatchObject([{ status: 'PENDING' }]);
    expect(resultsOf(edge)).toHaveLength(0);
    expect(salesOf(edge)).toHaveLength(0);
  });

  it('approved without the card’s facts in the answer: the terminal is asked once and they are kept', async () => {
    const { terminal, asked } = fakeTerminal([APPROVED], [(refNo) => foundOf(refNo, '7000')]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await payByCard(user, pay);
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(asked).toEqual(['20261117900001']);
    expect(cards.attempts[0]?.details).toMatchObject({ rrn: '008209672971' });
    // Asked after the approval was recorded, before the sale was written.
    const paths = edge.calls.map((call) => call.path);
    expect(paths.findIndex((path) => path.endsWith('/lookup'))).toBeGreaterThan(
      paths.findIndex((path) => path.endsWith('/result')),
    );
    expect(paths.indexOf('/sales')).toBeGreaterThan(
      paths.findIndex((path) => path.endsWith('/lookup')),
    );
  });

  it('the terminal is not there: the card type is off and says why, until it answers', async () => {
    const { terminal, state } = fakeTerminal([APPROVED]);
    state.ready = false;
    const { edge, user, pay } = await openPayment(terminal);
    const card = typeButton(pay, 'Khaanbank terminal');
    await waitFor(() => expect(card).toHaveAttribute('title', c.offlineShort));
    // The status line is gone from the dialog: the header's pill says it (ADR-0208).
    expect(within(pay).queryByText(c.offline)).toBeNull();
    expect(card).toBeDisabled();
    expect(card).toHaveAttribute('title', c.offlineShort);
    // The key of its place does nothing either.
    await user.keyboard('2');
    expect(within(pay).queryByLabelText(amountOf('Khaanbank terminal'))).toBeNull();
    expect(terminal.sale).not.toHaveBeenCalled();
    expect(edge.callsTo('POST /card-attempts')).toHaveLength(0);

    // One check from the pill's panel updates the dialog too (the same query).
    state.ready = true;
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: k.pay.title })).toBeNull());
    await user.click(await screen.findByRole('button', { name: pill(k.terminal.offline) }));
    await user.click(await screen.findByRole('button', { name: k.terminal.recheck }));
    await user.keyboard('{Escape}');
    await screen.findByRole('button', { name: pill(k.terminal.ready) });
  });

  it('the header pill: not reachable, then «Холболт шалгах» finds it ready; no terminal type, no pill', async () => {
    const { terminal, state } = fakeTerminal();
    state.ready = false;
    const edge = fakeEdge(
      storeRoutes({ 'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }) }),
    );
    renderKiosk(edge, {
      device: 'device-1',
      session: 'session-1',
      cashierId: CASHIER.userId,
      terminal,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: pill(k.terminal.offline) }));
    const panel = await screen.findByRole('dialog', { name: k.terminal.title });
    expect(within(panel).getByText(k.terminal.hint)).toBeInTheDocument();
    state.ready = true;
    await user.click(within(panel).getByRole('button', { name: k.terminal.recheck }));
    await within(panel).findByText(
      k.terminal.info
        .replace('{{name}}', INFO.terminalName ?? '')
        .replace('{{port}}', INFO.port ?? '—'),
    );
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('button', { name: pill(k.terminal.ready) })).toBeInTheDocument();
  });

  it('no payment type drives a terminal: no pill and no request to the terminal', async () => {
    const { terminal } = fakeTerminal();
    const edge = fakeEdge(
      storeRoutes({
        'GET /session': () =>
          json({ ...SESSION, paymentTypes: [{ id: 2, name: 'Card', kind: 'CARD' }] }),
      }),
    );
    renderKiosk(edge, {
      device: 'device-1',
      session: 'session-1',
      cashierId: CASHIER.userId,
      terminal,
    });
    await screen.findByLabelText(k.sale.scanLabel);
    expect(screen.queryByRole('button', { name: /Карт уншигч/ })).toBeNull();
    expect(terminal.checkStatus).not.toHaveBeenCalled();
  });

  it('a split payment sends only the card part', async () => {
    const { terminal, sales } = fakeTerminal([APPROVED]);
    const { edge, user, pay, cards } = await openPayment(terminal);
    await waitFor(() => expect(typeButton(pay, 'Khaanbank terminal')).toBeEnabled());
    const cash = within(pay).getByLabelText(amountOf('Бэлэн'));
    await user.clear(cash);
    await user.type(cash, '2000');
    await user.click(typeButton(pay, 'Khaanbank terminal'));
    expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toHaveValue('5000');
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(sales).toEqual([{ refNo: '20261117900001', amount: '5000.00', billType: '1' }]);
    expect(salesOf(edge)[0]?.tenders).toMatchObject([
      { kind: 'CASH', amount: '2000.00', tendered: '2000.00' },
      { kind: 'CARD', amount: '5000.00', cardAttemptId: cards.attempts[0]?.id },
    ]);
  });

  it('charged, but the sale was refused: the next try sends the same charge, never the card again', async () => {
    let tries = 0;
    const { terminal } = fakeTerminal([APPROVED]);
    const { edge, user, pay, cards } = await openPayment(terminal, {
      'POST /sales': (call) => {
        tries += 1;
        return tries === 1
          ? problem('INTERNAL_ERROR', 500)
          : json(printable(receiptOf(call.body as EdgeSaleRequest)));
      },
    });
    await payByCard(user, pay);
    await waitFor(() => expect(salesOf(edge)).toHaveLength(1));
    expect(await within(pay).findByText(/7,000₮ татагдсан/)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).toHaveBeenCalledTimes(1);
    const [first, second] = salesOf(edge);
    expect(second?.clientId).toBe(first?.clientId);
    expect(second?.tenders[0]).toMatchObject({ cardAttemptId: cards.attempts[0]?.id });
  });

  it('a charge left without a sale comes back: used for this sale, or marked as given back', async () => {
    const orphan: EdgeCardAttempt = {
      id: '0c5a8e0e-6c53-4a53-9f36-0d6c2c3f4a11',
      kind: 'SALE',
      status: 'APPROVED',
      refNo: '202611170042',
      saleClientId: '7f0d2e0a-91d5-4b0f-8b62-5b1f3c1d2e33',
      paymentTypeId: 2,
      amount: '7000.00',
      cashierName: CASHIER.fullName,
      createdAt: '2026-11-17T06:10:00.000Z',
      usedAt: null,
      source: 'TERMINAL',
      message: null,
    };
    const { terminal } = fakeTerminal();
    const { edge, user, pay } = await openPayment(terminal, {}, [orphan]);
    expect(await within(pay).findByText(c.unused.title)).toBeInTheDocument();
    expect(within(pay).getByText(/202611170042/)).toBeInTheDocument();
    await user.click(within(pay).getByRole('button', { name: c.unused.use }));
    expect(within(pay).getByLabelText(amountOf('Khaanbank terminal'))).toBeDisabled();
    expect(within(pay).queryByLabelText(amountOf('Бэлэн'))).toBeNull();
    expect(within(pay).queryByText(c.unused.title)).toBeNull();
    // Taken off the sale it is not lost: it is back in the list.
    await user.click(
      within(pay).getByRole('button', {
        name: k.pay.rows.remove.replace('{{name}}', 'Khaanbank terminal'),
      }),
    );
    expect(await within(pay).findByText(c.unused.title)).toBeInTheDocument();
    expect(within(pay).queryByLabelText(amountOf('Khaanbank terminal'))).toBeNull();
    await user.click(within(pay).getByRole('button', { name: c.unused.use }));
    await user.click(within(pay).getByRole('button', { name: k.pay.print }));
    await user.click(within(pay).getByRole('button', { name: k.pay.receiptChoice.B2C }));
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.sale).not.toHaveBeenCalled();
    expect(salesOf(edge)[0]?.tenders[0]).toMatchObject({
      kind: 'CARD',
      amount: '7000.00',
      cardAttemptId: orphan.id,
    });
  });

  it('marks a charge given back on the terminal, so it pays nothing', async () => {
    const orphan: EdgeCardAttempt = {
      id: '0c5a8e0e-6c53-4a53-9f36-0d6c2c3f4a12',
      kind: 'SALE',
      status: 'APPROVED',
      refNo: '202611170043',
      saleClientId: null,
      paymentTypeId: 2,
      amount: '3500.00',
      cashierName: CASHIER.fullName,
      createdAt: '2026-11-17T06:10:00.000Z',
      usedAt: null,
      source: 'TERMINAL',
      message: null,
    };
    const { terminal } = fakeTerminal();
    const { edge, user, pay, cards } = await openPayment(terminal, {}, [orphan]);
    await user.click(await within(pay).findByRole('button', { name: c.unused.void }));
    await waitFor(() => expect(within(pay).queryByText(c.unused.title)).toBeNull());
    expect(edge.callsTo(`POST /card-attempts/${orphan.id}/void`)).toHaveLength(1);
    expect(cards.attempts).toMatchObject([{ status: 'VOIDED' }]);
  });

  it('a card type without a terminal is paid as before, with no terminal asked', async () => {
    const { terminal } = fakeTerminal();
    const { edge, user } = await openPayment(terminal, {
      'GET /session': () =>
        json({
          ...SESSION,
          paymentTypes: TYPES.map((type) => ({ id: type.id, name: type.name, kind: type.kind })),
        }),
    });
    await user.keyboard('2');
    await user.keyboard('{Enter}');
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: k.receipt.title });
    expect(terminal.checkStatus).not.toHaveBeenCalled();
    expect(terminal.sale).not.toHaveBeenCalled();
    expect(salesOf(edge)[0]?.tenders).toEqual([
      { kind: 'CARD', paymentTypeId: 2, amount: '7000.00', terminalId: null, rrn: null },
    ]);
  });
});

describe('kiosk: «Картын гүйлгээ», the till’s own list (ADR-0208)', () => {
  it('lists the day’s charges with what the terminal named and asks the terminal about one', async () => {
    const paid: EdgeCardAttempt = {
      id: '0c5a8e0e-6c53-4a53-9f36-0d6c2c3f4a21',
      kind: 'SALE',
      status: 'APPROVED',
      refNo: '20261117900007',
      saleClientId: '7f0d2e0a-91d5-4b0f-8b62-5b1f3c1d2e41',
      paymentTypeId: 2,
      amount: '12500.00',
      cashierName: CASHIER.fullName,
      createdAt: '2026-11-17T03:55:00.000Z',
      usedAt: '2026-11-17T03:55:20.000Z',
      source: 'TERMINAL',
      message: null,
      saleNumber: 'К1-261117-0031',
      details: {
        maskedPan: '438054XXXXXX5538',
        rrn: '008209672971',
        traceNo: '183607',
        batchNo: '000000001529',
        entryMode: 'Qr',
        appName: 'PASS',
      },
    };
    const declined: EdgeCardAttempt = {
      ...paid,
      id: '0c5a8e0e-6c53-4a53-9f36-0d6c2c3f4a22',
      status: 'DECLINED',
      refNo: '20261117900008',
      amount: '3000.00',
      usedAt: null,
      saleNumber: null,
      details: null,
      message: 'Үлдэгдэл хүрэлцэхгүй',
    };
    const { terminal, asked } = fakeTerminal([], [() => NOT_FOUND]);
    const cards = cardRoutes([paid, declined]);
    const edge = fakeEdge(
      storeRoutes({
        'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }),
        ...cards.routes,
      }),
    );
    renderKiosk(edge, {
      device: 'device-1',
      session: 'session-1',
      cashierId: CASHIER.userId,
      terminal,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: k.menu.label }));
    await user.click(await screen.findByRole('menuitem', { name: k.menu.cards }));
    const dialog = await screen.findByRole('dialog', { name: k.cards.title });
    const rows = await within(dialog).findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    // Newest first.
    expect(rows[0]).toHaveTextContent('3,000₮');
    expect(rows[0]).toHaveTextContent(k.cards.statuses.DECLINED);
    expect(rows[0]).toHaveTextContent('Үлдэгдэл хүрэлцэхгүй');
    expect(rows[1]).toHaveTextContent('12,500₮');
    expect(rows[1]).toHaveTextContent(k.cards.statuses.APPROVED);
    expect(rows[1]).toHaveTextContent('К1-261117-0031');
    expect(rows[1]).toHaveTextContent('438054XXXXXX5538');
    expect(rows[1]).toHaveTextContent('RRN 008209672971');
    expect(rows[1]).toHaveTextContent('20261117900007');

    await user.click(
      within(dialog).getByRole('button', {
        name: k.cards.lookupOf.replace('{{refNo}}', '20261117900008'),
      }),
    );
    expect(await within(dialog).findByText(k.cards.none)).toBeInTheDocument();
    expect(asked).toEqual(['20261117900008']);
    expect(terminal.sale).not.toHaveBeenCalled();
  });
});

describe('kiosk: the terminal’s end-of-day settlement (ADR-0208)', () => {
  it('is asked by the cashier from the day summary, confirmed, and kept on the edge', async () => {
    const done: TerminalOutcome = {
      outcome: 'APPROVED',
      response: { status: true, response: { response_code: true } },
    };
    const { terminal, settlements } = fakeTerminal([done]);
    const cards = cardRoutes();
    const edge = fakeEdge(
      storeRoutes({
        'GET /session': () => json({ ...SESSION, paymentTypes: TYPES }),
        ...cards.routes,
      }),
    );
    renderKiosk(edge, {
      device: 'device-1',
      session: 'session-1',
      cashierId: CASHIER.userId,
      terminal,
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: k.menu.label }));
    await user.click(await screen.findByRole('menuitem', { name: k.menu.daySummary }));
    const dialog = await screen.findByRole('dialog', { name: k.daySummary.title });
    await user.click(
      await within(dialog).findByRole('button', { name: k.daySummary.settlement.run }),
    );
    // Nothing is sent before the cashier confirms.
    expect(terminal.settlement).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', {
      name: k.daySummary.settlement.confirmTitle,
    });
    await user.click(within(confirm).getByRole('button', { name: k.daySummary.settlement.run }));
    expect(await within(dialog).findByText(k.daySummary.settlement.done)).toBeInTheDocument();
    expect(settlements).toEqual(['20261117900001']);
    expect(cards.attempts).toMatchObject([{ kind: 'SETTLEMENT', status: 'APPROVED' }]);
    expect(resultsOf(edge)).toEqual([
      { outcome: 'APPROVED', source: 'TERMINAL', response: done.response, message: null },
    ]);
  });
});
