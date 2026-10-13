import type mn from '@tugeel/shared/i18n/mn.json';
import type { Permission } from '@tugeel/shared/auth';
import {
  Activity,
  ArrowLeftRight,
  BadgePercent,
  Boxes,
  Building2,
  Calculator,
  ClipboardCheck,
  Factory,
  FileSpreadsheet,
  FolderTree,
  History,
  Hourglass,
  LayoutGrid,
  type LucideIcon,
  Move,
  Package,
  PackageMinus,
  PackagePlus,
  ReceiptText,
  Ruler,
  ScanBarcode,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Users,
  Warehouse,
} from 'lucide-react';

type NavKey = `nav.${Exclude<keyof (typeof mn)['nav'], 'groups' | 'menu' | 'account'>}`;
type NavGroupKey = `nav.groups.${keyof (typeof mn)['nav']['groups']}`;
type QuickActionKey = `home.actions.${keyof (typeof mn)['home']['actions']}`;

export interface NavItem {
  to: string;
  label: NavKey;
  icon: LucideIcon;
  permission?: Permission;
}

export interface NavGroup {
  label: NavGroupKey;
  items: readonly NavItem[];
}

/**
 * Sidebar menu, one group per area (ADR-0042: every entry has an icon). An entry with a permission
 * is shown only to users who hold it (ADR-0027); a group without visible entries is hidden. Catalog
 * pages and suppliers are readable by every user; customers only by the office, accountants and
 * admins. Branches and warehouses are readable by every user too (other pages list them), but only
 * people who manage them need the menu entry. Stock, its history, the low-stock list and receipts
 * are read by every user (without costs); transfers, moves, adjustments, stocktakes and shelves only
 * by the people who make them (every user may still open a transfer or a stocktake by its link).
 * Discount programs and the price calculator are read by every user; pricing.manage changes them
 * (ADR-0041). The products waiting for their prices are the price clerk's list
 * (pricing.prices.manage, ADR-0044).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'nav.groups.catalog',
    items: [
      { to: '/catalog/products', label: 'nav.products', icon: Package },
      {
        to: '/catalog/pending',
        label: 'nav.pendingProducts',
        icon: Hourglass,
        permission: 'pricing.prices.manage',
      },
      { to: '/catalog/categories', label: 'nav.categories', icon: FolderTree },
      { to: '/catalog/uoms', label: 'nav.uoms', icon: Ruler },
      { to: '/catalog/scan', label: 'nav.scan', icon: ScanBarcode },
      {
        to: '/catalog/ebarimt',
        label: 'nav.ebarimt',
        icon: ReceiptText,
        permission: 'catalog.ebarimt.manage',
      },
    ],
  },
  {
    label: 'nav.groups.partners',
    items: [
      {
        to: '/partners/customers',
        label: 'nav.customers',
        icon: Store,
        permission: 'partners.customers.read',
      },
      { to: '/partners/suppliers', label: 'nav.suppliers', icon: Factory },
    ],
  },
  {
    label: 'nav.groups.inventory',
    items: [
      { to: '/inventory/stock', label: 'nav.stock', icon: Boxes },
      { to: '/inventory/movements', label: 'nav.movements', icon: History },
      { to: '/inventory/low-stock', label: 'nav.lowStock', icon: PackageMinus },
      { to: '/inventory/receipts', label: 'nav.receipts', icon: PackagePlus },
      {
        to: '/inventory/transfers',
        label: 'nav.transfers',
        icon: ArrowLeftRight,
        permission: 'inventory.transfers.manage',
      },
      {
        to: '/inventory/moves',
        label: 'nav.binMoves',
        icon: Move,
        permission: 'inventory.moves.manage',
      },
      {
        to: '/inventory/adjustments',
        label: 'nav.adjustments',
        icon: SlidersHorizontal,
        permission: 'inventory.adjustments.manage',
      },
      {
        to: '/inventory/stocktakes',
        label: 'nav.stocktakes',
        icon: ClipboardCheck,
        permission: 'inventory.stocktakes.manage',
      },
      {
        to: '/inventory/bins',
        label: 'nav.bins',
        icon: LayoutGrid,
        permission: 'inventory.setup.manage',
      },
    ],
  },
  {
    label: 'nav.groups.pricing',
    items: [
      { to: '/pricing/discounts', label: 'nav.discounts', icon: BadgePercent },
      { to: '/pricing/quote', label: 'nav.priceQuote', icon: Calculator },
    ],
  },
  {
    label: 'nav.groups.system',
    items: [
      { to: '/system/status', label: 'nav.systemStatus', icon: Activity },
      { to: '/users', label: 'nav.users', icon: Users, permission: 'identity.users.read' },
      { to: '/roles', label: 'nav.roles', icon: ShieldCheck, permission: 'identity.users.read' },
      {
        to: '/branches',
        label: 'nav.branches',
        icon: Building2,
        permission: 'identity.org.manage',
      },
      {
        to: '/warehouses',
        label: 'nav.warehouses',
        icon: Warehouse,
        permission: 'identity.org.manage',
      },
      {
        to: '/settings',
        label: 'nav.settings',
        icon: Settings,
        permission: 'identity.settings.read',
      },
      { to: '/audit', label: 'nav.audit', icon: ScrollText, permission: 'identity.audit.read' },
      {
        to: '/imports',
        label: 'nav.imports',
        icon: FileSpreadsheet,
        permission: 'imports.manage',
      },
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

/**
 * Where a path sits in the menu: the group and the entry whose page it is or lies below (the
 * longest matching entry), `exact` on the entry's own (list) page. Searched in the whole menu, so a
 * transfer opened by its link still knows it belongs to «Шилжүүлэг». Feeds the breadcrumb trail
 * and the recent pages (ADR-0042).
 */
export function navTrail(
  pathname: string,
): { group: NavGroup; item: NavItem; exact: boolean } | null {
  let best: { group: NavGroup; item: NavItem } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const inside = pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (inside && (!best || item.to.length > best.item.to.length)) best = { group, item };
    }
  }
  return best ? { ...best, exact: pathname === best.item.to } : null;
}

export interface QuickAction {
  to: string;
  label: QuickActionKey;
  icon: LucideIcon;
  permission?: Permission;
}

/** The home page's shortcuts to the day's work, each behind the right to do it (ADR-0042). */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    to: '/inventory/receipts/new',
    label: 'home.actions.newReceipt',
    icon: PackagePlus,
    permission: 'inventory.receipts.manage',
  },
  {
    to: '/inventory/transfers?new=1',
    label: 'home.actions.newTransfer',
    icon: ArrowLeftRight,
    permission: 'inventory.transfers.manage',
  },
  {
    to: '/inventory/stocktakes?new=1',
    label: 'home.actions.newStocktake',
    icon: ClipboardCheck,
    permission: 'inventory.stocktakes.manage',
  },
  {
    to: '/catalog/products/new',
    label: 'home.actions.newProduct',
    icon: Package,
    permission: 'catalog.products.register',
  },
  { to: '/catalog/scan', label: 'home.actions.scan', icon: ScanBarcode },
  { to: '/pricing/quote', label: 'home.actions.quote', icon: Calculator },
];

export function visibleQuickActions(permissions: readonly Permission[]): QuickAction[] {
  return QUICK_ACTIONS.filter(
    (action) => !action.permission || permissions.includes(action.permission),
  );
}
