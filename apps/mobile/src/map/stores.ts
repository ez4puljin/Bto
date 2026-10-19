import type { components } from '@tugeel/api-client';

// The store map's pure parts (the owner, 2026-10-18): which stores become pins, in which colour and
// with which name, where the map opens, and the «last ordered» line of a store's card. The map
// itself is the DOM component in store-map.tsx; the screen is app/(staff)/map.tsx.

export type MapStore = components['schemas']['SalesRepMapStore'];

/**
 * A store's colour on the map: black when the accountant closed its orders (the customer's credit
 * hold, partners' «Зээл хаалттай»), else red without an order of the rep in the fresh window, else
 * green. One state per store, the hold first, so the legend's three counts add up to the stores.
 */
export type StoreState = 'blocked' | 'stale' | 'fresh';

export function stateOf(store: Pick<MapStore, 'creditHold' | 'stale'>): StoreState {
  if (store.creditHold) return 'blocked';
  return store.stale ? 'stale' : 'fresh';
}

/** A store's pin as the DOM map takes it (JSON only): its colour and the name drawn above it. */
export interface MapPin {
  id: number;
  lat: number;
  lng: number;
  state: StoreState;
  label: string;
}

/** The most characters of a store's name above its pin (about two lines of small text). */
export const LABEL_MAX = 28;

/** A store's name for its pin: one line of spaces, cut with «…» past LABEL_MAX characters. */
export function labelOf(name: string): string {
  const flat = name.trim().replace(/\s+/g, ' ');
  const chars = Array.from(flat);
  return chars.length > LABEL_MAX
    ? `${chars
        .slice(0, LABEL_MAX - 1)
        .join('')
        .trimEnd()}…`
    : flat;
}

export interface MapPoint {
  lat: number;
  lng: number;
}

/** `[[west, south], [east, north]]`, MapLibre's LngLatBounds as JSON. */
export type MapBounds = [[number, number], [number, number]];

/** Where the map opens when there is no pin: the whole of Mongolia. */
export const MONGOLIA = { center: [103.85, 46.86] as [number, number], zoom: 4.2 };

/** How close a single pin is shown, and the most the first view zooms in to fit the pins. */
export const STORE_ZOOM = 15;
export const FIT_MAX_ZOOM = 14;
/** The last zoom that still groups pins into clusters; above it every pin is drawn. */
export const CLUSTER_MAX_ZOOM = 14;
/** How close the map opens on the rep's position: street level, past the clusters, names shown. */
export const ME_ZOOM = 15;
/** How long the map waits for the rep's position before it opens on the pins instead. */
export const ME_WAIT_MS = 3_500;

/** Degrees from the server's 6-decimal string, or null when it is not a usable coordinate. */
export function degreesOf(value: string, limit: number): number | null {
  if (!/^-?\d{1,3}(\.\d+)?$/.test(value.trim())) return null;
  const degrees = Number.parseFloat(value);
  return Number.isFinite(degrees) && Math.abs(degrees) <= limit ? degrees : null;
}

/**
 * The pins of the stores (only the red ones when asked: a blocked store takes no order, so it is
 * not one to visit); a store with a broken point is left out.
 */
export function pinsOf(stores: readonly MapStore[], onlyStale: boolean): MapPin[] {
  const pins: MapPin[] = [];
  for (const store of stores) {
    const state = stateOf(store);
    if (onlyStale && state !== 'stale') continue;
    const lat = degreesOf(store.lat, 90);
    const lng = degreesOf(store.lng, 180);
    if (lat === null || lng === null || (lat === 0 && lng === 0)) continue;
    pins.push({ id: store.customerId, lat, lng, state, label: labelOf(store.name) });
  }
  return pins;
}

/**
 * The legend's counts, one state per store (stateOf): blocked stores are neither stale nor fresh,
 * so the three add up to the stores and «stale» is what the rep can still go and order.
 */
export function countsOf(stores: readonly MapStore[]): Record<StoreState, number> {
  const counts = { blocked: 0, stale: 0, fresh: 0 };
  for (const store of stores) counts[stateOf(store)] += 1;
  return counts;
}

/**
 * Every store is green: an order of the rep in the fresh window and not closed. Only then may the
 * home's map card say «all stores ordered»; else it tells the stale and the closed ones apart.
 */
export function allOrdered(counts: Record<StoreState, number>): boolean {
  return counts.stale === 0 && counts.blocked === 0;
}

/**
 * The map's opening, in steps: waiting for its first view, opened on the pins (the rep's position
 * may still come), opened on the phone's last known position (the live one may still move it),
 * done.
 */
export type CameraPhase = 'waiting' | 'pins' | 'provisional' | 'settled';

export type CameraMove =
  | { kind: 'me'; center: [number, number] }
  | { kind: 'point'; center: [number, number] }
  | { kind: 'fit'; bounds: MapBounds };

/**
 * Where the map opens (the owner, 2026-10-18: «гар утасны байршил дээр эхлэдэг байх»): on the
 * rep's position as soon as it is known; while it is still expected (`expectMe`: asked for and not
 * waited out) the map stays on Mongolia; else on the pins as before (one point up close, several
 * fitted). A position that comes after the pins moves the map there once, unless the rep has moved
 * the map (`touched`); after that the map never moves by itself again. The phone's last known
 * position (`meLive` false: minutes old, the rep may have driven on since) opens the map only
 * provisionally: the first live fix moves it there once more, unless the rep has moved the map.
 */
export function cameraStep(
  phase: CameraPhase,
  input: {
    me: MapPoint | null;
    /** `me` is a live fix of the phone, not its last known position. */
    meLive: boolean;
    pins: readonly MapPoint[] | null;
    expectMe: boolean;
    touched: boolean;
  },
): { phase: CameraPhase; move: CameraMove | null } {
  if (phase === 'settled' || input.touched) return { phase: 'settled', move: null };
  if (input.me && (input.meLive || phase !== 'provisional'))
    return {
      phase: input.meLive ? 'settled' : 'provisional',
      move: { kind: 'me', center: [input.me.lng, input.me.lat] },
    };
  if (phase === 'provisional') return { phase, move: null };
  if (phase === 'pins' || input.expectMe || input.pins === null) return { phase, move: null };
  const bounds = boundsOf(input.pins);
  if (!bounds) return { phase: 'pins', move: null };
  const [[west, south], [east, north]] = bounds;
  return {
    phase: 'pins',
    move:
      west === east && south === north
        ? { kind: 'point', center: [west, south] }
        : { kind: 'fit', bounds },
  };
}

/** The box around the pins, or null without any. */
export function boundsOf(pins: readonly MapPoint[]): MapBounds | null {
  const [first, ...rest] = pins;
  if (!first) return null;
  let west = first.lng;
  let east = first.lng;
  let south = first.lat;
  let north = first.lat;
  for (const pin of rest) {
    west = Math.min(west, pin.lng);
    east = Math.max(east, pin.lng);
    south = Math.min(south, pin.lat);
    north = Math.max(north, pin.lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

/** The middle of the pins' box as `[lng, lat]`, or null without any. */
export function centreOf(pins: readonly MapPoint[]): [number, number] | null {
  const bounds = boundsOf(pins);
  if (!bounds) return null;
  const [[west, south], [east, north]] = bounds;
  return [(west + east) / 2, (south + north) / 2];
}

/** What a tap on the map hit: one store's pin, several stores' pins, or a cluster. */
export type MapTap =
  | { kind: 'pin'; id: number }
  | { kind: 'pins'; ids: number[] }
  | { kind: 'cluster'; clusterId: number };

/** The store ids among features' properties (pins carry `id`, clusters `cluster_id`), each once. */
export function storeIdsOf(hits: readonly Record<string, unknown>[]): number[] {
  const ids: number[] = [];
  for (const props of hits) {
    if (typeof props.cluster_id === 'number' || typeof props.id !== 'number') continue;
    if (!ids.includes(props.id)) ids.push(props.id);
  }
  return ids;
}

/**
 * The tap from the properties of the rendered features under it, top-most first: the pins win over
 * a cluster, and two or more stores (pins at one point, which a feature can repeat across tiles)
 * are «several», for the screen to ask which.
 */
export function tapOf(hits: readonly Record<string, unknown>[]): MapTap | null {
  const ids = storeIdsOf(hits);
  const [first] = ids;
  if (ids.length > 1) return { kind: 'pins', ids };
  if (first !== undefined) return { kind: 'pin', id: first };
  for (const props of hits) {
    if (typeof props.cluster_id === 'number')
      return { kind: 'cluster', clusterId: props.cluster_id };
  }
  return null;
}

/** The stores of `ids`, in the list's own order (the server's, by name). */
export function storesWithIds(stores: readonly MapStore[], ids: readonly number[]): MapStore[] {
  const wanted = new Set(ids);
  return stores.filter((store) => wanted.has(store.customerId));
}

/**
 * The address an order started from the map delivers to: the map point's own while it is still
 * one of the customer's active addresses, else the default one (else the first); null without any.
 */
export function startAddressOf(
  addresses: readonly { id: number; isDefault: boolean }[],
  pointAddressId: number | null,
): number | null {
  const chosen =
    addresses.find((address) => address.id === pointAddressId) ??
    addresses.find((address) => address.isDefault) ??
    addresses[0];
  return chosen?.id ?? null;
}

/** Whole days from one `YYYY-MM-DD` to another (negative when `to` is earlier), no time zones. */
export function daysBetween(from: string, to: string): number {
  const utc = (date: string) => {
    const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/**
 * A store's last order for its card: «10/14» and how many days before `today` (0 today, 1
 * yesterday); null when the rep has no order there.
 */
export function lastOrderOf(
  store: Pick<MapStore, 'lastOrderDate'>,
  today: string,
): { date: string; days: number } | null {
  const date = store.lastOrderDate;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    date: `${date.slice(5, 7)}/${date.slice(8, 10)}`,
    days: Math.max(0, daysBetween(date, today)),
  };
}
