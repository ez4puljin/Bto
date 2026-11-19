// A PC printer's job (`GET /print-jobs/{id}`): asked every second until it is done or failed.

export type JobStatus = 'queued' | 'printing' | 'done' | 'failed';

export interface JobState {
  status: JobStatus;
  /** A failed job's error code (`errors.<code>`). */
  error: string | null;
  /** What the printer side said. */
  detail?: string | null;
}

export type JobOutcome =
  | { ok: true }
  | { ok: false; reason: 'failed' | 'timeout'; error: string | null; detail: string | null };

export const POLL_MS = 1_000;
export const POLL_MAX_MS = 120_000;

/**
 * Asks `read` until the job is done or failed, or `maxMs` pass. `sleep` and `now` are the clock,
 * so a test runs it without waiting. A read that throws (a dropped connection) is asked again.
 */
export async function waitForJob(
  read: () => Promise<JobState>,
  clock: { sleep: (ms: number) => Promise<void>; now: () => number },
  options: { everyMs?: number; maxMs?: number } = {},
): Promise<JobOutcome> {
  const every = options.everyMs ?? POLL_MS;
  const max = options.maxMs ?? POLL_MAX_MS;
  const started = clock.now();
  for (;;) {
    try {
      const job = await read();
      if (job.status === 'done') return { ok: true };
      if (job.status === 'failed')
        return { ok: false, reason: 'failed', error: job.error, detail: job.detail ?? null };
    } catch {
      // Asked again below, until the time is out.
    }
    if (clock.now() - started >= max)
      return { ok: false, reason: 'timeout', error: null, detail: null };
    await clock.sleep(every);
  }
}
