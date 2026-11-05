import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import type { ReceiptLayout } from '@tugeel/shared/pos';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ReceiptTemplate = Schemas['PosReceiptTemplate'];
type DetailWire = Schemas['PosReceiptTemplateDetail'];
export type ReceiptTemplateCreate = Schemas['PosReceiptTemplateCreate'];

/** A template with its layouts typed (the wire carries them as plain objects, checked on the server). */
export type ReceiptTemplateDetail = Omit<DetailWire, 'layout' | 'draft'> & {
  layout: ReceiptLayout;
  draft: ReceiptLayout | null;
};

const KEYS = {
  all: ['pos', 'receipt-templates'] as const,
  one: (id: number) => ['pos', 'receipt-templates', id] as const,
};

const typed = (wire: DetailWire): ReceiptTemplateDetail => ({
  ...wire,
  layout: wire.layout as unknown as ReceiptLayout,
  draft: (wire.draft ?? null) as unknown as ReceiptLayout | null,
});

/** ADR-0141: the receipt templates, sales' first, each kind's default first. */
export function useReceiptTemplates() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.all,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/pos/receipt-templates', { signal })),
  });
}

export function useReceiptTemplate(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.one(id),
    enabled: Number.isInteger(id) && id > 0,
    queryFn: async ({ signal }) =>
      typed(
        unwrap(
          await api.GET('/api/v1/pos/receipt-templates/{id}', {
            params: { path: { id } },
            signal,
          }),
        ),
      ),
  });
}

export function useReceiptTemplateMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  /** The answer is the whole template: shown at once; the list and the POS' choices refresh. */
  const saved = (wire: DetailWire) => {
    const detail = typed(wire);
    queryClient.setQueryData(KEYS.one(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: KEYS.all, exact: true });
    return detail;
  };
  const path = (id: number) => ({ params: { path: { id } } });
  return {
    create: useMutation({
      mutationFn: async (body: ReceiptTemplateCreate) =>
        saved(unwrap(await api.POST('/api/v1/pos/receipt-templates', { body }))),
    }),
    saveDraft: useMutation({
      mutationFn: async ({
        id,
        name,
        layout,
      }: {
        id: number;
        name: string;
        layout: ReceiptLayout;
      }) =>
        saved(
          unwrap(
            await api.PUT('/api/v1/pos/receipt-templates/{id}/draft', {
              ...path(id),
              body: { name, layout: layout as unknown as Record<string, unknown> },
            }),
          ),
        ),
    }),
    publish: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/pos/receipt-templates/{id}/publish', path(id)))),
    }),
    discard: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/pos/receipt-templates/{id}/discard', path(id)))),
    }),
    makeDefault: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/pos/receipt-templates/{id}/default', path(id)))),
    }),
    restore: useMutation({
      mutationFn: async ({ id, version }: { id: number; version: number }) =>
        saved(
          unwrap(
            await api.POST('/api/v1/pos/receipt-templates/{id}/versions/{version}/restore', {
              params: { path: { id, version } },
            }),
          ),
        ),
    }),
    remove: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/pos/receipt-templates/{id}', path(id))),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all }),
    }),
  };
}
