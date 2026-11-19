import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// «Асуудалтай бараа» (ADR-0230): today's open sheets of my warehouses, and a line's counted
// quantity. A quantity may be sent again until the office approves the sheet.

type Schemas = components['schemas'];
export type StockProblemSheet = Schemas['StockProblemSheetDetailDto'];
export type StockProblemLine = Schemas['StockProblemSheetLineDto'];

const SHEETS = ['stock-problems', 'mine'] as const;

/** Today's open sheets of the warehouses this person counts, with their lines in shelf order. */
export function useMySheets() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: SHEETS,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/stock-problems/sheets/mine')),
  });
}

/** One line's counted quantity; the key is the line form's, so a retried save is answered once. */
export function useCountLine() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; lineId: number; countedQty: string }) =>
      unwrap(
        await session.client.POST('/api/v1/stock-problems/sheet-lines/{id}/count', {
          params: { path: { id: input.lineId }, header: { 'Idempotency-Key': input.key } },
          body: { countedQty: input.countedQty },
        }),
      ),
    onSuccess: (line) =>
      queryClient.setQueryData<StockProblemSheet[]>(SHEETS, (sheets) =>
        sheets?.map((sheet) => {
          if (sheet.id !== line.sheetId) return sheet;
          const lines = sheet.lines.map((one) => (one.id === line.id ? line : one));
          return {
            ...sheet,
            lines,
            countedCount: lines.filter((one) => one.countedQty !== null).length,
          };
        }),
      ),
    // A sheet approved meanwhile: the list is read again and drops it.
    onError: () => void queryClient.invalidateQueries({ queryKey: SHEETS }),
  });
}
