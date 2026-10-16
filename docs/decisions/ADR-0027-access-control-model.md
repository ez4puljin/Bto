# ADR-0027: Access control model: code-defined permissions, per-request resolution, write-only scopes

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-10 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0005 #1 (libraries, token claims), ADR-0002 #5 (how the actor reaches the audit row), ADR-0004 #5 / `docs/architecture.md` §6 (scope of an idempotency key) |
| Amended by | ADR-0061 (#8: `/auth/mobile/*` carries the refresh token in the JSON body for native clients, beside the web's cookie; a request with an `Origin` header is refused there) |

## Context

The `identity` module is the first business module (delivery 1). ADR-0005 fixed the shape of authentication (argon2id, 15-minute access JWT, rotating refresh tokens per device, permission strings, optional branch/warehouse scope) and named `@nestjs/passport`. The interview of 2026-10-10 added three owner rules: fixed system roles plus roles the admin builds from a permission list; a warehouse or branch scope limits only what a user may write (every warehouse stays readable); a staff login lasts one 12-hour shift, changeable in settings.

Facts found while planning: `passport` (0.7.0, 2023) and `passport-jwt` (4.0.1, 2022) are dormant, while `@nestjs/jwt` 12.0.2 supports NestJS 12. The test harness truncates every `public` table at the start of each test file, and the Jest `globalSetup` graph (`src/db/migrate.ts`) must not import `@tugeel/shared`. An `AsyncLocalStorage` store set in Express middleware loses its context in body-parser stream callbacks. The system has about 50 staff users.

## Decision

1. **Authentication** is one global `AuthGuard` built on `@nestjs/jwt` (no passport). Access tokens are HS256, live 15 minutes and carry only `sub` (user id as a string), `sid` (session id), `kind` (`STAFF`), `iss` and `aud`. Verification pins `algorithms: ['HS256']`, issuer and audience, with a 5-second clock tolerance.
2. **Per-request resolution.** On every authenticated request the guard reads session validity, user status, effective permissions and scopes in one query, without a cache. Logout, disabling a user, revoking a device and changing roles take effect on the next request.
3. **Fail closed.** Every route carries exactly one of `@Public()`, `@Authenticated()` or `@RequirePermission(...codes)` (all listed codes required). A route without any of them answers 403. A missing permission and a write outside the user's scope both answer 403 `FORBIDDEN` with the reason in `params`.
4. **Catalog in code.** Permission codes, system roles and their permission sets live in `@tugeel/shared/auth`. The api process syncs them into `permissions`, `roles` and `role_permissions` at boot, under an advisory lock, together with the single `TRANSIT` warehouse. A migration never seeds them, so test truncation is repaired by booting the app and `migrate.ts` stays free of shared code. A code is never a segment prefix of another, because it doubles as an i18n key.
5. **Custom roles.** An admin may create roles with a name and any subset of the catalog except the admin-only codes `identity.users.manage` and `identity.roles.manage`. Managing users and roles therefore stays with the ADMIN system role, and no permission-escalation path exists. System roles cannot be edited. Custom roles do not receive permissions added later.
6. **Last admin.** Every transaction that changes a user's status or roles first locks the ADMIN role row (`FOR UPDATE`) and then checks that at least one ACTIVE user keeps it (`LAST_ADMIN`). Nobody may change their own roles, scopes or status (`SELF_EDIT_FORBIDDEN`).
7. **Scopes limit writes only.** `user_scopes` rows (a warehouse or a branch, which covers all of its warehouses) restrict which warehouses a user may write documents for. A user without scope rows is unrestricted. Reads are never filtered by scope. The `TRANSIT` warehouse is always writable, because transfers pass through it. Writers call `ScopeService.assertCanWriteWarehouse(ctx, warehouseId)`.
8. **Staff sessions.** A session expires a fixed time after login: setting `auth.staff_session_hours`, default 12. Refreshing never extends it.
   - **Rotation.** Refresh tokens are rotated on every use.
   - **Grace window.** A token presented again within 20 seconds of its rotation receives a new access token without rotation (two tabs racing).
   - **Reuse.** A token presented later than that revokes the session and is audited.
   - **Storage.** The web keeps the refresh token in an httpOnly, `SameSite=Strict` cookie limited to `/api/v1/auth`.
   - **CSRF.** Refresh and logout also require an `Origin` that matches `Host`, and the API accepts only JSON request bodies.
9. **Passwords.**
   - **Hashing.** Passwords are argon2id over NFC-normalised text, at least 8 characters, never equal to the username, with no expiry.
   - **Setup and reset.** An admin never knows or sets a password: the admin issues a one-time code (30 minutes, 5 attempts, HMAC-SHA256 with `AUTH_PEPPER`, one live code per user), and the user sets their own password with it.
   - **Throttling.** Failed logins and failed code redemptions are counted per IP and username: after 5 failures in a rolling 15 minutes that pair waits until the window frees up (30 failures per IP across usernames), and successful logins are never counted.
   - **Lockout.** After 20 consecutive failures the account locks for 15 minutes, and an admin can unlock it.
   - **Uniform answers.** Wrong password, unknown user and a user without a password get the same 401.
10. **Explicit actor.** Controllers pass the `AuthContext` from `@CurrentUser()` into services as a parameter, and services pass it to `AuditService.record(tx, actor, entry)`. No async context is used.
11. **Idempotency keys** are unique per `(actor_kind, actor_id, key)`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `@nestjs/passport` + `passport-jwt` (ADR-0005 as written) | Dormant dependencies, an extra strategy layer and global Express type changes for one JWT check. |
| Permissions and scopes inside the JWT | Changes would take up to 15 minutes to apply. Three indexed lookups per request are cheap at this scale. |
| Seeding roles and permissions in a migration | Wiped by the per-file test truncation, and every new permission would need a data migration. |
| Subset-based anti-escalation for custom roles | More code and more tests than keeping the two admin-only codes out of custom roles. |
| Session lifetime sliding with every refresh | The owner chose a fixed shift length. |
| `AsyncLocalStorage` request context for audit actors | Loses context through body-parser streams; explicit parameters are testable. |

## Consequences

**Positive.**
- Revocation and permission changes are immediate.
- New modules add permissions in one shared file.
- Every route has an explicit access rule that is tested as fail-closed.
- No passport dependencies.

**Negative.**
- One extra query per request (session, status, permissions and scopes in a single statement).
- Custom roles miss permissions added by later modules, so the admin must update them by hand.
- The 20-second grace window lets a stolen previous token mint access tokens for at most 20 seconds.

**Follow-ups.**
- Delivery 1, identity: implement and test as listed in `docs/modules/identity.md`.
- Each later module adds its permission codes and system-role grants in `packages/shared/src/auth/index.ts`, plus their `mn.json` labels.
- Delivery 6 adds customer sessions (`kind = CUSTOMER`) with their own lifetime.

## Related

ADR-0002, ADR-0004, ADR-0005, ADR-0011, ADR-0016, ADR-0020, ADR-0026, `docs/architecture.md` §6, §7, `docs/SPEC.md` §3, §5.1.
