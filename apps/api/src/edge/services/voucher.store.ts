import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  type EdgeVoucher,
  parseVoucherCode,
  type PosVoucherFacts,
  type PosVoucherFeed,
  type VoucherRefusal,
  voucherDateRefusal,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { eq, inArray } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx } from '../db/edge-db';
import { edgeState, edgeVoucherUses } from '../db/schema';

/**
 * The coupons and partner vouchers a till may take (ADR-0110), as the centre's feed last answered:
 * kept in the edge's database so a restart takes codes at once, indexed by code in memory. A code
 * this edge's sales took is refused from `edge_voucher_uses`, offline too, so no two sales of the
 * store take the same code (one edge serves every till).
 */
@Injectable()
export class VoucherStore implements OnModuleInit {
  private feed: PosVoucherFeed | null = null;
  private byCode = new Map<string, PosVoucherFacts>();

  constructor(@Inject(EDGE_DB) private readonly db: EdgeDb) {}

  async onModuleInit(): Promise<void> {
    const [row] = await this.db
      .select({ vouchers: edgeState.vouchers })
      .from(edgeState)
      .where(eq(edgeState.id, 1));
    if (row?.vouchers) this.index(row.vouchers);
  }

  version(): string | null {
    return this.feed?.version ?? null;
  }

  /** Keeps a new feed (or only the pull time when the centre said it is unchanged). */
  async apply(feed: PosVoucherFeed | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(edgeState)
      .values({
        id: 1,
        ...(feed ? { vouchers: feed, vouchersVersion: feed.version } : {}),
        vouchersPulledAt: now,
      })
      .onConflictDoUpdate({
        target: edgeState.id,
        set: {
          ...(feed ? { vouchers: feed, vouchersVersion: feed.version } : {}),
          vouchersPulledAt: now,
          updatedAt: now,
        },
      });
    if (feed) this.index(feed);
  }

  /** One scanned or typed code as the till shows it, or 422 POS_VOUCHER_INVALID with why. */
  async check(text: string): Promise<EdgeVoucher> {
    const [facts] = await this.resolve([text]);
    if (!facts) throw refused(text, 'UNKNOWN');
    return viewOf(facts);
  }

  /**
   * The codes of a quote or a sale, in order: each known, not used by this edge, within its dates
   * today; a code given twice is refused as USED. With `tx` the uses are read inside the sale's
   * transaction (the insert of each use then holds it).
   */
  async resolve(texts: readonly string[], tx?: EdgeTx): Promise<PosVoucherFacts[]> {
    const today = businessDate();
    const parsed = texts.map((text) => {
      const code = parseVoucherCode(text)?.code;
      if (!code) throw refused(text, 'UNKNOWN');
      return code;
    });
    const seen = new Set<string>();
    for (const code of parsed) {
      if (seen.has(code)) throw refused(code, 'USED');
      seen.add(code);
    }
    const used =
      parsed.length === 0
        ? []
        : await (tx ?? this.db)
            .select({ code: edgeVoucherUses.code })
            .from(edgeVoucherUses)
            .where(inArray(edgeVoucherUses.code, parsed));
    const usedCodes = new Set(used.map((row) => row.code));
    return parsed.map((code) => {
      const facts = this.byCode.get(code);
      if (!facts) throw refused(code, 'UNKNOWN');
      if (usedCodes.has(code)) throw refused(code, 'USED');
      const dates = voucherDateRefusal(today, facts.validFrom, facts.validTo);
      if (dates) throw refused(code, dates);
      return facts;
    });
  }

  private index(feed: PosVoucherFeed): void {
    this.feed = feed;
    this.byCode = new Map(feed.vouchers.map((voucher) => [voucher.code, voucher]));
  }
}

export function viewOf(facts: PosVoucherFacts): EdgeVoucher {
  return {
    code: facts.code,
    kind: facts.kind,
    name: facts.name,
    effect: facts.effect,
    value: facts.value,
    partnerName: facts.customerName,
    validTo: facts.validTo,
  };
}

export function refused(code: string, reason: VoucherRefusal): AppError {
  return new AppError('POS_VOUCHER_INVALID', `code ${code} cannot be taken: ${reason}`, {
    code,
    reason,
  });
}
