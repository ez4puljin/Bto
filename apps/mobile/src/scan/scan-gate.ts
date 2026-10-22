import { classifyBarcode, isMisreadGtin } from '@tugeel/shared/gtin';

/** The same value read twice within this time counts as a scan (ADR-0006 #4). */
const CONFIRM_MS = 1_500;
/** After a scan, the camera rests before it reads again. */
const COOLDOWN_MS = 2_000;

/**
 * Turns the camera's stream of reads into scans: a value counts once it is read twice in a row
 * within CONFIRM_MS and passes the GTIN check (a misread digit fails the check digit), then the
 * camera rests for COOLDOWN_MS.
 */
export class ScanGate {
  private last: { value: string; at: number } | null = null;
  private restUntil = 0;

  /** The scanned code, or null while the read is not confirmed. */
  accept(raw: string, now: number): string | null {
    if (now < this.restUntil) return null;
    const checked = classifyBarcode(raw);
    if (!checked.ok || isMisreadGtin(raw)) return null;
    const value = checked.value.code;
    if (this.last && this.last.value === value && now - this.last.at <= CONFIRM_MS) {
      this.last = null;
      this.restUntil = now + COOLDOWN_MS;
      return value;
    }
    this.last = { value, at: now };
    return null;
  }

  reset(): void {
    this.last = null;
    this.restUntil = 0;
  }
}
