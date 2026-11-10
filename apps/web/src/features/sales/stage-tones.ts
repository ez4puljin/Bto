import type { StageAction } from '@tugeel/shared/sales';
import { ArrowRightLeft, Ban, Lock, type LucideIcon, PackageOpen, ReceiptText } from 'lucide-react';

/**
 * What a stage's action looks like on the board and in the stage list (ADR-0129 #3, owner
 * 2026-11-10): the columns where stock is held or leaves the warehouse are tinted — the reserving
 * stage (CONFIRM) blue, the selling and transferring ones (SALE, TRANSFER) green —, and every
 * stage with an action carries a small labelled mark whose hint says what arriving there does.
 */
export const STAGE_TONES: Record<
  StageAction,
  { column: string; title: string; mark: string; icon: LucideIcon } | null
> = {
  NONE: null,
  CONFIRM: {
    column: 'border border-primary/40 bg-info-soft',
    title: '',
    mark: 'bg-primary text-primary-foreground',
    icon: Lock,
  },
  PICK: {
    column: '',
    title: '',
    mark: 'bg-warning-soft text-warning',
    icon: PackageOpen,
  },
  SALE: {
    column: 'border border-success/40 bg-success-soft/70',
    title: 'text-success',
    mark: 'bg-success text-primary-foreground',
    icon: ReceiptText,
  },
  TRANSFER: {
    column: 'border border-success/40 bg-success-soft/70',
    title: 'text-success',
    mark: 'bg-success text-primary-foreground',
    icon: ArrowRightLeft,
  },
  CANCEL: {
    column: '',
    title: '',
    mark: 'bg-danger-soft text-destructive',
    icon: Ban,
  },
};

/** The plain column of a stage without a tint. */
export const PLAIN_COLUMN = 'bg-fill/60';
