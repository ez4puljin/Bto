/**
 * The menu pages a user opened last in this browser, newest first (ADR-0042), kept per user like
 * the column choices (`tugeel.recent.v1:<userId>`, ADR-0053): a colleague signing in on the same
 * computer starts with their own. Only menu paths are kept — never record names or other business
 * data (ADR-0037 #3) — and every read and write survives a blocked or full storage.
 */
const STORAGE_KEY = 'tugeel.recent.v1';
export const MAX_RECENT = 5;

const keyOf = (userId: number) => `${STORAGE_KEY}:${userId}`;

export function readRecentPages(userId: number): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecentPage(userId: number, path: string) {
  try {
    const next = [path, ...readRecentPages(userId).filter((known) => known !== path)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(keyOf(userId), JSON.stringify(next));
  } catch {
    // Storage blocked or full: nothing is remembered.
  }
}
