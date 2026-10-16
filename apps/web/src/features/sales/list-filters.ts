import { ORDER_STATUSES } from '@tugeel/shared/sales';
import { useHiddenColumns } from '@/lib/use-hidden-columns';
import type { OrderStatus } from './api';

/**
 * The list view's own narrowing (ADR-0057 #7) beside the shared filters — scope, stage, status,
 * archive — kept in the URL (ADR-0066), and the list's columns as each user chose them.
 */
export const LIST_SCOPES = ['PIPELINE', 'ALL', 'NONE'] as const;
export type ListScope = (typeof LIST_SCOPES)[number];
export const ARCHIVED_SCOPES = ['exclude', 'include', 'only'] as const;
export type ArchivedScope = (typeof ARCHIVED_SCOPES)[number];

export const LIST_COLUMNS = [
  'number',
  'customer',
  'stage',
  'status',
  'deliveryDate',
  'total',
  'payment',
  'createdBy',
  'channel',
  'createdAt',
] as const;
export type ListColumn = (typeof LIST_COLUMNS)[number];
export const LOCKED_COLUMNS: readonly ListColumn[] = ['number'];
/** What a user who never chose sees hidden, so the list fits a laptop beside the panel (ADR-0066). */
const DEFAULT_HIDDEN: readonly ListColumn[] = ['createdBy', 'channel', 'createdAt'];

export interface ListFilters {
  scope: ListScope;
  stageId?: number;
  status?: OrderStatus;
  archived: ArchivedScope;
}

export const DEFAULT_LIST_FILTERS: ListFilters = { scope: 'PIPELINE', archived: 'exclude' };

/** The URL keys of the list's filters (`stage` is the create dialog's column). */
const KEYS = { scope: 'scope', stageId: 'lstage', status: 'status', archived: 'archive' } as const;

/** The list's filters as the URL keeps them; a value the list does not know is dropped. */
export function readListFilters(params: URLSearchParams): ListFilters {
  const stageId = Number.parseInt(params.get(KEYS.stageId) ?? '', 10);
  const status = ORDER_STATUSES.find((value) => value === params.get(KEYS.status));
  return {
    scope: LIST_SCOPES.find((value) => value === params.get(KEYS.scope)) ?? 'PIPELINE',
    ...(stageId > 0 ? { stageId } : {}),
    ...(status ? { status } : {}),
    archived: ARCHIVED_SCOPES.find((value) => value === params.get(KEYS.archived)) ?? 'exclude',
  };
}

/** The params with the list's filters written in, the defaults left out. */
export function writeListFilters(params: URLSearchParams, filters: ListFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.values(KEYS)) next.delete(key);
  if (filters.scope !== 'PIPELINE') next.set(KEYS.scope, filters.scope);
  if (filters.scope === 'PIPELINE' && filters.stageId) {
    next.set(KEYS.stageId, String(filters.stageId));
  }
  if (filters.status) next.set(KEYS.status, filters.status);
  if (filters.archived !== 'exclude') next.set(KEYS.archived, filters.archived);
  return next;
}

export function listFiltersActive(filters: ListFilters): boolean {
  return (
    filters.scope !== 'PIPELINE' ||
    filters.stageId !== undefined ||
    filters.status !== undefined ||
    filters.archived !== 'exclude'
  );
}

/** Each user's columns of the list, kept in this browser (ADR-0050). */
export function useListColumns() {
  return useHiddenColumns('salesOrders', LIST_COLUMNS, LOCKED_COLUMNS, DEFAULT_HIDDEN);
}

export type ListColumns = ReturnType<typeof useListColumns>;
