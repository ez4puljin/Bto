/**
 * The menu pages this browser opened last, newest first (ADR-0042). Only menu paths are kept —
 * never record names or other business data (ADR-0037 #3) — and every read and write survives a
 * blocked or full storage.
 */
const STORAGE_KEY = 'tugeel.recent.v1';
export const MAX_RECENT = 5;

export function readRecentPages(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
      .slice(0, MAX_RECENT);
  } catch {
    return [];
  }
}

export function rememberRecentPage(path: string) {
  try {
    const next = [path, ...readRecentPages().filter((known) => known !== path)].slice(
      0,
      MAX_RECENT,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage blocked or full: nothing is remembered.
  }
}
