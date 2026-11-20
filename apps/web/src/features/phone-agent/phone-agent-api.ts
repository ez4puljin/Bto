import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type PhoneLine = Schemas['PhoneLine'];
export type PhoneLineCreated = Schemas['PhoneLineCreated'];
export type PhoneSchedule = Schemas['PhoneSchedule'];
export type PhoneCall = Schemas['PhoneCall'];
export type PhoneCallMessage = Schemas['PhoneCallMessage'];
export type PhoneCallOutcome = NonNullable<PhoneCall['outcome']>;
export type PhoneNoHitSearch = Schemas['PhoneNoHitSearch'];

const KEYS = {
  lines: ['phone-agent', 'lines'] as const,
  calls: ['phone-agent', 'calls'] as const,
  noHits: ['phone-agent', 'no-hits'] as const,
};

/** The phone lines, asked again every half minute for their «online». */
export function usePhoneLines() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.lines,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/phone-lines', { signal })),
    refetchInterval: 30_000,
  });
}

/**
 * The install line of the Windows call bridge (`tools/call-bridge/windows/install.ps1`, ADR-0232):
 * pasted into an administrator PowerShell on the PC beside the phone.
 */
export function callBridgeInstallLine(server: string, key: string): string {
  return `powershell -ExecutionPolicy Bypass -File install.ps1 -Server ${server} -Key ${key}`;
}

export function usePhoneLineMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: KEYS.lines });
  return {
    create: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: { key: string } & Schemas['PhoneLineCreateRequestDto']) =>
        unwrap(
          await api.POST('/api/v1/phone-lines', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: { id: number } & Schemas['PhoneLineUpdateRequestDto']) =>
        unwrap(await api.PUT('/api/v1/phone-lines/{id}', { params: { path: { id } }, body })),
      onSuccess: changed,
    }),
    newKey: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/phone-lines/{id}/key', {
            params: { path: { id }, header: idempotencyKey(crypto.randomUUID()) },
          }),
        ),
      onSuccess: changed,
    }),
  };
}

/** Newest first; the api filters by outcome and answered, the page narrows by date and order. */
export function usePhoneCalls(filters: { outcome?: PhoneCallOutcome | undefined }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.calls, 'list', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/phone-calls', {
          params: { query: { cursor: pageParam, limit: 50, outcome: filters.outcome } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function usePhoneCall(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.calls, 'one', id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/phone-calls/{id}', { params: { path: { id } }, signal })),
  });
}

export function usePhoneNoHits() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: KEYS.noHits,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/phone-searches/no-hits', {
          params: { query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** The callback task a call left, if any: the api lists one status at a time, so all three are asked. */
export function usePhoneCallbackOf(callId: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.calls, 'callback', callId],
    enabled,
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        (['OPEN', 'DONE', 'DROPPED'] as const).map(async (status) =>
          unwrap(
            await api.GET('/api/v1/phone-callbacks', {
              params: { query: { status, limit: 100 } },
              signal,
            }),
          ),
        ),
      );
      return pages.flatMap((page) => page.data).find((item) => item.callId === callId) ?? null;
    },
  });
}
