import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { CustomersService, PartnersModule } from '../../src/modules/partners';
import { systemActor } from '../../src/modules/identity';
import { connectAs, createHttpApp, createWorker } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/**
 * Bto's side of the Finance Core (ADR-0084): the boot step books the installation into BO, a
 * customer's party follows it in the api and in the worker, and «Компани» reads and edits BO.
 */
describe('fin-bridge', () => {
  let app: NestExpressApplication;
  let admin: Client;
  let adminToken: string;
  let adminId: number;
  let branchIds: { active: number; closed: number };
  const http = () => request(app.getHttpServer());

  const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
    const { rows } = await admin.query(sql, params);
    return rows[0] as T;
  };
  const count = async (sql: string, params: unknown[] = []): Promise<number> =>
    Number.parseInt(
      (await one<{ n: string }>(`SELECT count(*)::text AS n FROM ${sql}`, params)).n,
      10,
    );
  const partyOf = (customerId: number) =>
    one<{
      kind: string;
      name: string;
      tin: string | null;
      register_no: string | null;
      companies: string;
    }>(
      `SELECT p.kind, p.name, p.tin, p.register_no,
              (SELECT string_agg(c.code, ',') FROM fin.party_companies pc
                 JOIN fin.companies c ON c.id = pc.company_id WHERE pc.party_id = p.id) AS companies
         FROM fin.party_refs r
         JOIN fin.source_systems s ON s.id = r.source_system_id AND s.code = 'BTO'
         JOIN fin.parties p ON p.id = r.party_id
        WHERE r.external_id = $1`,
      [`customer:${customerId}`],
    );

  beforeAll(async () => {
    admin = await connectAs('admin');
    // Branches exist before the boot step maps them: Mörön open, a closed one never mapped.
    const { rows } = await admin.query<{ id: string; status: string }>(
      `INSERT INTO branches (code, name, status)
       VALUES ('MRN', 'Оргил Бөөний төв', 'ACTIVE'), ('KHK', 'Хаагдсан салбар', 'INACTIVE')
       RETURNING id::text, status`,
    );
    branchIds = {
      active: Number.parseInt(rows.find((row) => row.status === 'ACTIVE')?.id ?? '0', 10),
      closed: Number.parseInt(rows.find((row) => row.status === 'INACTIVE')?.id ?? '0', 10),
    };
    app = await createHttpApp();
    const owner = await seedUser(app, { roles: ['ADMIN'] });
    adminId = owner.id;
    adminToken = (await login(app, owner)).accessToken;
  });
  afterAll(async () => {
    await admin.end();
    await app.close();
  });

  it('books the installation into BO at boot, mapping only ACTIVE branches', async () => {
    expect(
      await one(
        `SELECT t.code AS tenant, c.code AS company, c.legal_name, c.register_no, c.tin
           FROM fin.companies c JOIN fin.tenants t ON t.id = c.tenant_id`,
      ),
    ).toEqual({
      tenant: 'BUTEN_ORGIL',
      company: 'BO',
      legal_name: 'Бүтэн-Оргил ХХК',
      register_no: null,
      tin: null,
    });
    const { rows: sources } = await admin.query<{ code: string }>(
      `SELECT s.code FROM fin.source_grants g JOIN fin.source_systems s ON s.id = g.source_system_id ORDER BY 1`,
    );
    expect(sources.map((row) => row.code)).toEqual(['BTO', 'FIN']);
    const { rows: keys } = await admin.query<{
      code: string;
      required_control: string;
      requires_tax_code: boolean;
    }>('SELECT code, required_control, requires_tax_code FROM fin.posting_keys ORDER BY code');
    expect(keys).toHaveLength(30);
    expect(keys.filter((k) => k.requires_tax_code).map((k) => k.code)).toEqual([
      'CITY_TAX_OUTPUT',
      'VAT_INPUT',
      'VAT_OUTPUT',
    ]);
    expect(keys.find((k) => k.code === 'AR')?.required_control).toBe('RECEIVABLE');
    expect(keys.find((k) => k.code === 'AP')?.required_control).toBe('PAYABLE');
    expect(await count(`fin.party_refs WHERE external_id = 'LEGACY_UNASSIGNED'`)).toBe(1);
    const { rows: branches } = await admin.query<{ code: string; external_id: string }>(
      `SELECT b.code, r.external_id FROM fin.branches b
         JOIN fin.branch_refs r ON r.company_id = b.company_id AND r.branch_id = b.id`,
    );
    expect(branches).toEqual([{ code: 'MRN', external_id: String(branchIds.active) }]);
    expect(branchIds.closed).toBeGreaterThan(0);
  });

  it("keeps a customer's party in step with the customer, and leaves it alone otherwise", async () => {
    const partners = partnersApi(app, adminToken);
    const store = await partners.customer({ name: 'Хүслэн дэлгүүр', regNo: '5544332' });
    expect(await partyOf(store.id)).toEqual({
      kind: 'COMPANY',
      name: 'Хүслэн дэлгүүр',
      tin: null,
      register_no: '5544332',
      companies: 'BO',
    });

    await http()
      .patch(`/api/v1/customers/${store.id}`)
      .set(bearer(adminToken))
      .send({ name: 'Хүслэн маркет', tin: '12345678901' })
      .expect(200);
    expect(await partyOf(store.id)).toMatchObject({ name: 'Хүслэн маркет', tin: '12345678901' });
    const updates = () => count(`fin.audit_log WHERE entity = 'party' AND action = 'UPDATE'`);
    expect(await updates()).toBe(1);
    expect(
      await one(
        `SELECT actor_kind, actor_ref, principal FROM fin.audit_log WHERE entity = 'party' AND action = 'UPDATE'`,
      ),
    ).toEqual({ actor_kind: 'STAFF', actor_ref: `user:${adminId}`, principal: 'SOURCE:BTO' });

    await http()
      .patch(`/api/v1/customers/${store.id}`)
      .set(bearer(adminToken))
      .send({ note: 'Өглөө хүргэнэ' })
      .expect(200);
    expect(await updates()).toBe(1);
  });

  it('follows customers the worker creates (imports run there)', async () => {
    const worker: INestApplicationContext = await createWorker();
    try {
      const customers = worker.select(PartnersModule).get(CustomersService);
      const created = await customers.create(systemActor('import:test'), {
        kind: 'INDIVIDUAL',
        name: 'Болд',
      });
      expect(await partyOf(created.id)).toMatchObject({
        kind: 'INDIVIDUAL',
        name: 'Болд',
        companies: 'BO',
      });
    } finally {
      await worker.close();
    }
  });

  describe('«Компани»', () => {
    it('is read by every staff member and edited only with finance.settings.manage there', async () => {
      const worker = await seedUser(app, { roles: ['WAREHOUSE'] });
      const workerToken = (await login(app, worker)).accessToken;
      const read = await http().get('/api/v1/company').set(bearer(workerToken)).expect(200);
      expect(read.body).toMatchObject({
        code: 'BO',
        legalName: 'Бүтэн-Оргил ХХК',
        registerNo: null,
        tin: null,
        functionalCurrency: 'MNT',
        timezone: 'Asia/Ulaanbaatar',
        fiscalYearStartMonth: 1,
        status: 'ACTIVE',
        branches: [
          {
            code: 'MRN',
            name: 'Оргил Бөөний төв',
            status: 'ACTIVE',
            refs: [{ system: 'BTO', externalId: String(branchIds.active) }],
          },
        ],
      });
      const edit = { legalName: 'Бүтэн-Оргил ХХК', registerNo: '0000001', tin: null };
      await http().patch('/api/v1/company').set(bearer(workerToken)).send(edit).expect(403);

      const saved = await http()
        .patch('/api/v1/company')
        .set(bearer(adminToken))
        .send({ ...edit, registerNo: ' 0000001 ', tin: '123 456 789 01' })
        .expect(200);
      expect(saved.body).toMatchObject({ registerNo: '0000001', tin: '12345678901' });
      expect(
        await one(
          `SELECT actor_kind, actor_ref, principal FROM fin.audit_log WHERE entity = 'company' AND action = 'UPDATE'`,
        ),
      ).toEqual({
        actor_kind: 'STAFF',
        actor_ref: `user:${adminId}`,
        principal: `USER:user:${adminId}`,
      });

      const cleared = await http()
        .patch('/api/v1/company')
        .set(bearer(adminToken))
        .send({ ...edit, registerNo: '', tin: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ registerNo: null, tin: null });
    });

    it('checks the Mongolian shapes of the register number and the TIN', async () => {
      const base = { legalName: 'Бүтэн-Оргил ХХК', registerNo: null, tin: null };
      for (const [body, path] of [
        [{ ...base, registerNo: '123' }, 'registerNo'],
        [{ ...base, registerNo: 'УБ12345678' }, 'registerNo'],
        [{ ...base, tin: '1234567890' }, 'tin'],
        [{ ...base, legalName: '  ' }, 'legalName'],
      ] as const) {
        const refused = await http()
          .patch('/api/v1/company')
          .set(bearer(adminToken))
          .send(body)
          .expect(422);
        expect(refused.body).toMatchObject({
          code: 'VALIDATION_FAILED',
          errors: [expect.objectContaining({ path })],
        });
      }
    });

    it('refuses a user whose roles do not reach the company (ADR-0075: no row, no access)', async () => {
      const outsider = await seedUser(app, { roles: ['ADMIN'] });
      await admin.query('DELETE FROM user_company_roles WHERE user_id = $1', [outsider.id]);
      const token = (await login(app, outsider)).accessToken;
      const refused = await http()
        .patch('/api/v1/company')
        .set(bearer(token))
        .send({ legalName: 'Өөр нэр', registerNo: null, tin: null })
        .expect(403);
      expect(refused.body).toMatchObject({ code: 'FIN_COMPANY_FORBIDDEN' });
    });
  });

  it("replays the migration backfill against today's rows (0032_fin_foundation data section)", async () => {
    const file = join(__dirname, '../../src/db/migrations/0032_fin_foundation.sql');
    const text = readFileSync(file, 'utf8');
    const data = text.slice(
      text.indexOf('-- fin_foundation:data:begin'),
      text.indexOf('-- fin_foundation:data:end'),
    );
    const statements = data
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter((part) => part.replace(/^--.*$/gm, '').trim().length > 0);
    expect(statements.length).toBeGreaterThan(5);
    const customers = await count('customers');
    expect(customers).toBeGreaterThanOrEqual(2);
    await admin.query('BEGIN');
    try {
      await admin.query('SET LOCAL session_replication_role = replica');
      const { rows } = await admin.query<{ name: string }>(
        `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname = 'fin'`,
      );
      await admin.query(`TRUNCATE ${rows.map((row) => row.name).join(', ')}, user_company_roles`);
      await admin.query('SET LOCAL session_replication_role = origin');
      for (const statement of statements) await admin.query(statement);
      expect(await count(`fin.party_refs WHERE external_id LIKE 'customer:%'`)).toBe(customers);
      expect(await count('fin.parties')).toBe(customers + 1);
      expect(await count('user_company_roles')).toBe(await count('user_roles'));
      expect(await count('fin.companies')).toBe(1);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it("replays the payables backfill against today's rows (0035_fin_payables data section)", async () => {
    const partners = partnersApi(app, adminToken);
    await partners.supplier({ name: 'Нийлүүлэгч А ФБ' });
    await partners.supplier({ name: 'Нийлүүлэгч Б ФБ', tin: '12345678901' });
    const file = join(__dirname, '../../src/db/migrations/0035_fin_payables.sql');
    const text = readFileSync(file, 'utf8');
    const statements = text
      .slice(text.indexOf('-- fin_payables:data:begin'), text.indexOf('-- fin_payables:data:end'))
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter((part) => part.replace(/^--.*$/gm, '').trim().length > 0);
    const suppliers = await count('suppliers');
    expect(suppliers).toBeGreaterThanOrEqual(2);
    // The hook made each supplier's party already, as the boot step made the rest.
    expect(await count(`fin.party_refs WHERE external_id LIKE 'supplier:%'`)).toBe(suppliers);
    await admin.query('BEGIN');
    try {
      // A database of before F3: no payables keys, rules, document types or supplier parties.
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(
        `DELETE FROM fin.party_companies pc USING fin.party_refs r
          WHERE r.party_id = pc.party_id AND r.external_id LIKE 'supplier:%'`,
      );
      await admin.query(
        `DELETE FROM fin.parties p USING fin.party_refs r
          WHERE r.party_id = p.id AND r.external_id LIKE 'supplier:%'`,
      );
      await admin.query(`DELETE FROM fin.party_refs WHERE external_id LIKE 'supplier:%'`);
      await admin.query(
        `DELETE FROM fin.posting_rules WHERE posting_key IN ('AP', 'VAT_INPUT', 'INVENTORY')`,
      );
      await admin.query(
        `DELETE FROM fin.posting_keys WHERE code IN ('AP', 'VAT_INPUT', 'INVENTORY')`,
      );
      await admin.query(`DELETE FROM fin.accounts WHERE code IN ('310101', '130301', '140101')`);
      await admin.query(
        `DELETE FROM fin.document_types WHERE code IN ('BTO.SUPPLIER_BILL',
           'BTO.SUPPLIER_BILL_CREDIT', 'BTO.RECEIPT_RECOST', 'BTO.SUPPLIER_RETURN',
           'BTO.STOCK_VALUE')`,
      );
      await admin.query('SET LOCAL session_replication_role = origin');
      for (const statement of statements) await admin.query(statement);
      expect(await count(`fin.party_refs WHERE external_id LIKE 'supplier:%'`)).toBe(suppliers);
      expect(
        await count(`fin.parties WHERE name = 'Нийлүүлэгч Б ФБ' AND tin = '12345678901'`),
      ).toBe(1);
      expect(await count(`fin.accounts WHERE code = '310101' AND control = 'PAYABLE'`)).toBe(1);
      expect(
        await count(`fin.posting_rules WHERE posting_key IN ('AP', 'VAT_INPUT', 'INVENTORY')`),
      ).toBe(3);
      expect(await count('fin.document_types')).toBe(12);
    } finally {
      await admin.query('ROLLBACK');
    }
  });

  it("replays the stock backfill against today's rows (0037_fin_stock data section)", async () => {
    const file = join(__dirname, '../../src/db/migrations/0037_fin_stock.sql');
    const text = readFileSync(file, 'utf8');
    const statements = text
      .slice(text.indexOf('-- fin_stock:data:begin'), text.indexOf('-- fin_stock:data:end'))
      .split('--> statement-breakpoint')
      .map((part) => part.trim())
      .filter((part) => part.replace(/^--.*$/gm, '').trim().length > 0);
    const keys = [
      'GOODS_RECEIVED',
      'COGS',
      'STOCK_LOSS',
      'STOCK_GAIN',
      'OPENING_STOCK',
      'ISSUE_INTERNAL',
      'ISSUE_BONUS',
      'ISSUE_MARKETING',
      'ISSUE_WRITE_OFF',
      'ISSUE_TRANSFER_OUT',
      'ISSUE_OTHER',
    ];
    const list = keys.map((key) => `'${key}'`).join(', ');
    await admin.query('BEGIN');
    try {
      // A database of before F4: no stock keys, rules, accounts, series or document type.
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(`DELETE FROM fin.posting_rules WHERE posting_key IN (${list})`);
      await admin.query(`DELETE FROM fin.posting_keys WHERE code IN (${list})`);
      await admin.query(
        `DELETE FROM fin.accounts WHERE code IN ('310201', '610101', '740201', '511030', '390101',
           '730201', '730202', '730203', '730204', '730205', '730209')`,
      );
      await admin.query(`DELETE FROM fin.document_types WHERE code = 'BTO.STOCK_VALUE'`);
      await admin.query(`DELETE FROM fin.number_series WHERE code = 'STOCK'`);
      await admin.query('SET LOCAL session_replication_role = origin');
      for (const statement of statements) await admin.query(statement);
      expect(await count(`fin.posting_rules WHERE posting_key IN (${list})`)).toBe(11);
      expect(await count(`fin.accounts WHERE code = '610101' AND kind = 'EXPENSE'`)).toBe(1);
      expect(await count('fin.document_types')).toBe(13);
      expect(await count(`fin.number_series WHERE code = 'STOCK'`)).toBe(1);
    } finally {
      await admin.query('ROLLBACK');
    }
  });
});
