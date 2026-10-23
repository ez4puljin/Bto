import { describe, expect, it } from 'vitest';
import {
  allOrdered,
  boundsOf,
  cameraStep,
  centreOf,
  countsOf,
  daysBetween,
  degreesOf,
  LABEL_MAX,
  labelOf,
  lastOrderOf,
  type MapStore,
  pinsOf,
  startAddressOf,
  stateOf,
  storeIdsOf,
  storesWithIds,
  tapOf,
} from './stores';

const store = (over: Partial<MapStore>): MapStore => ({
  customerId: 1,
  code: '1001',
  name: 'Дэлгүүр',
  phone: null,
  creditHold: false,
  creditHoldReason: null,
  overdue: null,
  addressId: 1,
  address: null,
  lat: '49.639810',
  lng: '100.162540',
  lastOrderId: null,
  lastOrderAt: null,
  lastOrderDate: null,
  stale: true,
  ...over,
});

describe('degreesOf', () => {
  it('reads the server strings', () => {
    expect(degreesOf('49.639810', 90)).toBe(49.63981);
    expect(degreesOf('-12.5', 90)).toBe(-12.5);
    expect(degreesOf('100.162540', 180)).toBe(100.16254);
  });

  it('refuses what is not a coordinate', () => {
    expect(degreesOf('', 90)).toBeNull();
    expect(degreesOf('abc', 90)).toBeNull();
    expect(degreesOf('91.000000', 90)).toBeNull();
    expect(degreesOf('1e3', 180)).toBeNull();
  });
});

describe('stateOf', () => {
  it('is blocked on a credit hold whatever the orders, else stale or fresh', () => {
    expect(stateOf({ creditHold: true, stale: true })).toBe('blocked');
    expect(stateOf({ creditHold: true, stale: false })).toBe('blocked');
    expect(stateOf({ creditHold: false, stale: true })).toBe('stale');
    expect(stateOf({ creditHold: false, stale: false })).toBe('fresh');
  });
});

describe('labelOf', () => {
  it('keeps a short name, on one line of spaces', () => {
    expect(labelOf('  Номин   дэлгүүр ')).toBe('Номин дэлгүүр');
    expect(labelOf('Оргил\nхүнс')).toBe('Оргил хүнс');
  });

  it(`cuts a long name to ${LABEL_MAX} characters with «…»`, () => {
    const long = 'Бүтэн-Оргил бөөний төвийн хүнсний дэлгүүр';
    const label = labelOf(long);
    expect(Array.from(label)).toHaveLength(LABEL_MAX);
    expect(label.endsWith('…')).toBe(true);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
    expect(labelOf('а'.repeat(LABEL_MAX))).toBe('а'.repeat(LABEL_MAX));
  });
});

describe('pinsOf', () => {
  const stores = [
    store({ customerId: 1, stale: true, name: 'Номин' }),
    store({ customerId: 2, stale: false, lat: '47.200000', lng: '102.800000', name: 'Оргил' }),
    store({ customerId: 3, lat: 'x' }),
    store({ customerId: 4, lat: '0.000000', lng: '0.000000' }),
    store({ customerId: 5, stale: true, creditHold: true, name: 'Хаалттай' }),
  ];

  it('keeps the stores with a usable point, with their state and name', () => {
    expect(pinsOf(stores, false)).toEqual([
      { id: 1, lat: 49.63981, lng: 100.16254, state: 'stale', label: 'Номин' },
      { id: 2, lat: 47.2, lng: 102.8, state: 'fresh', label: 'Оргил' },
      { id: 5, lat: 49.63981, lng: 100.16254, state: 'blocked', label: 'Хаалттай' },
    ]);
  });

  it('keeps only the stale ones when asked, not the blocked', () => {
    expect(pinsOf(stores, true).map((pin) => pin.id)).toEqual([1]);
  });
});

describe('countsOf', () => {
  it('counts each store once: blocked, else stale or fresh', () => {
    expect(
      countsOf([
        store({ stale: true }),
        store({ stale: false }),
        store({}),
        store({ creditHold: true, stale: true }),
        store({ creditHold: true, stale: false }),
      ]),
    ).toEqual({ blocked: 2, stale: 2, fresh: 1 });
    expect(countsOf([])).toEqual({ blocked: 0, stale: 0, fresh: 0 });
  });
});

describe('allOrdered', () => {
  it('is true only when every store is fresh, never with a blocked one', () => {
    expect(allOrdered(countsOf([store({ stale: false }), store({ stale: false })]))).toBe(true);
    // Fresh and blocked stores only: the stale count is 0, yet not every store ordered.
    const freshOrBlocked = countsOf([
      store({ stale: false }),
      store({ creditHold: true, stale: true }),
    ]);
    expect(freshOrBlocked).toEqual({ blocked: 1, stale: 0, fresh: 1 });
    expect(allOrdered(freshOrBlocked)).toBe(false);
    expect(allOrdered(countsOf([store({ creditHold: true, stale: false })]))).toBe(false);
    expect(allOrdered(countsOf([store({ stale: true })]))).toBe(false);
  });
});

describe('cameraStep', () => {
  const me = { lat: 49.64, lng: 100.16 };
  const two = [
    { lat: 48, lng: 100 },
    { lat: 50, lng: 102 },
  ];
  const idle = { me: null, meLive: true, pins: two, expectMe: false, touched: false };

  it('opens on the position as soon as it is known, pins or not', () => {
    for (const pins of [null, two]) {
      expect(cameraStep('waiting', { ...idle, me, pins, expectMe: true })).toEqual({
        phase: 'settled',
        move: { kind: 'me', center: [100.16, 49.64] },
      });
    }
  });

  it('waits while the position is expected or the stores still load', () => {
    expect(cameraStep('waiting', { ...idle, expectMe: true })).toEqual({
      phase: 'waiting',
      move: null,
    });
    expect(cameraStep('waiting', { ...idle, pins: null })).toEqual({
      phase: 'waiting',
      move: null,
    });
  });

  it('opens on the pins without the position: fitted, one up close, none stays', () => {
    expect(cameraStep('waiting', idle)).toEqual({
      phase: 'pins',
      move: {
        kind: 'fit',
        bounds: [
          [100, 48],
          [102, 50],
        ],
      },
    });
    expect(cameraStep('waiting', { ...idle, pins: [{ lat: 49.5, lng: 100.2 }] })).toEqual({
      phase: 'pins',
      move: { kind: 'point', center: [100.2, 49.5] },
    });
    expect(cameraStep('waiting', { ...idle, pins: [] })).toEqual({ phase: 'pins', move: null });
  });

  it('moves to a late position once, and never fits the pins again', () => {
    expect(cameraStep('pins', idle)).toEqual({ phase: 'pins', move: null });
    expect(cameraStep('pins', { ...idle, me })).toEqual({
      phase: 'settled',
      move: { kind: 'me', center: [100.16, 49.64] },
    });
    expect(cameraStep('settled', { ...idle, me })).toEqual({ phase: 'settled', move: null });
  });

  it('opens on the last known position provisionally, and the first live fix moves it once', () => {
    const lastKnown = { ...idle, me, meLive: false };
    for (const before of ['waiting', 'pins'] as const) {
      expect(cameraStep(before, lastKnown)).toEqual({
        phase: 'provisional',
        move: { kind: 'me', center: [100.16, 49.64] },
      });
    }
    // Still the last known position: no move, and never the pins.
    expect(cameraStep('provisional', lastKnown)).toEqual({ phase: 'provisional', move: null });
    expect(cameraStep('provisional', { ...lastKnown, me: null })).toEqual({
      phase: 'provisional',
      move: null,
    });
    const live = { lat: 49.62, lng: 100.2 };
    expect(cameraStep('provisional', { ...idle, me: live })).toEqual({
      phase: 'settled',
      move: { kind: 'me', center: [100.2, 49.62] },
    });
  });

  it('leaves a provisional map the rep has moved', () => {
    expect(cameraStep('provisional', { ...idle, me, touched: true })).toEqual({
      phase: 'settled',
      move: null,
    });
  });

  it('never moves a map the rep has moved', () => {
    expect(cameraStep('pins', { ...idle, me, touched: true })).toEqual({
      phase: 'settled',
      move: null,
    });
    expect(cameraStep('waiting', { ...idle, me, touched: true })).toEqual({
      phase: 'settled',
      move: null,
    });
  });
});

describe('boundsOf', () => {
  it('boxes the pins', () => {
    expect(
      boundsOf([
        { lat: 49.6, lng: 100.1 },
        { lat: 47.2, lng: 102.8 },
        { lat: 48, lng: 101 },
      ]),
    ).toEqual([
      [100.1, 47.2],
      [102.8, 49.6],
    ]);
  });

  it('is a point for one pin and null for none', () => {
    expect(boundsOf([{ lat: 1, lng: 2 }])).toEqual([
      [2, 1],
      [2, 1],
    ]);
    expect(boundsOf([])).toBeNull();
  });
});

describe('centreOf', () => {
  it('is the middle of the box, or null without pins', () => {
    expect(
      centreOf([
        { lat: 48, lng: 100 },
        { lat: 50, lng: 102 },
      ]),
    ).toEqual([101, 49]);
    expect(centreOf([{ lat: 49.5, lng: 100.2 }])).toEqual([100.2, 49.5]);
    expect(centreOf([])).toBeNull();
  });
});

describe('tapOf', () => {
  const cluster = { cluster: true, cluster_id: 7, point_count: 3, stale: 1 };

  it('is one pin, or the pins of several stores each once', () => {
    expect(tapOf([{ id: 4, stale: true }])).toEqual({ kind: 'pin', id: 4 });
    expect(tapOf([{ id: 4 }, { id: 9 }, { id: 4 }])).toEqual({ kind: 'pins', ids: [4, 9] });
    // A pin repeated across two tiles is still one store.
    expect(tapOf([{ id: 4 }, { id: 4 }])).toEqual({ kind: 'pin', id: 4 });
  });

  it('prefers the pins to a cluster under them, else takes the cluster', () => {
    expect(tapOf([cluster, { id: 4 }])).toEqual({ kind: 'pin', id: 4 });
    expect(tapOf([cluster, { cluster_id: 8 }])).toEqual({ kind: 'cluster', clusterId: 7 });
  });

  it('is null for anything else', () => {
    expect(tapOf([])).toBeNull();
    expect(tapOf([{ id: '4' }, { name: 'x' }])).toBeNull();
  });

  it("reads a cluster's leaves as store ids", () => {
    expect(storeIdsOf([{ id: 3 }, { id: 1 }, { id: 3 }, cluster])).toEqual([3, 1]);
  });
});

describe('storesWithIds', () => {
  it('keeps the list order, not the ids order', () => {
    const stores = [store({ customerId: 1 }), store({ customerId: 2 }), store({ customerId: 3 })];
    expect(storesWithIds(stores, [3, 1, 99]).map((entry) => entry.customerId)).toEqual([1, 3]);
  });
});

describe('startAddressOf', () => {
  const addresses = [
    { id: 31, isDefault: true },
    { id: 32, isDefault: false },
  ];

  it("starts at the map point's own address", () => {
    expect(startAddressOf(addresses, 32)).toBe(32);
  });

  it('falls back to the default, then the first, when that address is gone', () => {
    expect(startAddressOf(addresses, 40)).toBe(31);
    expect(startAddressOf([{ id: 33, isDefault: false }], 40)).toBe(33);
    expect(startAddressOf([], 40)).toBeNull();
  });
});

describe('daysBetween', () => {
  it('counts calendar days across months and years', () => {
    expect(daysBetween('2026-10-14', '2026-10-18')).toBe(4);
    expect(daysBetween('2026-09-30', '2026-10-01')).toBe(1);
    expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
    expect(daysBetween('2026-10-18', '2026-10-18')).toBe(0);
    expect(daysBetween('2026-10-18', '2026-10-14')).toBe(-4);
  });
});

describe('lastOrderOf', () => {
  it('tells the day and how long ago', () => {
    expect(lastOrderOf({ lastOrderDate: '2026-10-14' }, '2026-10-18')).toEqual({
      date: '10/14',
      days: 4,
    });
    expect(lastOrderOf({ lastOrderDate: '2026-10-18' }, '2026-10-18')).toEqual({
      date: '10/18',
      days: 0,
    });
  });

  it('is null without an order, and never in the future', () => {
    expect(lastOrderOf({ lastOrderDate: null }, '2026-10-18')).toBeNull();
    expect(lastOrderOf({ lastOrderDate: '2026-10-19' }, '2026-10-18')?.days).toBe(0);
  });
});
