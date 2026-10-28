import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import {
  type Gender,
  GENDERS,
  isMemberPin,
  LOYALTY_LIMITS,
  type LoyaltyEntryKind,
  type LoyaltyIssue,
  type LoyaltyMemberStatus,
  loyaltyEarnBase,
  loyaltyReturn,
  nextTierOf,
  type PosLoyaltyFeed,
  pointsEarned,
  pointsPart,
  type SaleKind,
  tierFor,
} from '@tugeel/shared/pos';
import { normalizeRegNo, REG_NO_MAX_LENGTH } from '@tugeel/shared/taxpayer';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { JournalService } from '../../finance';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { PinHasher } from '../pin-hasher';
import type { SaleDoc } from '../sale-doc';
import {
  posEdgeNodes,
  posLoyaltyEntries,
  posLoyaltyMembers,
  posLoyaltyTiers,
  posSaleLoyalty,
  posSales,
} from '../schema';

type MemberRow = typeof posLoyaltyMembers.$inferSelect;

export interface LoyaltyTier {
  id: number;
  name: string;
  fromAmount: Decimal;
  percent: Decimal;
}

export interface LoyaltyTiersInput {
  /** The whole list: a row with an id keeps it, one without adds a tier; a missing one retires. */
  tiers: { id: number | null; name: string; fromAmount: Decimal; percent: Decimal }[];
}

export interface MemberInput {
  name: string;
  phone: string;
  regNo: string | null;
  birthDate: string | null;
  gender: Gender | null;
  note: string | null;
}

export interface MemberView {
  id: number;
  name: string;
  phone: string;
  regNo: string | null;
  birthDate: string | null;
  gender: Gender | null;
  note: string | null;
  status: LoyaltyMemberStatus;
  balance: Decimal;
  lifetimeSpend: Decimal;
  tier: { name: string; percent: Decimal } | null;
  nextTier: { name: string; percent: Decimal; fromAmount: Decimal; left: Decimal } | null;
  pinSetAt: Date;
  createdAt: Date;
  createdByName: string | null;
}

export interface MemberEntryView {
  id: number;
  kind: LoyaltyEntryKind;
  points: Decimal;
  spendDelta: Decimal;
  saleId: number | null;
  saleNumber: string | null;
  percent: Decimal | null;
  reason: string | null;
  journalNumber: string | null;
  createdAt: Date;
  createdByName: string | null;
}

export interface SaleLoyaltyView {
  id: number;
  saleId: number;
  saleNumber: string;
  soldAt: Date;
  kind: SaleKind;
  memberId: number;
  memberName: string;
  earned: Decimal;
  spent: Decimal;
  givenBack: Decimal;
  clawback: Decimal;
  balanceAfter: Decimal;
  issue: LoyaltyIssue | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
}

/** A sale's member, locked, and what the centre will write once the sale's row exists. */
export interface LockedLoyalty {
  member: MemberRow;
  kind: SaleKind;
  loyalty: NonNullable<SaleDoc['loyalty']>;
  issue: LoyaltyIssue | null;
}

const MONEY_SCALE = 2;
const ZERO = new Decimal(0);

/**
 * The bonus card on the centre (ADR-0112): the members the office registers (their phone, PIN and
 * card status), the admin's tiers, the points history and its cached balance and lifetime spend,
 * the feed every edge pulls, the member part of a replayed sale — kept even when the card was
 * blocked or the points spent passed what the centre knows (the till has sold), each listed for
 * the office — and the admin's hand adjustments with their journal entry.
 */
@Injectable()
export class PosLoyaltyService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly pins: PinHasher,
    private readonly journal: JournalService,
  ) {}

  // ------------------------------------------------------------------ tiers

  /** The active tiers, lowest threshold first. */
  async tiers(executor: Db | Tx = this.db): Promise<LoyaltyTier[]> {
    return executor
      .select({
        id: posLoyaltyTiers.id,
        name: posLoyaltyTiers.name,
        fromAmount: posLoyaltyTiers.fromAmount,
        percent: posLoyaltyTiers.percent,
      })
      .from(posLoyaltyTiers)
      .where(eq(posLoyaltyTiers.status, 'ACTIVE'))
      .orderBy(asc(posLoyaltyTiers.fromAmount), asc(posLoyaltyTiers.id));
  }

  /** Saves the tiers as a whole list (`pos.manage`); a tier left out is retired, never deleted. */
  async replaceTiers(ctx: AuthContext, input: LoyaltyTiersInput): Promise<LoyaltyTier[]> {
    if (input.tiers.length > LOYALTY_LIMITS.maxTiers) {
      throw invalid('tiers', 'count', `at most ${LOYALTY_LIMITS.maxTiers} tiers`);
    }
    const froms = new Set<string>();
    const ids = new Set<number>();
    const tiers = input.tiers.map((tier, index) => {
      const name = tier.name.trim();
      if (name.length === 0 || name.length > LOYALTY_LIMITS.maxTierName) {
        throw invalid(`tiers[${index}].name`, 'length', `1 to ${LOYALTY_LIMITS.maxTierName}`);
      }
      if (
        tier.fromAmount.isNegative() ||
        !tier.fromAmount.isInteger() ||
        tier.fromAmount.gt(LOYALTY_LIMITS.maxTierFrom)
      ) {
        throw invalid(`tiers[${index}].fromAmount`, 'money', 'whole tugriks from 0');
      }
      if (!tier.percent.gt(0) || tier.percent.gt(100) || tier.percent.decimalPlaces() > 2) {
        throw invalid(`tiers[${index}].percent`, 'percent', 'above 0, at most 100, 2 decimals');
      }
      const key = tier.fromAmount.toFixed(0);
      if (froms.has(key)) throw invalid(`tiers[${index}].fromAmount`, 'unique', 'one tier each');
      froms.add(key);
      if (tier.id !== null) {
        if (ids.has(tier.id)) throw invalid(`tiers[${index}].id`, 'unique', 'listed once');
        ids.add(tier.id);
      }
      return { ...tier, name };
    });
    tiers.sort((a, b) => a.fromAmount.comparedTo(b.fromAmount));
    await inTransaction(this.db, async (tx) => {
      const before = await tx.select().from(posLoyaltyTiers).for('update');
      const known = new Map(before.map((tier) => [tier.id, tier]));
      for (const tier of tiers) {
        if (tier.id !== null && !known.has(tier.id)) throw notFound('pos_loyalty_tier', tier.id);
      }
      // Retire first, so a kept threshold may move onto a retired one's.
      await tx
        .update(posLoyaltyTiers)
        .set({ status: 'INACTIVE', updatedAt: sql`now()` })
        .where(eq(posLoyaltyTiers.status, 'ACTIVE'));
      for (const [sort, tier] of tiers.entries()) {
        const values = {
          name: tier.name,
          fromAmount: tier.fromAmount,
          percent: tier.percent,
          sort,
          status: 'ACTIVE' as const,
        };
        if (tier.id === null) await tx.insert(posLoyaltyTiers).values(values);
        else {
          await tx
            .update(posLoyaltyTiers)
            .set({ ...values, updatedAt: sql`now()` })
            .where(eq(posLoyaltyTiers.id, tier.id));
        }
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_loyalty_tiers',
        entityId: 0,
        before: {
          tiers: before.filter((tier) => tier.status === 'ACTIVE').map(tierAudit),
        },
        after: { tiers: tiers.map(tierAudit) },
      });
    });
    return this.tiers();
  }

  // ------------------------------------------------------------------ members

  async register(ctx: AuthContext, input: MemberInput & { pin: string }): Promise<MemberView> {
    const values = this.checked(input);
    checkPin(input.pin);
    const pinHash = await this.pins.hash(input.pin);
    const id = await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(posLoyaltyMembers)
        .values({ ...values, pinHash, createdBy: ctx.userId })
        .returning({ id: posLoyaltyMembers.id })
        .catch((error: unknown) => phoneTaken(error, values.phone));
      if (!row) throw new Error('pos_loyalty_members insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'pos_loyalty_members',
        entityId: row.id,
        after: { ...values },
      });
      return row.id;
    });
    return this.get(id);
  }

  async update(ctx: AuthContext, id: number, input: MemberInput): Promise<MemberView> {
    const values = this.checked(input);
    await inTransaction(this.db, async (tx) => {
      const before = await this.lockMember(tx, id);
      await tx
        .update(posLoyaltyMembers)
        .set({ ...values, updatedAt: sql`now()` })
        .where(eq(posLoyaltyMembers.id, id))
        .catch((error: unknown) => phoneTaken(error, values.phone));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_loyalty_members',
        entityId: id,
        before: memberAudit(before),
        after: { ...values },
      });
    });
    return this.get(id);
  }

  /** A new PIN, set at the office (owner 2026-10-28): the till's lock of the old one ends. */
  async setPin(ctx: AuthContext, id: number, pin: string): Promise<MemberView> {
    checkPin(pin);
    const pinHash = await this.pins.hash(pin);
    await inTransaction(this.db, async (tx) => {
      await this.lockMember(tx, id);
      await tx
        .update(posLoyaltyMembers)
        .set({
          pinHash,
          pinVersion: sql`${posLoyaltyMembers.pinVersion} + 1`,
          pinSetAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(posLoyaltyMembers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'PIN_SET',
        entity: 'pos_loyalty_members',
        entityId: id,
        after: { pinSet: true },
      });
    });
    return this.get(id);
  }

  async setStatus(ctx: AuthContext, id: number, status: LoyaltyMemberStatus): Promise<MemberView> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.lockMember(tx, id);
      if (before.status === status) return;
      await tx
        .update(posLoyaltyMembers)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(posLoyaltyMembers.id, id));
      await this.audit.record(tx, ctx, {
        action: status === 'BLOCKED' ? 'BLOCK' : 'UNBLOCK',
        entity: 'pos_loyalty_members',
        entityId: id,
        before: { status: before.status },
        after: { status },
      });
    });
    return this.get(id);
  }

  /**
   * Points added or removed by hand with a reason (owner 2026-10-28): an ADJUST entry and its
   * journal entry — Dr LOYALTY_EXPENSE / Cr LOYALTY_LIABILITY for points added, the reverse for
   * points removed (TODO-VERIFY D16). The lifetime spend stays; the balance may not go below zero.
   */
  async adjust(
    ctx: AuthContext,
    id: number,
    input: { points: Decimal; reason: string },
  ): Promise<MemberView> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > LOYALTY_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${LOYALTY_LIMITS.maxReason} characters`);
    }
    const points = input.points;
    if (points.isZero() || !points.isInteger() || points.abs().gt(LOYALTY_LIMITS.maxAdjust)) {
      throw invalid('points', 'points', `whole points, not 0, at most ${LOYALTY_LIMITS.maxAdjust}`);
    }
    await inTransaction(this.db, async (tx) => {
      const member = await this.lockMember(tx, id);
      const balance = member.balance.plus(points);
      if (balance.isNegative()) {
        throw new AppError('POS_POINTS_INSUFFICIENT', `member ${id} has fewer points`, {
          available: member.balance.toFixed(0),
        });
      }
      const nodes = await tx
        .select({ warehouseId: posEdgeNodes.warehouseId })
        .from(posEdgeNodes)
        .where(eq(posEdgeNodes.status, 'ACTIVE'));
      const amount = points.abs();
      const entry = await this.journal.post(tx, ctx, {
        entryDate: businessDate(),
        warehouseIds: [...new Set(nodes.map((node) => node.warehouseId))],
        description: `Бонус оноо: ${member.name} — ${reason}`.slice(0, 300),
        source: 'MANUAL',
        lines: points.gt(0)
          ? [
              { role: 'LOYALTY_EXPENSE', debit: amount, credit: ZERO },
              { role: 'LOYALTY_LIABILITY', debit: ZERO, credit: amount },
            ]
          : [
              { role: 'LOYALTY_LIABILITY', debit: amount, credit: ZERO },
              { role: 'LOYALTY_EXPENSE', debit: ZERO, credit: amount },
            ],
      });
      await tx.insert(posLoyaltyEntries).values({
        memberId: id,
        kind: 'ADJUST',
        points,
        reason,
        journalEntryId: entry.id,
        journalNumber: entry.number,
        createdBy: ctx.userId,
      });
      await tx
        .update(posLoyaltyMembers)
        .set({ balance, updatedAt: sql`now()` })
        .where(eq(posLoyaltyMembers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'ADJUST',
        entity: 'pos_loyalty_members',
        entityId: id,
        before: { balance: member.balance.toFixed(0) },
        after: {
          balance: balance.toFixed(0),
          points: points.toFixed(0),
          reason,
          journal: entry.number,
        },
      });
    });
    return this.get(id);
  }

  async list(query: {
    q?: string;
    status?: LoyaltyMemberStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: MemberView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(posLoyaltyMembers.status, query.status));
    const q = query.q?.trim();
    if (q) {
      const digits = q.replace(/[\s()+-]/g, '');
      const pattern = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      filters.push(
        /^\d{2,}$/.test(digits)
          ? sql`${posLoyaltyMembers.phone} LIKE ${`%${digits}%`}`
          : sql`${posLoyaltyMembers.name} ILIKE ${pattern}`,
      );
    }
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(posLoyaltyMembers.id, after.id));
    const rows = await this.db
      .select()
      .from(posLoyaltyMembers)
      .where(and(...filters))
      .orderBy(desc(posLoyaltyMembers.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<MemberView> {
    const [row] = await this.db
      .select()
      .from(posLoyaltyMembers)
      .where(eq(posLoyaltyMembers.id, id));
    if (!row) throw notFound('pos_loyalty_member', id);
    const [view] = await this.views([row]);
    if (!view) throw notFound('pos_loyalty_member', id);
    return view;
  }

  /** A member's points history, newest first. */
  async entries(
    id: number,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: MemberEntryView[]; nextCursor: string | null }> {
    await this.get(id);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(posLoyaltyEntries.memberId, id)];
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(posLoyaltyEntries.id, after.id));
    const rows = await this.db
      .select({
        id: posLoyaltyEntries.id,
        kind: posLoyaltyEntries.kind,
        points: posLoyaltyEntries.points,
        spendDelta: posLoyaltyEntries.spendDelta,
        saleId: posLoyaltyEntries.saleId,
        saleNumber: posSales.number,
        percent: posLoyaltyEntries.percent,
        reason: posLoyaltyEntries.reason,
        journalNumber: posLoyaltyEntries.journalNumber,
        createdAt: posLoyaltyEntries.createdAt,
        createdBy: posLoyaltyEntries.createdBy,
      })
      .from(posLoyaltyEntries)
      .leftJoin(posSales, eq(posSales.id, posLoyaltyEntries.saleId))
      .where(and(...filters))
      .orderBy(desc(posLoyaltyEntries.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const names = await this.names.namesOf(
      page.data.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
    );
    return {
      data: page.data.map(({ createdBy, ...row }) => ({
        ...row,
        saleNumber: row.saleNumber ?? null,
        createdByName: createdBy === null ? null : (names.get(createdBy) ?? null),
      })),
      nextCursor: page.nextCursor,
    };
  }

  // ------------------------------------------------------------------ the edge

  /**
   * The bonus card for the tills (`GET /pos/sync/loyalty`): the active tiers and every member with
   * the PIN's hash, its version, the status, the balance and the lifetime spend, with a
   * content-hash version so an unchanged feed is not sent again.
   */
  async feed(): Promise<PosLoyaltyFeed> {
    const tiers = (await this.tiers()).map((tier) => ({
      id: tier.id,
      name: tier.name,
      fromAmount: tier.fromAmount.toFixed(MONEY_SCALE),
      percent: tier.percent.toFixed(MONEY_SCALE),
    }));
    const rows = await this.db.select().from(posLoyaltyMembers).orderBy(asc(posLoyaltyMembers.id));
    const members = rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      pinHash: row.pinHash,
      pinVersion: row.pinVersion,
      status: row.status,
      balance: row.balance.toFixed(MONEY_SCALE),
      lifetime: row.lifetimeSpend.toFixed(MONEY_SCALE),
    }));
    const version = createHash('sha256').update(JSON.stringify({ tiers, members })).digest('hex');
    return { version: version.slice(0, 20), generatedAt: new Date().toISOString(), tiers, members };
  }

  /**
   * The shape of a sale's member part (ADR-0112), before anything is read: a sale earns
   * floor(base × percent) on its cash, card and transfer and spends its one POINTS tender, never
   * beside credit; a return earns and spends nothing, gives points back as its POINTS tender and
   * lowers the lifetime spend. Points without a member are refused.
   */
  checkShape(doc: SaleDoc): void {
    const pointsTenders = doc.tenders.filter((tender) => tender.kind === 'POINTS');
    const loyalty = doc.loyalty;
    if (!loyalty) {
      if (pointsTenders.length > 0) throw invalid('loyalty', 'points', 'points need a member');
      return;
    }
    if (pointsTenders.length > 1) throw invalid('tenders', 'points', 'at most one POINTS tender');
    const points = pointsPart(doc.tenders);
    for (const [field, value] of [
      ['earned', loyalty.earned],
      ['spent', loyalty.spent],
      ['givenBack', loyalty.givenBack],
      ['clawback', loyalty.clawback],
    ] as const) {
      if (value.isNegative() || !value.isInteger()) {
        throw invalid(`loyalty.${field}`, 'points', 'whole points from 0');
      }
    }
    if (loyalty.percent.isNegative() || loyalty.percent.gt(100)) {
      throw invalid('loyalty.percent', 'percent', '0 to 100');
    }
    if (doc.kind === 'SALE') {
      if (doc.tenders.some((tender) => tender.kind === 'CREDIT')) {
        throw invalid('loyalty', 'credit', 'a bonus card does not go with credit');
      }
      const base = loyaltyEarnBase(doc.tenders);
      const mismatch = (field: string, expected: Decimal, got: Decimal) =>
        new AppError('POS_TOTALS_MISMATCH', `bonus card: ${field} differs`, {
          lineNo: null,
          field: `loyalty.${field}`,
          expected: expected.toFixed(MONEY_SCALE),
          got: got.toFixed(MONEY_SCALE),
        });
      if (!loyalty.earnBase.eq(base)) throw mismatch('earnBase', base, loyalty.earnBase);
      const earned = pointsEarned(base, loyalty.percent);
      if (!loyalty.earned.eq(earned)) throw mismatch('earned', earned, loyalty.earned);
      if (!loyalty.spent.eq(points)) throw mismatch('spent', points, loyalty.spent);
      if (!loyalty.givenBack.isZero() || !loyalty.clawback.isZero()) {
        throw invalid('loyalty', 'sale', 'a sale gives nothing back');
      }
      if (!loyalty.spendDelta.eq(base)) throw mismatch('spendDelta', base, loyalty.spendDelta);
      return;
    }
    if (!loyalty.earned.isZero() || !loyalty.spent.isZero()) {
      throw invalid('loyalty', 'return', 'a return earns and spends nothing');
    }
    if (!loyalty.givenBack.eq(points)) {
      throw invalid('loyalty.givenBack', 'points', 'the return’s POINTS tender');
    }
    if (loyalty.spendDelta.gt(0)) throw invalid('loyalty.spendDelta', 'return', 'zero or less');
  }

  /**
   * Locks a sale's member, after the shift, the customer and the codes, before the shelf. A sale
   * is kept whatever the card's state (an offline till has sold): a BLOCKED card or more points
   * spent than the centre's balance is its issue. A return must settle the card as `loyaltyReturn`
   * says, from the refunded sale's member part and its earlier returns'. An unknown member is
   * refused for good.
   */
  async lockForSaleInTx(
    tx: Tx,
    doc: SaleDoc,
    original: { id: number; number: string } | null,
  ): Promise<LockedLoyalty | null> {
    const sold = original
      ? await tx.select().from(posSaleLoyalty).where(eq(posSaleLoyalty.saleId, original.id))
      : [];
    const loyalty = doc.loyalty;
    if (!loyalty) {
      if (sold.length > 0) {
        throw invalid('loyalty', 'return', `sale ${original?.number} was a bonus card sale`);
      }
      return null;
    }
    const member = await this.lockMember(tx, loyalty.memberId);
    if (doc.kind === 'SALE') {
      const issue: LoyaltyIssue | null =
        member.status === 'BLOCKED'
          ? 'BLOCKED'
          : loyalty.spent.gt(member.balance)
            ? 'OVERDRAWN'
            : null;
      return { member, kind: 'SALE', loyalty, issue };
    }
    const sale = sold[0];
    if (!sale || sale.memberId !== loyalty.memberId) {
      throw invalid('loyalty.memberId', 'return', 'the member of the refunded sale');
    }
    const [earlier] = await tx
      .select({
        givenBack: sql<string>`coalesce(sum(${posSaleLoyalty.givenBack}), 0)`,
        clawback: sql<string>`coalesce(sum(${posSaleLoyalty.clawback}), 0)`,
        spendDelta: sql<string>`coalesce(sum(${posSaleLoyalty.spendDelta}), 0)`,
      })
      .from(posSaleLoyalty)
      .innerJoin(posSales, eq(posSales.id, posSaleLoyalty.saleId))
      .where(eq(posSales.refundsSaleId, original?.id ?? 0));
    const split = loyaltyReturn({
      refund: doc.total,
      sale: { earned: sale.earned, spent: sale.spent, earnBase: sale.earnBase },
      previous: {
        givenBack: new Decimal(earlier?.givenBack ?? 0),
        clawedBack: new Decimal(earlier?.clawback ?? 0),
        money: new Decimal(earlier?.spendDelta ?? 0).negated(),
      },
    });
    for (const [field, expected, got] of [
      ['givenBack', split.givenBack, loyalty.givenBack],
      ['clawback', split.clawback, loyalty.clawback],
      ['spendDelta', split.spendDelta, loyalty.spendDelta],
    ] as const) {
      if (!expected.eq(got)) {
        throw new AppError('POS_TOTALS_MISMATCH', `bonus card return: ${field} differs`, {
          lineNo: null,
          field: `loyalty.${field}`,
          expected: expected.toFixed(MONEY_SCALE),
          got: got.toFixed(MONEY_SCALE),
        });
      }
    }
    return { member, kind: 'RETURN', loyalty, issue: null };
  }

  /**
   * Writes a sale's member part once its row exists: the entries (a sale's EARN with its spend and
   * SPEND; a return's RETURN_SPEND and RETURN_EARN), the member's caches and the sale's row.
   */
  async recordInTx(tx: Tx, saleId: number, locked: LockedLoyalty): Promise<{ balance: Decimal }> {
    const { loyalty, member } = locked;
    const entries: (typeof posLoyaltyEntries.$inferInsert)[] = [];
    if (locked.kind === 'SALE') {
      entries.push({
        memberId: member.id,
        kind: 'EARN',
        points: loyalty.earned,
        spendDelta: loyalty.spendDelta,
        saleId,
        percent: loyalty.percent,
      });
      if (loyalty.spent.gt(0)) {
        entries.push({
          memberId: member.id,
          kind: 'SPEND',
          points: loyalty.spent.negated(),
          saleId,
        });
      }
    } else {
      if (loyalty.givenBack.gt(0)) {
        entries.push({
          memberId: member.id,
          kind: 'RETURN_SPEND',
          points: loyalty.givenBack,
          saleId,
        });
      }
      if (loyalty.clawback.gt(0) || !loyalty.spendDelta.isZero()) {
        entries.push({
          memberId: member.id,
          kind: 'RETURN_EARN',
          points: loyalty.clawback.negated(),
          spendDelta: loyalty.spendDelta,
          saleId,
        });
      }
    }
    const change = entries.reduce((sum, entry) => sum.plus(entry.points), ZERO);
    const balance = member.balance.plus(change);
    const lifetimeSpend = member.lifetimeSpend.plus(loyalty.spendDelta);
    if (entries.length > 0) await tx.insert(posLoyaltyEntries).values(entries);
    await tx
      .update(posLoyaltyMembers)
      .set({ balance, lifetimeSpend, updatedAt: sql`now()` })
      .where(eq(posLoyaltyMembers.id, member.id));
    await tx.insert(posSaleLoyalty).values({
      saleId,
      memberId: member.id,
      kind: locked.kind,
      earnBase: loyalty.earnBase,
      percent: loyalty.percent,
      earned: loyalty.earned,
      spent: loyalty.spent,
      givenBack: loyalty.givenBack,
      clawback: loyalty.clawback,
      spendDelta: loyalty.spendDelta,
      balanceAfter: balance,
      issue: locked.issue,
    });
    return { balance };
  }

  // ------------------------------------------------------------------ the office's checks

  async toCheck(limit = 200): Promise<SaleLoyaltyView[]> {
    return this.saleViews(
      and(sql`${posSaleLoyalty.issue} IS NOT NULL`, isNull(posSaleLoyalty.reviewedAt)),
      limit,
    );
  }

  async toCheckCount(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSaleLoyalty)
      .where(and(sql`${posSaleLoyalty.issue} IS NOT NULL`, isNull(posSaleLoyalty.reviewedAt)));
    return Number.parseInt(row?.count ?? '0', 10);
  }

  /** «Шалгасан» on a member sale the centre found wrong (the card blocked, points overdrawn). */
  async review(ctx: AuthContext, id: number, note: string | null): Promise<SaleLoyaltyView> {
    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) throw invalid('note', 'length', 'at most 300 characters');
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ issue: posSaleLoyalty.issue, reviewedAt: posSaleLoyalty.reviewedAt })
        .from(posSaleLoyalty)
        .where(eq(posSaleLoyalty.id, id))
        .for('update');
      if (!row) throw notFound('pos_sale_loyalty', id);
      if (row.issue === null) {
        throw new AppError('POS_LOYALTY_NOTHING_TO_CHECK', `member sale ${id} is fine`, { id });
      }
      if (row.reviewedAt) return;
      await tx
        .update(posSaleLoyalty)
        .set({ reviewedAt: sql`now()`, reviewedBy: ctx.userId, reviewNote: trimmed })
        .where(eq(posSaleLoyalty.id, id));
      await this.audit.record(tx, ctx, {
        action: 'REVIEW',
        entity: 'pos_sale_loyalty',
        entityId: id,
        after: { issue: row.issue, note: trimmed },
      });
    });
    const [view] = await this.saleViews(eq(posSaleLoyalty.id, id), 1);
    if (!view) throw notFound('pos_sale_loyalty', id);
    return view;
  }

  /** A sale's member part for its page; null when it had no member. */
  async ofSale(saleId: number): Promise<SaleLoyaltyView | null> {
    const [view] = await this.saleViews(eq(posSaleLoyalty.saleId, saleId), 1);
    return view ?? null;
  }

  // ------------------------------------------------------------------ helpers

  private async saleViews(where: SQL | undefined, limit: number): Promise<SaleLoyaltyView[]> {
    return this.db
      .select({
        id: posSaleLoyalty.id,
        saleId: posSaleLoyalty.saleId,
        saleNumber: posSales.number,
        soldAt: posSales.soldAt,
        kind: posSaleLoyalty.kind,
        memberId: posSaleLoyalty.memberId,
        memberName: posLoyaltyMembers.name,
        earned: posSaleLoyalty.earned,
        spent: posSaleLoyalty.spent,
        givenBack: posSaleLoyalty.givenBack,
        clawback: posSaleLoyalty.clawback,
        balanceAfter: posSaleLoyalty.balanceAfter,
        issue: posSaleLoyalty.issue,
        reviewedAt: posSaleLoyalty.reviewedAt,
        reviewNote: posSaleLoyalty.reviewNote,
      })
      .from(posSaleLoyalty)
      .innerJoin(posSales, eq(posSales.id, posSaleLoyalty.saleId))
      .innerJoin(posLoyaltyMembers, eq(posLoyaltyMembers.id, posSaleLoyalty.memberId))
      .where(where)
      .orderBy(desc(posSaleLoyalty.id))
      .limit(limit);
  }

  private async lockMember(tx: Tx, id: number): Promise<MemberRow> {
    const [row] = await tx
      .select()
      .from(posLoyaltyMembers)
      .where(eq(posLoyaltyMembers.id, id))
      .for('update');
    if (!row) throw notFound('pos_loyalty_member', id);
    return row;
  }

  private checked(input: MemberInput) {
    const name = input.name.trim();
    if (name.length === 0 || name.length > LOYALTY_LIMITS.maxName) {
      throw invalid('name', 'length', `1 to ${LOYALTY_LIMITS.maxName} characters`);
    }
    const phone = normalizeMnPhone(input.phone);
    if (!phone) throw invalid('phone', 'phone', 'a Mongolian mobile number, 8 digits');
    const regNo = input.regNo?.trim() ? normalizeRegNo(input.regNo) : null;
    if (regNo && regNo.length > REG_NO_MAX_LENGTH) {
      throw invalid('regNo', 'length', `at most ${REG_NO_MAX_LENGTH} characters`);
    }
    const birthDate = input.birthDate?.trim() || null;
    if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || birthDate > businessDate())) {
      throw invalid('birthDate', 'date', 'a past day, YYYY-MM-DD');
    }
    if (input.gender !== null && !(GENDERS as readonly string[]).includes(input.gender)) {
      throw invalid('gender', 'enum', GENDERS.join(' or '));
    }
    const note = input.note?.trim() || null;
    if (note && note.length > LOYALTY_LIMITS.maxNote) {
      throw invalid('note', 'length', `at most ${LOYALTY_LIMITS.maxNote} characters`);
    }
    return { name, phone, regNo, birthDate, gender: input.gender, note };
  }

  private async views(rows: readonly MemberRow[]): Promise<MemberView[]> {
    const tiers = await this.tiers();
    const names = await this.names.namesOf([...new Set(rows.map((row) => row.createdBy))]);
    return rows.map((row) => {
      const tier = tierFor(row.lifetimeSpend, tiers);
      const next = nextTierOf(row.lifetimeSpend, tiers);
      return {
        id: row.id,
        name: row.name,
        phone: row.phone,
        regNo: row.regNo,
        birthDate: row.birthDate,
        gender: row.gender,
        note: row.note,
        status: row.status,
        balance: row.balance,
        lifetimeSpend: row.lifetimeSpend,
        tier: tier ? { name: tier.name, percent: tier.percent } : null,
        nextTier: next
          ? {
              name: next.name,
              percent: next.percent,
              fromAmount: next.fromAmount,
              left: next.fromAmount.minus(row.lifetimeSpend),
            }
          : null,
        pinSetAt: row.pinSetAt,
        createdAt: row.createdAt,
        createdByName: names.get(row.createdBy) ?? null,
      };
    });
  }

  /** The members of these ids (the sale pages), by id. */
  async namesOf(ids: readonly number[]): Promise<Map<number, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: posLoyaltyMembers.id, name: posLoyaltyMembers.name })
      .from(posLoyaltyMembers)
      .where(inArray(posLoyaltyMembers.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row.name]));
  }
}

function checkPin(pin: string): void {
  if (!isMemberPin(pin)) throw invalid('pin', 'pin', 'four digits');
}

function phoneTaken(error: unknown, phone: string): never {
  const database = databaseErrorOf(error);
  if (database?.code === '23505' && database.constraint === 'pos_loyalty_members_phone') {
    throw new AppError('POS_MEMBER_PHONE_TAKEN', `a member has phone ${phone}`, { phone });
  }
  throw error;
}

function tierAudit(tier: { name: string; fromAmount: Decimal; percent: Decimal }) {
  return {
    name: tier.name,
    fromAmount: tier.fromAmount.toFixed(0),
    percent: tier.percent.toFixed(MONEY_SCALE),
  };
}

function memberAudit(row: MemberRow) {
  return {
    name: row.name,
    phone: row.phone,
    regNo: row.regNo,
    birthDate: row.birthDate,
    gender: row.gender,
    note: row.note,
  };
}
