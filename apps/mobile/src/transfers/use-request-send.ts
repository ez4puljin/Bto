import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePostTransferRequest } from '../api/transfers';
import type { PendingSend } from '../cart/send';
import { type PendingStore, type SendResult, useIdempotentSend } from '../cart/use-idempotent-send';
import { readJson, writeJson } from '../device/storage';
import { useSignedIn } from '../state/session';
import type { TransferDraft } from './draft';
import { requestBodyOf, requestSendKey } from './request-send';
import type { TransferRequestCreateRequest, TransferRequestDetail } from './types';

export type RequestSendResult = SendResult<TransferRequestDetail>;

function isPending(value: unknown): value is PendingSend {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as PendingSend).key === 'string' &&
    typeof (value as PendingSend).body === 'string' &&
    typeof (value as PendingSend).startedAt === 'string'
  );
}

/**
 * The request's pending send, kept under `bto.transferSend.v1:<server>:<userId>` before the
 * request leaves (ADR-0116 on ADR-0061 #8); `ready` once the stored one is read.
 */
function useRequestPendingStore(onSent: () => void): PendingStore & { ready: boolean } {
  const { server, me } = useSignedIn();
  const key = useMemo(() => requestSendKey(server, me.id), [server, me.id]);
  const [pending, setPendingState] = useState<PendingSend | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void readJson(key).then((stored) => {
      if (!live) return;
      setPendingState(isPending(stored) ? stored : null);
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [key]);

  const setPending = useCallback(
    async (value: PendingSend | null) => {
      setPendingState(value);
      await writeJson(key, value);
    },
    [key],
  );

  return { pending, setPending, onSent, ready };
}

/**
 * Sends the draft as a request (`POST /transfer-requests`): the same body keeps its key, a lost
 * answer keeps the pending send for «Дахин илгээх». The screen then asks the server to send the
 * request (`POST …/request`) and clears the draft.
 */
export function useRequestSend(draft: TransferDraft, onSent: () => void) {
  const post = usePostTransferRequest();
  const queryClient = useQueryClient();
  const store = useRequestPendingStore(onSent);
  const sender = useIdempotentSend<TransferRequestCreateRequest, TransferRequestDetail>({
    bodyOf: () => requestBodyOf(draft),
    post,
    afterSent: async () => {
      await queryClient.invalidateQueries({ queryKey: ['transfers'] });
    },
    store,
  });
  return { ...sender, ready: store.ready };
}
