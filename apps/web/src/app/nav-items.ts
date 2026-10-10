import type { Permission } from '@tugeel/shared/auth';

type NavKey =
  | 'nav.systemStatus'
  | 'nav.users'
  | 'nav.roles'
  | 'nav.branches'
  | 'nav.warehouses'
  | 'nav.settings'
  | 'nav.audit';

/**
 * Menu entries; an entry with a permission is shown only to users who hold it (ADR-0027).
 * Branches and warehouses are readable by every user (other pages list them), but only
 * people who manage them need the menu entry.
 */
export const NAV_ITEMS: readonly { to: string; label: NavKey; permission?: Permission }[] = [
  { to: '/system/status', label: 'nav.systemStatus' },
  { to: '/users', label: 'nav.users', permission: 'identity.users.read' },
  { to: '/roles', label: 'nav.roles', permission: 'identity.users.read' },
  { to: '/branches', label: 'nav.branches', permission: 'identity.org.manage' },
  { to: '/warehouses', label: 'nav.warehouses', permission: 'identity.org.manage' },
  { to: '/settings', label: 'nav.settings', permission: 'identity.settings.read' },
  { to: '/audit', label: 'nav.audit', permission: 'identity.audit.read' },
];
