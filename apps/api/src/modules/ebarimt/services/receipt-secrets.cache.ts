import { Injectable } from '@nestjs/common';

/** What only a printed receipt may show: never stored, never logged (CLAUDE.md NEVER, ADR-0022). */
export interface ReceiptSecrets {
  lottery: string | null;
  qrData: string | null;
}

/** How long an issued receipt waits for its one print with the lottery and the QR code. */
export const SECRETS_TTL_MS = 30 * 60_000;
/** More waiting receipts than this and the oldest are dropped: their prints become copies. */
const MAX_ENTRIES = 500;

/**
 * The only place the centre holds a wholesale receipt's lottery and QR data (ADR-0185 #6): the api
 * process's memory, for one print within `SECRETS_TTL_MS`. The store edge hands them over inside
 * its result call; nothing here reaches the database, the audit or a log. Where api replicas run
 * (ADR-0192) the edge's sync and the receipts' routes both stay on the primary, so the result and
 * the print meet in this one process. A restart, the time
 * limit or the first print forgets them: every later print is a copy («ХУУЛБАР»).
 */
@Injectable()
export class ReceiptSecretsCache {
  private readonly entries = new Map<number, { secrets: ReceiptSecrets; expiresAt: number }>();

  put(receiptId: number, secrets: ReceiptSecrets, now: number = Date.now()): void {
    if (secrets.lottery === null && secrets.qrData === null) return;
    this.sweep(now);
    this.entries.delete(receiptId);
    this.entries.set(receiptId, { secrets, expiresAt: now + SECRETS_TTL_MS });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** The secrets for the receipt's one print, forgotten as they are handed out. */
  take(receiptId: number, now: number = Date.now()): ReceiptSecrets | null {
    const entry = this.entries.get(receiptId);
    if (!entry) return null;
    this.entries.delete(receiptId);
    return entry.expiresAt > now ? entry.secrets : null;
  }

  /** Whether a print now would still carry them (the list's «Сугалаатай хэвлэх»). */
  has(receiptId: number, now: number = Date.now()): boolean {
    const entry = this.entries.get(receiptId);
    return entry !== undefined && entry.expiresAt > now;
  }

  /** A cancelled receipt's are dropped at once. */
  forget(receiptId: number): void {
    this.entries.delete(receiptId);
  }

  private sweep(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
