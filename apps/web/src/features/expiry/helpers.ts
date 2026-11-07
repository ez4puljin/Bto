import { isSystemRole } from '@tugeel/shared/auth';
import {
  EXPIRY_LIABILITY_TYPES,
  EXPIRY_QTY_PATTERN,
  EXPIRY_VIEWS,
  type ExpiryLiabilityType,
  type ExpiryUrgency,
  type ExpiryView,
  isExpiryDateInRange,
} from '@tugeel/shared/expiry';
import { Decimal } from '@tugeel/shared/money';
import { isIsoDate } from '@tugeel/shared/time';
import type { TFunction } from 'i18next';
import type { ValidationMessage } from '@/lib/forms';
import type { ExpiryLiability, ExpirySummary } from './api';

/** What the URL keeps of the list (`?view=&q=&supplier=&warehouse=&author=&liability=`). */
export interface ExpiryFilter {
  view: ExpiryView;
  q: string;
  supplierId: number | undefined;
  warehouseId: number | undefined;
  createdByName: string | undefined;
  liability: ExpiryLiabilityType | undefined;
}

export const positiveId = (value: string | null): number | null => {
  const parsed = Number.parseInt(value ?? '', 10);
  return parsed > 0 ? parsed : null;
};

export function parseExpiryFilter(params: URLSearchParams): ExpiryFilter {
  const view = params.get('view');
  const liability = params.get('liability');
  return {
    view: EXPIRY_VIEWS.find((value) => value === view) ?? 'ACTIVE',
    q: params.get('q') ?? '',
    supplierId: positiveId(params.get('supplier')) ?? undefined,
    warehouseId: positiveId(params.get('warehouse')) ?? undefined,
    createdByName: params.get('author') || undefined,
    liability: EXPIRY_LIABILITY_TYPES.find((value) => value === liability),
  };
}

/** The filters beside the view: with one of them on, the summary's count no longer applies. */
export function isNarrowed(filter: ExpiryFilter): boolean {
  return Boolean(
    filter.q ||
    filter.supplierId !== undefined ||
    filter.warehouseId !== undefined ||
    filter.createdByName ||
    filter.liability,
  );
}

/** The print page of what the filters show, on an A4 sheet whatever this computer last chose. */
export function expiryPrintHref(filter: ExpiryFilter): string {
  const query = new URLSearchParams({ format: 'a4' });
  if (filter.view !== 'ACTIVE') query.set('view', filter.view);
  if (filter.q) query.set('q', filter.q);
  if (filter.supplierId !== undefined) query.set('supplier', String(filter.supplierId));
  if (filter.warehouseId !== undefined) query.set('warehouse', String(filter.warehouseId));
  if (filter.createdByName) query.set('author', filter.createdByName);
  if (filter.liability) query.set('liability', filter.liability);
  return `/inventory/expiry/print?${query.toString()}`;
}

/** A list address with a record's panel open: a create dialog gives way to it. */
export function expiryRecordParams(params: URLSearchParams, id: number): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete('new');
  next.set('item', String(id));
  return next;
}

/** How many records a view holds, as the summary counts them. */
export function viewCount(summary: ExpirySummary, view: ExpiryView): number {
  switch (view) {
    case 'ACTIVE':
      return summary.active;
    case 'EXPIRED':
      return summary.expired;
    case 'URGENT':
      return summary.urgent;
    case 'SOON':
      return summary.soon;
    case 'ARCHIVED':
      return summary.archived;
    default:
      return summary.byStatus[view];
  }
}

export function daysText(t: TFunction, daysLeft: number): string {
  if (daysLeft < 0) return t('expiry.days.past', { n: -daysLeft });
  return daysLeft === 0 ? t('expiry.days.today') : t('expiry.days.left', { n: daysLeft });
}

/** How many names a list's cell shows before «+n». */
const SHORT_NAMES = 2;

/** The liable roles and people, all of them, as text (`RoleName` is the same for JSX). */
export function liabilityNames(t: TFunction, liability: ExpiryLiability): string[] {
  return [
    ...liability.roles.map((role) =>
      role.code && isSystemRole(role.code)
        ? t(`roles.system.${role.code}`)
        : (role.name ?? role.code ?? ''),
    ),
    ...liability.users.map((user) => user.fullName),
  ];
}

/** Who is liable in a few words: the type, or two names and how many more. */
export function liabilityShort(t: TFunction, liability: ExpiryLiability): string {
  if (liability.type !== 'SPECIFIC') return t(`expiry.liabilityType.${liability.type}`);
  const names = liabilityNames(t, liability);
  if (names.length === 0) return t('expiry.liability.unset');
  if (names.length <= SHORT_NAMES) return names.join(', ');
  return t('expiry.liability.more', {
    names: names.slice(0, SHORT_NAMES).join(', '),
    n: names.length - SHORT_NAMES,
  });
}

/** «Үлдсэн» by urgency, as the old page coloured it. */
export const URGENCY_TEXT: Record<ExpiryUrgency, string> = {
  EXPIRED: 'font-semibold text-destructive',
  URGENT: 'font-medium text-destructive',
  SOON: 'font-medium text-warning',
  OK: 'text-muted-foreground',
};

/** A row's ground by urgency, as the old page tinted expired and soon rows. */
export const URGENCY_ROW: Record<ExpiryUrgency, string | undefined> = {
  EXPIRED: 'bg-danger-soft/50',
  URGENT: 'bg-warning-soft/50',
  SOON: 'bg-warning-soft/50',
  OK: undefined,
};

/** A quantity field left empty counts as zero, as the old page's did. */
export const plainQty = (value: string): string => value.trim() || '0';

export const isQty = (value: string): boolean => EXPIRY_QTY_PATTERN.test(plainQty(value));

export const isZeroQty = (value: string): boolean => new Decimal(plainQty(value)).isZero();

/** Equal as quantities («12» and «12.0»); text that is no quantity yet compares as text. */
export function sameQty(left: string, right: string): boolean {
  return isQty(left) && isQty(right)
    ? new Decimal(plainQty(left)).eq(plainQty(right))
    : left.trim() === right.trim();
}

/** The fields of a record people correct, as the form holds them. */
export interface RecordDraft {
  expiryDate: string;
  qtyFloor: string;
  qtyWarehouse: string;
  note: string;
}

const sameField: { [K in keyof RecordDraft]: (left: string, right: string) => boolean } = {
  expiryDate: (left, right) => left === right,
  qtyFloor: sameQty,
  qtyWarehouse: sameQty,
  note: (left, right) => left.trim() === right.trim(),
};

const FIELDS = ['expiryDate', 'qtyFloor', 'qtyWarehouse', 'note'] as const;

export const isSameDraft = (left: RecordDraft, right: RecordDraft): boolean =>
  FIELDS.every((field) => sameField[field](left[field], right[field]));

/** What the save sends: only the fields that differ from what the form stands on, cleaned. */
export function changedFields(draft: RecordDraft, read: RecordDraft): Partial<RecordDraft> {
  return {
    ...(sameField.expiryDate(draft.expiryDate, read.expiryDate)
      ? {}
      : { expiryDate: draft.expiryDate }),
    ...(sameQty(draft.qtyFloor, read.qtyFloor) ? {} : { qtyFloor: plainQty(draft.qtyFloor) }),
    ...(sameQty(draft.qtyWarehouse, read.qtyWarehouse)
      ? {}
      : { qtyWarehouse: plainQty(draft.qtyWarehouse) }),
    ...(sameField.note(draft.note, read.note) ? {} : { note: draft.note.trim() }),
  };
}

/**
 * After a refused save (ADR-0172 #6): what the person typed stays, every field they left alone
 * takes the value that now stands.
 */
export function keepTyped(draft: RecordDraft, read: RecordDraft, latest: RecordDraft): RecordDraft {
  const pick = (field: keyof RecordDraft) =>
    sameField[field](draft[field], read[field]) ? latest[field] : draft[field];
  return {
    expiryDate: pick('expiryDate'),
    qtyFloor: pick('qtyFloor'),
    qtyWarehouse: pick('qtyWarehouse'),
    note: pick('note'),
  };
}

export type DraftProblems = Partial<Record<keyof RecordDraft, ValidationMessage>>;

/**
 * The form's own check before a correction. A record carried from the old system may lie outside
 * the rules (ADR-0172 #12), so the date range is checked only on a date that changes, as the server
 * does; `today` is the server's and absent until the summary arrives.
 */
export function draftProblems(
  draft: RecordDraft,
  read: RecordDraft,
  today: string | undefined,
): DraftProblems {
  const problems: DraftProblems = {};
  if (!isIsoDate(draft.expiryDate)) problems.expiryDate = 'validation.date';
  else if (
    today &&
    draft.expiryDate !== read.expiryDate &&
    !isExpiryDateInRange(draft.expiryDate, today)
  ) {
    problems.expiryDate = 'validation.expiryDateRange';
  }
  if (!isQty(draft.qtyFloor)) problems.qtyFloor = 'validation.expiryQty';
  if (!isQty(draft.qtyWarehouse)) problems.qtyWarehouse = 'validation.expiryQty';
  return problems;
}
