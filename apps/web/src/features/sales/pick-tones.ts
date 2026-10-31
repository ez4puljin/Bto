import type { PickStatus } from '@tugeel/shared/sales';

/**
 * The warehouses' parts of the picking (ADR-0126 #2), one tone per state so a keeper reads the
 * board and the order at a glance: not started grey, being picked orange, picked green.
 */
export const PICK_TONES = {
  OPEN: { dot: 'bg-muted-foreground/40', text: 'text-muted-foreground', row: '' },
  PICKING: { dot: 'bg-warning', text: 'text-warning', row: 'bg-warning-soft/60' },
  DONE: { dot: 'bg-success', text: 'text-success', row: 'bg-success-soft/60' },
} as const satisfies Record<PickStatus, { dot: string; text: string; row: string }>;
