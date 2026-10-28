import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  type EdgeMember,
  isMemberPin,
  LOYALTY_LIMITS,
  maskPhone,
  nextTierOf,
  type PosLoyaltyFeed,
  type PosLoyaltyMemberFacts,
  type PosLoyaltyTierFacts,
  tierFor,
} from '@tugeel/shared/pos';
import { verify } from 'argon2';
import { and, eq, gt, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb, type EdgeTx } from '../db/edge-db';
import { edgeMemberPinAttempts, edgeOutbox, edgeSales, edgeState } from '../db/schema';

/** What this edge's own documents moved on a card, not yet in the centre's feed. */
export interface PendingPoints {
  points: Decimal;
  spend: Decimal;
}

/** A member as this edge counts it: the feed's balance and lifetime with its own documents added. */
export interface MemberStanding {
  member: PosLoyaltyMemberFacts;
  balance: Decimal;
  lifetime: Decimal;
  tier: PosLoyaltyTierFacts | null;
}

const NONE: PendingPoints = { points: new Decimal(0), spend: new Decimal(0) };
/** A key of its own for the advisory locks that serialise one member's sales on this edge. */
const MEMBER_LOCK_SPACE = 72_026_112;

/**
 * The bonus card at the store (ADR-0112), as the centre's feed last answered: kept in the edge's
 * database so a restart serves members at once, indexed by phone in memory. The edge is the only
 * place points are earned and spent (one edge serves every till of the store), so what its sales
 * and returns moved and the centre has not counted yet is added from its own documents, offline
 * too. The member's PIN is checked here against the feed's hash, with a lock per member.
 */
@Injectable()
export class LoyaltyStore implements OnModuleInit {
  private feed: PosLoyaltyFeed | null = null;
  private byPhone = new Map<string, PosLoyaltyMemberFacts>();
  private byId = new Map<number, PosLoyaltyMemberFacts>();
  private readonly pepper: Buffer;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    config: EdgeConfig,
  ) {
    this.pepper = Buffer.from(config.get('POS_PIN_PEPPER'));
  }

  async onModuleInit(): Promise<void> {
    const [row] = await this.db
      .select({ loyalty: edgeState.loyalty })
      .from(edgeState)
      .where(eq(edgeState.id, 1));
    if (row?.loyalty) this.index(row.loyalty);
  }

  version(): string | null {
    return this.feed?.version ?? null;
  }

  tiers(): PosLoyaltyTierFacts[] {
    return this.feed?.tiers ?? [];
  }

  /** Keeps a new feed (or only the pull time when the centre said it is unchanged). */
  async apply(feed: PosLoyaltyFeed | null): Promise<void> {
    const now = new Date();
    await this.db
      .insert(edgeState)
      .values({
        id: 1,
        ...(feed ? { loyalty: feed, loyaltyVersion: feed.version } : {}),
        loyaltyPulledAt: now,
      })
      .onConflictDoUpdate({
        target: edgeState.id,
        set: {
          ...(feed ? { loyalty: feed, loyaltyVersion: feed.version } : {}),
          loyaltyPulledAt: now,
          updatedAt: now,
        },
      });
    if (feed) this.index(feed);
  }

  /** The member of a phone as the till shows it; NOT_FOUND or BLOCKED otherwise. */
  async byPhoneView(phone: string): Promise<EdgeMember> {
    const normalized = normalizeMnPhone(phone);
    const member = normalized ? this.byPhone.get(normalized) : undefined;
    if (!member) {
      throw new AppError('POS_MEMBER_NOT_FOUND', 'no bonus card member with this phone', {});
    }
    return this.view(await this.standing(member.id));
  }

  async view(standing: MemberStanding): Promise<EdgeMember> {
    const next = nextTierOf(standing.lifetime, this.tiers());
    return {
      id: standing.member.id,
      name: standing.member.name,
      phone: maskPhone(standing.member.phone),
      status: standing.member.status,
      balance: standing.balance.toFixed(2),
      lifetime: standing.lifetime.toFixed(2),
      tier: standing.tier ? { name: standing.tier.name, percent: standing.tier.percent } : null,
      nextTier: next
        ? {
            name: next.name,
            percent: next.percent,
            fromAmount: next.fromAmount,
            left: new Decimal(next.fromAmount).minus(standing.lifetime).toFixed(2),
          }
        : null,
    };
  }

  /** A member known to the feed, ACTIVE; the till refuses a blocked card. */
  active(id: number): PosLoyaltyMemberFacts {
    const member = this.byId.get(id);
    if (!member) throw new AppError('POS_MEMBER_NOT_FOUND', `member ${id} is not known`, {});
    if (member.status !== 'ACTIVE') {
      throw new AppError('POS_MEMBER_BLOCKED', `member ${id} is blocked`, {});
    }
    return member;
  }

  /**
   * A member's balance, lifetime spend and tier on this edge, read inside `tx` when given (the
   * sale's transaction holds the member's lock).
   */
  async standing(id: number, tx?: EdgeTx): Promise<MemberStanding> {
    const member = this.byId.get(id);
    if (!member) throw new AppError('POS_MEMBER_NOT_FOUND', `member ${id} is not known`, {});
    const pending = (await this.pending([id], tx)).get(id) ?? NONE;
    const lifetime = new Decimal(member.lifetime).plus(pending.spend);
    return {
      member,
      balance: new Decimal(member.balance).plus(pending.points),
      lifetime,
      tier: tierFor(lifetime, this.tiers()),
    };
  }

  /** Serialises one member's documents on this edge until the transaction ends. */
  async lock(tx: EdgeTx, id: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${MEMBER_LOCK_SPACE}, ${id})`);
  }

  /**
   * The member's own PIN against the feed's hash (owner 2026-10-28: needed to spend points),
   * counting wrong ones: five in a row lock the card for 15 minutes on this edge.
   */
  async checkPin(id: number, pin: string | null | undefined): Promise<void> {
    const member = this.active(id);
    const [attempts] = await this.db
      .select()
      .from(edgeMemberPinAttempts)
      .where(eq(edgeMemberPinAttempts.memberId, id));
    const current = attempts?.pinVersion === member.pinVersion ? attempts : undefined;
    if (current?.lockedUntil && current.lockedUntil.getTime() > Date.now()) {
      throw new AppError('POS_MEMBER_LOCKED', 'too many wrong bonus card PINs', {
        until: current.lockedUntil.toISOString(),
      });
    }
    const ok =
      typeof pin === 'string' &&
      isMemberPin(pin) &&
      (await verify(member.pinHash, pin, { secret: this.pepper }).catch(() => false));
    if (ok) {
      if (attempts) {
        await this.db.delete(edgeMemberPinAttempts).where(eq(edgeMemberPinAttempts.memberId, id));
      }
      return;
    }
    const failed = (current?.failedCount ?? 0) + 1;
    const lock = failed >= LOYALTY_LIMITS.pinFailures;
    const lockedUntil = lock ? new Date(Date.now() + LOYALTY_LIMITS.pinLockMinutes * 60_000) : null;
    const values = { pinVersion: member.pinVersion, failedCount: lock ? 0 : failed, lockedUntil };
    await this.db
      .insert(edgeMemberPinAttempts)
      .values({ memberId: id, ...values })
      .onConflictDoUpdate({ target: edgeMemberPinAttempts.memberId, set: values });
    if (lockedUntil) {
      throw new AppError('POS_MEMBER_LOCKED', 'too many wrong bonus card PINs', {
        until: lockedUntil.toISOString(),
      });
    }
    throw new AppError('POS_MEMBER_PIN_INVALID', 'wrong bonus card PIN', {
      attemptsLeft: LOYALTY_LIMITS.pinFailures - failed,
    });
  }

  /**
   * What this edge's documents moved on these cards that the feed does not count: every document
   * not replayed yet, and those replayed after the feed was built.
   */
  async pending(memberIds: readonly number[], tx?: EdgeTx): Promise<Map<number, PendingPoints>> {
    if (memberIds.length === 0) return new Map();
    const since = this.feed?.generatedAt ?? null;
    const notCounted = since
      ? or(
          ne(edgeOutbox.status, 'SENT'),
          isNull(edgeOutbox.sentAt),
          gt(edgeOutbox.sentAt, new Date(since)),
        )
      : undefined;
    const rows = await (tx ?? this.db)
      .select({
        memberId: edgeSales.memberId,
        points: sql<string>`coalesce(sum(${edgeSales.pointsDelta}), 0)`,
        spend: sql<string>`coalesce(sum(${edgeSales.spendDelta}), 0)`,
      })
      .from(edgeSales)
      .innerJoin(
        edgeOutbox,
        and(eq(edgeOutbox.clientId, edgeSales.clientId), eq(edgeOutbox.kind, edgeSales.kind)),
      )
      .where(and(inArray(edgeSales.memberId, [...memberIds]), notCounted))
      .groupBy(edgeSales.memberId);
    return new Map(
      rows.flatMap((row) =>
        row.memberId === null
          ? []
          : [
              [
                row.memberId,
                { points: new Decimal(row.points), spend: new Decimal(row.spend) },
              ] as const,
            ],
      ),
    );
  }

  private index(feed: PosLoyaltyFeed): void {
    this.feed = feed;
    this.byId = new Map(feed.members.map((member) => [member.id, member]));
    this.byPhone = new Map(feed.members.map((member) => [member.phone, member]));
  }
}
