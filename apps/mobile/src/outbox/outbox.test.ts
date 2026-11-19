import { describe, expect, it } from 'vitest';
import type { Me } from '../api/session';
import { type Cart, EMPTY_CART, orderRequestOf } from '../cart/cart';
import { canonical } from '../cart/send';
import { phaseOf } from '../state/phase';
import { editEntry, submitOrder, takeOverPending } from './actions';
import { RETRY_FIRST_MS, RETRY_MAX_MS, retryDelay } from './backoff';
import {
  afterAttempt,
  type Attempt,
  attemptOf,
  cartHasContent,
  cartOfEntry,
  DAMAGED,
  entryFromRaw,
  entryOf,
  fromPending,
  KEY_TOO_OLD,
  mayDelete,
  mayEdit,
  type OutboxEntry,
  prepare,
  prune,
  unsentOf,
} from './entry';
import { Outbox } from './outbox';
import { type KeyValueStore, outboxEntryKey, outboxListKey, outboxStoreOn } from './storage';

const DAY = 24 * 3600 * 1000;
const T0 = new Date('2026-11-19T03:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);
const SERVER = 'http://192.168.1.10:3300';
const USER = 7;
const CART_KEY = `bto.cart.v1:${SERVER}:${USER}`;

const cartFor = (customer: string, id = 1): Cart => ({
  ...EMPTY_CART,
  customer: { id, code: `C${id}`, name: customer },
  lines: [
    {
      productId: 10,
      productUnitId: 100,
      sku: 'A1',
      name: 'Сүү',
      uomName: 'ш',
      uomCode: 'PCS',
      factorToBase: '1',
      isBase: true,
      qty: '3',
      wholesale: '1000',
      thumbUrl: null,
    },
    {
      productId: 11,
      productUnitId: 110,
      sku: 'A2',
      name: 'Талх',
      uomName: 'ш',
      uomCode: 'PCS',
      factorToBase: '1',
      isBase: true,
      qty: '2',
      wholesale: '500',
      thumbUrl: null,
    },
  ],
  fulfilment: 'PICKUP',
  deliveryDate: '2026-11-19',
  paymentMethod: 'CASH',
  note: 'өглөө',
});

interface Order {
  id: number;
  number: string;
}

const sent = (id: number): Attempt<Order> => ({
  status: 201,
  order: { id, number: `SO-${id}` },
  problem: { code: 'NETWORK', status: 0 },
});
const answered = (status: number, code: string): Attempt<Order> => ({
  status,
  order: null,
  problem: { code, status },
});
const noAnswer = (): Attempt<Order> => ({
  status: 0,
  order: null,
  problem: { code: 'NETWORK', status: 0 },
});
const ref = (order: Order) => ({ id: order.id, number: order.number });

/** AsyncStorage in memory, whose calls can be made to fail. */
class MemoryKV implements KeyValueStore {
  data = new Map<string, string>();
  failReads = false;
  /** Keys whose writes fail (a full disk for those rows); `*` fails every write. */
  failWrites = new Set<string>();
  failRemoves = false;
  /** Every `multiSet` call's keys, in order. */
  sets: string[][] = [];
  removes: string[][] = [];

  getAllKeys = () =>
    this.failReads
      ? Promise.reject(new Error('CursorWindow: row too big'))
      : Promise.resolve([...this.data.keys()]);
  multiGet = (keys: readonly string[]) =>
    this.failReads
      ? Promise.reject(new Error('CursorWindow: row too big'))
      : Promise.resolve(keys.map((key) => [key, this.data.get(key) ?? null] as const));
  multiSet = (pairs: [string, string][]) => {
    this.sets.push(pairs.map(([key]) => key));
    if (pairs.some(([key]) => this.failWrites.has('*') || this.failWrites.has(key))) {
      return Promise.reject(new Error('SQLITE_FULL'));
    }
    for (const [key, value] of pairs) this.data.set(key, value);
    return Promise.resolve();
  };
  multiRemove = (keys: readonly string[]) => {
    this.removes.push([...keys]);
    if (this.failRemoves) return Promise.reject(new Error('locked'));
    for (const key of keys) this.data.delete(key);
    return Promise.resolve();
  };
}

const keyOf = (id: string) => outboxEntryKey(SERVER, USER, id);

/** An outbox over a memory AsyncStorage and a scripted server. */
function setup(
  answers: ((key: string, body: unknown) => Attempt<Order>)[] = [],
  kv = new MemoryKV(),
) {
  let clock = T0;
  let keys = 0;
  const posts: { key: string; body: unknown }[] = [];
  const make = () =>
    new Outbox<Order>({
      store: outboxStoreOn(kv, SERVER, USER),
      post: (body, key) => {
        posts.push({ key, body });
        const answer = answers.shift();
        return Promise.resolve(answer ? answer(key, body) : noAnswer());
      },
      now: () => clock,
      newKey: () => `key-new-${(keys += 1)}`,
      orderRef: ref,
    });
  const outbox = make();
  return {
    kv,
    outbox,
    make,
    posts,
    tick: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
  };
}

const entry = (name: string, key: string, ms = 0, id = 1) =>
  entryOf(cartFor(name, id), 5, 'Шинэ', key, at(ms));

const stored = (kv: MemoryKV, id: string) => {
  const text = kv.data.get(keyOf(id));
  return text === undefined ? undefined : (JSON.parse(text) as OutboxEntry);
};

describe('an outbox entry (owner 2026-11-19)', () => {
  it('keeps the body the cart makes, a summary to show without the server, and the cart', () => {
    const one = entry('Номин', 'k1');
    expect(one.body).toBe(canonical(orderRequestOf(cartFor('Номин'), 5)));
    expect(one).toMatchObject({
      id: 'k1',
      key: 'k1',
      status: 'waiting',
      writtenAt: T0.toISOString(),
      keyAt: T0.toISOString(),
      reached: false,
      summary: {
        storeName: 'Номин',
        lineCount: 2,
        firstNames: ['Сүү', 'Талх'],
        fulfilment: 'PICKUP',
        deliveryDate: '2026-11-19',
        paymentMethod: 'CASH',
        stageName: 'Шинэ',
      },
    });
  });

  it('moves through its states by the answer, and says whether the run goes on', () => {
    const one = entry('Номин', 'k1');
    expect(afterAttempt(one, sent(9), T0, ref)).toMatchObject({
      entry: {
        status: 'sent',
        order: { id: 9, number: 'SO-9' },
        sentAt: T0.toISOString(),
        cart: null,
      },
      go: 'next',
    });
    expect(afterAttempt(one, answered(502, 'INTERNAL_ERROR'), T0, ref)).toMatchObject({
      entry: { status: 'waiting', reached: false },
      go: 'stop',
    });
    expect(afterAttempt(one, answered(401, 'UNAUTHORIZED'), T0, ref)).toMatchObject({
      entry: { status: 'waiting' },
      go: 'stop',
    });
    expect(afterAttempt(one, answered(409, 'IDEMPOTENCY_KEY_IN_PROGRESS'), T0, ref)).toMatchObject({
      entry: { status: 'waiting', reached: true },
      go: 'next',
    });
    expect(afterAttempt(one, answered(409, 'IDEMPOTENCY_KEY_REUSED'), T0, ref)).toMatchObject({
      entry: { status: 'check', problem: { code: 'IDEMPOTENCY_KEY_REUSED' } },
      go: 'next',
    });
    expect(afterAttempt(one, answered(409, 'CUSTOMER_INACTIVE'), T0, ref)).toMatchObject({
      entry: { status: 'refused', problem: { code: 'CUSTOMER_INACTIVE', status: 409 } },
      go: 'next',
    });
    expect(afterAttempt(one, answered(422, 'VALIDATION_FAILED'), T0, ref).entry.status).toBe(
      'refused',
    );
  });

  it('keeps a sent entry three days, and never drops anything else', () => {
    const list = [
      { ...entry('A', 'a'), status: 'sent' as const, sentAt: T0.toISOString() },
      { ...entry('B', 'b'), status: 'refused' as const },
      entry('C', 'c'),
    ];
    expect(prune(list, at(3 * DAY - 1)).map((one) => one.id)).toEqual(['a', 'b', 'c']);
    expect(prune(list, at(30 * DAY)).map((one) => one.id)).toEqual(['b', 'c']);
    expect(unsentOf(list).map((one) => one.id)).toEqual(['b', 'c']);
  });

  it('takes over the old pending send, with its locked cart when that still makes the body', () => {
    const cart = cartFor('Номин');
    const pending = {
      key: 'old-key',
      body: canonical(orderRequestOf(cart, 5)),
      startedAt: '2026-11-18T10:00:00.000Z',
    };
    const taken = fromPending(pending, cart, null);
    expect(taken.cartTaken).toBe(true);
    expect(taken.entry).toMatchObject({
      id: 'old-key',
      key: 'old-key',
      body: pending.body,
      writtenAt: pending.startedAt,
      keyAt: pending.startedAt,
      reached: true,
      status: 'waiting',
      summary: { storeName: 'Номин', lineCount: 2 },
    });
    expect(taken.entry.cart).toEqual(cart);

    // The cart changed since (or is gone): the body still goes, without a cart to edit.
    const other = fromPending(pending, EMPTY_CART, null);
    expect(other.cartTaken).toBe(false);
    expect(other.entry).toMatchObject({
      body: pending.body,
      cart: null,
      summary: { storeName: null, customerId: 1, lineCount: 2, fulfilment: 'PICKUP' },
    });
    expect(mayEdit({ ...other.entry, status: 'refused' })).toBe(false);
  });

  it('gives a refused entry back to the cart as it was', () => {
    const cart = cartFor('Номин');
    const refused: OutboxEntry = { ...entry('Номин', 'k1'), status: 'refused' };
    expect(mayEdit(refused)).toBe(true);
    expect(mayEdit(entry('Номин', 'k1'))).toBe(false);
    expect(cartOfEntry(refused)).toEqual(cart);
    expect(cartHasContent(EMPTY_CART)).toBe(false);
    expect(cartHasContent({ ...EMPTY_CART, paymentMethod: 'CASH' })).toBe(false);
    expect(cartHasContent(cart)).toBe(true);
    expect(mayDelete({ ...refused, status: 'sending' })).toBe(false);
    expect(mayDelete(entry('Номин', 'k1'))).toBe(true);
  });
});

describe('the outbox runner', () => {
  it('sends oldest first and goes past a refused one in the middle', async () => {
    const { outbox, posts } = setup([
      () => sent(1),
      () => answered(409, 'PRODUCT_NOT_IN_APP'),
      () => sent(3),
    ]);
    await outbox.add(entry('C', 'c', 2000, 3));
    await outbox.add(entry('A', 'a', 0, 1));
    await outbox.add(entry('B', 'b', 1000, 2));
    const report = await outbox.run();
    expect(posts.map((post) => post.key)).toEqual(['a', 'b', 'c']);
    expect(report).toEqual({ sent: 2, noAnswer: false });
    expect(outbox.get('a')?.status).toBe('sent');
    expect(outbox.get('b')).toMatchObject({
      status: 'refused',
      problem: { code: 'PRODUCT_NOT_IN_APP' },
    });
    expect(outbox.get('c')?.status).toBe('sent');
    expect(outbox.orderOf('c')).toEqual({ id: 3, number: 'SO-3' });
    expect(outbox.hasWaiting()).toBe(false);
  });

  it('stops at the first entry without an answer and does not touch the rest', async () => {
    const { outbox, posts } = setup([() => noAnswer()]);
    await outbox.add(entry('A', 'a', 0));
    await outbox.add(entry('B', 'b', 1000));
    expect(await outbox.run()).toEqual({ sent: 0, noAnswer: true });
    expect(posts).toHaveLength(1);
    expect(outbox.get('a')).toMatchObject({ status: 'waiting', tries: 1 });
    expect(outbox.get('b')).toMatchObject({ status: 'waiting', tries: 0 });
  });

  it('leaves an entry still running on the server for the next run and goes on', async () => {
    const { outbox, posts } = setup([
      () => answered(409, 'IDEMPOTENCY_KEY_IN_PROGRESS'),
      () => sent(2),
    ]);
    await outbox.add(entry('A', 'a', 0));
    await outbox.add(entry('B', 'b', 1000));
    await outbox.run();
    expect(posts.map((post) => post.key)).toEqual(['a', 'b']);
    expect(outbox.get('a')).toMatchObject({ status: 'waiting', reached: true });
    expect(outbox.get('b')?.status).toBe('sent');
  });

  it('stores the entry sending, with its key, before the request leaves', async () => {
    let seen: OutboxEntry | undefined;
    const run = setup([
      () => {
        seen = stored(run.kv, 'a');
        return sent(1);
      },
    ]);
    await run.outbox.add(entry('A', 'a'));
    await run.outbox.run();
    expect(seen).toMatchObject({ id: 'a', status: 'sending', key: 'a' });
    expect(stored(run.kv, 'a')).toMatchObject({ status: 'sent', cart: null });
  });

  it('one run at a time: a run asked during a run comes after it', async () => {
    let release: (value: Attempt<Order>) => void = () => undefined;
    const posts: string[] = [];
    const kv = new MemoryKV();
    const slow = new Outbox<Order>({
      store: outboxStoreOn(kv, SERVER, USER),
      post: (_body, key) => {
        posts.push(key);
        return key === 'a'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(sent(2));
      },
      now: () => T0,
      newKey: () => 'x',
      orderRef: ref,
    });
    await slow.add(entry('A', 'a'));
    const first = slow.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(slow.get('a')?.status).toBe('sending');
    expect(await slow.remove('a')).toBe(false);
    await slow.add(entry('B', 'b', 1000));
    const second = slow.run();
    release(answered(422, 'VALIDATION_FAILED'));
    await first;
    await second;
    expect(slow.get('a')?.status).toBe('refused');
    expect(slow.get('b')?.status).toBe('sent');
    expect(posts).toEqual(['a', 'b']);
    expect(await slow.remove('a')).toBe(true);
    expect(kv.data.has(keyOf('a'))).toBe(false);
  });
});

describe('finding 1a: a failed or damaged read never empties the outbox', () => {
  it('a failed read writes nothing, runs nothing, refuses new entries, and reads again later', async () => {
    const kv = new MemoryKV();
    kv.data.set(keyOf('a'), JSON.stringify(entry('A', 'a')));
    kv.failReads = true;
    const { outbox, posts } = setup([() => sent(1)], kv);
    await outbox.ready;
    expect(outbox.getSnapshot()).toMatchObject({ readFailed: true, entries: [] });
    expect(await outbox.run()).toEqual({ sent: 0, noAnswer: false });
    await expect(outbox.add(entry('B', 'b'))).rejects.toThrow('not been read');
    expect(await outbox.remove('a')).toBe(false);
    expect(posts).toHaveLength(0);
    expect(kv.sets).toEqual([]);
    expect(kv.removes).toEqual([]);
    expect(kv.data.has(keyOf('a'))).toBe(true);

    // The next foreground: the storage answers again.
    kv.failReads = false;
    await outbox.retryRead();
    expect(outbox.getSnapshot()).toMatchObject({ readFailed: false });
    expect(outbox.get('a')?.status).toBe('waiting');
    await outbox.run();
    expect(outbox.get('a')?.status).toBe('sent');
  });

  it('rewrites nothing at start when nothing changed', async () => {
    const kv = new MemoryKV();
    kv.data.set(keyOf('a'), JSON.stringify(entry('A', 'a')));
    kv.data.set(keyOf('b'), JSON.stringify({ ...entry('B', 'b'), status: 'refused' }));
    const { outbox } = setup([], kv);
    await outbox.ready;
    expect(outbox.getSnapshot().entries).toHaveLength(2);
    expect(kv.sets).toEqual([]);
    expect(kv.removes).toEqual([]);
  });

  it('keeps an unreadable entry as it is, shows it to check, never sends, rewrites or drops it', async () => {
    const kv = new MemoryKV();
    kv.data.set(keyOf('bad'), '{"id":"bad","key":');
    kv.data.set(keyOf('odd'), JSON.stringify({ id: 'odd', hello: 1 }));
    kv.data.set(keyOf('a'), JSON.stringify(entry('A', 'a')));
    const { outbox, posts } = setup([() => sent(1)], kv);
    await outbox.ready;
    expect(outbox.get('bad')).toMatchObject({
      status: 'check',
      damaged: true,
      problem: { code: DAMAGED },
    });
    expect(outbox.get('odd')).toMatchObject({ status: 'check', damaged: true });
    expect(mayDelete(outbox.get('bad') as OutboxEntry)).toBe(false);
    expect(await outbox.remove('bad')).toBe(false);
    await outbox.run();
    expect(posts.map((post) => post.key)).toEqual(['a']);
    expect(kv.data.get(keyOf('bad'))).toBe('{"id":"bad","key":');
    expect(kv.sets.flat()).not.toContain(keyOf('bad'));
    expect(entryFromRaw('x', 'not json').entry.damaged).toBe(true);
  });

  it('writes back only an entry found sending (it waits again and may have arrived)', async () => {
    const kv = new MemoryKV();
    kv.data.set(keyOf('a'), JSON.stringify({ ...entry('A', 'a'), status: 'sending' }));
    kv.data.set(keyOf('b'), JSON.stringify(entry('B', 'b')));
    const { outbox } = setup([], kv);
    await outbox.ready;
    expect(kv.sets).toEqual([[keyOf('a')]]);
    expect(stored(kv, 'a')).toMatchObject({ status: 'waiting', reached: true });
  });
});

describe('finding 1b: one key per entry', () => {
  it('stores each entry under its own key, so one damaged entry never takes the others', async () => {
    const { outbox, kv } = setup();
    await outbox.add(entry('A', 'a'));
    await outbox.add(entry('B', 'b', 1000));
    expect([...kv.data.keys()].sort()).toEqual([keyOf('a'), keyOf('b')]);
    kv.data.set(keyOf('a'), '\u0000broken');
    const again = setup([], kv).outbox;
    await again.ready;
    expect(again.get('a')?.damaged).toBe(true);
    expect(again.get('b')).toMatchObject({ status: 'waiting', summary: { storeName: 'B' } });
  });

  it('splits an old single list once into entry keys', async () => {
    const kv = new MemoryKV();
    kv.data.set(
      outboxListKey(SERVER, USER),
      JSON.stringify([entry('A', 'a'), { ...entry('B', 'b'), status: 'refused' }, { junk: 1 }]),
    );
    const { outbox } = setup([], kv);
    await outbox.ready;
    expect(kv.data.has(outboxListKey(SERVER, USER))).toBe(false);
    expect(outbox.get('a')?.status).toBe('waiting');
    expect(outbox.get('b')?.status).toBe('refused');
    // An item without an id is kept under its own key, to check.
    expect(outbox.get('legacy-2')).toMatchObject({ damaged: true });
    expect(kv.data.has(keyOf('legacy-2'))).toBe(true);
  });

  it('leaves an old list it cannot read where it is', async () => {
    const kv = new MemoryKV();
    kv.data.set(outboxListKey(SERVER, USER), '[{"id":');
    const { outbox } = setup([], kv);
    await outbox.ready;
    expect(kv.data.get(outboxListKey(SERVER, USER))).toBe('[{"id":');
    expect(outbox.get('legacy')).toMatchObject({ damaged: true });
  });

  it('drops a sent entry three days later, and its cart when it is sent', async () => {
    const { outbox, kv, make, tick } = setup([() => sent(1)]);
    await outbox.add(entry('A', 'a'));
    await outbox.run();
    expect(stored(kv, 'a')).toMatchObject({ status: 'sent', cart: null });
    tick(3 * DAY + 1);
    const later = make();
    await later.ready;
    expect(later.get('a')).toBeUndefined();
    expect(kv.data.has(keyOf('a'))).toBe(false);
  });
});

describe('finding 2: a failed write is never hidden', () => {
  it('add rejects and nothing is added when the entry cannot be written', async () => {
    const { outbox, kv } = setup();
    await outbox.ready;
    kv.failWrites.add('*');
    await expect(outbox.add(entry('A', 'a'))).rejects.toThrow('SQLITE_FULL');
    expect(outbox.get('a')).toBeUndefined();
  });

  it('submit keeps the cart as it was and sends nothing when the entry cannot be stored', async () => {
    const { outbox, kv, posts } = setup([() => sent(1)]);
    await outbox.ready;
    kv.failWrites.add('*');
    let emptied = false;
    const result = await submitOrder({
      outbox,
      cart: cartFor('Номин'),
      stageId: 5,
      stageName: null,
      cartKey: CART_KEY,
      key: 'k1',
      now: T0,
      emptyCart: () => {
        emptied = true;
      },
      saveCart: () => Promise.resolve(),
      run: () => outbox.run(),
    });
    expect(result).toEqual({ kind: 'notSaved', reason: 'write' });
    expect(emptied).toBe(false);
    expect(posts).toHaveLength(0);
    expect(kv.data.has(CART_KEY)).toBe(false);
  });

  it('submit says the outbox is unread when it could not be read', async () => {
    const kv = new MemoryKV();
    kv.failReads = true;
    const { outbox } = setup([], kv);
    const result = await submitOrder({
      outbox,
      cart: cartFor('Номин'),
      stageId: 5,
      stageName: null,
      cartKey: CART_KEY,
      key: 'k1',
      now: T0,
      emptyCart: () => undefined,
      saveCart: () => Promise.resolve(),
      run: () => outbox.run(),
    });
    expect(result).toEqual({ kind: 'notSaved', reason: 'read' });
  });

  it('sends nothing when the entry cannot be written as sending', async () => {
    const { outbox, kv, posts } = setup([() => sent(1)]);
    await outbox.add(entry('A', 'a'));
    kv.failWrites.add(keyOf('a'));
    await outbox.run();
    expect(posts).toHaveLength(0);
    expect(outbox.get('a')?.status).toBe('waiting');
    expect(outbox.getSnapshot().writeFailed).toBe(true);
    kv.failWrites.clear();
    await outbox.run();
    expect(posts).toHaveLength(1);
    expect(outbox.getSnapshot().writeFailed).toBe(false);
  });

  it('a later successful write does not hide an earlier failure of another entry', async () => {
    const { outbox, kv } = setup([
      () => {
        // The answer of A cannot be written down (the disk filled meanwhile).
        kv.failWrites.add(keyOf('a'));
        return sent(1);
      },
      () => sent(2),
    ]);
    await outbox.add(entry('A', 'a'));
    await outbox.add(entry('B', 'b', 1000));
    await outbox.run();
    expect(stored(kv, 'b')?.status).toBe('sent');
    expect(stored(kv, 'a')?.status).toBe('sending');
    expect(outbox.get('a')?.status).toBe('sent');
    expect(outbox.getSnapshot().writeFailed).toBe(true);
    // Written at the next chance.
    kv.failWrites.clear();
    await outbox.run();
    expect(stored(kv, 'a')?.status).toBe('sent');
    expect(outbox.getSnapshot().writeFailed).toBe(false);
  });
});

describe('finding 3: the order is always in the cart, the outbox or both, never in neither', () => {
  it('submit writes the entry and the emptied cart in one multiSet', async () => {
    const { outbox, kv } = setup([() => noAnswer()]);
    await outbox.ready;
    const result = await submitOrder({
      outbox,
      cart: cartFor('Номин'),
      stageId: 5,
      stageName: 'Шинэ',
      cartKey: CART_KEY,
      key: 'k1',
      now: T0,
      emptyCart: () => undefined,
      saveCart: () => Promise.resolve(),
      run: () => outbox.run(),
    });
    expect(result).toEqual({ kind: 'saved' });
    expect(kv.sets[0]).toEqual([keyOf('k1'), CART_KEY]);
    expect(JSON.parse(kv.data.get(CART_KEY) ?? 'null')).toEqual({
      ...EMPTY_CART,
      paymentMethod: 'CASH',
    });
  });

  it('refused at once: the cart is stored back before the entry goes', async () => {
    const { outbox, kv } = setup([() => answered(409, 'CUSTOMER_INACTIVE')]);
    await outbox.ready;
    const order: string[] = [];
    const cart = cartFor('Номин');
    const result = await submitOrder({
      outbox,
      cart,
      stageId: 5,
      stageName: null,
      cartKey: CART_KEY,
      key: 'k1',
      now: T0,
      emptyCart: () => undefined,
      saveCart: (back) => {
        order.push(`cart:${back.customer?.name ?? ''}:${String(kv.data.has(keyOf('k1')))}`);
        return Promise.resolve();
      },
      run: () => outbox.run(),
    });
    expect(result).toMatchObject({
      kind: 'refused',
      kept: false,
      problem: { code: 'CUSTOMER_INACTIVE' },
    });
    // The entry was still stored when the cart was saved; it is gone now.
    expect(order).toEqual(['cart:Номин:true']);
    expect(kv.data.has(keyOf('k1'))).toBe(false);
  });

  it('refused at once with the cart not storable: the entry stays refused', async () => {
    const { outbox } = setup([() => answered(409, 'CUSTOMER_INACTIVE')]);
    await outbox.ready;
    const result = await submitOrder({
      outbox,
      cart: cartFor('Номин'),
      stageId: 5,
      stageName: null,
      cartKey: CART_KEY,
      key: 'k1',
      now: T0,
      emptyCart: () => undefined,
      saveCart: () => Promise.reject(new Error('SQLITE_FULL')),
      run: () => outbox.run(),
    });
    expect(result).toMatchObject({ kind: 'refused', kept: true });
    expect(outbox.get('k1')?.status).toBe('refused');
  });

  it('«Засах» stores the cart first; when it cannot, the entry stays', async () => {
    const kv = new MemoryKV();
    const refused: OutboxEntry = { ...entry('Номин', 'k1'), status: 'refused' };
    kv.data.set(keyOf('k1'), JSON.stringify(refused));
    const { outbox } = setup([], kv);
    await outbox.ready;
    expect(await editEntry(outbox, 'k1', () => Promise.reject(new Error('full')))).toBe(false);
    expect(outbox.get('k1')).toBeDefined();
    expect(kv.data.has(keyOf('k1'))).toBe(true);

    let entryStoredWhenCartSaved: boolean | null = null;
    expect(
      await editEntry(outbox, 'k1', (cart) => {
        entryStoredWhenCartSaved = kv.data.has(keyOf('k1'));
        expect(cart).toEqual(cartFor('Номин'));
        return Promise.resolve();
      }),
    ).toBe(true);
    expect(entryStoredWhenCartSaved).toBe(true);
    expect(kv.data.has(keyOf('k1'))).toBe(false);
  });

  it('«Засах» with the entry not removable: the cart holds it and the entry stays', async () => {
    const kv = new MemoryKV();
    kv.data.set(keyOf('k1'), JSON.stringify({ ...entry('Номин', 'k1'), status: 'refused' }));
    const { outbox } = setup([], kv);
    await outbox.ready;
    kv.failRemoves = true;
    expect(await editEntry(outbox, 'k1', () => Promise.resolve())).toBe(false);
    expect(outbox.get('k1')?.status).toBe('refused');
  });

  it('takes over the old pending send with the emptied cart in the same write', async () => {
    const { outbox, kv } = setup();
    await outbox.ready;
    const cart = cartFor('Номин');
    const pending = {
      key: 'old',
      body: canonical(orderRequestOf(cart, 5)),
      startedAt: T0.toISOString(),
    };
    let emptied = false;
    expect(
      await takeOverPending(outbox, pending, cart, CART_KEY, () => {
        emptied = true;
      }),
    ).toBe(true);
    expect(emptied).toBe(true);
    expect(kv.sets[0]).toEqual([keyOf('old'), CART_KEY]);
    // Again (the old key's removal was lost): nothing doubles.
    expect(await takeOverPending(outbox, pending, cart, CART_KEY, () => undefined)).toBe(true);
    expect(outbox.getSnapshot().entries).toHaveLength(1);

    kv.failWrites.add('*');
    const other = { ...pending, key: 'old2' };
    expect(await takeOverPending(outbox, other, cart, CART_KEY, () => undefined)).toBe(false);
  });
});

describe('finding 4: a request that got no answer may have arrived', () => {
  it('reads every missing answer as «may have arrived», whatever the error says', async () => {
    for (const message of ['Network request failed', 'Network request timed out', 'Aborted']) {
      const attempt = await attemptOf<Order>(() => Promise.reject(new TypeError(message)));
      expect(attempt).toEqual({ status: 0, order: null, problem: { code: 'NETWORK', status: 0 } });
      expect(afterAttempt(entry('A', 'a'), attempt, T0, ref)).toMatchObject({
        entry: { status: 'waiting', reached: true, tries: 1 },
        go: 'stop',
      });
    }
    const ok = await attemptOf<Order>(() =>
      Promise.resolve({
        data: { id: 1, number: 'SO-1' },
        response: new Response(null, { status: 201 }),
      }),
    );
    expect(ok).toMatchObject({ status: 201, order: { id: 1 } });
    const refused = await attemptOf<Order>(() =>
      Promise.resolve({
        error: { code: 'PRICE_MISSING' },
        response: new Response(null, { status: 422 }),
      }),
    );
    expect(refused).toMatchObject({ status: 422, order: null, problem: { code: 'PRICE_MISSING' } });
  });

  it('takes a new key at six days only when no request was ever started', () => {
    const one = entry('Номин', 'k1');
    const newKey = () => 'k2';
    expect(prepare(one, at(6 * DAY - 1), newKey)).toBe(one);
    expect(prepare(one, at(6 * DAY), newKey)).toMatchObject({
      key: 'k2',
      keyAt: at(6 * DAY).toISOString(),
      id: 'k1',
      status: 'waiting',
    });
    // Answered once by a 5xx (the key released), or never answered: a check, never a new key.
    expect(prepare({ ...one, tries: 1 }, at(6 * DAY), newKey)).toMatchObject({
      key: 'k1',
      status: 'check',
      problem: { code: KEY_TOO_OLD },
    });
    expect(prepare({ ...one, reached: true }, at(6 * DAY), newKey)).toMatchObject({
      key: 'k1',
      status: 'check',
    });
  });

  it('an entry that never got an answer becomes a check after six days, never a new order', async () => {
    const { outbox, posts, tick } = setup([() => noAnswer(), () => noAnswer()]);
    await outbox.add(entry('A', 'a'));
    await outbox.run();
    tick(DAY);
    await outbox.run();
    expect(posts[1]).toEqual(posts[0]);
    tick(6 * DAY);
    await outbox.run();
    expect(posts).toHaveLength(2);
    expect(outbox.get('a')).toMatchObject({
      status: 'check',
      key: 'a',
      problem: { code: KEY_TOO_OLD },
    });
  });

  it('an entry never sent takes a new key after six days and goes with the same body', async () => {
    const { outbox, posts, tick } = setup([() => sent(1)]);
    await outbox.add(entry('A', 'a'));
    tick(7 * DAY);
    await outbox.run();
    expect(posts[0]?.key).toBe('key-new-1');
    expect(posts[0]?.body).toEqual(JSON.parse(entry('A', 'a').body));
    expect(outbox.get('a')).toMatchObject({ status: 'sent', key: 'key-new-1' });
  });
});

describe('finding 5: nothing runs after the outbox is gone', () => {
  it('sends no further request once disposed, but writes down an answer already coming', async () => {
    let release: (value: Attempt<Order>) => void = () => undefined;
    const posts: string[] = [];
    const kv = new MemoryKV();
    const outbox = new Outbox<Order>({
      store: outboxStoreOn(kv, SERVER, USER),
      post: (_body, key) => {
        posts.push(key);
        return new Promise((resolve) => {
          release = resolve;
        });
      },
      now: () => T0,
      newKey: () => 'x',
      orderRef: ref,
    });
    await outbox.add(entry('A', 'a'));
    await outbox.add(entry('B', 'b', 1000));
    const running = outbox.run();
    await new Promise((resolve) => setTimeout(resolve, 0));
    outbox.dispose();
    release(sent(1));
    await running;
    expect(posts).toEqual(['a']);
    expect(stored(kv, 'a')?.status).toBe('sent');
    expect(outbox.get('b')?.status).toBe('waiting');
    expect(await outbox.run()).toEqual({ sent: 0, noAnswer: false });
    expect(posts).toEqual(['a']);
  });
});

describe('the tries again', () => {
  it('waits 30 s at first, growing to at most two minutes', () => {
    expect([0, 1, 2, 3, 10, 100].map(retryDelay)).toEqual([
      RETRY_FIRST_MS,
      60_000,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
      RETRY_MAX_MS,
    ]);
  });
});

describe('the phase with a stored identity and no answer', () => {
  it('is the app itself, flagged offline', () => {
    const me = {
      id: 7,
      username: 'rep',
      phone: null,
      fullName: 'Төлөөлөгч',
      permissions: ['sales.orders.rep'],
      roles: [],
      writableWarehouseIds: null,
      sessionStartedAt: T0.toISOString(),
      sessionExpiresAt: T0.toISOString(),
    } as unknown as Me;
    expect(phaseOf('http://s', { status: 'signedIn', me, userId: 7, offline: true })).toBe('app');
    expect(phaseOf('http://s', { status: 'offline' })).toBe('offline');
  });
});
