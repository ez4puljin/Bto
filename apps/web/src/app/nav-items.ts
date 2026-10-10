import type mn from '@tugeel/shared/i18n/mn.json';
import type { Permission } from '@tugeel/shared/auth';

type NavKey = `nav.${Exclude<keyof (typeof mn)['nav'], 'groups' | 'menu' | 'account'>}`;
type NavGroupKey = `nav.groups.${keyof (typeof mn)['nav']['groups']}`;

export interface NavItem {
  to: string;
  label: NavKey;
  permission?: Permission;
}

export interface NavGroup {
  label: NavGroupKey;
  items: readonly NavItem[];
}

/**
 * Sidebar menu, one group per area. An entry with a permission is shown only to users who hold it
 * (ADR-0027); a group without visible entries is hidden. Catalog pages are readable by every user.
 * Branches and warehouses are readable by every user too (other pages list them), but only people
 * who manage them need the menu entry.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'nav.groups.catalog',
    items: [
      { to: '/catalog/products', label: 'nav.products' },
      { to: '/catalog/categories', label: 'nav.categories' },
      { to: '/catalog/brands', label: 'nav.brands' },
      { to: '/catalog/uoms', label: 'nav.uoms' },
      { to: '/catalog/scan', label: 'nav.scan' },
      { to: '/catalog/ebarimt', label: 'nav.ebarimt', permission: 'catalog.ebarimt.manage' },
    ],
  },
  {
    label: 'nav.groups.system',
    items: [
      { to: '/system/status', label: 'nav.systemStatus' },
      { to: '/users', label: 'nav.users', permission: 'identity.users.read' },
      { to: '/roles', label: 'nav.roles', permission: 'identity.users.read' },
      { to: '/branches', label: 'nav.branches', permission: 'identity.org.manage' },
      { to: '/warehouses', label: 'nav.warehouses', permission: 'identity.org.manage' },
      { to: '/settings', label: 'nav.settings', permission: 'identity.settings.read' },
      { to: '/audit', label: 'nav.audit', permission: 'identity.audit.read' },
    ],
  },
];

/** The groups and entries a user with these permissions sees. */
export function visibleNav(permissions: readonly Permission[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || permissions.includes(item.permission)),
  })).filter((group) => group.items.length > 0);
}
