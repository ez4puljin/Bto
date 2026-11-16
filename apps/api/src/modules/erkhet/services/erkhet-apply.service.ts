import { Inject, Injectable } from '@nestjs/common';
import {
  erkhetIssueAppliable,
  type ErkhetResolution,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import type { AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import { ProductPricesService } from '../../pricing';
import { erkhetSyncItems } from '../schema';
import { ErkhetSyncService } from './erkhet-sync.service';

type ItemRow = typeof erkhetSyncItems.$inferSelect;

export interface ErkhetApplyInput {
  /** Chosen rows; or every open row of one issue. */
  itemIds?: number[];
  kind?: ErkhetSyncKind;
  issue?: ErkhetSyncIssue;
}

export interface ErkhetApplyResult {
  /** Bto now says what Erkhet says. */
  applied: number;
  /** Bto had changed since the check: left alone, check again. */
  stale: number;
  /** A rule of Bto refused the change. */
  refused: number;
  /** Rows that were already looked at, or that nothing can be done for. */
  skipped: number;
}

/** A row's change did not go through, and why it is not an error of the request. */
class Outcome extends Error {
  constructor(readonly resolution: Exclude<ErkhetResolution, 'APPLIED'>) {
    super(resolution);
  }
}

/**
 * «Bto-д тааруулах» (ADR-0203 #6): brings Bto to what Erkhet says, one row and one transaction at
 * a time, through the services that own the data, so every change is audited and follows the same
 * rules as a change made by hand. Only rows of the latest finished check are taken, and each is
 * checked again first: where Bto changed since the check, the row is marked STALE and left alone.
 * Nothing is ever written to Erkhet.
 */
@Injectable()
export class ErkhetApplyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly sync: ErkhetSyncService,
    private readonly customers: CustomersService,
    private readonly prices: ProductPricesService,
  ) {}

  async apply(actor: AuthContext, input: ErkhetApplyInput): Promise<ErkhetApplyResult> {
    const run = await this.sync.latestDone();
    if (!run) throw new AppError('ERKHET_RUN_SUPERSEDED', 'no finished check');
    let rows: ItemRow[];
    if (input.itemIds && input.itemIds.length > 0) {
      rows = await this.sync.itemsByIds(input.itemIds);
      if (rows.length !== new Set(input.itemIds).size) {
        throw invalid('itemIds', 'exists', 'unknown rows');
      }
    } else if (input.kind && input.issue) {
      rows = await this.sync.openItems(run.id, input.kind, input.issue);
    } else {
      throw invalid('itemIds', 'required', 'rows, or a kind and an issue');
    }
    if (rows.some((row) => row.runId !== run.id)) {
      throw new AppError('ERKHET_RUN_SUPERSEDED', 'the rows belong to an older check', {
        runId: run.id,
      });
    }
    const result: ErkhetApplyResult = { applied: 0, stale: 0, refused: 0, skipped: 0 };
    for (const row of rows) {
      if (row.resolution !== null || !erkhetIssueAppliable(row.kind, row.issue)) {
        result.skipped += 1;
        continue;
      }
      const resolution = await this.applyOne(actor, row);
      if (resolution === null) result.skipped += 1;
      else if (resolution === 'APPLIED') result.applied += 1;
      else if (resolution === 'STALE') result.stale += 1;
      else result.refused += 1;
    }
    return result;
  }

  /** null: another request settled the row first. */
  private async applyOne(actor: AuthContext, row: ItemRow): Promise<ErkhetResolution | null> {
    try {
      return await inTransaction(this.db, async (tx) => {
        // The row is claimed first: of two requests for it, the second finds it settled.
        const claimed = await this.mark(tx, actor, row.id, 'APPLIED');
        if (!claimed) return null;
        await this.change(tx, actor, row);
        return 'APPLIED' as const;
      });
    } catch (error: unknown) {
      // The transaction is gone with the claim; the reason is written on its own.
      const resolution =
        error instanceof Outcome
          ? error.resolution
          : error instanceof AppError || isConstraintViolation(error)
            ? 'REFUSED'
            : null;
      if (resolution === null) throw error;
      const marked = await this.mark(this.db, actor, row.id, resolution);
      return marked ? resolution : null;
    }
  }

  private async change(tx: Tx, actor: AuthContext, row: ItemRow): Promise<void> {
    if (row.kind === 'CUSTOMER' && row.issue === 'MISSING_IN_BTO') {
      if (!row.erkhetCode || !row.erkhetName || !row.plan) throw new Outcome('REFUSED');
      const taken = await this.customers.findByCodes([row.erkhetCode], tx);
      if (taken.length > 0) throw new Outcome('STALE');
      await this.customers.createInTx(tx, actor, {
        code: row.erkhetCode,
        name: row.erkhetName,
        kind: row.plan.kind,
        phone: row.plan.phone,
        categoryId: row.plan.categoryId,
        settlementGroup: row.plan.settlementGroup,
      });
      return;
    }
    if (row.kind === 'CUSTOMER' && row.issue === 'NAME_DIFFERS') {
      if (row.btoId === null || !row.erkhetName) throw new Outcome('REFUSED');
      const [customer] = await this.customers.findByIds([row.btoId], tx);
      if (!customer || customer.name !== row.btoName || customer.code !== row.erkhetCode) {
        throw new Outcome('STALE');
      }
      await this.customers.updateInTx(tx, actor, row.btoId, { name: row.erkhetName });
      return;
    }
    if (row.kind === 'PRODUCT' && row.issue === 'PRICE_DIFFERS') {
      if (row.btoId === null || row.erkhetPrice === null || row.btoPrice === null) {
        throw new Outcome('REFUSED');
      }
      // Bto's prices are whole tugriks (ADR-0048); a price with a fraction is for a person.
      if (!row.erkhetPrice.isInteger() || !row.erkhetPrice.gt(0)) throw new Outcome('REFUSED');
      const today = businessDate();
      const terms = (await this.prices.inForce([row.btoId], today, tx)).get(row.btoId);
      if (!terms || !terms.warehousePrice.eq(row.btoPrice)) throw new Outcome('STALE');
      await this.prices.setInTx(tx, actor, {
        productId: row.btoId,
        validFrom: today,
        warehousePrice: row.erkhetPrice,
        profileId: terms.profileId,
        wholeUomId: terms.wholeUomId,
      });
      return;
    }
    throw new Outcome('REFUSED');
  }

  /** Writes how an open row ended; false when it was not open any more. */
  private async mark(
    executor: Db | Tx,
    actor: AuthContext,
    id: number,
    resolution: ErkhetResolution,
  ): Promise<boolean> {
    const rows = await executor
      .update(erkhetSyncItems)
      .set({ resolution, resolvedBy: actor.userId, resolvedAt: sql`now()` })
      .where(and(eq(erkhetSyncItems.id, id), isNull(erkhetSyncItems.resolution)))
      .returning({ id: erkhetSyncItems.id });
    return rows.length > 0;
  }
}

/** A unique or CHECK constraint of the table refused the row: Bto's rule, not a fault. */
function isConstraintViolation(error: unknown): boolean {
  const code = databaseErrorOf(error)?.code;
  return code === '23505' || code === '23514';
}
