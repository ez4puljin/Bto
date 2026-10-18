import { useCallback, useMemo } from 'react';
import { useAuthState } from '@/app/auth-context';
import type { Warehouse } from '@/features/identity/api';

const STORAGE_KEY = 'tugeel.inventory.lastWarehouse.v1';

export type WarehouseDoc =
  'receipt' | 'adjustment' | 'stocktake' | 'transferRequest' | 'transferPush' | 'issue';

type Remembered = Record<string, Partial<Record<WarehouseDoc, number>>>;

function readRemembered(): Remembered {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Remembered)
      : {};
  } catch {
    return {};
  }
}

/**
 * The warehouse a create dialog starts with (ADR-0047 #6): the only one the user may write for,
 * else the one this user chose last for the same kind of document (kept in this browser), else the
 * first offered. Only warehouse ids are kept (ADR-0037 #3); a blocked or full storage just forgets.
 */
export function useDefaultWarehouse(
  options: readonly Warehouse[],
  doc: WarehouseDoc,
): { defaultId: number | undefined; remember: (warehouseId: number) => void } {
  const state = useAuthState();
  const userId = state.status === 'authenticated' ? String(state.me.id) : null;
  const defaultId = useMemo(() => {
    if (options.length <= 1) return options[0]?.id;
    const last = userId === null ? undefined : readRemembered()[userId]?.[doc];
    return options.some((warehouse) => warehouse.id === last) ? last : options[0]?.id;
  }, [options, userId, doc]);
  const remember = useCallback(
    (warehouseId: number) => {
      if (userId === null) return;
      try {
        const all = readRemembered();
        all[userId] = { ...all[userId], [doc]: warehouseId };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      } catch {
        // Storage blocked or full: the next dialog starts with the first warehouse.
      }
    },
    [userId, doc],
  );
  return { defaultId, remember };
}
