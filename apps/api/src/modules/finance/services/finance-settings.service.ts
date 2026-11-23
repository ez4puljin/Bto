import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_DOC_KINDS,
  FINANCE_NUMBER_DEFAULTS,
  FINANCE_NUMBER_SCOPES,
  type FinanceDocKind,
  financeNumberIssues,
  financeNumberPrefix,
  formatFinanceNumber,
  isVatWaiverPct,
  type NumberFormat,
  VAT_WAIVER_DEFAULT_PCT,
  VAT_WAIVER_DESCRIPTION_MAX,
} from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { FinConfig } from '../../../finance-core';
import { type AuthContext, actorUserId, AuditService, NumberingService } from '../../identity';
import { financeSettings } from '../schema';
import { FinBooks } from './fin-books';

export type FinanceNumberingInput = Record<FinanceDocKind, NumberFormat>;

export interface FinanceNumbering extends FinanceNumberingInput {
  updatedAt: Date | null;
  updatedBy: number | null;
}

/** «НӨАТ хасуулах» (ADR-0240): the percent a waiver takes and the words of its entry. */
export interface VatWaiverSettings {
  pct: Decimal;
  description: string;
  updatedAt: Date | null;
}

/** The formats Bto numbers itself (its invoices and credit notes, ADR-0073 #2). */
type BtoNumbered = 'INVOICE' | 'CREDIT_NOTE';
/** The formats the Finance Core numbers from its series (vouchers, journal entries; ADR-0090). */
const CORE_SERIES: Readonly<Record<Exclude<FinanceDocKind, BtoNumbered>, string>> = {
  PAYMENT: 'PAYMENT',
  JOURNAL: 'JOURNAL',
};

/**
 * The finance settings (ADR-0060 #8): one number format per document. Invoices and credit notes
 * are numbered by Bto from `finance_settings` (the shared defaults until the admin saves a row);
 * vouchers and journal entries by the Finance Core from its series since F2 (ADR-0090), edited on
 * the same page. Every document draws its number from one gap-free counter per rendered prefix, so
 * the owner's `Н-20261016-0001` starts again each day.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
    private readonly config: FinConfig,
    private readonly books: FinBooks,
  ) {}

  async numbering(executor: Db | Tx = this.db): Promise<FinanceNumbering> {
    const [row] = await executor.select().from(financeSettings).where(eq(financeSettings.id, 1));
    const series = new Map(
      (
        await this.config.numberSeries(
          this.books.source(),
          { company: await this.books.company() },
          this.books.executor(executor),
        )
      ).map((own) => [own.code, own]),
    );
    const core = (kind: Exclude<FinanceDocKind, BtoNumbered>): NumberFormat => {
      const own = series.get(CORE_SERIES[kind]);
      return own ? { pattern: own.pattern, digits: own.digits } : FINANCE_NUMBER_DEFAULTS[kind];
    };
    return {
      INVOICE: row
        ? { pattern: row.invoicePattern, digits: row.invoiceDigits }
        : FINANCE_NUMBER_DEFAULTS.INVOICE,
      PAYMENT: core('PAYMENT'),
      CREDIT_NOTE: row
        ? { pattern: row.creditNotePattern, digits: row.creditNoteDigits }
        : FINANCE_NUMBER_DEFAULTS.CREDIT_NOTE,
      JOURNAL: core('JOURNAL'),
      updatedAt: row?.updatedAt ?? null,
      updatedBy: row?.updatedBy ?? null,
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
        creditNotePattern: formats.CREDIT_NOTE.pattern,
        creditNoteDigits: formats.CREDIT_NOTE.digits,
        updatedBy: actorUserId(ctx),
      };
      await tx
        .insert(financeSettings)
        .values({ id: 1, ...values })
        .onConflictDoUpdate({
          target: financeSettings.id,
          set: { ...values, updatedAt: sql`now()` },
        });
      const company = await this.books.company();
      for (const kind of ['PAYMENT', 'JOURNAL'] as const) {
        await this.config.setNumberSeriesInTx(tx, this.books.user(ctx), {
          company,
          code: CORE_SERIES[kind],
          ...formats[kind],
        });
      }
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
   * The waiver's percent and words (ADR-0240 #1): the saved ones, else 2 % and «Борлуулалтын
   * хөнгөлөлт». A waiver freezes both on its own row, so a change reaches only later waivers.
   */
  async vatWaiver(executor: Db | Tx = this.db): Promise<VatWaiverSettings> {
    const [row] = await executor
      .select({
        pct: financeSettings.vatWaiverPct,
        description: financeSettings.vatWaiverDescription,
        updatedAt: financeSettings.updatedAt,
      })
      .from(financeSettings)
      .where(eq(financeSettings.id, 1));
    return {
      pct: row?.pct ?? new Decimal(VAT_WAIVER_DEFAULT_PCT),
      description: row?.description ?? mn.finance.vatWaiver.defaultDescription,
      updatedAt: row?.updatedAt ?? null,
    };
  }

  async setVatWaiver(
    ctx: AuthContext,
    input: { pct: Decimal; description: string },
  ): Promise<VatWaiverSettings> {
    if (!isVatWaiverPct(input.pct)) {
      throw invalid('pct', 'vatWaiverPct', 'above 0, at most 100, two decimals');
    }
    const description = input.description.trim();
    if (description.length === 0 || description.length > VAT_WAIVER_DESCRIPTION_MAX) {
      throw invalid('description', 'length', `1 to ${VAT_WAIVER_DESCRIPTION_MAX} characters`);
    }
    await inTransaction(this.db, async (tx) => {
      const before = await this.vatWaiver(tx);
      const values = {
        vatWaiverPct: input.pct,
        vatWaiverDescription: description,
        updatedBy: actorUserId(ctx),
      };
      // The row is absent until something is saved: it starts with the number formats in force.
      await tx
        .insert(financeSettings)
        .values({
          id: 1,
          invoicePattern: FINANCE_NUMBER_DEFAULTS.INVOICE.pattern,
          invoiceDigits: FINANCE_NUMBER_DEFAULTS.INVOICE.digits,
          creditNotePattern: FINANCE_NUMBER_DEFAULTS.CREDIT_NOTE.pattern,
          creditNoteDigits: FINANCE_NUMBER_DEFAULTS.CREDIT_NOTE.digits,
          ...values,
        })
        .onConflictDoUpdate({
          target: financeSettings.id,
          set: { ...values, updatedAt: sql`now()` },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'finance_settings',
        entityId: 1,
        before: { vatWaiverPct: before.pct.toFixed(2), vatWaiverDescription: before.description },
        after: { vatWaiverPct: input.pct.toFixed(2), vatWaiverDescription: description },
      });
    });
    return this.vatWaiver();
  }

  /**
   * The next number of an invoice or a credit note dated `day` (its business date), drawn inside
   * the creating transaction: the pattern rendered with that day is the prefix and the period of
   * the counter.
   */
  async allocateNumber(tx: Tx, kind: BtoNumbered, day: string = businessDate()): Promise<string> {
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
