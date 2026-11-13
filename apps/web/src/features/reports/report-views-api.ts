import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { ReportViewPage } from '@tugeel/shared/reports';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ReportView = Schemas['ReportView'];
export type ReportViewCreate = Schemas['ReportViewCreateRequest'];
export type ReportViewUpdate = Schemas['ReportViewUpdateRequest'];

const viewsKey = (page: ReportViewPage) => ['reports', 'views', page] as const;

/** A page's saved views (ADR-0194): the caller's own first, then the shared ones. */
export function useReportViews(page: ReportViewPage) {
  const api = useApiClient();
  return useQuery({
    queryKey: viewsKey(page),
    queryFn: async (): Promise<ReportView[]> =>
      unwrap(await api.GET('/api/v1/reports/views', { params: { query: { page } } })).data,
    staleTime: 60_000,
  });
}

export function useReportViewMutations(page: ReportViewPage) {
  const api = useApiClient();
  const client = useQueryClient();
  const onSuccess = () => client.invalidateQueries({ queryKey: viewsKey(page) });
  return {
    create: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: Omit<ReportViewCreate, 'page'> & { key: string }): Promise<ReportView> =>
        unwrap(
          await api.POST('/api/v1/reports/views', {
            params: { header: idempotencyKey(key) },
            body: { page, ...body },
          }),
        ),
      onSuccess,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: ReportViewUpdate & { id: number }): Promise<ReportView> =>
        unwrap(await api.PATCH('/api/v1/reports/views/{id}', { params: { path: { id } }, body })),
      onSuccess,
    }),
    remove: useMutation({
      mutationFn: async (id: number): Promise<void> => {
        unwrap(await api.DELETE('/api/v1/reports/views/{id}', { params: { path: { id } } }));
      },
      onSuccess,
    }),
  };
}
