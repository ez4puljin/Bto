import { Injectable } from '@nestjs/common';
import type { FinOpeningImportOptions } from '@tugeel/shared/imports';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate, isIsoDate } from '@tugeel/shared/time';
import type { Db, Tx } from '../../../common/db/db.types';
import {
  CUSTOMER_CONTROLS,
  FinanceImportsService,
  type OpeningLine,
  SUPPLIER_CONTROLS,
} from '../../finance';
import type { Actor } from '../../identity';
import { CustomersService, SuppliersService } from '../../partners';
import {
  type AppliedRow,
  type CheckedRow,
  type CommittedRow,
  type Importer,
  type ImportJobRow,
  type Progress,
  RowCheck,
  type SourceRow,
} from './importer';
import { decimalCell } from './lookups';

const AMOUNT_MAX = new Decimal('999999999999.99');
const MAX_REF = 128;
const MAX_DESCRIPTION = 300;

interface OpeningChanges {
  /** How many OPENING documents the import posted (keys `import:<id>:1..n`). */
  documents: number;
}

export function openingOptionsOf(job: Pick<ImportJobRow, 'options'>): FinOpeningImportOptions {
  const value = job.options as Partial<FinOpeningImportOptions> | null;
  if (!value || typeof value.date !== 'string' || !isIsoDate(value.date)) {
    throw new Error('an opening import without its date');
  }
  return { date: value.date };
}

/**
 * The opening trial balance from a sheet (ADR-0102 #5, #6): every row one debit or credit line on an
 * account by its code; a receivable or advance received names its customer by code, a payable or
 * advance paid its supplier by code (each its own open item with the original document's number,
 * date and due date); a cash or bank line its money account. Rows on the account INVENTORY points
 * to go to the opening offset account, which the stock's opening import credited (F4). The whole
 * file balances; it posts as OPENING documents of at most 499 rows dated the import's date, the last
 * day of the month before Bto starts (ADR-0106 #5: Bto starts on a month's 1st). One opening at a time: a second waits until the first is reverted.
 */
@Injectable()
export class FinOpeningImporter implements Importer<OpeningLine> {
  readonly kind = 'FIN_OPENING' as const;

  constructor(
    private readonly finance: FinanceImportsService,
    private readonly customers: CustomersService,
    private readonly suppliers: SuppliersService,
  ) {}

  async validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
    job?: ImportJobRow,
  ): Promise<CheckedRow<OpeningLine>[]> {
    if (!job) throw new Error('an opening import is validated with its job');
    const { date } = openingOptionsOf(job);
    const facts = await this.finance.openingFacts(executor);
    const parsed = rows.map((row) => {
      const check = new RowCheck(row);
      return {
        check,
        account: check.text('account', true),
        party: check.text('party'),
        moneyAccount: check.text('moneyAccount'),
        debit: check.text('debit'),
        credit: check.text('credit'),
        ref: check.text('ref'),
        refDate: check.text('refDate'),
        dueDate: check.text('dueDate'),
        description: check.text('description'),
      };
    });
    const parties = [...new Set(parsed.flatMap((row) => (row.party ? [row.party.trim()] : [])))];
    const customerByCode = new Map(
      (await this.customers.findByCodes(parties, executor)).map((row) => [row.code, row]),
    );
    const supplierByCode = new Map(
      (await this.suppliers.findByCodes(parties, executor)).map((row) => [row.code, row]),
    );

    let debitTotal = new Decimal(0);
    let creditTotal = new Decimal(0);
    const planned = parsed.map((row) => {
      const { check } = row;
      const account = row.account === null ? undefined : facts.accounts.get(row.account.trim());
      if (row.account !== null && !account) {
        check.error('account', 'NOT_FOUND', { value: row.account });
      } else if (account && account.status !== 'ACTIVE') check.error('account', 'NOT_ALLOWED');

      const read = (column: 'debit' | 'credit', text: string | null): Decimal | null => {
        if (text === null) return null;
        const value = decimalCell(text, 2, AMOUNT_MAX);
        if (!value.ok) {
          check.error(column, value.code);
          return null;
        }
        if (value.value.isZero()) {
          check.error(column, 'NOT_POSITIVE');
          return null;
        }
        return value.value;
      };
      const debit = read('debit', row.debit);
      const credit = read('credit', row.credit);
      if (row.debit === null && row.credit === null) check.error('debit', 'REQUIRED');
      if (row.debit !== null && row.credit !== null) check.error('credit', 'ONE_SIDE');

      let customerId: number | null = null;
      let supplierId: number | null = null;
      const control = account?.control ?? 'NONE';
      const partyLine = CUSTOMER_CONTROLS.has(control) || SUPPLIER_CONTROLS.has(control);
      if (account && partyLine) {
        if (row.party === null) check.error('party', 'REQUIRED');
        else if (CUSTOMER_CONTROLS.has(control)) {
          const customer = customerByCode.get(row.party.trim());
          if (!customer) check.error('party', 'NOT_FOUND', { value: row.party });
          else customerId = customer.id;
        } else {
          const supplier = supplierByCode.get(row.party.trim());
          if (!supplier) check.error('party', 'NOT_FOUND', { value: row.party });
          else supplierId = supplier.id;
        }
      } else if (account && row.party !== null) check.error('party', 'NOT_ALLOWED');

      let moneyAccountCode: string | null = null;
      if (account && control === 'MONEY') {
        if (row.moneyAccount === null) check.error('moneyAccount', 'REQUIRED');
        else {
          const money = facts.moneyAccounts.get(row.moneyAccount.trim());
          if (!money) check.error('moneyAccount', 'NOT_FOUND', { value: row.moneyAccount });
          else if (money.accountCode !== account.code) check.error('moneyAccount', 'MISMATCH');
          else if (money.status !== 'ACTIVE') check.error('moneyAccount', 'NOT_ALLOWED');
          else moneyAccountCode = row.moneyAccount.trim();
        }
      } else if (account && row.moneyAccount !== null) check.error('moneyAccount', 'NOT_ALLOWED');

      if (row.ref !== null && row.ref.length > MAX_REF) check.error('ref', 'TOO_LONG');
      for (const column of ['refDate', 'dueDate'] as const) {
        const value = row[column];
        if (value === null) continue;
        if (!isIsoDate(value)) check.error(column, 'FORMAT');
        else if (column === 'refDate' && value > date) check.error(column, 'OUT_OF_RANGE');
      }
      if (account && !partyLine) {
        for (const column of ['ref', 'refDate', 'dueDate'] as const) {
          if (row[column] !== null) check.error(column, 'NOT_ALLOWED');
        }
      }
      if (row.description !== null && row.description.length > MAX_DESCRIPTION) {
        check.error('description', 'TOO_LONG');
      }

      let accountCode = account?.code ?? null;
      if (
        accountCode !== null &&
        accountCode === facts.inventoryAccountCode &&
        facts.openingStockAccountCode !== null
      ) {
        accountCode = facts.openingStockAccountCode;
        check.warn('account', 'TO_OPENING_STOCK', { account: facts.openingStockAccountCode });
      }
      const amount = debit ?? credit;
      if (check.ok && amount) {
        if (debit) debitTotal = debitTotal.plus(debit);
        else creditTotal = creditTotal.plus(amount);
      }
      return {
        check,
        plan:
          accountCode !== null && amount
            ? {
                accountCode,
                side: debit ? ('DEBIT' as const) : ('CREDIT' as const),
                amount: amount.toFixed(2),
                customerId,
                supplierId,
                moneyAccountCode,
                ref: row.ref,
                refDate: row.refDate,
                dueDate: row.dueDate,
                description: row.description,
              }
            : null,
      };
    });

    // The file as a whole: one opening at a time, the offset account mapped, debit = credit.
    const first = planned[0]?.check;
    if (first) {
      if (facts.liveOpening !== null) {
        first.error(null, 'OPENING_EXISTS', { value: facts.liveOpening });
      }
      if (facts.openingStockAccountCode === null) {
        first.error(null, 'NOT_FOUND', { value: 'OPENING_STOCK' });
      }
      if (date > businessDate()) first.error(null, 'OUT_OF_RANGE', { value: date });
      if (!addDays(date, 1).endsWith('-01')) first.error(null, 'NOT_MONTH_END', { value: date });
      if (planned.every((entry) => entry.check.ok) && !debitTotal.eq(creditTotal)) {
        first.error(null, 'UNBALANCED', {
          debit: debitTotal.toFixed(2),
          credit: creditTotal.toFixed(2),
        });
      }
    }
    return planned.map((entry) => entry.check.result('CREATE', null, entry.plan));
  }

  async apply(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CheckedRow<OpeningLine>[],
    progress: Progress,
  ): Promise<AppliedRow[]> {
    const { date } = openingOptionsOf(job);
    const facts = await this.finance.openingFacts(tx);
    if (facts.openingStockAccountCode === null) throw new Error('no opening offset account');
    const planned = rows.flatMap((row) => (row.plan ? [{ rowNo: row.rowNo, plan: row.plan }] : []));
    const posted = await this.finance.postOpeningInTx(tx, actor, {
      importId: job.id,
      date,
      offsetAccountCode: facts.openingStockAccountCode,
      lines: planned.map((row) => row.plan),
    });
    await progress(planned.length);
    const changes: OpeningChanges = { documents: posted.documents };
    return planned.map((row) => ({ rowNo: row.rowNo, action: 'CREATE', targetId: null, changes }));
  }

  async revert(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CommittedRow[],
  ): Promise<void> {
    const documents = Math.max(
      0,
      ...rows.map((row) => (row.changes as OpeningChanges | null)?.documents ?? 0),
    );
    await this.finance.reverseOpeningInTx(tx, actor, {
      importId: job.id,
      date: openingOptionsOf(job).date,
      documents,
    });
  }

  appliedNotes(rows: readonly AppliedRow[]): Record<string, number> {
    return {
      documents: Math.max(0, ...rows.map((row) => (row.changes as OpeningChanges).documents)),
    };
  }
}
