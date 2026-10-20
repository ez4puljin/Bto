import type { IntakeCommandV1, LineV1, PartyIn, PostBody } from '@tugeel/fin-contract';
import { addDays, businessDate } from '@tugeel/shared/time';
import {
  FinChartService,
  type FinDb,
  FinIntakeInTx,
  type FinIntakeResult,
  FinReader,
} from '../../src/finance-core';
import { newCommandId } from '../../src/modules/fin-bridge/command-id';
import {
  createFinanceCoreOnly,
  StaticCaller,
  TEST_COMPANY,
  TEST_SOURCE,
  TEST_TENANT,
} from './static-caller';

/**
 * The Finance Core's intake on its own (F2, ADR-0090): the core over this worker's database with
 * the test installation (source TEST_PMS, company TST), its chart, a cash box, and command builders.
 */
export async function intakeCore() {
  const core = await createFinanceCoreOnly();
  await StaticCaller.ensureWithChart(core.db);
  const chart = core.module.get(FinChartService);
  const config = StaticCaller.user({ [TEST_COMPANY]: ['finance.config.manage'] });
  const accounts = await chart.accounts(StaticCaller.source(), { company: TEST_COMPANY });
  const cashAccount = accounts.find((account) => account.code === '1001');
  if (!cashAccount) throw new Error('no cash account');
  const existing = await chart.moneyAccounts(StaticCaller.source(), { company: TEST_COMPANY });
  if (!existing.some((row) => row.code === 'BOX')) {
    await core.db.transaction((tx) =>
      chart.createMoneyAccountInTx(tx, config, {
        company: TEST_COMPANY,
        code: 'BOX',
        name: 'Касс',
        kind: 'CASH',
        branch: null,
        accountId: cashAccount.id,
        bankName: null,
        bankAccountNo: null,
        showToCustomers: false,
      }),
    );
  }
  const intake = core.module.get(FinIntakeInTx);
  const reader = core.module.get(FinReader);
  const submit = (command: IntakeCommandV1, ctx = StaticCaller.source()): Promise<FinIntakeResult> =>
    core.db.transaction((tx) => intake.submitInTx(tx, ctx, command));
  return { ...core, intake, reader, chart, submit };
}

export type IntakeCore = Awaited<ReturnType<typeof intakeCore>>;

export const today = (): string => businessDate();
export const guest = (ref = 'guest:1', name = 'Мөрөн-Од ХХК'): PartyIn => ({
  ref,
  name,
  kind: 'COMPANY',
});

/** A command of source TEST_PMS (or FIN with `system`) around a body. */
export function command(
  source: { docType: string; docId: string; docNo?: string; revision?: number; system?: string },
  body: IntakeCommandV1['body'],
  company = TEST_COMPANY,
): IntakeCommandV1 {
  const { system = TEST_SOURCE, ...rest } = source;
  return {
    contract: 'fin.intake/1.0',
    commandId: newCommandId(),
    tenant: TEST_TENANT,
    company,
    source: { system, ...rest },
    actor: { kind: 'SOURCE', ref: 'test', label: 'Тест' },
    body,
  };
}

const line = (lineNo: number, rest: Omit<LineV1, 'lineNo'>): LineV1 => ({ lineNo, ...rest });

/** An invoice: Dr receivable (an item due `dueDate`), Cr sales. */
export function invoice(
  docId: string,
  amount: string,
  options: { party?: PartyIn; dueDate?: string; date?: string } = {},
): IntakeCommandV1 {
  const date = options.date ?? today();
  const body: PostBody = {
    action: 'POST',
    documentType: 'TEST.INVOICE',
    documentDate: date,
    currency: 'MNT',
    party: options.party ?? guest(),
    dueDate: options.dueDate ?? addDays(date, 30),
    description: `Н-${docId}`,
    controlTotal: amount,
    lines: [
      line(1, { key: 'AR', side: 'DEBIT', amount }),
      line(2, { key: 'SALES', side: 'CREDIT', amount }),
    ],
  };
  return command({ docType: 'INVOICE', docId, docNo: `Н-${docId}` }, body);
}

/** A receipt into the cash box: Dr cash, Cr receivable settling FIFO or the named invoices. */
export function receipt(
  docId: string,
  amount: string,
  settles: LineV1['settles'] | null = 'FIFO',
  options: { party?: PartyIn } = {},
): IntakeCommandV1 {
  return command(
    { docType: 'RECEIPT', docId },
    {
      action: 'POST',
      documentType: 'TEST.RECEIPT',
      documentDate: today(),
      currency: 'MNT',
      party: options.party ?? guest(),
      description: 'Төлбөр',
      controlTotal: amount,
      lines: [
        line(1, { key: 'CASH', side: 'DEBIT', amount, moneyAccount: 'BOX' }),
        line(2, { key: 'AR', side: 'CREDIT', amount, ...(settles === null ? {} : { settles }) }),
      ],
    },
  );
}

/** A reversal of a TEST_PMS document. */
export function reverse(docType: string, docId: string, reason = 'Буруу'): IntakeCommandV1 {
  return command({ docType, docId }, { action: 'REVERSE', reason });
}

/** The core's error code of a refused call (a FinError, or a database error's SQLSTATE). */
export async function codeOf(call: Promise<unknown>): Promise<string | undefined> {
  try {
    await call;
    return undefined;
  } catch (error: unknown) {
    const own = error as { code?: string; cause?: { code?: string } };
    return own.code ?? own.cause?.code;
  }
}

export type { FinDb };
