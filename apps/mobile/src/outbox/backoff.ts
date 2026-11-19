/** The first try again after no answer: half a minute (owner's brief, 2026-11-19). */
export const RETRY_FIRST_MS = 30_000;
/** Never longer than two minutes between tries. */
export const RETRY_MAX_MS = 120_000;

/**
 * How long to wait before the `attempt`-th try again (0 = the first) while the server does not
 * answer: 30 s, 60 s, then 2 min each. The session (opening without the server) and the outbox
 * (orders waiting) share it.
 */
export function retryDelay(attempt: number): number {
  const step = Math.max(0, Math.floor(attempt));
  return Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(step, 8));
}
