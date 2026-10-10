import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { LOGIN_FAILURES_PER_IP, LOGIN_FAILURES_PER_USER, LOGIN_WINDOW_MS } from '../auth.constants';

export interface LoginLimits {
  perUser: number;
  perIp: number;
  windowMs: number;
}

export const LOGIN_LIMITS = Symbol('LOGIN_LIMITS');
export const DEFAULT_LOGIN_LIMITS: LoginLimits = {
  perUser: LOGIN_FAILURES_PER_USER,
  perIp: LOGIN_FAILURES_PER_IP,
  windowMs: LOGIN_WINDOW_MS,
};

/**
 * Counts failed logins and failed code redemptions per IP + username and per IP over a rolling
 * window (ADR-0027 #9). Only failures count, so legitimate logins never lock anyone out. In memory:
 * one api process serves all requests (docs/architecture.md §10.2).
 */
@Injectable()
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(@Inject(LOGIN_LIMITS) private readonly limits: LoginLimits) {}

  /** Throws 429 TOO_MANY_REQUESTS while either key is over its limit. */
  assertAllowed(ip: string | null, username: string, now = Date.now()): void {
    const keys = this.keys(ip, username);
    const waits = [
      this.waitMs(keys.user, this.limits.perUser, now),
      this.waitMs(keys.ip, this.limits.perIp, now),
    ];
    const waitMs = Math.max(...waits);
    if (waitMs > 0) {
      throw new AppError('TOO_MANY_REQUESTS', 'too many failed attempts', {
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      });
    }
  }

  recordFailure(ip: string | null, username: string, now = Date.now()): void {
    const keys = this.keys(ip, username);
    for (const key of [keys.user, keys.ip]) {
      const list = this.recent(key, now);
      list.push(now);
      this.failures.set(key, list);
    }
    if (this.failures.size > 10_000) this.prune(now);
  }

  recordSuccess(ip: string | null, username: string): void {
    this.failures.delete(this.keys(ip, username).user);
  }

  /** An admin unlock also forgets the user's recent failures from every address. */
  clearUser(username: string): void {
    for (const key of [...this.failures.keys()]) {
      if (key.startsWith('u:') && key.endsWith(`|${username}`)) this.failures.delete(key);
    }
  }

  private keys(ip: string | null, username: string) {
    const address = ip ?? 'unknown';
    return { user: `u:${address}|${username}`, ip: `i:${address}` };
  }

  private recent(key: string, now: number): number[] {
    return (this.failures.get(key) ?? []).filter((at) => now - at < this.limits.windowMs);
  }

  /** Milliseconds until the oldest failure that keeps the key at its limit leaves the window. */
  private waitMs(key: string, limit: number, now: number): number {
    const list = this.recent(key, now);
    if (list.length < limit) return 0;
    const oldestCounting = list[list.length - limit] ?? now;
    return oldestCounting + this.limits.windowMs - now;
  }

  private prune(now: number): void {
    for (const [key] of this.failures) {
      const list = this.recent(key, now);
      if (list.length) this.failures.set(key, list);
      else this.failures.delete(key);
    }
  }
}
