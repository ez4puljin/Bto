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
  'partners.customers.read',
  'partners.customers.manage',
  'partners.credit.manage',
  'partners.suppliers.manage',
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
  'imports.manage',
  'pricing.manage',
  'pricing.prices.manage',
  // The AI assistant (ADR-0045): asking shows costs, credit and personal data to the holder.
  'ai.ask',
  'ai.reports.manage',
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
  OFFICE: ['partners.customers.read', 'partners.customers.manage'],
  PROCUREMENT: [],
  // Warehouse staff count goods in and out but never see costs; an admin approves adjustments.
  WAREHOUSE: [
    'inventory.locations.manage',
    'inventory.receipts.manage',
    'inventory.moves.manage',
    'inventory.adjustments.manage',
    'inventory.stocktakes.manage',
    'inventory.transfers.manage',
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
  ],
  HR: [],
  // Store staff request and receive transfers within the supermarket's write scope (ADR-0035).
  POS_CASHIER: ['inventory.transfers.manage'],
  SALES_REP: [],
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
