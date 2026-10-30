import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { posSaleNumber, posShiftNumber } from '@tugeel/shared/pos';
import { StockQueryService } from '../../src/modules/inventory';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { seedUser } from '../harness/identity';
import {
  type OutcomeJson,
  posActors,
  posApi,
  posStore,
  saleDoc,
  saleEvent,
  shiftOpenEvent,
} from '../harness/pos';

/**
 * The accept path of the centre (ADR-0063 #4, #5): a replayed sale posts POS_SALE from SALESFLOOR,
 * a shelf that lacks the goods is filled by an automatic POS_SHORTFALL adjustment first, a repeated
 * document is a duplicate, arithmetic and tax differences are refused and logged, a return takes
 * goods back at the sold price. Synthetic data only.
 */
describe('pos accept', () => {
  let app: NestExpressApplication;
  let actors: Awaited<ReturnType<typeof posActors>>;
  let store: Awaited<ReturnType<typeof posStore>>;
  let cola: ProductJson;
  let bread: ProductJson;
  let shiftClientId: string;

  const onHand = async (product: ProductJson): Promise<string> => {
    const content = await app.get(StockQueryService).ofBin(store.salesfloor.id);
    return content.lines.find((line) => line.product.id === product.id)?.onHand.toFixed() ?? '0';
  };

  beforeAll(async () => {
    app = await createHttpApp();
    actors = await posActors(app);
    store = await posStore(app, actors.admin, 'PA');
    cola = await store.product('9101', 'Кола', '1000', '10');
    bread = await store.product('9102', 'Талх', '2000', '2');
    shiftClientId = (await store.openShift('50000')).clientId;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('accepts a sale, posts it from SALESFLOOR and answers DUPLICATE on a repeat', async () => {
    const doc = saleDoc(
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
    const [first] = await store.replay([saleEvent(doc)]);
    expect(first).toMatchObject({ status: 'APPLIED', number: doc.number });
    const sale = await store.pos.sale(first?.id ?? 0);
    expect(sale).toMatchObject({
      kind: 'SALE',
      tillCode: 'К1',
      total: '2600.00',
      vatTotal: '236.36',
      cashAmount: '2600.00',
      cardAmount: '0.00',
      ebarimtStatus: 'NONE',
      lineCount: 1,
      shortfallCount: 0,
    });
    expect(sale.lines?.[0]).toMatchObject({
      qty: '2',
      qtyBase: '2',
      unitPrice: '1300.00',
      total: '2600.00',
      vatAmount: '236.36',
      returnedBase: '0',
    });
    expect(sale.tenders).toEqual([
      expect.objectContaining({ kind: 'CASH', amount: '2600.00', tendered: '5000.00' }),
    ]);
    expect(await onHand(cola)).toBe('8');
    // The movement history names the till's number.
    const movements = (
      await store.pos
        .http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'POS', productId: cola.id })
        .set(store.pos.auth)
        .expect(200)
    ).body as { data: { movementType: string; qtyBase: string; docNumber: string | null }[] };
    expect(movements.data[0]).toMatchObject({
      movementType: 'POS_SALE',
      qtyBase: '-2',
      docNumber: doc.number,
    });
    // The same document again: nothing posts twice.
    const [again] = await store.replay([saleEvent(doc)]);
    expect(again).toMatchObject({ status: 'DUPLICATE', id: first?.id, number: doc.number });
    expect(await onHand(cola)).toBe('8');
    expect((await store.pos.sales({ shiftId: sale.shiftId })).total).toBe(1);
  });

  it('fills what the shelf lacks with a POS_SHORTFALL adjustment and lists it', async () => {
    const doc = saleDoc(
      [{ product: bread, qty: '5' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [outcome] = await store.replay([saleEvent(doc)]);
    expect(outcome?.status).toBe('APPLIED');
    const sale = await store.pos.sale(outcome?.id ?? 0);
    expect(sale.shortfallCount).toBe(1);
    expect(sale.shortfalls?.[0]).toMatchObject({ productId: bread.id, qtyBase: '3' });
    expect(sale.shortfalls?.[0]?.adjustmentNumber).toMatch(/^ADJ-/);
    expect(await onHand(bread)).toBe('0');
    const movements = (
      await store.pos
        .http()
        .get('/api/v1/stock/movements')
        .query({ productId: bread.id })
        .set(store.pos.auth)
        .expect(200)
    ).body as { data: { movementType: string; qtyBase: string; docType: string }[] };
    // Newest first: the sale, then the adjustment that made room for it, then the stock.
    expect(
      movements.data.slice(0, 2).map((row) => [row.docType, row.movementType, row.qtyBase]),
    ).toEqual([
      ['POS', 'POS_SALE', '-5'],
      ['ADJ', 'ADJUSTMENT', '3'],
    ]);
    const open = await store.pos.shortfalls({ resolved: false });
    const row = open.data.find((entry) => entry.saleId === sale.id);
    expect(row).toMatchObject({ productId: bread.id, qtyBase: '3', resolvedAt: null });
    // The storekeeper checks it.
    const resolved = await posApi(app, actors.warehouse)
      .resolveShortfall(row?.id as number, 'Тавиур дээр байсан')
      .expect(200);
    expect(resolved.body).toMatchObject({ note: 'Тавиур дээр байсан' });
    expect((await store.pos.shortfalls({ resolved: false })).data).toHaveLength(0);
    expect((await store.pos.attention()).openShortfalls).toBe(0);
  });

  it('refuses arithmetic, tax and unknown-till documents for good and logs them', async () => {
    const wrongVat = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    (wrongVat.lines as { vatAmount: string }[])[0]!.vatAmount = '100.00';
    (wrongVat as { vatTotal: string }).vatTotal = '100.00';
    const wrongRate = saleDoc(
      [{ product: cola, qty: '1', vatRatePct: '0' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const noTill = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: 'К9',
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const outcomes = await store.replay([
      saleEvent(wrongVat),
      saleEvent(wrongRate),
      saleEvent(noTill),
    ]);
    expect(outcomes.map((outcome) => [outcome.status, outcome.code])).toEqual([
      ['REJECTED', 'POS_TOTALS_MISMATCH'],
      ['REJECTED', 'POS_TAX_MISMATCH'],
      ['REJECTED', 'POS_TILL_INACTIVE'],
    ]);
    expect(outcomes[0]?.params).toMatchObject({ field: 'vatAmount', lineNo: 1 });
    const rejections = await store.pos.rejections({ replayed: false });
    expect(rejections.data.map((row) => row.code)).toEqual(
      expect.arrayContaining(['POS_TOTALS_MISMATCH', 'POS_TAX_MISMATCH', 'POS_TILL_INACTIVE']),
    );
    expect(await onHand(cola)).toBe('8');
  });

  it('replays a refused document once its cause is fixed', async () => {
    const newcomer = await seedUser(app, { roles: ['POS_CASHIER'] });
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: newcomer.id,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [refused] = await store.replay([saleEvent(doc)]);
    expect(refused).toMatchObject({ status: 'REJECTED', code: 'POS_CASHIER_INACTIVE' });
    const rejection = (await store.pos.rejections({ replayed: false })).data.find(
      (row) => row.clientId === doc.clientId,
    );
    expect(rejection).toBeDefined();
    // Still refused while nothing changed.
    const stillRefused = (await store.pos.replay(rejection?.id as number).expect(200))
      .body as OutcomeJson;
    expect(stillRefused.status).toBe('REJECTED');
    // The admin gives the newcomer a PIN; the replay goes through and the rejection is closed.
    await store.pos.setPin(newcomer.id, '111222').expect(200);
    const applied = (await store.pos.replay(rejection?.id as number).expect(200))
      .body as OutcomeJson;
    expect(applied).toMatchObject({ status: 'APPLIED', number: doc.number });
    expect(await onHand(cola)).toBe('7');
    expect(
      (await store.pos.rejections({ replayed: true })).data.some(
        (row) => row.clientId === doc.clientId,
      ),
    ).toBe(true);
    await store.pos.replay(rejection?.id as number).expect(409);
  });

  it('takes goods back at the sold price, within the window, with a supervisor', async () => {
    const sold = saleDoc(
      [
        { product: cola, qty: '3' },
        { product: bread, qty: '1' },
      ],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [soldOutcome] = await store.replay([saleEvent(sold)]);
    expect(soldOutcome?.status).toBe('APPLIED');
    const returnOf = (
      lines: Parameters<typeof saleDoc>[0],
      extra: Partial<Parameters<typeof saleDoc>[1]> = {},
    ) =>
      saleDoc(
        lines,
        {
          kind: 'RETURN',
          tillCode: store.till.code,
          shiftClientId,
          cashierUserId: store.cashierId,
          approvedByUserId: store.supervisorId,
          number: store.nextNumber(),
          refundsSaleClientId: sold.clientId as string,
          ...extra,
        },
        store.retailPrice,
      );
    // No supervisor: refused.
    const unapproved = returnOf([{ product: cola, qty: '1', refundsLineNo: 1 }], {
      approvedByUserId: null,
    });
    // Too much: refused. Another price: refused.
    const tooMany = returnOf([{ product: cola, qty: '4', refundsLineNo: 1 }]);
    const wrongPrice = returnOf([{ product: cola, qty: '1', refundsLineNo: 1, unitPrice: '1000' }]);
    const good = returnOf([
      { product: cola, qty: '1', refundsLineNo: 1 },
      { product: bread, qty: '1', refundsLineNo: 2, damaged: true },
    ]);
    const outcomes = await store.replay([
      saleEvent(unapproved),
      saleEvent(tooMany),
      saleEvent(wrongPrice),
      saleEvent(good),
    ]);
    expect(outcomes.map((outcome) => [outcome.status, outcome.code])).toEqual([
      ['REJECTED', 'VALIDATION_FAILED'],
      ['REJECTED', 'POS_RETURN_EXCEEDS'],
      ['REJECTED', 'POS_TOTALS_MISMATCH'],
      ['APPLIED', null],
    ]);
    const original = await store.pos.sale(soldOutcome?.id ?? 0);
    expect(original.lines?.map((line) => line.returnedBase)).toEqual(['1', '1']);
    expect(original.returns).toEqual([
      expect.objectContaining({ number: good.number, total: '3900.00' }),
    ]);
    const returned = await store.pos.sale(outcomes[3]?.id ?? 0);
    expect(returned).toMatchObject({ kind: 'RETURN', total: '3900.00', cashAmount: '3900.00' });
    // The cola went back onto the shelf, the damaged bread to DAMAGED.
    expect(await onHand(cola)).toBe('5');
    const movements = (
      await store.pos
        .http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'POS', warehouseId: store.store.id })
        .set(store.pos.auth)
        .expect(200)
    ).body as { data: { movementType: string; binCode: string; product: { id: number } }[] };
    const returnMoves = movements.data.filter((row) => row.movementType === 'RETURN_IN');
    expect(returnMoves.map((row) => row.product.id).sort()).toEqual([cola.id, bread.id].sort());
    expect(returnMoves.find((row) => row.product.id === bread.id)?.binCode).toBe(
      (await inventoryBinCode('DAMAGED')) ?? '',
    );
    // A return outside the window is refused.
    const late = returnOf([{ product: cola, qty: '1', refundsLineNo: 1 }], {
      soldAt: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    });
    const [lateOutcome] = await store.replay([saleEvent(late)]);
    expect(lateOutcome).toMatchObject({ status: 'REJECTED', code: 'POS_RETURN_WINDOW' });
  });

  it('answers 401 to a wrong edge token and to a staff token', async () => {
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    await store.pos
      .sync(`tgs_${store.node.id}_${randomUUID()}${randomUUID()}`, [saleEvent(doc)])
      .expect(401);
    await store.pos.sync(actors.admin, [saleEvent(doc)]).expect(401);
  });

  async function inventoryBinCode(type: string): Promise<string | undefined> {
    const bins = (
      await store.pos
        .http()
        .get('/api/v1/bins')
        .query({ warehouseId: store.store.id, type })
        .set(store.pos.auth)
        .expect(200)
    ).body as { data: { code: string; isSystem: boolean }[] };
    return bins.data.find((bin) => bin.isSystem)?.code;
  }
  it('sells from the till’s own STORE warehouse, not the edge’s (ADR-0123)', async () => {
    const branchId = (store.store as { branchId: number | null }).branchId;
    const http = store.pos.http;
    const auth = store.pos.auth;
    const floor2 = (
      await http()
        .post('/api/v1/warehouses')
        .set(auth)
        .send({ code: 'PA2S', name: 'Хоёрдугаар заал', kind: 'STORE', branchId })
        .expect(201)
    ).body as { id: number };
    const depot = (
      await http()
        .post('/api/v1/warehouses')
        .set(auth)
        .send({ code: 'PA2W', name: 'Бөөний агуулах PA2', kind: 'WHOLESALE', branchId })
        .expect(201)
    ).body as { id: number };
    // Only a STORE warehouse of the edge's branch.
    await store.pos
      .createTill({ edgeNodeId: store.node.id, code: 'К2', name: 'Касс 2', warehouseId: depot.id })
      .expect(422);
    const till2 = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          code: 'К2',
          name: 'Касс 2',
          warehouseId: floor2.id,
        })
        .expect(201)
    ).body as { id: number; warehouseId: number; warehouseName: string | null };
    expect(till2).toMatchObject({ warehouseId: floor2.id, warehouseName: 'Хоёрдугаар заал' });
    // A till without a warehouse takes its edge's.
    const till3 = (
      await store.pos
        .createTill({ edgeNodeId: store.node.id, code: 'К3', name: 'Касс 3' })
        .expect(201)
    ).body as { warehouseId: number };
    expect(till3.warehouseId).toBe(store.store.id);

    const floorBefore = await onHand(cola);
    const open = shiftOpenEvent({
      tillCode: 'К2',
      cashierUserId: store.cashierId,
      number: posShiftNumber('К2', store.today, 1),
      openingFloat: '50000',
    });
    const [opened] = await store.replay([open]);
    expect(opened).toMatchObject({ status: 'APPLIED' });
    const doc = saleDoc(
      [{ product: cola, qty: '1' }],
      {
        tillCode: 'К2',
        shiftClientId: open.clientId,
        cashierUserId: store.cashierId,
        number: posSaleNumber('К2', store.today, 1),
        tenders: [{ kind: 'CASH', amount: '1300.00', tendered: '1300' }],
      },
      store.retailPrice,
    );
    const [sold] = await store.replay([saleEvent(doc)]);
    expect(sold).toMatchObject({ status: 'APPLIED', number: doc.number });
    // The first floor's shelf did not move; the second floor's, empty, was filled by a shortfall.
    expect(await onHand(cola)).toBe(floorBefore);
    const sale = await store.pos.sale(sold?.id ?? 0);
    expect(sale).toMatchObject({ tillCode: 'К2', shortfallCount: 1 });
    const shortfalls = await store.pos.shortfalls();
    expect(
      shortfalls.data.some((row) => row.productId === cola.id && row.warehouseId === floor2.id),
    ).toBe(true);
    const floor2Salesfloor = await inventoryApi(app, actors.admin).systemBin(
      floor2.id,
      'SALESFLOOR',
    );
    const floor2Bin = await app.get(StockQueryService).ofBin(floor2Salesfloor.id);
    expect(
      floor2Bin.lines.find((line) => line.product.id === cola.id)?.onHand.toFixed() ?? '0',
    ).toBe('0');
  });
});
