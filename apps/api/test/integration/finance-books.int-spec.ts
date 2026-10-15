import type { NestExpressApplication } from '@nestjs/platform-express';
import { DEFAULT_GL_ACCOUNTS, FINANCE_NUMBER_DEFAULTS } from '@tugeel/shared/finance';
import { addDays, businessDate } from '@tugeel/shared/time';
import { createHttpApp } from '../harness/apps';
import { financeApi, type JournalEntryJson, type ProblemJson } from '../harness/finance';
import { login, seedUser } from '../harness/identity';

/**
 * The books (ADR-0060 #7, #8): the seeded chart of accounts and its roles, manual entries that
 * balance or are refused, reversals, the account ledger, the money accounts and the number formats.
 * Synthetic data only.
 */
describe('finance books', () => {
  let app: NestExpressApplication;
  let admin: string;
  let accountant: string;
  let office: string;
  const today = businessDate();

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
  });
  afterAll(async () => {
    await app.close();
  });

  it('seeds the chart of accounts with one account per role; roles move only when free', async () => {
    const finance = financeApi(app, accountant);
    const accounts = await finance.accounts();
    for (const seeded of DEFAULT_GL_ACCOUNTS) {
      expect(accounts.find((account) => account.code === seeded.code)).toMatchObject({
        kind: seeded.kind,
        role: seeded.role,
        status: 'ACTIVE',
      });
    }
    // The office reads, the accountant adds and renames, only an admin moves a role.
    await financeApi(app, office)
      .createAccount({ code: '120102', name: 'X', kind: 'ASSET' })
      .expect(403);
    const created = (
      await finance
        .createAccount({ code: '120102', name: ' Бусад авлага ', kind: 'ASSET' })
        .expect(201)
    ).body as { id: number; name: string; role: string | null };
    expect(created).toMatchObject({ name: 'Бусад авлага', role: null });
    expect(
      (
        (await finance.createAccount({ code: '120102', name: 'Давхар', kind: 'ASSET' }).expect(409))
          .body as ProblemJson
      ).code,
    ).toBe('DUPLICATE_VALUE');
    await finance.patchAccount(created.id, { name: 'Бусад авлага 2' }).expect(200);
    const ar = await finance.account('120101');
    await finance.setRole(created.id, 'AR').expect(403);
    const admins = financeApi(app, admin);
    expect(
      ((await admins.setRole(created.id, 'AR').expect(409)).body as ProblemJson).params,
    ).toMatchObject({ role: 'AR', code: '120101' });
    // An account holding a role stays active.
    await admins.patchAccount(ar.id, { status: 'INACTIVE' }).expect(422);
    await admins.setRole(ar.id, null).expect(200);
    await admins.setRole(created.id, 'AR').expect(200);
    expect(await finance.account('120102')).toMatchObject({ role: 'AR' });
    // Back as it was, for the other tests of this database.
    await admins.setRole(created.id, null).expect(200);
    await admins.setRole(ar.id, 'AR').expect(200);
    await admins.patchAccount(created.id, { status: 'INACTIVE' }).expect(200);
  });

  it('posts manual entries that balance, refuses the rest, and reverses by hand', async () => {
    const finance = financeApi(app, accountant);
    const cash = await finance.account('100101');
    const income = await finance.account('511020');
    const inactive = (
      await finance.createAccount({ code: '999999', name: 'Хаасан', kind: 'EXPENSE' }).expect(201)
    ).body as { id: number };
    await finance.patchAccount(inactive.id, { status: 'INACTIVE' }).expect(200);
    const lines = [
      { accountId: cash.id, debit: '5000' },
      { accountId: income.id, credit: '5000', description: 'Бусад орлого' },
    ];
    await financeApi(app, office)
      .journal({ entryDate: today, description: 'Туршилт', lines })
      .expect(403);
    const unbalanced = (
      await finance
        .journal({
          entryDate: today,
          description: 'Тэнцэхгүй',
          lines: [
            { accountId: cash.id, debit: '5000' },
            { accountId: income.id, credit: '4000' },
          ],
        })
        .expect(422)
    ).body as ProblemJson;
    expect(unbalanced).toMatchObject({
      code: 'JOURNAL_UNBALANCED',
      params: { debit: '5000.00', credit: '4000.00' },
    });
    expect(
      (
        (
          await finance
            .journal({
              entryDate: today,
              description: 'Хоёр тал',
              lines: [
                { accountId: cash.id, debit: '5000', credit: '5000' },
                { accountId: income.id },
              ],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'lines[0]', constraint: 'oneSide' })]);
    expect(
      (
        (
          await finance
            .journal({
              entryDate: today,
              description: 'Хаасан данс',
              lines: [
                { accountId: inactive.id, debit: '5000' },
                { accountId: income.id, credit: '5000' },
              ],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'lines[0].accountId', constraint: 'active' })]);
    await finance
      .journal({ entryDate: addDays(today, 1), description: 'Маргааш', lines })
      .expect(422);
    const entry = (
      await finance.journal({ entryDate: today, description: ' Бусад орлого ', lines }).expect(201)
    ).body as JournalEntryJson;
    expect(entry).toMatchObject({
      number: expect.stringMatching(/^Ж-\d{8}-\d{4}$/),
      source: 'MANUAL',
      description: 'Бусад орлого',
      amount: '5000.00',
      lineCount: 2,
      reversedById: null,
    });
    expect(
      entry.lines?.map((line) => [line.lineNo, line.accountCode, line.debit, line.credit]),
    ).toEqual([
      [1, '100101', '5000.00', '0.00'],
      [2, '511020', '0.00', '5000.00'],
    ]);
    // The account ledger runs a balance; the list filters by account and source.
    const ledger = await finance.accountLedger(income.id);
    expect(ledger.data[0]).toMatchObject({ entryNumber: entry.number, credit: '5000.00' });
    expect(ledger.data.map((row) => row.entryId)).toContain(entry.id);
    const listed = await finance.journalList({ accountId: income.id, source: 'MANUAL' });
    expect(listed.data.map((row) => row.id)).toContain(entry.id);
    // Reversed once, by hand only for manual entries.
    const reversal = (await finance.reverse(entry.id, 'Буруу бичилт').expect(200))
      .body as JournalEntryJson;
    expect(reversal).toMatchObject({
      reversesId: entry.id,
      reversesNumber: entry.number,
      source: 'MANUAL',
      amount: '5000.00',
    });
    expect(reversal.lines?.map((line) => [line.accountCode, line.debit, line.credit])).toEqual([
      ['100101', '0.00', '5000.00'],
      ['511020', '5000.00', '0.00'],
    ]);
    expect(await finance.journalGet(entry.id)).toMatchObject({ reversedById: reversal.id });
    await finance.reverse(entry.id, 'Дахин').expect(422);
    expect((await finance.account('511020')).balance).toBe(
      (await finance.account('511020')).balance,
    );
  });

  it('keeps the cash boxes and bank accounts on asset accounts', async () => {
    const finance = financeApi(app, admin);
    const bank = await finance.account('110101');
    const sales = await finance.account('510101');
    await financeApi(app, accountant)
      .createMoneyAccount({
        code: 'KHAN-FB',
        name: 'Хаан банк',
        kind: 'BANK',
        glAccountId: bank.id,
      })
      .expect(403);
    await finance
      .createMoneyAccount({ code: 'BAD-FB', name: 'Буруу', kind: 'BANK', glAccountId: sales.id })
      .expect(422);
    const account = (
      await finance
        .createMoneyAccount({
          code: 'KHAN-FB',
          name: 'Хаан банк',
          kind: 'BANK',
          glAccountId: bank.id,
          bankName: 'Хаан банк',
          bankAccountNo: '5000000000',
        })
        .expect(201)
    ).body as { id: number; balance: string; glAccountCode: string };
    expect(account).toMatchObject({ balance: '0.00', glAccountCode: '110101' });
    await finance
      .patchMoneyAccount(account.id, { name: 'Хаан банк — төв', status: 'INACTIVE' })
      .expect(200);
    expect((await finance.moneyAccounts()).find((row) => row.id === account.id)).toMatchObject({
      name: 'Хаан банк — төв',
      status: 'INACTIVE',
    });
    // An inactive account takes no voucher.
    await financeApi(app, accountant)
      .payment({
        kind: 'OTHER_IN',
        moneyAccountId: account.id,
        glAccountId: (await finance.account('511020')).id,
        amount: '100',
        paidOn: today,
      })
      .expect(422);
  });

  it('numbers documents with the configured formats, the defaults until saved', async () => {
    const finance = financeApi(app, admin);
    expect(await finance.numbering()).toMatchObject({
      ...FINANCE_NUMBER_DEFAULTS,
      updatedAt: null,
    });
    const body = {
      ...FINANCE_NUMBER_DEFAULTS,
      JOURNAL: { pattern: 'J{year}{month}{day}-', digits: 5 },
    };
    await financeApi(app, accountant).setNumbering(body).expect(403);
    expect(
      (
        (
          await finance
            .setNumbering({ ...body, INVOICE: { pattern: 'Н-{year}1', digits: 4 } })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'INVOICE.pattern' })]);
    await finance.setNumbering(body).expect(200);
    expect(await finance.numbering()).toMatchObject({
      JOURNAL: { pattern: 'J{year}{month}{day}-', digits: 5 },
      updatedAt: expect.any(String),
    });
    const cash = await finance.account('100101');
    const income = await finance.account('511020');
    const entry = (
      await financeApi(app, accountant)
        .journal({
          entryDate: today,
          description: 'Дугаарлалт',
          lines: [
            { accountId: cash.id, debit: '100' },
            { accountId: income.id, credit: '100' },
          ],
        })
        .expect(201)
    ).body as JournalEntryJson;
    expect(entry.number).toMatch(/^J\d{8}-\d{5}$/);
    await finance.setNumbering(FINANCE_NUMBER_DEFAULTS).expect(200);
  });
});
