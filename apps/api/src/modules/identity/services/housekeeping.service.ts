import { Inject, Injectable } from '@nestjs/common';
import { lt, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { authSessions, idempotencyKeys, passwordResets } from '../schema';
import { StorageService } from './storage.service';

/** How long identity keeps its short-lived rows (ADR-0040). */
export const RETENTION = {
  /** Sessions after they expired or were revoked: the sign-in trail (device, address) an admin reads. */
  sessionDays: 90,
  /** One-time password codes after they expired (a code lives 30 minutes). */
  passwordCodeDays: 30,
  /** Idempotency keys after they were claimed: clients retry within minutes, never after days. */
  idempotencyKeyDays: 7,
  /** Upload slots nobody attached (an upload URL lives 15 minutes). */
  pendingFileHours: 24,
} as const;

export interface HousekeepingResult {
  sessions: number;
  passwordCodes: number;
  idempotencyKeys: number;
  /** Upload slots whose bytes never arrived, removed. */
  filesRemoved: number;
  /** Uploads never attached to a document, marked DELETED. */
  filesAbandoned: number;
  /** DELETED files whose bytes were removed. */
  filesPurged: number;
}

const daysAgo = (days: number): SQL => sql`now() - make_interval(days => ${days})`;

/**
 * identity.housekeeping (ADR-0040): deletes the rows identity no longer needs and removes the
 * bytes of deleted files. Every step is a plain statement on its own, so a run cut short is simply
 * finished by the next one.
 */
@Injectable()
export class HousekeepingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  async run(): Promise<HousekeepingResult> {
    const sessions = await this.db
      .delete(authSessions)
      .where(
        or(
          lt(authSessions.expiresAt, daysAgo(RETENTION.sessionDays)),
          lt(authSessions.revokedAt, daysAgo(RETENTION.sessionDays)),
        ),
      );
    const passwordCodes = await this.db
      .delete(passwordResets)
      .where(lt(passwordResets.expiresAt, daysAgo(RETENTION.passwordCodeDays)));
    const keys = await this.db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.createdAt, daysAgo(RETENTION.idempotencyKeyDays)));
    const pending = await this.storage.abandonPending(RETENTION.pendingFileHours);
    const filesPurged = await this.storage.purgeDeleted();
    return {
      sessions: sessions.rowCount ?? 0,
      passwordCodes: passwordCodes.rowCount ?? 0,
      idempotencyKeys: keys.rowCount ?? 0,
      filesRemoved: pending.removed,
      filesAbandoned: pending.abandoned,
      filesPurged,
    };
  }
}
