# Module `identity` — contract

Status: **built** in delivery 1 (weeks 1–2), session of 2026-10-10; accepted locally together with the rest of delivery 1. Code: `apps/api/src/modules/identity/`, shared rules in `packages/shared/src/{auth,settings,time,phone}`, screens in `apps/web/src/features/{auth,identity}/`. Decisions: ADR-0005 (auth model), ADR-0027 (access control model), ADR-0026 (local-only), architecture §4 (identity row) and §7.

identity is the root of the module graph: it depends on no other module, and every other module may import its `index.ts`.

## 1. Owned tables (migration `0001_identity`)

| Table | Purpose | Key rules (DB-enforced unless noted) |
|---|---|---|
| `users` | staff accounts | `username` lower-case latin `^[a-z0-9][a-z0-9._-]{2,31}$`, unique; `phone` E.164 `+976` + 8 digits or NULL; `password_hash` NULL until the first code is redeemed; `status` ACTIVE/DISABLED; `failed_login_count`, `locked_until`, `last_login_at`, `password_changed_at` |
| `permissions` | permission catalog | synced from `@tugeel/shared/auth` at api boot, never by a migration |
| `roles` | system roles (`code`, `is_system`) and admin-defined custom roles (`name`) | CHECK system ⇔ code; custom names unique case-insensitively (`roles_name_key` on `lower(name)`) |
| `role_permissions`, `user_roles` | role → permission, user → role | FKs; system role permissions are rewritten at boot |
| `user_scopes` | write scope of a user | exactly one of `branch_id` / `warehouse_id` (`num_nonnulls = 1`); unique NULLS NOT DISTINCT |
| `auth_sessions` | one row per login (device) | `uuidv7()` id; `token_hash`, `previous_token_hash`, `rotated_at`; `expires_at` fixed at login; `revoked_at` + `revoked_reason` (LOGOUT, LOGOUT_ALL, ADMIN, PASSWORD_CHANGED, USER_DISABLED, TOKEN_REUSE) |
| `password_resets` | admin-issued one-time codes | HMAC(`AUTH_PEPPER`) code hash, `expires_at` (30 min), `attempts` (max 5), `used_at`, `revoked_at`; at most one live code per user (partial unique index) |
| `branches` | branches | `code` upper-case unique; `branch_no` 3 digits and `district_code` 4 digits (e-Barimt) or NULL; ACTIVE/INACTIVE |
| `warehouses` | WHOLESALE / STORE / VEHICLE / TRANSIT | `(kind = 'TRANSIT') = (branch_id IS NULL)`; exactly one TRANSIT (partial unique index, code `TRANSIT`) |
| `settings` | effective-dated values | unique `(key, effective_from)`; `value` jsonb |
| `number_sequences` | gapless document numbers | `(scope_key, period)` primary key, `last_value` |
| `audit_log` | append-only change log | `REVOKE UPDATE, DELETE, TRUNCATE … FROM app` + `forbid_update_delete()` triggers (SQLSTATE 23001 even for the migrator) |
| `idempotency_keys` | replayable POST responses | unique `(actor_kind, actor_id, key)`; status IN_PROGRESS/COMPLETED |

Planned additions owned by identity: `files` in migration `0002_identity_files` at the start of the catalog session (StorageService, `STORAGE_DRIVER=local` writes `.data/storage/`; ADR-0014); `print_stations` and `print_jobs` in delivery 9 (ADR-0022).

## 2. Public API (`modules/identity/index.ts`)

| Export | Use |
|---|---|
| `IdentityModule` | import into a feature module to get the services below |
| `RequirePermission(...codes)`, `Authenticated()`, `CurrentUser()` | route access rules and the caller; `Public()` lives in `src/common/auth` |
| `AuthContext`, `Actor`, `actorUserId`, `systemActor` | the caller, passed explicitly from controller to service (no AsyncLocalStorage) |
| `ScopeService.assertCanWriteWarehouse(ctx, warehouseId)` | 403 `FORBIDDEN` `params.reason = 'WAREHOUSE_SCOPE'` when the user's scope excludes the warehouse; reads are never filtered; TRANSIT is always writable |
| `AuditService.record(tx, actor, { action, entity, entityId, before?, after? })` | inside the service transaction; keys matching `/password|hash|token|secret/i` are dropped recursively |
| `NumberingService.next(tx, scopeKey, period)` | gapless number inside the document's transaction (rollback returns the number) |
| `SettingsService.get(key, onDate)` / `find(key, onDate)` | value in force on an Ulaanbaatar business date (`businessDate()` from `@tugeel/shared/time`); `get` throws `SETTING_MISSING` |
| `OrgService` (`getBranch`, `getWarehouse`, `getTransitWarehouse(tx)`, lists) | organisation lookups |
| `WAREHOUSE_CREATED_HOOK` / `WarehouseCreatedHook` | optional provider (inventory, week 3: system bins) called inside the transaction that creates a warehouse, including the TRANSIT warehouse created at the first boot; warehouses that already exist when the hook is bound are not replayed |
| `Idempotent()` | marks a document-creating POST; the global `IdempotencyInterceptor` requires `Idempotency-Key` (UUID), replays the stored response and answers `IDEMPOTENCY_KEY_REUSED` / `IDEMPOTENCY_KEY_IN_PROGRESS` |

Rules for other modules: never read or write identity tables directly (G1 boundaries); every new route carries exactly one access decorator, otherwise the guard answers 403 `params.reason = 'NO_ACCESS_RULE'`.

## 3. REST surface (`/api/v1`)

| Method and path | Access | Notes |
|---|---|---|
| `POST /auth/login` | public | `{ username, password }` → access token (15 min) + `me`; sets the `tugeel_rt` refresh cookie |
| `POST /auth/refresh`, `POST /auth/logout` | public, cookie + same-origin check | refresh rotates the token (20 s grace answers without rotating); a later replay revokes the session (`TOKEN_REUSE`) |
| `POST /auth/password/setup` | public | `{ username, code, newPassword }`; redeems a one-time code and signs in |
| `GET /auth/me`, `POST /auth/password`, `POST /auth/logout-all` | authenticated | password change ends the other sessions |
| `GET /users`, `GET /users/:id` | `identity.users.read` | `?q=` searches username and full name; keyset pages |
| `POST /users`, `PATCH /users/:id`, `POST /users/:id/password-code`, `POST /users/:id/unlock`, `GET/DELETE /users/:id/sessions[/:sessionId]` | `identity.users.manage` | the code is shown once and never stored in clear |
| `GET /permissions`, `GET /roles` | `identity.users.read` | `assignable: false` marks the admin-only codes |
| `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` | `identity.roles.manage` | custom roles only |
| `GET /branches`, `GET /warehouses` | authenticated | short lists (`nextCursor` always null) |
| `POST/PATCH /branches`, `POST/PATCH /warehouses` | `identity.org.manage` | only WHOLESALE and STORE are created here |
| `GET /settings` | `identity.settings.read` | one view per key: value in force today + history |
| `POST /settings`, `DELETE /settings/:id` | `identity.settings.manage` | new values start today or later (the first value of a key may be back-dated); only future values can be deleted |
| `GET /audit` | `identity.audit.read` | filters `entity`, `entityId`, `actorId`, `from`, `to` (Ulaanbaatar dates); newest first |

Every auth response carries `Cache-Control: no-store`; request bodies are JSON only (no urlencoded parser: login CSRF).

## 4. Permissions and roles

- Catalog: `PERMISSIONS` in `@tugeel/shared/auth` (`identity.users.read`, `identity.users.manage`, `identity.roles.manage`, `identity.org.manage`, `identity.settings.read`, `identity.settings.manage`, `identity.audit.read`). Admin-only (never in a custom role): `identity.users.manage`, `identity.roles.manage`.
- System roles: ADMIN (all codes), ACCOUNTANT (`identity.settings.read`, `identity.audit.read`), OFFICE, PROCUREMENT, WAREHOUSE, HR, POS_CASHIER, SALES_REP, DRIVER (empty until their modules add codes). Read-only in the UI and the API (`ROLE_SYSTEM_READONLY`).
- **Adding a permission in a later module:** add the code to `PERMISSIONS`, its label under `permissions.*` in `packages/shared/i18n/mn.json` (the i18n test fails otherwise), the system roles that get it in `SYSTEM_ROLE_PERMISSIONS`; the api syncs the database at boot. Custom roles never gain a new code automatically.
- Invariants: the last active ADMIN cannot be disabled or demoted (`LAST_ADMIN`, serialised by `SELECT … FROM roles WHERE code = 'ADMIN' FOR UPDATE`); nobody edits their own roles, scopes or status (`SELF_EDIT_FORBIDDEN`); a role with users cannot be deleted (`ROLE_IN_USE`).

## 5. Settings keys (`@tugeel/shared/settings`)

| Key | Kind | Default |
|---|---|---|
| `tax.vat_rate_pct` | percent string, 0–100, ≤ 2 decimals | none (`SETTING_MISSING`) |
| `tax.city_tax_rate_pct` | percent string | none |
| `company.vat_payer`, `company.city_tax_payer` | boolean | none |
| `auth.staff_session_hours` | integer 1–168 | 12 |

Adding a key: extend `SETTINGS` and add `settings.keys.<key>` to `mn.json`; nothing else (the screen renders every key).

## 6. Authentication facts (ADR-0027)

- argon2id (production m = 19 MiB, t = 2, p = 1) over NFC-normalised passwords; ≥ 8 characters, different from the username, no expiry. A dummy hash keeps unknown users as slow as known ones.
- Login failures: 5 per IP + username or 30 per IP in a rolling 15 minutes → 429 `TOO_MANY_REQUESTS` with `params.retryAfterSeconds` (in-memory; one api process). 20 consecutive failures lock the account for 15 minutes (423 `ACCOUNT_LOCKED`; an admin can unlock). `ACCOUNT_DISABLED` is returned only after a correct password.
- Access JWT: HS256, 15 minutes, claims `sub`, `sid`, `kind`, `iss = tugeel`, `aud = tugeel-api`. Each request re-reads session, status, permissions and scopes in one query, so logout, disabling, role changes and session revocation act immediately.
- Session lifetime: `auth.staff_session_hours` from the login; refresh never extends it (401 `SESSION_EXPIRED` afterwards).
- Admins never learn passwords: they issue a one-time code (Crockford base32 `XXXXX-XXXXX`, 30 minutes, 5 attempts, a new code revokes the old one).

## 7. Error codes introduced

`INVALID_CREDENTIALS` 401, `ACCOUNT_LOCKED` 423, `ACCOUNT_DISABLED` 403, `SESSION_EXPIRED` 401, `PASSWORD_CODE_INVALID` 400, `PASSWORD_TOO_WEAK` 422, `CURRENT_PASSWORD_INCORRECT` 400, `LAST_ADMIN` 409, `SELF_EDIT_FORBIDDEN` 409, `ROLE_SYSTEM_READONLY` 409, `ROLE_IN_USE` 409, `WAREHOUSE_KIND_NOT_ALLOWED` 422, `SETTING_NOT_EDITABLE` 409, `SETTING_MISSING` 409, `DUPLICATE_VALUE` 409 (any unique violation, `params.constraint`), `IDEMPOTENCY_KEY_IN_PROGRESS` 409. `FORBIDDEN` carries `params.reason`: `NO_ACCESS_RULE`, `PERMISSION` or `WAREHOUSE_SCOPE`; `UNAUTHORIZED` carries `TOKEN`, `SESSION` or `REFRESH`.

## 8. Audit actions

`CREATE`, `UPDATE`, `DELETE`, `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `LOGOUT_ALL`, `PASSWORD_SET`, `PASSWORD_CHANGED`, `PASSWORD_CODE_ISSUED`, `UNLOCK`, `SESSIONS_REVOKED`, `TOKEN_REUSE`, `ADMIN_RECOVERED`. Entities: `users`, `roles`, `branches`, `warehouses`, `settings`, `auth_sessions`. A new action or entity needs its label under `audit.actions` / `audit.entities` in `mn.json` (the audit screen falls back to the raw code).

## 9. Screens (`apps/web`)

`/login`, `/set-password` (one-time code), `/account` (password change, sign out everywhere), `/users` and `/users/:id` (`identity.users.read`; edit actions need `identity.users.manage`), `/roles` (`identity.users.read`), `/branches`, `/warehouses` (any user; menu entry and edits with `identity.org.manage`), `/settings` (`identity.settings.read`), `/audit` (`identity.audit.read`). The menu hides entries the user lacks; the API is authoritative.

## 10. Operations

- First admin and recovery: `pnpm user:create-admin --username <name> --full-name "<full name>"` creates the user (or re-activates, unlocks and re-grants ADMIN to an existing one) and prints a one-time code valid for 30 minutes, shown in Ulaanbaatar time.
- Environment (api only): `JWT_SECRET`, `AUTH_PEPPER` (≥ 32 characters, `dev-` values refused in production), `COOKIE_SECURE` (true behind HTTPS), `API_PORT` (3000 in the container, 3300 locally); rotation effects in `deploy/runbook.md` §9.

## 11. Tests

Integration (`apps/api/test/integration/`): `identity-schema`, `identity-core`, `auth`, `users-roles`, `org-settings-audit`, `create-admin`. Integrity (`apps/api/test/integrity/`): `audit-log-guard`, `numbering`, `auth-concurrency` (parallel refreshes, parallel failed logins), `last-admin`, `idempotency`. Web: `apps/web/src/features/auth/auth-pages.test.tsx`, `apps/web/src/features/identity/identity-pages.test.tsx`, `apps/web/src/lib/auth/auth-session.test.ts`.

## 12. Open items

- `0002_identity_files` + `StorageService` (local driver) at the start of the catalog session.
- inventory binds `WAREHOUSE_CREATED_HOOK` (system bins) in week 3 and must backfill the bins of warehouses created before that (TRANSIT and any created during development), e.g. in its first migration or an idempotent boot step.
- Housekeeping jobs (expired sessions, used or expired password codes, idempotency keys older than their replay window) are not scheduled yet; add them with the first pg-boss schedule (SPEC §8.2 cut line) or in the go-live phase.
- Customer authentication (`/auth/customer/*`, phone identity) belongs to `partners` and the customer app (delivery 6).
