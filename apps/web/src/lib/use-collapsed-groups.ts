import { useCallback, useState } from 'react';

/** Sidebar groups the user folded, remembered in this browser (ADR-0042); all open by default. */
const STORAGE_KEY = 'tugeel.nav.collapsed.v1';

function read(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return new Set(
      Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState(read);
  const setOpen = useCallback((group: string, open: boolean) => {
    setCollapsed((previous) => {
      if (open !== previous.has(group)) return previous;
      const next = new Set(previous);
      if (open) next.delete(group);
      else next.add(group);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Storage blocked or full: the choice lasts until the page reloads.
      }
      return next;
    });
  }, []);
  return { collapsed, setOpen };
}
