import { useEffect, useMemo, useState } from 'react';
import { useAuthState } from '@/app/auth-context';
import type { TransferDetail, TransferLine, TransferStatus } from './api';

/**
 * Counts typed while shipping or receiving a transfer, kept in this browser until they are sent
 * (ADR-0047 #6), so a reload, a closed tab or a stray click loses nothing. One entry per user,
 * transfer and step; only lines that differ from their default are kept, each with the basis it
 * was counted against, so a line the request changed since is dropped instead of restored. Every
 * read and write survives a blocked or full storage (the counts then live only in the page).
 */
export type TransferStep = 'ship' | 'receive';

export interface LineCount {
  /** As typed, in the line's unit or (`base`) in base units. */
  qty: string;
  base: boolean;
  binId: number | null;
  binCode: string | null;
}

interface StoredLine extends LineCount {
  basis: string;
}

interface Stored {
  savedAt: number;
  lines: Record<string, StoredLine>;
}

const PREFIX = 'tugeel.inventory.stepCounts.v1';
export const STEP_COUNTS_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const stepCountsKey = (userId: number, transferId: number, step: TransferStep) =>
  `${PREFIX}:${userId}:${transferId}:${step}`;

/** What a line was counted against: the request (shipping) or the shipment (receiving). */
export function basisOf(line: TransferLine, step: TransferStep): string {
  return step === 'ship'
    ? `${line.productId}|${line.requestUnitId}|${line.requestedQty}`
    : `${line.productId}|${line.shippedQtyBase ?? ''}`;
}

const sameCount = (a: LineCount, b: LineCount) =>
  a.qty.trim() === b.qty.trim() && a.base === b.base && a.binId === b.binId;

function isStored(value: unknown): value is Stored {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Stored).savedAt === 'number' &&
    typeof (value as Stored).lines === 'object' &&
    (value as Stored).lines !== null
  );
}

export function readStepCounts(key: string, now = Date.now()): Stored | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isStored(parsed) || now - parsed.savedAt > STEP_COUNTS_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearStepCounts(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** Drops every entry older than a week (a transfer finished on another device, say). */
export function sweepStepCounts(now = Date.now()): void {
  try {
    const old: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(`${PREFIX}:`) && readStepCounts(key, now) === null) old.push(key);
    }
    for (const key of old) localStorage.removeItem(key);
  } catch {
    // Storage blocked: nothing to sweep.
  }
}

/** The lines whose count differs from their default. */
function changedLines(counts: Record<number, LineCount>, defaults: Record<number, LineCount>) {
  return Object.entries(counts).filter(([id, count]) => {
    const fallback = defaults[Number.parseInt(id, 10)];
    return fallback === undefined || !sameCount(count, fallback);
  });
}

/** The stored lines that still match the transfer, applied over the defaults. */
export function restoreCounts(
  defaults: Record<number, LineCount>,
  stored: Stored | null,
  bases: ReadonlyMap<number, string>,
): { counts: Record<number, LineCount>; restored: number; dropped: number } {
  const counts = { ...defaults };
  let restored = 0;
  let dropped = 0;
  for (const [id, line] of Object.entries(stored?.lines ?? {})) {
    const lineId = Number.parseInt(id, 10);
    if (!(lineId in counts) || bases.get(lineId) !== line.basis) {
      dropped += 1;
      continue;
    }
    counts[lineId] = { qty: line.qty, base: line.base, binId: line.binId, binCode: line.binCode };
    restored += 1;
  }
  return { counts, restored, dropped };
}

/**
 * A step's counts, restored from this browser on mount and written back on every change. `dirty`
 * says some line differs from its default (the leave question); `reset` goes back to the defaults.
 */
export function useStepCounts(
  detail: TransferDetail,
  step: TransferStep,
  defaultsOf: () => Record<number, LineCount>,
) {
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : 0;
  const key = stepCountsKey(userId, detail.id, step);
  const bases = useMemo(
    () => new Map(detail.lines.map((line) => [line.id, basisOf(line, step)])),
    [detail.lines, step],
  );
  const [start] = useState(() => {
    const defaults = defaultsOf();
    return { defaults, ...restoreCounts(defaults, readStepCounts(key), bases) };
  });
  const [counts, setCounts] = useState(start.counts);
  const dirty = changedLines(counts, start.defaults).length > 0;

  useEffect(() => {
    const changed = changedLines(counts, start.defaults);
    try {
      if (changed.length === 0) {
        localStorage.removeItem(key);
        return;
      }
      const lines = Object.fromEntries(
        changed.map(([id, count]) => [
          id,
          { ...count, basis: bases.get(Number.parseInt(id, 10)) ?? '' },
        ]),
      );
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), lines }));
    } catch {
      // Storage blocked or full: the counts live only in this page.
    }
  }, [key, counts, bases, start.defaults]);

  return {
    counts,
    setCounts,
    dirty,
    restored: start.restored,
    dropped: start.dropped,
    reset: () => setCounts(start.defaults),
    clear: () => clearStepCounts(key),
  };
}

/**
 * Clears the counts of a step the transfer no longer waits for (shipped, received or cancelled
 * elsewhere too) and sweeps week-old entries. A request taken back keeps its ship counts: it may
 * come back (ADR-0046).
 */
export function useStepCountsCleanup(transferId: number, status: TransferStatus | undefined) {
  const auth = useAuthState();
  const userId = auth.status === 'authenticated' ? auth.me.id : 0;
  useEffect(() => sweepStepCounts(), []);
  useEffect(() => {
    if (status === 'SHIPPED' || status === 'RECEIVED' || status === 'CANCELLED') {
      clearStepCounts(stepCountsKey(userId, transferId, 'ship'));
    }
    if (status === 'RECEIVED' || status === 'CANCELLED') {
      clearStepCounts(stepCountsKey(userId, transferId, 'receive'));
    }
  }, [status, userId, transferId]);
}
