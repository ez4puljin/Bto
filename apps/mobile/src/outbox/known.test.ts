import { describe, expect, it } from 'vitest';
import { ApiProblem } from '../api/problem';
import { type Cart, EMPTY_CART } from '../cart/cart';
import { type Attempt, DAMAGED, entryOf, KEY_TOO_OLD, type OutboxEntry } from './entry';
import { applyKnown, askable, KNOWN_BATCH, type KnownKey, STUCK } from './known';
import { Outbox } from './outbox';
import { type KeyValueStore, outboxEntryKey, outboxStoreOn } from './storage';

const DAY = 24 * 3600 * 1000;
const MIN = 60 * 1000;
const T0 = new Date('2026-11-19T03:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SERVER = 'http://s';

const cart: Cart = {
  ...EMPTY_CART,
  customer: { id: 1, code: 'C1', name: 'Номин' },
  lines: [
    {
      productId: 1,
      productUnitId: 10,
      sku: 'A',
      name: 'Сүү',
      uomName: 'ш',
      uomCode: 'PCS',
      factorToBase: '1',
      isBase: true,
      qty: '2',
      wholesale: '1000',
      thumbUrl: null,
    },
  ],
  deliveryDate: '2026-11-19',
  paymentMethod: 'CASH',
};

const waiting = (key: string, ms = 0) => entryOf(cart, 5, null, key, at(ms), '2000.00');
const sent = (key: string, ms = 0): OutboxEntry => ({
  ...waiting(key, ms),
  status: 'sent',
  cart: null,
  order: { id: 7, number: 'SO-7' },
  sentAt: at(ms).toISOString(),
  tries: 1,
});
const check = (key: string, code: string, ms = 0): OutboxEntry => ({
  ...waiting(key, ms),
  status: 'check',
  problem: { code, status: 0 },
  tries: 1,
  reached: true,
});
const known = (
  key: string,
  status: KnownKey['status'],
  createdAt: Date,
  orderId: number | null = null,
): KnownKey => ({
  key,
  status,
  createdAt: createdAt.toISOString(),
  orderId,
});

describe('which keys the server knows (ADR-0225 #5): one entry', () => {
  it('a sent order the server holds stays; one it lost goes back to waiting with its key and body', () => {
    const one = sent('k1');
    expect(applyKnown(one, known('k1', 'COMPLETED', T0, 7), at(MIN))).toBeNull();
    expect(applyKnown(one, known('k1', 'IN_PROGRESS', T0), at(MIN))).toBeNull();
    const lost = applyKnown(one, undefined, at(DAY));
    expect(lost?.entry).toMatchObject({
      status: 'waiting',
      key: 'k1',
      body: one.body,
      resent: true,
      order: null,
      sentAt: null,
    });
  });

  it('an entry to check that the server completed is sent, with the order to read its number from', () => {
    const one = check('k1', KEY_TOO_OLD);
    const next = applyKnown(one, known('k1', 'COMPLETED', T0, 42), at(MIN));
    expect(next).toMatchObject({
      entry: { status: 'sent', order: { id: 42, number: null }, problem: null, cart: null },
      orderId: 42,
    });
  });

  it('absent: sent again inside six days of its key, left to check after', () => {
    const young = check('k1', 'IDEMPOTENCY_KEY_REUSED');
    expect(applyKnown(young, undefined, at(5 * DAY))?.entry).toMatchObject({
      status: 'waiting',
      key: 'k1',
      problem: null,
    });
    const old = check('k2', KEY_TOO_OLD);
    expect(applyKnown(old, undefined, at(6 * DAY))).toBeNull();
  });

  it('a key the server still runs: stuck after ten minutes, otherwise it waits', () => {
    const one: OutboxEntry = { ...waiting('k1'), inProgress: true, reached: true, tries: 1 };
    expect(applyKnown(one, known('k1', 'IN_PROGRESS', at(-5 * MIN)), T0)).toBeNull();
    expect(applyKnown(one, known('k1', 'IN_PROGRESS', at(-11 * MIN)), T0)?.entry).toMatchObject({
      status: 'check',
      problem: { code: STUCK },
    });
    // A check entry the server runs for a short while goes back to waiting for it.
    expect(
      applyKnown(check('k2', 'IDEMPOTENCY_KEY_REUSED'), known('k2', 'IN_PROGRESS', at(-MIN)), T0)
        ?.entry,
    ).toMatchObject({ status: 'waiting', inProgress: true });
  });

  it('never touches a damaged entry, a waiting one never sent, or a refused one', () => {
    const damaged: OutboxEntry = { ...check('k1', DAMAGED), damaged: true };
    expect(askable([damaged, waiting('k2'), { ...waiting('k3'), status: 'refused' }])).toEqual([]);
    expect(applyKnown(damaged, undefined, T0)).toBeNull();
    expect(applyKnown(waiting('k2'), undefined, T0)).toBeNull();
  });
});

class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  getAllKeys = () => Promise.resolve([...this.data.keys()]);
  multiGet = (keys: readonly string[]) =>
    Promise.resolve(keys.map((key) => [key, this.data.get(key) ?? null] as const));
  multiSet = (pairs: [string, string][]) => {
    for (const [key, value] of pairs) this.data.set(key, value);
    return Promise.resolve();
  };
  multiRemove = (keys: readonly string[]) => {
    for (const key of keys) this.data.delete(key);
    return Promise.resolve();
  };
}

function outboxWith(entries: OutboxEntry[], now = T0) {
  const kv = new MemoryKV();
  for (const entry of entries)
    kv.data.set(outboxEntryKey(SERVER, 7, entry.id), JSON.stringify(entry));
  const posts: string[] = [];
  const outbox = new Outbox<{ id: number; number: string }>({
    store: outboxStoreOn(kv, SERVER, 7),
    post: (_body, key): Promise<Attempt<{ id: number; number: string }>> => {
      posts.push(key);
      return Promise.resolve({
        status: 201,
        order: { id: 99, number: 'SO-99' },
        problem: { code: 'NETWORK', status: 0 },
      });
    },
    now: () => now,
    newKey: () => 'new',
    orderRef: (order) => order,
  });
  return { outbox, posts };
}

describe('which keys the server knows: the outbox asks', () => {
  it('no answer is not «absent»: a failed call changes nothing', async () => {
    const { outbox } = outboxWith([sent('k1'), check('k2', 'IDEMPOTENCY_KEY_REUSED')], at(DAY));
    const result = await outbox.reconcile(
      () => Promise.reject(new TypeError('Network request failed')),
      () => Promise.resolve(null),
    );
    expect(result).toEqual({ waiting: 0 });
    expect(outbox.get('k1')?.status).toBe('sent');
    expect(outbox.get('k2')?.status).toBe('check');
  });

  it('«absent» only from a 200 answer for that very key; the lost order is sent again', async () => {
    const { outbox, posts } = outboxWith([sent('k1'), sent('k2')], at(DAY));
    let asked: string[] = [];
    const result = await outbox.reconcile(
      (keys) => {
        asked = keys;
        return Promise.resolve([known('k2', 'COMPLETED', T0, 7)]);
      },
      () => Promise.resolve(null),
    );
    expect(asked.sort()).toEqual(['k1', 'k2']);
    expect(result).toEqual({ waiting: 1 });
    expect(outbox.get('k1')).toMatchObject({ status: 'waiting', resent: true });
    expect(outbox.get('k2')?.status).toBe('sent');
    await outbox.run();
    expect(posts).toEqual(['k1']);
    expect(outbox.get('k1')).toMatchObject({ status: 'sent', key: 'k1' });
    expect(outbox.get('k1')?.resent).toBeUndefined();
  });

  it('asks 200 keys a call; a batch that fails leaves its keys, the others are settled', async () => {
    const entries = Array.from({ length: KNOWN_BATCH + 5 }, (_, at) =>
      sent(`k${String(at).padStart(3, '0')}`),
    );
    const { outbox } = outboxWith(entries, at(DAY));
    const sizes: number[] = [];
    await outbox.reconcile(
      (keys) => {
        sizes.push(keys.length);
        // The first batch gets no answer; the second is answered with nothing held.
        return sizes.length === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve([]);
      },
      () => Promise.resolve(null),
    );
    expect(sizes).toEqual([KNOWN_BATCH, 5]);
    const states = outbox.getSnapshot().entries.map((one) => one.status);
    expect(states.filter((status) => status === 'sent')).toHaveLength(KNOWN_BATCH);
    expect(states.filter((status) => status === 'waiting')).toHaveLength(5);
  });

  it('a completed key to check becomes sent with the number the order reads back', async () => {
    const { outbox } = outboxWith([check('k1', KEY_TOO_OLD)], at(7 * DAY));
    await outbox.reconcile(
      () => Promise.resolve([known('k1', 'COMPLETED', T0, 42)]),
      (id) => Promise.resolve(id === 42 ? 'SO-42' : null),
    );
    expect(outbox.get('k1')).toMatchObject({ status: 'sent', order: { id: 42, number: 'SO-42' } });

    const unread = outboxWith([check('k2', KEY_TOO_OLD)], at(7 * DAY)).outbox;
    await unread.reconcile(
      () => Promise.resolve([known('k2', 'COMPLETED', T0, 43)]),
      () => Promise.reject(new Error('offline')),
    );
    expect(unread.get('k2')).toMatchObject({ status: 'sent', order: { id: 43, number: null } });
  });
});

describe('a lost sent order and the six-day rule (review 2026-11-20)', () => {
  it('re-queued with a key six days old or more, it goes to check and is not sent', async () => {
    // Written offline on day 0, sent on day 4, the server restored from a backup; asked on day 6.
    const late: OutboxEntry = { ...sent('k1'), sentAt: at(4 * DAY).toISOString() };
    const { outbox, posts } = outboxWith([late], at(6 * DAY));
    await outbox.reconcile(
      () => Promise.resolve([]),
      () => Promise.resolve(null),
    );
    expect(outbox.get('k1')).toMatchObject({ status: 'waiting', resent: true });
    await outbox.run();
    expect(posts).toEqual([]);
    expect(outbox.get('k1')).toMatchObject({
      status: 'check',
      key: 'k1',
      problem: { code: KEY_TOO_OLD },
    });
  });

  it('re-queued just under six days, it is sent with the same key and body', async () => {
    const one: OutboxEntry = { ...sent('k1'), sentAt: at(4 * DAY).toISOString() };
    const { outbox, posts } = outboxWith([one], at(6 * DAY - MIN));
    await outbox.reconcile(
      () => Promise.resolve([]),
      () => Promise.resolve(null),
    );
    await outbox.run();
    expect(posts).toEqual(['k1']);
    expect(outbox.get('k1')).toMatchObject({ status: 'sent', key: 'k1', body: one.body });
  });

  it('a 401 in the middle of a reconcile changes nothing for its keys', async () => {
    const entries = Array.from({ length: KNOWN_BATCH + 3 }, (_, n) =>
      sent(`k${String(n).padStart(3, '0')}`),
    );
    const { outbox } = outboxWith([...entries, check('c1', 'IDEMPOTENCY_KEY_REUSED')], at(DAY));
    let calls = 0;
    await outbox.reconcile(
      () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(
              entries.slice(0, KNOWN_BATCH).map((one) => known(one.key, 'COMPLETED', T0, 7)),
            )
          : Promise.reject(new ApiProblem({ code: 'UNAUTHORIZED', status: 401 }));
      },
      () => Promise.resolve(null),
    );
    expect(calls).toBe(2);
    expect(outbox.getSnapshot().entries.filter((one) => one.status === 'sent')).toHaveLength(
      KNOWN_BATCH + 3,
    );
    expect(outbox.get('c1')?.status).toBe('check');
  });
});
