import { userKey } from '../device/keys';
import type { OutboxEntry } from './entry';

/** The calls of AsyncStorage the outbox uses; every one rejects when the storage fails. */
export interface KeyValueStore {
  getAllKeys(): Promise<readonly string[]>;
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  multiSet(pairs: [string, string][]): Promise<void>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

/** One stored entry as text, before it is read. */
export interface RawEntry {
  id: string;
  raw: string;
}

/**
 * The outbox on the phone: one key per entry (`bto.outbox.v1:<server>:<userId>:<entryId>`), so one
 * entry's write or damage never takes the others with it and no stored value grows with the
 * number of orders. Every call rejects when the storage fails: «nothing stored» (an empty list)
 * and «could not read» (a rejection) are never the same thing.
 */
export interface OutboxStore {
  /** Every stored entry as text. */
  readAll(): Promise<RawEntry[]>;
  /** Writes the entries, and `also` (another key, the emptied cart), in one `multiSet`. */
  put(entries: readonly OutboxEntry[], also?: [string, string][]): Promise<void>;
  drop(ids: readonly string[]): Promise<void>;
}

/** The single-list key written before the per-entry keys (never released; dev data may hold it). */
export const outboxListKey = (server: string, userId: number) => userKey('outbox', server, userId);

export const outboxEntryKey = (server: string, userId: number, id: string) =>
  `${outboxListKey(server, userId)}:${id}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function outboxStoreOn(kv: KeyValueStore, server: string, userId: number): OutboxStore {
  const listKey = outboxListKey(server, userId);
  const prefix = `${listKey}:`;
  const keyOf = (id: string) => `${prefix}${id}`;

  /**
   * An old single list split into entry keys once: each item is written under its own key, then
   * the list is removed. A list that cannot be read stays where it is, shown as one damaged entry.
   */
  async function split(text: string, have: ReadonlySet<string>): Promise<RawEntry[]> {
    let list: unknown;
    try {
      list = JSON.parse(text) as unknown;
    } catch {
      return [{ id: 'legacy', raw: text }];
    }
    if (!Array.isArray(list)) return [{ id: 'legacy', raw: text }];
    const items = list.map((item: unknown, at): RawEntry => {
      const id = isRecord(item) && typeof item.id === 'string' ? item.id : `legacy-${at}`;
      return { id, raw: JSON.stringify(item) };
    });
    const fresh = items.filter((item) => !have.has(item.id));
    if (fresh.length > 0) await kv.multiSet(fresh.map((item) => [keyOf(item.id), item.raw]));
    await kv.multiRemove([listKey]);
    return fresh;
  }

  return {
    async readAll() {
      const keys = await kv.getAllKeys();
      const entryKeys = keys.filter((key) => key.startsWith(prefix));
      const legacy = keys.includes(listKey);
      const values = await kv.multiGet(legacy ? [...entryKeys, listKey] : entryKeys);
      const entries: RawEntry[] = [];
      let legacyText: string | null = null;
      for (const [key, value] of values) {
        if (value === null) continue;
        if (key === listKey) legacyText = value;
        else entries.push({ id: key.slice(prefix.length), raw: value });
      }
      if (legacyText === null) return entries;
      return [...entries, ...(await split(legacyText, new Set(entries.map((one) => one.id))))];
    },
    async put(entries, also = []) {
      const pairs: [string, string][] = entries.map((entry) => [
        keyOf(entry.id),
        JSON.stringify(entry),
      ]);
      await kv.multiSet([...pairs, ...also]);
    },
    async drop(ids) {
      if (ids.length > 0) await kv.multiRemove(ids.map(keyOf));
    },
  };
}
