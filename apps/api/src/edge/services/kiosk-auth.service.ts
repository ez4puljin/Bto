import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  EdgeApproval,
  EdgeCashier,
  EdgeLoginResponse,
  EdgeSupervisor,
  SnapshotCashier,
} from '@tugeel/shared/pos';
import { isPin } from '@tugeel/shared/pos';
import { verify } from 'argon2';
import { eq } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EdgeConfig } from '../config/edge-env';
import { EDGE_DB, type EdgeDb } from '../db/edge-db';
import { edgePinAttempts } from '../db/schema';
import type { BoundDevice } from './devices.service';
import { SnapshotStore } from './snapshot.store';

/** A kiosk session: one cashier at one till for twelve hours. */
export interface KioskClaims {
  sub: number;
  till: string;
  dev: number;
  name: string;
  sup: boolean;
}

const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

/**
 * Cashiers sign in at a till with their six-digit PIN (ADR-0063 #6), checked offline against the
 * keyed argon2id hash in the snapshot with the PIN key the edge shares with the centre. Five wrong
 * PINs in a row lock the cashier on this edge for a minute. A supervisor's PIN approves a void or
 * a return the same way (ADR-0104), with the same lock.
 */
@Injectable()
export class KioskAuthService {
  private readonly pepper: Buffer;

  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    config: EdgeConfig,
    private readonly store: SnapshotStore,
    private readonly jwt: JwtService,
  ) {
    this.pepper = Buffer.from(config.get('POS_PIN_PEPPER'));
  }

  /** The till's sign-in list: active cashiers with a PIN, by name. */
  cashiers(): { userId: number; fullName: string }[] {
    return [...this.store.get().cashiers.values()]
      .filter((cashier) => cashier.status === 'ACTIVE' && cashier.pinHash !== null)
      .map((cashier) => ({ userId: cashier.userId, fullName: cashier.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }

  /** Who may approve at the till: active cashiers holding `pos.till.supervise`, by name. */
  supervisors(): EdgeSupervisor[] {
    return [...this.store.get().cashiers.values()]
      .filter((cashier) => cashier.supervisor && cashier.status === 'ACTIVE' && cashier.pinHash)
      .map((cashier) => ({ userId: cashier.userId, fullName: cashier.fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn'));
  }

  /**
   * The approver of a void or a return: a supervisor whose PIN is right (the signed-in cashier
   * may approve himself when he is one). Without an approval: null when the store's settings do
   * not ask for one, else `POS_SUPERVISOR_REQUIRED`.
   */
  async approve(approval: EdgeApproval | null): Promise<SnapshotCashier | null> {
    if (!approval) {
      if (this.store.get().snapshot.settings.supervisorRequired) {
        throw new AppError('POS_SUPERVISOR_REQUIRED', 'a supervisor must approve this');
      }
      return null;
    }
    const supervisor = await this.verifyPin(approval.supervisorUserId, approval.pin);
    if (!supervisor.supervisor) {
      throw new AppError('POS_SUPERVISOR_REQUIRED', `user ${supervisor.userId} cannot approve`, {
        userId: supervisor.userId,
      });
    }
    return supervisor;
  }

  async login(device: BoundDevice, userId: number, pin: string): Promise<EdgeLoginResponse> {
    const cashier = await this.verifyPin(userId, pin);
    const claims: KioskClaims = {
      sub: userId,
      till: device.tillCode,
      dev: device.id,
      name: cashier.fullName,
      sup: cashier.supervisor,
    };
    const token = await this.jwt.signAsync(claims, { expiresIn: `${SESSION_HOURS}h` });
    return {
      token,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000).toISOString(),
      cashier: { userId, fullName: cashier.fullName, supervisor: cashier.supervisor },
    };
  }

  /** An active cashier's PIN against the snapshot's hash, counting wrong ones. */
  private async verifyPin(
    userId: number,
    pin: string,
  ): Promise<SnapshotCashier & { pinHash: string }> {
    const cashier = this.store.get().cashiers.get(userId);
    if (!cashier || cashier.status !== 'ACTIVE' || cashier.pinHash === null) {
      throw new AppError('POS_CASHIER_INACTIVE', `cashier ${userId} cannot sign in`, { userId });
    }
    const [attempts] = await this.db
      .select()
      .from(edgePinAttempts)
      .where(eq(edgePinAttempts.userId, userId));
    if (attempts?.lockedUntil && attempts.lockedUntil.getTime() > Date.now()) {
      throw new AppError('POS_CASHIER_LOCKED', 'too many wrong PINs', {
        until: attempts.lockedUntil.toISOString(),
      });
    }
    const ok =
      isPin(pin) &&
      (await verify(cashier.pinHash, pin, { secret: this.pepper }).catch(() => false));
    if (!ok) {
      const failed = (attempts?.failedCount ?? 0) + 1;
      const lock = failed >= MAX_FAILURES;
      await this.db
        .insert(edgePinAttempts)
        .values({
          userId,
          failedCount: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
        })
        .onConflictDoUpdate({
          target: edgePinAttempts.userId,
          set: {
            failedCount: lock ? 0 : failed,
            lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null,
          },
        });
      if (lock) {
        throw new AppError('POS_CASHIER_LOCKED', 'too many wrong PINs', {
          until: new Date(Date.now() + LOCK_MS).toISOString(),
        });
      }
      throw new AppError('POS_PIN_INVALID', 'wrong PIN', { attemptsLeft: MAX_FAILURES - failed });
    }
    if (attempts) {
      await this.db.delete(edgePinAttempts).where(eq(edgePinAttempts.userId, userId));
    }
    return { ...cashier, pinHash: cashier.pinHash };
  }

  /** The cashier of a session, still active in the snapshot and at the same device. */
  async verify(device: BoundDevice, token: string | undefined): Promise<EdgeCashier> {
    if (!token) throw new AppError('POS_SESSION_EXPIRED', 'no session');
    let claims: KioskClaims;
    try {
      claims = await this.jwt.verifyAsync<KioskClaims>(token);
    } catch {
      throw new AppError('POS_SESSION_EXPIRED', 'session expired or invalid');
    }
    if (claims.dev !== device.id || claims.till !== device.tillCode) {
      throw new AppError('POS_SESSION_EXPIRED', 'session of another device');
    }
    const cashier = this.store.get().cashiers.get(claims.sub);
    if (!cashier || cashier.status !== 'ACTIVE') {
      throw new AppError('POS_SESSION_EXPIRED', 'cashier no longer active');
    }
    return { userId: claims.sub, fullName: cashier.fullName, supervisor: cashier.supervisor };
  }
}
