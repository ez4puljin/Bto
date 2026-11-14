import { Inject, Injectable } from '@nestjs/common';
import {
  AI_MODEL_CATALOG,
  type AiBudgetState,
  type AiProvider,
  type AiUsagePurpose,
} from '@tugeel/shared/ai';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, gte, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { UserNamesService } from '../../identity';
import { aiQuestions, aiSettings, aiUsage } from '../schema';

export type AiSettingsRow = typeof aiSettings.$inferSelect;

const MILLION = new Decimal(1_000_000);
const WARN_FROM = new Decimal('0.8');
const FREE = { input: new Decimal(0), output: new Decimal(0) };
/** People shown on the usage page, the most expensive first. */
const USERS_SHOWN = 20;

/** The start of a business day as a timestamp (Asia/Ulaanbaatar). */
const startOf = (date: string): SQL =>
  sql`(${date}::date)::timestamp AT TIME ZONE 'Asia/Ulaanbaatar'`;
const today = (): SQL => startOf(businessDate());
const thisMonth = (): SQL => startOf(`${businessDate().slice(0, 7)}-01`);

/** USD per million tokens: the saved connection's, else the catalog's; null when unknown. */
export function priceOf(
  row: AiSettingsRow | null,
  provider: AiProvider,
  model: string,
): { input: Decimal; output: Decimal } | null {
  if (provider === 'ollama') return FREE;
  if (
    row?.provider === provider &&
    row.model === model &&
    row.priceInputPerMtok &&
    row.priceOutputPerMtok
  ) {
    return { input: row.priceInputPerMtok, output: row.priceOutputPerMtok };
  }
  const known = AI_MODEL_CATALOG[provider].find((entry) => entry.id === model);
  return known ? { input: new Decimal(known.input), output: new Decimal(known.output) } : null;
}

export function budgetStateOf(limit: Decimal | null, spent: Decimal): AiBudgetState {
  if (!limit) return 'NONE';
  if (spent.gte(limit)) return 'REACHED';
  return spent.gte(limit.mul(WARN_FROM)) ? 'WARN' : 'OK';
}

export interface AiUsageCall {
  purpose: AiUsagePurpose;
  userId: number | null;
  provider: AiProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiUsageTotals {
  questions: number;
  invoiceChecks: number;
  /** Readings of product photos for the registration form (ADR-0198). */
  productReads: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
  /** Calls no price was known for: their cost is not in `costUsd`. */
  unpricedCalls: number;
}

export interface AiUsageByUser {
  userId: number;
  fullName: string;
  questions: number;
  invoiceChecks: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: string;
}

/**
 * The limits and the meter of the AI (ADR-0162). The month's limit stops new work once the month's
 * recorded cost reaches it; a question in progress finishes, so two at once can pass it by a little.
 * Saved reports call no model and are never stopped. Prices are the day's: a later change of price
 * does not rewrite the month.
 */
@Injectable()
export class AiLimitsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly names: UserNamesService,
  ) {}

  async settings(executor: Pick<Db, 'select'> = this.db): Promise<AiSettingsRow | null> {
    const [row] = await executor.select().from(aiSettings).where(eq(aiSettings.id, 1));
    return row ?? null;
  }

  async spentThisMonth(): Promise<Decimal> {
    const [row] = await this.db
      .select({ spent: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text` })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, thisMonth()));
    return new Decimal(row?.spent ?? 0);
  }

  async budgetState(): Promise<AiBudgetState> {
    const limit = (await this.settings())?.monthlyBudgetUsd ?? null;
    return limit ? budgetStateOf(limit, await this.spentThisMonth()) : 'NONE';
  }

  /** New work stops at the month's limit: questions and invoice checks alike. */
  async assertWithinBudget(): Promise<void> {
    const limit = (await this.settings())?.monthlyBudgetUsd ?? null;
    if (!limit) return;
    if ((await this.spentThisMonth()).gte(limit)) {
      throw new AppError('AI_BUDGET_REACHED', 'the AI month limit is reached', {
        limitUsd: limit.toFixed(2),
      });
    }
  }

  async assertUserMayAsk(userId: number): Promise<void> {
    const limit = (await this.settings())?.userDailyQuestions ?? null;
    if (limit === null) return;
    const [row] = await this.db
      .select({ asked: sql<number>`count(*)::int` })
      .from(aiQuestions)
      .where(and(eq(aiQuestions.userId, userId), gte(aiQuestions.createdAt, today())));
    if ((row?.asked ?? 0) >= limit) {
      throw new AppError('AI_USER_LIMIT_REACHED', 'the AI day limit of this person is reached', {
        limit,
      });
    }
  }

  async record(call: AiUsageCall): Promise<void> {
    const price = priceOf(await this.settings(), call.provider, call.model);
    const costUsd = price
      ? price.input
          .mul(call.inputTokens)
          .plus(price.output.mul(call.outputTokens))
          .div(MILLION)
          .toDecimalPlaces(6)
      : null;
    await this.db.insert(aiUsage).values({ ...call, costUsd });
  }

  async totalsToday(): Promise<AiUsageTotals> {
    return this.totals(today());
  }

  async totalsThisMonth(): Promise<AiUsageTotals> {
    return this.totals(thisMonth());
  }

  private async totals(from: SQL): Promise<AiUsageTotals> {
    const [usage] = await this.db
      .select({
        invoiceChecks: sql<number>`count(*) FILTER (WHERE ${aiUsage.purpose} = 'INVOICE_CHECK')::int`,
        productReads: sql<number>`count(*) FILTER (WHERE ${aiUsage.purpose} = 'PRODUCT_READ')::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
        unpricedCalls: sql<number>`count(*) FILTER (WHERE ${aiUsage.costUsd} IS NULL)::int`,
      })
      .from(aiUsage)
      .where(gte(aiUsage.createdAt, from));
    const [asked] = await this.db
      .select({ questions: sql<number>`count(*)::int` })
      .from(aiQuestions)
      .where(gte(aiQuestions.createdAt, from));
    return {
      questions: asked?.questions ?? 0,
      invoiceChecks: usage?.invoiceChecks ?? 0,
      productReads: usage?.productReads ?? 0,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
      costUsd: usage?.costUsd ?? '0',
      unpricedCalls: usage?.unpricedCalls ?? 0,
    };
  }

  /** The month's cost per person, the most expensive first. */
  async byUserThisMonth(): Promise<AiUsageByUser[]> {
    const rows = await this.db
      .select({
        userId: aiUsage.userId,
        invoiceChecks: sql<number>`count(*) FILTER (WHERE ${aiUsage.purpose} = 'INVOICE_CHECK')::int`,
        inputTokens: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`,
        outputTokens: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int`,
        costUsd: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)::text`,
      })
      .from(aiUsage)
      .where(and(gte(aiUsage.createdAt, thisMonth()), sql`${aiUsage.userId} IS NOT NULL`))
      .groupBy(aiUsage.userId)
      .orderBy(desc(sql`sum(${aiUsage.costUsd})`))
      .limit(USERS_SHOWN);
    const asked = await this.db
      .select({ userId: aiQuestions.userId, questions: sql<number>`count(*)::int` })
      .from(aiQuestions)
      .where(gte(aiQuestions.createdAt, thisMonth()))
      .groupBy(aiQuestions.userId);
    const questions = new Map(asked.map((row) => [row.userId, row.questions]));
    const ids = rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));
    const names = await this.names.namesOf(ids);
    return rows.flatMap((row) =>
      row.userId === null
        ? []
        : [
            {
              ...row,
              userId: row.userId,
              fullName: names.get(row.userId) ?? '',
              questions: questions.get(row.userId) ?? 0,
            },
          ],
    );
  }
}
