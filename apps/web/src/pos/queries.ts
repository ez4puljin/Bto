import {
  QueryClient,
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { EdgeCartLine, EdgeDayCountRequest } from '@tugeel/shared/pos';
import { EdgeError } from './edge-client';
import { useCredentials, useKiosk } from './kiosk-context';

/** How often the header asks the edge whether the centre is reachable. */
export const HEALTH_POLL_MS = 10_000;

/** Refusals (4xx) are answers, not hiccups: only a network failure or a 5xx is tried again. */
export function createKioskQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (failures, error) =>
          failures < 1 &&
          !(
            error instanceof EdgeError &&
            error.problem.status >= 400 &&
            error.problem.status < 500
          ),
        refetchOnWindowFocus: false,
        staleTime: 5_000,
      },
      mutations: { retry: false },
    },
  });
}

export const kioskKeys = {
  all: ['kiosk'] as const,
  health: ['kiosk', 'health'] as const,
  device: (epoch: number) => ['kiosk', epoch, 'device'] as const,
  session: (epoch: number) => ['kiosk', epoch, 'session'] as const,
  recent: (epoch: number) => ['kiosk', epoch, 'recent'] as const,
  /** Below `recent`: a sale or a return refreshes every day's history with it. */
  history: (epoch: number, day: string, q: string) =>
    ['kiosk', epoch, 'recent', 'history', day, q] as const,
  daySummary: (epoch: number, day: string) => ['kiosk', epoch, 'day-summary', day] as const,
  quickButtons: (epoch: number) => ['kiosk', epoch, 'quick-buttons'] as const,
  supervisors: (epoch: number) => ['kiosk', epoch, 'supervisors'] as const,
  parked: (epoch: number) => ['kiosk', epoch, 'parked'] as const,
  ebarimt: (epoch: number) => ['kiosk', epoch, 'ebarimt'] as const,
  search: (epoch: number, q: string) => ['kiosk', epoch, 'search', q] as const,
  quote: (epoch: number, lines: readonly EdgeCartLine[]) =>
    ['kiosk', epoch, 'quote', lines.map((line) => `${line.productUnitId}:${line.qty}`)] as const,
};

export function useHealth() {
  const { client } = useKiosk();
  return useQuery({
    queryKey: kioskKeys.health,
    queryFn: ({ signal }) => client.health(signal),
    refetchInterval: HEALTH_POLL_MS,
    retry: false,
    staleTime: 0,
  });
}

export function useDevice() {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.device(epoch),
    queryFn: ({ signal }) => client.device(signal),
  });
}

export function useSession() {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.session(epoch),
    queryFn: ({ signal }) => client.session(signal),
    staleTime: 0,
  });
}

/** «Борлуулалтын түүх» (ADR-0111): the till's sales and returns of `day`, narrowed by number. */
export function useSalesHistory(day: string, q: string) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.history(epoch, day, q),
    queryFn: ({ signal }) => client.sales(day, q || undefined, signal),
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** «Өдрийн нэгтгэл» (ADR-0111): the till's money of `day` by payment type and its count. */
export function useDaySummary(day: string) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.daySummary(epoch, day),
    queryFn: ({ signal }) => client.daySummary(day, signal),
    staleTime: 0,
  });
}

/** Records the banknotes handed over; the edge's answer replaces the day's summary. */
export function useCountDay() {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: EdgeDayCountRequest) => client.countDay(body),
    onSuccess: (summary) =>
      queryClient.setQueryData(kioskKeys.daySummary(epoch, summary.day), summary),
  });
}

export function useProductSearch(q: string) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.search(epoch, q),
    queryFn: ({ signal }) => client.searchProducts(q, signal),
    enabled: q.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** The edge's prices for the cart, asked again on every change; the screen never computes them. */
export function useQuote(lines: readonly EdgeCartLine[]) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.quote(epoch, lines),
    queryFn: ({ signal }) => client.quote({ lines: [...lines] }, signal),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 0,
  });
}

/** The F7 panel's groups with today's prices (ADR-0104). */
export function useQuickButtons(enabled: boolean) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.quickButtons(epoch),
    queryFn: ({ signal }) => client.quickButtons(signal),
    enabled,
    staleTime: 30_000,
  });
}

export function useSupervisors(enabled: boolean) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.supervisors(epoch),
    queryFn: ({ signal }) => client.supervisors(signal),
    enabled,
    staleTime: 30_000,
  });
}

/** This till's parked baskets (ADR-0104). */
export function useParked() {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.parked(epoch),
    queryFn: ({ signal }) => client.parked(signal),
    staleTime: 0,
  });
}

/** The store PosAPI's receipts that wait, failed or need checking, and PosAPI's facts (ADR-0065). */
export function useEbarimtQueue(enabled: boolean) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.ebarimt(epoch),
    queryFn: ({ signal }) => client.ebarimtQueue(signal),
    enabled,
    staleTime: 0,
    refetchInterval: enabled ? HEALTH_POLL_MS : false,
  });
}
