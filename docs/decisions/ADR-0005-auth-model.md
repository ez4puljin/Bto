# ADR-0005: Self-hosted auth: JWT + rotating refresh tokens, permission strings, phone identity for customers

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-09 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0027 (#1: a custom guard on `@nestjs/jwt` instead of passport; the access token carries no permissions or scopes); ADR-0079 (#2: one app account per store; #4–#6: customers sign in with phone + password only, the office issues the codes, no SMS OTP and no rep reset) |

## Context

A few hundred staff accounts and a few thousand customer accounts (shops and individuals) are provisioned from Excel. There is no corporate SSO. Mongolian mobile phone numbers are the natural customer identity. Auth vendors add monthly cost, a second user store and a dependency the owner cannot debug. Customer-app login, password reset and the initial delivery of passwords to thousands of shops depend on an SMS channel whose provider has not yet been contracted; lead time for sender-name approval is outside the owner's control.

## Decision

1. **Libraries:** `@nestjs/passport` + `@nestjs/jwt`, password hashes with **argon2id**. Access JWT lifetime **15 minutes** (claims: `sub`, `kind` STAFF/CUSTOMER, permissions hash, scopes). **Rotating refresh tokens**, hashed per device in `auth_sessions` (revocable, device label, last seen); web keeps the refresh token in an httpOnly cookie, mobile in `expo-secure-store`.
2. **Two user tables.** `users` (staff; `username` + password) and `customer_users` (customers; `phone` + password, linked to `customers`). They never share ids or sessions.
3. **Phone numbers are stored in E.164** (`+976` followed by 8 digits) in `customer_users.phone` and `customer_contacts.phone`, validated by a Zod schema in `packages/shared`; the UI accepts local formats and normalises.
4. **Customer login flow.** Delivery 1 through delivery 5: phone + password, with the password set by provisioning. Delivery 6 (customer app): SMS OTP for login and password reset through a Mongolian SMS provider behind `integrations/sms` (`SmsProvider.send(phone, templateKey, params)`).
5. **SMS provider is selected and contracted in Week 0** (owner-driven registration list in `docs/STATUS.md`): operator API or aggregator, sender-name approval requested at the same time. Which provider is a business question (TODO-VERIFY), the integration shape is not.
6. **Non-SMS fallback exists from delivery 7 onward**: a sales rep with permission `partners.customer_users.reset` sets or resets a customer's initial password from the staff app during a visit, and the admin can do the same from the web. Customer onboarding never blocks on SMS delivery.
7. **RBAC by permission strings.** Roles (ADMIN, PROCUREMENT, WAREHOUSE, SALES_REP, DRIVER, POS_CASHIER, ACCOUNTANT, HR, CUSTOMER) expand to permission strings such as `catalog.write`, `inventory.post`, `sales.approve`, `sales.discount_manual`, `finance.payments.record`, checked by `PermissionsGuard` / `@RequirePermission`. `user_scopes` optionally limits a user to branches/warehouses. Row scoping: customers see own orders/invoices, drivers own trips, reps own customers.
8. **Audit log** on every write (ADR-0002); `helmet` + `@nestjs/throttler` on public endpoints; password-reset tokens in `password_resets` are single-use and expire in 30 minutes.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Better Auth | Good library, but another abstraction over the same tables; the NestJS passport pattern is the canonical, most-documented path. |
| Clerk / Auth0 | Monthly cost that scales with thousands of shop accounts; phone-OTP pricing for Mongolia unverified; vendor outage stops all sales. |
| Supabase Auth | Pulls a second platform into a stack that already has Managed PostgreSQL. |
| Keycloak | A Java server to patch and back up for one person. |
| SMS OTP from day one | Blocks delivery 1 on an uncontracted provider; passwords plus a rep-driven reset path are enough for internal and early customer use. |

## Consequences

**Positive.** Zero vendor cost, trivial per-device revocation, one place to reason about permissions, and an onboarding path that works even if the SMS contract slips.

**Negative.** The owner owns password-reset and OTP flows and their abuse protection (throttling, lockout). Permission strings must be kept in one enum in `packages/shared` and documented per screen.

**Follow-ups.**
- Week 0: SMS provider contract + sender name (owner).
- Delivery 1: identity module with `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `user_scopes`, `auth_sessions`, `password_resets`.
- Delivery 6: OTP endpoints and `integrations/sms`; delivery 7: rep-driven password reset.

## Related

ADR-0002, ADR-0004, ADR-0006, ADR-0015 (customer provisioning from Excel), `docs/architecture.md` §7, `docs/SPEC.md` §3.
