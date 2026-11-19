import { useState } from 'react';
import { type SubmitResult, useOutbox } from '../state/outbox';
import { useShop } from '../state/shop';

export type SendResult = SubmitResult;

/**
 * The rep's «Захиалга илгээх» (ADR-0061 #8, the outbox of 2026-11-19): the cart becomes an entry of
 * the outbox on the phone, the cart is emptied, and the send is tried at once on the stage chosen
 * in the settings. Online nothing changes for the rep; without an answer the order waits on the
 * phone and goes by itself.
 */
export function useSendOrder() {
  const { submit } = useOutbox();
  const { stageId } = useShop();
  const [sending, setSending] = useState(false);
  const send = async (
    stageName: string | null,
    estimate: string | null = null,
    unpricedLines = 0,
  ): Promise<SendResult | null> => {
    if (stageId === null || sending) return null;
    setSending(true);
    try {
      return await submit(stageId, stageName, estimate, unpricedLines);
    } finally {
      setSending(false);
    }
  };
  return { send, sending };
}
