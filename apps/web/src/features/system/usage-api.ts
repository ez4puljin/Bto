import { useQuery } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { addDays, businessDate } from '@tugeel/shared/time';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

export type ScreenUsageRow = components['schemas']['ScreenUsageRow'];

/** The periods the page offers, in days back from today. */
export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

export function usagePeriodOf(value: string | null): UsagePeriod {
  const days = Number(value);
  return (USAGE_PERIODS as readonly number[]).includes(days) ? (days as UsagePeriod) : 30;
}

/** GET /api/v1/usage/screens for the last `days` days, today included (ADR-0197). */
export function useScreenUsage(days: UsagePeriod) {
  const api = useApiClient();
  const to = businessDate();
  const from = addDays(to, 1 - days);
  return useQuery({
    queryKey: ['system', 'usage', from, to],
    queryFn: async ({ signal }): Promise<ScreenUsageRow[]> =>
      unwrap(await api.GET('/api/v1/usage/screens', { params: { query: { from, to } }, signal }))
        .data,
    staleTime: 60_000,
  });
}
