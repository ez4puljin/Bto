import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import type { ProductJson } from '../harness/catalog';
import { idempotency } from '../harness/catalog';
import { financeApi, type InvoiceJson, salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { type CustomerJson, partnersApi } from '../harness/partners';

interface StatementJson {
  id: number;
  accountNumber: string;
  statementDate: string;
  moneyAccountId: number | null;
  accountCode: string | null;
  lineCount: number;
  feeCount: number;
  totalCredit: string;
  totalDebit: string;
  filledCount: number;
  postedCount: number;
  missing: Record<string, number>;
}
interface LineJson {
  id: number;
  lineNo: number;
  debit: string;
  credit: string;
  bankDescription: string;
  bankCounterpart: string;
  kind: string;
  customerId: number | null;
  supplierId: number | null;
  counterAccountId: number | null;
  counterAccountCode: string | null;
  description: string;
  action: string | null;
  exportType: string | null;
  paymentId: number | null;
  journalEntryId: number | null;
  postedAt: string | null;
  missing: string[];
}
interface DetailJson extends StatementJson {
  lines: LineJson[];
}
interface UploadJson {
  statement: StatementJson | null;
  newLines: number;
  duplicateLines: number;
}
interface PostJson {
  posted: number;
  skipped: number;
  failures: { lineNo: number; code: string }[];
  statement: DetailJson;
}

const HEADER = [
  'Гүйлгээний огноо',
  'Салбар',
  'Эхний үлдэгдэл',
  'Дебит гүйлгээ',
  'Кредит гүйлгээ',
  'Эцсийн үлдэгдэл',
  'Гүйлгээний утга',
  'Харьцсан данс',
];

/** A statement laid out like Khan Bank's; every number and name is made up. */
async function statementFile(rows: readonly (readonly unknown[])[]): Promise<Buffer> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet1');
  sheet.addRow(['Хэвлэсэн огноо:', '', '', '', '', 'Интервал:', '']);
  sheet.addRow(HEADER);
  rows.forEach((row) => sheet.addRow([...row]));
  sheet.addRow(['Нийт дүн:']);
  return Buffer.from(await book.xlsx.writeBuffer());
}

/**
 * «Банкны хуулга хаах» (ADR-0169): a statement comes in once, its lines are filled from the rules and from
 * the last choice for the counterpart, a ready line goes to the books once, a customer's money closes
 * the oldest invoice, a line is taken back by its document's reversal, and a posted statement stays.
 * Synthetic data.
 */
describe('bank statements, «Банкны хуулга хаах»', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let office: string;
  let keeper: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let water: ProductJson;
  let shop: CustomerJson;
  let invoiceOne: InvoiceJson;
  let invoiceTwo: InvoiceJson;
  let bank: { id: number; glAccountId: number; code: string };
  const today = businessDate();
  const yesterday = addDays(today, -1);
  const stamp = `${today.replaceAll('-', '/')}`;
  const http = () => request(app.getHttpServer());
  const NUMBER = '5000000001';
  const FILE = `Statement_MNT_${NUMBER} (1).xlsx`;

  const upload = async (bytes: Buffer, fileName = FILE, token = accountant) => {
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(token))
        .send({
          kind: 'finance.bank_statement',
          contentType: XLSX_CONTENT_TYPE,
          sizeBytes: bytes.length,
        })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http()
      .put(issued.uploadUrl)
      .set('Content-Type', XLSX_CONTENT_TYPE)
      .send(bytes)
      .expect(204);
    return http()
      .post('/api/v1/finance/bank-statements')
      .set(bearer(token))
      .set(idempotency())
      .send({ fileId: issued.fileId, fileName });
  };
  const detail = async (id: number) =>
    (await http().get(`/api/v1/finance/bank-statements/${id}`).set(bearer(accountant)).expect(200))
      .body as DetailJson;
  const patch = (id: number, lineId: number, body: object, token = accountant) =>
    http()
      .patch(`/api/v1/finance/bank-statements/${id}/lines/${lineId}`)
      .set(bearer(token))
      .send(body);
  const post = (id: number, body: object = {}, token = accountant) =>
    http()
      .post(`/api/v1/finance/bank-statements/${id}/post`)
      .set(bearer(token))
      .set(idempotency())
      .send(body);
  const reverse = (id: number, lineId: number) =>
    http()
      .post(`/api/v1/finance/bank-statements/${id}/lines/${lineId}/reverse`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ reason: 'Буруу харилцагч' });

  const sellFor = async (qty: string): Promise<InvoiceJson> => {
    const draft = await flow.draft(shop.id, [{ productUnitId: flow.pcs(water), qty }]);
    await flow.sell(draft.id);
    const invoice = await financeApi(app, accountant).invoiceOfOrder(draft.id);
    if (!invoice) throw new Error('no invoice');
    return invoice;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    keeper = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'BS');
    water = await flow.product('8301', 'Ус', '1000', '500');
    shop = await partnersApi(app, admin).customer({ name: 'Хуулгын дэлгүүр' });
    invoiceOne = await sellFor('5');
    invoiceTwo = await sellFor('7');
    const finance = financeApi(app, admin);
    const gl = (
      await finance
        .createAccount({ code: '110900', name: 'Туршилтын харилцах', journal: 'BANK' })
        .expect(201)
    ).body as { id: number };
    const money = (await http().get('/api/v1/money-accounts').set(bearer(admin)).expect(200))
      .body as { id: number; code: string; glAccountId: number }[];
    const made = money.find((row) => row.glAccountId === gl.id);
    const saved = made
      ? await http()
          .put(`/api/v1/money-accounts/${made.id}`)
          .set(bearer(admin))
          .send({ bankAccountNo: NUMBER })
          .expect(200)
      : await http()
          .post('/api/v1/money-accounts')
          .set(bearer(admin))
          .send({
            code: 'BS-BANK',
            name: 'Туршилтын банк',
            kind: 'BANK',
            branchId: null,
            bankName: 'Туршилт',
            bankAccountNo: NUMBER,
            glAccountId: gl.id,
          })
          .expect(201);
    bank = saved.body as typeof bank;
  });
  afterAll(async () => {
    await app.close();
  });

  it('reads a statement, knows its account and fills fees and settlements from the rules', async () => {
    const uploaded = await upload(
      await statementFile([
        [`${stamp} 09:05`, '5', 0, 0, 8000, 0, 'Хуулгын дэлгүүр тооцоо', 5000000002],
        [`${stamp} 10:00`, '5', 0, -2000, 0, 0, 'Цаасны төлбөр', 5000000003],
        [`${stamp} 10:00:30`, '5', 0, 50, 0, 0, 'Ухаалаг банкны гүйлгээний хураамж', ''],
        [`${stamp} 11:00:30`, '5', 0, 100, 0, 0, 'Гүйлгээний хураамж', ''],
        [`${stamp} 12:00`, '5', 0, 0, 3000, 0, '01/11/2026 SETTLEMENT - TURSHILT', ''],
      ]),
    );
    expect(uploaded.status).toBe(201);
    const body = uploaded.body as UploadJson;
    expect(body).toMatchObject({ newLines: 5, duplicateLines: 0 });
    expect(body.statement).toMatchObject({
      accountNumber: NUMBER,
      statementDate: today,
      moneyAccountId: bank.id,
      accountCode: '110900',
      lineCount: 3,
      feeCount: 2,
      totalCredit: '11000.00',
      totalDebit: '2000.00',
      postedCount: 0,
    });
    const statement = await detail(body.statement?.id ?? 0);
    const [income, paper, fee, , settlement] = statement.lines;
    expect(income).toMatchObject({
      kind: 'NORMAL',
      action: 'CLOSE',
      exportType: null,
      description: 'Дансаар - Хуулгын дэлгүүр тооцоо',
      missing: ['account'],
    });
    expect(paper).toMatchObject({ debit: '2000.00', exportType: 'BANK', missing: ['account'] });
    expect(fee).toMatchObject({ kind: 'FEE', description: 'Банкны шимтгэл', exportType: 'BANK' });
    expect(settlement).toMatchObject({
      kind: 'SETTLEMENT',
      description: 'Пос орлого 01/11/2026 SETTLEMENT - TURSHILT',
    });

    // The calendar and the day list find it.
    const days = (
      await http()
        .get('/api/v1/finance/bank-statements/calendar')
        .query({ month: today.slice(0, 7) })
        .set(bearer(accountant))
        .expect(200)
    ).body as { date: string; count: number }[];
    expect(days).toEqual([{ date: today, count: 1 }]);
    // The office reads the finance screens; a warehouse keeper does not.
    await http()
      .get('/api/v1/finance/bank-statements')
      .query({ date: today })
      .set(bearer(office))
      .expect(200);
    await http()
      .get('/api/v1/finance/bank-statements')
      .query({ date: today })
      .set(bearer(keeper))
      .expect(403);
  });

  it('keeps a file out the second time and adds only the new lines of a later one', async () => {
    const rows = [
      [`${stamp} 09:05`, '5', 0, 0, 8000, 0, 'Хуулгын дэлгүүр тооцоо', 5000000002],
      [`${stamp} 10:00`, '5', 0, -2000, 0, 0, 'Цаасны төлбөр', 5000000003],
      [`${stamp} 10:00:30`, '5', 0, 50, 0, 0, 'Ухаалаг банкны гүйлгээний хураамж', ''],
      [`${stamp} 11:00:30`, '5', 0, 100, 0, 0, 'Гүйлгээний хураамж', ''],
      [`${stamp} 12:00`, '5', 0, 0, 3000, 0, '01/11/2026 SETTLEMENT - TURSHILT', ''],
    ];
    const again = (await upload(await statementFile(rows))).body as UploadJson;
    expect(again).toMatchObject({ statement: null, newLines: 0, duplicateLines: 5 });

    // A later file with one new line: the customer's second transfer from the same account.
    const later = (
      await upload(
        await statementFile([
          ...rows,
          [`${stamp} 13:00`, '5', 0, 0, 1000, 0, 'Дахин тооцоо', 5000000002],
        ]),
      )
    ).body as UploadJson;
    expect(later).toMatchObject({ newLines: 1, duplicateLines: 5 });
    expect(later.statement?.lineCount).toBe(1);
    await http()
      .delete(`/api/v1/finance/bank-statements/${later.statement?.id ?? 0}`)
      .set(bearer(accountant))
      .expect(204);
  });

  it('refuses files it cannot read', async () => {
    const noAccount = await upload(await statementFile([]), 'huulga.xlsx');
    expect(noAccount.status).toBe(422);
    expect((noAccount.body as { code: string }).code).toBe('BANK_STATEMENT_NO_ACCOUNT');
    const empty = await upload(await statementFile([]));
    expect(empty.status).toBe(422);
    expect((empty.body as { code: string }).code).toBe('BANK_STATEMENT_EMPTY');
  });

  it('writes a customer’s money as a voucher that closes the oldest invoice, once', async () => {
    const finance = financeApi(app, accountant);
    const list = (
      await http()
        .get('/api/v1/finance/bank-statements')
        .query({ date: today })
        .set(bearer(accountant))
        .expect(200)
    ).body as StatementJson[];
    const id = list[0]?.id ?? 0;
    let statement = await detail(id);
    const income = statement.lines[0];
    const paper = statement.lines[1];
    if (!income || !paper) throw new Error('lines missing');

    // Naming the customer takes the receivable account by itself.
    const named = (await patch(id, income.id, { customerId: shop.id }).expect(200))
      .body as LineJson;
    const receivable = (await finance.accounts()).find((account) => account.role === 'AR');
    expect(named.counterAccountCode).toBe(receivable?.code);
    expect(named.missing).toEqual([]);
    // A locked and a foreign line refuse.
    const fee = statement.lines[2];
    if (!fee) throw new Error('fee missing');
    const locked = await patch(id, fee.id, { description: 'гараар' }).expect(409);
    expect((locked.body as { code: string }).code).toBe('BANK_LINE_LOCKED');
    await patch(id, income.id, { description: 'оффис' }, office).expect(403);

    // The paper line is an expense without a party.
    const expense = await finance.account('730101');
    await patch(id, paper.id, { counterAccountId: expense.id }).expect(200);

    // The office may not write to the books.
    await post(id, {}, office).expect(403);
    const result = (await post(id).expect(200)).body as PostJson;
    expect(result.failures).toEqual([]);
    expect(result.posted).toBe(5);
    statement = result.statement;
    expect(statement.postedCount).toBe(3);
    const posted = statement.lines[0];
    expect(posted?.paymentId).toEqual(expect.any(Number));
    expect(posted?.postedAt).not.toBeNull();

    // 8,000 closes the 5,000 invoice and 3,000 of the 7,000 one.
    expect(await finance.invoice(invoiceOne.id)).toMatchObject({ openAmount: '0.00' });
    expect(await finance.invoice(invoiceTwo.id)).toMatchObject({ openAmount: '4000.00' });
    const voucher = await finance.paymentGet(posted?.paymentId ?? 0);
    expect(voucher).toMatchObject({
      kind: 'CUSTOMER_PAYMENT',
      amount: '8000.00',
      moneyAccountId: bank.id,
      paidOn: today,
    });

    // The expense is an entry on the bank; the day's two fees one entry of 150.
    const paperEntry = await finance.journalGet(statement.lines[1]?.journalEntryId ?? 0);
    expect(paperEntry.lines?.find((row) => row.accountId === bank.glAccountId)?.credit).toBe(
      '2000.00',
    );
    const feeOne = statement.lines[2];
    const feeTwo = statement.lines[3];
    expect(feeOne?.journalEntryId).toEqual(expect.any(Number));
    expect(feeTwo?.journalEntryId).toBe(feeOne?.journalEntryId);
    const feeEntry = await finance.journalGet(feeOne?.journalEntryId ?? 0);
    expect(feeEntry.lines?.find((row) => row.accountId === bank.glAccountId)?.credit).toBe(
      '150.00',
    );

    // Nothing more to do on a second press; the books have not moved.
    const second = (await post(id).expect(200)).body as PostJson;
    expect(second).toMatchObject({ posted: 0, skipped: 0, failures: [] });
    expect(await finance.invoice(invoiceTwo.id)).toMatchObject({ openAmount: '4000.00' });

    // Posted: no edit, no swap, no delete.
    const edit = await patch(id, income.id, { description: 'засвар' }).expect(409);
    expect((edit.body as { code: string }).code).toBe('BANK_LINE_POSTED');
    const swap = await http()
      .post(`/api/v1/finance/bank-statements/${id}/swap`)
      .set(bearer(accountant))
      .expect(409);
    expect((swap.body as { code: string }).code).toBe('BANK_STATEMENT_POSTED');
    await http()
      .delete(`/api/v1/finance/bank-statements/${id}`)
      .set(bearer(accountant))
      .expect(409);
  });

  it('takes a line back by its document’s reversal and writes it again under a new key', async () => {
    const finance = financeApi(app, accountant);
    const list = (
      await http()
        .get('/api/v1/finance/bank-statements')
        .query({ date: today })
        .set(bearer(accountant))
        .expect(200)
    ).body as StatementJson[];
    const id = list[0]?.id ?? 0;
    const before = await detail(id);
    const income = before.lines[0];
    const fee = before.lines[2];
    if (!income || !fee) throw new Error('lines missing');
    const paymentId = income.paymentId ?? 0;

    const back = (await reverse(id, income.id).expect(200)).body as DetailJson;
    expect(back.lines[0]).toMatchObject({ paymentId: null, postedAt: null });
    expect(await finance.paymentGet(paymentId)).toMatchObject({ status: 'VOID' });
    expect(await finance.invoice(invoiceOne.id)).toMatchObject({ openAmount: '5000.00' });
    // Taking back what is not in the books is refused.
    await reverse(id, income.id).expect(409);

    // Written again: a new voucher, the invoices closed again.
    const again = (await post(id).expect(200)).body as PostJson;
    expect(again.posted).toBe(1);
    const newPayment = again.statement.lines[0]?.paymentId ?? 0;
    expect(newPayment).not.toBe(paymentId);
    expect(await finance.invoice(invoiceOne.id)).toMatchObject({ openAmount: '0.00' });

    // The two fees of one entry come back together.
    const fees = (await reverse(id, fee.id).expect(200)).body as DetailJson;
    expect(fees.lines[2]?.postedAt).toBeNull();
    expect(fees.lines[3]?.postedAt).toBeNull();
    expect(((await post(id).expect(200)).body as PostJson).posted).toBe(2);
  });

  it('remembers the party and the account of a counterpart, and «Үүсгэх» settles nothing', async () => {
    const finance = financeApi(app, accountant);
    const uploaded = (
      await upload(
        await statementFile([
          [`${yesterday.replaceAll('-', '/')} 15:00`, '5', 0, 0, 900, 0, 'Урьдчилгаа', 5000000002],
        ]),
      )
    ).body as UploadJson;
    const id = uploaded.statement?.id ?? 0;
    const statement = await detail(id);
    const line = statement.lines[0];
    if (!line) throw new Error('line missing');
    expect(line).toMatchObject({ customerId: shop.id, missing: [] });

    await patch(id, line.id, { action: 'CREATE' }).expect(200);
    const openBefore = (await finance.invoice(invoiceTwo.id)).openAmount;
    const result = (await post(id).expect(200)).body as PostJson;
    expect(result.posted).toBe(1);
    expect(result.statement.lines[0]?.journalEntryId).toEqual(expect.any(Number));
    expect(result.statement.lines[0]?.paymentId).toBeNull();
    expect((await finance.invoice(invoiceTwo.id)).openAmount).toBe(openBefore);
  });

  it('writes a line once when two presses meet', async () => {
    const finance = financeApi(app, accountant);
    const uploaded = (
      await upload(
        await statementFile([[`${stamp} 15:30`, '5', 0, 0, 1500, 0, 'Давхар дарсан', 5000000002]]),
      )
    ).body as UploadJson;
    const id = uploaded.statement?.id ?? 0;
    const statement = await detail(id);
    expect(statement.lines[0]?.missing).toEqual([]);
    const openBefore = new Decimal((await finance.invoice(invoiceTwo.id)).openAmount);
    const [first, second] = await Promise.all([post(id).expect(200), post(id).expect(200)]);
    const results = [first.body as PostJson, second.body as PostJson];
    expect(results.map((result) => result.posted).reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(results.flatMap((result) => result.failures)).toEqual([]);
    const openAfter = new Decimal((await finance.invoice(invoiceTwo.id)).openAmount);
    expect(openBefore.minus(openAfter).toFixed(2)).toBe('1500.00');
  });

  it('cannot write a statement of an unknown account until it is linked', async () => {
    const uploaded = (
      await upload(
        await statementFile([[`${stamp} 16:00`, '5', 0, 0, 500, 0, 'Гадны данс', '']]),
        'Statement_MNT_5999999999.xlsx',
      )
    ).body as UploadJson;
    const id = uploaded.statement?.id ?? 0;
    expect(uploaded.statement?.moneyAccountId).toBeNull();
    const refused = await post(id).expect(409);
    expect((refused.body as { code: string }).code).toBe('BANK_STATEMENT_UNLINKED');

    const linked = (
      await http()
        .put(`/api/v1/finance/bank-statements/${id}/money-account`)
        .set(bearer(accountant))
        .send({ moneyAccountId: bank.id })
        .expect(200)
    ).body as StatementJson;
    expect(linked).toMatchObject({ moneyAccountId: bank.id, accountCode: '110900' });

    // The swap turns the income into money out, with its export type.
    const swapped = (
      await http()
        .post(`/api/v1/finance/bank-statements/${id}/swap`)
        .set(bearer(accountant))
        .expect(200)
    ).body as DetailJson;
    expect(swapped.lines[0]).toMatchObject({ debit: '500.00', credit: '0.00', exportType: 'BANK' });

    // Bulk: the party and account on the line, and the text from the bank's.
    const line = swapped.lines[0];
    if (!line) throw new Error('line missing');
    const expense = await financeApi(app, accountant).account('730101');
    const bulk = (
      await http()
        .post(`/api/v1/finance/bank-statements/${id}/lines/bulk`)
        .set(bearer(accountant))
        .send({ lineIds: [line.id], counterAccountId: expense.id, descriptionFromBank: true })
        .expect(200)
    ).body as { updated: number; statement: DetailJson };
    expect(bulk.updated).toBe(1);
    expect(bulk.statement.lines[0]).toMatchObject({
      counterAccountId: expense.id,
      description: 'Дансаар - Гадны данс',
      missing: [],
    });

    // A party that does not exist is refused, not a 500.
    await patch(id, line.id, { customerId: 999_999 }).expect(422);
    await http()
      .post(`/api/v1/finance/bank-statements/${id}/lines/bulk`)
      .set(bearer(accountant))
      .send({ lineIds: [line.id], supplierId: 999_999 })
      .expect(422);
  });

  it('applies «Экспорт» in bulk to money out and leaves money in among the ticked lines alone', async () => {
    const uploaded = (
      await upload(
        await statementFile([
          [`${stamp} 18:00`, '5', 0, 0, 700, 0, 'Бөөн орлого', 5000000020],
          [`${stamp} 18:01`, '5', 0, -800, 0, 0, 'Бөөн зарлага', 5000000021],
        ]),
      )
    ).body as UploadJson;
    const id = uploaded.statement?.id ?? 0;
    const [income, outgo] = (await detail(id)).lines;
    const bulk = (
      await http()
        .post(`/api/v1/finance/bank-statements/${id}/lines/bulk`)
        .set(bearer(accountant))
        .send({ lineIds: [income?.id, outgo?.id], exportType: 'CASH' })
        .expect(200)
    ).body as { updated: number; statement: DetailJson };
    expect(bulk.updated).toBe(2);
    expect(bulk.statement.lines[0]?.exportType).toBeNull();
    expect(bulk.statement.lines[1]?.exportType).toBe('CASH');
    await http()
      .delete(`/api/v1/finance/bank-statements/${id}`)
      .set(bearer(accountant))
      .expect(204);
  });

  it('saves the rules and fills the open fee and settlement lines again', async () => {
    const rules = (
      await http().get('/api/v1/finance/bank-statements/rules').set(bearer(accountant)).expect(200)
    ).body as Record<string, unknown>;
    const other = await financeApi(app, accountant).account('730101');
    const saved = (
      await http()
        .put('/api/v1/finance/bank-statements/rules')
        .set(bearer(accountant))
        .send({ ...rules, feeDescription: 'Шимтгэл', feeAccountId: other.id, partyCode: '99999' })
        .expect(200)
    ).body as Record<string, unknown>;
    expect(saved).toMatchObject({ feeDescription: 'Шимтгэл', partyCode: '99999' });
    const uploaded = (
      await upload(
        await statementFile([[`${stamp} 17:00`, '5', 0, 30, 0, 0, 'Гүйлгээний хураамж 2', '']]),
      )
    ).body as UploadJson;
    const id = uploaded.statement?.id ?? 0;
    expect((await detail(id)).lines[0]).toMatchObject({
      kind: 'FEE',
      description: 'Шимтгэл',
      counterAccountId: other.id,
    });
    await http()
      .put('/api/v1/finance/bank-statements/rules')
      .set(bearer(accountant))
      .send({ ...rules, feeDescription: 'Шинэ утга', partyCode: '99999' })
      .expect(200);
    expect((await detail(id)).lines[0]).toMatchObject({ description: 'Шинэ утга' });
    await http()
      .put('/api/v1/finance/bank-statements/rules')
      .set(bearer(office))
      .send({ ...rules, partyCode: '1' })
      .expect(403);
  });

  it('makes Erkhet’s three files with its columns and a built-in date format', async () => {
    const list = (
      await http()
        .get('/api/v1/finance/bank-statements')
        .query({ date: today })
        .set(bearer(accountant))
        .expect(200)
    ).body as StatementJson[];
    const id = list.find((row) => row.accountNumber === NUMBER)?.id ?? 0;
    const statement = await detail(id);
    const income = statement.lines[0];

    const fetchBook = async (path: string, query: object) => {
      const response = await http()
        .get(`/api/v1/finance/bank-statements/${path}`)
        .query(query)
        .set(bearer(accountant))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      const book = new ExcelJS.Workbook();
      const bytes: unknown = response.body;
      await book.xlsx.load(bytes as ArrayBuffer);
      const sheet = book.worksheets[0];
      if (!sheet) throw new Error('no sheet');
      return sheet;
    };

    const receivable = await fetchBook(`${id}/export.xlsx`, { file: 'RECEIVABLE' });
    expect(receivable.getRow(1).getCell(1).value).toBe('Огноо');
    expect(receivable.getRow(1).getCell(20).value).toBe('Дүн');
    expect(receivable.getColumn(1).numFmt).toBe('mm-dd-yy');
    const row = receivable.getRow(2);
    expect(row.getCell(1).numFmt).toBe('mm-dd-yy');
    expect((row.getCell(1).value as Date).toISOString().slice(0, 10)).toBe(today);
    expect(row.getCell(2).value).toBe(income?.description);
    expect(row.getCell(4).value).toBe(shop.code);
    expect(row.getCell(5).value).toBe(income?.counterAccountCode);
    expect(row.getCell(15).value).toBe(1);
    expect(row.getCell(16).value).toBe('110900');
    expect(row.getCell(20).value).toBe(8000);

    // The settlement: its text's date, the bank in «Харьцсан данс», the clearing in «Дансны код».
    const settlementRow = receivable.getRow(3);
    expect((settlementRow.getCell(1).value as Date).toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(settlementRow.getCell(5).value).toBe('110900');
    expect(settlementRow.getCell(4).value).toBe('99999');

    const money = await fetchBook('export-by-date.xlsx', { date: today, file: 'BANK' });
    expect(money.getRow(1).getCell(14).value).toBe('Орлого бол 1 Зарлага бол 2');
    expect(money.getRow(1).getCell(19).value).toBe('Дүн');
    const paper = money.getRow(2);
    expect(paper.getCell(4).value).toBe('730101');
    expect(paper.getCell(14).value).toBe(2);
    expect(paper.getCell(15).value).toBe('110900');
    expect(paper.getCell(19).value).toBe(2000);

    const manifest = (
      await http()
        .get('/api/v1/finance/bank-statements/export-manifest')
        .query({ date: today })
        .set(bearer(accountant))
        .expect(200)
    ).body as { RECEIVABLE: number; BANK: number; CASH: number; fees: number };
    expect(manifest.CASH).toBe(0);
    expect(manifest.BANK).toBeGreaterThan(0);
    expect(manifest.fees).toBeGreaterThan(0);

    const fees = await fetchBook('export-fees.xlsx', { from: today, to: today });
    expect(fees.getRow(2).getCell(3).value).toBe('99999');
    expect(fees.getRow(2).getCell(14).value).toBe(2);
    expect(fees.getRow(2).getCell(19).value).toBe(180);
  });
});
