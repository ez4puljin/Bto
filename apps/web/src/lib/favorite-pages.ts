import { useCallback, useSyncExternalStore } from 'react';

/**
 * The menu pages a user starred (☆, ADR-0114), in the order starred, kept per user in this browser
 * like the recent pages (`tugeel.favorites.v1:<userId>`, ADR-0053). Only menu paths are kept —
 * never record names or other business data (ADR-0037 #3) — and every read and write survives a
 * blocked or full storage. Other tabs follow through the `storage` event.
 */
const STORAGE_KEY = 'tugeel.favorites.v1';
export const MAX_FAVORITES = 12;
const CHANGED = 'tugeel:favorites';

const keyOf = (userId: number) => `${STORAGE_KEY}:${userId}`;

export function readFavoritePages(userId: number): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(keyOf(userId)) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((path): path is string => typeof path === 'string' && path.startsWith('/'))
      .slice(0, MAX_FAVORITES);
  } catch {
    return [];
  }
}

/** Stars a page (at the end, dropping the oldest past the limit) or unstars it. */
export function setFavoritePage(userId: number, path: string, favorite: boolean) {
  const known = readFavoritePages(userId).filter((item) => item !== path);
  const next = favorite ? [...known, path].slice(-MAX_FAVORITES) : known;
  try {
    localStorage.setItem(keyOf(userId), JSON.stringify(next));
  } catch {
    // Storage blocked or full: nothing is remembered.
  }
  window.dispatchEvent(new Event(CHANGED));
}

function subscribe(onChange: () => void) {
  window.addEventListener(CHANGED, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(CHANGED, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** This user's starred paths, kept current; `toggle` stars or unstars one. */
export function useFavoritePages(userId: number | null) {
  // The snapshot is the stored text, so React compares strings, not fresh arrays.
  const raw = useSyncExternalStore(subscribe, () =>
    userId === null ? '[]' : JSON.stringify(readFavoritePages(userId)),
  );
  const paths = JSON.parse(raw) as string[];
  const toggle = useCallback(
    (path: string) => {
      if (userId === null) return;
      setFavoritePage(userId, path, !readFavoritePages(userId).includes(path));
    },
    [userId],
  );
  return { paths, toggle };
}
