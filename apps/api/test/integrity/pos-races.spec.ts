import type { NestExpressApplication } from '@nestjs/platform-express';
import { StockQueryService } from '../../src/modules/inventory';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { expectReconciled } from '../harness/inventory';
import {
  type OutcomeJson,
  posActors,
  posStore,
  saleDoc,
  saleEvent,
  shiftCloseEvent,
  shiftOpenEvent,
  type TillJson,
} from '../harness/pos';

/**
 * Races of the accept path (ADR-0063 #3, #5): one document twice at once is one sale; two tills
 * selling the last units at once leave the shelf at zero, never below, with one shortfall for the
 * difference; a close racing a late sale ends consistent either way.
 */
describe('pos races', () => {
  let app: NestExpressApplication;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let till2: TillJson;
  let shift2ClientId: string;

  const results = async (promise: ReturnType<typeof store.pos.sync>): Promise<OutcomeJson[]> => {
    const res = await promise;
    if (res.status !== 200) throw new Error(`sync ${res.status}: ${JSON.stringify(res.body)}`);
    return (res.body as { results: OutcomeJson[] }).results;
  };
  const onHand = async (product: ProductJson): Promise<string> => {
    const content = await app.get(StockQueryService).ofBin(store.salesfloor.id);
    return content.lines.find((line) => line.product.id === product.id)?.onHand.toFixed() ?? '0';
  };
  const dayCode = () => store.today.replace(/-/g, '').slice(2);

  beforeAll(async () => {
    app = await createHttpApp();
    const actors = await posActors(app);
    store = await posStore(app, actors.admin, 'PR');
    cola = await store.product('9401', 'Кола', '1000', '3');
    till2 = (
      await store.pos
        .createTill({ edgeNodeId: store.node.id, code: 'К2', name: 'Касс 2', printerHost: null })
        .expect(201)
    ).body as TillJson;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('applies one document once when it is replayed twice at the same moment', async () => {
    const { clientId } = await store.openShift('0', 1);
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId: clientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [a, b] = await Promise.all([
      results(store.pos.sync(store.edgeToken, [saleEvent(doc)])),
      results(store.pos.sync(store.edgeToken, [saleEvent(doc)])),
    ]);
    expect([a[0]?.status, b[0]?.status].sort()).toEqual(['APPLIED', 'DUPLICATE']);
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(await onHand(cola)).toBe('2');
    expect((await store.pos.sales({ kind: 'SALE' })).total).toBe(1);
    const [closed] = await results(
      store.pos.sync(store.edgeToken, [
        shiftCloseEvent({ shiftClientId: clientId, countedCash: '1300', floatKept: '0' }),
      ]),
    );
    expect(closed?.status).toBe('APPLIED');
  });

  it('never takes the shelf below zero when two tills sell the last units at once', async () => {
    const open1 = shiftOpenEvent({
      tillCode: store.till.code,
      cashierUserId: store.cashierId,
      number: store.shiftNumber(2),
      openingFloat: '0',
    });
    const open2 = shiftOpenEvent({
      tillCode: till2.code,
      cashierUserId: store.cashierId,
      number: `К2-${dayCode()}-Э1`,
      openingFloat: '0',
    });
    shift2ClientId = open2.clientId;
    const opened = await results(store.pos.sync(store.edgeToken, [open1, open2]));
    expect(opened.map((outcome) => outcome.status)).toEqual(['APPLIED', 'APPLIED']);
    const sale1 = saleDoc(
      [{ product: cola, qty: '2' }],
      {
        tillCode: store.till.code,
        shiftClientId: open1.clientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const sale2 = saleDoc(
      [{ product: cola, qty: '2' }],
      {
        tillCode: till2.code,
        shiftClientId: open2.clientId,
        cashierUserId: store.cashierId,
        number: `К2-${dayCode()}-0001`,
      },
      store.retailPrice,
    );
    const [r1, r2] = await Promise.all([
      results(store.pos.sync(store.edgeToken, [saleEvent(sale1)])),
      results(store.pos.sync(store.edgeToken, [saleEvent(sale2)])),
    ]);
    expect([r1[0]?.status, r2[0]?.status]).toEqual(['APPLIED', 'APPLIED']);
    expect(await onHand(cola)).toBe('0');
    // Four sold, two on the shelf: exactly two were adjusted in, by whichever sale came second.
    const shortfalls = (await store.pos.shortfalls({ productId: cola.id })).data;
    expect(shortfalls.map((row) => row.qtyBase)).toEqual(['2']);
    const [closed] = await results(
      store.pos.sync(store.edgeToken, [
        shiftCloseEvent({ shiftClientId: open1.clientId, countedCash: '2600', floatKept: '0' }),
      ]),
    );
    expect(closed?.status).toBe('APPLIED');
  });

  it('ends consistent when a close races a late sale', async () => {
    const late = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: till2.code,
        shiftClientId: shift2ClientId,
        cashierUserId: store.cashierId,
        number: `К2-${dayCode()}-0002`,
      },
      store.retailPrice,
    );
    const [closeResult, saleResult] = await Promise.all([
      results(
        store.pos.sync(store.edgeToken, [
          shiftCloseEvent({ shiftClientId: shift2ClientId, countedCash: '2600', floatKept: '0' }),
        ]),
      ),
      results(store.pos.sync(store.edgeToken, [saleEvent(late)])),
    ]);
    expect(closeResult[0]?.status).toBe('APPLIED');
    const shift = await store.pos.shift(closeResult[0]?.id ?? 0);
    expect(shift.status).toBe('CLOSED');
    if (saleResult[0]?.status === 'APPLIED') {
      // The sale got in before the close: the close counted it (2 + 1 pieces of cola).
      expect(shift.salesCount).toBe(2);
      expect(shift.cashSales).toBe('3900.00');
    } else {
      expect(saleResult[0]).toMatchObject({ status: 'REJECTED', code: 'POS_SHIFT_STATE_INVALID' });
      expect(shift.salesCount).toBe(1);
      expect(shift.cashSales).toBe('2600.00');
    }
  });
});
