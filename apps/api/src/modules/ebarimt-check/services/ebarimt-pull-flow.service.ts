import { Injectable, Logger } from '@nestjs/common';
import {
  type EbarimtPullReason,
  periodDays,
  periodOfDate,
  previousPeriod,
} from '@tugeel/shared/ebarimt-check';
import { addDays, businessDate } from '@tugeel/shared/time';
import {
  type EbarimtApiClient,
  EbarimtApiError,
  EbarimtApiGateway,
  type EbarimtPurchase,
} from '../../../integrations/ebarimt';
import type { Actor, AuthContext } from '../../identity';
import { EbarimtLineError, pullWindows, sheetOfPurchases } from './ebarimt-api-lines';
import { EbarimtConnectionService, type EbarimtPullRecord } from './ebarimt-connection.service';
import { EbarimtFilesService, type EbarimtPulledMonth } from './ebarimt-files.service';

/** Till the tenth, a night pulls the month before as well: receipts are entered late. */
const LATE_RECEIPT_DAYS = 10;

/** One month and the days of it to pull. */
export interface EbarimtPullSpan {
  period: number;
  from: string;
  to: string;
}

export interface EbarimtPullOutcome extends EbarimtPullRecord {
  /** Each month pulled, in order: whether it got a new file. */
  months: EbarimtPulledMonth[];
}

/**
 * What a night pulls (ADR-0228): this month up to yesterday, and, while today is the 1st to the
 * 10th, the month before in full.
 */
export function nightlySpans(today: string): EbarimtPullSpan[] {
  const spans: EbarimtPullSpan[] = [];
  const period = periodOfDate(today);
  if (period === null) return spans;
  const day = Number.parseInt(today.slice(8, 10), 10);
  if (day <= LATE_RECEIPT_DAYS) {
    const previous = previousPeriod(period);
    spans.push({ period: previous, ...periodDays(previous) });
  }
  const yesterday = addDays(today, -1);
  if (periodOfDate(yesterday) === period) {
    spans.push({ period, from: periodDays(period).from, to: yesterday });
  }
  return spans;
}

/** «Одоо татах» of a month: its days up to today. None when the month has not begun. */
export function monthSpan(period: number, today: string): EbarimtPullSpan | null {
  const { from, to } = periodDays(period);
  if (from > today) return null;
  return { period, from, to: to < today ? to : today };
}

/**
 * Pulls a month's purchase receipts from e-Barimt's API into the month's file (ADR-0228): every
 * night from the job, at once from «Одоо татах». A flow service: the calls to e-Barimt are made
 * between transactions, and each month is written in its own. What a pull ended with is kept
 * beside the connection for the page; the password, the key and the token are never logged.
 */
@Injectable()
export class EbarimtPullFlowService {
  private readonly logger = new Logger(EbarimtPullFlowService.name);

  constructor(
    private readonly gateway: EbarimtApiGateway,
    private readonly connection: EbarimtConnectionService,
    private readonly files: EbarimtFilesService,
  ) {}

  /** «Одоо татах»: the month on screen, at once. */
  async pullMonth(ctx: AuthContext, period: number): Promise<EbarimtPullOutcome> {
    const span = monthSpan(period, businessDate());
    if (!span) {
      // Nothing was asked of e-Barimt: the last pull's record stays as it was.
      return failed('NO_DAYS', null);
    }
    return this.pull(ctx, [span]);
  }

  /** The night's pull, when the switch is on. Null: off, nothing asked. */
  async pullNightly(actor: Actor): Promise<EbarimtPullOutcome | null> {
    const saved = await this.connection.saved();
    if (!saved.nightly) return null;
    const spans = nightlySpans(businessDate());
    if (spans.length === 0) return null;
    return this.pull(actor, spans);
  }

  private async pull(actor: Actor, spans: readonly EbarimtPullSpan[]): Promise<EbarimtPullOutcome> {
    const outcome = await this.fetchAndStore(actor, spans);
    await this.connection.recordPull(actor, outcome);
    if (!outcome.ok) {
      this.logger.warn(`e-Barimt pull failed: ${outcome.reason ?? 'unknown'}`);
    }
    return outcome;
  }

  private async fetchAndStore(
    actor: Actor,
    spans: readonly EbarimtPullSpan[],
  ): Promise<EbarimtPullOutcome> {
    const saved = await this.connection.saved();
    if (!saved.account) return failed(saved.failure, null);
    const client = this.gateway.clientFor(saved.account);
    const months: EbarimtPulledMonth[] = [];
    let receipts = 0;
    let masked = 0;
    try {
      for (const span of spans) {
        const purchases = await this.purchasesOf(client, span);
        const sheet = sheetOfPurchases(span.period, purchases);
        receipts += sheet.rows.length;
        masked += sheet.masked;
        months.push(await this.files.storePulled(actor, sheet, fileNameOf(span)));
      }
    } catch (error: unknown) {
      if (error instanceof EbarimtApiError) {
        return { ...failed(error.reason, error.detail), months };
      }
      if (error instanceof EbarimtLineError) {
        return { ...failed('BAD_RESPONSE', null), months };
      }
      throw error;
    }
    return { ok: true, reason: null, message: null, receipts, masked, months };
  }

  /** A month's receipts, a week at a time: the service has no paging. */
  private async purchasesOf(
    client: EbarimtApiClient,
    span: EbarimtPullSpan,
  ): Promise<EbarimtPurchase[]> {
    const purchases: EbarimtPurchase[] = [];
    for (const window of pullWindows(span.from, span.to)) {
      purchases.push(...(await client.purchases(window.from, window.to)));
    }
    return purchases;
  }
}

function failed(reason: EbarimtPullReason, message: string | null): EbarimtPullOutcome {
  return { ok: false, reason, message, receipts: null, masked: null, months: [] };
}

/** How the pulled file is named in the month's list: where it came from and which days. */
function fileNameOf(span: EbarimtPullSpan): string {
  return `e-Barimt API ${span.from} – ${span.to}`;
}
