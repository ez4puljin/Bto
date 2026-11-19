import type { Fulfilment, PaymentMethod } from '@tugeel/shared/sales';
import { type AppProblem, NETWORK, problemOf } from '../api/problem';
import { type Cart, cartFrom, type OrderRequest, orderRequestOf } from '../cart/cart';
import { canonical, type PendingSend } from '../cart/send';

/**
 * The rep's outbox (owner 2026-11-19, «Server унтарсан ч … ямар ч дата алдагдахгүйгээр»): every
 * «Захиалга илгээх» is first an entry on the phone, written before the request leaves, and the
 * phone sends the entries itself, oldest first, whenever the server answers. Pure rules here; the
 * store and its runner are `outbox.ts`, the React side `src/state/outbox.tsx`.
 */

/**
 * `waiting`: not on the server yet (never sent, or no answer); `sending`: a request is out;
 * `refused`: the server said no, with its problem; `check`: the phone cannot tell whether it
 * arrived (a key reused for another body, or a key too old to reuse after a lost answer); `sent`:
 * the server holds the order.
 */
export type OutboxStatus = 'waiting' | 'sending' | 'refused' | 'check' | 'sent';

/** What the list shows without the server. */
export interface OutboxSummary {
  /** The store's name; null for a send taken over from the old store without its cart. */
  storeName: string | null;
  customerId: number;
  lineCount: number;
  /** The first few products' names. */
  firstNames: string[];
  fulfilment: Fulfilment;
  /** YYYY-MM-DD. */
  deliveryDate: string;
  paymentMethod: PaymentMethod;
  /** The stage the order lands on, as the phone knew it; null when it did not. */
  stageName: string | null;
  /**
   * The cart's amount when it was sent: the server's quote, or the phone's estimate without the
   * server (ADR-0225 #4); always shown as «≈». Absent on entries written before it existed.
   */
  estimate?: string | null;
  /** Lines the estimate could not price (counted as 0 in it): «N барааны үнэ тооцогдоогүй». */
  unpricedLines?: number;
}

export interface OutboxEntry {
  /** Stable for the entry's life (its first key); the key itself may be renewed (six-day rule). */
  id: string;
  /** The Idempotency-Key the next request carries. */
  key: string;
  /** `POST /sales-rep/orders`' body as canonical JSON: the same body always goes with its key. */
  body: string;
  /** When the rep pressed «Захиалга илгээх», by the phone's clock (ISO). */
  writtenAt: string;
  /** When `key` was made (ISO): the server forgets a key seven days after it first saw it. */
  keyAt: string;
  /**
   * A request may have reached the server: one was started and ended without an HTTP answer
   * (whatever the error said: a connection that drops after the body went out reads like one that
   * never opened), the app stopped while one was out, or the server answered «still running».
   * Such an entry never takes a new key on its own (a second order could follow).
   */
  reached: boolean;
  summary: OutboxSummary;
  /** The cart it was made from, for «Засах»; null for a send taken over without its cart. */
  cart: Cart | null;
  status: OutboxStatus;
  /** Why it was refused, or why it needs a check. */
  problem: AppProblem | null;
  /** The order from the 201 (a replay included). */
  order: { id: number; number: string | null } | null;
  sentAt: string | null;
  /** How many requests this entry has made, and the last one's time. */
  tries: number;
  triedAt: string | null;
  /** The server answered «still running» (409 IDEMPOTENCY_KEY_IN_PROGRESS) to the last request. */
  inProgress?: true;
  /** A sent order the server no longer held (a restore): sent again with its key and body. */
  resent?: true;
  /**
   * Stored but unreadable: the raw text stays in storage untouched; it is shown as «Шалгах
   * шаардлагатай», never sent, never rewritten and never dropped by the app.
   */
  damaged?: true;
}

const DAY_MS = 24 * 3600 * 1000;
/** The server forgets keys after 7 days; past 6 a key is not reused on its own (as `pendingFor`). */
export const KEY_DAYS = 6;
/** A sent entry is kept this long (the next task asks the server which keys it still knows). */
export const SENT_KEEP_DAYS = 3;
/** How many product names the list shows. */
const FIRST_NAMES = 3;

/** The code of an entry whose old key may have reached the server: «Шалгах шаардлагатай». */
export const KEY_TOO_OLD = 'OUTBOX_KEY_TOO_OLD';
/** The code of a stored entry the phone cannot read. */
export const DAMAGED = 'OUTBOX_DAMAGED';

/** The list's summary of a cart. */
export function summaryOf(cart: Cart, stageName: string | null): OutboxSummary {
  return {
    storeName: cart.customer?.name ?? null,
    customerId: cart.customer?.id ?? 0,
    lineCount: cart.lines.length,
    firstNames: cart.lines.slice(0, FIRST_NAMES).map((line) => line.name),
    fulfilment: cart.fulfilment,
    deliveryDate: cart.deliveryDate ?? '',
    paymentMethod: cart.paymentMethod ?? 'CASH',
    stageName,
  };
}

/** A new entry for the cart: a new key, waiting. */
export function entryOf(
  cart: Cart,
  stageId: number,
  stageName: string | null,
  key: string,
  now: Date,
  estimate: string | null = null,
  unpricedLines = 0,
): OutboxEntry {
  const at = now.toISOString();
  return {
    id: key,
    key,
    body: canonical(orderRequestOf(cart, stageId)),
    writtenAt: at,
    keyAt: at,
    reached: false,
    summary: { ...summaryOf(cart, stageName), estimate, unpricedLines },
    cart,
    status: 'waiting',
    problem: null,
    order: null,
    sentAt: null,
    tries: 0,
    triedAt: null,
  };
}

/**
 * The old store's pending send (`bto.send.v1`, ADR-0061 #8) as an entry, so nothing in flight is
 * lost by the update. The locked cart it was made from is taken with it when it still makes the
 * same body (`cartTaken`: the cart is then emptied); otherwise the entry has no cart to edit.
 * Its answer was lost, so it may have reached the server.
 */
export function fromPending(
  pending: PendingSend,
  cart: Cart,
  stageName: string | null,
): { entry: OutboxEntry; cartTaken: boolean } {
  let request: Partial<OrderRequest> = {};
  try {
    request = JSON.parse(pending.body) as Partial<OrderRequest>;
  } catch {
    // An unreadable body still goes as it was stored.
  }
  const stageId = typeof request.stageId === 'number' ? request.stageId : null;
  const cartTaken =
    stageId !== null &&
    cart.lines.length > 0 &&
    canonical(orderRequestOf(cart, stageId)) === pending.body;
  const lines = Array.isArray(request.lines) ? request.lines : [];
  const summary: OutboxSummary = cartTaken
    ? summaryOf(cart, stageName)
    : {
        storeName: null,
        customerId: typeof request.customerId === 'number' ? request.customerId : 0,
        lineCount: lines.length,
        firstNames: [],
        fulfilment: request.fulfilment ?? 'DELIVERY',
        deliveryDate: request.deliveryDate ?? '',
        paymentMethod: request.paymentMethod ?? 'CASH',
        stageName,
      };
  return {
    entry: {
      id: pending.key,
      key: pending.key,
      body: pending.body,
      writtenAt: pending.startedAt,
      keyAt: pending.startedAt,
      reached: true,
      summary,
      cart: cartTaken ? cart : null,
      status: 'waiting',
      problem: null,
      order: null,
      sentAt: null,
      tries: 0,
      triedAt: null,
    },
    cartTaken,
  };
}

/**
 * The six-day rule before a request leaves: a key younger than KEY_DAYS is kept. An older one is
 * replaced by a new key only when no request was ever started for the entry; every other old
 * entry waits for a check (`check`, KEY_TOO_OLD): a new key could make a second order. (Part 2
 * settles those by asking the server which keys it still knows.)
 */
export function prepare(entry: OutboxEntry, now: Date, newKey: () => string): OutboxEntry {
  if (now.getTime() - Date.parse(entry.keyAt) < KEY_DAYS * DAY_MS) return entry;
  if (entry.reached || entry.tries > 0) {
    return { ...entry, status: 'check', problem: { code: KEY_TOO_OLD, status: 0 } };
  }
  return { ...entry, key: newKey(), keyAt: now.toISOString() };
}

/** One request's answer, as the outbox reads it. */
export interface Attempt<O> {
  /** The HTTP status; 0 without an answer. */
  status: number;
  /** The order of a 200/201. */
  order: O | null;
  /** The problem of any other answer (NETWORK without one). */
  problem: AppProblem;
}

/** Runs one openapi-fetch call and reads its answer; never throws. */
export async function attemptOf<O>(
  call: () => Promise<{ data?: O; error?: unknown; response: Response }>,
): Promise<Attempt<O>> {
  try {
    const result = await call();
    const status = result.response.status;
    if ((status === 200 || status === 201) && result.data !== undefined) {
      return { status, order: result.data, problem: NETWORK };
    }
    return { status, order: null, problem: problemOf(result.error, status) };
  } catch {
    // No HTTP answer (a time-out, a dropped or refused connection: the phone cannot tell when
    // the body had already gone out).
    return { status: 0, order: null, problem: NETWORK };
  }
}

/**
 * What the runner does after an entry's answer: `next` goes on to the next entry, `stop` ends the
 * run (the server is not there, or the session ended: do not hammer).
 */
export type Go = 'next' | 'stop';

/** The entry after its answer, and whether the run goes on. */
export function afterAttempt<O>(
  entry: OutboxEntry,
  attempt: Attempt<O>,
  now: Date,
  orderRef: (order: O) => { id: number; number: string | null },
): { entry: OutboxEntry; go: Go } {
  const { inProgress: _was, ...rest } = entry;
  const tried: OutboxEntry = { ...rest, tries: entry.tries + 1, triedAt: now.toISOString() };
  const { status, problem } = attempt;
  if ((status === 200 || status === 201) && attempt.order !== null) {
    const { resent: _resent, ...sentOne } = tried;
    return {
      entry: {
        ...sentOne,
        status: 'sent',
        problem: null,
        // On the server now: the cart is not needed any more (and keeps the stored entry small).
        cart: null,
        order: orderRef(attempt.order),
        sentAt: now.toISOString(),
      },
      go: 'next',
    };
  }
  // A request started and ended without an answer: it may have arrived.
  if (status === 0) return { entry: { ...tried, status: 'waiting', reached: true }, go: 'stop' };
  // The server failed (a 4xx/5xx releases the key: the same key goes again).
  if (status >= 500) return { entry: { ...tried, status: 'waiting' }, go: 'stop' };
  // The session ended: the entry waits for the rep to sign in again.
  if (status === 401) return { entry: { ...tried, status: 'waiting' }, go: 'stop' };
  // The first request with this key is still running on the server: the next run asks again.
  if (status === 409 && problem.code === 'IDEMPOTENCY_KEY_IN_PROGRESS') {
    return { entry: { ...tried, status: 'waiting', reached: true, inProgress: true }, go: 'next' };
  }
  // Cannot happen for an unchanged body; if it does, the rep checks.
  if (status === 409 && problem.code === 'IDEMPOTENCY_KEY_REUSED') {
    return { entry: { ...tried, status: 'check', problem }, go: 'next' };
  }
  return { entry: { ...tried, status: 'refused', problem }, go: 'next' };
}

/** The oldest waiting entry not yet tried in this run. */
export function nextWaiting(
  list: readonly OutboxEntry[],
  skip: ReadonlySet<string>,
): OutboxEntry | null {
  let next: OutboxEntry | null = null;
  for (const entry of list) {
    if (entry.status !== 'waiting' || skip.has(entry.id)) continue;
    if (!next || entry.writtenAt < next.writtenAt) next = entry;
  }
  return next;
}

/** Sent entries older than SENT_KEEP_DAYS go; nothing else is ever dropped by the app. */
export function prune(list: readonly OutboxEntry[], now: Date): OutboxEntry[] {
  return list.filter(
    (entry) =>
      entry.status !== 'sent' ||
      entry.sentAt === null ||
      now.getTime() - Date.parse(entry.sentAt) < SENT_KEEP_DAYS * DAY_MS,
  );
}

/** The entries not on the server, oldest first: what «Илгээгдээгүй (N)» lists. */
export function unsentOf(list: readonly OutboxEntry[]): OutboxEntry[] {
  return list
    .filter((entry) => entry.status !== 'sent')
    .sort((a, b) => (a.writtenAt < b.writtenAt ? -1 : a.writtenAt > b.writtenAt ? 1 : 0));
}

/** May the rep delete it? Not while its request is out, nor an unreadable one. */
export function mayDelete(entry: OutboxEntry): boolean {
  // An unreadable one may still be an order: it stays until part 2 can settle it with the server.
  return entry.status !== 'sending' && entry.status !== 'sent' && entry.damaged !== true;
}

/** May it go back into the cart? A refused or checked one that kept its cart. */
export function mayEdit(entry: OutboxEntry): boolean {
  return (entry.status === 'refused' || entry.status === 'check') && entry.cart !== null;
}

/** The cart «Засах» loads: the one it was made from, read as any stored cart. */
export function cartOfEntry(entry: OutboxEntry): Cart | null {
  return entry.cart ? cartFrom(entry.cart) : null;
}

/** Does the cart hold anything the rep would lose by loading another one? */
export function cartHasContent(cart: Cart): boolean {
  return cart.lines.length > 0 || cart.customer !== null || cart.note.trim() !== '';
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const STATUSES: readonly OutboxStatus[] = ['waiting', 'sending', 'refused', 'check', 'sent'];

/** What the list shows for a stored entry it cannot read. */
export function damagedEntry(id: string): OutboxEntry {
  return {
    id,
    key: id,
    body: '',
    writtenAt: '',
    keyAt: '',
    reached: true,
    summary: {
      storeName: null,
      customerId: 0,
      lineCount: 0,
      firstNames: [],
      fulfilment: 'DELIVERY',
      deliveryDate: '',
      paymentMethod: 'CASH',
      stageName: null,
    },
    cart: null,
    status: 'check',
    problem: { code: DAMAGED, status: 0 },
    order: null,
    sentAt: null,
    tries: 0,
    triedAt: null,
    damaged: true,
  };
}

/**
 * One stored entry read back. Anything that is not an entry stays as it is in storage and shows
 * as damaged («Шалгах шаардлагатай»). An entry found `sending` (the app stopped while its request
 * was out) waits again, may have arrived, and is `changed` (to be written back).
 */
export function entryFromRaw(id: string, raw: string): { entry: OutboxEntry; changed: boolean } {
  let item: unknown;
  try {
    item = JSON.parse(raw) as unknown;
  } catch {
    return { entry: damagedEntry(id), changed: false };
  }
  if (
    !isRecord(item) ||
    item.id !== id ||
    typeof item.key !== 'string' ||
    typeof item.body !== 'string' ||
    typeof item.writtenAt !== 'string' ||
    typeof item.keyAt !== 'string' ||
    !isRecord(item.summary) ||
    !STATUSES.includes(item.status as OutboxStatus)
  ) {
    return { entry: damagedEntry(id), changed: false };
  }
  const entry = { ...(item as unknown as OutboxEntry), cart: (item.cart as Cart | null) ?? null };
  if (entry.status === 'sending') {
    return { entry: { ...entry, status: 'waiting', reached: true }, changed: true };
  }
  return { entry, changed: false };
}
