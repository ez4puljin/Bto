import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type PrintStation = Schemas['PrintStation'];
export type PrintStationCreated = Schemas['PrintStationCreated'];
export type PrintStationCreateRequest = Schemas['PrintStationCreateRequest'];
export type PrintStationUpdateRequest = Schemas['PrintStationUpdateRequest'];
export type PrintJob = Schemas['PrintJob'];

const KEYS = { stations: ['printing', 'stations'] as const };

/** The office's printers (ADR-0226), asked again every half minute for their «online». */
export function usePrintStations() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.stations,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/printing/stations', { signal })),
    refetchInterval: 30_000,
  });
}

/**
 * The install line of a print bridge (`tools/print-bridge/install.ps1`) for this server and key:
 * pasted into an administrator PowerShell on the printer's PC.
 */
export function bridgeInstallLine(server: string, key: string): string {
  return (
    "[Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm " +
    'https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/print-bridge/install.ps1))) ' +
    `-Server '${server}' -Key '${key}'`
  );
}

/** How long «Туршилтын шошго» waits for the printer's answer before it stops asking. */
const TEST_WAIT_MS = 20_000;

export function usePrintMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: KEYS.stations });
  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: PrintStationCreateRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/printing/stations', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: PrintStationUpdateRequest & { id: number }) =>
        unwrap(await api.PUT('/api/v1/printing/stations/{id}', { params: { path: { id } }, body })),
      onSuccess: changed,
    }),
    newKey: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/printing/stations/{id}/key', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    /** Prints one sample label and waits up to 20 s for how it went. */
    test: useMutation({
      mutationFn: async (id: number): Promise<PrintJob> => {
        let job = unwrap(
          await api.POST('/api/v1/printing/stations/{id}/test', {
            params: { path: { id }, header: idempotencyKey(crypto.randomUUID()) },
          }),
        );
        const until = Date.now() + TEST_WAIT_MS;
        while ((job.status === 'queued' || job.status === 'printing') && Date.now() < until) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          job = unwrap(
            await api.GET('/api/v1/print-jobs/{id}', { params: { path: { id: job.id } } }),
          );
        }
        return job;
      },
      onSettled: changed,
    }),
  };
}
