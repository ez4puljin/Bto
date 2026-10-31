import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { KEYS as SEGMENT_KEYS } from '@/features/segments/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type AppSettings = Schemas['AppSettings'];
export type AppSettingsRequest = Schemas['AppSettingsRequest'];
export type AppHomeSections = Schemas['AppHomeSections'];

/** The home's sections in the order the app shows them (the fixed order, ADR-0092 #2). */
export const HOME_SECTIONS = [
  'PROMOTIONS',
  'DISCOUNTS',
  'NEW',
] as const satisfies readonly (keyof AppHomeSections)[];

export const APP_SETTINGS_KEY = ['app-settings'] as const;

/** The two apps' settings (ADR-0127): one row, read by the home's keepers and the settings' readers. */
export function useAppSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: APP_SETTINGS_KEY,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/app-settings', { signal })),
  });
}

/** The row's request part: what PUT takes back (every save sends the whole row). */
export function requestOf(settings: AppSettings): AppSettingsRequest {
  return {
    assortmentSegmentId: settings.assortmentSegmentId,
    homeSections: settings.homeSections,
    minOrderAmount: settings.minOrderAmount,
    appName: settings.appName,
    appColor: settings.appColor,
  };
}

/**
 * Saves the whole row; the answer replaces the cached settings. The assortment changes what the
 * segments page shows beside a segment, so the segments are refreshed too.
 */
export function useSaveAppSettings() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AppSettingsRequest) =>
      unwrap(await api.PUT('/api/v1/app-settings', { body })),
    onSuccess: (saved) => {
      queryClient.setQueryData(APP_SETTINGS_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: SEGMENT_KEYS.segments });
    },
  });
}
