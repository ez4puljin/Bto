import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import type {
  DocumentLayout,
  DocumentTemplateKind,
  PublishedDocumentTemplate,
} from '@tugeel/shared/sales';
import { documentLayoutFor } from '@tugeel/shared/sales';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type DocumentTemplate = Schemas['SalesDocumentTemplate'];
type DetailWire = Schemas['SalesDocumentTemplateDetail'];
export type DocumentTemplateCreate = Schemas['SalesDocumentTemplateCreate'];

/** A template with its layouts typed (the wire carries them as plain objects, checked on the server). */
export type DocumentTemplateDetail = Omit<DetailWire, 'layout' | 'draft'> & {
  layout: DocumentLayout;
  draft: DocumentLayout | null;
};

const KEYS = {
  all: ['sales', 'document-templates'] as const,
  one: (id: number) => ['sales', 'document-templates', id] as const,
  print: (ids: readonly number[]) => ['sales', 'document-templates', 'print', ids] as const,
};

const typed = (wire: DetailWire): DocumentTemplateDetail => ({
  ...wire,
  layout: wire.layout as unknown as DocumentLayout,
  draft: (wire.draft ?? null) as unknown as DocumentLayout | null,
});

/** ADR-0143: the wholesale documents' templates, the pick lists' first, each kind's default first. */
export function useDocumentTemplates(options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.all,
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/sales/document-templates', { signal })),
  });
}

export function useDocumentTemplate(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.one(id),
    enabled: Number.isInteger(id) && id > 0,
    queryFn: async ({ signal }) =>
      typed(
        unwrap(
          await api.GET('/api/v1/sales/document-templates/{id}', {
            params: { path: { id } },
            signal,
          }),
        ),
      ),
  });
}

/**
 * The layouts these orders print with (ADR-0143): each order's pipeline's choice, else the
 * kind's default; null (the built-in layout) while they load or on an older server.
 */
export function useDocumentLayouts(pipelineIds: readonly (number | null)[]) {
  const api = useApiClient();
  const ids = [...new Set(pipelineIds.filter((id): id is number => id !== null))].sort(
    (a, b) => a - b,
  );
  const query = useQuery({
    queryKey: KEYS.print(ids),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales/document-templates/print-layouts', {
          params: { query: { pipelineIds: ids.join(',') } },
          signal,
        }),
      ),
  });
  const templates = (query.data?.templates ?? []) as unknown as PublishedDocumentTemplate[];
  const layoutOf = (
    kind: DocumentTemplateKind,
    pipelineId: number | null,
  ): DocumentLayout | null => {
    const choice = query.data?.pipelines.find((entry) => entry.id === pipelineId);
    return documentLayoutFor(
      templates,
      kind,
      kind === 'PICK_LIST' ? choice?.pickListTemplateId : choice?.deliveryNoteTemplateId,
    );
  };
  return { isPending: query.isPending && !query.isError, layoutOf };
}

export function useDocumentTemplateMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const saved = (wire: DetailWire) => {
    const detail = typed(wire);
    queryClient.setQueryData(KEYS.one(detail.id), detail);
    void queryClient.invalidateQueries({ queryKey: KEYS.all, exact: true });
    return detail;
  };
  const path = (id: number) => ({ params: { path: { id } } });
  return {
    create: useMutation({
      mutationFn: async (body: DocumentTemplateCreate) =>
        saved(unwrap(await api.POST('/api/v1/sales/document-templates', { body }))),
    }),
    saveDraft: useMutation({
      mutationFn: async (input: { id: number; name: string; layout: DocumentLayout }) =>
        saved(
          unwrap(
            await api.PUT('/api/v1/sales/document-templates/{id}/draft', {
              ...path(input.id),
              body: {
                name: input.name,
                layout: input.layout as unknown as Record<string, unknown>,
              },
            }),
          ),
        ),
    }),
    publish: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/sales/document-templates/{id}/publish', path(id)))),
    }),
    discard: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/sales/document-templates/{id}/discard', path(id)))),
    }),
    makeDefault: useMutation({
      mutationFn: async (id: number) =>
        saved(unwrap(await api.POST('/api/v1/sales/document-templates/{id}/default', path(id)))),
    }),
    restore: useMutation({
      mutationFn: async ({ id, version }: { id: number; version: number }) =>
        saved(
          unwrap(
            await api.POST('/api/v1/sales/document-templates/{id}/versions/{version}/restore', {
              params: { path: { id, version } },
            }),
          ),
        ),
    }),
    remove: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/sales/document-templates/{id}', path(id))),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.all }),
    }),
  };
}
