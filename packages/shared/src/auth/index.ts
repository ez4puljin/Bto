/**
 * Access-control catalog (ADR-0005, ADR-0027). Permission codes are English dot paths
 * `<module>.<resource>.<action>`; each code is also the i18n key `permissions.<code>` in mn.json,
 * so no code may be a segment prefix of another (enforced by auth.test.ts). Every module session
 * appends its own codes here and extends SYSTEM_ROLE_PERMISSIONS. The API syncs this catalog into
 * the `permissions`, `roles` and `role_permissions` tables at boot.
 */
export const PERMISSIONS = [
  'identity.users.read',
  'identity.users.manage',
  'identity.roles.manage',
  'identity.org.manage',
  'identity.settings.read',
  'identity.settings.manage',
  'identity.audit.read',
  'catalog.products.manage',
  'catalog.products.register',
  'catalog.ebarimt.manage',
  // The product list's Excel export (ADR-0049 #6): warehouse prices and suppliers leave the system.
  'catalog.products.export',
  'partners.customers.read',
  'partners.customers.manage',
  'partners.credit.manage',
  'partners.suppliers.manage',
  // The customer app «Bto300» (ADR-0079 #11): linking a store's phone, one-time codes, closing it.
  'partners.customer_app.manage',
  'inventory.setup.manage',
  'inventory.locations.manage',
  'inventory.receipts.manage',
  'inventory.moves.manage',
  'inventory.adjustments.manage',
  'inventory.adjustments.approve',
  'inventory.stocktakes.manage',
  'inventory.stocktakes.approve',
  'inventory.costs.manage',
  'inventory.transfers.manage',
  'inventory.issues.manage',
  // The keeper's side of a goods issue (ADR-0117): ticking, confirming and returning the lines of
  // the warehouses in the write scope.
  'inventory.issues.confirm',
  // Purchase orders (ADR-0115): read; type quantities (the supplier's orderer, or a keeper for the
  // own warehouse's products while «Бэлдэж»); every supplier, statuses and orderers; the last
  // receipt price and the estimated cost beside each line.
  'procurement.orders.read',
  'procurement.orders.edit',
  'procurement.orders.manage',
  'procurement.prices.read',
  'imports.manage',
  'pricing.manage',
  'pricing.prices.manage',
  // The AI assistant (ADR-0045): asking shows costs, credit and personal data to the holder.
  'ai.ask',
  'ai.reports.manage',
  // Segments (ADR-0049): creating, changing and archiving them; everyone reads and uses them.
  'segments.manage',
  // Customer orders (ADR-0055): reading them, and entering, submitting and cancelling them.
  'sales.orders.read',
  'sales.orders.manage',
  // Boards and stages (ADR-0056): configuring them; confirming picked counts.
  'sales.boards.manage',
  'sales.orders.pick',
  // The warehouse lead (ADR-0126 #2): sees every warehouse's part of the orders with its picker,
  // hands a part to another picker and opens a picked part again.
  'sales.orders.pickLead',
  // The sales-rep app (ADR-0061 #5): the rep's own orders only, through /sales-rep/*.
  'sales.orders.rep',
  // Finance (ADR-0060): reading invoices, balances and books; recording money; voiding invoices
  // and crediting returns; manual journal entries and accounts; numbering, money accounts, roles.
  'finance.read',
  'finance.payments.record',
  'finance.invoices.manage',
  'finance.journal.manage',
  'finance.settings.manage',
  // Month close (ADR-0102): closing a month that has ended; reopening the latest closed one.
  'finance.periods.close',
  'finance.periods.reopen',
  // The supermarket POS (ADR-0063): reading tills, shifts and sales; configuring tills, cashiers,
  // PINs and the store's edge node; working a till; approving returns and no-sale drawer opens.
  'pos.read',
  'pos.manage',
  'pos.till.operate',
  'pos.till.supervise',
  // The bonus card (ADR-0112): registering members, their PINs, blocks and hand adjustments.
  'pos.loyalty.manage',
  // App notices (ADR-0062 #5): writing, listing and withdrawing the notices the rep app shows.
  'notifications.send',
  // The customer app's home (ADR-0092 #9): banners, the segments it shows and category pictures.
  'customer.home.manage',
  // Management reports (ADR-0108): the dashboard and the reports; costs, profit, margins and stock
  // values in them only with the second code.
  'reports.view',
  'reports.margins.view',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Managing users or roles is never delegable: these codes cannot be put into a custom role. */
export const ADMIN_ONLY_PERMISSIONS: readonly Permission[] = [
  'identity.users.manage',
  'identity.roles.manage',
];

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/** True for codes an admin may select when building a custom role. */
export function isAssignablePermission(value: Permission): boolean {
  return !ADMIN_ONLY_PERMISSIONS.includes(value);
}

/** System roles (SPEC §3). Their permission sets come from code and cannot be edited in the UI. */
export const SYSTEM_ROLES = [
  'ADMIN',
  'OFFICE',
  'PROCUREMENT',
  'WAREHOUSE',
  'ACCOUNTANT',
  'HR',
  'POS_CASHIER',
  'POS_SUPERVISOR',
  'SALES_REP',
  'DRIVER',
] as const;

export type SystemRole = (typeof SYSTEM_ROLES)[number];

export function isSystemRole(value: unknown): value is SystemRole {
  return typeof value === 'string' && (SYSTEM_ROLES as readonly string[]).includes(value);
}

/** ADMIN holds every permission; the other roles grow as their modules are built. */
export const SYSTEM_ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly Permission[]>> = {
  ADMIN: PERMISSIONS,
  // The office sees customer balances and invoices while entering orders (ADR-0060).
  OFFICE: [
    'partners.customers.read',
    'partners.customers.manage',
    // The office links stores to the customer app and reads them their codes (ADR-0079 #11).
    'partners.customer_app.manage',
    'sales.orders.read',
    'sales.orders.manage',
    'procurement.orders.read',
    'finance.read',
    'pos.read',
    // The office registers bonus card members and resets their PINs (owner 2026-10-28, ADR-0112).
    'pos.loyalty.manage',
  ],
  // Purchase orders by supplier (ADR-0115): managers and senior staff hold this role.
  PROCUREMENT: [
    'procurement.orders.read',
    'procurement.orders.edit',
    'procurement.orders.manage',
    'procurement.prices.read',
  ],
  // Warehouse staff count goods in and out but never see costs; an admin approves adjustments.
  WAREHOUSE: [
    'inventory.locations.manage',
    'inventory.receipts.manage',
    'inventory.moves.manage',
    'inventory.adjustments.manage',
    'inventory.stocktakes.manage',
    'inventory.transfers.manage',
    // The accountant sends a goods issue, the keeper confirms their warehouse's part (ADR-0117).
    'inventory.issues.confirm',
    'sales.orders.read',
    'sales.orders.pick',
    // Keepers type their own warehouse's quantities into an order while «Бэлдэж» (ADR-0115).
    'procurement.orders.read',
    'procurement.orders.edit',
  ],
  // The accountant also types TINs the lookup cannot find (SPEC §5.3), sets credit terms, enters
  // the supplier prices of goods receipts (ADR-0033) and the products' e-Barimt data (ADR-0044).
  ACCOUNTANT: [
    'identity.settings.read',
    'identity.audit.read',
    'catalog.ebarimt.manage',
    'partners.customers.read',
    'partners.customers.manage',
    'partners.credit.manage',
    'inventory.costs.manage',
    // The accountant creates and sends goods issues; the keepers confirm them (ADR-0117).
    'inventory.issues.manage',
    // The price check compares a receipt with its order's last prices (ADR-0115).
    'procurement.orders.read',
    'procurement.prices.read',
    'sales.orders.read',
    // Finance I (ADR-0060): invoices, payments, credit notes and the journal are the accountant's.
    'finance.read',
    'finance.payments.record',
    'finance.invoices.manage',
    'finance.journal.manage',
    // The month close and its reopen (ADR-0102 #1).
    'finance.periods.close',
    'finance.periods.reopen',
    // The supermarket's shifts and their cash (ADR-0064 #3).
    'pos.read',
    // Management reports with margins (ADR-0108 #5).
    'reports.view',
    'reports.margins.view',
  ],
  HR: [],
  // Store staff request and receive transfers within the supermarket's write scope (ADR-0035).
  POS_CASHIER: ['inventory.transfers.manage', 'pos.till.operate'],
  // The senior cashier approves returns and drawer opens at the till (owner 2026-10-16).
  POS_SUPERVISOR: [
    'inventory.transfers.manage',
    'pos.till.operate',
    'pos.till.supervise',
    'pos.read',
  ],
  // The rep app only (ADR-0061 #5): not sales.orders.read/manage (other orders), not
  // partners.customers.read (credit data); /sales-rep/* serves what an order needs.
  SALES_REP: ['sales.orders.rep'],
  DRIVER: [],
};

/** Staff login names: lowercase Latin letters, digits and `._-`, 3–32 characters. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'SAME_AS_USERNAME';

/** Passwords are compared and hashed in Unicode NFC so the same text typed on any device matches. */
export function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

/** The password policy shared by the API (authoritative) and the web forms (instant feedback). */
export function checkPassword(password: string, username: string): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (normalized.toLowerCase() === normalizeUsername(username)) return 'SAME_AS_USERNAME';
  return null;
}
