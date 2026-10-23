import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi, setSetting } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi, sheetOf } from '../harness/imports';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

interface LineJson {
  id: number;
  productId: number;
  enteredQty: string;
  warehouseId: number;
  salePrice: string | null;
  docUnitPrice?: string | null;
  docAmount?: string | null;
  freeGoods?: boolean;
  discountAmount?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  costAmount?: string | null;
}
interface ReceiptJson {
  id: number;
  number: string | null;
  status: string;
  costingStatus: string | null;
  costingVersion: number;
  paymentMethod: string;
  moneyAccountId: number | null;
  moneyAccountName: string | null;
  supplierVatPayer: boolean;
  vatRatePct: string;
  supplierDocNo: string | null;
  supplierDocDate: string | null;
  discounts?: DiscountJson[];
  lines: LineJson[];
  totals?: {
    docTotal: string;
    discountTotal: string;
    discountTooLarge: boolean;
    netTotal: string;
    vatTotal: string;
    costTotal: string;
    pricedLines: number;
  };
}
interface DiscountJson {
  id: number;
  kind: 'LINES' | 'NOTE';
  pct: string | null;
  amount: string | null;
  lineIds: number[];
  total: string | null;
}
interface SummaryJson {
  id: number;
  supplierDocDate: string | null;
  paymentMethod: string;
  netAmount?: string | null;
}
interface TermsJson {
  warehousePrice: string;
  profileId: number;
  wholeUomId: number | null;
  validFrom: string;
  validTo: string | null;
}

/**
 * The receipt window as one delivery note (ADR-0078, ADR-0099): prices typed on the draft by a
 * cost holder, VAT taken out for a VAT-paying supplier, the note's discount spread over its priced
 * lines, a fully priced receipt costed at posting, a line's new sale price put in force by the
 * posting, the last delivery-note prices, the payment method and account, and delivery notes
 * imported from a sheet as drafts into each product's home. Synthetic data only.
 */
describe('receipt prices and payment', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  /** Receipts and their costs, but no price right (WAREHOUSE + ACCOUNTANT). */
  let costClerk: string;
  let wh: WarehouseJson;
  let wh2: WarehouseJson;
  let vatSupplier: number;
  let plainSupplier: number;
  let water: ProductJson;
  let juice: ProductJson;
  /** Lives in the second warehouse. */
  let tea: ProductJson;
  let category: number;
  let cashBox: number;
  let bank: number;
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/receipts').set(bearer(token)).set(idempotency()).send(body);
  const get = async (token: string, id: number) =>
    (await http().get(`/api/v1/receipts/${id}`).set(bearer(token)).expect(200)).body as ReceiptJson;
  const patchLine = (token: string, id: number, body: Record<string, unknown>) =>
    http().patch(`/api/v1/receipt-lines/${id}`).set(bearer(token)).send(body);
  const post = (token: string, id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(token)).set(idempotency());
  /** Replaces a draft's discounts (ADR-0101). */
  const setDiscounts = (token: string, id: number, discounts: Record<string, unknown>[]) =>
    http().put(`/api/v1/receipts/${id}/discounts`).set(bearer(token)).send({ discounts });
  /** Creates a draft as the admin with its discounts. */
  const drafted = async (body: Record<string, unknown>, discounts: Record<string, unknown>[]) => {
    const draft = (await create(admin, body).expect(201)).body as ReceiptJson;
    return (await setDiscounts(admin, draft.id, discounts).expect(200)).body as ReceiptJson;
  };
  /** Creates and posts a receipt as the admin, with its discounts if given. */
  const posted = async (
    body: Record<string, unknown>,
    discounts: Record<string, unknown>[] = [],
  ) => {
    const draft = (await create(admin, body).expect(201)).body as ReceiptJson;
    if (discounts.length > 0) await setDiscounts(admin, draft.id, discounts).expect(200);
    return (await post(admin, draft.id).expect(200)).body as ReceiptJson;
  };
  const list = async (token: string, query: Record<string, unknown>) =>
    (
      (await http().get('/api/v1/receipts').query(query).set(bearer(token)).expect(200)).body as {
        data: SummaryJson[];
      }
    ).data;
  const valuations = async (id: number) =>
    (
      await sql.query<{
        version: number;
        doc_amount: string;
        discount_amount: string;
        amount: string;
      }>(
        `SELECT version, doc_amount::text, discount_amount::text, amount::text
           FROM stock_valuation_adjustments WHERE doc_type = 'GR' AND doc_id = $1
          ORDER BY version, doc_line_id`,
        [id],
      )
    ).rows;
  const avgOf = async (productId: number) =>
    (
      await sql.query<{ avg_cost: string; on_hand: string }>(
        'SELECT avg_cost, on_hand FROM warehouse_stock WHERE product_id = $1 AND warehouse_id = $2',
        [productId, wh.id],
      )
    ).rows[0];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    costClerk = (await login(app, await seedUser(app, { roles: ['WAREHOUSE', 'ACCOUNTANT'] })))
      .accessToken;
    await setSetting(app, admin, 'company.vat_payer', true, today);
    await setSetting(app, admin, 'tax.vat_rate_pct', '10', today);
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('RP1');
    wh2 = await inventory.warehouse('RP2');
    const partners = partnersApi(app, admin);
    vatSupplier = (await partners.supplier({ name: 'НӨАТ Нийлүүлэгч РП', vatPayer: true })).id;
    plainSupplier = (await partners.supplier({ name: 'Энгийн Нийлүүлэгч РП' })).id;
    const catalog = catalogApi(app, admin);
    category = await catalog.category('Ус РП');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    water = await catalog.product({
      sku: '7701',
      name: 'Ус РП',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '12' }],
    });
    juice = await catalog.product({
      sku: '7702',
      name: 'Жүүс РП',
      categoryId: category,
      baseUomId: pcs,
    });
    tea = await catalog.product({
      sku: '7703',
      name: 'Цай РП',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '10' }],
    });
    // Each line goes to its product's home (ADR-0099 #1).
    await inventory.setHome(water.id, wh.id);
    await inventory.setHome(juice.id, wh.id);
    await inventory.setHome(tea.id, wh2.id);
    const finance = financeApi(app, admin);
    const cashGl = await finance.account('100101');
    const bankGl = await finance.account('110101');
    cashBox = (
      (
        await finance
          .createMoneyAccount({
            code: 'RP-CASH',
            name: 'Касс РП',
            kind: 'CASH',
            glAccountId: cashGl.id,
          })
          .expect(201)
      ).body as { id: number }
    ).id;
    bank = (
      (
        await finance
          .createMoneyAccount({
            code: 'RP-BANK',
            name: 'Банк РП',
            kind: 'BANK',
            glAccountId: bankGl.id,
          })
          .expect(201)
      ).body as { id: number }
    ).id;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('takes the VAT out of a VAT payer’s prices and costs a fully priced receipt at posting', async () => {
    const draft = (
      await create(admin, {
        supplierId: vatSupplier,
        supplierDocNo: 'P-1',
        supplierDocDate: today,
        lines: [
          { productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' },
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '5', freeGoods: true },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft).toMatchObject({
      supplierVatPayer: true,
      vatRatePct: '10',
      paymentMethod: 'CREDIT',
      discounts: [],
    });
    expect(draft.lines[0]).toMatchObject({
      warehouseId: wh.id,
      docUnitPrice: '13200.00',
      docAmount: '26400.00',
      discountAmount: '0.00',
      netAmount: '26400.00',
      vatAmount: '2400.00',
      costAmount: '24000.00',
    });
    expect(draft.totals).toEqual({
      docTotal: '26400.00',
      discountTotal: '0.00',
      discountTooLarge: false,
      netTotal: '26400.00',
      vatTotal: '2400.00',
      costTotal: '24000.00',
      pricedLines: 2,
    });
    // A price per unit follows a new quantity.
    const [line] = draft.lines;
    if (!line) throw new Error('no line');
    const changed = (await patchLine(admin, line.id, { enteredQty: '3' }).expect(200))
      .body as ReceiptJson;
    expect(changed.lines[0]).toMatchObject({ docAmount: '39600.00', costAmount: '36000.00' });

    const done = (await post(admin, draft.id).expect(200)).body as ReceiptJson;
    expect(done).toMatchObject({ status: 'POSTED', costingStatus: 'COSTED', costingVersion: 1 });
    // 36 pieces at 36,000 ex-VAT: 1,000 each.
    expect(await avgOf(water.id)).toMatchObject({ on_hand: '36.000', avg_cost: '1000.0000' });
    const costing = (
      await http().get(`/api/v1/receipts/${draft.id}/costing`).set(bearer(admin)).expect(200)
    ).body as { total: string; docTotal: string; lines: { docAmount: string; amount: string }[] };
    expect(costing).toMatchObject({ total: '36000.00', docTotal: '39600.00' });
  });

  it('keeps a non-VAT supplier’s price as the cost and leaves a partly priced receipt pending', async () => {
    const draft = (
      await create(admin, {
        supplierId: plainSupplier,
        lines: [
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '10', docAmount: '25000' },
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '4' },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft).toMatchObject({ supplierVatPayer: false, vatRatePct: '0' });
    expect(draft.totals).toMatchObject({ docTotal: '25000.00', vatTotal: '0.00', pricedLines: 1 });
    const done = (await post(admin, draft.id).expect(200)).body as ReceiptJson;
    expect(done).toMatchObject({ costingStatus: 'PENDING', costingVersion: 0 });
    // The accountant's costing starts from the typed price and takes delivery-note amounts.
    const costing = (
      await http().get(`/api/v1/receipts/${draft.id}/costing`).set(bearer(admin)).expect(200)
    ).body as { costingVersion: number; lines: { lineId: number; docAmount: string | null }[] };
    expect(costing.lines.map((row) => row.docAmount)).toEqual(['25000.00', null]);
    const [first, second] = costing.lines;
    if (!first || !second) throw new Error('two lines expected');
    await http()
      .put(`/api/v1/receipts/${draft.id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 0,
        lines: [
          { lineId: first.lineId, amount: '25000' },
          { lineId: second.lineId, unitPrice: '1100' },
        ],
      })
      .expect(200);
    const after = await get(admin, draft.id);
    expect(after).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    expect(after.lines.map((row) => row.costAmount)).toEqual(['25000.00', '4400.00']);
  });

  it('never shows or takes prices from a user without the cost right', async () => {
    const draft = (
      await create(worker, {
        supplierId: vatSupplier,
        lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as ReceiptJson;
    expect(draft.totals).toBeUndefined();
    expect(Object.keys(draft.lines[0] ?? {})).not.toContain('docAmount');
    const [line] = draft.lines;
    if (!line) throw new Error('no line');
    const refused = await patchLine(worker, line.id, { docUnitPrice: '500' }).expect(403);
    expect(refused.body).toMatchObject({ code: 'FORBIDDEN' });
    await create(worker, {
      supplierId: vatSupplier,
      lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1', docAmount: '500' }],
    }).expect(403);
    // The discounts are cost data too.
    await setDiscounts(worker, draft.id, [{ kind: 'NOTE', pct: '5' }]).expect(403);
    // An admin prices the same draft; the warehouse still sees no price after posting.
    await patchLine(admin, line.id, { docAmount: '550' }).expect(200);
    await post(worker, draft.id).expect(200);
    const seen = await get(worker, draft.id);
    expect(seen).toMatchObject({ costingStatus: 'COSTED' });
    expect(JSON.stringify(seen)).not.toMatch(/docAmount|costAmount|netAmount|discount|totals/);
  });

  it('spreads a percentage discount over the priced lines, lowering their cost', async () => {
    const draft = await drafted(
      {
        supplierId: vatSupplier,
        supplierDocNo: 'D-10',
        supplierDocDate: today,
        lines: [
          { productUnitId: unitOf(water, 'BOX').id, enteredQty: '2', docUnitPrice: '13200' },
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '10', docAmount: '5500' },
          { productUnitId: unitOf(juice, 'PCS').id, enteredQty: '2', freeGoods: true },
        ],
      },
      [{ kind: 'NOTE', pct: '10' }],
    );
    expect(draft.discounts).toEqual([
      expect.objectContaining({
        kind: 'NOTE',
        pct: '10',
        amount: null,
        lineIds: [],
        total: '3190.00',
      }),
    ]);
    // 10 % of 31,900 is 3,190: 2,640 on the water, 550 on the juice, none on the bonus.
    expect(
      draft.lines.map((line) => [line.discountAmount, line.netAmount, line.vatAmount]),
    ).toEqual([
      ['2640.00', '23760.00', '2160.00'],
      ['550.00', '4950.00', '450.00'],
      [null, null, null],
    ]);
    const totals = {
      docTotal: '31900.00',
      discountTotal: '3190.00',
      discountTooLarge: false,
      netTotal: '28710.00',
      vatTotal: '2610.00',
      costTotal: '26100.00',
      pricedLines: 3,
    };
    expect(draft.totals).toEqual(totals);

    const done = (await post(admin, draft.id).expect(200)).body as ReceiptJson;
    expect(done).toMatchObject({ costingStatus: 'COSTED', costingVersion: 1 });
    expect(done.totals).toEqual(totals);
    // The cost is the net amount less its VAT; the valuation keeps the gross and the share.
    expect(await valuations(draft.id)).toEqual([
      { version: 1, doc_amount: '26400.00', discount_amount: '2640.00', amount: '21600.00' },
      { version: 1, doc_amount: '5500.00', discount_amount: '550.00', amount: '4500.00' },
      { version: 1, doc_amount: '0.00', discount_amount: null, amount: '0.00' },
    ]);
    const costing = (
      await http().get(`/api/v1/receipts/${draft.id}/costing`).set(bearer(admin)).expect(200)
    ).body as {
      discounts: DiscountJson[];
      total: string;
      lines: { discountAmount: string | null }[];
    };
    expect(costing).toMatchObject({
      discounts: [expect.objectContaining({ kind: 'NOTE', pct: '10', total: '3190.00' })],
      total: '26100.00',
    });
    expect(costing.lines.map((line) => line.discountAmount)).toEqual(['2640.00', '550.00', null]);
    // The list's amount is the payable, for cost holders only.
    const mine = (await list(admin, { q: 'D-10' })).find((row) => row.id === draft.id);
    expect(mine).toMatchObject({
      supplierDocDate: today,
      paymentMethod: 'CREDIT',
      netAmount: '28710.00',
    });
    const theirs = (await list(worker, { q: 'D-10' })).find((row) => row.id === draft.id);
    expect(theirs).toBeDefined();
    expect(Object.keys(theirs ?? {})).not.toContain('netAmount');
  });

  it('takes a discount amount with its remainder on the largest line, and refuses one too large', async () => {
    const lines = ['1000', '1000', '1000'].map((docAmount) => ({
      productUnitId: unitOf(juice, 'PCS').id,
      enteredQty: '1',
      docAmount,
    }));
    const draft = await drafted({ supplierId: plainSupplier, lines }, [
      { kind: 'NOTE', amount: '100' },
    ]);
    expect(draft.lines.map((line) => line.discountAmount)).toEqual(['33.34', '33.33', '33.33']);
    expect(draft.totals).toMatchObject({ discountTotal: '100.00', netTotal: '2900.00' });
    await post(admin, draft.id).expect(200);
    expect((await valuations(draft.id)).map((row) => row.amount)).toEqual([
      '966.66',
      '966.67',
      '966.67',
    ]);

    // A percentage or an amount, never both; a percentage up to 100.
    const small = await drafted(
      {
        supplierId: plainSupplier,
        lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1', docAmount: '150' }],
      },
      [{ kind: 'NOTE', pct: '5' }],
    );
    await setDiscounts(admin, small.id, [{ kind: 'NOTE', pct: '5', amount: '10' }]).expect(422);
    await setDiscounts(admin, small.id, [{ kind: 'NOTE', pct: '150' }]).expect(422);

    // A new list replaces the old one.
    const changed = (
      await setDiscounts(admin, small.id, [{ kind: 'NOTE', amount: '200' }]).expect(200)
    ).body as ReceiptJson;
    expect(changed.discounts).toEqual([
      expect.objectContaining({ kind: 'NOTE', pct: null, amount: '200.00', total: null }),
    ]);
    expect(changed.totals).toMatchObject({ discountTotal: '0.00', discountTooLarge: true });
    // 200 off a note of 150: the posting refuses it and changes nothing.
    const tooLarge = await post(admin, small.id).expect(422);
    expect(tooLarge.body).toMatchObject({
      code: 'RECEIPT_DISCOUNT_TOO_LARGE',
      params: { discount: '200.00', total: '150.00', index: 0 },
    });
    expect((await get(admin, small.id)).status).toBe('DRAFT');
    await http().post(`/api/v1/receipts/${small.id}/cancel`).set(bearer(admin)).expect(200);

    // So does the accountant's costing.
    const pending = await posted({
      supplierId: plainSupplier,
      lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '1' }],
    });
    expect(pending.costingStatus).toBe('PENDING');
    const refused = await http()
      .put(`/api/v1/receipts/${pending.id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 0,
        discounts: [{ kind: 'NOTE', amount: '500' }],
        lines: [{ lineId: pending.lines[0]?.id, amount: '100' }],
      })
      .expect(422);
    expect(refused.body).toMatchObject({ code: 'RECEIPT_DISCOUNT_TOO_LARGE' });
    // With a fitting discount it costs.
    const costed = (
      await http()
        .put(`/api/v1/receipts/${pending.id}/costs`)
        .set(bearer(admin))
        .set(idempotency())
        .send({
          costingVersion: 0,
          discounts: [{ kind: 'NOTE', pct: '10' }],
          lines: [{ lineId: pending.lines[0]?.id, amount: '100' }],
        })
        .expect(200)
    ).body as { discounts: DiscountJson[]; total: string; docTotal: string };
    expect(costed).toMatchObject({
      discounts: [expect.objectContaining({ kind: 'NOTE', pct: '10', total: '10.00' })],
      total: '90.00',
      docTotal: '100.00',
    });
  });

  it('puts a line’s sale price in force from the posting day, set by price holders only', async () => {
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Ус РП');
    const box = await catalogApi(app, admin).uomId('BOX');
    const tomorrow = addDays(today, 1);
    await pricing.terms(water.id, '1000', profile, box);
    await pricing.terms(water.id, '1500', profile, box, tomorrow);
    const view = async (productId: number) =>
      (
        await http()
          .get('/api/v1/product-prices')
          .query({ productId })
          .set(bearer(worker))
          .expect(200)
      ).body as { current: TermsJson | null; scheduled: TermsJson[] };
    const rows = async () =>
      (
        await sql.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM product_prices WHERE product_id = $1',
          [water.id],
        )
      ).rows[0]?.n;

    // Receipts and costs without the price right: no sale price.
    const refused = await create(costClerk, {
      supplierId: plainSupplier,
      lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', salePrice: '1200' }],
    }).expect(403);
    expect(refused.body).toMatchObject({
      code: 'FORBIDDEN',
      params: { permission: 'pricing.prices.manage' },
    });
    const draft = (
      await create(costClerk, {
        supplierId: plainSupplier,
        lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', docAmount: '1000' }],
      }).expect(201)
    ).body as ReceiptJson;
    const [line] = draft.lines;
    if (!line) throw new Error('no line');
    await patchLine(costClerk, line.id, { salePrice: '1200' }).expect(403);
    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', salePrice: '1200' })
      .expect(403);
    // A sale price is whole tugriks.
    await patchLine(admin, line.id, { salePrice: '1200.50' }).expect(422);

    // The admin types it on the clerk's draft; the clerk posts it.
    const typed = (await patchLine(admin, line.id, { salePrice: '1200' }).expect(200))
      .body as ReceiptJson;
    expect(typed.lines[0]?.salePrice).toBe('1200');
    expect((await view(water.id)).current).toMatchObject({ warehousePrice: '1000' });
    await post(costClerk, draft.id).expect(200);
    // In force from the posting's day, with the profile and whole pack of the terms it replaces;
    // the terms already scheduled for tomorrow still follow.
    const after = await view(water.id);
    expect(after.current).toMatchObject({
      warehousePrice: '1200',
      profileId: profile,
      wholeUomId: box,
      validFrom: today,
      validTo: tomorrow,
    });
    expect(after.scheduled).toEqual([
      expect.objectContaining({ warehousePrice: '1500', validFrom: tomorrow }),
    ]);

    // The price in force already: nothing is written.
    const before = await rows();
    await posted({
      supplierId: plainSupplier,
      lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', salePrice: '1200' }],
    });
    expect(await rows()).toBe(before);

    // One product, two different sale prices: refused at posting.
    const clash = (
      await create(admin, {
        supplierId: plainSupplier,
        lines: [
          { productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', salePrice: '1300' },
          { productUnitId: unitOf(water, 'BOX').id, enteredQty: '1', salePrice: '1400' },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect((await post(admin, clash.id).expect(422)).body).toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await http().post(`/api/v1/receipts/${clash.id}/cancel`).set(bearer(admin)).expect(200);

    // A product without terms gets its first ones on the price page: the posting is refused and
    // brings nothing in.
    const stockBefore = await avgOf(juice.id);
    const bare = (
      await create(admin, {
        supplierId: plainSupplier,
        lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '4', salePrice: '900' }],
      }).expect(201)
    ).body as ReceiptJson;
    expect((await post(admin, bare.id).expect(409)).body).toMatchObject({
      code: 'SALE_PRICE_NO_TERMS',
      params: { productId: juice.id, product: 'Жүүс РП' },
    });
    expect((await get(admin, bare.id)).status).toBe('DRAFT');
    expect(await avgOf(juice.id)).toEqual(stockBefore);
    expect((await view(juice.id)).current).toBeNull();
    await http().post(`/api/v1/receipts/${bare.id}/cancel`).set(bearer(admin)).expect(200);
  });

  it('reads each product’s newest posted delivery-note price and filters the list by product and date', async () => {
    const older = addDays(today, -5);
    const oldest = addDays(today, -10);
    const first = await posted({
      supplierId: plainSupplier,
      supplierDocDate: older,
      lines: [{ productUnitId: unitOf(tea, 'PCS').id, enteredQty: '10', docAmount: '10000' }],
    });
    // The newest note: per box and per piece, before its discount.
    const newest = await posted(
      {
        supplierId: vatSupplier,
        supplierDocDate: today,
        lines: [{ productUnitId: unitOf(tea, 'BOX').id, enteredQty: '2', docUnitPrice: '12000' }],
      },
      [{ kind: 'NOTE', pct: '10' }],
    );
    expect(newest.lines[0]?.warehouseId).toBe(wh2.id);
    // Posted later, but its note is older; a bonus and a draft carry no price.
    const late = await posted({
      supplierId: plainSupplier,
      supplierDocDate: oldest,
      lines: [{ productUnitId: unitOf(tea, 'PCS').id, enteredQty: '1', docAmount: '999' }],
    });
    const bonus = await posted({
      supplierId: plainSupplier,
      supplierDocDate: today,
      lines: [{ productUnitId: unitOf(tea, 'PCS').id, enteredQty: '1', freeGoods: true }],
    });
    const draft = await drafted(
      {
        supplierId: plainSupplier,
        lines: [{ productUnitId: unitOf(tea, 'PCS').id, enteredQty: '1', docAmount: '5' }],
      },
      [{ kind: 'NOTE', amount: '1' }],
    );
    const unknown = await catalogApi(app, admin).product({
      sku: '7709',
      name: 'Ирээгүй бараа РП',
      categoryId: category,
      baseUomId: await catalogApi(app, admin).uomId('PCS'),
    });

    const prices = (
      await http()
        .get('/api/v1/receipts/last-prices')
        .query(`productIds=${tea.id}&productIds=${unknown.id}`)
        .set(bearer(costClerk))
        .expect(200)
    ).body as Record<string, unknown>[];
    expect(prices).toEqual([
      {
        productId: tea.id,
        receiptId: newest.id,
        receiptNumber: newest.number,
        date: today,
        supplierName: 'НӨАТ Нийлүүлэгч РП',
        unitName: 'хайрцаг',
        unitPrice: '12000.00',
        basePrice: '1200.00',
      },
    ]);
    await http()
      .get('/api/v1/receipts/last-prices')
      .query({ productIds: tea.id })
      .set(bearer(worker))
      .expect(403);
    await http().get('/api/v1/receipts/last-prices').set(bearer(admin)).expect(422);

    // By product, newest first; by the note's date (a draft without one has none).
    const ids = (rows: SummaryJson[]) => rows.map((row) => row.id);
    const ofTea = await list(admin, { productId: tea.id });
    expect(ids(ofTea)).toEqual([draft.id, bonus.id, late.id, newest.id, first.id]);
    expect(ids(await list(admin, { productId: tea.id, from: older, to: older }))).toEqual([
      first.id,
    ]);
    expect(ids(await list(admin, { productId: tea.id, from: today }))).toEqual([
      bonus.id,
      newest.id,
    ]);
    expect(ids(await list(admin, { productId: tea.id, to: older }))).toEqual([late.id, first.id]);
    await http().get('/api/v1/receipts').query({ from: '2026-1-1' }).set(bearer(admin)).expect(422);
    // The payable: the costing's net of the discount, a draft's typed prices less its discount.
    const amounts = new Map(ofTea.map((row) => [row.id, row.netAmount]));
    expect(amounts.get(newest.id)).toBe('21600.00');
    expect(amounts.get(first.id)).toBe('10000.00');
    expect(amounts.get(bonus.id)).toBe('0.00');
    expect(amounts.get(draft.id)).toBe('4.00');
    expect((await list(worker, { productId: tea.id })).every((row) => !('netAmount' in row))).toBe(
      true,
    );
    await http().post(`/api/v1/receipts/${draft.id}/cancel`).set(bearer(admin)).expect(200);
  });

  it('finds active products for the line picker', async () => {
    const lookup = (q: string, extra: Record<string, unknown> = {}) =>
      http()
        .get('/api/v1/products/lookup')
        .query({ q, ...extra })
        .set(bearer(worker));
    const found = (await lookup('7703').expect(200)).body as {
      id: number;
      thumbUrl: string | null;
      units: { uomName: string }[];
    }[];
    expect(found).toEqual([
      expect.objectContaining({
        id: tea.id,
        thumbUrl: null,
        units: [
          expect.objectContaining({ uomName: 'ш' }),
          expect.objectContaining({ uomName: 'хайрцаг' }),
        ],
      }),
    ]);
    const byName = (await lookup('РП', { limit: 2 }).expect(200)).body as unknown[];
    expect(byName).toHaveLength(2);
    expect((await lookup('   ').expect(200)).body).toEqual([]);
    await lookup('РП', { limit: 31 }).expect(422);
    const retired = await catalogApi(app, admin).product({
      sku: '7799',
      name: 'Хуучин РП',
      categoryId: category,
      baseUomId: await catalogApi(app, admin).uomId('PCS'),
    });
    await http()
      .patch(`/api/v1/products/${retired.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((await lookup('7799').expect(200)).body).toEqual([]);
  });

  it('names a cash box or bank account for a paid receipt, none on credit', async () => {
    const accounts = (
      await http().get('/api/v1/receipts/payment-accounts').set(bearer(worker)).expect(200)
    ).body as { id: number; kind: string }[];
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: cashBox, kind: 'CASH' }),
        expect.objectContaining({ id: bank, kind: 'BANK' }),
      ]),
    );
    const base = {
      supplierId: plainSupplier,
      lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '2' }],
    };
    await create(admin, { ...base, paymentMethod: 'CREDIT', moneyAccountId: cashBox }).expect(422);
    await create(admin, { ...base, paymentMethod: 'CASH', moneyAccountId: bank }).expect(422);
    const cash = (await create(admin, { ...base, paymentMethod: 'CASH' }).expect(201))
      .body as ReceiptJson;
    const missing = await post(admin, cash.id).expect(422);
    expect(missing.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    const named = (
      await http()
        .patch(`/api/v1/receipts/${cash.id}`)
        .set(bearer(admin))
        .send({ moneyAccountId: cashBox })
        .expect(200)
    ).body as ReceiptJson;
    expect(named).toMatchObject({ paymentMethod: 'CASH', moneyAccountName: 'Касс РП' });
    await post(admin, cash.id).expect(200);
    // Back to credit on another draft drops the account.
    const other = (
      await create(admin, { ...base, paymentMethod: 'BANK', moneyAccountId: bank }).expect(201)
    ).body as ReceiptJson;
    const credit = (
      await http()
        .patch(`/api/v1/receipts/${other.id}`)
        .set(bearer(admin))
        .send({ paymentMethod: 'CREDIT' })
        .expect(200)
    ).body as ReceiptJson;
    expect(credit).toMatchObject({ paymentMethod: 'CREDIT', moneyAccountId: null });
  });

  it('imports delivery notes from a sheet as drafts and takes them back while untouched', async () => {
    const imports = importsApi(app, admin);
    const options = { receiptOptions: { paymentMethod: 'CREDIT', moneyAccountId: null } };
    const job = await imports.check(
      'RECEIPTS',
      [
        {
          date: today,
          supplier: 'НӨАТ Нийлүүлэгч РП',
          docNo: 'X-1',
          sku: '7701',
          unit: 'хайрцаг',
          qty: '1',
          unitPrice: '13200',
        },
        {
          date: today,
          supplier: 'НӨАТ Нийлүүлэгч РП',
          docNo: 'X-1',
          sku: '7702',
          qty: '6',
          unitPrice: '1100',
        },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'Y-9', sku: '7702', qty: '3' },
      ],
      options,
    );
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    const committed = await imports.commit(job.id);
    expect(committed.status).toBe('COMMITTED');
    const { rows } = await sql.query<{ id: number; supplier_doc_no: string; lines: string }>(
      `SELECT r.id, r.supplier_doc_no, count(l.id)::text AS lines
         FROM goods_receipts r JOIN goods_receipt_lines l ON l.receipt_id = r.id
        WHERE r.supplier_doc_no IN ('X-1', 'Y-9') AND r.status = 'DRAFT'
        GROUP BY r.id ORDER BY r.supplier_doc_no`,
    );
    expect(rows.map((row) => [row.supplier_doc_no, row.lines])).toEqual([
      ['X-1', '2'],
      ['Y-9', '1'],
    ]);
    const x1 = await get(admin, rows[0]?.id ?? 0);
    expect(x1.totals).toMatchObject({ docTotal: '19800.00', vatTotal: '1800.00', pricedLines: 2 });
    const reverted = await imports.revert(job.id);
    expect(reverted.status).toBe('REVERTED');
    const { rows: left } = await sql.query<{ status: string }>(
      `SELECT status FROM goods_receipts WHERE supplier_doc_no IN ('X-1', 'Y-9')`,
    );
    expect(left.map((row) => row.status)).toEqual(['CANCELLED', 'CANCELLED']);
  });

  it('imports each row into its product’s home and refuses a product without one', async () => {
    const imports = importsApi(app, admin);
    const options = { receiptOptions: { paymentMethod: 'CREDIT', moneyAccountId: null } };
    await catalogApi(app, admin).product({
      sku: '7704',
      name: 'Гэргүй РП',
      categoryId: category,
      baseUomId: await catalogApi(app, admin).uomId('PCS'),
    });
    const homeless = await imports.check(
      'RECEIPTS',
      [
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'H-0', sku: '7701', qty: '1' },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'H-0', sku: '7704', qty: '1' },
      ],
      options,
    );
    expect(homeless).toMatchObject({ status: 'INVALID', errorRows: 1 });
    expect(
      (await imports.rows(homeless.id, 'ERRORS')).flatMap((row) =>
        row.errors.map((issue) => `${row.rowNo}:${issue.column}:${issue.code}`),
      ),
    ).toEqual(['3:sku:NO_HOME']);

    const job = await imports.check(
      'RECEIPTS',
      [
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'W-1', sku: '7701', qty: '2' },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'W-1', sku: '7703', qty: '3' },
      ],
      options,
    );
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    expect(job).not.toHaveProperty('receiptOptions.warehouseId');
    await imports.commit(job.id);
    const { rows } = await sql.query<{
      receipt_id: string;
      product_id: string;
      warehouse_id: string;
    }>(
      `SELECT l.receipt_id::text, l.product_id::text, l.warehouse_id::text
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
        WHERE r.supplier_doc_no = 'W-1' ORDER BY l.id`,
    );
    expect(new Set(rows.map((row) => row.receipt_id)).size).toBe(1);
    expect(rows.map((row) => [row.product_id, row.warehouse_id])).toEqual([
      [String(water.id), String(wh.id)],
      [String(tea.id), String(wh2.id)],
    ]);
    expect((await imports.revert(job.id)).status).toBe('REVERTED');
  });

  it('refuses a sheet row it cannot place and keeps a posted import receipt', async () => {
    const imports = importsApi(app, admin);
    const options = { receiptOptions: { paymentMethod: 'CREDIT', moneyAccountId: null } };
    const bad = await imports.check(
      'RECEIPTS',
      [
        { date: '2026-13-01', supplier: 'Байхгүй ХХК', sku: '0000', qty: '1' },
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', qty: '0' },
      ],
      options,
    );
    expect(bad.status).toBe('INVALID');
    const issues = (await imports.rows(bad.id, 'ERRORS')).flatMap((row) =>
      row.errors.map((issue) => `${row.rowNo}:${issue.column}:${issue.code}`),
    );
    expect(issues).toEqual(
      expect.arrayContaining([
        '2:date:FORMAT',
        '2:supplier:NOT_FOUND',
        '2:sku:NOT_FOUND',
        '3:sku:REQUIRED',
        '3:qty:NOT_POSITIVE',
      ]),
    );
    const good = await imports.check(
      'RECEIPTS',
      [{ date: today, supplier: 'Энгийн Нийлүүлэгч РП', docNo: 'Z-5', sku: '7702', qty: '2' }],
      options,
    );
    await imports.commit(good.id);
    const { rows } = await sql.query<{ id: number }>(
      `SELECT id FROM goods_receipts WHERE supplier_doc_no = 'Z-5'`,
    );
    await post(worker, rows[0]?.id ?? 0).expect(200);
    const kept = await imports.revert(good.id);
    expect(kept.status).toBe('COMMITTED');
    expect(kept.lastError).toMatchObject({ code: 'IMPORT_REVERT_BLOCKED' });
    // A receipts import needs its options (how the notes are paid).
    const fileId = await imports.upload(
      await sheetOf('RECEIPTS', [
        { date: today, supplier: 'Энгийн Нийлүүлэгч РП', sku: '7702', qty: '1' },
      ]),
    );
    await http()
      .post('/api/v1/imports')
      .set(bearer(admin))
      .set(idempotency())
      .send({ kind: 'RECEIPTS', fileId, fileName: 'r.xlsx' })
      .expect(422);
    // The warehouse is no longer an option.
    await http()
      .post('/api/v1/imports')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        kind: 'RECEIPTS',
        fileId,
        fileName: 'r.xlsx',
        receiptOptions: { warehouseId: wh.id, paymentMethod: 'CREDIT', moneyAccountId: null },
      })
      .expect(422);
  });
});
