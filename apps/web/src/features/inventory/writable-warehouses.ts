import { useAuthState } from '@/app/auth-context';

/** The warehouses the signed-in user writes for (ADR-0027 #7); null: every warehouse. */
export function useWritableWarehouses(): ReadonlySet<number> | null {
  const state = useAuthState();
  if (state.status !== 'authenticated') return new Set();
  const ids = state.me.writableWarehouseIds;
  return ids === null ? null : new Set(ids);
}
