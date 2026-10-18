import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { normalizeTillCode, type SnapshotTill, tillCodeLookKey } from '@tugeel/shared/pos';
import { and, eq, isNull } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../db/edge-db';
import { edgeDevices } from '../db/schema';
import { OutboxService } from './outbox.service';
import { SnapshotStore } from './snapshot.store';
import { SyncRunner } from './sync.runner';

export interface BoundDevice {
  id: number;
  tillCode: string;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Seen-at writes at most this often per device. */
const SEEN_EVERY_MS = 60_000;

/**
 * The browsers bound to the store's tills (ADR-0063 #6, ADR-0067): the admin issues a one-time
 * pairing code for a till, the browser trades it here for its own token (kept in its localStorage),
 * and the centre hears of the binding through the outbox (TILL_BOUND). Checked offline against the
 * code's hash in the snapshot; a code the snapshot does not know yet (issued since the last pull)
 * makes the edge pull once more when the centre is reachable.
 */
@Injectable()
export class DevicesService {
  private readonly seen = new Map<number, number>();

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly outbox: OutboxService,
    private readonly sync: SyncRunner,
  ) {}

  async pair(
    tillCode: string,
    pairingCode: string,
    userAgent: string | null,
  ): Promise<{ token: string; till: { code: string; name: string } }> {
    let till = this.pairable(tillCode, pairingCode);
    if (!till && (await this.sync.pullOnce()) === 'changed') {
      till = this.pairable(tillCode, pairingCode);
    }
    if (!till) {
      this.store.get(); // no snapshot at all: POS_SNAPSHOT_MISSING says so
      throw new AppError('POS_PAIRING_INVALID', 'unknown till, wrong or expired pairing code');
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    const boundAt = new Date();
    await inEdgeTransaction(this.db, async (tx) => {
      await tx.insert(edgeDevices).values({ tillCode: till.code, tokenHash, userAgent, boundAt });
      await this.outbox.enqueue(tx, {
        kind: 'TILL_BOUND',
        clientId: randomUUID(),
        tillBound: {
          tillCode: till.code,
          deviceTokenHash: tokenHash,
          userAgent: userAgent?.slice(0, 300) ?? null,
          boundByUserId: null,
          boundAt: boundAt.toISOString(),
        },
      });
    });
    return { token, till: { code: till.code, name: till.name } };
  }

  private pairable(tillCode: string, pairingCode: string): SnapshotTill | null {
    const tills = this.store.peek()?.tills;
    // The exact code first; else the till whose code looks the same (Latin «K1» for «К1»).
    const till =
      tills?.get(normalizeTillCode(tillCode)) ??
      [...(tills?.values() ?? [])].find(
        (candidate) => tillCodeLookKey(candidate.code) === tillCodeLookKey(tillCode),
      );
    const valid =
      till !== undefined &&
      till.status === 'ACTIVE' &&
      till.pairingCodeHash !== null &&
      till.pairingExpiresAt !== null &&
      Date.parse(till.pairingExpiresAt) > Date.now() &&
      sha256(`${till.id}:${pairingCode.trim()}`) === till.pairingCodeHash;
    return valid ? till : null;
  }

  /** The device behind a token; its till must still be active in the snapshot. */
  async authenticate(token: string | undefined): Promise<BoundDevice> {
    if (!token) throw new AppError('POS_DEVICE_UNKNOWN', 'no device token');
    const [row] = await this.db
      .select({ id: edgeDevices.id, tillCode: edgeDevices.tillCode })
      .from(edgeDevices)
      .where(and(eq(edgeDevices.tokenHash, sha256(token)), isNull(edgeDevices.revokedAt)));
    if (!row) throw new AppError('POS_DEVICE_UNKNOWN', 'unknown or revoked device token');
    const till = this.store.get().tills.get(row.tillCode);
    if (!till || till.status !== 'ACTIVE') {
      throw new AppError('POS_TILL_INACTIVE', `till ${row.tillCode} is not active`, {
        tillCode: row.tillCode,
      });
    }
    const last = this.seen.get(row.id) ?? 0;
    if (Date.now() - last > SEEN_EVERY_MS) {
      this.seen.set(row.id, Date.now());
      await this.db
        .update(edgeDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(edgeDevices.id, row.id));
    }
    return row;
  }
}
