import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  EdgeCardAttempt,
  EdgeLoginResponse,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeQuoteResponse,
  EdgeSession,
  SnapshotPaymentType,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { EDGE_DB, type EdgeDb } from '../../src/edge/db/edge-db';
import { edgeCardAttempts, edgeSales } from '../../src/edge/db/schema';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore } from '../harness/pos';

interface PaymentTypeJson {
  id: number;
  name: string;
  kind: string;
  status: string;
  sort: number;
  terminal: string | null;
}

/** The terminal's answer as the browser hands it over; kept whole, whatever its fields. */
const APPROVED = {
  status: true,
  response: { response_code: '000', response_msg: 'Approved', anything: { the: 'terminal sent' } },
};

/**
 * The bank card terminal at the till (ADR-0208), the edge against a listening centre. The browser
 * on the till PC asks the terminal; what is tested here is the record around it: the admin's card
 * type with a terminal reaches the till; a charge is written before the terminal is asked and no
 * second one starts while it has no answer; a sale on that type is refused without an approved
 * charge of exactly its amount, and a charge pays one sale once; the terminal's whole answer is
 * kept; the cashier settles an unanswered charge from the slip; the settlement is kept the same
 * way; a card type without a terminal is paid as before.
 */
describe('pos card terminal', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let edgeDb: EdgeDb;
  let store: Awaited<ReturnType<typeof posStore>>;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let cola: ProductJson;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let types: SnapshotPaymentType[];
  let khan: SnapshotPaymentType;
  let unit: string;
  const day = businessDate().replaceAll('-', '');

  const centre = () => request(central.getHttpServer());
  const lines = (qty: string) => [{ productUnitId: unitOf(cola, 'PCS').id, qty }];
  const totalOf = (qty: string) => (Number.parseInt(qty, 10) * Number.parseFloat(unit)).toFixed(2);
  const begin = (amount: string, saleClientId = randomUUID(), id = randomUUID()) =>
    kiosk.post('/card-attempts', {
      id,
      saleClientId,
      paymentTypeId: khan.id,
      amount,
      terminalId: '70107480',
    });
  const finish = (id: string, body: object) => kiosk.post(`/card-attempts/${id}/result`, body);
  const sellOn = (clientId: string, qty: string, tender: object) =>
    kiosk.post('/sales', {
      clientId,
      lines: lines(qty),
      receiptType: 'B2C',
      tenders: [{ kind: 'CARD', paymentTypeId: khan.id, amount: totalOf(qty), ...tender }],
    });
  const rowOf = async (id: string) => {
    const [row] = await edgeDb.select().from(edgeCardAttempts).where(eq(edgeCardAttempts.id, id));
    if (!row) throw new Error(`no card attempt ${id}`);
    return row;
  };
  const open = async () =>
    (await kiosk.get('/card-attempts/open').expect(200)).body as EdgeCardAttempt[];

  beforeAll(async () => {
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    store = await posStore(central, actors.admin, 'CT');
    cola = await store.product('9391', 'Кола карт', '1000', '100');
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
    });
    edgeDb = edge.get<EdgeDb>(EDGE_DB);
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
  });
  afterAll(async () => {
    await edge?.close();
    if (central) {
      await expectReconciled(central);
      await central.close();
    }
  });

  it('gives a card type its terminal, only a card type, and carries it to the till', async () => {
    const seeded = (await centre().get('/api/v1/pos/payment-types').set(bearer(actors.admin)))
      .body as PaymentTypeJson[];
    expect(seeded.every((type) => type.terminal === null)).toBe(true);
    const rows = seeded.map(({ id, name, kind, status }) => ({ id, name, kind, status }));
    const put = (body: object[]) =>
      centre().put('/api/v1/pos/payment-types').set(bearer(actors.admin)).send({ types: body });
    await put(rows.map((row) => (row.kind === 'CASH' ? { ...row, terminal: 'KHAN' } : row))).expect(
      422,
    );
    await put(rows.map((row) => ({ ...row, terminal: 'VISA' }))).expect(422);
    const saved = (
      await put([
        ...rows.map((row) => (row.kind === 'CARD' ? { ...row, terminal: 'KHAN' } : row)),
        { id: null, name: 'Golomt terminal', kind: 'CARD', status: 'ACTIVE' },
      ]).expect(200)
    ).body as PaymentTypeJson[];
    expect(saved.map((type) => [type.name, type.terminal])).toEqual([
      ['Бэлэн', null],
      ['Khaanbank terminal', 'KHAN'],
      ['Шилжүүлэг', null],
      ['Зээл', null],
      ['Golomt terminal', null],
    ]);
    // A list saved without the field (an older page) keeps what a type has.
    const again = (
      await put(saved.map(({ id, name, kind, status }) => ({ id, name, kind, status }))).expect(200)
    ).body as PaymentTypeJson[];
    expect(again.find((type) => type.kind === 'CARD')?.terminal).toBe('KHAN');

    expect(await sync.pullOnce()).toBe('changed');
    const code = (await store.pos.pairingCode(store.till.id).expect(200)).body as { code: string };
    const paired = (
      await kiosk.post('/pair', { tillCode: 'К1', pairingCode: code.code }).expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    kiosk.setSession(login.token);
    // No charge is begun on a till without an open shift.
    types = ((await kiosk.get('/session').expect(200)).body as EdgeSession).paymentTypes ?? [];
    const found = types.find((type) => type.terminal === 'KHAN');
    if (!found) throw new Error('the terminal’s type did not reach the till');
    khan = found;
    expect(types.filter((type) => type.terminal)).toEqual([
      { id: khan.id, name: 'Khaanbank terminal', kind: 'CARD', terminal: 'KHAN' },
    ]);
    expect((await begin('1000').expect(409)).body).toMatchObject({
      code: 'POS_SHIFT_STATE_INVALID',
    });
    await kiosk.post('/shifts/open', { openingFloat: '10000' }).expect(200);
    const quote = (await kiosk.post('/quote', { lines: lines('1') }).expect(200))
      .body as EdgeQuoteResponse;
    unit = quote.total;
  });

  it('refuses a sale on the terminal’s type that no charge pays', async () => {
    const refused = await sellOn(randomUUID(), '1', {}).expect(409);
    expect(refused.body).toMatchObject({ code: 'POS_CARD_NOT_CHARGED' });
    const unknown = await sellOn(randomUUID(), '1', { cardAttemptId: randomUUID() }).expect(409);
    expect(unknown.body).toMatchObject({ code: 'POS_CARD_NOT_CHARGED' });
    expect(await edgeDb.select().from(edgeSales)).toHaveLength(0);
  });

  it('writes the charge before the terminal is asked and starts no second one meanwhile', async () => {
    const saleClientId = randomUUID();
    const id = randomUUID();
    const begun = (await begin(totalOf('1'), saleClientId, id).expect(200)).body as EdgeCardAttempt;
    expect(begun).toMatchObject({
      id,
      kind: 'SALE',
      status: 'PENDING',
      saleClientId,
      paymentTypeId: khan.id,
      amount: totalOf('1'),
      usedAt: null,
      source: null,
    });
    // Digits only: the day and a number of this edge.
    expect(begun.refNo).toBe(`${day}0001`);
    // The same request again (a lost reply) is the same charge, not a second one.
    expect(
      ((await begin(totalOf('1'), saleClientId, id).expect(200)).body as EdgeCardAttempt).refNo,
    ).toBe(begun.refNo);
    const blocked = await begin(totalOf('1')).expect(409);
    expect(blocked.body).toMatchObject({
      code: 'POS_CARD_PENDING',
      params: { refNo: begun.refNo, amount: totalOf('1') },
    });
    await kiosk.post('/card-settlements', { id: randomUUID() }).expect(409);
    // A charge without an answer pays nothing.
    await sellOn(saleClientId, '1', { cardAttemptId: id }).expect(409);
    expect(await open()).toMatchObject([{ id, status: 'PENDING' }]);

    // Declined: the terminal's answer is kept as it came, and it still pays nothing.
    const declinedAnswer = { status: true, response: { response_code: '051', response_msg: 'No' } };
    const declined = (
      await finish(id, {
        outcome: 'DECLINED',
        source: 'TERMINAL',
        response: declinedAnswer,
        message: 'No',
      }).expect(200)
    ).body as EdgeCardAttempt;
    expect(declined).toMatchObject({ status: 'DECLINED', source: 'TERMINAL', message: 'No' });
    expect((await rowOf(id)).response).toEqual(declinedAnswer);
    // The same answer again changes nothing; another answer is refused.
    await finish(id, { outcome: 'DECLINED', source: 'TERMINAL', response: declinedAnswer }).expect(
      200,
    );
    const changed = await finish(id, { outcome: 'APPROVED', source: 'CASHIER' }).expect(409);
    expect(changed.body).toMatchObject({
      code: 'POS_CARD_ATTEMPT_STATE',
      params: { status: 'DECLINED' },
    });
    await sellOn(saleClientId, '1', { cardAttemptId: id }).expect(409);
    expect(await open()).toEqual([]);
  });

  it('an approved charge pays one sale of exactly its amount, once, with the terminal’s answer kept', async () => {
    const saleClientId = randomUUID();
    const begun = (await begin(totalOf('2'), saleClientId).expect(200)).body as EdgeCardAttempt;
    expect(begun.refNo).toBe(`${day}0002`);
    await finish(begun.id, { outcome: 'APPROVED', source: 'TERMINAL', response: APPROVED }).expect(
      200,
    );
    expect(await open()).toMatchObject([{ id: begun.id, status: 'APPROVED', usedAt: null }]);
    // Not for another amount.
    const other = await sellOn(randomUUID(), '1', { cardAttemptId: begun.id }).expect(409);
    expect(other.body).toMatchObject({ code: 'POS_CARD_NOT_CHARGED' });
    // Not twice in one sale.
    await kiosk
      .post('/sales', {
        clientId: randomUUID(),
        lines: lines('4'),
        tenders: [
          { kind: 'CARD', paymentTypeId: khan.id, amount: totalOf('2'), cardAttemptId: begun.id },
          { kind: 'CARD', paymentTypeId: khan.id, amount: totalOf('2'), cardAttemptId: begun.id },
        ],
      })
      .expect(422);
    expect((await rowOf(begun.id)).usedAt).toBeNull();

    const sold = (await sellOn(saleClientId, '2', { cardAttemptId: begun.id }).expect(200))
      .body as EdgePrintableReceipt;
    expect(sold.receipt.tenders).toMatchObject([{ kind: 'CARD', amount: totalOf('2') }]);
    const row = await rowOf(begun.id);
    expect(row).toMatchObject({ status: 'APPROVED', source: 'TERMINAL', saleClientId });
    expect(row.usedAt).not.toBeNull();
    expect(row.response).toEqual(APPROVED);
    expect(await open()).toEqual([]);
    // The same sale sent again answers its receipt; another sale cannot use the charge.
    const repeated = (await sellOn(saleClientId, '2', { cardAttemptId: begun.id }).expect(200))
      .body as EdgePrintableReceipt;
    expect(repeated.receipt.number).toBe(sold.receipt.number);
    await sellOn(randomUUID(), '2', { cardAttemptId: begun.id }).expect(409);
    // A used charge is not given back by a tap.
    const used = await kiosk.post(`/card-attempts/${begun.id}/void`).expect(409);
    expect(used.body).toMatchObject({ code: 'POS_CARD_ATTEMPT_STATE', params: { status: 'USED' } });

    // The centre gets the terminal's id on the tender.
    await sync.pushOnce();
    const list = await store.pos.sales({ tillId: store.till.id });
    const centreRow = list.data.find((sale) => sale.number === sold.receipt.number);
    const detail = (await store.pos.sale(centreRow?.id ?? 0)) as unknown as {
      tenders: { kind: string; terminalId: string | null; paymentTypeName: string | null }[];
    };
    expect(detail.tenders).toEqual([
      expect.objectContaining({
        kind: 'CARD',
        terminalId: '70107480',
        paymentTypeName: 'Khaanbank terminal',
      }),
    ]);
  });

  it('lets a charge of another sale pay this one: the money was taken, the cart was lost', async () => {
    const begun = (await begin(totalOf('1')).expect(200)).body as EdgeCardAttempt;
    await finish(begun.id, { outcome: 'APPROVED', source: 'TERMINAL', response: APPROVED }).expect(
      200,
    );
    const saleClientId = randomUUID();
    await sellOn(saleClientId, '1', { cardAttemptId: begun.id }).expect(200);
    expect(await rowOf(begun.id)).toMatchObject({ saleClientId });
    // A charge for a sale already made is not begun.
    const late = await begin(totalOf('1'), saleClientId).expect(409);
    expect(late.body).toMatchObject({ code: 'POS_CARD_ATTEMPT_STATE' });
  });

  it('an unanswered charge is settled by the cashier from the slip; an unused one is given back', async () => {
    const lost = (await begin(totalOf('1')).expect(200)).body as EdgeCardAttempt;
    const failed = (
      await finish(lost.id, { outcome: 'FAILED', source: 'CASHIER', response: null }).expect(200)
    ).body as EdgeCardAttempt;
    expect(failed).toMatchObject({ status: 'FAILED', source: 'CASHIER' });
    expect(await rowOf(lost.id)).toMatchObject({
      resolvedByUserId: store.cashierId,
      response: null,
    });

    const taken = (await begin(totalOf('1')).expect(200)).body as EdgeCardAttempt;
    await finish(taken.id, { outcome: 'APPROVED', source: 'CASHIER' }).expect(200);
    expect(await open()).toMatchObject([{ id: taken.id, status: 'APPROVED', source: 'CASHIER' }]);
    const voided = (await kiosk.post(`/card-attempts/${taken.id}/void`).expect(200))
      .body as EdgeCardAttempt;
    expect(voided.status).toBe('VOIDED');
    await kiosk.post(`/card-attempts/${taken.id}/void`).expect(200);
    await sellOn(randomUUID(), '1', { cardAttemptId: taken.id }).expect(409);
    expect(await open()).toEqual([]);
  });

  it('keeps the terminal’s settlement like a charge', async () => {
    const id = randomUUID();
    const begun = (
      await kiosk.post('/card-settlements', { id, terminalId: '70107480' }).expect(200)
    ).body as EdgeCardAttempt;
    expect(begun).toMatchObject({ kind: 'SETTLEMENT', status: 'PENDING', amount: '0.00' });
    expect(begun.refNo).toMatch(new RegExp(`^${day}\\d{4}$`));
    await begin(totalOf('1')).expect(409);
    const answer = { status: true, response: { response_code: true } };
    await finish(id, { outcome: 'APPROVED', source: 'TERMINAL', response: answer }).expect(200);
    expect(await rowOf(id)).toMatchObject({ kind: 'SETTLEMENT', status: 'APPROVED' });
    expect((await rowOf(id)).response).toEqual(answer);
    // A settlement is no money of a sale: it is not offered to one, nor given back.
    expect(await open()).toEqual([]);
    await kiosk.post(`/card-attempts/${id}/void`).expect(409);
  });

  it('pays a card type without a terminal as before, and takes no charge for another type', async () => {
    const golomt = types.find((type) => type.name === 'Golomt terminal');
    if (!golomt) throw new Error('no second card type');
    await kiosk
      .post('/card-attempts', {
        id: randomUUID(),
        saleClientId: randomUUID(),
        paymentTypeId: golomt.id,
        amount: totalOf('1'),
      })
      .expect(422);
    const sold = (
      await kiosk
        .post('/sales', {
          clientId: randomUUID(),
          lines: lines('1'),
          tenders: [{ kind: 'CARD', paymentTypeId: golomt.id, amount: totalOf('1') }],
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(sold.receipt.tenders).toMatchObject([{ kind: 'CARD', name: 'Golomt terminal' }]);
    await sync.pushOnce();
  });
});
