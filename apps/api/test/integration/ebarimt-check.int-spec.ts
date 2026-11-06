import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface RowJson {
  supplierId: number;
  code: string;
  registers: string;
  registersDefault: string | null;
  phone: string;
  remark: string;
  sharedRegisters: string[];
  employeeUserId: number | null;
  employeeName: string | null;
  employeeAssigned: boolean;
  ordererName: string | null;
  employeeMonths: { userId: number | null; periods: number[] }[];
  purchaseAmount: string;
  receiptCount: number;
  ebarimtAmount: string;
  ebarimtCount: number;
  linkedAmount: string;
  exemptAmount: string;
  diffAmount: string;
  byPeriod: {
    period: number;
    purchaseAmount: string;
    ebarimtAmount: string;
    note: string | null;
  }[];
  history: { period: number; field: string; kind: string; amount: string | null }[];
}
interface ReportJson {
  periods: number[];
  noFile: number[];
  rows: RowJson[];
  unregistered: { ttd: string; name: string; amount: string; count: number }[];
  links: { receiptKey: string; supplierId: number; stale: boolean; amount: string }[];
  accountCodes: string[];
}

const LINE_A = {
  ddtd: 'DDTD-A',
  note: '111',
  date: '2026-03-05',
  name: 'Нэгдүгээр ХХК',
  ttd: '7000001',
};

/** A sheet shaped like e-Barimt's export. */
async function exportOf(
  rows: readonly {
    ddtd: string;
    note: string;
    date: string;
    name: string;
    ttd: string;
    total?: number;
  }[],
): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  sheet.addRow([
    'Падаан №',
    'ДДТД',
    'Огноо',
    'Харилцагчийн нэр',
    'Харилцагчийн ТТД',
    'НӨАТ',
    'Цэвэр дүн',
    'Нийт дүн',
    'Төрөл',
  ]);
  for (const row of rows) {
    const total = row.total ?? 11000;
    sheet.addRow([
      row.note,
      row.ddtd,
      row.date,
      row.name,
      row.ttd,
      Math.round((total / 11) * 100) / 100,
      Math.round((total - total / 11) * 100) / 100,
      total,
      'Энгийн',
    ]);
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * «Ebarimt» (ADR-0168): a month's purchases from the posted receipts on the accounts that count,
 * e-Barimt from a month's file, a supplier's employee on this page leaving its own orderer alone.
 * Synthetic data only.
 */
describe('ebarimt check', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let reader: string;
  let keeper: string;
  let staffId: number;
  let staffTwoId: number;
  let alpha: number;
  let beta: number;
  let gamma: number;
  let water: ProductJson;
  const http = () => request(app.getHttpServer());
  const today = businessDate();
  const thisPeriod = Number.parseInt(today.slice(0, 7).replace('-', ''), 10);

  const report = async (periods: readonly number[], token = admin) =>
    (
      await http()
        .get('/api/v1/ebarimt-check/report')
        .query({ periods: periods.join(',') })
        .set(bearer(token))
        .expect(200)
    ).body as ReportJson;
  const rowOf = (data: ReportJson, supplierId: number) => {
    const row = data.rows.find((entry) => entry.supplierId === supplierId);
    if (!row) throw new Error(`no row for supplier ${supplierId}`);
    return row;
  };
  const upload = async (bytes: Buffer, token = admin) => {
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(token))
        .send({ kind: 'ebarimt.source', contentType: XLSX_CONTENT_TYPE, sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http()
      .put(issued.uploadUrl)
      .set('Content-Type', XLSX_CONTENT_TYPE)
      .send(bytes)
      .expect(204);
    return issued.fileId;
  };
  const importFile = async (bytes: Buffer, token = admin, status = 201) => {
    const fileId = await upload(bytes, token);
    return http()
      .post('/api/v1/ebarimt-check/files')
      .set(bearer(token))
      .set(idempotency())
      .send({ fileId, fileName: 'EBARIMT.xlsx' })
      .expect(status);
  };
  /** A posted receipt of a supplier on a day; `costed` runs the accountant's price check. */
  const receipt = async (
    supplierId: number,
    day: string,
    price: string,
    options: { counterAccountCode?: string; costed?: boolean } = {},
  ) => {
    const draft = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId,
          supplierDocNo: `N-${day}`,
          supplierDocDate: day,
          ...(options.counterAccountCode ? { counterAccountCode: options.counterAccountCode } : {}),
          lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', docUnitPrice: price }],
        })
        .expect(201)
    ).body as { id: number };
    await postReceipt(app, admin, draft.id);
    if (options.costed) await costReceiptAsTyped(app, admin, draft.id);
    return draft.id;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    admin = (await login(app, adminUser)).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    keeper = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const staff = await seedUser(app, { roles: ['OFFICE'] });
    const staffTwo = await seedUser(app, { roles: ['OFFICE'] });
    reader = (await login(app, staff)).accessToken;
    staffId = staff.id;
    staffTwoId = staffTwo.id;
    const partners = partnersApi(app, admin);
    alpha = (await partners.supplier({ name: 'Альфа ЕБ', regNo: '7000001' })).id;
    beta = (await partners.supplier({ name: 'Бета ЕБ', regNo: '7000002' })).id;
    gamma = (await partners.supplier({ name: 'Гамма ЕБ' })).id;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('EB1');
    const catalog = catalogApi(app, admin);
    water = await catalog.product({
      sku: '7801',
      name: 'Ус ЕБ',
      categoryId: await catalog.category('Ус ЕБ'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventory.setHome(water.id, warehouse.id);
    await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '313011', name: 'Тооллогын зөрүү', journal: 'RECEIVABLE_PAYABLE' })
      .expect(201);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('sums a month’s posted receipts by supplier, by the delivery note’s month', async () => {
    const id = await receipt(alpha, '2026-03-10', '50000', { costed: true });
    await receipt(alpha, '2026-03-20', '7000');
    await receipt(alpha, '2026-04-02', '1000');
    // A draft does not count.
    await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId: alpha,
        supplierDocDate: '2026-03-21',
        lines: [{ productUnitId: unitOf(water, 'PCS').id, enteredQty: '1', docUnitPrice: '999' }],
      })
      .expect(201);

    const march = rowOf(await report([202603]), alpha);
    expect(march).toMatchObject({
      purchaseAmount: '57000.00',
      receiptCount: 2,
      ebarimtAmount: '0.00',
      diffAmount: '57000.00',
    });
    const brief = (
      await http()
        .get('/api/v1/ebarimt-check/receipts')
        .query({ periods: '202603', supplierId: alpha })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { id: number; amount: string; counted: boolean; pricePending: boolean }[] };
    expect(brief.data.map((row) => row.amount).sort()).toEqual(['50000.00', '7000.00']);
    expect(brief.data.find((row) => row.id === id)).toMatchObject({
      counted: true,
      pricePending: false,
    });
    expect(brief.data.find((row) => row.id !== id)?.pricePending).toBe(true);
  });

  it('counts only the accounts the settings name', async () => {
    await receipt(beta, '2026-03-11', '3000', { counterAccountCode: '313011' });
    await receipt(beta, '2026-03-12', '2000');
    const first = (
      await http().get('/api/v1/ebarimt-check/settings').set(bearer(admin)).expect(200)
    ).body as { accounts: { code: string; isDefault: boolean; counted: boolean }[] };
    // Nothing chosen: the payable's own account alone.
    expect(first.accounts.filter((row) => row.counted).map((row) => row.code)).toEqual(['310101']);
    expect(first.accounts.map((row) => row.code)).toContain('313011');
    expect(rowOf(await report([202603]), beta).purchaseAmount).toBe('2000.00');

    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(admin))
      .send({ accountCodes: ['310101', '313011'] })
      .expect(200);
    expect(rowOf(await report([202603]), beta).purchaseAmount).toBe('5000.00');

    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(admin))
      .send({ accountCodes: ['313011'] })
      .expect(200);
    const only = await report([202603]);
    expect(rowOf(only, beta).purchaseAmount).toBe('3000.00');
    expect(only.accountCodes).toEqual(['313011']);
    // The brief still lists a receipt that does not count, marked so.
    const brief = (
      await http()
        .get('/api/v1/ebarimt-check/receipts')
        .query({ periods: '202603', supplierId: beta })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { amount: string; counted: boolean }[] };
    expect(brief.data.map((row) => [row.amount, row.counted]).sort()).toEqual([
      ['2000.00', false],
      ['3000.00', true],
    ]);

    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(admin))
      .send({ accountCodes: [] })
      .expect(422);
    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(admin))
      .send({ accountCodes: ['999999'] })
      .expect(422);
    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(admin))
      .send({ accountCodes: ['310101'] })
      .expect(200);
  });

  it('takes a month’s file into the month its dates fall in and matches it by register', async () => {
    const result = (
      await importFile(
        await exportOf([
          LINE_A,
          {
            ddtd: 'DDTD-B',
            note: '112',
            date: '2026-03-06',
            name: 'Нэгдүгээр ХХК',
            ttd: '7000001',
            total: 22000,
          },
          {
            ddtd: 'DDTD-C',
            note: '113',
            date: '2026-03-07',
            name: 'Хоёрдугаар ХХК',
            ttd: '7000002',
          },
          {
            ddtd: 'DDTD-D',
            note: '114',
            date: '2026-03-08',
            name: 'Бүртгэлгүй ХХК',
            ttd: '7999999',
            total: 5500,
          },
        ]),
      )
    ).body as { period: number; rowCount: number; totalAmount: string; replacedRowCount: null };
    expect(result).toMatchObject({
      period: 202603,
      rowCount: 4,
      totalAmount: '49500.00',
      replacedRowCount: null,
    });
    const march = await report([202603]);
    expect(march.noFile).toEqual([]);
    expect(rowOf(march, alpha)).toMatchObject({
      ebarimtAmount: '33000.00',
      ebarimtCount: 2,
      diffAmount: '24000.00',
    });
    expect(rowOf(march, gamma)).toMatchObject({ ebarimtAmount: '0.00', diffAmount: '0.00' });
    expect(march.unregistered).toEqual([
      { ttd: '7999999', name: 'Бүртгэлгүй ХХК', amount: '5500.00', count: 1, periods: [202603] },
    ]);
    expect((await report([202604])).noFile).toEqual([202604]);
    const overview = (
      await http()
        .get('/api/v1/ebarimt-check/files')
        .query({ year: 2026 })
        .set(bearer(admin))
        .expect(200)
    ).body as { months: { period: number; file: unknown }[]; latestPeriod: number };
    expect(overview.months).toHaveLength(13);
    expect(overview.months.filter((month) => month.file).map((month) => month.period)).toEqual([
      202603,
    ]);
    expect(overview.latestPeriod).toBe(202603);
  });

  it('refuses a file that is not one month’s e-Barimt export, and keeps the month’s file', async () => {
    const twoMonths = await exportOf([
      LINE_A,
      { ddtd: 'X', note: '1', date: '2026-04-01', name: 'n', ttd: '7000001' },
    ]);
    const refused = await importFile(twoMonths, admin, 422);
    expect(refused.body).toMatchObject({
      code: 'EBARIMT_FILE_MONTHS',
      params: { months: '2026-03, 2026-04' },
    });
    const book = new ExcelJS.Workbook();
    book.addWorksheet('Sheet1').addRow(['Код', 'Нэр']);
    const wrong = await importFile(Buffer.from(await book.xlsx.writeBuffer()), admin, 422);
    expect(wrong.body).toMatchObject({ code: 'EBARIMT_FILE_COLUMNS' });
    expect(rowOf(await report([202603]), alpha).ebarimtAmount).toBe('33000.00');
  });

  it('replaces a month’s file, keeping the old one, and notes what moved', async () => {
    const replaced = (
      await importFile(
        await exportOf([
          LINE_A,
          {
            ddtd: 'DDTD-B',
            note: '112',
            date: '2026-03-06',
            name: 'Нэгдүгээр ХХК',
            ttd: '7000001',
            total: 44000,
          },
          {
            ddtd: 'DDTD-C',
            note: '113',
            date: '2026-03-07',
            name: 'Хоёрдугаар ХХК',
            ttd: '7000002',
          },
          {
            ddtd: 'DDTD-D',
            note: '114',
            date: '2026-03-08',
            name: 'Бүртгэлгүй ХХК',
            ttd: '7999999',
            total: 5500,
          },
        ]),
      )
    ).body as { replacedRowCount: number };
    expect(replaced.replacedRowCount).toBe(4);
    const row = rowOf(await report([202603]), alpha);
    expect(row.ebarimtAmount).toBe('55000.00');
    expect(
      row.history
        .filter((event) => event.field === 'EBARIMT')
        .map((event) => [event.kind, event.amount]),
    ).toEqual([
      ['INIT', '33000.00'],
      ['FILE', '55000.00'],
    ]);
    const files = await sql.query<{ status: string }>(
      'SELECT status FROM ebarimt_check_files WHERE period = 202603 ORDER BY id',
    );
    expect(files.rows.map((file) => file.status)).toEqual(['REPLACED', 'ACTIVE']);
  });

  it('writes the exempt amount and the note, month by month, into the difference', async () => {
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(accountant))
      .send({ period: 202603, supplierId: alpha, exemptAmount: '2000' })
      .expect(204);
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(accountant))
      .send({ period: 202603, supplierId: alpha, note: 'Ярьсан' })
      .expect(204);
    const row = rowOf(await report([202603]), alpha);
    expect(row).toMatchObject({ exemptAmount: '2000.00', diffAmount: '0.00' });
    expect(row.byPeriod[0]?.note).toBe('Ярьсан');
    // The note did not touch the amount, and another month has neither.
    expect(rowOf(await report([202604]), alpha)).toMatchObject({ exemptAmount: '0.00' });
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(accountant))
      .send({ period: 202603, supplierId: alpha, exemptAmount: '-5' })
      .expect(422);
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(accountant))
      .send({ period: 202613, supplierId: alpha, note: 'x' })
      .expect(422);
  });

  it('types a supplier’s registers on the page, leaving its record, and back', async () => {
    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${gamma}/profile`)
      .set(bearer(accountant))
      .send({ registers: '7000003; 7999999', phone: '99112233', remark: 'Шивнэ' })
      .expect(204);
    const march = await report([202603]);
    expect(rowOf(march, gamma)).toMatchObject({
      registers: '7000003; 7999999',
      registersDefault: '',
      phone: '99112233',
      remark: 'Шивнэ',
      ebarimtAmount: '5500.00',
    });
    expect(march.unregistered).toEqual([]);
    const record = await sql.query<{ reg_no: string | null; phone: string | null }>(
      'SELECT reg_no, phone FROM suppliers WHERE id = $1',
      [gamma],
    );
    expect(record.rows[0]).toEqual({ reg_no: null, phone: null });

    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${gamma}/profile`)
      .set(bearer(accountant))
      .send({ registers: null })
      .expect(204);
    const after = await report([202603]);
    expect(rowOf(after, gamma)).toMatchObject({
      registers: '',
      registersDefault: null,
      phone: '99112233',
      ebarimtAmount: '0.00',
    });
    expect(after.unregistered.map((row) => row.ttd)).toEqual(['7999999']);
  });

  it('flags a register on two suppliers, each showing its receipts', async () => {
    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${gamma}/profile`)
      .set(bearer(accountant))
      .send({ registers: '7000002' })
      .expect(204);
    const march = await report([202603]);
    expect(rowOf(march, gamma)).toMatchObject({
      ebarimtAmount: '11000.00',
      sharedRegisters: ['7000002'],
    });
    expect(rowOf(march, beta)).toMatchObject({
      ebarimtAmount: '11000.00',
      sharedRegisters: ['7000002'],
    });
    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${gamma}/profile`)
      .set(bearer(accountant))
      .send({ registers: null })
      .expect(204);
  });

  it('links a receipt of an unknown register to a supplier: it counts once, and comes back undone', async () => {
    const entries = (
      await http()
        .get('/api/v1/ebarimt-check/entries')
        .query({ periods: '202603', ttd: '7999999' })
        .set(bearer(admin))
        .expect(200)
    ).body as { rows: { receiptKey: string; link: unknown }[] };
    expect(entries.rows.map((row) => row.receiptKey)).toEqual(['DDTD-D']);

    const linked = (
      await http()
        .put('/api/v1/ebarimt-check/receipt-links')
        .set(bearer(accountant))
        .send({ period: 202603, receiptKeys: ['DDTD-D', 'MISSING'], supplierId: gamma })
        .expect(200)
    ).body as { linked: number; skipped: number };
    expect(linked).toMatchObject({ linked: 1, skipped: 1 });
    const march = await report([202603]);
    expect(rowOf(march, gamma)).toMatchObject({
      ebarimtAmount: '5500.00',
      linkedAmount: '5500.00',
    });
    expect(march.unregistered).toEqual([]);
    expect(march.links).toEqual([
      expect.objectContaining({ receiptKey: 'DDTD-D', supplierId: gamma, stale: false }),
    ]);

    // The register landing on someone else does not count the linked receipt twice.
    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${beta}/profile`)
      .set(bearer(accountant))
      .send({ registers: '7000002;7999999' })
      .expect(204);
    const both = await report([202603]);
    expect(rowOf(both, beta).ebarimtAmount).toBe('11000.00');
    expect(rowOf(both, gamma).ebarimtAmount).toBe('5500.00');
    await http()
      .put(`/api/v1/ebarimt-check/suppliers/${beta}/profile`)
      .set(bearer(accountant))
      .send({ registers: null })
      .expect(204);

    await http()
      .put('/api/v1/ebarimt-check/receipt-links')
      .set(bearer(accountant))
      .send({ period: 202603, receiptKeys: ['DDTD-D'], supplierId: null })
      .expect(200);
    const undone = await report([202603]);
    expect(rowOf(undone, gamma).ebarimtAmount).toBe('0.00');
    expect(undone.links).toEqual([]);
    expect(undone.unregistered.map((row) => row.ttd)).toEqual(['7999999']);
    const kept = await sql.query(
      'SELECT 1 FROM ebarimt_check_receipt_links WHERE removed_at IS NOT NULL',
    );
    expect(kept.rowCount).toBe(1);
  });

  it('keeps a link while its receipt is in the file, and marks it when a new file drops it', async () => {
    await http()
      .put('/api/v1/ebarimt-check/receipt-links')
      .set(bearer(accountant))
      .send({ period: 202603, receiptKeys: ['DDTD-D'], supplierId: gamma })
      .expect(200);
    await importFile(await exportOf([LINE_A]));
    const dropped = await report([202603]);
    expect(rowOf(dropped, gamma).ebarimtAmount).toBe('0.00');
    expect(dropped.links).toEqual([expect.objectContaining({ receiptKey: 'DDTD-D', stale: true })]);
    await importFile(
      await exportOf([
        LINE_A,
        {
          ddtd: 'DDTD-D',
          note: '114',
          date: '2026-03-08',
          name: 'Бүртгэлгүй ХХК',
          ttd: '7999999',
          total: 5500,
        },
      ]),
    );
    expect(rowOf(await report([202603]), gamma).ebarimtAmount).toBe('5500.00');
    await http()
      .put('/api/v1/ebarimt-check/receipt-links')
      .set(bearer(accountant))
      .send({ period: 202603, receiptKeys: ['DDTD-D'], supplierId: null })
      .expect(200);
  });

  it('gives a supplier to another employee from a month on, never touching its own orderer', async () => {
    await sql.query(
      `INSERT INTO supplier_orderers (supplier_id, user_id) VALUES ($1, $2)
       ON CONFLICT (supplier_id) DO UPDATE SET user_id = EXCLUDED.user_id`,
      [alpha, staffId],
    );
    // By default: the supplier's own, in every month.
    expect(rowOf(await report([202603]), alpha)).toMatchObject({
      employeeUserId: staffId,
      employeeAssigned: false,
    });

    const changed = (
      await http()
        .put('/api/v1/ebarimt-check/assignments')
        .set(bearer(admin))
        .send({ period: 202603, supplierIds: [alpha, beta], userId: staffTwoId })
        .expect(200)
    ).body as { changed: number };
    expect(changed.changed).toBe(2);
    // Twice over changes nothing.
    expect(
      (
        (
          await http()
            .put('/api/v1/ebarimt-check/assignments')
            .set(bearer(admin))
            .send({ period: 202603, supplierIds: [alpha], userId: staffTwoId })
            .expect(200)
        ).body as { changed: number }
      ).changed,
    ).toBe(0);

    const before = rowOf(await report([202602]), alpha);
    const during = rowOf(await report([202603]), alpha);
    const later = rowOf(await report([202605]), alpha);
    expect(before).toMatchObject({ employeeUserId: staffId, employeeAssigned: false });
    expect(during).toMatchObject({ employeeUserId: staffTwoId, employeeAssigned: true });
    expect(later).toMatchObject({ employeeUserId: staffTwoId, employeeAssigned: true });
    const orderer = await sql.query<{ user_id: string }>(
      'SELECT user_id FROM supplier_orderers WHERE supplier_id = $1',
      [alpha],
    );
    expect(Number.parseInt(orderer.rows[0]?.user_id ?? '', 10)).toBe(staffId);

    // A consolidated view says who held it how long, most months first.
    const range = rowOf(await report([202602, 202603, 202604]), alpha);
    expect(range.employeeMonths).toEqual([
      expect.objectContaining({ userId: staffTwoId, periods: [202603, 202604] }),
      expect.objectContaining({ userId: staffId, periods: [202602] }),
    ]);

    // Back to its own from May; March and April stay with who had them.
    await http()
      .put('/api/v1/ebarimt-check/assignments')
      .set(bearer(admin))
      .send({ period: 202605, supplierIds: [alpha], userId: null })
      .expect(200);
    expect(rowOf(await report([202604]), alpha).employeeUserId).toBe(staffTwoId);
    expect(rowOf(await report([202605]), alpha)).toMatchObject({
      employeeUserId: staffId,
      employeeAssigned: false,
    });
    expect(rowOf(await report([202606]), alpha).employeeUserId).toBe(staffId);
    expect(
      rowOf(await report([202603]), alpha)
        .history.filter((event) => event.field === 'EMPLOYEE')
        .map((event) => event.kind),
    ).toEqual(['MANUAL']);
  });

  it('adds months up in a consolidated view, each month’s figures beside', async () => {
    await importFile(
      await exportOf([
        {
          ddtd: 'APR-1',
          note: '201',
          date: '2026-04-09',
          name: 'Нэгдүгээр ХХК',
          ttd: '7000001',
          total: 1000,
        },
      ]),
    );
    const range = await report([202603, 202604]);
    const row = rowOf(range, alpha);
    expect(row.purchaseAmount).toBe('58000.00');
    expect(row.ebarimtAmount).toBe('12000.00');
    expect(row.exemptAmount).toBe('2000.00');
    expect(row.diffAmount).toBe('44000.00');
    expect(row.byPeriod.map((month) => month.period)).toEqual([202603, 202604]);
    expect(row.byPeriod[1]).toMatchObject({ purchaseAmount: '1000.00', ebarimtAmount: '1000.00' });
    // A month between two chosen ones stays out of the sum.
    const gap = await report([202601, 202604]);
    expect(rowOf(gap, alpha).purchaseAmount).toBe('1000.00');
  });

  it('takes a month’s file away and hands the bytes back', async () => {
    const overview = (
      await http()
        .get('/api/v1/ebarimt-check/files')
        .query({ year: 2026 })
        .set(bearer(admin))
        .expect(200)
    ).body as { months: { period: number; file: { id: number } | null }[] };
    const april = overview.months.find((month) => month.period === 202604)?.file;
    if (!april) throw new Error('April has its file');
    const bytes = await http()
      .get(`/api/v1/ebarimt-check/files/${april.id}/download`)
      .set(bearer(admin))
      .buffer()
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((bytes.body as Buffer).length).toBeGreaterThan(100);
    expect(bytes.headers['content-disposition']).toContain('EBARIMT.xlsx');

    await http().delete('/api/v1/ebarimt-check/files/202604').set(bearer(accountant)).expect(204);
    const after = await report([202604]);
    expect(after.noFile).toEqual([202604]);
    expect(rowOf(after, alpha).ebarimtAmount).toBe('0.00');
    await http().delete('/api/v1/ebarimt-check/files/202604').set(bearer(accountant)).expect(404);
    const kept = await sql.query<{ status: string }>(
      'SELECT status FROM ebarimt_check_files WHERE period = 202604',
    );
    expect(kept.rows.map((file) => file.status)).toEqual(['REMOVED']);
  });

  it('holds each right apart', async () => {
    const period = thisPeriod;
    // A keeper reads nothing here.
    await http()
      .get('/api/v1/ebarimt-check/report')
      .query({ periods: String(period) })
      .set(bearer(keeper))
      .expect(403);
    await http()
      .get('/api/v1/ebarimt-check/receipts')
      .query({ periods: String(period), supplierId: alpha })
      .set(bearer(keeper))
      .expect(403);
    await http().get('/api/v1/ebarimt-check/settings').set(bearer(keeper)).expect(403);
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(keeper))
      .send({ period, supplierId: alpha, note: 'x' })
      .expect(403);
    // An accountant writes, but the employee stays the admin's by default.
    await http()
      .put('/api/v1/ebarimt-check/assignments')
      .set(bearer(accountant))
      .send({ period, supplierIds: [alpha], userId: staffId })
      .expect(403);
    await http()
      .get('/api/v1/ebarimt-check/report')
      .query({ periods: String(period) })
      .set(bearer(accountant))
      .expect(200);
    // Who chases suppliers reads and writes, but not the settings.
    const buyer = (await login(app, await seedUser(app, { roles: ['PROCUREMENT'] }))).accessToken;
    await http()
      .get('/api/v1/ebarimt-check/report')
      .query({ periods: String(period) })
      .set(bearer(buyer))
      .expect(200);
    await http()
      .put('/api/v1/ebarimt-check/month-values')
      .set(bearer(buyer))
      .send({ period, supplierId: alpha, note: 'Ярьсан' })
      .expect(204);
    await http()
      .put('/api/v1/ebarimt-check/settings')
      .set(bearer(buyer))
      .send({ accountCodes: ['310101'] })
      .expect(403);
    // Others have no right until a role is given one.
    await http()
      .get('/api/v1/ebarimt-check/report')
      .query({ periods: String(period) })
      .set(bearer(reader))
      .expect(403);
    await http()
      .get('/api/v1/ebarimt-check/report')
      .query({ periods: '202613' })
      .set(bearer(admin))
      .expect(422);
  });
});
