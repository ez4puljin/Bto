import { MAX_SELECTED_PRODUCTS } from '@tugeel/shared/catalog';
import { useEffect, useMemo, useState } from 'react';
import { useAuthState } from '@/app/auth-context';

const STORAGE_KEY = 'tugeel.catalog.products.selection.v1';
const NO_TICKS: ReadonlySet<number> = new Set();

/** The ticked products of the list and how to change them (ADR-0052). */
export interface ProductTicks {
  selected: ReadonlySet<number>;
  /** Ticks or unticks these products; ticks that would pass MAX_SELECTED_PRODUCTS change nothing. */
  set: (ids: readonly number[], on: boolean) => void;
  clear: () => void;
}

/**
 * The product list's ticks (ADR-0052). They stay while the search and the filters change, so the
 * ticks of several searches go together, and live in this tab's `sessionStorage` per user
 * (`tugeel.catalog.products.selection.v1:<userId>`): a product opened by mistake and «back», or a
 * reload, keeps them; another user signing in to the tab starts with none; closing the tab ends
 * them. Screen state, never business data. Storage can be missing or refuse writes (private
 * windows, blocked site data): the ticks then last while the page is open.
 */
export function useProductSelection(): ProductTicks {
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : 0;
  const own = `${STORAGE_KEY}:${userId}`;
  const stored = useMemo(() => readTicks(own), [own]);
  // The ticks changed on this page; another user signed in reads their own.
  const [chosen, setChosen] = useState<{ key: string; ids: ReadonlySet<number> } | null>(null);
  const selected = chosen?.key === own ? chosen.ids : stored;
  useEffect(() => {
    if (chosen?.key === own) writeTicks(own, chosen.ids);
  }, [chosen, own]);
  return useMemo(
    () => ({
      selected,
      set: (ids, on) =>
        setChosen((previous) => {
          const next = new Set(previous?.key === own ? previous.ids : stored);
          for (const id of ids) {
            if (on) next.add(id);
            else next.delete(id);
          }
          return next.size > MAX_SELECTED_PRODUCTS ? previous : { key: own, ids: next };
        }),
      clear: () => setChosen({ key: own, ids: NO_TICKS }),
    }),
    [selected, own, stored],
  );
}

function readTicks(key: string): ReadonlySet<number> {
  try {
    const text = window.sessionStorage.getItem(key);
    if (text === null) return NO_TICKS;
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return NO_TICKS;
    const ids = value.filter(
      (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    );
    return new Set(ids.slice(0, MAX_SELECTED_PRODUCTS));
  } catch {
    // Storage blocked or not JSON: nothing is ticked.
    return NO_TICKS;
  }
}

function writeTicks(key: string, ids: ReadonlySet<number>): void {
  try {
    if (ids.size === 0) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage blocked or full: the ticks last while the page is open.
  }
}
