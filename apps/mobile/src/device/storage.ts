import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from './secure-store';
import type { IdentityStore, StoredSession, TokenStore } from '../api/session';
import { type RecentServer, recentServersFrom } from '../server/server-url';
import { type OutboxStore, outboxStoreOn } from '../outbox/storage';
import { userKey } from './keys';

// What the phone keeps (ADR-0061 #8): the refresh token in secure storage; the server address,
// the recent servers, the chosen stage and the unsent cart in app storage. A read that fails is
// "nothing stored".

export async function readJson(key: string): Promise<unknown> {
  try {
    const text = await AsyncStorage.getItem(key);
    return text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    if (value === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage is a convenience: the next change writes again.
  }
}

export { userKey };

export const SERVER_KEY = 'bto.server.v1';

/** «Сүүлд ашигласан»: the servers that answered GET /health, `{url, usedAt}[]`, newest first. */
export const RECENT_SERVERS_KEY = 'bto.servers.recent.v1';

export async function readRecentServers(): Promise<RecentServer[]> {
  return recentServersFrom(await readJson(RECENT_SERVERS_KEY));
}

export async function writeRecentServers(list: readonly RecentServer[]): Promise<void> {
  await writeJson(RECENT_SERVERS_KEY, list.length > 0 ? list : null);
}

const SESSION_KEY = 'bto.session.v1';

function isStoredSession(value: unknown): value is StoredSession {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as StoredSession).server === 'string' &&
    typeof (value as StoredSession).userId === 'number' &&
    typeof (value as StoredSession).refreshToken === 'string'
  );
}

export const secureTokenStore: TokenStore = {
  async load() {
    try {
      const text = await SecureStore.getItemAsync(SESSION_KEY);
      if (!text) return null;
      const value = JSON.parse(text) as unknown;
      return isStoredSession(value) ? value : null;
    } catch {
      return null;
    }
  },
  async save(value) {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(value));
  },
  async clear() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

/**
 * Who signed in, as `GET /auth/me` last answered (`bto.identity.v1:<server>:<userId>`): the staff
 * app opens from it when the server does not answer (owner 2026-11-19). The user and the rights,
 * no token; cleared when the session ends.
 */
export const identityStore: IdentityStore = {
  load: (server, userId) => readJson(userKey('identity', server, userId)),
  save: (server, userId, me) => writeJson(userKey('identity', server, userId), me),
  clear: (server, userId) => writeJson(userKey('identity', server, userId), null),
};

/**
 * Writes a value and rejects when the storage fails (unlike `writeJson`): for what must be on the
 * phone before the next step (the cart before an outbox entry is removed).
 */
export async function setJson(key: string, value: unknown): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/** The rep's outbox on the phone, one key per entry (`src/outbox/storage.ts`). */
export function outboxStore(server: string, userId: number): OutboxStore {
  return outboxStoreOn(AsyncStorage, server, userId);
}
