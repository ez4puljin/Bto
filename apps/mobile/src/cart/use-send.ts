import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { type AppProblem, NETWORK, problemOf } from '../api/problem';
import type { RepOrder } from '../api/rep';
import { useSignedIn } from '../state/session';
import { useShop } from '../state/shop';
import { type OrderRequest, orderRequestOf } from './cart';
import { outcomeOf, type PendingSend, pendingFor } from './send';

export type SendResult =
  | { kind: 'sent'; order: RepOrder }
  | { kind: 'unknown' }
  | { kind: 'refused'; problem: AppProblem };

const WAIT_MS = 1_500;
const WAITS = 4;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the cart as an order (ADR-0061 #8): the pending send (its key and body) is stored before
 * the request leaves; a send with no answer keeps it, so «Дахин илгээх» repeats the same key and
 * the server replays its order instead of creating a second one.
 */
export function useSendOrder() {
  const { session } = useSignedIn();
  const { cart, dispatch, stageId, pending, setPending } = useShop();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  const post = async (send: PendingSend): Promise<SendResult> => {
    for (let attempt = 0; ; attempt += 1) {
      // No answer at all (a dropped connection) leaves status 0 and NETWORK.
      let status = 0;
      let problem: AppProblem = NETWORK;
      let order: RepOrder | undefined;
      try {
        const result = await session.client.POST('/api/v1/sales-rep/orders', {
          body: JSON.parse(send.body) as OrderRequest,
          params: { header: { 'Idempotency-Key': send.key } },
        });
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

  const finish = async (result: SendResult, fromCart: boolean) => {
    if (result.kind === 'unknown') return;
    await setPending(null);
    if (result.kind === 'sent') {
      if (fromCart) dispatch({ type: 'sent' });
      await queryClient.invalidateQueries({ queryKey: ['rep', 'orders'] });
      await queryClient.invalidateQueries({ queryKey: ['rep', 'products'] });
      // The store map's red and green: the store just ordered from turns green.
      await queryClient.invalidateQueries({ queryKey: ['rep', 'map'] });
      // And its order history on the store card.
      await queryClient.invalidateQueries({ queryKey: ['rep', 'store-orders'] });
    }
  };

  /** Sends the cart; with a pending send for another body, that one has to be settled first. */
  const send = async (): Promise<SendResult | null> => {
    if (stageId === null || sending) return null;
    setSending(true);
    try {
      const next = pendingFor(
        pending,
        orderRequestOf(cart, stageId),
        Crypto.randomUUID,
        new Date(),
      );
      await setPending(next);
      const result = await post(next);
      await finish(result, true);
      return result;
    } finally {
      setSending(false);
    }
  };

  /** Repeats a pending send with its own key and body (the answer was lost). */
  const resend = async (): Promise<SendResult | null> => {
    if (!pending || sending) return null;
    setSending(true);
    try {
      const result = await post(pending);
      await finish(result, true);
      return result;
    } finally {
      setSending(false);
    }
  };

  /** Drops a pending send the rep found among their orders (or knows did not arrive). */
  const forget = async () => {
    await setPending(null);
  };

  return { send, resend, forget, sending, pending };
}
