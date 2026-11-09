import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { posSaleNumber, posShiftNumber } from '@tugeel/shared/pos';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import type request from 'supertest';
import { AppError } from '../../src/common/errors/app-error';
import type { AuthContext } from '../../src/modules/identity';
import {
  AdjustmentsService,
  BinMovesService,
  type TransferDetail,
  TransfersService,
} from '../../src/modules/inventory';
import { type OrderInput, SalesOrdersService } from '../../src/modules/sales';
import { connectAs, createHttpApp, waitFor } from '../harness/apps';
import { idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import {
  type OutcomeJson,
  posActors,
  posStore,
  saleDoc,
  saleEvent,
  shiftOpenEvent,
  type TillJson,
} from '../harness/pos';

/**
 * Every stock writer at once on the same products (ADR-0173 §5, architecture §5.3): till sales
 * replayed through the shortfall path, a transfer shipped from the wholesale shelf and another
 * received onto the store's SALESFLOOR, a goods receipt, a wholesale order reserved, another picked
 * and a third sold, and a bin move onto the SALESFLOOR, round after round with the products in
 * varying order. Nothing deadlocks (40P01) or fails without a business code, every till sale is
 * accepted, and the ledger, the caches and the reservations reconcile afterwards. The interleaving
 * that used to deadlock (a till sale locking the shelf's bin rows before the warehouse rows) is
 * also forced with a held lock, since free-running rounds meet it only by chance.
 */
const ROUNDS = 6;

/** What went wrong with one operation, or null when it applied or was refused with a code. */
type Failure = string | null;

/** A rejected service call: a business refusal (an AppError) is fine, anything else is not. */
const failureOf = (label: string, reason: unknown): Failure => {
  if (reason instanceof AppError) return null;
  const error = reason as { code?: string; cause?: { code?: string }; message?: string };
  const state = error.cause?.code ?? error.code;
  // The SQLSTATE (40P01 for a deadlock) is the useful part; the failed query's text is not.
  return `${label}: ${state ? `SQLSTATE ${state}` : (error.message ?? String(reason))}`;
};

/** An HTTP call: 2xx, or a 4xx problem with a code; a 5xx (a deadlock surfaces as 500) is not. */
const httpFailureOf = (label: string, res: request.Response): Failure => {
  if (res.status < 300) return null;
  const body = res.body as { code?: string };
  if (res.status < 500 && typeof body.code === 'string') return null;
  return `${label}: HTTP ${res.status} ${JSON.stringify(res.body)}`;
};

describe('integrity: mixed stock races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let store: Awaited<ReturnType<typeof posStore>>;
  let transfers: TransfersService;
  let adjustments: AdjustmentsService;
  let moves: BinMovesService;
  let orders: SalesOrdersService;
  let admin: AuthContext;
  let worker: AuthContext;
  let clerk: AuthContext;
  let workerToken: string;
  let wh: number;
  let shelf: number;
  let backroom: number;
  let saleStageId: number;
  let supplierId: number;
  let till2: TillJson;
  let inventory: ReturnType<typeof inventoryApi>;
  let pipelineId = 0;
  const shifts: { tillCode: string; clientId: string }[] = [];
  const customers: number[] = [];
  let products: ProductJson[] = [];
  let saleSeq = 0;

  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  /** The products rotated by the round, so every writer meets them in a different order. */
  const rotated = (round: number, reverse = false) => {
    const list = products.map((_, index) => products[(index + round) % products.length]);
    const defined = list.filter((product): product is ProductJson => product !== undefined);
    return reverse ? defined.reverse() : defined;
  };
  const orderInput = (customerId: number, round: number): OrderInput => ({
    customerId,
    pipelineId,
    fulfilment: 'PICKUP',
    deliveryDate: addDays(businessDate(), 1),
    addressId: null,
    contactName: null,
    contactPhone: null,
    paymentMethod: 'CASH',
    note: null,
    lines: rotated(round).map((product) => ({ productUnitId: pcs(product), qty: new Decimal(2) })),
  });
  /** Surplus stock at 700 a piece, posted by an approved adjustment. */
  const stock = async (warehouseId: number, binId: number, product: ProductJson, qty: string) => {
    const draft = await adjustments.create(admin, {
      warehouseId,
      reason: 'SURPLUS',
      lines: [{ productUnitId: pcs(product), enteredQty: new Decimal(qty), binId }],
    });
    await adjustments.submit(admin, draft.id);
    const lineId = draft.lines[0]?.id ?? 0;
    await adjustments.approve(admin, draft.id, [{ lineId, unitCost: new Decimal(700) }]);
  };
  /** A REQUESTED transfer of two pieces of each product from the wholesale warehouse to the store. */
  const requested = async (round: number, list = rotated(round)): Promise<TransferDetail> => {
    const draft = await transfers.create(clerk, {
      origin: 'REQUEST',
      sourceWarehouseId: wh,
      destWarehouseId: store.store.id,
      lines: list.map((product) => ({
        productUnitId: pcs(product),
        qty: new Decimal(2),
      })),
    });
    return transfers.request(clerk, draft.id);
  };
  /** A transfer shipped and counted by the store: its confirmation is the receipt onto SALESFLOOR. */
  const counted = async (round: number, list = rotated(round)): Promise<number> => {
    const sent = await requested(round, list);
    await transfers.ship(worker, sent.id);
    const shipped = await transfers.get(sent.id);
    await transfers.saveCounts(
      clerk,
      sent.id,
      shipped.lines.map((line) => ({
        lineId: line.id,
        productUnitId: line.baseUnitId,
        qty: line.shippedQtyBase ?? new Decimal(0),
      })),
    );
    await transfers.finishCount(clerk, sent.id);
    return sent.id;
  };
  /** A draft receipt of one piece of each product with its delivery note typed. */
  const draftReceipt = async (round: number): Promise<number> => {
    const created = await store.pos
      .http()
      .post('/api/v1/receipts')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({
        supplierId,
        lines: rotated(round).map((product) => ({ productUnitId: pcs(product), enteredQty: '1' })),
      })
      .expect(201);
    const id = (created.body as { id: number }).id;
    await store.pos
      .http()
      .patch(`/api/v1/receipts/${id}`)
      .set(bearer(workerToken))
      .send({ noteTotalQty: String(products.length), noteTotalAmount: '0' })
      .expect(200);
    return id;
  };
  /** A till sale of two pieces of each product, its lines in the given order. */
  const tillSale = (index: number, lineOrder: ProductJson[]) => {
    const shift = shifts[index];
    if (!shift) throw new Error(`no shift ${index}`);
    saleSeq += 1;
    return saleDoc(
      lineOrder.map((product) => ({ product, qty: '2' })),
      {
        tillCode: shift.tillCode,
        shiftClientId: shift.clientId,
        cashierUserId: store.cashierId,
        number: posSaleNumber(shift.tillCode, store.today, saleSeq),
      },
      store.retailPrice,
    );
  };
  const salesfloorOnHand = async () =>
    (
      await sql.query<{ product_id: string; on_hand: string }>(
        `SELECT product_id::text, sum(on_hand)::text AS on_hand FROM bin_stock
          WHERE bin_id = $1 GROUP BY product_id ORDER BY product_id`,
        [store.salesfloor.id],
      )
    ).rows;

  beforeAll(async () => {
    // Nine writers race in the last test, each in its own transaction: with the harness's pool of
    // 4 most of them would queue for a connection instead of for the rows. Each test file's setup
    // sets the variable again.
    process.env.DB_POOL_MAX = '10';
    app = await createHttpApp();
    sql = await connectAs('app');
    transfers = app.get(TransfersService);
    adjustments = app.get(AdjustmentsService);
    moves = app.get(BinMovesService);
    orders = app.get(SalesOrdersService);
    const actors = await posActors(app);
    store = await posStore(app, actors.admin, 'MX');
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    const adminToken = (await login(app, adminUser)).accessToken;
    admin = staffContext(adminUser.id, 'ADMIN');
    const workerUser = await seedUser(app, { roles: ['WAREHOUSE'] });
    workerToken = (await login(app, workerUser)).accessToken;
    worker = staffContext(workerUser.id, 'WAREHOUSE');
    clerk = staffContext((await seedUser(app, { roles: ['POS_CASHIER'] })).id, 'POS_CASHIER', [
      store.store.id,
    ]);
    inventory = inventoryApi(app, adminToken);
    wh = (await inventory.warehouse('MXW')).id;
    shelf = (await inventory.bin(wh, 'A-01-01')).id;
    backroom = (await inventory.bin(store.store.id, 'S-01-01')).id;
    // Three shared products: a few pieces on the shelf (the tills soon sell past them), plenty in
    // the store's back room and on the wholesale shelf, which is their home and fixed shelf.
    products = [
      await store.product('9501', 'Кола', '1000', '3'),
      await store.product('9502', 'Пиво', '2000', '3'),
      await store.product('9503', 'Шүүс', '1500', '3'),
    ];
    for (const product of products) {
      await inventory.homeShelf(product.id, wh, shelf);
      await stock(wh, shelf, product, '1000');
      await stock(store.store.id, backroom, product, '1000');
    }
    supplierId = (await partnersApi(app, adminToken).supplier({ name: 'Холимог нийлүүлэгч' })).id;
    for (const name of ['Нэг', 'Хоёр', 'Гурав']) {
      customers.push((await partnersApi(app, adminToken).customer({ name: `Холимог ${name}` })).id);
    }
    // A sales pipeline whose SALE stage issues a packed order's stock from STAGING.
    const http = store.pos.http;
    const board = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(adminToken))
          .send({ name: 'Холимог' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const stage = (name: string, action: string) => ({
      name,
      action,
      printPickList: false,
      printDeliveryNote: false,
      roles: { VIEW: [], EDIT: [], MOVE: [] },
    });
    const pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(adminToken))
        .send({
          boardId: board,
          name: 'Холимог борлуулалт',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          kind: 'SALES',
          roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
          stages: [
            stage('Ирсэн', 'NONE'),
            stage('Нөөцлөх', 'CONFIRM'),
            stage('Бэлдэх', 'PICK'),
            stage('Борлуулалт', 'SALE'),
          ],
        })
        .expect(201)
    ).body as { id: number; stages: { id: number; name: string }[] };
    saleStageId = pipeline.stages.find((entry) => entry.name === 'Борлуулалт')?.id ?? 0;
    pipelineId = pipeline.id;
    // Two tills of the store, each with an open shift.
    till2 = (
      await store.pos
        .createTill({
          edgeNodeId: store.node.id,
          warehouseId: store.store.id,
          code: 'К2',
          name: 'Касс 2',
          printerHost: null,
        })
        .expect(201)
    ).body as TillJson;
    const open1 = shiftOpenEvent({
      tillCode: store.till.code,
      cashierUserId: store.cashierId,
      number: store.shiftNumber(1),
      openingFloat: '0',
    });
    const open2 = shiftOpenEvent({
      tillCode: till2.code,
      cashierUserId: store.cashierId,
      number: posShiftNumber(till2.code, store.today, 1),
      openingFloat: '0',
    });
    const opened = await store.replay([open1, open2]);
    expect(opened.map((outcome) => outcome.status)).toEqual(['APPLIED', 'APPLIED']);
    shifts.push(
      { tillCode: store.till.code, clientId: open1.clientId },
      { tillCode: till2.code, clientId: open2.clientId },
    );
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  /** An order in the pipeline, as a draft; `submit` reserves it. */
  const draftOrder = (round: number, customer: number) =>
    orders.create(admin, orderInput(customers[customer] ?? 0, round));
  /** Picks every line of a confirmed order in full from the wholesale shelf. */
  const pickAll = (order: { id: number; lines: { id: number; qtyApproved: Decimal }[] }) =>
    orders.pick(
      admin,
      order.id,
      order.lines.map((line) => ({ lineId: line.id, qty: line.qtyApproved, binId: shelf })),
    );

  /** Sessions of this database waiting for a row lock. */
  const lockWaiters = async () =>
    Number.parseInt(
      (
        await sql.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'`,
        )
      ).rows[0]?.n ?? '0',
      10,
    );
  const untilWaiting = (count: number) =>
    waitFor(async () => ((await lockWaiters()) >= count ? true : undefined), 5_000, 10);

  /**
   * The interleaving that deadlocked (ADR-0173 §5), forced: a third session holds the shelf's bin
   * rows, a till sale queues for them, then `writer` posts onto the same SALESFLOOR; the hold ends.
   * Locking bin rows before the warehouse rows, the sale got the shelf and waited for the warehouse
   * rows `writer` held while `writer` waited for the shelf. Now the sale holds the warehouse rows
   * before it queues, `writer` waits behind it, and both apply.
   */
  const meetOnHeldShelf = async (round: number, writer: () => Promise<unknown>) => {
    const blocker = await connectAs('app');
    try {
      await blocker.query('BEGIN');
      await blocker.query(
        `SELECT 1 FROM bin_stock WHERE bin_id = $1 AND product_id = ANY($2) FOR UPDATE`,
        [store.salesfloor.id, products.map((product) => product.id)],
      );
      const sale = store.pos
        .sync(store.edgeToken, [saleEvent(tillSale(round % 2, rotated(round)))])
        .then((res) => res);
      await untilWaiting(1);
      const written = writer().then(
        () => null,
        (reason: unknown) => failureOf('writer', reason) ?? `writer: ${(reason as AppError).code}`,
      );
      await untilWaiting(2);
      await blocker.query('COMMIT');
      const res = await sale;
      const outcome = (res.body as { results?: OutcomeJson[] }).results?.[0]?.status;
      return { sale: res.status === 200 ? outcome : `HTTP ${res.status}`, writer: await written };
    } finally {
      await blocker.end();
    }
  };

  it('lets a till sale and a bin move onto the same held shelf both apply', async () => {
    const results = [];
    for (let round = 0; round < 3; round += 1) {
      results.push(
        await meetOnHeldShelf(round, () =>
          moves.create(admin, {
            warehouseId: store.store.id,
            lines: rotated(round, true).map((product) => ({
              productUnitId: pcs(product),
              enteredQty: new Decimal(1),
              fromBinId: backroom,
              toBinId: store.salesfloor.id,
            })),
          }),
        ),
      );
    }
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ sale: 'APPLIED', writer: null })));
  });

  it('lets a till sale and a transfer received onto the same held shelf both apply', async () => {
    const results = [];
    for (let round = 0; round < 3; round += 1) {
      const id = await counted(round);
      results.push(await meetOnHeldShelf(round, () => transfers.confirm(worker, id)));
    }
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ sale: 'APPLIED', writer: null })));
  });

  it('lets a till sale and a transfer both bringing a product new to the store both apply', async () => {
    // A product the store has never held has no balance rows there: both the sale's shortfall and
    // the transfer insert them. The sale used to lock the shared product's rows and only then insert
    // the new product's rows, while the transfer had inserted those first and waited for the shared
    // product: a deadlock. The sale now inserts the missing rows before it locks anything.
    const results = [];
    for (let round = 0; round < 3; round += 1) {
      const fresh = await store.product(`95${10 + round}`, `Шинэ ${round}`, '1200', '0');
      await inventory.homeShelf(fresh.id, wh, shelf);
      await stock(wh, shelf, fresh, '100');
      const list = [...rotated(round), fresh];
      const id = await counted(round, list);
      const blocker = await connectAs('app');
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          `SELECT 1 FROM bin_stock WHERE bin_id = $1 AND product_id = ANY($2) FOR UPDATE`,
          [store.salesfloor.id, products.map((product) => product.id)],
        );
        const sale = store.pos
          .sync(store.edgeToken, [saleEvent(tillSale(round % 2, list))])
          .then((res) => res);
        await untilWaiting(1);
        const written = transfers.confirm(worker, id).then(
          () => null,
          (reason: unknown) =>
            failureOf('writer', reason) ?? `writer: ${(reason as AppError).code}`,
        );
        await untilWaiting(2);
        await blocker.query('COMMIT');
        const res = await sale;
        const outcome = (res.body as { results?: OutcomeJson[] }).results?.[0]?.status;
        results.push({
          sale: res.status === 200 ? outcome : `HTTP ${res.status}`,
          writer: await written,
        });
      } finally {
        await blocker.end();
      }
    }
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ sale: 'APPLIED', writer: null })));
    await expectReconciled(app);
  });

  it('runs every stock writer on the same products at once without a deadlock', async () => {
    const failures: string[] = [];
    const refusals: string[] = [];
    const tillOutcomes: string[] = [];
    for (let round = 0; round < ROUNDS; round += 1) {
      // Prepared one by one: each racing call below finds its document in the state it needs.
      const toShip = await requested(round);
      const toReceive = await counted(round + 1);
      const toReserve = await draftOrder(round, 0);
      const toPick = await orders.submit(admin, (await draftOrder(round + 1, 1)).id);
      const toSell = await pickAll(await orders.submit(admin, (await draftOrder(round + 2, 2)).id));
      const receiptId = await draftReceipt(round);
      const sale1 = tillSale(0, rotated(round));
      const sale2 = tillSale(1, rotated(round, true));

      // The pairs that used to meet first: till sales and postings onto the same SALESFLOOR.
      const [pos1, received, moved, pos2, shipped, reserved, picked, sold, receipt] =
        await Promise.allSettled([
          store.pos.sync(store.edgeToken, [saleEvent(sale1)]),
          transfers.confirm(worker, toReceive),
          moves.create(admin, {
            warehouseId: store.store.id,
            lines: rotated(round, true).map((product) => ({
              productUnitId: pcs(product),
              enteredQty: new Decimal(1),
              fromBinId: backroom,
              toBinId: store.salesfloor.id,
            })),
          }),
          store.pos.sync(store.edgeToken, [saleEvent(sale2)]),
          transfers.ship(worker, toShip.id),
          orders.submit(admin, toReserve.id),
          pickAll(toPick),
          orders.move(admin, toSell.id, { stageId: saleStageId }),
          store.pos
            .http()
            .post(`/api/v1/receipts/${receiptId}/post`)
            .set(bearer(workerToken))
            .set(idempotency()),
        ]);

      for (const [label, result] of [
        ['pos sale 1', pos1],
        ['pos sale 2', pos2],
        ['goods receipt', receipt],
      ] as const) {
        if (result.status === 'rejected') {
          failures.push(failureOf(label, result.reason) ?? `${label}: rejected`);
          continue;
        }
        const failure = httpFailureOf(label, result.value);
        if (failure) failures.push(failure);
        else if (result.value.status >= 300) {
          refusals.push(`${label}: ${(result.value.body as { code: string }).code}`);
        }
        if (label !== 'goods receipt' && result.value.status === 200) {
          const outcome = (result.value.body as { results: OutcomeJson[] }).results[0];
          tillOutcomes.push(outcome?.status ?? 'NONE');
        }
      }
      for (const [label, result] of [
        ['transfer receive', received],
        ['bin move', moved],
        ['transfer ship', shipped],
        ['order reserve', reserved],
        ['order pick', picked],
        ['order sale', sold],
      ] as const) {
        if (result.status === 'fulfilled') continue;
        const failure = failureOf(label, result.reason);
        if (failure) failures.push(failure);
        else refusals.push(`${label}: ${(result.reason as AppError).code}`);
      }
    }
    // A deadlock or any error without a business code would be listed here.
    expect(failures).toEqual([]);
    // Stock is ample everywhere and the shortfall rule fills the shelf: nothing has a reason to be
    // refused, and every till sale is accepted whatever it races.
    expect(refusals).toEqual([]);
    expect(tillOutcomes).toEqual(Array.from({ length: ROUNDS * 2 }, () => 'APPLIED'));
    // The shelf never went below zero: sales beyond it were adjusted in first.
    for (const row of await salesfloorOnHand()) {
      expect(new Decimal(row.on_hand).gte(0)).toBe(true);
    }
    await expectReconciled(app);
  });
});
