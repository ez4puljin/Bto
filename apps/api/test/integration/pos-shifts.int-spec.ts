import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { financeApi, type JournalEntryJson, type PaymentJson } from '../harness/finance';
import { expectReconciled } from '../harness/inventory';
import {
  posActors,
  posApi,
  posStore,
  saleDoc,
  saleEvent,
  type ShiftJson,
  shiftCloseEvent,
  type TillJson,
} from '../harness/pos';

/**
 * Shifts and their money (ADR-0064): the close sums the shift's documents, books one balanced
 * entry on the POS roles and records the variance; the accountant's hand-over is an OTHER_IN
 * voucher against the POS cash account; a closed shift takes no more sales. Synthetic data only.
 */
describe('pos shifts', () => {
  let app: NestExpressApplication;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let bread: ProductJson;
  let shiftClientId: string;
  let shift: ShiftJson;

  beforeAll(async () => {
    app = await createHttpApp();
    actors = await posActors(app);
    store = await posStore(app, actors.admin, 'PS');
    cola = await store.product('9201', 'Кола', '1000', '20');
    bread = await store.product('9202', 'Талх', '2000', '20');
    ({ clientId: shiftClientId, shift } = await store.openShift('50000'));
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('sums the shift live while it is open', async () => {
    const cash = saleDoc(
      [{ product: cola, qty: '2' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
        tenders: [{ kind: 'CASH', amount: '2600.00', tendered: '5000' }],
      },
      store.retailPrice,
    );
    const card = saleDoc(
      [{ product: bread, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
        tenders: [{ kind: 'CARD', amount: '2600.00' }],
      },
      store.retailPrice,
    );
    const outcomes = await store.replay([saleEvent(cash), saleEvent(card)]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['APPLIED', 'APPLIED']);
    const refund = saleDoc(
      [{ product: cola, qty: '1', refundsLineNo: 1 }],
      {
        kind: 'RETURN',
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        approvedByUserId: store.supervisorId,
        number: store.nextNumber(),
        refundsSaleClientId: cash.clientId as string,
        tenders: [{ kind: 'CASH', amount: '1300.00' }],
      },
      store.retailPrice,
    );
    const [refunded] = await store.replay([saleEvent(refund)]);
    expect(refunded?.status).toBe('APPLIED');
    const live = await store.pos.shift(shift.id);
    expect(live).toMatchObject({
      status: 'OPEN',
      salesCount: 2,
      returnsCount: 1,
      cashSales: '2600.00',
      cashRefunds: '1300.00',
      cardSales: '2600.00',
      cardRefunds: '0.00',
      salesTotal: '5200.00',
      returnsTotal: '1300.00',
      salesVat: '472.72',
      returnsVat: '118.18',
      countedCash: null,
      journalNumber: null,
    });
    expect((await store.pos.attention()).openShifts).toBeGreaterThanOrEqual(1);
  });

  it('closes with a count, books one balanced entry and records the variance', async () => {
    const [closed] = await store.replay([
      shiftCloseEvent({
        shiftClientId,
        countedCash: '51000',
        floatKept: '50000',
        note: 'Солио дутуу',
      }),
    ]);
    expect(closed).toMatchObject({ status: 'APPLIED', number: shift.number });
    const detail = await store.pos.shift(shift.id);
    expect(detail).toMatchObject({
      status: 'CLOSED',
      countedCash: '51000.00',
      floatKept: '50000.00',
      expectedCash: '51300.00',
      variance: '-300.00',
      note: 'Солио дутуу',
      salesCount: 2,
      returnsCount: 1,
    });
    expect(detail.journalNumber).toMatch(/^Ж-/);
    const finance = financeApi(app, actors.accountant);
    const entry = await finance.journalGet(detail.journalEntryId ?? 0);
    expect(entry).toMatchObject({
      source: 'AUTO_POS_SHIFT',
      sourceType: 'POS_SHIFT',
      sourceId: shift.id,
    });
    const byCode = Object.fromEntries(
      (entry.lines ?? []).map((line) => [line.accountCode, [line.debit, line.credit]]),
    );
    expect(byCode).toEqual({
      '100102': ['1000.00', '0.00'], // POS cash: counted − float
      '120301': ['2600.00', '0.00'], // card clearing
      '740101': ['300.00', '0.00'], // the drawer is short
      '520101': ['1181.82', '0.00'], // returns net of VAT
      '510102': ['0.00', '4727.28'], // supermarket sales net of VAT
      '311004': ['0.00', '354.54'], // VAT: 472.72 on the sales − 118.18 on the return
    });
    expect(entry.amount).toBe('5081.82');
    // The same close again is a duplicate; a late sale is refused.
    const [again] = await store.replay([
      shiftCloseEvent({ shiftClientId, countedCash: '51000', floatKept: '50000' }),
    ]);
    expect(again?.status).toBe('DUPLICATE');
    const late = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [refused] = await store.replay([saleEvent(late)]);
    expect(refused).toMatchObject({ status: 'REJECTED', code: 'POS_SHIFT_STATE_INVALID' });
    expect(refused?.params).toMatchObject({ status: 'CLOSED' });
  });

  it('hands the cash to the accountant as a voucher on the cash box', async () => {
    const finance = financeApi(app, actors.admin);
    const cashBox = await finance.cashBox('PS-CASH');
    // The office may not; the accountant may.
    await posApi(app, actors.office).handover(shift.id, { moneyAccountId: cashBox.id }).expect(403);
    const handed = (
      await posApi(app, actors.accountant)
        .handover(shift.id, { moneyAccountId: cashBox.id })
        .expect(200)
    ).body as ShiftJson;
    expect(handed.status).toBe('HANDED_OVER');
    expect(handed.handoverNumber).toMatch(/^Т-/);
    const voucher = (await financeApi(app, actors.accountant).paymentGet(
      handed.handoverPaymentId ?? 0,
    )) as PaymentJson & { glAccountCode: string | null; reference: string | null };
    expect(voucher).toMatchObject({
      kind: 'OTHER_IN',
      direction: 'IN',
      moneyAccountId: cashBox.id,
      amount: '1000.00',
      glAccountCode: '100102',
      reference: shift.number,
      collectedByName: 'Тест хэрэглэгч',
    });
    expect((await finance.book(cashBox.id)).data[0]?.balanceAfter).toBe('1000.00');
    // Once only.
    await posApi(app, actors.accountant)
      .handover(shift.id, { moneyAccountId: cashBox.id })
      .expect(409);
    expect((await store.pos.attention()).shiftsToHandOver).toBe(0);
    expect((await store.pos.shifts({ status: 'HANDED_OVER' })).data.map((row) => row.id)).toContain(
      shift.id,
    );
  });

  it('plays a till from the admin: the test till prices at RETAIL and runs the same path', async () => {
    const till2 = (
      await store.pos
        .createTill({ edgeNodeId: store.node.id, code: 'К2', name: 'Касс 2', printerHost: null })
        .expect(201)
    ).body as TillJson;
    const opened = (
      await store.pos
        .devOpenShift({ tillId: till2.id, cashierUserId: store.cashierId, openingFloat: '10000' })
        .expect(201)
    ).body as ShiftJson;
    expect(opened.number).toBe(store.shiftNumber(1).replace('К1', 'К2'));
    const pcs = cola.units.find((unit) => unit.uomCode === 'PCS');
    const sale = (
      await store.pos
        .devSale({
          shiftId: opened.id,
          cashierUserId: store.cashierId,
          lines: [{ productUnitId: pcs?.id, qty: '3' }],
          tenders: [{ kind: 'CASH', amount: '3900', tendered: '5000' }],
        })
        .expect(201)
    ).body as { number: string; total: string; vatTotal: string; lines: { unitPrice: string }[] };
    expect(sale.number).toBe(`К2-${store.today.replace(/-/g, '').slice(2)}-0001`);
    expect(sale).toMatchObject({ total: '3900.00', vatTotal: '354.55' });
    expect(sale.lines[0]?.unitPrice).toBe('1300.00');
    // A wrong tender total is refused before anything posts.
    await store.pos
      .devSale({
        shiftId: opened.id,
        cashierUserId: store.cashierId,
        lines: [{ productUnitId: pcs?.id, qty: '1' }],
        tenders: [{ kind: 'CASH', amount: '1000' }],
      })
      .expect(422);
    const closed = (
      await store.pos
        .devCloseShift(opened.id, { countedCash: '13900', floatKept: '10000' })
        .expect(200)
    ).body as ShiftJson;
    expect(closed).toMatchObject({ status: 'CLOSED', variance: '0.00', salesCount: 1 });
    const entry: JournalEntryJson = await financeApi(app, actors.accountant).journalGet(
      closed.journalEntryId ?? 0,
    );
    const codes = (entry.lines ?? []).map((line) => line.accountCode).sort();
    // No variance line when the count matches.
    expect(codes).toEqual(['100102', '311004', '510102']);
  });
});
