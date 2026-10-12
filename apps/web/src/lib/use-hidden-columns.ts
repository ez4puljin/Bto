import { useState } from 'react';

/**
 * The columns a user hid on a list, remembered in this browser (ADR-0037). Only hidden keys are
 * stored, so columns added later show up by default. Storage can be missing or refuse writes
 * (private windows, blocked site data): the choice then lasts until the page is closed.
 */
export function useHiddenColumns(
  storageKey: string,
  keys: readonly string[],
  locked: readonly string[],
) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() =>
    readHidden(storageKey, keys, locked),
  );
  const save = (next: ReadonlySet<string>) => {
    setHidden(next);
    writeHidden(storageKey, next);
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

function readHidden(
  storageKey: string,
  keys: readonly string[],
  locked: readonly string[],
): ReadonlySet<string> {
  try {
    const text = window.localStorage.getItem(storageKey);
    if (text === null) return new Set();
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

function writeHidden(storageKey: string, hidden: ReadonlySet<string>): void {
  try {
    if (hidden.size === 0) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify([...hidden]));
  } catch {
    // Storage blocked or full: the choice lasts until the page is closed.
  }
}
