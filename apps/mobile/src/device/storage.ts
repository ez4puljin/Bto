import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import type { StoredSession, TokenStore } from '../api/session';
import { type RecentServer, recentServersFrom } from '../server/server-url';

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

/** Keys of one user on one server: two reps sharing a phone never see each other's cart. */
export const userKey = (name: string, server: string, userId: number) =>
  `bto.${name}.v1:${server}:${userId}`;

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
