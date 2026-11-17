import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { SettlementGroup } from '@tugeel/shared/finance';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type SettlementSmsCustomer = Schemas['SettlementSmsCustomer'];
export type SettlementSmsCustomers = Schemas['SettlementSmsCustomers'];
export type SmsBatch = Schemas['SmsBatch'];
export type SmsBatchDetail = Schemas['SmsBatchDetail'];
export type SmsMessage = Schemas['SmsMessage'];
export type SmsSettings = Schemas['SmsSettings'];
export type SmsSettingsUpdate = Schemas['SmsSettingsUpdateRequest'];
export type SmsCheck = Schemas['SmsCheck'];

const KEYS = {
  customers: ['sms', 'customers'] as const,
  status: ['sms', 'status'] as const,
  balance: ['sms', 'balance'] as const,
  batches: ['sms', 'batches'] as const,
  batch: ['sms', 'batch'] as const,
  settings: ['sms', 'settings'] as const,
};

/** A settlement group's customers with phone, balance and last SMS, all in one read (ADR-0216). */
export function useSettlementSmsCustomers(query: {
  group: SettlementGroup;
  q: string;
  withBalance: boolean;
}) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.customers, query],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/settlement-sms/customers', {
          params: {
            query: {
              group: query.group,
              withBalance: query.withBalance,
              ...(query.q ? { q: query.q } : {}),
            },
          },
          signal,
        }),
      ),
    placeholderData: keepPreviousData,
  });
}

/** Whether a key is saved and sending is on (WeSend is not asked). */
export function useSmsStatus() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.status,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/settlement-sms/status', { signal })),
  });
}

/** WeSend's balance for the send dialog; asked each time the dialog opens. */
export function useSmsBalance(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.balance,
    enabled,
    staleTime: 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/settlement-sms/balance', { signal })),
  });
}

export function useSmsBatches() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: KEYS.batches,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/settlement-sms/batches', {
          params: { query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** One batch with every message; read again every 2 s while it is being sent. */
export function useSmsBatch(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.batch, id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/settlement-sms/batches/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
    refetchInterval: (query) => (query.state.data?.batch.status === 'DONE' ? false : 2000),
  });
}

export function useSmsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    /** One Idempotency-Key per press of «Илгээх», resent unchanged on a retry (ADR-0004). */
    send: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: {
        key: string;
        group: SettlementGroup;
        customerIds: number[];
        template: string;
        onlyWithBalance: boolean;
      }) =>
        unwrap(
          await api.POST('/api/v1/settlement-sms/batches', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () =>
        Promise.all(
          [KEYS.batches, KEYS.customers].map((queryKey) =>
            queryClient.invalidateQueries({ queryKey }),
          ),
        ),
    }),
  };
}

/** «Тохиргоо → SMS»: the key is written, never read back. */
export function useSmsSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/sms/settings', { signal })),
  });
}

export function useSmsSettingsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (body: SmsSettingsUpdate) =>
        unwrap(await api.PATCH('/api/v1/sms/settings', { body })),
      onSuccess: (view) => {
        queryClient.setQueryData(KEYS.settings, view);
        return queryClient.invalidateQueries({ queryKey: KEYS.status });
      },
    }),
    /** WeSend's balance with a typed key, or the saved one; saves nothing, sends nothing. */
    test: useMutation({
      mutationFn: async (apiKey?: string) =>
        unwrap(await api.POST('/api/v1/sms/settings/test', { body: apiKey ? { apiKey } : {} })),
    }),
  };
}
