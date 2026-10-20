import { randomBytes } from 'node:crypto';

/**
 * A uuid v7 (RFC 9562): the intake command's transmission id (ADR-0071 #10), time-ordered so the
 * attempt log reads in order. 48 bits of Unix milliseconds, the version, then random bits.
 */
export function newCommandId(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  let ms = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number.parseInt((ms & 0xffn).toString(), 10);
    ms >>= 8n;
  }
  bytes[6] = 0x70 | ((bytes[6] ?? 0) & 0x0f);
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f);
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
