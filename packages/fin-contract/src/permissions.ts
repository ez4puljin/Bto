/**
 * The Finance Core's rights (docs/modules/finance-core.md §13, ADR-0075); every check is per company
 * (ADR-0076). Bto's permission catalog (`@tugeel/shared/auth`) lists the same strings once the phase
 * that uses each one grants it.
 */
export const FIN_PERMISSIONS = [
  /** Viewing documents, ledgers, balances and reports. */
  'finance.read',
  /** Vouchers; manual ALLOCATION documents and their reversal. */
  'finance.payments.record',
  /** Bto billing: invoice void, sales return. */
  'finance.invoices.manage',
  /** Manual and opening entries (create, submit). */
  'finance.journal.manage',
  /** Number formats, money accounts. */
  'finance.settings.manage',
  /** Approving a submitted draft. */
  'finance.documents.approve',
  /** Closing a month. */
  'finance.periods.close',
  /** Reopening the latest closed month. */
  'finance.periods.reopen',
  /** Closing over a failed checklist. */
  'finance.periods.override',
  /** Retrying or cancelling an item on the pending list. */
  'finance.intake.replay',
  /** Accounts, posting rules, document types, sources and grants. */
  'finance.config.manage',
  /** Showing a company to the control system. */
  'finance.control.approve',
] as const;
export type FinPermission = (typeof FIN_PERMISSIONS)[number];

export function isFinPermission(value: unknown): value is FinPermission {
  return typeof value === 'string' && (FIN_PERMISSIONS as readonly string[]).includes(value);
}
