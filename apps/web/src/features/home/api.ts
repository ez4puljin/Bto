import { useQuery } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

export type InventoryAttention = components['schemas']['InventoryAttention'];
export type PricingAttention = components['schemas']['PricingAttention'];

/** Every attention count; steps that change one invalidate it (ADR-0047 #7). */
export const ATTENTION_KEY = ['attention'] as const;

/** Small capped counts: fresh for 30 s, read again every minute while the page is visible. */
const LIVE = { staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true } as const;

export function useInventoryAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'inventory'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/inventory/attention', { signal })),
    enabled,
    ...LIVE,
  });
}

export function usePricingAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'pricing'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pricing/attention', { signal })),
    enabled,
    ...LIVE,
  });
}
