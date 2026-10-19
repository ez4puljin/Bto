import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useTranslation } from 'react-i18next';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Company = Schemas['Company'];
export type CompanyUpdate = Schemas['CompanyUpdateRequest'];

const KEY = ['company'] as const;

/** The installation's Finance Core company (ADR-0084): every staff member may read it. */
export function useCompany() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEY,
    // It changes only on «Компани», which refreshes it; print pages reuse the cached copy.
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/company', { signal })),
  });
}

/** The legal name for document headers; the brand name until the company has loaded. */
export function useCompanyName(): string {
  const { t } = useTranslation();
  return useCompany().data?.legalName ?? t('brand.company');
}

export function useUpdateCompany() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CompanyUpdate) => unwrap(await api.PATCH('/api/v1/company', { body })),
    onSuccess: (company) => queryClient.setQueryData(KEY, company),
  });
}
