import type { components } from '@tugeel/api-client';
import { KEY_DAYS, type OutboxEntry } from './entry';

/**
 * Which keys the server knows (ADR-0225 #5): the phone asks `POST /sales-rep/orders/known` about
 * the orders it sent (kept three days) and about the ones it cannot settle by itself, and puts each
 * where the answer says. «Absent» comes only from a 200 answer for that very key: a call that
 * fails changes nothing.
 */

export type KnownKey = components['schemas']['SalesRepKnownKey'];

/** At most this many keys a call (the route's limit). */
export const KNOWN_BATCH = 200;
/** A key the server still runs after this long died between the order and its answer. */
export const STUCK_MS = 10 * 60 * 1000;
/** The code of an entry whose key the server holds unfinished: «Оффист мэдэгдэнэ үү». */
export const STUCK = 'OUTBOX_KEY_STUCK';

const DAY_MS = 24 * 3600 * 1000;

/** The entries worth asking about: sent ones, ones to check, ones the server said it still runs. */
export function askable(list: readonly OutboxEntry[]): OutboxEntry[] {
  return list.filter(
    (entry) =>
      !entry.damaged &&
      (entry.status === 'sent' ||
        entry.status === 'check' ||
        (entry.status === 'waiting' && entry.inProgress === true)),
  );
}

/** The keys in calls of at most KNOWN_BATCH. */
export function batchesOf(entries: readonly OutboxEntry[]): OutboxEntry[][] {
  const out: OutboxEntry[][] = [];
  for (let at = 0; at < entries.length; at += KNOWN_BATCH) {
    out.push(entries.slice(at, at + KNOWN_BATCH));
  }
  return out;
}

/**
 * Where an entry goes after a 200 answer of a call that asked for its key (`answer` undefined:
 * the key is absent). Null when nothing changes. `orderId` asks the caller for the number.
 */
export function applyKnown(
  entry: OutboxEntry,
  answer: KnownKey | undefined,
  now: Date,
): { entry: OutboxEntry; orderId: number | null } | null {
  if (entry.damaged) return null;
  if (entry.status === 'sent') {
    if (answer) return null;
    // The server lost it (a restore from a backup): sent again with the same key and body.
    return {
      entry: {
        ...entry,
        status: 'waiting',
        order: null,
        sentAt: null,
        problem: null,
        resent: true,
      },
      orderId: null,
    };
  }
  if (entry.status !== 'check' && !(entry.status === 'waiting' && entry.inProgress)) return null;
  if (answer?.status === 'COMPLETED') {
    if (answer.orderId === null) return null;
    const { inProgress: _was, ...rest } = entry;
    return {
      entry: {
        ...rest,
        status: 'sent',
        problem: null,
        cart: null,
        order: { id: answer.orderId, number: null },
        sentAt: now.toISOString(),
      },
      orderId: answer.orderId,
    };
  }
  if (answer?.status === 'IN_PROGRESS') {
    const age = now.getTime() - Date.parse(answer.createdAt);
    if (age > STUCK_MS) {
      if (entry.status === 'check' && entry.problem?.code === STUCK) return null;
      return {
        entry: { ...entry, status: 'check', problem: { code: STUCK, status: 0 } },
        orderId: null,
      };
    }
    if (entry.status === 'waiting') return null;
    return {
      entry: { ...entry, status: 'waiting', problem: null, inProgress: true },
      orderId: null,
    };
  }
  // Absent: the server does not hold the key. Inside its life the same key and body are safe to
  // send again; past six days the server may simply have forgotten it: the rep checks.
  if (now.getTime() - Date.parse(entry.keyAt) < KEY_DAYS * DAY_MS) {
    const { inProgress: _was, ...rest } = entry;
    return { entry: { ...rest, status: 'waiting', problem: null }, orderId: null };
  }
  return null;
}
