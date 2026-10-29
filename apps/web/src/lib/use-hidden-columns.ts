import { useMemo, useState } from 'react';
import { useAuthState } from '@/app/auth-context';
import { useMediaQuery, WIDE_SCREEN } from '@/lib/use-media-query';

/**
 * The columns the signed-in user hid on a list, remembered in this browser (ADR-0050) under
 * `tugeel.<list>.hiddenColumns.v1:<userId>`. A user without a key yet starts from the list's old
 * shared key (ADR-0037), which is never written again. Only hidden keys are stored, so columns
 * added later show up by default; showing every column stores an empty list, so the old shared
 * choice cannot come back. Storage can be missing or refuse writes (private windows, blocked site
 * data): the choice then lasts until the page is closed. `defaultHidden` (ADR-0066) is what a
 * user who never chose sees hidden, so a wide list fits a 1366px screen; on a screen of 1600px or
 * more that user sees `wideDefaultHidden` hidden instead when the list gives one (ADR-0119); every
 * column stays in the chooser.
 */
export function useHiddenColumns(
  list: string,
  keys: readonly string[],
  locked: readonly string[],
  defaultHidden: readonly string[] = NONE,
  wideDefaultHidden?: readonly string[],
) {
  const auth = useAuthState();
  const wide = useMediaQuery(WIDE_SCREEN);
  const fallback = wide && wideDefaultHidden ? wideDefaultHidden : defaultHidden;
  const userId = auth.status === 'authenticated' ? auth.me.id : 0;
  const shared = `tugeel.${list}.hiddenColumns.v1`;
  const own = `${shared}:${userId}`;
  const stored = useMemo(
    () =>
      readHidden(own, shared, keys, locked) ??
      new Set(fallback.filter((key) => keys.includes(key) && !locked.includes(key))),
    [own, shared, keys, locked, fallback],
  );
  // The choice made on this page; signing in as someone else reads that user's own.
  const [chosen, setChosen] = useState<{ key: string; hidden: ReadonlySet<string> } | null>(null);
  const hidden = chosen?.key === own ? chosen.hidden : stored;
  const save = (next: ReadonlySet<string>) => {
    setChosen({ key: own, hidden: next });
    writeHidden(own, next);
  };
  const toggle = (key: string) => {
    if (locked.includes(key) || !keys.includes(key)) return;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    save(next);
  };
  const showAll = () => save(new Set());
  return { hidden, toggle, showAll };
}

const NONE: readonly string[] = [];

/** The stored choice, or null when this user never chose (the list's default then applies). */
function readHidden(
  own: string,
  shared: string,
  keys: readonly string[],
  locked: readonly string[],
): ReadonlySet<string> | null {
  try {
    const text = window.localStorage.getItem(own) ?? window.localStorage.getItem(shared);
    if (text === null) return null;
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value.filter(
        (key): key is string =>
          typeof key === 'string' && keys.includes(key) && !locked.includes(key),
      ),
    );
  } catch {
    // Storage blocked or not JSON: every column shows.
    return new Set();
  }
}

function writeHidden(own: string, hidden: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(own, JSON.stringify([...hidden]));
  } catch {
    // Storage blocked or full: the choice lasts until the page is closed.
  }
}
