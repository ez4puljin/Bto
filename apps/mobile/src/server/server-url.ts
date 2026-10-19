/** Scheme, host (a name, an IPv4 address or a bracketed IPv6 address) and port; any path is dropped. */
const SERVER =
  /^(?:(https?):\/\/)?([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?|\[[0-9a-f:.]+\])(?::(\d{1,5}))?(?:[/?#].*)?$/i;

/**
 * The API server's origin as the rep typed it, e.g. «192.168.1.10:3300» → «http://192.168.1.10:3300»
 * (ADR-0061 #2): plain HTTP unless the address says https; never a port that was not typed. Null
 * when it is not an address. The generated API paths already start with /api/v1.
 */
export function normalizeServerUrl(input: string): string | null {
  const match = SERVER.exec(input.trim());
  if (!match) return null;
  const [, scheme, host, port] = match;
  if (!host) return null;
  if (port !== undefined) {
    const value = Number.parseInt(port, 10);
    if (value < 1 || value > 65_535) return null;
  }
  return `${(scheme ?? 'http').toLowerCase()}://${host.toLowerCase()}${port ? `:${port}` : ''}`;
}

export interface HealthAnswer {
  status: 'ok' | 'degraded';
  version: string;
}

/** Whether a body is the API's GET /health answer (and not some other web page on that address). */
export function isHealthAnswer(body: unknown): body is HealthAnswer {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body.status === 'ok' || body.status === 'degraded') &&
    'version' in body &&
    typeof body.version === 'string'
  );
}

/** A server the phone connected to: its origin (as `normalizeServerUrl` gives it) and when (ms). */
export interface RecentServer {
  url: string;
  usedAt: number;
}

/** How many servers «Сүүлд ашигласан» keeps. */
export const RECENT_SERVERS_MAX = 5;

/**
 * The address as the server field holds it: without «http://», which connecting adds back, but
 * keeping «https://», so a secure server is never retried over plain http.
 */
export function fieldAddress(url: string): string {
  return url.replace(/^http:\/\//i, '');
}

/** The address as the rep types it: «http://192.168.1.10:3301» → «192.168.1.10:3301». */
export function serverHost(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** The list after a connection to `url`: it moves (or comes) to the top; at most five. */
export function rememberServer(
  list: readonly RecentServer[],
  url: string,
  now: number,
): RecentServer[] {
  return [{ url, usedAt: now }, ...list.filter((item) => item.url !== url)].slice(
    0,
    RECENT_SERVERS_MAX,
  );
}

/** The list without `url`. */
export function forgetServer(list: readonly RecentServer[], url: string): RecentServer[] {
  return list.filter((item) => item.url !== url);
}

/**
 * The stored list, checked: entries that are not a normalised address with a time are dropped,
 * then the newest first, each address once, at most five.
 */
export function recentServersFrom(value: unknown): RecentServer[] {
  if (!Array.isArray(value)) return [];
  const valid: RecentServer[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) continue;
    const { url, usedAt } = item as { url?: unknown; usedAt?: unknown };
    if (typeof url !== 'string' || typeof usedAt !== 'number' || !Number.isFinite(usedAt)) continue;
    if (normalizeServerUrl(url) !== url) continue;
    valid.push({ url, usedAt });
  }
  valid.sort((a, b) => b.usedAt - a.usedAt);
  const seen = new Set<string>();
  return valid
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .slice(0, RECENT_SERVERS_MAX);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * When a server was used, in the phone's own time (Hermes has no reliable time zones): the time
 * on the same day («09:12», shown as «Өнөөдөр 09:12»), otherwise the month and day («10/15»).
 */
export function recentServerWhen(
  usedAt: number,
  now: number,
): { today: true; time: string } | { today: false; date: string } {
  const used = new Date(usedAt);
  const current = new Date(now);
  const sameDay =
    used.getFullYear() === current.getFullYear() &&
    used.getMonth() === current.getMonth() &&
    used.getDate() === current.getDate();
  return sameDay
    ? { today: true, time: `${pad(used.getHours())}:${pad(used.getMinutes())}` }
    : { today: false, date: `${pad(used.getMonth() + 1)}/${pad(used.getDate())}` };
}
