import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeLoginResponse,
  EdgeMember,
  EdgePairResponse,
  EdgePrintableReceipt,
  EdgeReturnSale,
  EdgeShiftSummary,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { ArLedgerService } from '../../src/modules/finance';
import { SyncRunner } from '../../src/edge/services/sync.runner';
import { createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { createEdgeApp, edgeDatabase, kioskApi } from '../harness/edge';
import { FakePosapi } from '../harness/fake-posapi';
import { financeApi } from '../harness/finance';
import { bearer } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posActors, posStore, saleDoc, saleEvent } from '../harness/pos';

interface MemberJson {
  id: number;
  name: string;
  phone: string;
  status: string;
  balance: string;
  lifetimeSpend: string;
  tier: { name: string; percent: string } | null;
  nextTier: { name: string; left: string } | null;
}

interface EntryJson {
  kind: string;
  points: string;
  spendDelta: string;
  saleNumber: string | null;
  journalNumber: string | null;
}

/**
 * The bonus card (ADR-0112) against a fake PosAPI and a listening centre: a member registered at
 * the office and fed to the edge with the admin's tiers; points earned on the money paid at the
 * tier of the spend before the sale; points spent with the member's PIN (five wrong ones lock the
 * card, a new PIN from the office opens it), never past the balance this edge counts, never with
 * credit; a return giving the points back first and taking the earned ones back by share; the
 * centre's caches, entries and the shift's close on the points liability; an admin's adjustment
 * with its journal entry; a spend past the centre's balance kept and listed for «Шалгасан».
 * Synthetic data only; never a real PosAPI.
 */
describe('pos bonus card', () => {
  let central: NestExpressApplication;
  let edge: NestExpressApplication;
  let posapi: FakePosapi;
  let store: Awaited<ReturnType<typeof posStore>>;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let finance: ReturnType<typeof financeApi>;
  let kiosk: ReturnType<typeof kioskApi>;
  let sync: SyncRunner;
  let cola: ProductJson;
  let partner: CustomerJson;
  let member: MemberJson;
  let spentSale: EdgePrintableReceipt;

  const today = businessDate();
  const lines = (qty: string) => [{ productUnitId: unitOf(cola, 'PCS').id, qty }];
  const api = () => request(central.getHttpServer());
  const sell = (body: Record<string, unknown>) =>
    kiosk.post('/sales', { clientId: randomUUID(), ...body });
  const cash = (amount: string, tendered = amount) => ({ kind: 'CASH', amount, tendered });
  const centreMember = async (): Promise<MemberJson> =>
    (
      await api()
        .get(`/api/v1/pos/loyalty-members/${member.id}`)
        .set(bearer(actors.office))
        .expect(200)
    ).body as MemberJson;
  const entries = async (): Promise<EntryJson[]> =>
    (
      (
        await api()
          .get(`/api/v1/pos/loyalty-members/${member.id}/entries?limit=200`)
          .set(bearer(actors.office))
          .expect(200)
      ).body as { data: EntryJson[] }
    ).data;
  const atTill = async (): Promise<EdgeMember> =>
    (await kiosk.get('/members?phone=99112233').expect(200)).body as EdgeMember;

  beforeAll(async () => {
    posapi = new FakePosapi();
    await posapi.start();
    central = await createHttpApp();
    await central.listen(0, '127.0.0.1');
    const port = (central.getHttpServer().address() as AddressInfo).port;
    actors = await posActors(central);
    finance = financeApi(central, actors.admin);
    store = await posStore(central, actors.admin, 'PL');
    await store.pos
      .setSettings({ ebarimtDistrictCode: '1234', ebarimtClassificationCode: '1234567' })
      .expect(200);
    cola = await store.product('9551', 'Кола бонус', '1000', '100');
    partner = await partnersApi(central, actors.admin).customer({ name: 'Зээлийн харилцагч PL' });
    edge = await createEdgeApp({
      databaseUrl: await edgeDatabase(),
      centralUrl: `http://127.0.0.1:${port}`,
      nodeToken: store.edgeToken,
      ebarimt: { posapiUrl: posapi.url, lookupUrl: posapi.url, timeoutMs: 1_500 },
    });
    kiosk = kioskApi(edge);
    sync = edge.get(SyncRunner);
    const code = (await store.pos.pairingCode(store.till.id).expect(200)).body as { code: string };
    expect(await sync.pullOnce()).toBe('changed');
    const paired = (
      await kiosk.post('/pair', { tillCode: 'К1', pairingCode: code.code }).expect(200)
    ).body as EdgePairResponse;
    kiosk.setDevice(paired.deviceToken);
    const login = (
      await kiosk.post('/auth/pin', { userId: store.cashierId, pin: '123456' }).expect(200)
    ).body as EdgeLoginResponse;
    kiosk.setSession(login.token);
    await kiosk.post('/shifts/open', { openingFloat: '10000' }).expect(200);
  });
  afterAll(async () => {
    await edge?.close();
    await posapi?.stop();
    if (central) {
      await expectReconciled(central);
      const run = await central.get(ArLedgerService).reconcile('MANUAL');
      expect(run.status).toBe('OK');
      await central.close();
    }
  });

  it('registers a member at the office and sets the tiers', async () => {
    member = (
      await api()
        .post('/api/v1/pos/loyalty-members')
        .set(bearer(actors.office))
        .set(idempotency())
        .send({ name: 'Батбаяр PL', phone: '9911 2233', pin: '1234', gender: 'MALE' })
        .expect(201)
    ).body as MemberJson;
    expect(member).toMatchObject({ phone: '+97699112233', status: 'ACTIVE', balance: '0.00' });
    // One member per phone; a PIN is four digits; the warehouse may not register.
    const taken = await api()
      .post('/api/v1/pos/loyalty-members')
      .set(bearer(actors.office))
      .set(idempotency())
      .send({ name: 'Давхар', phone: '+97699112233', pin: '4321' })
      .expect(409);
    expect(taken.body).toMatchObject({ code: 'POS_MEMBER_PHONE_TAKEN' });
    await api()
      .post('/api/v1/pos/loyalty-members')
      .set(bearer(actors.office))
      .set(idempotency())
      .send({ name: 'Богино', phone: '88112233', pin: '12' })
      .expect(422);
    await api()
      .post('/api/v1/pos/loyalty-members')
      .set(bearer(actors.warehouse))
      .set(idempotency())
      .send({ name: 'Агуулах', phone: '88112244', pin: '1234' })
      .expect(403);
    // Only the admin sets the tiers (pos.manage); small thresholds for the test.
    await api()
      .put('/api/v1/pos/loyalty-tiers')
      .set(bearer(actors.office))
      .send({ tiers: [] })
      .expect(403);
    const tiers = await api()
      .put('/api/v1/pos/loyalty-tiers')
      .set(bearer(actors.admin))
      .send({
        tiers: [
          { id: null, name: 'Мөнгөн', fromAmount: '20000', percent: '2' },
          { id: null, name: 'Энгийн', fromAmount: '0', percent: '1' },
        ],
      })
      .expect(200);
    expect((tiers.body as { name: string }[]).map((tier) => tier.name)).toEqual([
      'Энгийн',
      'Мөнгөн',
    ]);
    expect(await sync.pullLoyaltyOnce()).toBe('changed');
    expect(await sync.pullLoyaltyOnce()).toBe('unchanged');
    const found = await atTill();
    expect(found).toMatchObject({
      id: member.id,
      name: 'Батбаяр PL',
      phone: '99••••33',
      balance: '0.00',
      tier: { name: 'Энгийн', percent: '1.00' },
      nextTier: { name: 'Мөнгөн', left: '20000.00' },
    });
    const unknown = await kiosk.get('/members?phone=88000000').expect(404);
    expect(unknown.body).toMatchObject({ code: 'POS_MEMBER_NOT_FOUND' });
  });

  it('earns on the money paid at the tier reached before the sale', async () => {
    // 10 × 1 300 = 13 000, 15 000 handed over: 1 % of 13 000, never of the change.
    const first = (
      await sell({
        lines: lines('10'),
        tenders: [cash('13000', '15000')],
        member: { id: member.id },
      }).expect(200)
    ).body as EdgePrintableReceipt;
    expect(first.receipt.loyalty).toMatchObject({
      memberName: 'Батбаяр PL',
      tierName: 'Энгийн',
      earned: '130.00',
      spent: '0.00',
      balance: '130.00',
    });
    expect((await atTill()).balance).toBe('130.00');
  });

  it('spends points with the member’s PIN, never past the balance, never with credit', async () => {
    const pay = (pin: string | null, points: string, rest: string) =>
      sell({
        lines: lines('7'),
        tenders: [{ kind: 'POINTS', amount: points }, cash(rest)],
        member: { id: member.id, pin },
      });
    const wrong = await pay('9999', '100', '9000').expect(401);
    expect(wrong.body).toMatchObject({
      code: 'POS_MEMBER_PIN_INVALID',
      params: { attemptsLeft: 4 },
    });
    const short = await pay('1234', '500', '8600').expect(409);
    expect(short.body).toMatchObject({
      code: 'POS_POINTS_INSUFFICIENT',
      params: { available: '130' },
    });
    // 7 × 1 300 = 9 100: 100 points and 9 000 in cash, which earns 1 % = 90.
    spentSale = (await pay('1234', '100', '9000').expect(200)).body as EdgePrintableReceipt;
    expect(spentSale.receipt.tenders).toEqual([
      { kind: 'POINTS', name: null, amount: '100.00', tendered: null },
      expect.objectContaining({ kind: 'CASH', amount: '9000.00' }),
    ]);
    expect(spentSale.receipt.loyalty).toMatchObject({ earned: '90.00', spent: '100.00' });
    expect(spentSale.receipt.loyalty?.balance).toBe('120.00');
    // The e-Barimt keeps the full price; the points go as cash until the accountant says.
    const posted = posapi.receiptPosts().at(-1) as {
      totalAmount: number;
      payments: { code: string; paidAmount: number }[];
    };
    expect(posted.totalAmount).toBe(9100);
    expect(posted.payments).toEqual([{ code: 'CASH', status: 'PAID', paidAmount: 9100 }]);
    // No bonus card with credit.
    const credit = await sell({
      lines: lines('1'),
      tenders: [{ kind: 'CREDIT', amount: '1300' }],
      customerId: partner.id,
      member: { id: member.id },
    }).expect(422);
    expect(credit.body).toMatchObject({ code: 'POS_POINTS_WITH_CREDIT' });
    // Points without a member are refused.
    await sell({ lines: lines('1'), tenders: [{ kind: 'POINTS', amount: '1300' }] }).expect(422);
    // Not replayed yet, the edge counts its own sales: 13 000 + 9 000 spent, 120 left.
    expect(await atTill()).toMatchObject({
      balance: '120.00',
      lifetime: '22000.00',
      tier: { name: 'Мөнгөн', percent: '2.00' },
      nextTier: null,
    });
  });

  it('earns at the higher tier from the next sale', async () => {
    const next = (
      await sell({ lines: lines('1'), tenders: [cash('1300')], member: { id: member.id } }).expect(
        200,
      )
    ).body as EdgePrintableReceipt;
    expect(next.receipt.loyalty).toMatchObject({ tierName: 'Мөнгөн', earned: '26.00' });
    expect(next.receipt.loyalty?.balance).toBe('146.00');
  });

  it('counts the replayed sales at the centre: caches, entries, tier', async () => {
    await sync.pushOnce();
    const counted = await centreMember();
    expect(counted).toMatchObject({
      balance: '146.00',
      lifetimeSpend: '23300.00',
      tier: { name: 'Мөнгөн' },
    });
    const history = await entries();
    expect(history.map((entry) => [entry.kind, entry.points]).reverse()).toEqual([
      ['EARN', '130.00'],
      ['EARN', '90.00'],
      ['SPEND', '-100.00'],
      ['EARN', '26.00'],
    ]);
    const sum = history.reduce((total, entry) => total.plus(entry.points), new Decimal(0));
    expect(sum.toFixed(2)).toBe(counted.balance);
    // The feed now carries the centre's figures, and the edge adds nothing twice.
    expect(await sync.pullLoyaltyOnce()).toBe('changed');
    expect((await atTill()).balance).toBe('146.00');
  });

  it('gives the spent points back first on a return and takes the earned ones by share', async () => {
    const found = (
      await kiosk.get(`/returns/sale?number=${encodeURIComponent(spentSale.receipt.number)}`)
    ).body as EdgeReturnSale;
    expect(found.loyalty).toMatchObject({ memberName: 'Батбаяр PL', spent: '100.00' });
    // 2 × 1 300 = 2 600: 100 points back, 2 500 in cash; 90 × 2 500 / 9 000 = 25 taken back.
    const back = (
      await kiosk
        .post('/returns', {
          clientId: randomUUID(),
          refundsSaleClientId: spentSale.receipt.clientId,
          lines: [{ refundsLineNo: 1, qty: '2', damaged: false }],
          approval: { supervisorUserId: store.supervisorId, pin: '654321' },
        })
        .expect(200)
    ).body as EdgePrintableReceipt;
    expect(back.receipt.tenders).toEqual([
      { kind: 'POINTS', amount: '100.00', tendered: null },
      { kind: 'CASH', amount: '2500.00', tendered: null },
    ]);
    expect(back.receipt.loyalty).toMatchObject({
      givenBack: '100.00',
      clawback: '25.00',
      balance: '221.00',
    });
    await sync.pushOnce();
    expect(await centreMember()).toMatchObject({ balance: '221.00', lifetimeSpend: '20800.00' });
  });

  it('locks the card after five wrong PINs until the office sets a new one', async () => {
    for (let left = 4; left >= 1; left -= 1) {
      const res = await kiosk.post(`/members/${member.id}/pin-check`, { pin: '0000' }).expect(401);
      expect(res.body).toMatchObject({ params: { attemptsLeft: left } });
    }
    const locked = await kiosk.post(`/members/${member.id}/pin-check`, { pin: '0000' }).expect(423);
    expect(locked.body).toMatchObject({ code: 'POS_MEMBER_LOCKED' });
    await kiosk.post(`/members/${member.id}/pin-check`, { pin: '1234' }).expect(423);
    await api()
      .post(`/api/v1/pos/loyalty-members/${member.id}/pin`)
      .set(bearer(actors.office))
      .send({ pin: '5678' })
      .expect(200);
    expect(await sync.pullLoyaltyOnce()).toBe('changed');
    await kiosk.post(`/members/${member.id}/pin-check`, { pin: '1234' }).expect(401);
    await kiosk.post(`/members/${member.id}/pin-check`, { pin: '5678' }).expect(200);
  });

  it('refuses a blocked card at the till', async () => {
    await api()
      .post(`/api/v1/pos/loyalty-members/${member.id}/block`)
      .set(bearer(actors.office))
      .expect(200);
    await sync.pullLoyaltyOnce();
    expect((await atTill()).status).toBe('BLOCKED');
    const res = await sell({
      lines: lines('1'),
      tenders: [cash('1300')],
      member: { id: member.id },
    }).expect(422);
    expect(res.body).toMatchObject({ code: 'POS_MEMBER_BLOCKED' });
    await api()
      .post(`/api/v1/pos/loyalty-members/${member.id}/unblock`)
      .set(bearer(actors.office))
      .expect(200);
    await sync.pullLoyaltyOnce();
  });

  it('adjusts points by hand with a reason and a journal entry', async () => {
    const adjusted = (
      await api()
        .post(`/api/v1/pos/loyalty-members/${member.id}/adjust`)
        .set(bearer(actors.office))
        .set(idempotency())
        .send({ points: '500', reason: 'Төрсөн өдрийн бэлэг' })
        .expect(201)
    ).body as MemberJson;
    expect(adjusted).toMatchObject({ balance: '721.00', lifetimeSpend: '20800.00' });
    const removed = await api()
      .post(`/api/v1/pos/loyalty-members/${member.id}/adjust`)
      .set(bearer(actors.office))
      .set(idempotency())
      .send({ points: '-1000', reason: 'Алдаа' })
      .expect(409);
    expect(removed.body).toMatchObject({ code: 'POS_POINTS_INSUFFICIENT' });
    const [latest] = await entries();
    expect(latest).toMatchObject({ kind: 'ADJUST', points: '500.00' });
    expect(latest?.journalNumber).toBeTruthy();
  });

  it('closes the shift: points spent, given back, earned and taken back on the liability', async () => {
    // Float 10 000 + cash 13 000 + 9 000 + 1 300 − 2 500 paid back.
    const closed = (
      await kiosk
        .post('/shifts/close', { countedCash: '30800', floatKept: '10000', note: null })
        .expect(200)
    ).body as EdgeShiftSummary;
    expect(closed).toMatchObject({
      status: 'CLOSED',
      variance: '0.00',
      pointsSales: '100.00',
      pointsRefunds: '100.00',
    });
    await sync.pushOnce();
    // Earned 130 + 90 + 26, taken back 25: 221 for the shift, 500 by hand.
    const liability = await finance.account('320301');
    expect(new Decimal(liability.credit).minus(liability.debit).toFixed(2)).toBe('721.00');
    const expense = await finance.account('730301');
    expect(new Decimal(expense.debit).minus(expense.credit).toFixed(2)).toBe('721.00');
  });

  it('keeps a sale that spent more than the centre knows, and lists it for «Шалгасан»', async () => {
    const opened = await store.openShift('0', 2);
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId: opened.clientId,
        cashierUserId: store.cashierId,
        number: `${store.till.code}-${today.replace(/-/g, '').slice(2)}-0951`,
      },
      (product) => store.retailPrice(product),
    );
    const [outcome] = await store.replay([
      saleEvent({
        ...doc,
        tenders: [
          {
            kind: 'POINTS',
            amount: doc.total,
            tendered: null,
            terminalId: null,
            rrn: null,
            maskedPan: null,
          },
        ],
        loyalty: {
          memberId: member.id,
          earnBase: '0.00',
          percent: '2.00',
          earned: '0.00',
          spent: doc.total,
          givenBack: '0.00',
          clawback: '0.00',
          spendDelta: '0.00',
        },
      }),
    ]);
    expect(outcome).toMatchObject({ status: 'APPLIED' });
    expect((await centreMember()).balance).toBe('-579.00');
    const attention = (await store.pos.attention()) as unknown as { loyaltyToCheck: number };
    expect(attention.loyaltyToCheck).toBe(1);
    const listed = (
      await api().get('/api/v1/pos/sale-loyalty').set(bearer(actors.admin)).expect(200)
    ).body as { id: number; issue: string }[];
    expect(listed[0]).toMatchObject({ issue: 'OVERDRAWN' });
    await api()
      .post(`/api/v1/pos/sale-loyalty/${listed[0]?.id ?? 0}/review`)
      .set(bearer(actors.admin))
      .send({ note: 'Туршилт' })
      .expect(200);
    expect(
      ((await store.pos.attention()) as unknown as { loyaltyToCheck: number }).loyaltyToCheck,
    ).toBe(0);
    // A document that earns more than its tier gives is refused for good.
    const [wrong] = await store.replay([
      saleEvent({
        ...doc,
        clientId: randomUUID(),
        number: `${store.till.code}-${today.replace(/-/g, '').slice(2)}-0952`,
        loyalty: {
          memberId: member.id,
          earnBase: doc.total,
          percent: '2.00',
          earned: '999.00',
          spent: '0.00',
          givenBack: '0.00',
          clawback: '0.00',
          spendDelta: doc.total,
        },
      }),
    ]);
    expect(wrong).toMatchObject({ status: 'REJECTED' });
    await store.replay([
      {
        kind: 'SHIFT_CLOSED',
        clientId: opened.clientId,
        shiftClosed: {
          clientId: opened.clientId,
          closedAt: new Date().toISOString(),
          countedCash: '0',
          floatKept: '0',
          note: null,
        },
      },
    ]);
  });
});
