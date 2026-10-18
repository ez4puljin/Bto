import { useCallback, useState } from 'react';

/**
 * Sidebar groups this user folded, remembered in this browser per user (ADR-0042, ADR-0066:
 * `tugeel.nav.collapsed.v2:<userId>`, read from the old shared key until the user folds anew);
 * all open by default.
 */
const LEGACY_KEY = 'tugeel.nav.collapsed.v1';

function keyOf(userId: number | null): string {
  return `tugeel.nav.collapsed.v2:${userId ?? 0}`;
}

function read(userId: number | null): Set<string> {
  try {
    const text = localStorage.getItem(keyOf(userId)) ?? localStorage.getItem(LEGACY_KEY) ?? '[]';
    const parsed: unknown = JSON.parse(text);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export function useCollapsedGroups(userId: number | null) {
  const [state, setState] = useState(() => ({ userId, collapsed: read(userId) }));
  // Another user signed in on this browser: their own folds.
  const current = state.userId === userId ? state.collapsed : read(userId);
  if (state.userId !== userId) setState({ userId, collapsed: current });
  const setOpen = useCallback((group: string, open: boolean) => {
    setState((previous) => {
      if (open !== previous.collapsed.has(group)) return previous;
      const next = new Set(previous.collapsed);
      if (open) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(keyOf(previous.userId), JSON.stringify([...next]));
      } catch {
        // Storage blocked or full: the choice lasts until the page reloads.
      }
      return { userId: previous.userId, collapsed: next };
    });
  }, []);
  return { collapsed: current, setOpen };
}
