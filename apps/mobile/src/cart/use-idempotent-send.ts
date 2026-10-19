import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { type AppProblem, NETWORK, problemOf } from '../api/problem';
import { useShop } from '../state/shop';
import { outcomeOf, type PendingSend, pendingFor } from './send';

export type SendResult<O> =
  { kind: 'sent'; order: O } | { kind: 'unknown' } | { kind: 'refused'; problem: AppProblem };

/** One POST of an order with its Idempotency-Key, as openapi-fetch answers it. */
export type PostOrder<B, O> = (
  body: B,
  key: string,
) => Promise<{ data?: O; error?: unknown; response: Response }>;

export interface IdempotentSendOptions<B, O> {
  /** The cart's order body; null when it cannot be sent (the staff app without a stage). */
  bodyOf: () => B | null;
  post: PostOrder<B, O>;
  /** After an order arrived: what to refresh. */
  afterSent: () => Promise<void>;
}

export interface Sender<O> {
  send: () => Promise<SendResult<O> | null>;
  resend: () => Promise<SendResult<O> | null>;
  forget: () => Promise<void>;
  sending: boolean;
  pending: PendingSend | null;
}

const WAIT_MS = 1_500;
const WAITS = 4;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the cart as an order in either app (ADR-0061 #8, ADR-0079 #5): the pending send (its key and
 * body) is stored before the request leaves; a send with no answer keeps it, so «Дахин илгээх»
 * repeats the same key and the server replays its order instead of creating a second one.
 */
export function useIdempotentSend<B, O>({
  bodyOf,
  post: postOrder,
  afterSent,
}: IdempotentSendOptions<B, O>): Sender<O> {
  const { dispatch, pending, setPending } = useShop();
  const [sending, setSending] = useState(false);

  const post = async (send: PendingSend): Promise<SendResult<O>> => {
    for (let attempt = 0; ; attempt += 1) {
      // No answer at all (a dropped connection) leaves status 0 and NETWORK.
      let status = 0;
      let problem: AppProblem = NETWORK;
      let order: O | undefined;
      try {
        const result = await postOrder(JSON.parse(send.body) as B, send.key);
        status = result.response.status;
        order = result.data;
        if (!order) problem = problemOf(result.error, status);
      } catch {
        problem = NETWORK;
      }
      const outcome = outcomeOf(status, order ? null : problem.code);
      if (outcome === 'sent' && order) return { kind: 'sent', order };
      if (outcome === 'wait' && attempt < WAITS) {
        await pause(WAIT_MS);
        continue;
      }
      if (outcome === 'refused') return { kind: 'refused', problem };
      return { kind: 'unknown' };
    }
  };

  const finish = async (result: SendResult<O>) => {
    if (result.kind === 'unknown') return;
    await setPending(null);
    if (result.kind === 'sent') {
      dispatch({ type: 'sent' });
      await afterSent();
    }
  };

  /** Sends the cart; with a pending send for another body, that one has to be settled first. */
  const send = async (): Promise<SendResult<O> | null> => {
    const body = bodyOf();
    if (body === null || sending) return null;
    setSending(true);
    try {
      const next = pendingFor(pending, body, Crypto.randomUUID, new Date());
      await setPending(next);
      const result = await post(next);
      await finish(result);
      return result;
    } finally {
      setSending(false);
    }
  };

  /** Repeats a pending send with its own key and body (the answer was lost). */
  const resend = async (): Promise<SendResult<O> | null> => {
    if (!pending || sending) return null;
    setSending(true);
    try {
      const result = await post(pending);
      await finish(result);
      return result;
    } finally {
      setSending(false);
    }
  };

  /** Drops a pending send found among the orders (or known not to have arrived). */
  const forget = async () => {
    await setPending(null);
  };

  return { send, resend, forget, sending, pending };
}
