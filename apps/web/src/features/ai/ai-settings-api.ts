import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { PRODUCT_AI_STATUS_KEY } from '../catalog/use-product-ai';
import { KEYS as AI_KEYS } from './api';

type Schemas = components['schemas'];
export type AiSettings = Schemas['AiSettings'];
export type AiSettingsUpdate = Schemas['AiSettingsUpdateRequest'];
export type AiSettingsTest = Schemas['AiSettingsTestRequest'];
export type AiCheck = Schemas['AiSettingsTestResult'];
export type AiUsage = Schemas['AiUsage'];
export type AiUsageTotals = Schemas['AiUsageTotals'];
export type PictureSettings = Schemas['PictureSettings'];
export type PictureSettingsUpdate = Schemas['PictureSettingsUpdateRequest'];
export type PictureCheck = Schemas['PictureSettingsTestResult'];

const KEYS = {
  settings: ['ai', 'settings'] as const,
  usage: ['ai', 'usage'] as const,
  picture: ['ai', 'picture-settings'] as const,
};

/** The connection, the limits (ADR-0162); the key itself never comes back. */
export function useAiSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/ai/settings', { signal })),
  });
}

/** The connection's state and the meter; the server repeats its free check every 5 minutes. */
export function useAiUsage() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.usage,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/ai/usage', { signal })),
  });
}

export function useAiSettingsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all(
      [KEYS.settings, KEYS.usage, AI_KEYS.status].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  return {
    update: useMutation({
      mutationFn: async (body: AiSettingsUpdate) =>
        unwrap(await api.PATCH('/api/v1/ai/settings', { body })),
      onSuccess: refresh,
    }),
    /** A free request to the provider with typed values, or the connection in force; saves nothing. */
    test: useMutation({
      mutationFn: async (body: AiSettingsTest) =>
        unwrap(await api.POST('/api/v1/ai/settings/test', { body })),
    }),
    /** Asks the provider again now, past the server's 5 minutes. */
    checkNow: useMutation({
      mutationFn: async () =>
        unwrap(await api.GET('/api/v1/ai/usage', { params: { query: { check: 'true' } } })),
      onSuccess: (usage) => queryClient.setQueryData(KEYS.usage, usage),
    }),
  };
}

/** Product pictures (ADR-0198): the background service's key (never returned) and the logo. */
export function usePictureSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.picture,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/ai/picture-settings', { signal })),
  });
}

export function usePictureSettingsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (body: PictureSettingsUpdate) =>
        unwrap(await api.PATCH('/api/v1/ai/picture-settings', { body })),
      onSuccess: (view) => {
        queryClient.setQueryData(KEYS.picture, view);
        return queryClient.invalidateQueries({ queryKey: PRODUCT_AI_STATUS_KEY });
      },
    }),
    /** A free request to the service with a typed key, or the saved one; saves nothing. */
    test: useMutation({
      mutationFn: async (apiKey: string | undefined) =>
        unwrap(
          await api.POST('/api/v1/ai/picture-settings/test', {
            body: apiKey ? { apiKey } : {},
          }),
        ),
    }),
  };
}

type PictureFailureKey =
  'noKey' | 'keyUnreadable' | 'badKey' | 'credit' | 'rateLimit' | 'timeout' | 'other';

/** Which text explains a failed check of the background service: its code and status only. */
export function pictureCheckFailureOf(check: PictureCheck): PictureFailureKey {
  if (check.reason === 'NO_KEY') return 'noKey';
  if (check.reason === 'KEY_UNREADABLE') return 'keyUnreadable';
  if (check.status === 402 || check.providerCode === 'insufficient_credits') return 'credit';
  if (check.status === 401 || check.status === 403) return 'badKey';
  if (check.status === 429) return 'rateLimit';
  if (check.reason === 'TIMEOUT' || check.reason === 'NETWORK') return 'timeout';
  return 'other';
}

const CREDIT_CODES = new Set(['billing_error', 'credit_balance_too_low', 'insufficient_quota']);

type FailureKey =
  | 'credit'
  | 'badKey'
  | 'forbidden'
  | 'noModel'
  | 'rateLimit'
  | 'timeout'
  | 'network'
  | 'keyUnreadable'
  | 'http'
  | 'other';

/** Which text explains a failed call: the provider's code and status, never its own words. */
export function failureOf(failure: {
  reason?: string | null;
  status?: number | null;
  providerCode?: string | null;
}): { key: FailureKey; status: number | null } {
  const status = failure.status ?? null;
  const found = ((): FailureKey => {
    if (failure.reason === 'KEY_UNREADABLE') return 'keyUnreadable';
    if (failure.providerCode && CREDIT_CODES.has(failure.providerCode)) return 'credit';
    if (status === 402) return 'credit';
    if (status === 401) return 'badKey';
    if (status === 403) return 'forbidden';
    if (status === 404) return 'noModel';
    if (status === 429) return 'rateLimit';
    if (failure.reason === 'TIMEOUT') return 'timeout';
    if (failure.reason === 'NETWORK') return 'network';
    return status === null ? 'other' : 'http';
  })();
  return { key: found, status };
}

/** A USD amount for people: cents, or «less than a cent» for what rounds to nothing. */
export function usdText(value: string, lessThanCent: string): string {
  const amount = new Decimal(value);
  if (amount.isZero()) return '$0.00';
  return amount.lt('0.01') ? lessThanCent : `$${amount.toFixed(2)}`;
}
