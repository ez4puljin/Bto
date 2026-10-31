import { useAuthState, useHasPermission } from '@/app/auth-context';

/** Whether the signed-in user writes a warehouse, and who they are (ADR-0126 #2). */
export function usePickerSelf() {
  const auth = useAuthState();
  const lead = useHasPermission('sales.orders.pickLead');
  const me = auth.status === 'authenticated' ? auth.me : null;
  return {
    id: me?.id ?? null,
    lead,
    writes: (warehouseId: number) =>
      me !== null &&
      (me.writableWarehouseIds === null || me.writableWarehouseIds.includes(warehouseId)),
  };
}
