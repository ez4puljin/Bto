import type { NestExpressApplication } from '@nestjs/platform-express';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { expectReconciled } from '../harness/inventory';
import { posActors, posStore, saleDoc, saleEvent } from '../harness/pos';

/**
 * «Кассын борлуулалт»'s banner (owner 2026-11-10): `GET /pos/sales/summary` sums every sale and
 * return the list's filters match, in SQL — the count of sales and of returns, the amount net of
 * returns and each tender kind net of its refunds; the cashier filter narrows it like the list.
 * Synthetic data only.
 */
describe('pos sales summary', () => {
  let app: NestExpressApplication;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;

  beforeAll(async () => {
    app = await createHttpApp();
    const actors = await posActors(app);
    store = await posStore(app, actors.admin, 'PSM');
    cola = await store.product('9301', 'Кола', '1000', '20');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('sums the matching sales and nets the returns per tender', async () => {
    const shiftClientId = (await store.openShift('50000')).clientId;
    const base = { tillCode: store.till.code, shiftClientId, cashierUserId: store.cashierId };
    // 2 × 1300 = 2600: 1000 cash, 1600 card.
    const mixed = saleDoc(
      [{ product: cola, qty: '2' }],
      {
        ...base,
        number: store.nextNumber(),
        tenders: [
          { kind: 'CASH', amount: '1000.00', tendered: '1000' },
          { kind: 'CARD', amount: '1600.00' },
        ],
      },
      store.retailPrice,
    );
    // 3 × 1300 = 3900 in cash; one piece of it comes back for 1300 in cash.
    const cash = saleDoc(
      [{ product: cola, qty: '3' }],
      { ...base, number: store.nextNumber() },
      store.retailPrice,
    );
    const outcomes = await store.replay([saleEvent(mixed), saleEvent(cash)]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['APPLIED', 'APPLIED']);
    const back = saleDoc(
      [{ product: cola, qty: '1', refundsLineNo: 1 }],
      {
        ...base,
        kind: 'RETURN',
        approvedByUserId: store.supervisorId,
        number: store.nextNumber(),
        refundsSaleClientId: cash.clientId as string,
      },
      store.retailPrice,
    );
    const [returned] = await store.replay([saleEvent(back)]);
    expect(returned?.status).toBe('APPLIED');

    const shiftId = (await store.pos.sale(outcomes[0]?.id ?? 0)).shiftId;
    const expected = {
      salesCount: 2,
      returnsCount: 1,
      salesTotal: '6500.00',
      returnsTotal: '1300.00',
      total: '5200.00',
      cash: '3600.00',
      card: '1600.00',
      transfer: '0.00',
      credit: '0.00',
      other: '0.00',
    };
    expect(await store.pos.salesSummary({ shiftId })).toEqual(expected);
    // The cashier filter keeps the same documents; another cashier has none.
    expect(
      await store.pos.salesSummary({ tillId: store.till.id, cashierUserId: store.cashierId }),
    ).toEqual(expected);
    expect(
      await store.pos.salesSummary({ shiftId, cashierUserId: store.supervisorId }),
    ).toMatchObject({ salesCount: 0, returnsCount: 0, total: '0.00', cash: '0.00' });
    // Only the sales: no return subtracts.
    expect(await store.pos.salesSummary({ shiftId, kind: 'SALE' })).toMatchObject({
      salesCount: 2,
      returnsCount: 0,
      total: '6500.00',
      cash: '4900.00',
      card: '1600.00',
    });
    // The list's count agrees with the banner.
    expect((await store.pos.sales({ shiftId, cashierUserId: store.cashierId })).total).toBe(3);
  });
});
