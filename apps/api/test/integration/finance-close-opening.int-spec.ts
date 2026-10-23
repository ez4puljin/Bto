import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, addMonths, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { financeApi } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { importsApi, sheetOf } from '../harness/imports';
import { partnersApi } from '../harness/partners';

interface PeriodJson {
  code: string;
  status: 'OPEN' | 'CLOSED';
  lastEvent: { action: string; reason: string | null } | null;
}

/**
 * F5 on Bto's side (ADR-0102): «Сарын хаалт» over HTTP with its rights, Erkhet's chart and the
 * opening trial balance through the imports (fictitious data only).
 */
describe('finance close and opening', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let office: string;
  const today = businessDate();
  const lastMonth = addMonths(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
  const http = () => request(app.getHttpServer());
  const close = (token: string, code: string) =>
    http().post(`/api/v1/finance/periods/${code}/close`).set(bearer(token)).set(idempotency());
  const reopen = (token: string, code: string, reason: string) =>
    http()
      .post(`/api/v1/finance/periods/${code}/reopen`)
      .set(bearer(token))
      .set(idempotency())
      .send({ reason });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    accountant = await token('ACCOUNTANT');
    office = await token('OFFICE');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('closes an ended month for the accountant, refuses postings in it and reopens it', async () => {
    expect((await close(accountant, today.slice(0, 7)).expect(409)).body).toMatchObject({
      code: 'FIN_PERIOD_NOT_ENDED',
    });
    await close(office, lastMonth).expect(403);
    const closed = (await close(accountant, lastMonth).expect(200)).body as PeriodJson;
    expect(closed).toMatchObject({ code: lastMonth, status: 'CLOSED' });
    const finance = financeApi(app, accountant);
    const expense = await finance.account('730101');
    const income = await finance.account('511020');
    const refused = await finance
      .journal({
        entryDate: `${lastMonth}-15`,
        description: 'Хаасан сард',
        lines: [
          { accountId: expense.id, debit: '10' },
          { accountId: income.id, credit: '10' },
        ],
      })
      .expect(409);
    expect(refused.body).toMatchObject({ code: 'FIN_PERIOD_CLOSED' });
    expect((await reopen(accountant, lastMonth, '  ').expect(422)).body).toMatchObject({
      code: 'FIN_PAYLOAD_INVALID',
    });
    await reopen(office, lastMonth, 'Засвар').expect(403);
    const reopened = (await reopen(accountant, lastMonth, 'Нэхэмжлэл хоцорсон').expect(200))
      .body as PeriodJson;
    expect(reopened).toMatchObject({
      status: 'OPEN',
      lastEvent: { action: 'REOPEN', reason: 'Нэхэмжлэл хоцорсон' },
    });
    const list = (await http().get('/api/v1/finance/periods').set(bearer(office)).expect(200))
      .body as { data: PeriodJson[] };
    expect(list.data.map((row) => row.code)).toContain(lastMonth);
    const events = (
      await http().get('/api/v1/finance/periods/events').set(bearer(accountant)).expect(200)
    ).body as { data: { action: string }[] };
    expect(events.data.map((row) => row.action)).toEqual(['REOPEN', 'CLOSE']);
  });

  it('imports Erkhet’s chart with groups, controls and a role, refuses a used account, and reverts', async () => {
    const imports = importsApi(app, admin);
    const finance = financeApi(app, accountant);
    const expense = await finance.account('730101');
    const income = await finance.account('511020');
    await finance
      .journal({
        entryDate: today,
        description: 'Ашиглагдсан данс',
        lines: [
          { accountId: expense.id, debit: '5' },
          { accountId: income.id, credit: '5' },
        ],
      })
      .expect(201);
    const used = await imports.check('FIN_CHART', [
      { code: '730101', name: 'Бусад зардал', kind: 'Орлого' },
    ]);
    expect(used.status).toBe('INVALID');
    expect(
      (await imports.rows(used.id, 'ERRORS')).flatMap((row) =>
        row.errors.map((issue) => `${issue.column}:${issue.code}`),
      ),
    ).toEqual(['kind:IN_USE']);

    const job = await imports.check('FIN_CHART', [
      {
        code: '120101',
        name: 'Дансны авлага',
        kind: 'Хөрөнгө',
        groupCode: '12',
        groupName: 'Авлага',
        control: 'Авлага',
      },
      {
        code: '120102',
        name: 'Бусад авлага',
        kind: 'ASSET',
        groupCode: '12',
        control: 'Авлага',
        role: 'Борлуулалтын авлага',
      },
      { code: '100201', name: 'Банкны клиринг', kind: 'Хөрөнгө', control: 'Клиринг' },
      { code: 'X 1', name: 'Буруу', kind: 'Хүсэл' },
    ]);
    expect(job.status).toBe('INVALID');
    expect(
      (await imports.rows(job.id, 'ERRORS')).flatMap((row) =>
        row.errors.map((issue) => `${row.rowNo}:${issue.column}:${issue.code}`),
      ),
    ).toEqual(['5:code:FORMAT', '5:kind:NOT_FOUND']);
    const good = await imports.check('FIN_CHART', [
      {
        code: '120101',
        name: 'Дансны авлага',
        kind: 'Хөрөнгө',
        groupCode: '12',
        groupName: 'Авлага',
        control: 'Авлага',
      },
      {
        code: '120102',
        name: 'Бусад авлага',
        kind: 'ASSET',
        groupCode: '12',
        control: 'Авлага',
        role: 'Борлуулалтын авлага',
      },
      { code: '100201', name: 'Банкны клиринг', kind: 'Хөрөнгө', control: 'Клиринг' },
    ]);
    expect(good).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    expect((await imports.commit(good.id)).status).toBe('COMMITTED');
    const { rows } = await sql.query<{ code: string; name: string; control: string; grp: string }>(
      `SELECT a.code, a.name, a.control, g.name AS grp
         FROM fin.accounts a LEFT JOIN fin.account_groups g ON g.id = a.group_id
        WHERE a.code IN ('120101', '120102', '100201') ORDER BY a.code`,
    );
    expect(rows).toEqual([
      { code: '100201', name: 'Банкны клиринг', control: 'MONEY', grp: null },
      { code: '120101', name: 'Дансны авлага', control: 'RECEIVABLE', grp: 'Авлага' },
      { code: '120102', name: 'Бусад авлага', control: 'RECEIVABLE', grp: 'Авлага' },
    ]);
    const role = (await finance.account('120102')) as { role: string | null };
    expect(role.role).toBe('AR');
    expect((await imports.revert(good.id)).status).toBe('REVERTED');
    expect(((await finance.account('120101')) as { role: string | null }).role).toBe('AR');
    expect(((await finance.account('120101')) as { name: string }).name).not.toBe('Дансны авлага');
  });

  it('posts a fictitious opening per party with due dates, redirects the inventory and reverts', async () => {
    const partners = partnersApi(app, admin);
    const customer = await partners.customer({ code: '7701', name: 'Эхний дэлгүүр' });
    const supplier = await partners.supplier({ code: '9901', name: 'Эхний нийлүүлэгч' });
    const box = await financeApi(app, admin).cashBox('OP-BOX');
    const imports = importsApi(app, admin);
    const date = addDays(today, -1);
    const options = { openingOptions: { date } };

    const unbalanced = await imports.check(
      'FIN_OPENING',
      [
        { account: '120101', party: '7701', debit: '100' },
        { account: '511020', credit: '90' },
        { account: '120101', debit: '5' },
        { account: '100101', moneyAccount: 'NOPE', debit: '1', credit: '1' },
      ],
      options,
    );
    expect(unbalanced.status).toBe('INVALID');
    expect(
      (await imports.rows(unbalanced.id, 'ERRORS')).flatMap((row) =>
        row.errors.map((issue) => `${row.rowNo}:${issue.column}:${issue.code}`),
      ),
    ).toEqual(['4:party:REQUIRED', '5:credit:ONE_SIDE', '5:moneyAccount:NOT_FOUND']);

    const rows = [
      {
        account: '120101',
        party: '7701',
        debit: '1000',
        ref: 'Н-777',
        refDate: '2026-06-30',
        dueDate: '2026-07-30',
      },
      { account: '310101', party: '9901', credit: '400', ref: 'ПД-12' },
      { account: '100101', moneyAccount: box.code, debit: '300' },
      { account: '140101', debit: '200' },
      { account: '511020', credit: '1100', description: 'Эздийн өмч (туршилт)' },
    ];
    const job = await imports.check('FIN_OPENING', rows, options);
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0, warningRows: 1 });
    expect((await imports.commit(job.id)).status).toBe('COMMITTED');

    const items = await sql.query<{ ref: string; due: string | null; open: string }>(
      `SELECT i.item_ref AS ref, i.due_date::text AS due, i.open_amount::text AS open
         FROM fin.open_items i JOIN fin.documents d ON d.id = i.document_id
        WHERE d.class = 'OPENING' ORDER BY i.id`,
    );
    expect(items.rows).toEqual([
      { ref: 'Н-777', due: '2026-07-30', open: '1000.00' },
      { ref: 'ПД-12', due: null, open: '400.00' },
    ]);
    const balance = (
      await http()
        .get(`/api/v1/customer-balances/${customer.id}`)
        .set(bearer(accountant))
        .expect(200)
    ).body as { balance: string };
    expect(balance.balance).toBe('1000.00');
    const lines = await sql.query<{ code: string; debit: string; credit: string }>(
      `SELECT a.code, l.debit::text AS debit, l.credit::text AS credit
         FROM fin.journal_lines l JOIN fin.accounts a ON a.id = l.account_id
         JOIN fin.journal_entries e ON e.id = l.entry_id
         JOIN fin.documents d ON d.id = e.document_id
        WHERE d.class = 'OPENING' ORDER BY l.line_no`,
    );
    // The inventory row lands on the opening offset the stock's opening import credits (F4).
    expect(lines.rows.map((row) => row.code)).toEqual([
      '120101',
      '310101',
      '100101',
      '390101',
      '511020',
    ]);
    expect(supplier.id).toBeGreaterThan(0);

    const second = await imports.check('FIN_OPENING', rows, options);
    expect(
      (await imports.rows(second.id, 'ERRORS')).flatMap((row) =>
        row.errors.map((issue) => issue.code),
      ),
    ).toEqual(['OPENING_EXISTS']);

    expect((await imports.revert(job.id)).status).toBe('REVERTED');
    const after = (
      await http()
        .get(`/api/v1/customer-balances/${customer.id}`)
        .set(bearer(accountant))
        .expect(200)
    ).body as { balance: string };
    expect(after.balance).toBe('0.00');
    const again = await imports.check('FIN_OPENING', rows, options);
    expect(again.status).toBe('VALIDATED');
  });

  it('splits a long opening into documents of 499 rows that balance through the offset', async () => {
    const imports = importsApi(app, admin);
    const rows: Record<string, unknown>[] = Array.from({ length: 599 }, () => ({
      account: '730101',
      debit: '1',
    }));
    rows.push({ account: '511020', credit: '599' });
    const job = await imports.check('FIN_OPENING', rows, {
      openingOptions: { date: addDays(today, -1) },
    });
    expect(job).toMatchObject({ status: 'VALIDATED', errorRows: 0 });
    const done = await imports.commit(job.id);
    expect(done.status).toBe('COMMITTED');
    expect(done.summary?.applied?.documents).toBe(2);
    const { rows: offset } = await sql.query<{ documents: string; net: string }>(
      `SELECT count(DISTINCT d.id)::text AS documents,
              coalesce(sum(l.debit - l.credit) FILTER (WHERE a.code = '390101'), 0)::text AS net
         FROM fin.documents d JOIN fin.journal_entries e ON e.document_id = d.id
         JOIN fin.journal_lines l ON l.entry_id = e.id JOIN fin.accounts a ON a.id = l.account_id
        WHERE d.class = 'OPENING' AND d.source_doc_id LIKE $1`,
      [`import:${job.id}:%`],
    );
    expect(offset[0]).toEqual({ documents: '2', net: '0.00' });
    expect((await imports.revert(job.id)).status).toBe('REVERTED');
  });

  it('keeps the chart and opening imports to holders of the journal right', async () => {
    const importer = await customRoleUser(app, admin, ['imports.manage']);
    const fileId = await importsApi(app, importer).upload(
      await sheetOf('FIN_CHART', [{ code: '100301', name: 'Касс 3', kind: 'Хөрөнгө' }]),
    );
    await http()
      .post('/api/v1/imports')
      .set(bearer(importer))
      .set(idempotency())
      .send({ kind: 'FIN_CHART', fileId, fileName: 'chart.xlsx' })
      .expect(403);
  });
});
