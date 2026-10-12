import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { CustomersService } from '../../src/modules/partners';
import { connectAs, createHttpApp } from '../harness/apps';
import { codeOf, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

const UB = { lat: '47.918412', lng: '106.917712' };

/** Customers, their addresses, contacts and credit fields (SPEC §5.3, docs/modules/partners.md). */
describe('customers', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let accountant: string;
  let worker: string;
  let api: ReturnType<typeof partnersApi>;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    office = await token('OFFICE');
    accountant = await token('ACCOUNTANT');
    worker = await token('WAREHOUSE');
    api = partnersApi(app, admin);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('creates a company with its first address, allocating the next code under a lock', async () => {
    const first = await api.customer({
      code: '0099',
      name: '  Номин 15  ',
      regNo: ' 203 4567 ',
      tin: '123 456 789 01',
      phone: '9911 2233',
      address: { address: 'Баянзүрх, 15-р хороо', ...UB, note: 'Цэцэрлэгийн хажууд' },
    });
    expect(first).toMatchObject({
      code: '0099',
      name: 'Номин 15',
      regNo: '2034567',
      tin: '12345678901',
      tinSource: 'MANUAL',
      phone: '+97699112233',
      tinPending: false,
      creditLimit: null,
      paymentTerm: { days: null, source: 'UNSET' },
    });
    expect(first.addresses).toEqual([
      expect.objectContaining({ isDefault: true, gpsSource: 'OFFICE', lat: UB.lat, lng: UB.lng }),
    ]);
    const next = await http().get('/api/v1/customers/next-code').set(bearer(office)).expect(200);
    expect(next.body).toEqual({ code: '0100' });
    const second = await api.customer({ name: 'Номин 16' });
    expect(second.code).toBe('0100');
    expect(second.tinPending).toBe(true);

    const taken = await http()
      .post('/api/v1/customers')
      .set(bearer(admin))
      .set(idempotency())
      .send({ kind: 'COMPANY', code: '0099', name: 'Давхар' })
      .expect(409);
    expect(taken.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'customers_code_key' },
    });
  });

  it('applies the kind rules of TIN and consumer number and replays a retried create', async () => {
    const refused = async (body: Record<string, unknown>, path: string) => {
      const res = await http()
        .post('/api/v1/customers')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Шалгах', ...body })
        .expect(422);
      expect(res.body.errors).toEqual([expect.objectContaining({ path })]);
    };
    await refused({ kind: 'COMPANY', tin: '123456789012' }, 'tin');
    await refused({ kind: 'INDIVIDUAL', tin: '12345678901' }, 'tin');
    await refused({ kind: 'COMPANY', consumerNo: '11234567' }, 'consumerNo');
    await refused({ kind: 'INDIVIDUAL', consumerNo: '1123' }, 'consumerNo');
    await refused({ kind: 'COMPANY', phone: '12345' }, 'phone');
    await refused({ kind: 'COMPANY', address: { lat: '0', lng: '0' } }, 'lat');

    const citizen = await api.customer({
      kind: 'INDIVIDUAL',
      name: 'Бат',
      regNo: 'уб99010112',
      consumerNo: '1123 4567',
    });
    expect(citizen).toMatchObject({
      regNo: 'УБ99010112',
      consumerNo: '11234567',
      tinPending: false,
    });

    await http()
      .post('/api/v1/customers')
      .set(bearer(admin))
      .send({ kind: 'COMPANY', name: 'Түлхүүргүй' })
      .expect(400);
    const key = idempotency();
    const once = await http()
      .post('/api/v1/customers')
      .set(bearer(admin))
      .set(key)
      .send({ kind: 'COMPANY', name: 'Давтан' })
      .expect(201);
    const twice = await http()
      .post('/api/v1/customers')
      .set(bearer(admin))
      .set(key)
      .send({ kind: 'COMPANY', name: 'Давтан' })
      .expect(201);
    expect(twice.body.id).toBe(once.body.id);
  });

  it('lets office staff edit customers, the accountant credit terms, and hides customers from others', async () => {
    const shop = await api.customer({ name: 'Хүнсний дэлгүүр' });
    await http().get('/api/v1/customers').set(bearer(worker)).expect(403);
    await http().get(`/api/v1/customers/${shop.id}`).set(bearer(worker)).expect(403);
    await http()
      .patch(`/api/v1/customers/${shop.id}`)
      .set(bearer(office))
      .send({ phone: '88001122', vatPayer: true })
      .expect(200);
    const credit = {
      creditLimit: '5000000',
      paymentTermDays: null,
      creditHold: false,
      creditHoldReason: null,
    };
    await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(office))
      .send(credit)
      .expect(403);
    await http()
      .post('/api/v1/settings')
      .set(bearer(admin))
      .send({ key: 'credit.payment_term_days', value: 14, effectiveFrom: businessDate() })
      .expect(201);
    const set = await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(accountant))
      .send(credit)
      .expect(200);
    expect(set.body).toMatchObject({
      phone: '+97688001122',
      vatPayer: true,
      taxStatusSource: 'MANUAL',
      creditLimit: '5000000.00',
      paymentTerm: { days: 14, source: 'DEFAULT' },
    });
    const reason = await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(accountant))
      .send({ ...credit, creditHoldReason: 'Өр хэтэрсэн' })
      .expect(422);
    expect(reason.body.errors).toEqual([expect.objectContaining({ path: 'creditHoldReason' })]);
    const held = await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: null,
        paymentTermDays: 30,
        creditHold: true,
        creditHoldReason: 'Өр хэтэрсэн',
      })
      .expect(200);
    expect(held.body).toMatchObject({
      creditLimit: null,
      creditHold: true,
      paymentTerm: { days: 30, source: 'CUSTOMER' },
    });
    const audit = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'customers' AND entity_id = $1 ORDER BY id`,
      [String(shop.id)],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(['CREATE', 'UPDATE', 'CREDIT', 'CREDIT']);
  });

  it('searches names in either script, codes, phones, TINs and registration numbers', async () => {
    const coca = await api.customer({
      code: '5501',
      name: 'Кока кола дэлгүүр',
      phone: '99551100',
      tin: '55555555501',
      regNo: '5550001',
    });
    await api.customer({ code: '5502', name: 'Номин супермаркет' });
    const search = async (q: string) => {
      const res = await http()
        .get('/api/v1/customers')
        .query({ q })
        .set(bearer(office))
        .expect(200);
      return (res.body.data as CustomerJson[]).map((row) => row.code);
    };
    expect(await search('coca')).toEqual(['5501']);
    expect(await search('кока')).toEqual(['5501']);
    expect(await search('5501')).toEqual(['5501']);
    expect(await search('550')).toEqual(expect.arrayContaining(['5501', '5502']));
    expect(await search('9955 1100')).toEqual(['5501']);
    expect(await search('55555555501')).toEqual(['5501']);
    expect(await search('5550001')).toEqual(['5501']);
    expect(coca.code).toBe('5501');
  });

  it('filters by pending TIN, missing GPS and credit hold, a page at a time', async () => {
    for (let index = 0; index < 3; index += 1) {
      await api.customer({ code: `770${index}`, name: `Шүүлт ${index}` });
    }
    await api.customer({
      code: '7710',
      name: 'Шүүлт GPS',
      tin: '77777777701',
      address: { address: 'Хан-Уул', ...UB },
    });
    const list = async (query: Record<string, string>) =>
      (await http().get('/api/v1/customers').query(query).set(bearer(office)).expect(200)).body as {
        data: CustomerJson[];
        nextCursor: string | null;
      };
    const pending = await list({ q: 'Шүүлт', tinPending: 'true' });
    expect(pending.data.map((row) => row.code)).toEqual(['7700', '7701', '7702']);
    const noGps = await list({ q: 'Шүүлт', gpsMissing: 'true' });
    expect(noGps.data).toHaveLength(3);
    const first = await list({ q: 'Шүүлт', limit: '2' });
    expect(first.data).toHaveLength(2);
    const rest = await list({ q: 'Шүүлт', limit: '2', cursor: first.nextCursor ?? '' });
    expect([...first.data, ...rest.data].map((row) => row.code).sort()).toEqual([
      '7700',
      '7701',
      '7702',
      '7710',
    ]);
  });

  it('keeps one default address, archives instead of deleting and promotes the next one', async () => {
    const shop = await api.customer({ name: 'Хаягтай', address: { address: 'Эхний' } });
    const firstId = shop.addresses[0]?.id;
    const second = await http()
      .post(`/api/v1/customers/${shop.id}/addresses`)
      .set(bearer(office))
      .send({ address: 'Хоёр дахь', ...UB })
      .expect(201);
    expect(second.body).toMatchObject({ isDefault: false, gpsSource: 'OFFICE' });
    await http()
      .post(`/api/v1/customer-addresses/${second.body.id}/default`)
      .set(bearer(office))
      .expect(200);
    await http()
      .delete(`/api/v1/customer-addresses/${second.body.id}`)
      .set(bearer(office))
      .expect(204);
    const after = await api.getCustomer(shop.id);
    expect(after.addresses).toEqual([expect.objectContaining({ id: firstId, isDefault: true })]);
    const archived = await sql.query<{ archived: boolean }>(
      `SELECT archived_at IS NOT NULL AS archived FROM customer_addresses WHERE id = $1`,
      [second.body.id],
    );
    expect(archived.rows[0]?.archived).toBe(true);
    const outside = await http()
      .patch(`/api/v1/customer-addresses/${firstId}`)
      .set(bearer(office))
      .send({ lat: '39.9', lng: '116.4' })
      .expect(422);
    expect(outside.body.errors).toEqual([expect.objectContaining({ path: 'lat' })]);
  });

  it('keeps contacts with a name or a phone', async () => {
    const shop = await api.customer({ name: 'Холбоотой' });
    const contact = await http()
      .post(`/api/v1/customers/${shop.id}/contacts`)
      .set(bearer(office))
      .send({ name: 'Дорж', position: 'Эрхлэгч', phone: '9900-1122' })
      .expect(201);
    expect(contact.body).toMatchObject({ name: 'Дорж', phone: '+97699001122' });
    await http()
      .post(`/api/v1/customers/${shop.id}/contacts`)
      .set(bearer(office))
      .send({})
      .expect(422);
    await http()
      .patch(`/api/v1/customer-contacts/${contact.body.id}`)
      .set(bearer(office))
      .send({ name: null })
      .expect(200);
    await http()
      .delete(`/api/v1/customer-contacts/${contact.body.id}`)
      .set(bearer(office))
      .expect(204);
    expect((await api.getCustomer(shop.id)).contacts).toEqual([]);
  });

  it('serves other modules: active check, credit terms and the credit lock', async () => {
    const customers = app.get(CustomersService);
    const shop = await api.customer({ name: 'Модуль' });
    await http()
      .patch(`/api/v1/customers/${shop.id}`)
      .set(bearer(office))
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect(await codeOf(customers.assertActive(app.get<Db>(DB), shop.id))).toBe(
      'CUSTOMER_INACTIVE',
    );
    const terms = await customers.creditTerms(shop.id);
    expect(terms).toMatchObject({ creditLimit: null, creditHold: false });
    expect(terms.paymentTerm.source).toBe('DEFAULT');
  });

  it('gives each list row every field, the point of its default address and its first contact', async () => {
    interface ListRow {
      id: number;
      consumerNo: string | null;
      vatPayer: boolean;
      taxStatusSource: string | null;
      creditLimit: string | null;
      paymentTerm: { days: number | null; source: string };
      creditHold: boolean;
      creditHoldReason: string | null;
      note: string | null;
      gps: { lat: string; lng: string } | null;
      contact: { name: string | null; phone: string | null } | null;
    }
    const person = await api.customer({
      kind: 'INDIVIDUAL',
      name: 'Жагсаалтын иргэн',
      consumerNo: '11234567',
      note: 'Өглөө хүргэнэ',
      address: { address: 'Сансар', ...UB },
    });
    const shop = await api.customer({ name: 'Жагсаалтын дэлгүүр' });
    for (const name of ['Эхний хүн', 'Хоёр дахь хүн']) {
      await http()
        .post(`/api/v1/customers/${shop.id}/contacts`)
        .set(bearer(office))
        .send({ name, phone: '99001122' })
        .expect(201);
    }
    await http()
      .put(`/api/v1/customers/${shop.id}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: '2500000',
        paymentTermDays: 30,
        creditHold: true,
        creditHoldReason: 'Өр төлөөгүй',
      })
      .expect(200);

    const rows = (
      await http()
        .get('/api/v1/customers')
        .query({ q: 'Жагсаалтын', limit: 10 })
        .set(bearer(office))
        .expect(200)
    ).body.data as ListRow[];
    expect(rows.find((row) => row.id === person.id)).toMatchObject({
      consumerNo: '11234567',
      vatPayer: false,
      taxStatusSource: null,
      creditLimit: null,
      paymentTerm: { days: 14, source: 'DEFAULT' },
      note: 'Өглөө хүргэнэ',
      gps: UB,
      contact: null,
    });
    expect(rows.find((row) => row.id === shop.id)).toMatchObject({
      creditLimit: '2500000.00',
      paymentTerm: { days: 30, source: 'CUSTOMER' },
      creditHold: true,
      creditHoldReason: 'Өр төлөөгүй',
      gps: null,
      contact: { name: 'Эхний хүн', phone: '+97699001122' },
    });
  });
});
