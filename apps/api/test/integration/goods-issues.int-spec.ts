import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate, businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi } from '../harness/finance';
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
import { pricingApi } from '../harness/pricing';

interface IssueLineJson {
  id: number;
  productId: number;
  warehouseId: number;
  binCode: string | null;
  qtyBase: string;
  checkedAt: string | null;
  saleUnitPrice: string | null;
  saleAmount: string | null;
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
  expenseTypeCode: string | null;
  returnNote: string | null;
  correctsIssueId: number | null;
  correctedByIssueId: number | null;
  lines: IssueLineJson[];
  warehouses: {
    warehouseId: number;
    lineCount: number;
    checkedCount: number;
    confirmed: boolean;
  }[];
  confirmations: { warehouseId: number; confirmedBy: string | null; unchanged: boolean }[];
  saleTotal: string | null;
  total?: string | null;
}
interface TypeJson {
  id: number;
  name: string;
  code: string | null;
  active: boolean;
}

/**
 * Goods issues (ADR-0081, ADR-0117): the accountant creates an issue with lines from any
 * warehouse (the product's home) and sends it; each warehouse's keeper ticks and confirms their
 * own lines and that part leaves at once under the one number; a keeper sends it back with a
 * note; the party rides on the books; «Хүнд тооцох» is priced at the sale price and charged to
 * the party; supplier returns credit per part; a correction reverses and re-posts in one step.
 * Synthetic data only.
 */
describe('goods issues', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let keeper1: string;
  let keeper2: string;
  let worker: string;
  let staffId: number;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let shelfA: number;
  let cola: ProductJson;
  let water: ProductJson;
  let supplierId: number;
  let customerId: number;
  let types: TypeJson[];
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/issues').set(bearer(token)).set(idempotency()).send(body);
  const send = (token: string, id: number) =>
    http().post(`/api/v1/issues/${id}/send`).set(bearer(token)).set(idempotency());
  const confirm = (token: string, id: number, key = idempotency()) =>
    http().post(`/api/v1/issues/${id}/confirm`).set(bearer(token)).set(key);
  const check = (token: string, lineId: number, checked = true) =>
    http().patch(`/api/v1/issue-lines/${lineId}/check`).set(bearer(token)).send({ checked });
  const get = async (token: string, id: number) =>
    (await http().get(`/api/v1/issues/${id}`).set(bearer(token)).expect(200)).body as IssueJson;
  /** Ticks every line the token's warehouses hold, then confirms. */
  const tickAndConfirm = async (token: string, id: number, status = 200) => {
    const issue = await get(token, id);
    for (const line of issue.lines) {
      const own = await check(token, line.id);
      if (own.status !== 200 && own.status !== 403) throw new Error(`check ${own.status}`);
    }
    return (await confirm(token, id).expect(status)).body as IssueJson;
  };
  const onHand = async (warehouseId: number, productId: number) =>
    (
      await sql.query<{ on_hand: string }>(
        'SELECT on_hand FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2',
        [warehouseId, productId],
      )
    ).rows[0]?.on_hand;
  const typeId = (code: string) => {
    const found = types.find((type) => type.code === code);
    if (!found) throw new Error(`no type ${code}`);
    return found.id;
  };
  /** The journal lines of Bto documents, account → Dr − Cr, by source type and id pattern. */
  const finLines = async (docType: string, docIdLike: string) =>
    Object.fromEntries(
      (
        await sql.query<{ code: string; amount: string }>(
          `SELECT a.code, (sum(l.debit) - sum(l.credit))::text AS amount
             FROM fin.documents d
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE d.source_doc_type = $1 AND d.source_doc_id LIKE $2
            GROUP BY a.code ORDER BY a.code`,
          [docType, docIdLike],
        )
      ).rows.map((row) => [row.code, row.amount]),
    );
  /** The parties on the lines of an account inside Bto documents: name → kind. */
  const partiesOn = async (docType: string, docIdLike: string, accountCode: string) =>
    (
      await sql.query<{ name: string; kind: string; ref: string | null }>(
        `SELECT DISTINCT p.name, p.kind, r.external_id AS ref
           FROM fin.documents d
           JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
           JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
           JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
           JOIN fin.parties p ON p.id = l.party_id
           LEFT JOIN fin.party_refs r ON r.party_id = p.id
          WHERE d.source_doc_type = $1 AND d.source_doc_id LIKE $2 AND a.code = $3`,
        [docType, docIdLike, accountCode],
      )
    ).rows;
  const partyIdOf = async (ref: string) =>
    (
      await sql.query<{ party_id: string }>(
        `SELECT party_id::text FROM fin.party_refs WHERE external_id = $1`,
        [ref],
      )
    ).rows[0]?.party_id;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string, warehouseIds?: number[]) =>
      (await login(app, await seedUser(app, { roles: [role], warehouseIds }))).accessToken;
    admin = await token('ADMIN');
    accountant = await token('ACCOUNTANT');
    worker = await token('WAREHOUSE');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('GI1');
    wh2 = await inventory.warehouse('GI2');
    keeper1 = await token('WAREHOUSE', [wh1.id]);
    keeper2 = await token('WAREHOUSE', [wh2.id]);
    staffId = (await seedUser(app, { roles: ['OFFICE'], username: 'ajiltan_gi' })).id;
    shelfA = (await inventory.bin(wh1.id, 'G-01-01')).id;
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
    water = await catalog.product({
      sku: '8802',
      name: 'Ус ГИ',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
    // The cola lives in GI1 on its fixed shelf, the water in GI2 (its lines take their homes).
    await inventory.homeShelf(cola.id, wh1.id, shelfA);
    await inventory.setHome(water.id, wh2.id);
    // Stock at a known cost: 40 colas at 1,000 and 20 waters at 500 (priced drafts, the price
    // check costs them, ADR-0115).
    for (const line of [
      { product: cola, qty: '40', amount: '40000' },
      { product: water, qty: '20', amount: '10000' },
    ]) {
      const receipt = await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId,
          lines: [
            {
              productUnitId: unitOf(line.product, 'PCS').id,
              enteredQty: line.qty,
              docAmount: line.amount,
            },
          ],
        })
        .expect(201);
      await postReceipt(app, admin, (receipt.body as { id: number }).id);
      await costReceiptAsTyped(app, admin, (receipt.body as { id: number }).id);
    }
    // The cola sells at 2,000 a piece; the water has no price terms yet.
    const pricing = pricingApi(app, admin);
    await pricing.terms(
      cola.id,
      '2000',
      await pricing.profile('Зарлага ГИ'),
      unitOf(cola, 'BOX').uomId,
    );
    types = (await http().get('/api/v1/issues/expense-types').set(bearer(accountant)).expect(200))
      .body as TypeJson[];
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('starts with the seven seeded expense types, kept by the admin only', async () => {
    expect(types.map((type) => type.code)).toEqual(
      expect.arrayContaining([
        'INTERNAL_USE',
        'BONUS',
        'MARKETING',
        'WRITE_OFF',
        'SUPPLIER_RETURN',
        'TRANSFER_OUT',
        'DAMAGE_CHARGE',
      ]),
    );
    expect(types.find((type) => type.code === 'DAMAGE_CHARGE')?.name).toBe('Хүнд тооцох');
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

  it('lets the accountant send an issue of two warehouses that each keeper confirms on their own', async () => {
    // Lines take their product's home: the cola GI1, the water GI2 (the default is GI1).
    const draft = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('INTERNAL_USE'),
        recipient: { kind: 'USER', userId: staffId },
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '2' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '3' },
        ],
      }).expect(201)
    ).body as IssueJson;
    expect(draft).toMatchObject({ status: 'DRAFT', recipientName: 'Тест хэрэглэгч' });
    expect(draft.lines.map((line) => line.warehouseId)).toEqual([wh1.id, wh2.id]);
    expect(draft.lines[0]?.binCode).toBeNull();
    expect(draft.warehouses.map((row) => row.confirmed)).toEqual([false, false]);
    const [colaLine, waterLine] = draft.lines;
    if (!colaLine || !waterLine) throw new Error('two lines');

    // Nothing to confirm before the send.
    expect((await confirm(keeper1, draft.id).expect(409)).body).toMatchObject({
      code: 'ISSUE_NOT_SENT',
    });
    expect((await send(accountant, draft.id).expect(200)).body).toMatchObject({ status: 'SENT' });

    // The keeper of GI1 ticks only their own line and confirms: that part leaves at once.
    expect((await confirm(keeper1, draft.id).expect(409)).body).toMatchObject({
      code: 'ISSUE_LINES_UNCHECKED',
      params: { warehouseId: wh1.id, count: 1 },
    });
    await check(keeper1, waterLine.id).expect(403);
    await check(keeper1, colaLine.id).expect(200);
    const key = idempotency();
    const first = (await confirm(keeper1, draft.id, key).expect(200)).body as IssueJson;
    expect(first).toMatchObject({ status: 'SENT', number: `GI-${businessYear()}-000001` });
    expect(first.confirmations).toEqual([
      expect.objectContaining({
        warehouseId: wh1.id,
        confirmedBy: 'Тест хэрэглэгч',
        unchanged: false,
      }),
    ]);
    expect(first.lines[0]).toMatchObject({ binCode: 'G-01-01' });
    expect(JSON.stringify(first)).not.toMatch(/unitCost|"amount"|"total"/);
    expect(await onHand(wh1.id, cola.id)).toBe('38.000');
    expect(await onHand(wh2.id, water.id)).toBe('20.000');
    // A retried click replays the same answer.
    expect((await confirm(keeper1, draft.id, key).expect(200)).body).toEqual(first);
    const history = await http()
      .get('/api/v1/stock/movements')
      .query({ productId: cola.id, docType: 'GI' })
      .set(bearer(admin))
      .expect(200);
    expect(
      (history.body as { data: { docNumber: string; movementType: string }[] }).data[0],
    ).toMatchObject({ docNumber: first.number, movementType: 'GOODS_ISSUE' });
    // The part's booking carries the party (ADR-0117 #2): the staff member as EMPLOYEE.
    expect(await finLines('STOCK', `GI:${draft.id}:%`)).toEqual({
      '140101': '-2000.00',
      '730201': '2000.00',
    });
    expect(await partiesOn('STOCK', `GI:${draft.id}:%`, '730201')).toEqual([
      { name: 'Тест хэрэглэгч', kind: 'EMPLOYEE', ref: `user:${staffId}` },
    ]);

    // The keeper of GI2 sends it back with a note; the posted part stays.
    await http()
      .post(`/api/v1/issues/${draft.id}/return`)
      .set(bearer(keeper2))
      .send({ note: 'Ус дутуу байна' })
      .expect(200);
    const returned = await get(accountant, draft.id);
    expect(returned).toMatchObject({ status: 'RETURNED', returnNote: 'Ус дутуу байна' });
    expect(returned.confirmations).toHaveLength(1);
    // The accountant may change the water line, never the confirmed cola line, and resends.
    expect(
      (
        await http()
          .patch(`/api/v1/issue-lines/${colaLine.id}`)
          .set(bearer(accountant))
          .send({ enteredQty: '1' })
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'ISSUE_WAREHOUSE_CONFIRMED' });
    await http()
      .patch(`/api/v1/issue-lines/${waterLine.id}`)
      .set(bearer(accountant))
      .send({ enteredQty: '2' })
      .expect(200);
    await http().post(`/api/v1/issues/${draft.id}/cancel`).set(bearer(accountant)).expect(409);
    const resent = (await send(accountant, draft.id).expect(200)).body as IssueJson;
    expect(resent).toMatchObject({ status: 'SENT', returnNote: null });

    // GI2's keeper confirms: the document is POSTED, both parts under one number.
    const posted = await tickAndConfirm(keeper2, draft.id);
    expect(posted).toMatchObject({ status: 'POSTED', number: first.number });
    expect(posted.confirmations.map((row) => row.warehouseId)).toEqual([wh1.id, wh2.id]);
    expect(await onHand(wh2.id, water.id)).toBe('18.000');
    const seen = await get(admin, draft.id);
    expect(seen.lines.map((line) => line.amount)).toEqual(['2000.00', '1000.00']);
    expect(seen.total).toBe('3000.00');
    expect((await confirm(keeper2, draft.id).expect(409)).body).toMatchObject({
      code: 'ISSUE_NOT_SENT',
    });
  });

  it('keeps the rights apart: the accountant sends, the keeper confirms in their scope', async () => {
    const base = {
      warehouseId: wh1.id,
      expenseTypeId: typeId('BONUS'),
      recipient: { kind: 'OTHER', name: 'Төв оффис' },
      lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' }],
    };
    await create(worker, base).expect(403);
    const draft = (await create(accountant, base).expect(201)).body as IssueJson;
    await send(accountant, draft.id).expect(200);
    await confirm(accountant, draft.id).expect(403);
    // GI2's keeper has no line here.
    expect((await confirm(keeper2, draft.id).expect(403)).body).toMatchObject({
      params: { reason: 'WAREHOUSE_SCOPE' },
    });
    const posted = await tickAndConfirm(keeper1, draft.id);
    expect(posted.status).toBe('POSTED');
    // A typed recipient is a party of its own, by its name.
    expect(await partiesOn('STOCK', `GI:${draft.id}:%`, '730202')).toEqual([
      { name: 'Төв оффис', kind: 'OTHER', ref: 'other:төв оффис' },
    ]);
    // The keepers' list of pending work.
    const pending = (
      await http().get('/api/v1/issues').query({ pending: '1' }).set(bearer(keeper1)).expect(200)
    ).body as { data: { id: number }[] };
    expect(pending.data.map((row) => row.id)).not.toContain(draft.id);
  });

  it('refuses to cancel once a part left; removing the rest completes the document', async () => {
    const draft = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('INTERNAL_USE'),
        recipient: { kind: 'CUSTOMER', customerId },
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '1' },
        ],
      }).expect(201)
    ).body as IssueJson;
    await send(accountant, draft.id).expect(200);
    const pending = (
      await http().get('/api/v1/issues').query({ pending: '1' }).set(bearer(keeper2)).expect(200)
    ).body as { data: { id: number }[] };
    expect(pending.data.map((row) => row.id)).toContain(draft.id);
    await tickAndConfirm(keeper1, draft.id);
    expect(
      (await http().post(`/api/v1/issues/${draft.id}/cancel`).set(bearer(accountant)).expect(409))
        .body,
    ).toMatchObject({ code: 'ISSUE_PARTLY_POSTED' });
    const waterLine = draft.lines.find((line) => line.warehouseId === wh2.id);
    const after = (
      await http()
        .delete(`/api/v1/issue-lines/${waterLine?.id ?? 0}`)
        .set(bearer(accountant))
        .expect(200)
    ).body as IssueJson;
    expect(after.status).toBe('POSTED');
    expect(after.lines).toHaveLength(1);
  });

  it('charges damage to a person at the sale price and opens the receivable (ADR-0117 #3)', async () => {
    const other = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('DAMAGE_CHARGE'),
        recipient: { kind: 'OTHER', name: 'Хэн нэгэн' },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as IssueJson;
    expect((await send(accountant, other.id).expect(422)).body).toMatchObject({
      code: 'ISSUE_RECIPIENT_KIND',
    });
    const draft = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('DAMAGE_CHARGE'),
        recipient: { kind: 'USER', userId: staffId },
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '2' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '1' },
        ],
      }).expect(201)
    ).body as IssueJson;
    // The water has no sale price: the send names it.
    expect((await send(accountant, draft.id).expect(422)).body).toMatchObject({
      code: 'PRICE_MISSING',
      params: { productId: water.id, sku: '8802' },
    });
    const waterLine = draft.lines.find((line) => line.productId === water.id);
    await http()
      .delete(`/api/v1/issue-lines/${waterLine?.id ?? 0}`)
      .set(bearer(accountant))
      .expect(200);
    const sent = (await send(accountant, draft.id).expect(200)).body as IssueJson;
    expect(sent.lines[0]).toMatchObject({ saleUnitPrice: '2000', saleAmount: '4000' });
    expect(sent.saleTotal).toBe('4000');
    const posted = await tickAndConfirm(keeper1, draft.id);
    expect(posted.status).toBe('POSTED');
    // The goods left at cost as a cost of sale; the charge is the staff member's receivable.
    expect(await finLines('STOCK', `GI:${draft.id}:%`)).toEqual({
      '140101': '-2000.00',
      '610101': '2000.00',
    });
    expect(await finLines('DAMAGE_CHARGE', `${draft.id}:${wh1.id}`)).toEqual({
      '120101': '4000.00',
      '511020': '-4000.00',
    });
    const partyId = await partyIdOf(`user:${staffId}`);
    expect(partyId).toBeDefined();
    const items = await sql.query<{ open_amount: string; side: string }>(
      `SELECT i.open_amount::text, i.side FROM fin.open_items i
         JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
        WHERE d.source_doc_type = 'DAMAGE_CHARGE' AND d.source_doc_id = $1`,
      [`${draft.id}:${wh1.id}`],
    );
    expect(items.rows).toEqual([{ open_amount: '4000.00', side: 'DEBIT' }]);
    // The account report by account and party (ADR-0117 #2).
    const finance = financeApi(app, accountant);
    const ar = await finance.account('120101');
    const parties = (
      await http().get(`/api/v1/gl-accounts/${ar.id}/parties`).set(bearer(accountant)).expect(200)
    ).body as { partyId: string; name: string; kind: string }[];
    expect(parties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ partyId, name: 'Тест хэрэглэгч', kind: 'EMPLOYEE' }),
      ]),
    );
    const ledger = (
      await http()
        .get(`/api/v1/gl-accounts/${ar.id}/ledger`)
        .query({ partyId })
        .set(bearer(accountant))
        .expect(200)
    ).body as { data: { partyName: string; debit: string; balanceAfter: string }[] };
    expect(ledger.data).toEqual([
      expect.objectContaining({
        partyName: 'Тест хэрэглэгч',
        debit: '4000.00',
        balanceAfter: '4000.00',
      }),
    ]);

    // Charged to a customer, the receivable sits on the customer's balance.
    const before = await finance.balance(customerId);
    const toCustomer = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('DAMAGE_CHARGE'),
        recipient: { kind: 'CUSTOMER', customerId },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as IssueJson;
    await send(accountant, toCustomer.id).expect(200);
    await tickAndConfirm(keeper1, toCustomer.id);
    const after = await finance.balance(customerId);
    expect(Number.parseInt(after.balance, 10) - Number.parseInt(before.balance, 10)).toBe(2000);
  });

  it('credits a supplier return per confirmed warehouse', async () => {
    const draft = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('SUPPLIER_RETURN'),
        recipient: { kind: 'SUPPLIER', supplierId },
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '2' },
        ],
      }).expect(201)
    ).body as IssueJson;
    expect(draft).toMatchObject({ recipientKind: 'SUPPLIER', recipientName: 'Буцаалт ХХК ГИ' });
    await send(accountant, draft.id).expect(200);
    await tickAndConfirm(keeper2, draft.id);
    expect(await finLines('SUPPLIER_RETURN', `${draft.id}:${wh2.id}`)).toMatchObject({
      '140101': '-1000.00',
    });
    expect(await finLines('SUPPLIER_RETURN', `${draft.id}:${wh1.id}`)).toEqual({});
    await tickAndConfirm(keeper1, draft.id);
    expect(await finLines('SUPPLIER_RETURN', `${draft.id}:${wh1.id}`)).toMatchObject({
      '140101': '-1000.00',
    });
    // No stock journal of its own: the credits take the stock out (F3).
    expect(await finLines('STOCK', `GI:${draft.id}:%`)).toEqual({});
  });

  it('refuses more than the shelf holds and a retired type', async () => {
    const extra = types.find((type) => type.name === 'Хоол ГИ');
    if (!extra) throw new Error('no added type');
    const draft = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: extra.id,
        recipient: { kind: 'OTHER', name: 'Гал тогоо' },
        lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '9' }],
      }).expect(201)
    ).body as IssueJson;
    await send(accountant, draft.id).expect(200);
    const short = await tickAndConfirm(keeper1, draft.id, 409);
    expect(short).toMatchObject({ code: 'STOCK_INSUFFICIENT', params: { binCode: 'G-01-01' } });
    await http()
      .patch(`/api/v1/issues/expense-types/${extra.id}`)
      .set(bearer(admin))
      .send({ active: false })
      .expect(200);
    expect((await confirm(keeper1, draft.id).expect(409)).body).toMatchObject({
      code: 'EXPENSE_TYPE_INACTIVE',
    });
    await http().post(`/api/v1/issues/${draft.id}/cancel`).set(bearer(accountant)).expect(200);
  });

  it('corrects a posted issue through a change the keeper confirms (ADR-0117 #5)', async () => {
    // Two warehouses, two keepers.
    const original = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('DAMAGE_CHARGE'),
        recipient: { kind: 'USER', userId: staffId },
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '3' }],
      }).expect(201)
    ).body as IssueJson;
    await send(accountant, original.id).expect(200);
    await tickAndConfirm(keeper1, original.id);
    const colaBefore = await onHand(wh1.id, cola.id);
    const child = (
      await http()
        .post(`/api/v1/issues/${original.id}/corrections`)
        .set(bearer(accountant))
        .set(idempotency())
        .expect(201)
    ).body as IssueJson;
    expect(child).toMatchObject({ status: 'DRAFT', correctsIssueId: original.id });
    expect(child.lines.map((line) => line.qtyBase)).toEqual(['3']);
    expect(
      (
        await http()
          .post(`/api/v1/issues/${original.id}/corrections`)
          .set(bearer(accountant))
          .set(idempotency())
          .expect(409)
      ).body,
    ).toMatchObject({ code: 'ISSUE_CORRECTION_OPEN' });
    // Nothing changed yet: the send refuses.
    await send(accountant, child.id).expect(422);
    await http()
      .patch(`/api/v1/issue-lines/${child.lines[0]?.id ?? 0}`)
      .set(bearer(accountant))
      .send({ enteredQty: '1' })
      .expect(200);
    const sent = (await send(accountant, child.id).expect(200)).body as IssueJson;
    expect(sent.lines[0]).toMatchObject({ saleAmount: '2000' });
    const posted = await tickAndConfirm(keeper1, child.id);
    expect(posted.status).toBe('POSTED');
    // Three came back at the cost they left at, one left again: two more on hand.
    expect(await onHand(wh1.id, cola.id)).toBe(
      (Number.parseInt(colaBefore ?? '0', 10) + 2).toFixed(3),
    );
    const rows = await sql.query<{ movement_type: string; qty_base: string; unit_cost: string }>(
      `SELECT movement_type, qty_base::text, unit_cost::text FROM stock_ledger
        WHERE doc_type = 'GI' AND doc_id = $1 ORDER BY id`,
      [child.id],
    );
    expect(rows.rows).toEqual([
      { movement_type: 'GOODS_ISSUE_REVERSAL', qty_base: '3.000', unit_cost: '1000.0000' },
      { movement_type: 'GOODS_ISSUE', qty_base: '-1.000', unit_cost: '1000.0000' },
    ]);
    // The books: the reversal and the new content as two stock documents, the parent's charge
    // reversed and the new one booked.
    expect(await finLines('STOCK', `GI:${child.id}:%`)).toEqual({
      '140101': '2000.00',
      '610101': '-2000.00',
    });
    const reversed = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM fin.documents r
         JOIN fin.documents d ON d.id = r.reverses_document_id
        WHERE d.source_doc_type = 'DAMAGE_CHARGE' AND d.source_doc_id = $1`,
      [`${original.id}:${wh1.id}`],
    );
    expect(reversed.rows[0]?.n).toBe('1');
    expect(await finLines('DAMAGE_CHARGE', `${child.id}:${wh1.id}`)).toEqual({
      '120101': '2000.00',
      '511020': '-2000.00',
    });
    expect(await get(admin, original.id)).toMatchObject({ correctedByIssueId: child.id });

    // A correction that changes one warehouse only: the other is marked unchanged, no keeper.
    const both = (
      await create(accountant, {
        warehouseId: wh1.id,
        expenseTypeId: typeId('INTERNAL_USE'),
        recipient: { kind: 'OTHER', name: 'Хоёр агуулах' },
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '2' },
        ],
      }).expect(201)
    ).body as IssueJson;
    await send(accountant, both.id).expect(200);
    await tickAndConfirm(keeper1, both.id);
    await tickAndConfirm(keeper2, both.id);
    const change = (
      await http()
        .post(`/api/v1/issues/${both.id}/corrections`)
        .set(bearer(accountant))
        .set(idempotency())
        .expect(201)
    ).body as IssueJson;
    const waterLine = change.lines.find((line) => line.warehouseId === wh2.id);
    await http()
      .patch(`/api/v1/issue-lines/${waterLine?.id ?? 0}`)
      .set(bearer(accountant))
      .send({ enteredQty: '1' })
      .expect(200);
    const changeSent = (await send(accountant, change.id).expect(200)).body as IssueJson;
    expect(changeSent.confirmations).toEqual([
      expect.objectContaining({ warehouseId: wh1.id, confirmedBy: null, unchanged: true }),
    ]);
    const waterBefore = await onHand(wh2.id, water.id);
    const done = await tickAndConfirm(keeper2, change.id);
    expect(done.status).toBe('POSTED');
    expect(await onHand(wh2.id, water.id)).toBe(
      (Number.parseInt(waterBefore ?? '0', 10) + 1).toFixed(3),
    );
    // Two back from the first correction, one gone with the two-warehouse issue.
    expect(await onHand(wh1.id, cola.id)).toBe(
      (Number.parseInt(colaBefore ?? '0', 10) + 1).toFixed(3),
    );
  });

  it('imports issues from a sheet as drafts with lines in their homes, and takes them back', async () => {
    const imports = importsApi(app, admin);
    const job = await imports.check(
      'ISSUES',
      [
        { date: today, expenseType: 'Урамшуулал', recipient: 'Хамтрагч ГИ', sku: '8801', qty: '1' },
        { date: today, expenseType: 'Урамшуулал', recipient: 'Хамтрагч ГИ', sku: '8802', qty: '1' },
        {
          date: today,
          expenseType: 'Дотоод хэрэглээ',
          recipient: 'Агуулахын гал тогоо',
          sku: '8801',
          qty: '2',
        },
      ],
      { issueOptions: { warehouseId: wh1.id } },
    );
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    const { rows: before } = await sql.query<{ max: string }>(
      'SELECT coalesce(max(id), 0)::text AS max FROM goods_issues',
    );
    expect((await imports.commit(job.id)).status).toBe('COMMITTED');
    const { rows } = await sql.query<{
      recipient_kind: string;
      recipient_name: string;
      warehouses: string;
    }>(
      `SELECT g.recipient_kind, g.recipient_name,
              string_agg(l.warehouse_id::text, ',' ORDER BY l.warehouse_id) AS warehouses
         FROM goods_issues g JOIN goods_issue_lines l ON l.issue_id = g.id
        WHERE g.status = 'DRAFT' AND g.id > $1
        GROUP BY g.id ORDER BY g.recipient_name`,
      [before[0]?.max ?? '0'],
    );
    expect(rows).toEqual([
      { recipient_kind: 'OTHER', recipient_name: 'Агуулахын гал тогоо', warehouses: `${wh1.id}` },
      {
        recipient_kind: 'CUSTOMER',
        recipient_name: 'Хамтрагч ГИ',
        warehouses: `${wh1.id},${wh2.id}`,
      },
    ]);
    expect((await imports.revert(job.id)).status).toBe('REVERTED');
  });
});
