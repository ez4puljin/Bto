/**
 * A send in flight (ADR-0061 #8): its Idempotency-Key and the body it was made for, kept with the
 * cart before the request leaves, so a send repeated after a lost answer replays the server's
 * stored order instead of creating a second one.
 */
export interface PendingSend {
  key: string;
  /** The body as canonical JSON. */
  body: string;
  /** When it was first sent (ISO). */
  startedAt: string;
}

/** The server forgets keys after 7 days; past 6 a pending send is not reused on its own. */
const KEY_DAYS = 6;

/** JSON with every object's keys sorted: two equal bodies give one string. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The pending send for this body: the same key for the same body, a new one otherwise. */
export function pendingFor(
  previous: PendingSend | null,
  body: unknown,
  newKey: () => string,
  now: Date,
): PendingSend {
  const text = canonical(body);
  if (
    previous &&
    previous.body === text &&
    now.getTime() - Date.parse(previous.startedAt) < KEY_DAYS * 24 * 3600 * 1000
  ) {
    return previous;
  }
  return { key: newKey(), body: text, startedAt: now.toISOString() };
}

/**
 * What a send's answer means for the pending send: `sent` (201, a replay included) clears it;
 * `wait` (the first send still running on the server) retries the same key; `unknown` (no answer,
 * or the server failed) keeps it for a retry with the same key; `refused` (the server said no and
 * released the key) drops it, so the rep fixes the cart and sends a new body.
 */
export type SendOutcome = 'sent' | 'wait' | 'unknown' | 'refused';

export function outcomeOf(status: number, code: string | null): SendOutcome {
  if (status === 201 || status === 200) return 'sent';
  if (status === 0 || status >= 500) return 'unknown';
  if (status === 409 && code === 'IDEMPOTENCY_KEY_IN_PROGRESS') return 'wait';
  return 'refused';
}
