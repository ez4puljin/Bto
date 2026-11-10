/**
 * Access-control catalog (ADR-0005, ADR-0027). Permission codes are English dot paths
 * `<module>.<resource>.<action>`; each code is also the i18n key `permissions.<code>` in mn.json,
 * so no code may be a segment prefix of another (enforced by auth.test.ts). Every module session
 * appends its own codes here and extends SYSTEM_ROLE_PERMISSIONS. The API syncs this catalog into
 * the `permissions`, `roles` and `role_permissions` tables at boot.
 */
import { normalizeMnPhone } from '../phone';

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
  // «Ebarimt» (ADR-0168): read the month's purchases against e-Barimt (cost data); import its file,
  // write the exempt amounts, notes and registers, link receipts; choose a supplier's employee on
  // this page; which accounts' receipts count, and taking a month's file away.
  'ebarimt.check.read',
  'ebarimt.check.edit',
  'ebarimt.check.assign',
  'ebarimt.check.settings',
  'imports.manage',
  'pricing.manage',
  'pricing.prices.manage',
  // The AI assistant (ADR-0045): asking, within the data groups the holder's roles open (ADR-0162).
  'ai.ask',
  'ai.reports.manage',
  // The connection, the limits and the usage of the AI (ADR-0162).
  'ai.settings.manage',
  // What the assistant may read for the holder (ADR-0162, AI_DATA_GROUPS in `@tugeel/shared/ai`).
  'ai.data.catalog',
  'ai.data.stock',
  'ai.data.customers',
  'ai.data.suppliers',
  'ai.data.pricing',
  'ai.data.sales',
  'ai.data.finance',
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
  // ADR-0129: moves a card over stages and into another pipeline's stage (the admin always).
  'sales.orders.moveAny',
  // The sales-rep app (ADR-0061 #5): the rep's own orders only, through /sales-rep/*.
  'sales.orders.rep',
  // ADR-0179: a driver marks the picked orders they loaded onto their truck in the staff app.
  'sales.orders.load',
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
  // Attendance (ADR-0131): the dashboard and the day log; the work sites, the schedule and the
  // office's corrections only with the second code.
  'hr.attendance.view',
  'hr.attendance.manage',
  // Management reports (ADR-0108): the dashboard and the reports; costs, profit, margins and stock
  // values in them only with the second code.
  'reports.view',
  'reports.margins.view',
  // The expiry register (ADR-0172): reading, recording and correcting are open to all staff. These
  // are a record's status and archive with the home tiles; its liability; carrying old records.
  'expiry.items.manage',
  'expiry.liability.manage',
  'expiry.items.carry',
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

/**
 * What ADMIN keeps whatever is edited (ADR-0165 #3): without these nobody could open the roles
 * screen or repair a role, and a lost right could not be given back from the system.
 */
export const ADMIN_LOCKED_PERMISSIONS: readonly Permission[] = [
  'identity.users.read',
  ...ADMIN_ONLY_PERMISSIONS,
];

/** The module a permission belongs to: the first segment of its code. */
export type PermissionGroup = Permission extends `${infer Group}.${string}` ? Group : never;

export function permissionGroup(code: Permission): PermissionGroup {
  return code.slice(0, code.indexOf('.')) as PermissionGroup;
}

/** True for codes an admin may select when building a custom role. */
export function isAssignablePermission(value: Permission): boolean {
  return !ADMIN_ONLY_PERMISSIONS.includes(value);
}

/**
 * System roles (SPEC §3). Their permission sets start from `SYSTEM_ROLE_PERMISSIONS`; an admin's
 * ticks are kept as differences from it (`systemRolePermissions`, ADR-0165).
 */
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
    // What happens to goods near their date (ADR-0172 #4).
    'expiry.items.manage',
  ],
  // Purchase orders by supplier (ADR-0115): managers and senior staff hold this role.
  PROCUREMENT: [
    'procurement.orders.read',
    'procurement.orders.edit',
    'procurement.orders.manage',
    'procurement.prices.read',
    // Who chases suppliers for their e-Barimt (ADR-0168).
    'ebarimt.check.read',
    'ebarimt.check.edit',
    // A city return goes back through the supplier (ADR-0172 #4).
    'expiry.items.manage',
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
    // What happens to goods near their date (ADR-0172 #4).
    'expiry.items.manage',
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
    // The month's purchases against e-Barimt (ADR-0168).
    'ebarimt.check.read',
    'ebarimt.check.edit',
    'ebarimt.check.settings',
    // A record's status and who is liable for it (ADR-0172 #4).
    'expiry.items.manage',
    'expiry.liability.manage',
  ],
  // Attendance (ADR-0131): the dashboard, the work sites, the schedule and the corrections. Liability
  // on the expiry register reads as pay (ADR-0172 #4).
  HR: ['hr.attendance.view', 'hr.attendance.manage', 'expiry.liability.manage'],
  // Store staff request and receive transfers within the supermarket's write scope (ADR-0035).
  POS_CASHIER: ['inventory.transfers.manage', 'pos.till.operate'],
  // The senior cashier approves returns and drawer opens at the till (owner 2026-10-16).
  POS_SUPERVISOR: [
    'inventory.transfers.manage',
    'pos.till.operate',
    'pos.till.supervise',
    'pos.read',
    // What happens to goods near their date on the shelves (ADR-0172 #4).
    'expiry.items.manage',
  ],
  // The rep app only (ADR-0061 #5): not sales.orders.read/manage (other orders), not
  // partners.customers.read (credit data); /sales-rep/* serves what an order needs.
  SALES_REP: ['sales.orders.rep'],
  // The staff app's «Ачилт» only (ADR-0179): the picked orders to load, no other order data.
  DRIVER: ['sales.orders.load'],
};

/** One admin's tick on a system role, kept as a difference from the code (ADR-0165 #2). */
export interface RolePermissionOverride {
  readonly permissionCode: string;
  readonly granted: boolean;
}

/**
 * A system role's rights: the code's set, plus what an admin ticked, minus what an admin unticked
 * (ADR-0165 #2). A right a later version adds to the code therefore still reaches an edited role.
 */
export function systemRolePermissions(
  role: SystemRole,
  overrides: readonly RolePermissionOverride[],
): Permission[] {
  const held = new Set<Permission>(SYSTEM_ROLE_PERMISSIONS[role]);
  for (const { permissionCode, granted } of overrides) {
    if (!isPermission(permissionCode)) continue;
    if (granted) held.add(permissionCode);
    else held.delete(permissionCode);
  }
  if (role === 'ADMIN') for (const code of ADMIN_LOCKED_PERMISSIONS) held.add(code);
  return PERMISSIONS.filter((code) => held.has(code));
}

/** The differences to store for the rights an admin ticked on a system role. */
export function systemRoleOverrides(
  role: SystemRole,
  ticked: readonly Permission[],
): { permissionCode: Permission; granted: boolean }[] {
  const defaults = new Set<Permission>(SYSTEM_ROLE_PERMISSIONS[role]);
  const chosen = new Set<Permission>(ticked);
  return PERMISSIONS.flatMap((permissionCode) => {
    if (chosen.has(permissionCode) === defaults.has(permissionCode)) return [];
    return [{ permissionCode, granted: chosen.has(permissionCode) }];
  });
}

/** Staff login names: lowercase Latin letters, digits and `._-`, 3–32 characters. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The internal login name a staff record gets from its phone (ADR-0128 #2): `p` + the 8 local
 * digits, never typed and never shown; `suffix` resolves a clash with an older, typed name.
 */
export function usernameFromPhone(phoneE164: string, suffix = 0): string {
  const base = `p${phoneE164.slice(-8)}`;
  return suffix > 0 ? `${base}-${suffix}` : base;
}

/** What a staff member typed to sign in (ADR-0128 #1): a phone in any local form, or a login name. */
export type StaffLogin =
  | { readonly kind: 'PHONE'; readonly value: string }
  | { readonly kind: 'USERNAME'; readonly value: string };

/**
 * A value that normalises to a Mongolian phone is a PHONE (E.164); anything else is a USERNAME
 * (trimmed, lower-cased). The api looks a USERNAME up only on records without a phone yet.
 */
export function parseStaffLogin(value: string): StaffLogin {
  const phone = normalizeMnPhone(value);
  if (phone) return { kind: 'PHONE', value: phone };
  return { kind: 'USERNAME', value: normalizeUsername(value) };
}

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'SAME_AS_USERNAME' | 'SAME_AS_PHONE';

/** Passwords are compared and hashed in Unicode NFC so the same text typed on any device matches. */
export function normalizePassword(value: string): string {
  return value.normalize('NFC');
}

/**
 * The password policy shared by the API (authoritative) and the web forms (instant feedback):
 * never the login name, and never the staff member's own phone (ADR-0128 #5), with or without
 * the country code.
 */
export function checkPassword(
  password: string,
  username: string,
  phone?: string | null,
): PasswordProblem | null {
  const normalized = normalizePassword(password);
  const length = [...normalized].length;
  if (length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (normalized.toLowerCase() === normalizeUsername(username)) return 'SAME_AS_USERNAME';
  const ownPhone = phone ? normalizeMnPhone(phone) : null;
  if (ownPhone && normalizeMnPhone(normalized) === ownPhone) return 'SAME_AS_PHONE';
  return null;
}
