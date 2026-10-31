import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  inet,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jsonValue } from '../../common/db/types';

// Tables owned by the identity module (docs/architecture.md §4, docs/modules/identity.md, ADR-0027).
// Migration 0001_identity adds by hand what drizzle-kit cannot express: the audit_log REVOKE and
// its append-only triggers. Reference rows (permissions, system roles, TRANSIT) are synced by the
// api at boot, never by a migration.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  'users',
  {
    id: id(),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone'),
    /** argon2id; NULL until the user redeems a one-time code. */
    passwordHash: text('password_hash'),
    status: text('status', { enum: ['ACTIVE', 'DISABLED'] })
      .notNull()
      .default('ACTIVE'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_username_key').on(t.username),
    // ADR-0128 #3: the registered phone is the sign-in identifier, one account per phone.
    uniqueIndex('users_phone_key')
      .on(t.phone)
      .where(sql`${t.phone} IS NOT NULL`),
    check('users_username_format', sql`${t.username} ~ '^[a-z0-9][a-z0-9._-]{2,31}$'`),
    check('users_full_name_present', sql`length(btrim(${t.fullName})) > 0`),
    check('users_phone_e164', sql`${t.phone} IS NULL OR ${t.phone} ~ '^[+]976[0-9]{8}$'`),
    check('users_status', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
    check('users_failed_login_count', sql`${t.failedLoginCount} >= 0`),
  ],
);

export const permissions = pgTable('permissions', {
  code: text('code').primaryKey(),
});

export const roles = pgTable(
  'roles',
  {
    id: id(),
    /** System roles only (ADMIN, OFFICE, …); custom roles are identified by id and name. */
    code: text('code'),
    /** Custom roles only; system roles are labelled through i18n by code. */
    name: text('name'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('roles_code_key').on(t.code),
    uniqueIndex('roles_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.name} IS NOT NULL`),
    check(
      'roles_system_or_custom',
      sql`(${t.isSystem} AND ${t.code} IS NOT NULL AND ${t.name} IS NULL)
        OR (NOT ${t.isSystem} AND ${t.code} IS NULL AND length(btrim(${t.name})) > 0)`,
    ),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionCode: text('permission_code')
      .notNull()
      .references(() => permissions.code, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionCode] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.roleId] }),
    index('user_roles_role_id_idx').on(t.roleId),
  ],
);

/**
 * A user's roles inside one Finance Core company (ADR-0075 #8, ADR-0076): no row, no access to that
 * company's books. This installation books into one company (`bto.company_code`), so every write of
 * `user_roles` mirrors itself here for it (ADR-0084). `company_code` is the core's company code, not
 * a foreign key: identity never references the core's tables.
 */
export const userCompanyRoles = pgTable(
  'user_company_roles',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    companyCode: text('company_code').notNull(),
    roleId: bigint('role_id', { mode: 'number' })
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.companyCode, t.roleId] }),
    index('user_company_roles_role_id_idx').on(t.roleId),
    check(
      'user_company_roles_company_code',
      sql`${t.companyCode} ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$'`,
    ),
  ],
);

export const branches = pgTable(
  'branches',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** e-Barimt branch number (3 digits); required when receipts are issued (delivery 3). */
    branchNo: text('branch_no'),
    /** e-Barimt district code (4 digits). */
    districtCode: text('district_code'),
    address: text('address'),
    status: text('status', { enum: ['ACTIVE', 'INACTIVE'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('branches_code_key').on(t.code),
    check('branches_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'`),
    check('branches_name_present', sql`length(btrim(${t.name})) > 0`),
    check('branches_branch_no', sql`${t.branchNo} IS NULL OR ${t.branchNo} ~ '^[0-9]{3}$'`),
    check(
      'branches_district_code',
      sql`${t.districtCode} IS NULL OR ${t.districtCode} ~ '^[0-9]{4}$'`,
    ),
    check('branches_status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const WAREHOUSE_KINDS = ['WHOLESALE', 'STORE', 'VEHICLE', 'TRANSIT'] as const;
export type WarehouseKind = (typeof WAREHOUSE_KINDS)[number];
/** Code of the single system TRANSIT warehouse; reserved for it. */
export const TRANSIT_CODE = 'TRANSIT';

export const warehouses = pgTable(
  'warehouses',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: WAREHOUSE_KINDS }).notNull(),
    /** NULL only for the single TRANSIT warehouse. */
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branches.id),
    status: text('status', { enum: ['ACTIVE', 'INACTIVE'] })
      .notNull()
      .default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('warehouses_code_key').on(t.code),
    uniqueIndex('warehouses_one_transit')
      .on(t.kind)
      .where(sql`${t.kind} = 'TRANSIT'`),
    index('warehouses_branch_id_idx').on(t.branchId),
    check('warehouses_code_format', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'`),
    check('warehouses_name_present', sql`length(btrim(${t.name})) > 0`),
    check('warehouses_kind', sql`${t.kind} IN ('WHOLESALE', 'STORE', 'VEHICLE', 'TRANSIT')`),
    check(
      'warehouses_transit_has_no_branch',
      sql`(${t.kind} = 'TRANSIT') = (${t.branchId} IS NULL)`,
    ),
    check('warehouses_status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

/** A user with no rows here may write for every warehouse; reads are never scoped (ADR-0027 #7). */
export const userScopes = pgTable(
  'user_scopes',
  {
    id: id(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    branchId: bigint('branch_id', { mode: 'number' }).references(() => branches.id),
    warehouseId: bigint('warehouse_id', { mode: 'number' }).references(() => warehouses.id),
  },
  (t) => [
    unique('user_scopes_target_key').on(t.userId, t.branchId, t.warehouseId).nullsNotDistinct(),
    check('user_scopes_one_target', sql`num_nonnulls(${t.branchId}, ${t.warehouseId}) = 1`),
  ],
);

export const SESSION_REVOKE_REASONS = [
  'LOGOUT',
  'LOGOUT_ALL',
  'ADMIN',
  'PASSWORD_CHANGED',
  'USER_DISABLED',
  'TOKEN_REUSE',
  // A customer account (ADR-0079 #3): the office changed its phone, closed the app, or the
  // customer itself became inactive.
  'PHONE_CHANGED',
  'ACCOUNT_DISABLED',
  'CUSTOMER_INACTIVE',
] as const;
export type SessionRevokeReason = (typeof SESSION_REVOKE_REASONS)[number];

/** Who a session belongs to: a staff user, or a store's customer app account (ADR-0079 #3). */
export const SESSION_KINDS = ['STAFF', 'CUSTOMER'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export const CUSTOMER_USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type CustomerUserStatus = (typeof CUSTOMER_USER_STATUSES)[number];

/**
 * A store's account in the customer app «Bto300» (ADR-0005 #2, ADR-0079 #2): one per customer and
 * one per phone, created only by the office. `customer_id` references partners' `customers`; the
 * foreign key is added by hand in migration 0031 (identity imports no other module).
 */
export const customerUsers = pgTable(
  'customer_users',
  {
    id: id(),
    customerId: bigint('customer_id', { mode: 'number' }).notNull(),
    /** The sign-in phone, E.164; not one of the customer's contact phones. */
    phone: text('phone').notNull(),
    /** argon2id; NULL until the store redeems a code (and again after a phone change). */
    passwordHash: text('password_hash'),
    status: text('status', { enum: CUSTOMER_USER_STATUSES }).notNull().default('ACTIVE'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('customer_users_customer_key').on(t.customerId),
    uniqueIndex('customer_users_phone_key').on(t.phone),
    check('customer_users_phone_e164', sql`${t.phone} ~ '^[+]976[0-9]{8}$'`),
    check('customer_users_status', sql`${t.status} IN ('ACTIVE', 'DISABLED')`),
    check('customer_users_failed_login_count', sql`${t.failedLoginCount} >= 0`),
  ],
);

/** One row per login (device); the refresh token rotates inside it (ADR-0005, ADR-0027 #8). */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid('id')
      .primaryKey()
      .default(sql`uuidv7()`),
    kind: text('kind', { enum: SESSION_KINDS }).notNull().default('STAFF'),
    /** The staff user of a STAFF session; NULL for a CUSTOMER session. */
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'cascade',
    }),
    /** The customer app account of a CUSTOMER session (ADR-0079 #3); NULL for STAFF. */
    customerUserId: bigint('customer_user_id', { mode: 'number' }).references(
      () => customerUsers.id,
      { onDelete: 'cascade' },
    ),
    /** SHA-256 (hex) of the current refresh token. */
    tokenHash: text('token_hash').notNull(),
    previousTokenHash: text('previous_token_hash'),
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: inet('ip'),
    createdAt: createdAt(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * STAFF: fixed at login, login time + auth.staff_session_hours; a refresh never moves it.
     * CUSTOMER: auth.customer_session_days after the last use; every refresh moves it.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason', { enum: SESSION_REVOKE_REASONS }),
  },
  (t) => [
    index('auth_sessions_user_id_idx').on(t.userId),
    index('auth_sessions_customer_user_id_idx').on(t.customerUserId),
    check('auth_sessions_kind', sql`${t.kind} IN ('STAFF', 'CUSTOMER')`),
    check(
      'auth_sessions_principal',
      sql`(${t.kind} = 'STAFF' AND ${t.userId} IS NOT NULL AND ${t.customerUserId} IS NULL)
        OR (${t.kind} = 'CUSTOMER' AND ${t.customerUserId} IS NOT NULL AND ${t.userId} IS NULL)`,
    ),
    check(
      'auth_sessions_revoked_reason',
      sql`(${t.revokedAt} IS NULL) = (${t.revokedReason} IS NULL)
        AND (${t.revokedReason} IS NULL OR ${t.revokedReason} IN
          ('LOGOUT', 'LOGOUT_ALL', 'ADMIN', 'PASSWORD_CHANGED', 'USER_DISABLED', 'TOKEN_REUSE',
           'PHONE_CHANGED', 'ACCOUNT_DISABLED', 'CUSTOMER_INACTIVE'))`,
    ),
    check('auth_sessions_expiry', sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

/** One-time codes the office issues so a store can set its app password (ADR-0079 #3). */
export const customerPasswordCodes = pgTable(
  'customer_password_codes',
  {
    id: id(),
    customerUserId: bigint('customer_user_id', { mode: 'number' })
      .notNull()
      .references(() => customerUsers.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256(AUTH_PEPPER, normalised code), hex. */
    codeHash: text('code_hash').notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('customer_password_codes_one_live')
      .on(t.customerUserId)
      .where(sql`${t.usedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('customer_password_codes_attempts', sql`${t.attempts} >= 0`),
  ],
);

/** One-time codes an admin issues so a user can set their own password (ADR-0027 #9). */
export const passwordResets = pgTable(
  'password_resets',
  {
    id: id(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** HMAC-SHA256(AUTH_PEPPER, normalised code), hex. */
    codeHash: text('code_hash').notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [
    uniqueIndex('password_resets_one_live')
      .on(t.userId)
      .where(sql`${t.usedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('password_resets_attempts', sql`${t.attempts} >= 0`),
  ],
);

/** Effective-dated settings; a row is never updated (SPEC §5.1, ADR-0010 #7). */
export const settings = pgTable(
  'settings',
  {
    id: id(),
    key: text('key').notNull(),
    value: jsonValue('value').notNull(),
    /** Ulaanbaatar business date from which the value applies. */
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('settings_key_effective_from_key').on(t.key, t.effectiveFrom)],
);

/** Gap-free document numbers per (scope, period), allocated inside the posting tx (ADR-0002 #7). */
export const numberSequences = pgTable(
  'number_sequences',
  {
    scopeKey: text('scope_key').notNull(),
    period: text('period').notNull(),
    lastValue: bigint('last_value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.scopeKey, t.period] }),
    check('number_sequences_last_value', sql`${t.lastValue} >= 0`),
  ],
);

export const AUDIT_ACTOR_KINDS = ['STAFF', 'CUSTOMER', 'SYSTEM'] as const;
export type AuditActorKind = (typeof AUDIT_ACTOR_KINDS)[number];

/** Append-only (REVOKE + forbid_update_delete triggers in 0001_identity). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorKind: text('actor_kind', { enum: AUDIT_ACTOR_KINDS }).notNull(),
    /** users.id for STAFF, customer_users.id for CUSTOMER (ADR-0079); NULL for SYSTEM. */
    actorId: bigint('actor_id', { mode: 'number' }),
    /** For SYSTEM actors: the job or CLI that acted. */
    actorLabel: text('actor_label'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonValue('before'),
    after: jsonValue('after'),
    requestId: text('request_id'),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entity, t.entityId, t.id),
    index('audit_log_actor_idx').on(t.actorId, t.id),
    check('audit_log_actor_kind', sql`${t.actorKind} IN ('STAFF', 'CUSTOMER', 'SYSTEM')`),
    check(
      'audit_log_actor',
      sql`(${t.actorKind} = 'SYSTEM' AND ${t.actorId} IS NULL)
        OR (${t.actorKind} <> 'SYSTEM' AND ${t.actorId} IS NOT NULL)`,
    ),
  ],
);

/** Replay store for `Idempotency-Key` requests (ADR-0002 #6, ADR-0004 #5, ADR-0027 #11). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    actorKind: text('actor_kind', { enum: AUDIT_ACTOR_KINDS }).notNull(),
    actorId: bigint('actor_id', { mode: 'number' }).notNull(),
    key: uuid('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['IN_PROGRESS', 'COMPLETED'] }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonValue('response_body'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('idempotency_keys_actor_key').on(t.actorKind, t.actorId, t.key),
    check('idempotency_keys_status', sql`${t.status} IN ('IN_PROGRESS', 'COMPLETED')`),
    check(
      'idempotency_keys_completed',
      sql`(${t.status} = 'COMPLETED') = (${t.responseStatus} IS NOT NULL)`,
    ),
  ],
);

export const FILE_STATUSES = ['PENDING', 'READY', 'DELETED'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * Stored files (ADR-0014, ADR-0030). A row is created PENDING when an upload URL is issued; the module
 * that attaches the file to its document confirms it READY in that document's transaction. Kinds are
 * registered in @tugeel/shared/files, so only their format is checked here.
 */
export const files = pgTable(
  'files',
  {
    id: id(),
    /** Server-generated object name `<uuid>.<ext>`, also the last segment of its URLs. */
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Hex SHA-256 of the bytes, recorded when the upload arrives. */
    sha256: text('sha256'),
    status: text('status', { enum: FILE_STATUSES }).notNull().default('PENDING'),
    ownerId: bigint('owner_id', { mode: 'number' }).references(() => users.id, {
      onDelete: 'set null',
    }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    /** When the housekeeping job removed the bytes of a DELETED file (ADR-0040); the row stays. */
    purgedAt: timestamp('purged_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('files_key_key').on(t.key),
    index('files_pending_idx')
      .on(t.createdAt)
      .where(sql`${t.status} = 'PENDING'`),
    index('files_unpurged_idx')
      .on(t.id)
      .where(sql`${t.status} = 'DELETED' AND ${t.purgedAt} IS NULL`),
    check('files_purged', sql`${t.purgedAt} IS NULL OR ${t.status} = 'DELETED'`),
    check('files_kind_format', sql`${t.kind} ~ '^[a-z]+[.][a-z_]+$'`),
    check('files_key_format', sql`${t.key} ~ '^[0-9a-f-]{36}[.][a-z]{3,4}$'`),
    check('files_size', sql`${t.sizeBytes} > 0`),
    check('files_sha256', sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$'`),
    check('files_status', sql`${t.status} IN ('PENDING', 'READY', 'DELETED')`),
    check(
      'files_uploaded',
      sql`(${t.uploadedAt} IS NULL) = (${t.sha256} IS NULL) AND (${t.status} = 'PENDING' OR ${t.uploadedAt} IS NOT NULL)`,
    ),
  ],
);
