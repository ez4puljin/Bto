import { colors } from '../theme/tokens';

/** A transfer's (and a request's) status, in the order it moves (ADR-0116). */
export const TRANSFER_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'SHIPPED',
  'COUNTED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Where a status stands on the way: DRAFT 0 … RECEIVED 4; CANCELLED stands apart (5). */
export function rankOf(status: TransferStatus): number {
  return TRANSFER_STATUSES.indexOf(status);
}

/** The word of a status on screen (`inventory.docStatus.<STATUS>` in mn.json). */
export function statusKey(status: TransferStatus): `inventory.docStatus.${TransferStatus}` {
  return `inventory.docStatus.${status}`;
}

/** The home's chips: all, waiting (DRAFT + REQUESTED), on the way, counted, received. */
export const HOME_FILTERS = ['ALL', 'PENDING', 'SHIPPED', 'COUNTED', 'RECEIVED'] as const;
export type HomeFilter = (typeof HOME_FILTERS)[number];

/** The statuses a home chip shows; `null` for every one. */
export function statusesOf(filter: HomeFilter): readonly TransferStatus[] | null {
  switch (filter) {
    case 'ALL':
      return null;
    case 'PENDING':
      return ['DRAFT', 'REQUESTED'];
    case 'SHIPPED':
      return ['SHIPPED'];
    case 'COUNTED':
      return ['COUNTED'];
    case 'RECEIVED':
      return ['RECEIVED'];
  }
}

/** The one status a chip can ask the server for; null when it means several (filtered here). */
export function serverStatusOf(filter: HomeFilter): TransferStatus | null {
  const statuses = statusesOf(filter);
  return statuses && statuses.length === 1 ? (statuses[0] ?? null) : null;
}

export function matchesFilter(status: TransferStatus, filter: HomeFilter): boolean {
  const statuses = statusesOf(filter);
  return statuses === null || statuses.includes(status);
}

/** A status pill's colours, by token: grey, blue, violet, orange, green, red. */
export function statusTone(status: TransferStatus): { background: string; text: string } {
  switch (status) {
    case 'DRAFT':
      return { background: colors.canvas, text: colors.muted };
    case 'REQUESTED':
      return { background: colors.secondary, text: colors.secondaryForeground };
    case 'SHIPPED':
      return { background: colors.violetSoft, text: colors.violet };
    case 'COUNTED':
      return { background: colors.warningSoft, text: colors.warning };
    case 'RECEIVED':
      return { background: colors.successSoft, text: colors.success };
    case 'CANCELLED':
      return { background: colors.destructiveSoft, text: colors.cancelled };
  }
}
