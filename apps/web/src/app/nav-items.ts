import type mn from '@tugeel/shared/i18n/mn.json';
import type { Permission } from '@tugeel/shared/auth';
import {
  Activity,
  ArrowLeftRight,
  BookOpenText,
  CalendarCheck,
  CalendarClock,
  Coins,
  FileText,
  Landmark,
  ListTree,
  WalletCards,
  BadgePercent,
  Boxes,
  Briefcase,
  Building2,
  Calculator,
  ChartBar,
  ClipboardCheck,
  Factory,
  Gauge,
  FileChartColumn,
  FileSpreadsheet,
  FolderTree,
  HandCoins,
  History,
  Hourglass,
  KeyRound,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  Monitor,
  Move,
  Package,
  PackageCheck,
  PackageMinus,
  PackageOpen,
  PackagePlus,
  PackageSearch,
  ReceiptText,
  Ruler,
  ScanBarcode,
  ScrollText,
  Settings,
  Shapes,
  SquareKanban,
  ShieldCheck,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Store,
  TabletSmartphone,
  Tag,
  Tags,
  Timer,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Warehouse,
  Percent,
  Scale,
} from 'lucide-react';

type NavKey = `nav.${Exclude<keyof (typeof mn)['nav'], 'groups' | 'menu' | 'account'>}`;
type NavGroupKey = `nav.groups.${keyof (typeof mn)['nav']['groups']}`;
type QuickActionKey = `home.actions.${keyof (typeof mn)['home']['actions']}`;
type AttentionLabel = `home.attention.${keyof (typeof mn)['home']['attention']}`;

export interface NavItem {
  to: string;
  label: NavKey;
  icon: LucideIcon;
  /** Shown to holders of the permission, or of any one of several. */
  permission?: Permission | readonly Permission[];
  /** Other paths whose pages belong to this entry (the breadcrumb, the recent pages). */
  also?: readonly string[];
  /** Shown in development builds only (the supermarket's test till, ADR-0063 #8). */
  devOnly?: boolean;
}

export interface NavGroup {
  label: NavGroupKey;
  items: readonly NavItem[];
}

/**
 * Sidebar menu, one group per area (ADR-0042: every entry has an icon), in the order of a wholesale
 * office's day (ADR-0066): sales, the warehouse, the catalogue, prices, segments, partners, finance,
 * the supermarket, the assistant, the system. An entry with a permission
 * is shown only to users who hold it (ADR-0027); a group without visible entries is hidden. Catalog
 * pages and suppliers are readable by every user; customers only by the office, accountants and
 * admins. Branches and warehouses are readable by every user too (other pages list them), but only
 * people who manage them need the menu entry. Stock, its history, the low-stock list and receipts
 * are read by every user (without costs); transfers, goods issues, moves, adjustments, stocktakes
 * and shelves only by the people who make them (every user may still open a transfer or a stocktake by its link).
 * Price profiles, discount programs and the price calculator are read by every user;
 * pricing.manage changes the profiles and the programs (ADR-0041, ADR-0048). The products waiting
 * for their prices are the price clerk's list (pricing.prices.manage, ADR-0044). The AI assistant and its saved reports need ai.ask
 * (ADR-0045).
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'nav.groups.sales',
    items: [
      {
        to: '/sales/boards',
        label: 'nav.salesWarehouse',
        icon: SquareKanban,
        permission: 'sales.orders.read',
        also: ['/sales/orders'],
      },
    ],
  },
  {
    label: 'nav.groups.inventory',
    items: [
      { to: '/inventory/stock', label: 'nav.stock', icon: Boxes },
      { to: '/inventory/receipts', label: 'nav.receipts', icon: PackagePlus },
      {
        to: '/inventory/issues',
        label: 'nav.issues',
        icon: PackageOpen,
        permission: 'inventory.issues.manage',
      },
      {
        to: '/inventory/transfers',
        label: 'nav.transfers',
        icon: ArrowLeftRight,
        permission: 'inventory.transfers.manage',
      },
      {
        to: '/inventory/stocktakes',
        label: 'nav.stocktakes',
        icon: ClipboardCheck,
        permission: 'inventory.stocktakes.manage',
      },
      {
        to: '/inventory/adjustments',
        label: 'nav.adjustments',
        icon: SlidersHorizontal,
        permission: 'inventory.adjustments.manage',
      },
      {
        to: '/inventory/moves',
        label: 'nav.binMoves',
        icon: Move,
        permission: 'inventory.moves.manage',
      },
      { to: '/inventory/low-stock', label: 'nav.lowStock', icon: PackageMinus },
      { to: '/inventory/movements', label: 'nav.movements', icon: History },
      {
        to: '/inventory/bins',
        label: 'nav.bins',
        icon: LayoutGrid,
        permission: 'inventory.setup.manage',
      },
    ],
  },
  {
    label: 'nav.groups.catalog',
    items: [
      { to: '/catalog/products', label: 'nav.products', icon: Package },
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
    label: 'nav.groups.pricing',
    items: [
      {
        to: '/catalog/pending',
        label: 'nav.pendingProducts',
        icon: Hourglass,
        permission: 'pricing.prices.manage',
      },
      { to: '/pricing/profiles', label: 'nav.priceProfiles', icon: Tags },
      { to: '/pricing/discounts', label: 'nav.discounts', icon: BadgePercent },
      { to: '/pricing/quote', label: 'nav.priceQuote', icon: Calculator },
    ],
  },
  {
    label: 'nav.groups.segments',
    items: [{ to: '/segments', label: 'nav.segments', icon: Shapes }],
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
    label: 'nav.groups.finance',
    items: [
      {
        to: '/finance/invoices',
        label: 'nav.invoices',
        icon: FileText,
        permission: 'finance.read',
      },
      { to: '/finance/payments', label: 'nav.payments', icon: Coins, permission: 'finance.read' },
      { to: '/finance/cash', label: 'nav.cash', icon: WalletCards, permission: 'finance.read' },
      {
        to: '/finance/customers',
        label: 'nav.customerBalances',
        icon: Landmark,
        permission: 'finance.read',
      },
      {
        to: '/finance/suppliers',
        label: 'nav.supplierBalances',
        icon: Truck,
        permission: 'finance.read',
      },
      {
        to: '/finance/journal',
        label: 'nav.journal',
        icon: BookOpenText,
        permission: 'finance.read',
      },
      {
        to: '/finance/accounts',
        label: 'nav.glAccounts',
        icon: ListTree,
        permission: 'finance.read',
      },
      {
        to: '/finance/trial-balance',
        label: 'nav.trialBalance',
        icon: Scale,
        permission: 'finance.read',
      },
      {
        to: '/finance/vat',
        label: 'nav.vatReport',
        icon: Percent,
        permission: 'finance.read',
      },
      {
        to: '/finance/opening-check',
        label: 'nav.openingCheck',
        icon: ClipboardCheck,
        permission: 'finance.read',
      },
      {
        to: '/finance/periods',
        label: 'nav.financePeriods',
        icon: CalendarCheck,
        permission: 'finance.read',
      },
      {
        to: '/finance/settings',
        label: 'nav.financeSettings',
        icon: Settings,
        permission: 'finance.settings.manage',
      },
    ],
  },
  {
    // The management reports (ADR-0108): margins only behind reports.margins.view.
    label: 'nav.groups.reports',
    items: [
      {
        to: '/reports/dashboard',
        label: 'nav.reportsDashboard',
        icon: Gauge,
        permission: 'reports.view',
      },
      {
        to: '/reports/aging',
        label: 'nav.reportsAging',
        icon: CalendarClock,
        permission: 'reports.view',
      },
      {
        to: '/reports/profit',
        label: 'nav.reportsProfit',
        icon: TrendingUp,
        permission: 'reports.margins.view',
      },
      {
        to: '/reports/stock',
        label: 'nav.reportsStock',
        icon: PackageSearch,
        permission: 'reports.view',
      },
      {
        to: '/reports/suppliers',
        label: 'nav.reportsSuppliers',
        icon: ChartBar,
        permission: 'reports.margins.view',
      },
    ],
  },
  {
    label: 'nav.groups.pos',
    items: [
      { to: '/pos/shifts', label: 'nav.posShifts', icon: Timer, permission: 'pos.read' },
      { to: '/pos/sales', label: 'nav.posSales', icon: ShoppingBasket, permission: 'pos.read' },
      { to: '/pos/voids', label: 'nav.posVoids', icon: Undo2, permission: 'pos.read' },
      { to: '/pos/tills', label: 'nav.posTills', icon: Monitor, permission: 'pos.read' },
      { to: '/pos/cashiers', label: 'nav.posCashiers', icon: KeyRound, permission: 'pos.read' },
      {
        to: '/pos/quick-buttons',
        label: 'nav.posQuickButtons',
        icon: LayoutGrid,
        permission: 'pos.read',
      },
      {
        to: '/pos/settings',
        label: 'nav.posSettings',
        icon: Settings,
        permission: 'pos.manage',
      },
      {
        to: '/pos/test-till',
        label: 'nav.posTestTill',
        icon: TabletSmartphone,
        permission: 'pos.manage',
        devOnly: true,
      },
    ],
  },
  {
    label: 'nav.groups.ai',
    items: [
      { to: '/ai', label: 'nav.aiAssistant', icon: Sparkles, permission: 'ai.ask' },
      {
        to: '/ai/reports',
        label: 'nav.aiReports',
        icon: FileChartColumn,
        permission: 'ai.ask',
      },
    ],
  },
  {
    label: 'nav.groups.system',
    items: [
      { to: '/users', label: 'nav.users', icon: Users, permission: 'identity.users.read' },
      { to: '/roles', label: 'nav.roles', icon: ShieldCheck, permission: 'identity.users.read' },
      // ADR-0084: the Finance Core company; everyone reads it, finance.settings.manage edits it.
      { to: '/company', label: 'nav.company', icon: Briefcase, permission: 'finance.read' },
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
      { to: '/system/status', label: 'nav.systemStatus', icon: Activity },
      {
        to: '/system/app-notices',
        label: 'nav.appNotices',
        icon: Megaphone,
        permission: 'notifications.send',
      },
      {
        to: '/system/customer-app',
        label: 'nav.customerApp',
        icon: Smartphone,
        // The contact list's readers and the home's keepers (ADR-0092 #9: banners).
        permission: ['identity.settings.read', 'customer.home.manage'],
      },
    ],
  },
];

/** The groups and entries a user with these permissions sees. */
export function visibleNav(permissions: readonly Permission[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        (!item.permission ||
          [item.permission].flat().some((permission) => permissions.includes(permission))) &&
        (!item.devOnly || import.meta.env.DEV),
    ),
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
  let best: { group: NavGroup; item: NavItem; length: number } | null = null;
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      for (const path of [item.to, ...(item.also ?? [])]) {
        const inside = pathname === path || pathname.startsWith(`${path}/`);
        if (inside && (!best || path.length > best.length)) {
          best = { group, item, length: path.length };
        }
      }
    }
  }
  return best ? { group: best.group, item: best.item, exact: pathname === best.item.to } : null;
}

export interface QuickAction {
  to: string;
  label: QuickActionKey;
  icon: LucideIcon;
  /** Every right the shortcut needs: to do the thing and to open the page it lands on. */
  permission?: Permission | readonly Permission[];
}

/**
 * The home page's shortcuts to the day's work, each behind the right to do it (ADR-0042), in the
 * menu's order (ADR-0066): an order, the warehouse's documents, the catalogue, prices, a payment,
 * the assistant. A name never repeats a menu entry's (docs/ui.md §5).
 */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    to: '/sales/boards?new=1',
    label: 'home.actions.newOrder',
    icon: ShoppingCart,
    permission: ['sales.orders.read', 'sales.orders.manage'],
  },
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
  {
    to: '/finance/payments?new=1',
    label: 'home.actions.recordPayment',
    icon: HandCoins,
    permission: ['finance.read', 'finance.payments.record'],
  },
  { to: '/ai', label: 'home.actions.askAi', icon: Sparkles, permission: 'ai.ask' },
];

export function visibleQuickActions(permissions: readonly Permission[]): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => {
    const needed = action.permission === undefined ? [] : [action.permission].flat();
    return needed.every((permission) => permissions.includes(permission));
  });
}

/** A count of the inventory or pricing attention endpoints (ADR-0047 #7). */
export type AttentionCount =
  | 'transfersToShip'
  | 'transfersToReceive'
  | 'adjustmentsToApprove'
  | 'stocktakesToReview'
  | 'receiptsToCost'
  | 'lowStock'
  | 'productsWaitingForPrices'
  | 'overdueReceivables'
  | 'shiftsToHandOver';

export interface AttentionTile {
  count: AttentionCount;
  label: AttentionLabel;
  icon: LucideIcon;
  /** The right that does the work; without it the tile never shows. */
  permission: Permission;
  /** The list the tile opens, already filtered (the low-stock tile adds its warehouse). */
  to: string;
}

/** The home page's «Анхаарах» tiles, in this order; each shows only while its count is above 0. */
export const ATTENTION_TILES: readonly AttentionTile[] = [
  {
    count: 'transfersToReceive',
    label: 'home.attention.transfersToReceive',
    icon: PackageCheck,
    permission: 'inventory.transfers.manage',
    to: '/inventory/transfers?direction=INCOMING&status=SHIPPED',
  },
  {
    count: 'transfersToShip',
    label: 'home.attention.transfersToShip',
    icon: Truck,
    permission: 'inventory.transfers.manage',
    to: '/inventory/transfers?direction=OUTGOING&status=REQUESTED',
  },
  {
    count: 'adjustmentsToApprove',
    label: 'home.attention.adjustments',
    icon: SlidersHorizontal,
    permission: 'inventory.adjustments.approve',
    to: '/inventory/adjustments?status=SUBMITTED',
  },
  {
    count: 'stocktakesToReview',
    label: 'home.attention.stocktakes',
    icon: ClipboardCheck,
    permission: 'inventory.stocktakes.approve',
    to: '/inventory/stocktakes?status=REVIEW',
  },
  {
    count: 'receiptsToCost',
    label: 'home.attention.receiptsToCost',
    icon: ReceiptText,
    permission: 'inventory.costs.manage',
    to: '/inventory/receipts?costing=pending',
  },
  {
    count: 'productsWaitingForPrices',
    label: 'home.attention.productsWaitingForPrices',
    icon: Tag,
    permission: 'pricing.prices.manage',
    to: '/catalog/pending',
  },
  {
    count: 'overdueReceivables',
    label: 'home.attention.overdueReceivables',
    icon: CalendarClock,
    permission: 'finance.read',
    to: '/finance/customers?overdue=1',
  },
  {
    count: 'shiftsToHandOver',
    label: 'home.attention.shiftsToHandOver',
    icon: Hourglass,
    permission: 'finance.payments.record',
    to: '/pos/shifts?status=CLOSED',
  },
  {
    count: 'lowStock',
    label: 'home.attention.lowStock',
    icon: PackageMinus,
    permission: 'inventory.transfers.manage',
    to: '/inventory/low-stock',
  },
];
