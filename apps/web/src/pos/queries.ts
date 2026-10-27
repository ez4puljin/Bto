import { QueryClient, keepPreviousData, useQuery } from '@tanstack/react-query';
import type { EdgeCartLine } from '@tugeel/shared/pos';
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
  quickButtons: (epoch: number) => ['kiosk', epoch, 'quick-buttons'] as const,
  supervisors: (epoch: number) => ['kiosk', epoch, 'supervisors'] as const,
  parked: (epoch: number) => ['kiosk', epoch, 'parked'] as const,
  ebarimt: (epoch: number) => ['kiosk', epoch, 'ebarimt'] as const,
  search: (epoch: number, q: string) => ['kiosk', epoch, 'search', q] as const,
  quote: (epoch: number, lines: readonly EdgeCartLine[], codes: readonly string[] = []) =>
    [
      'kiosk',
      epoch,
      'quote',
      lines.map((line) => `${line.productUnitId}:${line.qty}`),
      [...codes],
    ] as const,
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

export function useRecentSales(enabled: boolean) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.recent(epoch),
    queryFn: ({ signal }) => client.recentSales(signal),
    enabled,
    staleTime: 0,
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
/** The cart's quote, with the coupons and partner vouchers taken (ADR-0110). */
export function useQuote(lines: readonly EdgeCartLine[], codes: readonly string[] = []) {
  const { client } = useKiosk();
  const { epoch } = useCredentials();
  return useQuery({
    queryKey: kioskKeys.quote(epoch, lines, codes),
    queryFn: ({ signal }) =>
      client.quote({ lines: [...lines], ...(codes.length ? { codes: [...codes] } : {}) }, signal),
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
