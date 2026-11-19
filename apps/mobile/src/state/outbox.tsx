import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { unwrap } from '../api/problem';
import type { RepOrder } from '../api/rep';
import type { Cart, OrderRequest } from '../cart/cart';
import type { PendingSend } from '../cart/send';
import { outboxStore, readJson, userKey, writeJson } from '../device/storage';
import {
  editEntry,
  type SubmitResult as AnySubmitResult,
  submitOrder,
  takeOverPending,
} from '../outbox/actions';
import { retryDelay } from '../outbox/backoff';
import { attemptOf, type OutboxEntry, unsentOf } from '../outbox/entry';
import { Outbox, type OutboxState, type RunReport } from '../outbox/outbox';
import { useSignedIn } from './session';
import { useShop } from './shop';

/** What «Захиалга илгээх» came to: on the server, kept on the phone, refused, or not stored. */
export type SubmitResult = AnySubmitResult<RepOrder>;

interface OutboxValue {
  /** Every entry, the sent ones of the last three days included. */
  entries: readonly OutboxEntry[];
  /** Not on the server yet, oldest first: «Илгээгдээгүй (N)». */
  unsent: OutboxEntry[];
  /** The stored orders could not be read (tried again on the next foreground). */
  readFailed: boolean;
  /** An order's latest state could not be written to the phone. */
  writeFailed: boolean;
  /** A run is going on. */
  running: boolean;
  /** Stores the cart as an entry, empties the cart and tries to send at once. */
  submit: (
    stageId: number,
    stageName: string | null,
    estimate: string | null,
    unpricedLines: number,
  ) => Promise<SubmitResult | null>;
  /** «Одоо илгээх». */
  sendNow: () => Promise<void>;
  /** «Устгах»: false when it did not go (its request is out, or the storage failed). */
  remove: (id: string) => Promise<boolean>;
  /** «Засах»: the entry's cart is stored as the cart, then the entry goes; false when not. */
  edit: (id: string) => Promise<boolean>;
}

const OutboxContext = createContext<OutboxValue | null>(null);

function isPending(value: unknown): value is PendingSend {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PendingSend).key === 'string' &&
    typeof (value as PendingSend).body === 'string' &&
    typeof (value as PendingSend).startedAt === 'string'
  );
}

/** The known-keys check runs at most this often outside a return to online. */
const CHECK_EVERY_MS = 3600 * 1000;

const EMPTY: OutboxState = { entries: [], readFailed: false, writeFailed: false };

/**
 * The rep's outbox on this server for this user (one key per entry,
 * `bto.outbox.v1:<server>:<userId>:<entryId>`, owner 2026-11-19). It sends by itself: at start,
 * back in the foreground, as soon as the session is online again, on a timer while entries wait
 * (30 s growing to 2 min) and from «Одоо илгээх». A pending send left in the old store
 * (`bto.send.v1`) becomes an entry. Inside ShopProvider.
 */
export function OutboxProvider({ children }: { children: ReactNode }) {
  const { session, server, me, offline } = useSignedIn();
  const { ready: shopReady, cart, dispatch, saveCart, cartKey } = useShop();
  const queryClient = useQueryClient();
  const sendKey = useMemo(() => userKey('send', server, me.id), [server, me.id]);

  const outbox = useMemo(
    () =>
      new Outbox<RepOrder>({
        store: outboxStore(server, me.id),
        post: (body, key) =>
          attemptOf(() =>
            session.client.POST('/api/v1/sales-rep/orders', {
              body: body as OrderRequest,
              params: { header: { 'Idempotency-Key': key } },
            }),
          ),
        now: () => new Date(),
        newKey: Crypto.randomUUID,
        orderRef: (order) => ({ id: order.id, number: order.number }),
      }),
    [server, me.id, session],
  );
  const state = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, () => EMPTY);
  const [running, setRunning] = useState(false);
  const [settled, setSettled] = useState(false);

  // The latest values for the callbacks the timers hold.
  const offlineRef = useRef(offline);
  offlineRef.current = offline;
  const cartRef = useRef<Cart>(cart);
  cartRef.current = cart;
  // Gone (signed out, another server, another user): no timer and no run from here on.
  const disposed = useRef(false);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['rep', 'orders'] });
    await queryClient.invalidateQueries({ queryKey: ['rep', 'products'] });
    // The store map's red and green, and the store card's history.
    await queryClient.invalidateQueries({ queryKey: ['rep', 'map'] });
    await queryClient.invalidateQueries({ queryKey: ['rep', 'store-orders'] });
  }, [queryClient]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tries = useRef(0);
  const runRef = useRef<(force: boolean) => Promise<RunReport | null>>(() => Promise.resolve(null));

  /** After a run: the timer again while entries wait and the session is online. */
  const plan = useCallback(
    (report: RunReport) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (disposed.current) return;
      if (report.sent > 0 || !outbox.hasWaiting()) tries.current = 0;
      if (!outbox.hasWaiting() || offlineRef.current) return;
      timer.current = setTimeout(() => void runRef.current(false), retryDelay(tries.current));
      tries.current += 1;
    },
    [outbox],
  );

  const run = useCallback(
    async (force: boolean): Promise<RunReport | null> => {
      if (disposed.current) return null;
      // Without a connection the session asks the server by itself; its return starts a run.
      if (!force && offlineRef.current) return null;
      setRunning(true);
      try {
        const report = await outbox.run();
        if (report.sent > 0) await refresh();
        plan(report);
        return report;
      } finally {
        if (!disposed.current) setRunning(false);
      }
    },
    [outbox, refresh, plan],
  );
  runRef.current = run;

  /**
   * Which keys the server knows (ADR-0225 #5): after each return to online, at start when online,
   * otherwise at most once an hour. An order the server lost goes back to waiting.
   */
  const lastCheck = useRef(0);
  const check = useCallback(async () => {
    if (disposed.current || offlineRef.current) return;
    lastCheck.current = Date.now();
    const result = await outbox.reconcile(
      async (keys) =>
        unwrap(await session.client.POST('/api/v1/sales-rep/orders/known', { body: { keys } }))
          .data,
      async (orderId) =>
        unwrap(
          await session.client.GET('/api/v1/sales-rep/orders/{id}', {
            params: { path: { id: orderId } },
          }),
        ).number,
    );
    if (result.waiting > 0) await refresh();
  }, [outbox, session, refresh]);

  /** The old store's pending send, once the outbox is read (until it is stored). */
  const takeOver = useCallback(async () => {
    const old = await readJson(sendKey);
    if (!isPending(old)) return;
    const stored = await takeOverPending(outbox, old, cartRef.current, cartKey, () =>
      dispatch({ type: 'sent' }),
    );
    if (stored) await writeJson(sendKey, null);
  }, [outbox, sendKey, cartKey, dispatch]);

  // At start: the outbox is read, the old pending send taken over, then the first run.
  useEffect(() => {
    if (!shopReady) return;
    let live = true;
    void (async () => {
      await outbox.ready;
      if (!live) return;
      await takeOver();
      if (!live) return;
      setSettled(true);
      void run(false);
    })();
    return () => {
      live = false;
    };
  }, [shopReady, outbox, takeOver, run]);

  // Back in the foreground (a failed read is tried again first), and when the session is online.
  useEffect(() => {
    if (!settled) return;
    const watch = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void (async () => {
        if (outbox.getSnapshot().readFailed) {
          await outbox.retryRead();
          await takeOver();
        }
        if (Date.now() - lastCheck.current >= CHECK_EVERY_MS) await check();
        await run(false);
      })();
    });
    return () => watch.remove();
  }, [settled, outbox, takeOver, check, run]);
  // At start when online, and each return from offline: ask about the keys, then send.
  useEffect(() => {
    if (!settled || offline) return;
    void (async () => {
      await check();
      await run(false);
    })();
  }, [settled, offline, check, run]);
  // And at most once an hour while the app is open.
  useEffect(() => {
    if (!settled) return;
    const every = setInterval(() => {
      if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      void (async () => {
        await check();
        await run(false);
      })();
    }, CHECK_EVERY_MS);
    return () => clearInterval(every);
  }, [settled, check, run]);

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      outbox.dispose();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [outbox]);

  const submitting = useRef(false);
  const submit = useCallback(
    async (
      stageId: number,
      stageName: string | null,
      estimate: string | null,
      unpricedLines: number,
    ): Promise<SubmitResult | null> => {
      if (submitting.current) return null;
      submitting.current = true;
      try {
        return await submitOrder({
          outbox,
          cart: cartRef.current,
          stageId,
          stageName,
          estimate,
          unpricedLines,
          cartKey,
          key: Crypto.randomUUID(),
          now: new Date(),
          emptyCart: () => dispatch({ type: 'sent' }),
          saveCart,
          run: () => run(true),
        });
      } finally {
        submitting.current = false;
      }
    },
    [outbox, cartKey, dispatch, saveCart, run],
  );

  const sendNow = useCallback(async () => {
    tries.current = 0;
    await run(true);
  }, [run]);

  const remove = useCallback((id: string) => outbox.remove(id).catch(() => false), [outbox]);

  const edit = useCallback((id: string) => editEntry(outbox, id, saveCart), [outbox, saveCart]);

  const value = useMemo(
    () => ({
      entries: state.entries,
      unsent: unsentOf(state.entries),
      readFailed: state.readFailed,
      writeFailed: state.writeFailed,
      running,
      submit,
      sendNow,
      remove,
      edit,
    }),
    [state, running, submit, sendNow, remove, edit],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}

export function useOutbox(): OutboxValue {
  const value = useContext(OutboxContext);
  if (!value) throw new Error('useOutbox outside OutboxProvider');
  return value;
}
