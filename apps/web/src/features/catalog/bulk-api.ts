import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { KEYS as INVENTORY } from '@/features/inventory/api';
import { KEYS as PARTNERS } from '@/features/partners/api';
import { KEYS as PRICING } from '@/features/pricing/api';
import { unwrap } from '@/lib/problem';
import { KEYS } from './api';

type Schemas = components['schemas'];
export type BulkResult = Schemas['BulkResult'];
export type BulkProfileResult = Schemas['BulkProfileResult'];
export type BulkHomeResult = Schemas['BulkHomeResult'];

/** Idempotent routes take one key per user intent, resent unchanged on a retry (ADR-0004). */
type Keyed<T> = T & { key: string };

/**
 * Bulk changes of ticked products (ADR-0051): one route per module that owns the field. Each
 * refreshes the product list and the data the change touched.
 */
export function useBulkEdits() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = (...keys: readonly (readonly string[])[]) =>
    Promise.all(
      [KEYS.products, ...keys].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  return {
    status: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<Schemas['BulkStatusRequest']>) =>
        unwrap(
          await api.POST('/api/v1/products/bulk/status', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(),
    }),
    category: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<Schemas['BulkCategoryRequest']>) =>
        unwrap(
          await api.POST('/api/v1/products/bulk/category', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(),
    }),
    mainSupplier: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<Schemas['BulkMainSupplierRequest']>) =>
        unwrap(
          await api.POST('/api/v1/product-suppliers/bulk/main', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(PARTNERS.productSuppliers, PARTNERS.suppliers),
    }),
    profile: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<Schemas['BulkProfileRequest']>) =>
        unwrap(
          await api.POST('/api/v1/product-prices/bulk/profile', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(PRICING.prices),
    }),
    home: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<Schemas['BulkHomeRequest']>) =>
        unwrap(
          await api.POST('/api/v1/product-locations/bulk/home', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (_, body) => (body.dryRun ? undefined : refresh(INVENTORY.locations)),
    }),
  };
}
