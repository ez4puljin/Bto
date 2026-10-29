import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate, businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi } from '../harness/imports';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface IssueLineJson {
  id: number;
  binCode: string;
  qtyBase: string;
  unitCost?: string | null;
  amount?: string | null;
}
interface IssueJson {
  id: number;
  number: string | null;
  status: string;
  recipientKind: string;
  recipientName: string | null;
  expenseTypeName: string;
  lines: IssueLineJson[];
  total?: string | null;
}
interface TypeJson {
  id: number;
  name: string;
  code: string | null;
  active: boolean;
}

/**
 * Goods issues (ADR-0081): warehouse staff create and post them themselves; lines leave the fixed
 * shelf when it holds the product, else the fullest shelf, at the average cost; a recipient of
 * each kind; expense types kept by the admin; an issues import of drafts. Synthetic data only.
 */
describe('goods issues', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let accountant: string;
  let wh: WarehouseJson;
  let shelfA: number;
  let shelfB: number;
  let cola: ProductJson;
  let supplierId: number;
  let customerId: number;
  let types: TypeJson[];
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/issues').set(bearer(token)).set(idempotency()).send(body);
  const post = (token: string, id: number) =>
    http().post(`/api/v1/issues/${id}/post`).set(bearer(token)).set(idempotency());
  const onHand = async (binId: number) =>
    (
      await sql.query<{ on_hand: string }>(
        'SELECT on_hand FROM bin_stock WHERE bin_id = $1 AND product_id = $2',
        [binId, cola.id],
      )
    ).rows[0]?.on_hand;
  const typeId = (code: string) => {
    const found = types.find((type) => type.code === code);
    if (!found) throw new Error(`no type ${code}`);
    return found.id;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    accountant = await token('ACCOUNTANT');
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('GI1');
    shelfA = (await inventory.bin(wh.id, 'G-01-01')).id;
    shelfB = (await inventory.bin(wh.id, 'G-01-02')).id;
    const partners = partnersApi(app, admin);
    supplierId = (await partners.supplier({ name: 'Буцаалт ХХК ГИ' })).id;
    customerId = (await partners.customer({ name: 'Хамтрагч ГИ' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа ГИ');
    cola = await catalog.product({
      sku: '8801',
      name: 'Кола ГИ',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '12' }],
    });
    await inventory.setHome(cola.id, wh.id);
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh.id, productId: cola.id, defaultBinId: shelfA })
      .expect(200);
    // 10 pieces on the fixed shelf A and 30 on B, costed at 1,000 a piece: the receipt brings all
    // 40 onto the fixed shelf (ADR-0099 #1), a bin move takes 30 on to B.
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId,
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '40', docAmount: '40000' }],
      })
      .expect(201);
    await postReceipt(app, admin, (receipt.body as { id: number }).id);
    // Priced on the draft, costed by the price check (ADR-0115: posting never costs).
    await costReceiptAsTyped(app, admin, (receipt.body as { id: number }).id);
    await http()
      .post('/api/v1/bin-moves')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        lines: [
          {
            productUnitId: unitOf(cola, 'PCS').id,
            enteredQty: '30',
            fromBinId: shelfA,
            toBinId: shelfB,
          },
        ],
      })
      .expect(201);
    types = (await http().get('/api/v1/issues/expense-types').set(bearer(worker)).expect(200))
      .body as TypeJson[];
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('starts with the seeded expense types, kept by the admin only', async () => {
    expect(types.map((type) => type.code)).toEqual(
      expect.arrayContaining([
        'INTERNAL_USE',
        'BONUS',
        'MARKETING',
        'WRITE_OFF',
        'SUPPLIER_RETURN',
        'TRANSFER_OUT',
      ]),
    );
    await http()
      .post('/api/v1/issues/expense-types')
      .set(bearer(worker))
      .send({ name: 'Хоол ГИ' })
      .expect(403);
    const added = (
      await http()
        .post('/api/v1/issues/expense-types')
        .set(bearer(admin))
        .send({ name: 'Хоол ГИ' })
        .expect(201)
    ).body as TypeJson;
    expect(added).toMatchObject({ name: 'Хоол ГИ', code: null, active: true });
    types.push(added);
  });

  it('posts an issue from the fixed shelf at the average, with costs for cost holders only', async () => {
    const draft = (
      await create(worker, {
        warehouseId: wh.id,
        expenseTypeId: typeId('INTERNAL_USE'),
        recipient: { kind: 'OTHER', name: 'Төв оффис' },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '2' }],
      }).expect(201)
    ).body as IssueJson;
    expect(draft).toMatchObject({ status: 'DRAFT', recipientName: 'Төв оффис' });
    expect(draft.lines[0]?.binCode).toBe('G-01-01');
    const posted = (await post(worker, draft.id).expect(200)).body as IssueJson;
    expect(posted).toMatchObject({ status: 'POSTED', number: `GI-${businessYear()}-000001` });
    expect(JSON.stringify(posted)).not.toMatch(/unitCost|amount|total/);
    expect(await onHand(shelfA)).toBe('8.000');
    const seen = (await http().get(`/api/v1/issues/${draft.id}`).set(bearer(admin)).expect(200))
      .body as IssueJson;
    expect(seen.lines[0]).toMatchObject({ unitCost: '1000', amount: '2000.00' });
    expect(seen.total).toBe('2000.00');
    const history = await http()
      .get('/api/v1/stock/movements')
      .query({ productId: cola.id, docType: 'GI' })
      .set(bearer(admin))
      .expect(200);
    expect(
      (history.body as { data: { docNumber: string; movementType: string }[] }).data[0],
    ).toMatchObject({
      docNumber: posted.number,
      movementType: 'GOODS_ISSUE',
    });
  });

  it('takes the fullest shelf when the fixed one is empty and refuses more than a shelf holds', async () => {
    const drain = (
      await create(worker, {
        warehouseId: wh.id,
        expenseTypeId: typeId('WRITE_OFF'),
        recipient: { kind: 'OTHER', name: 'Хорогдол' },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '8' }],
      }).expect(201)
    ).body as IssueJson;
    await post(worker, drain.id).expect(200);
    const next = (
      await create(worker, {
        warehouseId: wh.id,
        expenseTypeId: typeId('SUPPLIER_RETURN'),
        recipient: { kind: 'SUPPLIER', supplierId },
        lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '3' }],
      }).expect(201)
    ).body as IssueJson;
    expect(next).toMatchObject({ recipientKind: 'SUPPLIER', recipientName: 'Буцаалт ХХК ГИ' });
    expect(next.lines[0]?.binCode).toBe('G-01-02');
    const short = await post(worker, next.id).expect(409);
    expect(short.body).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      params: { binCode: 'G-01-02' },
    });
    // Two boxes fit: change the quantity and post.
    await http()
      .patch(`/api/v1/issue-lines/${next.lines[0]?.id ?? 0}`)
      .set(bearer(worker))
      .send({ enteredQty: '2' })
      .expect(200);
    await post(worker, next.id).expect(200);
    expect(await onHand(shelfB)).toBe('6.000');
  });

  it('names a user or a customer as the recipient and checks every kind', async () => {
    const staff = await seedUser(app, { roles: ['OFFICE'], username: 'ajiltan_gi' });
    const users = (
      await http()
        .get('/api/v1/users/lookup')
        .query({ q: 'ajiltan_gi' })
        .set(bearer(worker))
        .expect(200)
    ).body as { id: number; fullName: string }[];
    expect(users).toEqual([{ id: staff.id, fullName: 'Тест хэрэглэгч' }]);
    const customers = (
      await http()
        .get('/api/v1/customers/lookup')
        .query({ q: 'Хамтрагч' })
        .set(bearer(worker))
        .expect(200)
    ).body as { id: number }[];
    expect(customers.map((row) => row.id)).toContain(customerId);
    const base = {
      warehouseId: wh.id,
      expenseTypeId: typeId('BONUS'),
      lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1', binId: shelfB }],
    };
    const toUser = (
      await create(worker, { ...base, recipient: { kind: 'USER', userId: staff.id } }).expect(201)
    ).body as IssueJson;
    expect(toUser).toMatchObject({ recipientKind: 'USER', recipientName: 'Тест хэрэглэгч' });
    const toCustomer = (
      await create(worker, { ...base, recipient: { kind: 'CUSTOMER', customerId } }).expect(201)
    ).body as IssueJson;
    expect(toCustomer.recipientName).toBe('Хамтрагч ГИ');
    await create(worker, { ...base, recipient: { kind: 'OTHER' } }).expect(422);
    await create(worker, { ...base, recipient: { kind: 'CUSTOMER' } }).expect(422);
    await create(accountant, { ...base, recipient: { kind: 'OTHER', name: 'X' } }).expect(403);
  });

  it('refuses a retired expense type at posting', async () => {
    const extra = types.find((type) => type.name === 'Хоол ГИ');
    if (!extra) throw new Error('no added type');
    const draft = (
      await create(worker, {
        warehouseId: wh.id,
        expenseTypeId: extra.id,
        recipient: { kind: 'OTHER', name: 'Гал тогоо' },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1', binId: shelfB }],
      }).expect(201)
    ).body as IssueJson;
    await http()
      .patch(`/api/v1/issues/expense-types/${extra.id}`)
      .set(bearer(admin))
      .send({ active: false })
      .expect(200);
    const refused = await post(worker, draft.id).expect(409);
    expect(refused.body).toMatchObject({ code: 'EXPENSE_TYPE_INACTIVE' });
    await http().post(`/api/v1/issues/${draft.id}/cancel`).set(bearer(worker)).expect(200);
  });

  it('imports issues from a sheet as drafts and takes them back while untouched', async () => {
    const imports = importsApi(app, admin);
    const job = await imports.check(
      'ISSUES',
      [
        { date: today, expenseType: 'Урамшуулал', recipient: 'Хамтрагч ГИ', sku: '8801', qty: '1' },
        {
          date: today,
          expenseType: 'Урамшуулал',
          recipient: 'Хамтрагч ГИ',
          sku: '8801',
          unit: 'хайрцаг',
          qty: '1',
        },
        {
          date: today,
          expenseType: 'Дотоод хэрэглээ',
          recipient: 'Агуулахын гал тогоо',
          sku: '8801',
          qty: '2',
        },
      ],
      { issueOptions: { warehouseId: wh.id } },
    );
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    const { rows: before } = await sql.query<{ max: string }>(
      'SELECT coalesce(max(id), 0)::text AS max FROM goods_issues',
    );
    expect((await imports.commit(job.id)).status).toBe('COMMITTED');
    const { rows } = await sql.query<{
      recipient_kind: string;
      recipient_name: string;
      lines: string;
    }>(
      `SELECT g.recipient_kind, g.recipient_name, count(l.id)::text AS lines
         FROM goods_issues g JOIN goods_issue_lines l ON l.issue_id = g.id
        WHERE g.status = 'DRAFT' AND g.id > $1
        GROUP BY g.id ORDER BY g.recipient_name`,
      [before[0]?.max ?? '0'],
    );
    expect(rows).toEqual([
      { recipient_kind: 'OTHER', recipient_name: 'Агуулахын гал тогоо', lines: '1' },
      { recipient_kind: 'CUSTOMER', recipient_name: 'Хамтрагч ГИ', lines: '2' },
    ]);
    expect((await imports.revert(job.id)).status).toBe('REVERTED');
    const bad = await imports.check(
      'ISSUES',
      [{ date: today, expenseType: 'Байхгүй төрөл', recipient: 'Х', sku: '0000', qty: '1' }],
      { issueOptions: { warehouseId: wh.id } },
    );
    expect(bad.status).toBe('INVALID');
    const issues = (await imports.rows(bad.id, 'ERRORS')).flatMap((row) =>
      row.errors.map((issue) => `${issue.column}:${issue.code}`),
    );
    expect(issues).toEqual(expect.arrayContaining(['expenseType:NOT_FOUND', 'sku:NOT_FOUND']));
  });
});
