import type { Permission } from '@tugeel/shared/auth';

type NavKey =
  | 'nav.systemStatus'
  | 'nav.users'
  | 'nav.roles'
  | 'nav.branches'
  | 'nav.warehouses'
  | 'nav.settings'
  | 'nav.audit';

/** Menu entries; an entry with a permission is shown only to users who hold it (ADR-0027). */
export const NAV_ITEMS: readonly { to: string; label: NavKey; permission?: Permission }[] = [
  { to: '/system/status', label: 'nav.systemStatus' },
];
