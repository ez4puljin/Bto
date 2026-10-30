import { Inject, Injectable } from '@nestjs/common';
import { isPin, type PosStatus } from '@tugeel/shared/pos';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { PinHasher } from '../pin-hasher';
import { posCashiers } from '../schema';

export interface Cashier {
  userId: number;
  username: string;
  fullName: string;
  userStatus: 'ACTIVE' | 'DISABLED';
  status: PosStatus;
  pinSetAt: Date;
  pinSetByName: string | null;
  failedCount: number;
  lockedUntil: Date | null;
  /** Holds `pos.till.supervise` (ADR-0124: the admin's supervisor picker). */
  supervisor: boolean;
}

/** Wrong PINs before a cashier waits (the kiosk shows the lock); the count resets on success. */
const LOCK_AFTER = 5;
const LOCK_MINUTES = 1;

/**
 * Who may work a till and the PIN they log in with (ADR-0063 #6). The PIN is set by an admin,
 * never shown again, and kept as a keyed argon2id hash the store's edge receives in its snapshot.
 */
@Injectable()
export class PosCashiersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly hasher: PinHasher,
  ) {}

  async list(): Promise<Cashier[]> {
    const rows = await this.db.select().from(posCashiers);
    const users = await this.names.summariesOf(rows.map((row) => row.userId));
    const setBy = await this.names.namesOf(
      rows.flatMap((row) => (row.pinSetBy === null ? [] : [row.pinSetBy])),
    );
    const supervisors = await this.names.holdersOf(
      'pos.till.supervise',
      rows.map((row) => row.userId),
    );
    const cashiers: Cashier[] = [];
    for (const row of rows) {
      const user = users.get(row.userId);
      if (!user) continue;
      cashiers.push({
        userId: row.userId,
        username: user.username,
        fullName: user.fullName,
        userStatus: user.status,
        status: row.status,
        pinSetAt: row.pinSetAt,
        pinSetByName: row.pinSetBy === null ? null : (setBy.get(row.pinSetBy) ?? null),
        failedCount: row.failedCount,
        lockedUntil: row.lockedUntil,
        supervisor: supervisors.has(row.userId),
      });
    }
    cashiers.sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn') || a.userId - b.userId);
    return cashiers;
  }

  async get(userId: number): Promise<Cashier> {
    const found = (await this.list()).find((cashier) => cashier.userId === userId);
    if (!found) throw notFound('pos_cashier', userId);
    return found;
  }

  /** Sets (or replaces) a user's PIN and makes them an active cashier. */
  async setPin(ctx: AuthContext, userId: number, pin: string): Promise<Cashier> {
    if (!isPin(pin)) throw invalid('pin', 'pattern', 'six digits');
    const user = (await this.names.summariesOf([userId])).get(userId);
    if (!user) throw notFound('user', userId);
    if (user.status !== 'ACTIVE') {
      throw new AppError('ACCOUNT_DISABLED', `user ${userId} is disabled`, { id: userId });
    }
    const pinHash = await this.hasher.hash(pin);
    await inTransaction(this.db, async (tx) => {
      await tx
        .insert(posCashiers)
        .values({ userId, pinHash, pinSetBy: ctx.userId })
        .onConflictDoUpdate({
          target: posCashiers.userId,
          set: {
            pinHash,
            pinSetAt: sql`now()`,
            pinSetBy: ctx.userId,
            status: 'ACTIVE',
            failedCount: 0,
            lockedUntil: null,
            updatedAt: sql`now()`,
          },
        });
      await this.audit.record(tx, ctx, {
        action: 'PIN_SET',
        entity: 'pos_cashiers',
        entityId: userId,
        after: { userId },
      });
    });
    return this.get(userId);
  }

  async setStatus(ctx: AuthContext, userId: number, status: PosStatus): Promise<Cashier> {
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ status: posCashiers.status })
        .from(posCashiers)
        .where(eq(posCashiers.userId, userId));
      if (!row) throw notFound('pos_cashier', userId);
      await tx
        .update(posCashiers)
        .set({ status, updatedAt: sql`now()` })
        .where(eq(posCashiers.userId, userId));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'pos_cashiers',
        entityId: userId,
        before: { status: row.status },
        after: { status },
      });
    });
    return this.get(userId);
  }

  async unlock(ctx: AuthContext, userId: number): Promise<Cashier> {
    await inTransaction(this.db, async (tx) => {
      const updated = await tx
        .update(posCashiers)
        .set({ failedCount: 0, lockedUntil: null, updatedAt: sql`now()` })
        .where(eq(posCashiers.userId, userId))
        .returning({ userId: posCashiers.userId });
      if (updated.length === 0) throw notFound('pos_cashier', userId);
      await this.audit.record(tx, ctx, {
        action: 'UNLOCK',
        entity: 'pos_cashiers',
        entityId: userId,
      });
    });
    return this.get(userId);
  }

  /** True when the PIN is right; counts failures and locks after too many (the centre's copy). */
  async verifyPin(userId: number, pin: string): Promise<boolean> {
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(posCashiers)
        .where(eq(posCashiers.userId, userId))
        .for('update');
      if (!row || row.status !== 'ACTIVE') {
        await this.hasher.verify(null, pin);
        return false;
      }
      if (row.lockedUntil && row.lockedUntil.getTime() > Date.now()) return false;
      const ok = await this.hasher.verify(row.pinHash, pin);
      await tx
        .update(posCashiers)
        .set(
          ok
            ? { failedCount: 0, lockedUntil: null, updatedAt: sql`now()` }
            : {
                failedCount: row.failedCount + 1,
                lockedUntil:
                  row.failedCount + 1 >= LOCK_AFTER
                    ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                    : null,
                updatedAt: sql`now()`,
              },
        )
        .where(eq(posCashiers.userId, userId));
      return ok;
    });
  }

  /** The cashier a replayed document names must be an active cashier and an active user. */
  async assertActive(userId: number, tx: Tx): Promise<{ userId: number; fullName: string }> {
    const [row] = await tx
      .select({ status: posCashiers.status })
      .from(posCashiers)
      .where(eq(posCashiers.userId, userId));
    const user = (await this.names.summariesOf([userId])).get(userId);
    if (!row || row.status !== 'ACTIVE' || !user || user.status !== 'ACTIVE') {
      throw new AppError('POS_CASHIER_INACTIVE', `user ${userId} is not an active cashier`, {
        userId,
      });
    }
    return { userId, fullName: user.fullName };
  }
}
