import { useCallback, useEffect, useState } from 'react';
import { useRepContext } from '../api/rep';
import { readJson, userKey, writeJson } from '../device/storage';
import { useSignedIn } from '../state/session';
import { filtersFrom, initialFilters, type ShopFilters, withKnownWarehouse } from './filters';

/**
 * The shop's filters, kept on the phone per server and user (ADR-0066): read once, written on each
 * change. Until a rep chooses, the location is their own warehouse (the context's warehouses and
 * their write scope); null until both are known.
 */
export function useShopFilters(): {
  filters: ShopFilters | null;
  setFilters: (next: ShopFilters) => void;
} {
  const { me, server } = useSignedIn();
  const context = useRepContext();
  const [filters, setState] = useState<ShopFilters | null>(null);
  const [stored, setStored] = useState<ShopFilters | null | undefined>(undefined);
  const key = userKey('shopFilters', server, me.id);

  useEffect(() => {
    let live = true;
    void readJson(key).then((value) => {
      if (live) setStored(filtersFrom(value));
    });
    return () => {
      live = false;
    };
  }, [key]);

  const warehouses = context.data?.warehouses;
  useEffect(() => {
    if (filters !== null || stored === undefined || !warehouses) return;
    setState(
      stored
        ? withKnownWarehouse(stored, warehouses)
        : initialFilters(warehouses, me.writableWarehouseIds),
    );
  }, [filters, stored, warehouses, me.writableWarehouseIds]);

  const setFilters = useCallback(
    (next: ShopFilters) => {
      setState(next);
      void writeJson(key, next);
    },
    [key],
  );
  return { filters, setFilters };
}
