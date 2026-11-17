import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApiClient, type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type NoteStatus = Schemas['NoteStatus'];
export type NoteReading = Schemas['NoteReading'];
export type NoteReadingSummary = Schemas['NoteReadingSummary'];
export type NoteLine = Schemas['NoteLine'];
export type NoteLineMatch = Schemas['NoteLineMatch'];
export type NoteMemory = Schemas['NoteMemory'];
export type NoteDraftRequest = Schemas['NoteDraftRequest'];
export type NoteScanner = Schemas['NoteScanner'];
export type NoteScannerRequest = Schemas['NoteScannerRequest'];
export type NoteScannerCheck = Schemas['NoteScannerCheck'];
export type ScannedSheet = Schemas['ScannedSheet'];
export type ScanSource = Schemas['NoteScanRequest']['source'];

const KEYS = {
  status: ['receipt-notes', 'status'] as const,
  open: ['receipt-notes', 'open'] as const,
  reading: (id: number) => ['receipt-notes', 'reading', id] as const,
  ofReceipt: (receiptId: number) => ['receipt-notes', 'of-receipt', receiptId] as const,
  scanners: ['receipt-notes', 'scanners'] as const,
};

/** How often a reading still being read is asked for again. */
const POLL_MS = 2_000;

/** Whether the model is still at work on a reading (a stale one has lost its process). */
export const isReading = (reading: Pick<NoteReading, 'status' | 'stale'>) =>
  reading.status === 'READING' && !reading.stale;

/** What «Падаан унших» can offer now: reading (a model is set) and the scanners switched on. */
export function useNoteStatus(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.status,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipt-notes/status', { signal })),
  });
}

/** The readings waiting to be read or checked; asked again while any is being read. */
export function useOpenNoteReadings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.open,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/receipt-notes', { signal })),
    refetchInterval: (query) => ((query.state.data ?? []).some(isReading) ? POLL_MS : false),
  });
}

/** One reading; asked again every two seconds while the model reads it. */
export function useNoteReading(id: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.reading(id),
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipt-notes/{id}', { params: { path: { id } }, signal })),
    refetchInterval: (query) => (query.state.data && isReading(query.state.data) ? POLL_MS : false),
  });
}

/** The reading a receipt was made of, for the receipt window's link to the note's pages. */
export function useReceiptNoteReading(receiptId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.ofReceipt(receiptId),
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/receipt-notes/of-receipt/{receiptId}', {
          params: { path: { receiptId } },
          signal,
        }),
      ),
  });
}

export function useNoteScanners(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.scanners,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipt-notes/scanners', { signal })),
  });
}

type Keyed<T> = T & { key: string };

export function useNoteMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = (reading?: NoteReading) => {
    if (reading) queryClient.setQueryData(KEYS.reading(reading.id), reading);
    return queryClient.invalidateQueries({ queryKey: KEYS.open });
  };
  const scannersChanged = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: KEYS.scanners }),
      queryClient.invalidateQueries({ queryKey: KEYS.status }),
    ]);
  return {
    start: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: Keyed<{ fileIds: number[]; supplierId: number | null }>) =>
        unwrap(
          await api.POST('/api/v1/receipt-notes', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    retry: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/receipt-notes/{id}/retry', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    discard: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/receipt-notes/{id}/discard', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    saveDraft: useMutation({
      mutationFn: async ({ key, id, body }: Keyed<{ id: number; body: NoteDraftRequest }>) =>
        unwrap(
          await api.POST('/api/v1/receipt-notes/{id}/receipt', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (_result, { id }) =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: KEYS.reading(id) }),
          queryClient.invalidateQueries({ queryKey: KEYS.open }),
          queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        ]),
    }),
    scan: useMutation({
      mutationFn: async ({ scannerId, source }: { scannerId: number; source: ScanSource }) =>
        unwrap(
          await api.POST('/api/v1/receipt-notes/scanners/{id}/scan', {
            params: { path: { id: scannerId } },
            body: { source },
          }),
        ),
    }),
    forget: useMutation({
      mutationFn: async (supplierId: number) =>
        unwrap(
          await api.DELETE('/api/v1/receipt-notes/memory/{supplierId}', {
            params: { path: { supplierId } },
          }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['receipt-notes', 'reading'] }),
    }),
    checkScanner: useMutation({
      mutationFn: async (url: string) =>
        unwrap(await api.POST('/api/v1/receipt-notes/scanners/check', { body: { url } })),
    }),
    saveScanner: useMutation({
      mutationFn: async ({ id, body }: { id: number | null; body: NoteScannerRequest }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/receipt-notes/scanners', { body }))
          : unwrap(
              await api.PUT('/api/v1/receipt-notes/scanners/{id}', {
                params: { path: { id } },
                body,
              }),
            ),
      onSuccess: scannersChanged,
    }),
  };
}

/** Opens one page of a reading (a picture or a PDF file) in a new tab. */
export async function openNotePage(api: ApiClient, id: number, fileId: number): Promise<void> {
  const { data } = await api.GET('/api/v1/receipt-notes/{id}/pages/{fileId}', {
    params: { path: { id, fileId } },
    parseAs: 'blob',
  });
  if (!(data instanceof Blob)) throw new Error('the page did not load');
  window.open(URL.createObjectURL(data), '_blank', 'noopener');
}
