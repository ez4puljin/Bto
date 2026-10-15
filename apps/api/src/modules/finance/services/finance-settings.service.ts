import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_DOC_KINDS,
  FINANCE_NUMBER_DEFAULTS,
  FINANCE_NUMBER_SCOPES,
  type FinanceDocKind,
  financeNumberIssues,
  financeNumberPrefix,
  formatFinanceNumber,
  type NumberFormat,
} from '@tugeel/shared/finance';
import { businessDate } from '@tugeel/shared/time';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, actorUserId, AuditService, NumberingService } from '../../identity';
import { financeSettings } from '../schema';

export type FinanceNumberingInput = Record<FinanceDocKind, NumberFormat>;

export interface FinanceNumbering extends FinanceNumberingInput {
  updatedAt: Date | null;
  updatedBy: number | null;
}

/**
 * The finance settings (ADR-0060 #8): one number format per document, the shared defaults until
 * the admin saves a row. Every document draws its number from one gap-free counter per rendered
 * prefix, so the owner's `Н-20261016-0001` starts again each day.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
  ) {}

  async numbering(executor: Db | Tx = this.db): Promise<FinanceNumbering> {
    const [row] = await executor.select().from(financeSettings).where(eq(financeSettings.id, 1));
    if (!row) return { ...FINANCE_NUMBER_DEFAULTS, updatedAt: null, updatedBy: null };
    return {
      INVOICE: { pattern: row.invoicePattern, digits: row.invoiceDigits },
      PAYMENT: { pattern: row.paymentPattern, digits: row.paymentDigits },
      CREDIT_NOTE: { pattern: row.creditNotePattern, digits: row.creditNoteDigits },
      JOURNAL: { pattern: row.journalPattern, digits: row.journalDigits },
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  async setNumbering(ctx: AuthContext, input: FinanceNumberingInput): Promise<FinanceNumbering> {
    const formats = {} as FinanceNumberingInput;
    for (const kind of FINANCE_DOC_KINDS) {
      const pattern = input[kind].pattern.trim();
      const [issue] = financeNumberIssues(pattern, input[kind].digits);
      if (issue) {
        throw invalid(`${kind}.${issue.path}`, issue.code, `${kind}.${issue.path}: ${issue.code}`);
      }
      formats[kind] = { pattern, digits: input[kind].digits };
    }
    await inTransaction(this.db, async (tx) => {
      const before = await this.numbering(tx);
      const values = {
        invoicePattern: formats.INVOICE.pattern,
        invoiceDigits: formats.INVOICE.digits,
        paymentPattern: formats.PAYMENT.pattern,
        paymentDigits: formats.PAYMENT.digits,
        creditNotePattern: formats.CREDIT_NOTE.pattern,
        creditNoteDigits: formats.CREDIT_NOTE.digits,
        journalPattern: formats.JOURNAL.pattern,
        journalDigits: formats.JOURNAL.digits,
        updatedBy: actorUserId(ctx),
      };
      await tx
        .insert(financeSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({
          target: financeSettings.id,
          set: { ...values, updatedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'finance_settings',
        entityId: 1,
        before: formatsOf(before),
        after: formats,
      });
    });
    return this.numbering();
  }

  /**
   * The next number of a document dated `day` (its business date), drawn inside the creating
   * transaction: the pattern rendered with that day is the prefix and the period of the counter.
   */
  async allocateNumber(
    tx: Tx,
    kind: FinanceDocKind,
    day: string = businessDate(),
  ): Promise<string> {
    const format = (await this.numbering(tx))[kind];
    const prefix = financeNumberPrefix(format.pattern, day);
    const value = await this.numbers.next(tx, FINANCE_NUMBER_SCOPES[kind], prefix);
    return formatFinanceNumber(prefix, format.digits, value);
  }
}

function formatsOf(numbering: FinanceNumbering): FinanceNumberingInput {
  return {
    INVOICE: numbering.INVOICE,
    PAYMENT: numbering.PAYMENT,
    CREDIT_NOTE: numbering.CREDIT_NOTE,
    JOURNAL: numbering.JOURNAL,
  };
}
