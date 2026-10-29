import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readJson, writeJson } from '../device/storage';
import { useSignedIn } from '../state/session';
import { draftFrom, draftKey, emptyDraft, type TransferDraft } from './draft';

/**
 * A store's request draft on the phone (ADR-0116 #1): read once per store, written 300 ms after
 * each change, cleared once the request is sent. `ready` is false until the stored one is read.
 */
export function useStoredDraft(storeId: number | null) {
  const { server, me } = useSignedIn();
  const key = useMemo(
    () => (storeId === null ? null : draftKey(server, me.id, storeId)),
    [server, me.id, storeId],
  );
  const [draft, setDraft] = useState<TransferDraft>(() => emptyDraft(storeId ?? 0));
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (key === null || storeId === null) return;
    let live = true;
    setReady(false);
    void readJson(key).then((stored) => {
      if (!live) return;
      setDraft(draftFrom(stored, storeId));
      setReady(true);
    });
    return () => {
      live = false;
    };
  }, [key, storeId]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!ready || key === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => void writeJson(key, draft.lines.length === 0 && !draft.note ? null : draft),
      300,
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [draft, key, ready]);

  /** Drops the draft at once (the request was sent). */
  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setDraft(emptyDraft(storeId ?? 0));
    if (key !== null) await writeJson(key, null);
  }, [key, storeId]);

  return { draft, setDraft, ready, clear };
}
