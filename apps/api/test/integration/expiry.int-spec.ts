import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson } from '../harness/catalog';
import { type AppStore, appStore } from '../harness/customer-app';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface ItemJson {
  id: number;
  product: { id: number; sku: string; name: string; baseUomName: string; thumbUrl: string | null };
  supplier: { id: number; name: string } | null;
  homeWarehouse: { id: number; name: string } | null;
  expiryDate: string;
  daysLeft: number;
  urgency: string;
  qtyFloor: string;
  qtyWarehouse: string;
  qtyTotal: string;
  status: string;
  liability: {
    type: string;
    roles: { id: number; code: string | null; name: string | null }[];
    users: { id: number; fullName: string }[];
    note: string | null;
  };
  note: string | null;
  editVersion: number;
  createdAt: string;
  createdByName: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedByName: string | null;
}
interface PageJson {
  data: ItemJson[];
  nextCursor: string | null;
}
interface ChangeJson {
  id: number;
  kind: string;
  qtyFloorOld: string;
  qtyFloorNew: string;
  qtyWarehouseOld: string;
  qtyWarehouseNew: string;
  changedAt: string;
  changedByName: string;
}
interface SummaryJson {
  today: string;
  soonDays: number;
  urgentDays: number;
  active: number;
  expired: number;
  urgent: number;
  soon: number;
  archived: number;
  byStatus: { REVIEW: number; CITY_RETURN: number; INTERNAL_SALE: number };
}

const OLD_AUTHOR = 'хуучин.нярав';

/**
 * The expiry register (ADR-0172): an observation log of what someone saw on a shelf. It is never
 * deleted, a save never overwrites someone else's input, decisions take their rights and the stock
 * never moves. Synthetic data only.
 */
describe('expiry register', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let reader: Client;
  let admin: string;
  /** A staff member with no role at all. */
  let staff: string;
  let staffId: number;
  /** Holds exactly `expiry.items.manage`. */
  let manager: string;
  /** Holds exactly `expiry.liability.manage`. */
  let liable: string;
  let store: AppStore;
  let category: number;
  let pcs: number;
  let kg: number;
  let skus = 70_000;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const newProduct = (name: string, extra: Record<string, unknown> = {}): Promise<ProductJson> => {
    skus += 1;
    return catalogApi(app, admin).product({
      sku: String(skus),
      name,
      categoryId: category,
      baseUomId: pcs,
      ...extra,
    });
  };

  const post = (body: Record<string, unknown>, token = staff) =>
    http().post('/api/v1/expiry/items').set(bearer(token)).set(idempotency()).send(body);

  /** A record that passes every check, whatever else stands on its product and date. */
  const record = async (
    productId: number,
    expiryDate: string,
    extra: Record<string, unknown> = {},
    token = staff,
  ): Promise<ItemJson> =>
    (
      await post(
        {
          productId,
          expiryDate,
          qtyFloor: '1',
          qtyWarehouse: '0',
          allowDuplicate: true,
          ...extra,
        },
        token,
      ).expect(201)
    ).body as ItemJson;

  const list = async (query: Record<string, unknown>, token = staff): Promise<PageJson> =>
    (await http().get('/api/v1/expiry/items').query(query).set(bearer(token)).expect(200))
      .body as PageJson;

  /** Every row of a query, page by page, as the screens walk it. */
  const walk = async (query: Record<string, unknown>, limit = 2): Promise<ItemJson[]> => {
    const rows: ItemJson[] = [];
    let cursor: string | null = null;
    do {
      const page: PageJson = await list({ ...query, limit, ...(cursor ? { cursor } : {}) });
      expect(page.data.length).toBeLessThanOrEqual(limit);
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor);
    return rows;
  };

  const getItem = async (id: number, token = staff): Promise<ItemJson> =>
    (await http().get(`/api/v1/expiry/items/${id}`).set(bearer(token)).expect(200))
      .body as ItemJson;

  const history = async (id: number): Promise<ChangeJson[]> =>
    (
      (await http().get(`/api/v1/expiry/items/${id}/history`).set(bearer(staff)).expect(200))
        .body as { data: ChangeJson[] }
    ).data;

  const patch = (id: number, body: Record<string, unknown>, token = staff) =>
    http().patch(`/api/v1/expiry/items/${id}`).set(bearer(token)).send(body);

  const setStatus = (id: number, status: string, token = manager) =>
    http().put(`/api/v1/expiry/items/${id}/status`).set(bearer(token)).send({ status });

  const setLiability = (id: number, body: Record<string, unknown>, token = liable) =>
    http().put(`/api/v1/expiry/items/${id}/liability`).set(bearer(token)).send(body);

  const carry = (body: Record<string, unknown>, token = admin, key = idempotency()) =>
    http().post('/api/v1/expiry/items/carry').set(bearer(token)).set(key).send(body);

  const summary = async (): Promise<SummaryJson> =>
    (await http().get('/api/v1/expiry/summary').set(bearer(staff)).expect(200)).body as SummaryJson;

  const auditActions = async (id: number): Promise<string[]> => {
    const { rows } = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'expiry_items' AND entity_id = $1 ORDER BY id`,
      [String(id)],
    );
    return rows.map((row) => row.action);
  };

  const dates = (rows: readonly ItemJson[]) => rows.map((row) => row.expiryDate);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    reader = await connectAs('ai_reader');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const plain = await seedUser(app);
    staffId = plain.id;
    await http()
      .patch(`/api/v1/users/${staffId}`)
      .set(bearer(admin))
      .send({ fullName: 'Туршилт Ажилтан' })
      .expect(200);
    staff = (await login(app, plain)).accessToken;
    manager = await customRoleUser(app, admin, ['expiry.items.manage']);
    liable = await customRoleUser(app, admin, ['expiry.liability.manage']);
    store = await appStore(app, admin);
    const catalog = catalogApi(app, admin);
    category = await catalog.category('Хугацаа');
    pcs = await catalog.uomId('PCS');
    kg = await catalog.uomId('KG');
  });

  afterAll(async () => {
    await expectReconciled(app);
    await reader.end();
    await sql.end();
    await app.close();
  });

  describe('recording', () => {
    it('keeps a product, a date and two counts, its creation being the first history row', async () => {
      const water = await newProduct('Цэвэр ус');
      const created = (
        await post({
          productId: water.id,
          expiryDate: addDays(today, 5),
          qtyFloor: '12',
          qtyWarehouse: '30',
          note: '  тавиурын ард  ',
        }).expect(201)
      ).body as ItemJson;
      expect(created).toMatchObject({
        product: {
          id: water.id,
          sku: water.sku,
          name: 'Цэвэр ус',
          baseUomName: 'ш',
          thumbUrl: null,
        },
        supplier: null,
        homeWarehouse: null,
        expiryDate: addDays(today, 5),
        daysLeft: 5,
        urgency: 'URGENT',
        qtyFloor: '12',
        qtyWarehouse: '30',
        qtyTotal: '42',
        status: 'REVIEW',
        liability: { type: 'NONE', roles: [], users: [], note: null },
        note: 'тавиурын ард',
        editVersion: 1,
        createdByName: 'Туршилт Ажилтан',
        archivedAt: null,
        archivedByName: null,
      });
      expect(await getItem(created.id)).toEqual(created);
      expect(await history(created.id)).toEqual([
        expect.objectContaining({
          kind: 'CREATE',
          qtyFloorOld: '12',
          qtyFloorNew: '12',
          qtyWarehouseOld: '30',
          qtyWarehouseNew: '30',
          changedByName: 'Туршилт Ажилтан',
        }),
      ]);
      expect(await auditActions(created.id)).toEqual(['CREATE']);
    });

    it('keeps the name a record was made under when the person is renamed later', async () => {
      const author = await seedUser(app);
      const token = (await login(app, author)).accessToken;
      await http()
        .patch(`/api/v1/users/${author.id}`)
        .set(bearer(admin))
        .send({ fullName: 'Анхны Нэр' })
        .expect(200);
      const product = await newProduct('Нэр солих шалгалт');
      const created = await record(product.id, addDays(today, 40), {}, token);
      await http()
        .patch(`/api/v1/users/${author.id}`)
        .set(bearer(admin))
        .send({ fullName: 'Шинэ Нэр' })
        .expect(200);
      expect((await getItem(created.id)).createdByName).toBe('Анхны Нэр');
    });

    it('refuses a second open record of a product and date, unless the person says so', async () => {
      const product = await newProduct('Давхар шалгалт');
      const date = addDays(today, 60);
      const first = await record(product.id, date);
      const refused = await post({
        productId: product.id,
        expiryDate: date,
        qtyFloor: '2',
        qtyWarehouse: '0',
      }).expect(409);
      expect(refused.body).toMatchObject({
        code: 'EXPIRY_ITEM_EXISTS',
        params: { itemId: first.id },
      });
      // Another date of the same product is another record.
      await post({
        productId: product.id,
        expiryDate: addDays(date, 1),
        qtyFloor: '2',
        qtyWarehouse: '0',
      }).expect(201);
      const second = await record(product.id, date, { qtyFloor: '2' });
      expect(second.id).not.toBe(first.id);
      // The newest of the open ones is the one to open.
      const again = await post({
        productId: product.id,
        expiryDate: date,
        qtyFloor: '3',
        qtyWarehouse: '0',
      }).expect(409);
      expect(again.body).toMatchObject({ params: { itemId: second.id } });
      // An archived record does not stand in the way.
      await setStatus(first.id, 'ARCHIVED').expect(200);
      await setStatus(second.id, 'ARCHIVED').expect(200);
      await post({
        productId: product.id,
        expiryDate: date,
        qtyFloor: '3',
        qtyWarehouse: '0',
      }).expect(201);
    });

    it('needs an Idempotency-Key and replays a repeated request without a second record', async () => {
      const product = await newProduct('Давтан хүсэлт');
      const body = {
        productId: product.id,
        expiryDate: addDays(today, 70),
        qtyFloor: '4',
        qtyWarehouse: '0',
      };
      const missing = await http()
        .post('/api/v1/expiry/items')
        .set(bearer(staff))
        .send(body)
        .expect(400);
      expect(missing.body).toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
      const key = idempotency();
      const first = await http()
        .post('/api/v1/expiry/items')
        .set(bearer(staff))
        .set(key)
        .send(body)
        .expect(201);
      const replay = await http()
        .post('/api/v1/expiry/items')
        .set(bearer(staff))
        .set(key)
        .send(body)
        .expect(201);
      expect(replay.body).toEqual(first.body);
      expect((await list({ productId: product.id })).data).toHaveLength(1);
    });

    it('takes a past date but stops a typing slip: 5 years back, 15 ahead', async () => {
      const product = await newProduct('Огнооны шалгалт');
      const shifted = (years: number, days: number) =>
        addDays(`${String(Number.parseInt(today.slice(0, 4), 10) + years)}${today.slice(4)}`, days);
      await record(product.id, addDays(today, -1));
      await record(product.id, shifted(-5, 0));
      await record(product.id, shifted(15, 0));
      for (const expiryDate of [shifted(-5, -1), shifted(15, 1)]) {
        const refused = await post({
          productId: product.id,
          expiryDate,
          qtyFloor: '1',
          qtyWarehouse: '0',
        }).expect(422);
        expect(refused.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [expect.objectContaining({ path: 'expiryDate', constraint: 'range' })],
        });
      }
      await post({
        productId: product.id,
        expiryDate: '2026-02-30',
        qtyFloor: '1',
        qtyWarehouse: '0',
      }).expect(422);
    });

    it('refuses a fraction on a whole unit and takes it on a fractional one', async () => {
      const piece = await newProduct('Ширхэгтэй бараа');
      const refused = await post({
        productId: piece.id,
        expiryDate: addDays(today, 90),
        qtyFloor: '1',
        qtyWarehouse: '2.5',
      }).expect(422);
      expect(refused.body).toMatchObject({
        errors: [expect.objectContaining({ path: 'qtyWarehouse', constraint: 'whole' })],
      });
      const flour = await newProduct('Килоор зарах гурил', { baseUomId: kg });
      const weighed = await record(flour.id, addDays(today, 90), {
        qtyFloor: '2.5',
        qtyWarehouse: '0.125',
      });
      expect(weighed).toMatchObject({
        qtyFloor: '2.5',
        qtyWarehouse: '0.125',
        qtyTotal: '2.625',
      });
    });

    it('starts with at least one positive quantity, and never a negative one', async () => {
      const product = await newProduct('Тэг шалгалт');
      const refused = await post({
        productId: product.id,
        expiryDate: addDays(today, 100),
        qtyFloor: '0',
        qtyWarehouse: '0.000',
      }).expect(422);
      expect(refused.body).toMatchObject({
        errors: [expect.objectContaining({ path: 'qtyFloor', constraint: 'positive' })],
      });
      await post({
        productId: product.id,
        expiryDate: addDays(today, 100),
        qtyFloor: '-1',
        qtyWarehouse: '3',
      }).expect(422);
      await record(product.id, addDays(today, 100), { qtyFloor: '0', qtyWarehouse: '3' });
    });

    it('records an inactive product: the goods are on the shelf', async () => {
      const product = await newProduct('Идэвхгүй бараа');
      await sql.query(`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, [product.id]);
      await record(product.id, addDays(today, 110));
    });

    it('answers 404 for a product that does not exist', async () => {
      await post({
        productId: 99_999_999,
        expiryDate: addDays(today, 1),
        qtyFloor: '1',
        qtyWarehouse: '0',
      }).expect(404);
    });
  });

  describe('the list', () => {
    let boundary: ProductJson;
    const offsets = [-1, 0, 7, 8, 30, 31];
    const at = (...days: number[]) => days.map((day) => addDays(today, day));

    beforeAll(async () => {
      boundary = await newProduct('Хил шалгалт');
      for (const offset of offsets) await record(boundary.id, addDays(today, offset));
    });

    it('answers each view by its dates, both ends of a window included', async () => {
      const ofView = async (view?: string) =>
        dates(await walk({ productId: boundary.id, ...(view ? { view } : {}) }));
      expect(await ofView()).toEqual(at(...offsets));
      expect(await ofView('ACTIVE')).toEqual(at(...offsets));
      expect(await ofView('EXPIRED')).toEqual(at(-1));
      expect(await ofView('URGENT')).toEqual(at(0, 7));
      expect(await ofView('SOON')).toEqual(at(0, 7, 8, 30));
      expect(await ofView('REVIEW')).toEqual(at(...offsets));
      expect(await ofView('CITY_RETURN')).toEqual([]);
      expect(await ofView('ARCHIVED')).toEqual([]);
    });

    it('answers the days left and how urgent they are from the server’s date', async () => {
      const rows = await walk({ productId: boundary.id });
      expect(rows.map((row) => [row.daysLeft, row.urgency])).toEqual([
        [-1, 'EXPIRED'],
        [0, 'URGENT'],
        [7, 'URGENT'],
        [8, 'SOON'],
        [30, 'SOON'],
        [31, 'OK'],
      ]);
    });

    it('keeps a status view to that status and leaves archived records out of the others', async () => {
      const product = await newProduct('Төлөв шалгалт');
      const inCity = await record(product.id, addDays(today, -3));
      const onSale = await record(product.id, addDays(today, -2));
      const gone = await record(product.id, addDays(today, -1));
      await setStatus(inCity.id, 'CITY_RETURN').expect(200);
      await setStatus(onSale.id, 'INTERNAL_SALE').expect(200);
      await setStatus(gone.id, 'ARCHIVED').expect(200);
      const idsOf = async (view: string) =>
        (await walk({ productId: product.id, view })).map((row) => row.id);
      expect(await idsOf('CITY_RETURN')).toEqual([inCity.id]);
      expect(await idsOf('INTERNAL_SALE')).toEqual([onSale.id]);
      expect(await idsOf('ARCHIVED')).toEqual([gone.id]);
      expect(await idsOf('REVIEW')).toEqual([]);
      expect(await idsOf('EXPIRED')).toEqual([inCity.id, onSale.id]);
      expect(await idsOf('ACTIVE')).toEqual([inCity.id, onSale.id]);
    });

    it('pages without losing or repeating a row across repeated dates, soonest first', async () => {
      const product = await newProduct('Хуудаслалт ойрын');
      const soon = addDays(today, 200);
      const later = addDays(today, 201);
      const rows: ItemJson[] = [];
      for (const date of [later, soon, soon, later, soon, soon]) {
        rows.push(await record(product.id, date));
      }
      const expected = [...rows]
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || b.id - a.id)
        .map((row) => row.id);
      for (const limit of [1, 2, 3, 5]) {
        expect((await walk({ productId: product.id }, limit)).map((row) => row.id)).toEqual(
          expected,
        );
      }
    });

    it('pages an archive with the latest date first, across repeated dates', async () => {
      const product = await newProduct('Хуудаслалт архив');
      const near = addDays(today, -20);
      const far = addDays(today, -40);
      const rows: ItemJson[] = [];
      for (const date of [far, near, near, far, near]) {
        const row = await record(product.id, date);
        await setStatus(row.id, 'ARCHIVED').expect(200);
        rows.push(row);
      }
      const expected = [...rows]
        .sort((a, b) => b.expiryDate.localeCompare(a.expiryDate) || b.id - a.id)
        .map((row) => row.id);
      for (const limit of [1, 2, 4]) {
        expect(
          (await walk({ productId: product.id, view: 'ARCHIVED' }, limit)).map((row) => row.id),
        ).toEqual(expected);
      }
    });

    it('refuses a cursor it did not make', async () => {
      for (const cursor of ['nonsense', Buffer.from('{"d":1,"i":"x"}').toString('base64url')]) {
        const refused = await http()
          .get('/api/v1/expiry/items')
          .query({ cursor })
          .set(bearer(staff))
          .expect(422);
        expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      }
    });

    it('filters by name, code and barcode, and answers no rows when nothing matches', async () => {
      const matched = await newProduct('Зөгийн бал савтай', { baseBarcodes: ['036000291452'] });
      const other = await newProduct('Давс');
      const row = await record(matched.id, addDays(today, 300));
      await record(other.id, addDays(today, 300));
      const idsOf = async (q: string) => (await walk({ q }, 50)).map((item) => item.id);
      expect(await idsOf('зөгийн')).toEqual([row.id]);
      expect(await idsOf(matched.sku)).toEqual([row.id]);
      expect(await idsOf('036000291452')).toEqual([row.id]);
      expect(await idsOf('оршдоггүй нэр')).toEqual([]);
      expect(await list({ q: 'оршдоггүй нэр' })).toEqual({ data: [], nextCursor: null });
    });

    it('finds an inactive product by text too', async () => {
      const product = await newProduct('Зогссон жимс');
      const row = await record(product.id, addDays(today, 301));
      await sql.query(`UPDATE products SET status = 'INACTIVE' WHERE id = $1`, [product.id]);
      expect((await list({ q: 'зогссон' })).data.map((item) => item.id)).toEqual([row.id]);
    });

    it('filters by the main supplier and the home warehouse, read live', async () => {
      const partners = partnersApi(app, admin);
      const alpha = await partners.supplier({ name: 'Альфа Хангамж', phone: '99110001' });
      const beta = await partners.supplier({ name: 'Бета Хангамж', phone: '99110002' });
      const inventory = inventoryApi(app, admin);
      const north = await inventory.warehouse('EXPN');
      const south = await inventory.warehouse('EXPS');
      const first = await newProduct('Нийлүүлэгчтэй нэг');
      const second = await newProduct('Нийлүүлэгчтэй хоёр');
      const link = (productId: number, supplierId: number) =>
        http()
          .post('/api/v1/product-suppliers')
          .set(bearer(admin))
          .send({ productId, supplierId })
          .expect(201);
      await link(first.id, alpha.id);
      await link(second.id, beta.id);
      // Alpha also delivers the second product, but Beta stays its main supplier.
      await link(second.id, alpha.id);
      await inventory.setHome(first.id, north.id);
      await inventory.setHome(second.id, south.id);
      const firstRow = await record(first.id, addDays(today, 400));
      const secondRow = await record(second.id, addDays(today, 400));

      expect(firstRow.supplier).toEqual({ id: alpha.id, name: 'Альфа Хангамж' });
      expect(firstRow.homeWarehouse).toEqual({ id: north.id, name: `Агуулах EXPN` });
      const idsOf = async (query: Record<string, unknown>) =>
        (await walk(query, 50)).map((item) => item.id);
      expect(await idsOf({ supplierId: alpha.id })).toEqual([firstRow.id]);
      expect(await idsOf({ supplierId: beta.id })).toEqual([secondRow.id]);
      expect(await idsOf({ warehouseId: north.id })).toEqual([firstRow.id]);
      expect(await idsOf({ warehouseId: south.id })).toEqual([secondRow.id]);
      expect(await idsOf({ supplierId: alpha.id, warehouseId: south.id })).toEqual([]);
      expect(await idsOf({ supplierId: 99_999_999 })).toEqual([]);
      expect(await idsOf({ supplierId: alpha.id, q: 'нэг' })).toEqual([firstRow.id]);
      expect(await idsOf({ supplierId: alpha.id, q: 'хоёр' })).toEqual([]);
      expect(await idsOf({ supplierId: alpha.id, view: 'ARCHIVED' })).toEqual([]);

      // The home warehouse is read live: nothing is copied onto the record.
      await inventory.setHome(first.id, south.id);
      expect((await getItem(firstRow.id)).homeWarehouse?.id).toBe(south.id);
      expect(await idsOf({ warehouseId: north.id })).toEqual([]);
      await inventory.setHome(first.id, north.id);

      // What the list answers the filter route offers, sorted by name.
      const filters = (await http().get('/api/v1/expiry/filters').set(bearer(staff)).expect(200))
        .body as {
        suppliers: { id: number; name: string }[];
        warehouses: { id: number; name: string }[];
        creators: string[];
      };
      expect(filters.suppliers.map((row) => row.id)).toEqual(expect.arrayContaining([alpha.id]));
      expect(filters.warehouses).toEqual(
        expect.arrayContaining([{ id: north.id, name: 'Агуулах EXPN' }]),
      );
      const names = filters.suppliers.map((row) => row.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'mn')));
      expect(filters.creators).toEqual(expect.arrayContaining(['Туршилт Ажилтан']));

      const archivedFilters = (
        await http()
          .get('/api/v1/expiry/filters')
          .query({ view: 'ARCHIVED' })
          .set(bearer(staff))
          .expect(200)
      ).body as { suppliers: { id: number }[]; warehouses: { id: number }[] };
      expect(archivedFilters.suppliers.map((row) => row.id)).not.toContain(alpha.id);
      expect(archivedFilters.warehouses.map((row) => row.id)).not.toContain(north.id);
    });

    it('filters by author and by liability', async () => {
      const product = await newProduct('Зохиогч шалгалт');
      const mine = await record(product.id, addDays(today, 500));
      const carried = (
        await carry({
          legacyId: 880_001,
          productId: product.id,
          expiryDate: addDays(today, 501),
          qtyFloor: '1',
          qtyWarehouse: '0',
          status: 'REVIEW',
          liabilityType: 'ALL_STAFF',
          liabilityRoleIds: [],
          liabilityUserIds: [],
          createdAt: '2026-03-05T04:10:00Z',
          createdByName: OLD_AUTHOR,
          history: [],
        }).expect(201)
      ).body as { id: number };
      const idsOf = async (query: Record<string, unknown>) =>
        (await walk({ productId: product.id, ...query }, 50)).map((item) => item.id);
      expect(await idsOf({ createdByName: OLD_AUTHOR })).toEqual([carried.id]);
      expect(await idsOf({ createdByName: 'Туршилт Ажилтан' })).toEqual([mine.id]);
      expect(await idsOf({ createdByName: 'хэн ч биш' })).toEqual([]);
      expect(await idsOf({ liability: 'ALL_STAFF' })).toEqual([carried.id]);
      expect(await idsOf({ liability: 'NONE' })).toEqual([mine.id]);
      expect(await idsOf({ liability: 'SPECIFIC' })).toEqual([]);
      await http()
        .get('/api/v1/expiry/items')
        .query({ liability: 'SOMEONE' })
        .set(bearer(staff))
        .expect(422);
      const filters = (await http().get('/api/v1/expiry/filters').set(bearer(staff)).expect(200))
        .body as { creators: string[] };
      expect(filters.creators).toEqual(expect.arrayContaining([OLD_AUTHOR]));
    });
  });

  describe('the summary', () => {
    it('counts open records by date and every record by status', async () => {
      const before = await summary();
      expect(before).toMatchObject({ today, soonDays: 30, urgentDays: 7 });
      const product = await newProduct('Тоо шалгалт');
      await record(product.id, addDays(today, -1)); // expired
      await record(product.id, today); // urgent and soon
      await record(product.id, addDays(today, 7)); // urgent and soon
      await record(product.id, addDays(today, 8)); // soon
      await record(product.id, addDays(today, 30)); // soon
      await record(product.id, addDays(today, 31));
      const inCity = await record(product.id, addDays(today, -5)); // expired
      const onSale = await record(product.id, addDays(today, 2)); // urgent and soon
      const gone = await record(product.id, addDays(today, -9)); // archived
      await setStatus(inCity.id, 'CITY_RETURN').expect(200);
      await setStatus(onSale.id, 'INTERNAL_SALE').expect(200);
      await setStatus(gone.id, 'ARCHIVED').expect(200);
      const after = await summary();
      expect(after).toEqual({
        ...before,
        active: before.active + 8,
        expired: before.expired + 2,
        urgent: before.urgent + 3,
        soon: before.soon + 5,
        archived: before.archived + 1,
        byStatus: {
          REVIEW: before.byStatus.REVIEW + 6,
          CITY_RETURN: before.byStatus.CITY_RETURN + 1,
          INTERNAL_SALE: before.byStatus.INTERNAL_SALE + 1,
        },
      });
    });
  });

  describe('correcting', () => {
    it('refuses a stale version and tells which one stands', async () => {
      const row = await record((await newProduct('Хувилбар')).id, addDays(today, 15));
      await patch(row.id, { expectedVersion: 1, qtyFloor: '5' }).expect(200);
      const refused = await patch(row.id, { expectedVersion: 1, qtyFloor: '6' }).expect(409);
      expect(refused.body).toMatchObject({
        code: 'EXPIRY_ITEM_CHANGED',
        params: { currentVersion: 2 },
      });
      expect((await getItem(row.id)).qtyFloor).toBe('5');
    });

    it('changes nothing when asked for what already stands', async () => {
      const row = await record((await newProduct('Хоосон засвар')).id, addDays(today, 15), {
        qtyFloor: '3',
        qtyWarehouse: '4',
        note: 'тэмдэглэл',
      });
      for (const body of [
        { expectedVersion: 1 },
        {
          expectedVersion: 1,
          expiryDate: row.expiryDate,
          qtyFloor: '3.000',
          qtyWarehouse: '4',
          note: ' тэмдэглэл ',
        },
      ]) {
        const same = (await patch(row.id, body).expect(200)).body as ItemJson;
        expect(same).toEqual(row);
      }
      expect(await history(row.id)).toHaveLength(1);
      expect(await auditActions(row.id)).toEqual(['CREATE']);
      const { rows } = await sql.query<{ updated_by: string }>(
        'SELECT updated_by::text FROM expiry_items WHERE id = $1',
        [row.id],
      );
      expect(rows[0]?.updated_by).toBe(String(staffId));
    });

    it('adds a history row only when a quantity changed, with both old and new values', async () => {
      const editor = await seedUser(app);
      await http()
        .patch(`/api/v1/users/${editor.id}`)
        .set(bearer(admin))
        .send({ fullName: 'Засварын Ажилтан' })
        .expect(200);
      const token = (await login(app, editor)).accessToken;
      const row = await record((await newProduct('Түүх шалгалт')).id, addDays(today, 15), {
        qtyFloor: '10',
        qtyWarehouse: '20',
      });
      // A date or a note bumps the version but is no quantity change.
      const dated = (
        await patch(row.id, {
          expectedVersion: 1,
          expiryDate: addDays(today, 16),
          note: 'огноог зассан',
        }).expect(200)
      ).body as ItemJson;
      expect(dated).toMatchObject({
        expiryDate: addDays(today, 16),
        daysLeft: 16,
        note: 'огноог зассан',
        editVersion: 2,
      });
      expect(await history(row.id)).toHaveLength(1);

      const counted = (
        await patch(row.id, { expectedVersion: 2, qtyFloor: '7' }, token).expect(200)
      ).body as ItemJson;
      expect(counted).toMatchObject({
        qtyFloor: '7',
        qtyWarehouse: '20',
        qtyTotal: '27',
        editVersion: 3,
      });
      const rows = await history(row.id);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        kind: 'UPDATE',
        qtyFloorOld: '10',
        qtyFloorNew: '7',
        qtyWarehouseOld: '20',
        qtyWarehouseNew: '20',
        changedByName: 'Засварын Ажилтан',
      });
      expect(rows[0]?.kind).toBe('CREATE');

      // An empty note clears it; a later edit may bring both quantities to zero.
      const emptied = (
        await patch(row.id, {
          expectedVersion: 3,
          qtyFloor: '0',
          qtyWarehouse: '0',
          note: '   ',
        }).expect(200)
      ).body as ItemJson;
      expect(emptied).toMatchObject({ qtyTotal: '0', note: null, editVersion: 4 });
      expect(await history(row.id)).toHaveLength(3);
      expect(await auditActions(row.id)).toEqual(['CREATE', 'UPDATE', 'UPDATE', 'UPDATE']);
    });

    it('applies the date range and the whole-number rule to what changes only', async () => {
      const row = await record((await newProduct('Зөвхөн өөрчлөгдсөн')).id, addDays(today, 15));
      await patch(row.id, { expectedVersion: 1, expiryDate: '2000-01-01' }).expect(422);
      await patch(row.id, { expectedVersion: 1, qtyFloor: '1.5' }).expect(422);
      // A carried row outside the rules can still have its other fields corrected.
      const product = await newProduct('Хуучин бутархай');
      const carried = (
        await carry({
          legacyId: 880_002,
          productId: product.id,
          expiryDate: '2010-05-05',
          qtyFloor: '1.5',
          qtyWarehouse: '0',
          status: 'REVIEW',
          liabilityType: 'NONE',
          liabilityRoleIds: [],
          liabilityUserIds: [],
          createdAt: '2026-03-05T04:10:00Z',
          createdByName: OLD_AUTHOR,
          history: [],
        }).expect(201)
      ).body as { id: number };
      const corrected = (
        await patch(carried.id, {
          expectedVersion: 1,
          expiryDate: '2010-05-05',
          qtyFloor: '1.5',
          qtyWarehouse: '4',
        }).expect(200)
      ).body as ItemJson;
      expect(corrected).toMatchObject({ qtyFloor: '1.5', qtyWarehouse: '4', editVersion: 2 });
    });

    it('answers 404 for a record that does not exist', async () => {
      await patch(99_999_999, { expectedVersion: 1 }).expect(404);
      await http().get('/api/v1/expiry/items/99999999').set(bearer(staff)).expect(404);
      await http().get('/api/v1/expiry/items/99999999/history').set(bearer(staff)).expect(404);
    });
  });

  describe('status', () => {
    it('archives and restores, filling and clearing who and when', async () => {
      const row = await record((await newProduct('Архив шалгалт')).id, addDays(today, 15));
      const archived = (await setStatus(row.id, 'ARCHIVED').expect(200)).body as ItemJson;
      expect(archived.status).toBe('ARCHIVED');
      expect(archived.archivedAt).not.toBeNull();
      expect(archived.archivedByName).toBe('Тест хэрэглэгч');

      const restored = (await setStatus(row.id, 'REVIEW').expect(200)).body as ItemJson;
      expect(restored).toMatchObject({
        status: 'REVIEW',
        archivedAt: null,
        archivedByName: null,
      });
      const { rows } = await sql.query<{ archived_by: string | null }>(
        'SELECT archived_by::text FROM expiry_items WHERE id = $1',
        [row.id],
      );
      expect(rows[0]?.archived_by).toBeNull();
      expect(await auditActions(row.id)).toEqual(['CREATE', 'ARCHIVE', 'UNARCHIVE']);
    });

    it('moves between the open statuses, and asks for what stands without a write', async () => {
      const row = await record((await newProduct('Төлөв солих')).id, addDays(today, 15));
      for (const status of ['CITY_RETURN', 'INTERNAL_SALE', 'REVIEW']) {
        const changed = (await setStatus(row.id, status).expect(200)).body as ItemJson;
        expect(changed).toMatchObject({ status, archivedAt: null });
      }
      await setStatus(row.id, 'REVIEW').expect(200);
      expect(await auditActions(row.id)).toEqual(['CREATE', 'UPDATE', 'UPDATE', 'UPDATE']);
      await setStatus(row.id, 'GONE').expect(422);
    });

    it('does not refuse a count in progress: a status change leaves the version', async () => {
      const row = await record((await newProduct('Тоо явж байна')).id, addDays(today, 15));
      await setStatus(row.id, 'CITY_RETURN').expect(200);
      const counted = (await patch(row.id, { expectedVersion: 1, qtyFloor: '9' }).expect(200))
        .body as ItemJson;
      expect(counted).toMatchObject({ status: 'CITY_RETURN', qtyFloor: '9', editVersion: 2 });
    });

    it('keeps an archived record read-only until it is restored, which means REVIEW', async () => {
      const row = await record((await newProduct('Уншихад л')).id, addDays(today, 15));
      await setStatus(row.id, 'ARCHIVED').expect(200);
      const refused = await patch(row.id, { expectedVersion: 1, qtyFloor: '2' }).expect(409);
      expect(refused.body).toMatchObject({ code: 'EXPIRY_ITEM_ARCHIVED' });
      const notRestored = await setStatus(row.id, 'CITY_RETURN').expect(409);
      expect(notRestored.body).toMatchObject({ code: 'EXPIRY_ITEM_ARCHIVED' });
      await setStatus(row.id, 'REVIEW').expect(200);
      await patch(row.id, { expectedVersion: 1, qtyFloor: '2' }).expect(200);
    });
  });

  describe('liability', () => {
    it('stores a specific liability whole, and replaces it whole', async () => {
      const options = (
        await http().get('/api/v1/expiry/liability-options').set(bearer(liable)).expect(200)
      ).body as {
        roles: { id: number; code: string | null; name: string | null }[];
        users: { id: number; fullName: string }[];
      };
      const hr = options.roles.find((role) => role.code === 'HR');
      const cashier = options.roles.find((role) => role.code === 'POS_CASHIER');
      if (!hr || !cashier) throw new Error('no system roles');
      expect(hr.name).toBeNull();
      expect(options.users).toEqual(
        expect.arrayContaining([{ id: staffId, fullName: 'Туршилт Ажилтан' }]),
      );
      const disabled = await seedUser(app, { status: 'DISABLED' });
      const again = (
        await http().get('/api/v1/expiry/liability-options').set(bearer(liable)).expect(200)
      ).body as { users: { id: number }[] };
      expect(again.users.map((user) => user.id)).not.toContain(disabled.id);

      const row = await record((await newProduct('Хариуцлага')).id, addDays(today, 15));
      const set = (
        await setLiability(row.id, {
          type: 'SPECIFIC',
          roleIds: [hr.id],
          userIds: [staffId, staffId],
          note: ' цалингаас ',
        }).expect(200)
      ).body as ItemJson;
      expect(set.liability).toEqual({
        type: 'SPECIFIC',
        roles: [{ id: hr.id, code: 'HR', name: null }],
        users: [{ id: staffId, fullName: 'Туршилт Ажилтан' }],
        note: 'цалингаас',
      });
      expect(set.editVersion).toBe(1);

      const replaced = (
        await setLiability(row.id, {
          type: 'SPECIFIC',
          roleIds: [cashier.id],
          userIds: [],
        }).expect(200)
      ).body as ItemJson;
      expect(replaced.liability).toEqual({
        type: 'SPECIFIC',
        roles: [{ id: cashier.id, code: 'POS_CASHIER', name: null }],
        users: [],
        note: null,
      });
      expect((await getItem(row.id)).liability).toEqual(replaced.liability);

      // The same again writes nothing.
      const audited = (await auditActions(row.id)).length;
      await setLiability(row.id, {
        type: 'SPECIFIC',
        roleIds: [cashier.id],
        userIds: [],
      }).expect(200);
      expect(await auditActions(row.id)).toHaveLength(audited);
    });

    it('needs a role or a person when specific, and only ones that exist', async () => {
      const row = await record((await newProduct('Хоосон хариуцлага')).id, addDays(today, 15));
      await setLiability(row.id, { type: 'SPECIFIC', roleIds: [], userIds: [] }).expect(422);
      await setLiability(row.id, {
        type: 'SPECIFIC',
        roleIds: [99_999],
        userIds: [],
      }).expect(422);
      await setLiability(row.id, {
        type: 'SPECIFIC',
        roleIds: [],
        userIds: [99_999_999],
      }).expect(422);
      await setLiability(row.id, { type: 'BOSS', roleIds: [], userIds: [] }).expect(422);
      expect((await getItem(row.id)).liability.type).toBe('NONE');
    });

    it('stores nobody for all staff or none, and none leaves no note', async () => {
      const row = await record((await newProduct('Бүгд хариуцна')).id, addDays(today, 15));
      await setLiability(row.id, {
        type: 'SPECIFIC',
        roleIds: [],
        userIds: [staffId],
        note: 'анхны',
      }).expect(200);
      const everyone = (
        await setLiability(row.id, {
          type: 'ALL_STAFF',
          roleIds: [],
          userIds: [staffId],
          note: 'бүгдээс',
        }).expect(200)
      ).body as ItemJson;
      expect(everyone.liability).toEqual({
        type: 'ALL_STAFF',
        roles: [],
        users: [],
        note: 'бүгдээс',
      });
      const none = (
        await setLiability(row.id, {
          type: 'NONE',
          roleIds: [],
          userIds: [],
          note: 'үлдэхгүй',
        }).expect(200)
      ).body as ItemJson;
      expect(none.liability).toEqual({ type: 'NONE', roles: [], users: [], note: null });
    });

    it('is allowed on an archived record', async () => {
      const row = await record((await newProduct('Архивын хариуцлага')).id, addDays(today, 15));
      await setStatus(row.id, 'ARCHIVED').expect(200);
      await setLiability(row.id, {
        type: 'SPECIFIC',
        roleIds: [],
        userIds: [staffId],
      }).expect(200);
    });
  });

  describe('rights', () => {
    it('lets a staff member with no rights read, record and correct, and nothing more', async () => {
      const row = await record((await newProduct('Эрхгүй ажилтан')).id, addDays(today, 15));
      await patch(row.id, { expectedVersion: 1, qtyFloor: '2' }).expect(200);
      const reads = [
        '/api/v1/expiry/items',
        '/api/v1/expiry/summary',
        '/api/v1/expiry/filters',
        '/api/v1/expiry/attention',
        `/api/v1/expiry/items/${row.id}`,
        `/api/v1/expiry/items/${row.id}/history`,
      ];
      for (const path of reads) await http().get(path).set(bearer(staff)).expect(200);

      await setStatus(row.id, 'ARCHIVED', staff).expect(403);
      await setLiability(row.id, { type: 'NONE', roleIds: [], userIds: [] }, staff).expect(403);
      await http().get('/api/v1/expiry/liability-options').set(bearer(staff)).expect(403);
      await carry({}, staff).expect(403);
    });

    it('takes each decision by its own right', async () => {
      const row = await record((await newProduct('Эрх салгах')).id, addDays(today, 15));
      await setStatus(row.id, 'CITY_RETURN', manager).expect(200);
      await setLiability(row.id, { type: 'ALL_STAFF', roleIds: [], userIds: [] }, manager).expect(
        403,
      );
      await http().get('/api/v1/expiry/liability-options').set(bearer(manager)).expect(403);
      await setStatus(row.id, 'INTERNAL_SALE', liable).expect(403);
      await setLiability(row.id, { type: 'ALL_STAFF', roleIds: [], userIds: [] }, liable).expect(
        200,
      );
      await carry({}, manager).expect(403);
    });

    it('gives the system roles what the ADR says', async () => {
      const row = await record((await newProduct('Системийн дүр')).id, addDays(today, 15));
      const tokenOf = async (role: string) =>
        (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
      for (const role of [
        'OFFICE',
        'PROCUREMENT',
        'WAREHOUSE',
        'ACCOUNTANT',
        'POS_SUPERVISOR',
      ] as const) {
        await setStatus(row.id, 'ARCHIVED', await tokenOf(role)).expect(200);
        await setStatus(row.id, 'REVIEW', manager).expect(200);
      }
      for (const role of ['HR', 'POS_CASHIER', 'SALES_REP', 'DRIVER'] as const) {
        await setStatus(row.id, 'ARCHIVED', await tokenOf(role)).expect(403);
      }
      // Resolve each token first: a nested request would close the shared server under this one.
      const options = (token: string) =>
        http().get('/api/v1/expiry/liability-options').set(bearer(token));
      for (const role of ['ACCOUNTANT', 'HR'] as const) {
        const token = await tokenOf(role);
        await options(token).expect(200);
      }
      for (const role of ['OFFICE', 'WAREHOUSE', 'POS_SUPERVISOR', 'DRIVER'] as const) {
        const token = await tokenOf(role);
        await options(token).expect(403);
      }
      const accountant = await tokenOf('ACCOUNTANT');
      await carry({}, accountant).expect(403);
    });

    it('refuses a customer token and a request with none', async () => {
      const row = await record((await newProduct('Харилцагч')).id, addDays(today, 15));
      await http().get('/api/v1/expiry/items').set(bearer(store.token)).expect(403);
      await http().get(`/api/v1/expiry/items/${row.id}`).set(bearer(store.token)).expect(403);
      await post({ productId: row.product.id }, store.token).expect(403);
      await patch(row.id, { expectedVersion: 1 }, store.token).expect(403);
      await setStatus(row.id, 'ARCHIVED', store.token).expect(403);
      await http().get('/api/v1/expiry/items').expect(401);
    });
  });

  describe('home tiles', () => {
    it('answers zeros without the right and counts with it, up to the cap', async () => {
      const attention = async (token: string) =>
        (await http().get('/api/v1/expiry/attention').set(bearer(token)).expect(200)).body as {
          expired: number;
          dueSoon: number;
          cap: number;
        };
      const product = await newProduct('Анхаарал');
      const before = await attention(manager);
      await record(product.id, addDays(today, -1));
      await record(product.id, today);
      await record(product.id, addDays(today, 7));
      await record(product.id, addDays(today, 8));
      const gone = await record(product.id, addDays(today, -2));
      await setStatus(gone.id, 'ARCHIVED').expect(200);

      expect(await attention(staff)).toEqual({ expired: 0, dueSoon: 0, cap: 100 });
      const after = await attention(manager);
      expect(after.expired - before.expired).toBe(1);
      expect(after.dueSoon - before.dueSoon).toBe(2);
      await sql.query(
        `INSERT INTO expiry_items (product_id, expiry_date, qty_floor, created_by_name)
         SELECT $1::bigint, (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date - 3, 1, 'тест'
           FROM generate_series(1, 101)`,
        [product.id],
      );
      expect((await attention(manager)).expired).toBe(100);
    });
  });

  describe('carrying old records', () => {
    let product: ProductJson;
    let nextLegacy = 900_000;

    const oldRecord = (legacyId: number, extra: Record<string, unknown> = {}) => ({
      legacyId,
      productId: product.id,
      expiryDate: '2012-03-01',
      qtyFloor: '2.5',
      qtyWarehouse: '0',
      status: 'REVIEW',
      liabilityType: 'NONE',
      liabilityRoleIds: [],
      liabilityUserIds: [],
      note: 'хуучин тэмдэглэл',
      createdAt: '2026-03-05T04:10:00Z',
      createdByName: OLD_AUTHOR,
      history: [
        {
          legacyId: legacyId * 10,
          kind: 'CREATE',
          qtyFloorOld: '2.5',
          qtyFloorNew: '2.5',
          qtyWarehouseOld: '0',
          qtyWarehouseNew: '0',
          changedAt: '2026-03-05T04:10:00Z',
          changedByName: OLD_AUTHOR,
        },
      ],
      ...extra,
    });
    const change = (legacyId: number, qtyFloorOld: string, qtyFloorNew: string) => ({
      legacyId,
      kind: 'UPDATE',
      qtyFloorOld,
      qtyFloorNew,
      qtyWarehouseOld: '0',
      qtyWarehouseNew: '0',
      changedAt: '2026-04-05T04:10:00Z',
      changedByName: 'хуучин.менежер',
    });
    const legacy = () => {
      nextLegacy += 1;
      return nextLegacy;
    };
    const carried = async (body: Record<string, unknown>, token = admin) =>
      (await carry(body, token).expect(201)).body as { id: number; outcome: string };

    beforeAll(async () => {
      product = await newProduct('Хуучин системийн бараа');
    });

    it('creates what the ordinary routes refuse, keeping the old author and dates', async () => {
      const id = legacy();
      const result = await carried(oldRecord(id));
      expect(result.outcome).toBe('CREATED');
      const row = await getItem(result.id);
      expect(row).toMatchObject({
        expiryDate: '2012-03-01',
        qtyFloor: '2.5',
        status: 'REVIEW',
        note: 'хуучин тэмдэглэл',
        editVersion: 1,
        createdAt: '2026-03-05T04:10:00.000Z',
        createdByName: OLD_AUTHOR,
        updatedAt: '2026-03-05T04:10:00.000Z',
      });
      expect(await history(result.id)).toEqual([
        expect.objectContaining({
          kind: 'CREATE',
          changedAt: '2026-03-05T04:10:00.000Z',
          changedByName: OLD_AUTHOR,
        }),
      ]);
      // The old author belongs to no Bto user, and the row stays untouched in Bto.
      const { rows } = await sql.query<Record<string, unknown>>(
        `SELECT i.created_by, i.updated_by, c.changed_by
           FROM expiry_items i JOIN expiry_item_changes c ON c.item_id = i.id WHERE i.id = $1`,
        [result.id],
      );
      expect(rows).toEqual([{ created_by: null, updated_by: null, changed_by: null }]);
      // Both quantities at zero and a duplicate of an open pair pass too.
      const zero = await carried(oldRecord(legacy(), { qtyFloor: '0', history: [] }));
      expect(zero.outcome).toBe('CREATED');
      expect((await getItem(zero.id)).qtyTotal).toBe('0');
    });

    it('answers UNCHANGED for the same row and writes nothing', async () => {
      const id = legacy();
      const first = await carried(oldRecord(id));
      const audited = await auditActions(first.id);
      const again = await carried(oldRecord(id));
      expect(again).toEqual({ id: first.id, outcome: 'UNCHANGED' });
      expect(await history(first.id)).toHaveLength(1);
      expect(await auditActions(first.id)).toEqual(audited);
    });

    it('replays a retry of one request, and refuses its key on another body', async () => {
      const id = legacy();
      const key = idempotency();
      const first = await carry(oldRecord(id), admin, key).expect(201);
      const retry = await carry(oldRecord(id), admin, key).expect(201);
      expect(retry.body).toEqual(first.body);
      await carry(oldRecord(id, { qtyFloor: '9' }), admin, key).expect(409);
    });

    it('refreshes a row nobody touched in Bto and appends the old change', async () => {
      const id = legacy();
      const first = await carried(oldRecord(id));
      const update = await carried(
        oldRecord(id, {
          qtyFloor: '1',
          note: 'шинэ тэмдэглэл',
          history: [oldRecord(id).history[0], change(id * 10 + 1, '2.5', '1')],
        }),
      );
      expect(update).toEqual({ id: first.id, outcome: 'UPDATED' });
      const row = await getItem(first.id);
      // A screen holding the older values is refused, not overwritten.
      expect(row).toMatchObject({ qtyFloor: '1', note: 'шинэ тэмдэглэл', editVersion: 2 });
      const rows = await history(first.id);
      expect(rows.map((item) => [item.kind, item.qtyFloorNew, item.changedByName])).toEqual([
        ['CREATE', '2.5', OLD_AUTHOR],
        ['UPDATE', '1', 'хуучин.менежер'],
      ]);
      const { rows: stored } = await sql.query<{ updated_by: string | null }>(
        'SELECT updated_by::text FROM expiry_items WHERE id = $1',
        [first.id],
      );
      expect(stored[0]?.updated_by).toBeNull();

      // A status or author difference alone refreshes it too, leaving the version.
      const moved = await carried(
        oldRecord(id, {
          qtyFloor: '1',
          note: 'шинэ тэмдэглэл',
          createdByName: 'өөр.хүн',
          status: 'CITY_RETURN',
          history: [],
        }),
      );
      expect(moved.outcome).toBe('UPDATED');
      expect(await getItem(first.id)).toMatchObject({
        status: 'CITY_RETURN',
        createdByName: 'өөр.хүн',
        editVersion: 2,
      });
      // The history is never replaced: leaving it out of a later run removes nothing.
      expect(await history(first.id)).toHaveLength(2);
      const audited = await auditActions(first.id);
      expect(audited).toEqual(['IMPORT', 'IMPORT', 'IMPORT']);
    });

    it('leaves a touched row alone and still appends old changes', async () => {
      const id = legacy();
      const first = await carried(oldRecord(id));
      await patch(first.id, { expectedVersion: 1, qtyWarehouse: '6' }).expect(200);
      const kept = await carried(
        oldRecord(id, {
          qtyFloor: '100',
          history: [oldRecord(id).history[0], change(id * 10 + 1, '2.5', '100')],
        }),
      );
      expect(kept).toEqual({ id: first.id, outcome: 'KEPT' });
      expect(await getItem(first.id)).toMatchObject({
        qtyFloor: '2.5',
        qtyWarehouse: '6',
        editVersion: 2,
      });
      const rows = await history(first.id);
      expect(rows.map((item) => item.changedByName)).toEqual(
        expect.arrayContaining(['хуучин.менежер', 'Туршилт Ажилтан', OLD_AUTHOR]),
      );
      expect(rows).toHaveLength(3);
      // Nothing new: no write at all.
      const audited = await auditActions(first.id);
      const again = await carried(
        oldRecord(id, {
          qtyFloor: '100',
          history: [oldRecord(id).history[0], change(id * 10 + 1, '2.5', '100')],
        }),
      );
      expect(again.outcome).toBe('KEPT');
      expect(await history(first.id)).toHaveLength(3);
      expect(await auditActions(first.id)).toEqual(audited);
    });

    it('treats a status or liability decision as a touch', async () => {
      const decided = await carried(oldRecord(legacy()));
      await setStatus(decided.id, 'CITY_RETURN').expect(200);
      const id = legacy();
      const assigned = await carried(oldRecord(id));
      await setLiability(assigned.id, { type: 'ALL_STAFF', roleIds: [], userIds: [] }).expect(200);
      expect((await carried(oldRecord(id, { qtyFloor: '3' }))).outcome).toBe('KEPT');
      expect((await getItem(assigned.id)).qtyFloor).toBe('2.5');
    });

    it('keeps an archived old record with its old archiver', async () => {
      const result = await carried(
        oldRecord(legacy(), {
          status: 'ARCHIVED',
          archivedAt: '2026-05-05T04:10:00+08:00',
          archivedByName: 'хуучин.архивч',
        }),
      );
      expect(await getItem(result.id)).toMatchObject({
        status: 'ARCHIVED',
        archivedAt: '2026-05-04T20:10:00.000Z',
        archivedByName: 'хуучин.архивч',
      });
      const { rows } = await sql.query<{ archived_by: string | null }>(
        'SELECT archived_by::text FROM expiry_items WHERE id = $1',
        [result.id],
      );
      expect(rows[0]?.archived_by).toBeNull();
      // An old row archived without a time takes its creation's, and an open one holds none.
      const undated = await carried(oldRecord(legacy(), { status: 'ARCHIVED' }));
      expect((await getItem(undated.id)).archivedAt).toBe('2026-03-05T04:10:00.000Z');
      const open = await carried(
        oldRecord(legacy(), { archivedAt: '2026-05-05T04:10:00Z', archivedByName: 'хэн нэгэн' }),
      );
      expect(await getItem(open.id)).toMatchObject({ archivedAt: null, archivedByName: null });
    });

    it('carries a liability with its people, and a note for those without a match', async () => {
      const result = await carried(
        oldRecord(legacy(), {
          liabilityType: 'SPECIFIC',
          liabilityRoleIds: [],
          liabilityUserIds: [staffId],
          liabilityNote: 'хуучин дүр: ахлах',
        }),
      );
      expect((await getItem(result.id)).liability).toEqual({
        type: 'SPECIFIC',
        roles: [],
        users: [{ id: staffId, fullName: 'Туршилт Ажилтан' }],
        note: 'хуучин дүр: ахлах',
      });
      const noted = await carried(
        oldRecord(legacy(), {
          liabilityType: 'SPECIFIC',
          liabilityRoleIds: [],
          liabilityUserIds: [],
          liabilityNote: 'хуучин дүр: хянагч',
        }),
      );
      expect((await getItem(noted.id)).liability).toMatchObject({
        type: 'SPECIFIC',
        note: 'хуучин дүр: хянагч',
      });
      const stray = await carried(
        oldRecord(legacy(), { liabilityType: 'NONE', liabilityUserIds: [staffId] }),
      );
      expect((await getItem(stray.id)).liability.users).toEqual([]);
      await carry(
        oldRecord(legacy(), { liabilityType: 'SPECIFIC', liabilityUserIds: [99_999_999] }),
      ).expect(422);
    });

    it('refuses an unknown product and a time without a zone', async () => {
      await carry(oldRecord(legacy(), { productId: 99_999_999 })).expect(422);
      await carry(oldRecord(legacy(), { createdAt: '2026-03-05T04:10:00' })).expect(422);
      await carry(oldRecord(legacy(), { createdByName: '' })).expect(422);
    });

    it('audits under the person running the tool, never the old author', async () => {
      const result = await carried(oldRecord(legacy()));
      const { rows } = await sql.query<{ actor_kind: string; action: string }>(
        `SELECT actor_kind, action FROM audit_log WHERE entity = 'expiry_items' AND entity_id = $1`,
        [String(result.id)],
      );
      expect(rows).toEqual([{ actor_kind: 'STAFF', action: 'IMPORT' }]);
    });

    it('takes the route before a record’s own routes', async () => {
      await carry({}, staff).expect(403);
      const refused = await carry({}).expect(422);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      await http().get('/api/v1/expiry/items/carry').set(bearer(admin)).expect(400);
    });
  });

  describe('the database', () => {
    it('refuses deleting a record or rewriting its history for the app role', async () => {
      for (const table of ['expiry_items', 'expiry_item_changes']) {
        await expect(sql.query(`DELETE FROM ${table}`)).rejects.toMatchObject({ code: '42501' });
        await expect(sql.query(`TRUNCATE ${table} CASCADE`)).rejects.toMatchObject({
          code: '42501',
        });
      }
      await expect(
        sql.query(`UPDATE expiry_item_changes SET changed_by_name = 'x'`),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('holds the record’s own rules without the service', async () => {
      const product = await newProduct('Шалгуур');
      const insert = (columns: string, values: string) =>
        sql.query(
          `INSERT INTO expiry_items (product_id, expiry_date, created_by_name, ${columns})
           VALUES ($1, '2026-01-01', 'тест', ${values})`,
          [product.id],
        );
      await expect(insert('qty_floor', '-1')).rejects.toMatchObject({ code: '23514' });
      await expect(insert('status', `'GONE'`)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('liability_type', `'BOSS'`)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('status', `'ARCHIVED'`)).rejects.toMatchObject({ code: '23514' });
      await expect(insert('archived_at', 'now()')).rejects.toMatchObject({ code: '23514' });
      await expect(insert('note', `''`)).rejects.toMatchObject({ code: '23514' });
    });

    it('never moves stock', async () => {
      const { rows } = await sql.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM stock_ledger',
      );
      expect(rows[0]?.count).toBe('0');
      await expectReconciled(app);
    });
  });

  describe('the AI view', () => {
    it('repeats the days left as the service counts them, and leaves the liability out', async () => {
      const product = await newProduct('AI шалгалт');
      const past = await record(product.id, addDays(today, -4), {
        qtyFloor: '2',
        qtyWarehouse: '3',
      });
      const ahead = await record(product.id, addDays(today, 9));
      await setLiability(past.id, { type: 'ALL_STAFF', roleIds: [], userIds: [] }).expect(200);
      const { rows } = await reader.query<Record<string, unknown>>(
        'SELECT * FROM expiry_items WHERE product_id = $1 ORDER BY expiry_date',
        [product.id],
      );
      expect(rows.map((row) => row.days_left)).toEqual([past.daysLeft, ahead.daysLeft]);
      expect(rows[0]).toMatchObject({
        sku: product.sku,
        product_name: 'AI шалгалт',
        base_unit: 'ш',
        qty_floor: '2.000',
        qty_warehouse: '3.000',
        qty_total: '5.000',
        status: 'REVIEW',
        created_by_name: 'Туршилт Ажилтан',
      });
      expect(Object.keys(rows[0] ?? {}).filter((name) => /liab/i.test(name))).toEqual([]);
    });
  });
});
