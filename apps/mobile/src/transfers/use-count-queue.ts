import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { type AppProblem, NETWORK, problemOf } from '../api/problem';
import { useSaveCount } from '../api/transfers';
import { type CountEntry, dropHead, dropsCount, enqueueCount } from './counts';

export interface CountQueue {
  entries: readonly CountEntry[];
  /** The head's failed send; the queue waits for «Дахин илгээх». */
  failed: AppProblem | null;
  /** The group of a count the server dropped (it moved on), shown once. */
  dropped: number | null;
  sending: boolean;
  add: (entry: CountEntry) => void;
  resend: () => void;
  acknowledgeDropped: () => void;
}

/**
 * The FIFO count queue (ADR-0116 #4): each count is sent on its own, in order; a failed send stays
 * at the head until «Дахин илгээх»; a count the server refuses because the group moved on (409
 * DOC_STATE_INVALID / DOC_ALREADY_POSTED) is dropped and the request refetched.
 */
export function useCountQueue(): CountQueue {
  const save = useSaveCount();
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<readonly CountEntry[]>([]);
  const [failed, setFailed] = useState<AppProblem | null>(null);
  const [dropped, setDropped] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  // The send in flight, so a re-render never starts a second one; the latest `save` for it.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const head = entries[0] ?? null;

  useEffect(() => {
    if (!head || failed || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    void (async () => {
      let status = 0;
      let problem: AppProblem | null = null;
      try {
        const result = await saveRef.current(head.groupId, {
          lineId: head.lineId,
          productUnitId: head.productUnitId,
          qty: head.qty,
        });
        status = result.response.status;
        if (!result.data) problem = problemOf(result.error, status);
      } catch {
        problem = NETWORK;
      }
      inFlight.current = false;
      if (!mounted.current) return;
      setSending(false);
      if (problem === null) {
        setEntries((current) => dropHead(current));
        void queryClient.invalidateQueries({ queryKey: ['transfers'] });
        return;
      }
      if (dropsCount(status, problem.code)) {
        setEntries((current) => dropHead(current));
        setDropped(head.groupId);
        void queryClient.invalidateQueries({ queryKey: ['transfers'] });
        return;
      }
      setFailed(problem);
    })();
  }, [head, failed, queryClient]);

  const add = useCallback((entry: CountEntry) => {
    setEntries((current) => {
      // The head is on its way: a new count for its line goes after it, never in its place.
      if (inFlight.current && current[0]?.lineId === entry.lineId) {
        return [
          ...current.filter((item, index) => index === 0 || item.lineId !== entry.lineId),
          entry,
        ];
      }
      return enqueueCount(current, entry);
    });
  }, []);

  const resend = useCallback(() => {
    setFailed(null);
  }, []);

  const acknowledgeDropped = useCallback(() => {
    setDropped(null);
  }, []);

  return { entries, failed, dropped, sending, add, resend, acknowledgeDropped };
}
