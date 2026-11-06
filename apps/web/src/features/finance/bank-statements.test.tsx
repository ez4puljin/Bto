import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import mn from '@tugeel/shared/i18n/mn.json';
import { describe, expect, it, vi } from 'vitest';
import { ACCOUNTANT_ME, bodyOf, calls, list, UUID } from '@/test/inventory-fixtures';
import { json, problem, renderApp, signedIn } from '@/test/render-app';

vi.mock('@/lib/upload', () => ({ uploadFile: vi.fn(() => Promise.resolve(5)) }));

const TEXT = mn.finance.bankStatements;

const STATEMENT = {
  id: 7,
  accountNumber: '5000000001',
  currency: 'MNT',
  statementDate: '2026-11-05',
  dateTo: '2026-11-05',
  fileName: 'Statement_MNT_5000000001.xlsx',
  uploadedAt: '2026-11-06T01:00:00.000Z',
  moneyAccountId: 3,
  moneyAccountName: 'Туршилтын банк',
  accountCode: '110900',
  lineCount: 2,
  feeCount: 1,
  totalCredit: '168980.00',
  totalDebit: '2180000.00',
  filledCount: 1,
  postedCount: 0,
  missing: { party: 1, account: 0, description: 0, action: 0, export: 0 },
};

const line = (fields: Record<string, unknown>) => ({
  id: 71,
  lineNo: 1,
  txnAt: '2026-11-05T01:05:00.000Z',
  businessDate: '2026-11-05',
  debit: '0.00',
  credit: '168980.00',
  bankDescription: 'Туршилтын дэлгүүр',
  bankCounterpart: '5000000002',
  kind: 'NORMAL',
  customerId: null,
  customerName: null,
  customerCode: null,
  supplierId: null,
  supplierName: null,
  supplierCode: null,
  counterAccountId: 11,
  counterAccountCode: '120101',
  counterAccountName: 'Авлага',
  description: 'Дансаар - Туршилтын дэлгүүр',
  action: 'CLOSE',
  exportType: null,
  paymentId: null,
  journalEntryId: null,
  postedAt: null,
  missing: ['party'],
  ...fields,
});

const LINES = [
  line({}),
  line({
    id: 72,
    lineNo: 2,
    debit: '2180000.00',
    credit: '0.00',
    bankDescription: 'Цаасны төлбөр',
    counterAccountCode: '730101',
    counterAccountName: 'Бусад зардал',
    counterAccountId: 12,
    exportType: 'BANK',
    paymentId: null,
    journalEntryId: 500,
    postedAt: '2026-11-06T02:00:00.000Z',
    missing: [],
  }),
  line({
    id: 73,
    lineNo: 3,
    debit: '50.00',
    credit: '0.00',
    kind: 'FEE',
    bankDescription: 'Гүйлгээний хураамж',
    description: 'Банкны шимтгэл',
    exportType: 'BANK',
    missing: [],
  }),
];

const RULES = {
  settlementAccountId: 13,
  settlementDescription: 'Пос орлого',
  settlementAction: 'CLOSE',
  feeAccountId: 12,
  feeDescription: 'Банкны шимтгэл',
  feeAction: 'CLOSE',
  feeExportType: 'BANK',
  partyCode: '30000',
  counterAccountIds: [11],
};

const ACCOUNT = (id: number, code: string, name: string) => ({
  id,
  code,
  name,
  kind: 'ASSET',
  role: null,
  status: 'ACTIVE',
  groupId: null,
  journal: 'GENERAL',
  currency: 'MNT',
  debit: '0.00',
  credit: '0.00',
  balance: '0.00',
});

const routes = () => ({
  'GET /api/v1/finance/bank-statements/calendar': () => json([{ date: '2026-11-05', count: 1 }]),
  'GET /api/v1/finance/bank-statements': () => json([STATEMENT]),
  'GET /api/v1/finance/bank-statements/7': () => json({ ...STATEMENT, lines: LINES }),
  'GET /api/v1/finance/bank-statements/rules': () => json(RULES),
  'GET /api/v1/gl-accounts': () =>
    json([
      ACCOUNT(11, '120101', 'Авлага'),
      ACCOUNT(12, '730101', 'Бусад зардал'),
      ACCOUNT(13, '120105', 'Посын тооцоо'),
    ]),
  'GET /api/v1/money-accounts': () =>
    json([
      {
        id: 3,
        code: '110900',
        name: 'Туршилтын банк',
        kind: 'BANK',
        status: 'ACTIVE',
        glAccountId: 20,
        glAccountCode: '110900',
        glAccountName: 'Туршилтын банк',
        bankAccountNo: null,
      },
    ]),
});

describe('«Тооцоо хаах» (ADR-0169)', () => {
  it('shows the day’s statements with how far each is filled, and what they lack', async () => {
    renderApp('/finance/bank-statements?date=2026-11-05', signedIn(ACCOUNTANT_ME, routes()));
    expect(await screen.findByRole('heading', { name: TEXT.title })).toBeInTheDocument();
    expect(await screen.findByText('5000000001')).toBeInTheDocument();
    expect(screen.getByText('110900')).toBeInTheDocument();
    expect(screen.getByText('1/2 бөглөсөн')).toBeInTheDocument();
    expect(screen.getByText('Харилцагч 1/2')).toBeInTheDocument();
    // The calendar marks the day with its count.
    expect(await screen.findByRole('button', { name: '2026-11-05: 1 хуулга' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens a statement: open lines are edited, posted and locked ones only read', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'PATCH /api/v1/finance/bank-statements/7/lines/71': () => json(line({ description: 'Шинэ' })),
    });
    renderApp('/finance/bank-statements?date=2026-11-05&statement=7', fetchMock);
    const description = await screen.findByRole('textbox', {
      name: `1-р мөрийн ${TEXT.columns.description}`,
    });
    // The posted line links its entry and can be taken back.
    expect(await screen.findByRole('link', { name: TEXT.statement.inBooks })).toHaveAttribute(
      'href',
      '/finance/journal?entry=500',
    );
    expect(screen.getByRole('button', { name: '2-р мөрийг дэвтрээс буцаах' })).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: `2-р мөрийн ${TEXT.columns.description}` }),
    ).not.toBeInTheDocument();

    // Only the changed cell goes to the server, when the field is left.
    await user.clear(description);
    await user.type(description, 'Шинэ');
    await user.tab();
    const patchPath = '/api/v1/finance/bank-statements/7/lines/71';
    await waitFor(() => expect(calls(fetchMock, 'PATCH', patchPath)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', patchPath)[0])).toEqual({ description: 'Шинэ' });
    // Fees are on their own tab.
    expect(screen.queryByText('Гүйлгээний хураамж')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: TEXT.statement.views.fees }));
    expect(await screen.findByText('Гүйлгээний хураамж')).toBeInTheDocument();
  });

  it('finds a customer or a supplier in one field and saves the choice alone', async () => {
    const user = userEvent.setup();
    const party = {
      code: 'C-1',
      kind: 'COMPANY',
      status: 'ACTIVE',
      phone: null,
      regNo: null,
      tin: null,
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'GET /api/v1/customers': () => list([{ ...party, id: 9, name: 'Номин дэлгүүр' }]),
      'GET /api/v1/suppliers': () =>
        list([{ ...party, id: 4, code: 'S-1', name: 'Номин нийлүүлэгч' }]),
      'PATCH /api/v1/finance/bank-statements/7/lines/71': () => json(line({ supplierId: 4 })),
    });
    renderApp('/finance/bank-statements?date=2026-11-05&statement=7', fetchMock);
    const field = await screen.findByRole('combobox', {
      name: `1-р мөрийн ${TEXT.columns.party}`,
    });
    await user.click(field);
    await user.paste('Номин');
    expect(await screen.findByRole('option', { name: 'Номин дэлгүүр · C-1' })).toBeInTheDocument();
    await user.click(
      await screen.findByRole('option', {
        name: `Номин нийлүүлэгч · S-1 (${TEXT.party.supplier})`,
      }),
    );
    const path = '/api/v1/finance/bank-statements/7/lines/71';
    await waitFor(() => expect(calls(fetchMock, 'PATCH', path)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PATCH', path)[0])).toEqual({ supplierId: 4 });
  }, 15_000);

  it('applies the bulk bar to the ticked lines, and fills their text from the bank’s', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/bank-statements/7/lines/bulk': () =>
        json({ updated: 1, statement: { ...STATEMENT, lines: LINES } }),
    });
    renderApp('/finance/bank-statements?date=2026-11-05&statement=7', fetchMock);
    await user.click(
      await screen.findByRole('checkbox', { name: `1-р мөрийн ${TEXT.columns.select}` }),
    );
    const bar = await screen.findByRole('region', { name: '1 мөр' });
    await user.selectOptions(
      within(bar).getByRole('combobox', { name: TEXT.bulk.action }),
      'CREATE',
    );
    await user.click(within(bar).getByRole('button', { name: TEXT.bulk.apply }));
    const path = '/api/v1/finance/bank-statements/7/lines/bulk';
    await waitFor(() => expect(calls(fetchMock, 'POST', path)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'POST', path)[0])).toEqual({
      lineIds: [71],
      action: 'CREATE',
    });
    // The bar goes when it is done.
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: '1 мөр' })).not.toBeInTheDocument(),
    );
  }, 15_000);

  it('writes the ready lines to the books after asking, with a key, and lists what failed', async () => {
    const user = userEvent.setup();
    const ready = line({ id: 74, lineNo: 4, missing: [] });
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'GET /api/v1/finance/bank-statements/7': () =>
        json({ ...STATEMENT, lines: [...LINES, ready] }),
      'POST /api/v1/finance/bank-statements/7/post': () =>
        json({
          posted: 0,
          skipped: 1,
          failures: [{ lineId: 74, lineNo: 4, code: 'BANK_LINE_INCOMPLETE', detail: 'lacks data' }],
          statement: { ...STATEMENT, lines: [...LINES, ready] },
        }),
    });
    renderApp('/finance/bank-statements?date=2026-11-05&statement=7', fetchMock);
    await user.click(await screen.findByRole('button', { name: TEXT.statement.post }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: TEXT.statement.post }));
    expect(await screen.findByText(TEXT.statement.failedTitle)).toBeInTheDocument();
    expect(screen.getByText(/4-р мөр: Мөрийн мэдээлэл дутуу байна/)).toBeInTheDocument();
    expect(screen.getByText('1 мөр дутуу тул бичигдсэнгүй')).toBeInTheDocument();
    const posted = calls(fetchMock, 'POST', '/api/v1/finance/bank-statements/7/post')[0];
    expect(posted?.headers.get('Idempotency-Key')).toMatch(UUID);
  });

  it('asks for the bank account of a number it does not know', async () => {
    const user = userEvent.setup();
    const unknown = {
      ...STATEMENT,
      moneyAccountId: null,
      moneyAccountName: null,
      accountCode: null,
    };
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'GET /api/v1/finance/bank-statements/7': () => json({ ...unknown, lines: [line({})] }),
      'PUT /api/v1/finance/bank-statements/7/money-account': () => json(STATEMENT),
    });
    renderApp('/finance/bank-statements?date=2026-11-05&statement=7', fetchMock);
    expect(await screen.findByText(TEXT.link.title)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: TEXT.statement.post })).toBeDisabled();
    const pick = await screen.findByRole('combobox', { name: TEXT.link.pick });
    await within(pick).findByRole('option', { name: '110900 · Туршилтын банк' });
    await user.selectOptions(pick, '3');
    await user.click(screen.getByRole('button', { name: TEXT.link.action }));
    const linkPath = '/api/v1/finance/bank-statements/7/money-account';
    await waitFor(() => expect(calls(fetchMock, 'PUT', linkPath)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', linkPath)[0])).toEqual({ moneyAccountId: 3 });
  });

  it('shows a refused upload next to the button', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'POST /api/v1/finance/bank-statements': () => problem('BANK_STATEMENT_NO_ACCOUNT', 422),
    });
    renderApp('/finance/bank-statements?date=2026-11-05', fetchMock);
    const input = await screen.findByLabelText(TEXT.day.fileLabel);
    await user.upload(
      input,
      new File(['x'], 'huulga.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    );
    expect(await screen.findByText(mn.errors.BANK_STATEMENT_NO_ACCOUNT)).toBeInTheDocument();
  });

  it('saves the rules and adds an account to those offered first', async () => {
    const user = userEvent.setup();
    const fetchMock = signedIn(ACCOUNTANT_ME, {
      ...routes(),
      'PUT /api/v1/finance/bank-statements/rules': () => json(RULES),
    });
    renderApp('/finance/bank-statements?tab=settings', fetchMock);
    const fee = await screen.findByLabelText(TEXT.settings.description, {
      selector: '#bank-fee-description',
    });
    await user.clear(fee);
    await user.type(fee, 'Шимтгэл');
    await user.click(screen.getByRole('button', { name: TEXT.settings.save }));
    const rulesPath = '/api/v1/finance/bank-statements/rules';
    await waitFor(() => expect(calls(fetchMock, 'PUT', rulesPath)).toHaveLength(1));
    expect(await bodyOf(calls(fetchMock, 'PUT', rulesPath)[0])).toMatchObject({
      feeDescription: 'Шимтгэл',
      partyCode: '30000',
      counterAccountIds: [11],
    });
  });
});
