import { Injectable } from '@nestjs/common';
import type { EdgePrintSecrets } from '@tugeel/shared/pos';

/**
 * The only place the lottery and the QR data live (ADR-0065, CLAUDE.md NEVER): this process's
 * memory, never the database, a file or a log. Two kinds, as the owner chose (2026-10-26):
 * - each till's **last** receipt, reprinted with them as often as the cashier asks, until the
 *   till's next sale or its shift's close;
 * - a **late** receipt (PosAPI was away at the sale and the edge issued it afterwards), printed
 *   once with them when the customer comes back, or dropped at its till's shift close.
 * A restart forgets everything: every reprint is then a copy («ХУУЛБАР»).
 */
@Injectable()
export class PrintableCache {
  private readonly last = new Map<string, { clientId: string; secrets: EdgePrintSecrets }>();
  private readonly late = new Map<string, { tillCode: string; secrets: EdgePrintSecrets }>();

  /** A new sale on the till: the receipt before it can no longer be reprinted with them. */
  newSale(tillCode: string): void {
    this.last.delete(tillCode);
  }

  rememberLast(tillCode: string, clientId: string, secrets: EdgePrintSecrets): void {
    this.last.set(tillCode, { clientId, secrets });
  }

  rememberLate(tillCode: string, clientId: string, secrets: EdgePrintSecrets): void {
    this.late.set(clientId, { tillCode, secrets });
  }

  /**
   * The secrets to print `clientId` with at `tillCode`: the till's last receipt (kept), or a late
   * receipt (given once, then forgotten); null when it is to be printed as a copy.
   */
  take(tillCode: string, clientId: string): EdgePrintSecrets | null {
    const last = this.last.get(tillCode);
    if (last?.clientId === clientId) return last.secrets;
    const late = this.late.get(clientId);
    if (!late) return null;
    this.late.delete(clientId);
    return late.secrets;
  }

  /** The late receipts still waiting for their one print, with the till that sold them. */
  ready(): { clientId: string; tillCode: string }[] {
    return [...this.late].map(([clientId, entry]) => ({ clientId, tillCode: entry.tillCode }));
  }

  /** The till's shift closed: its last and its late receipts are gone. */
  forgetTill(tillCode: string): void {
    this.last.delete(tillCode);
    for (const [clientId, entry] of this.late) {
      if (entry.tillCode === tillCode) this.late.delete(clientId);
    }
  }
}
