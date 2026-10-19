# ADR-0082: The customer app's server — accounts and sessions in identity, one `customer` facade module, order and payment events by hooks

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-19 |
| Deciders | Owner (the plan approved 2026-10-19), Claude (Claude Code session, CA2) |
| Implements | ADR-0079 (#2–#8, #11, #14): the server side of «Bto300» |
| Amends | architecture §4 (`customer_users` moves from the partners row to identity; a new `customer` module; notifications depends on finance), §7 (a fourth route decorator), §12; ADR-0062 #4 (a second sales hook beside `SALE_LISTENER`); CLAUDE.md (the route-decorator rule) |

## Context

ADR-0079 decided what the customer app does; it did not say which module owns the accounts, how the guard tells a store from a staff member, or how the order, payment and invoice events reach the store's notifications without the modules importing each other. The code of 2026-10-19 (cd697d5) had:

- identity: staff-only sign-in. `auth_sessions.user_id` referenced `users`; the guard accepted only `kind: 'STAFF'`; the idempotency interceptor stored `actor_kind 'STAFF'`. `audit_log.actor_kind` already allowed `CUSTOMER`.
- architecture §4 listed `customer_users` under partners "for delivery 6", although partners cannot reach the guard, the sessions or the token rotation, all in identity, which imports no module.
- sales told notifications only of a sale (`SALE_LISTENER`, one listener); finance told nobody of a payment.
- the rep app's facade lived in sales and was not exported.

## Decision

1. **Identity owns the customer accounts and their sessions.** `customer_users` (one per customer, one per phone), `customer_password_codes` (the office's one-time codes) and `auth_sessions.kind` STAFF / CUSTOMER with `customer_user_id` (a CHECK ties each kind to its principal; staff refresh, logout and the per-request access query read STAFF rows only). `customer_users.customer_id` is a plain column in identity's schema; migration `0031_customer_app` adds its foreign key to `customers` by hand (identity imports no module). Partners binds identity's `CUSTOMER_ACCOUNT_GATE` ("is this customer ACTIVE"), which sign-in, code redemption and refresh ask (fail closed while unbound), and ends the account's sessions when a customer becomes inactive. The office's «Апп» card routes live in partners (`/customers/:id/app-account`, `partners.customer_app.manage`) and call identity's `CustomerAccountsService` inside partners' transaction, after locking the customer row.
2. **Two kinds of token, never interchangeable.** A customer token carries `kind: 'CUSTOMER'` and its own audience `tugeel-customer`. A route is `@Public()`, `@Authenticated()`, `@RequirePermission(...)` or **`@CustomerRoute()`** (the fourth rule); the global guard answers 403 `FORBIDDEN` with `reason: CUSTOMER_TOKEN` to a customer token on any staff route and `STAFF_TOKEN` to a staff token on a customer route (403, never 401, so no client refreshes in a loop); a route with no rule or with both kinds fails closed. `@CurrentCustomer()` gives a `CustomerContext` (the account, the token's own store, the session, the phone); no customer route takes a customer id from the client.
3. **`CustomerActor` is not an `Actor`.** Sales' rights code trusts every non-staff actor as a system caller, so a customer must never pass as one: `AuditActor = Actor | CustomerActor` is taken only by the audit (`actor_id` = the account) and by `SalesOrdersService.createInTx` (`created_by` NULL, `customer_user_id` set, events labelled `customer-app`); the idempotency interceptor keys CUSTOMER requests by the account.
4. **One leaf module `customer`** holds every `/customer-app/*` route (ADR-0079's "one set of customer routes"), the store's favourites (`customer_favourites`) and the company contact list (`company_contacts`, `/customer/contacts` for admins). It reads the owners' public services only (sales' exported shop read model and order history, finance's customer reads, notifications' customer inbox); nobody imports it (ESLint).
5. **Events by hooks, as ADR-0060 and ADR-0062 do.** Sales adds `ORDER_LISTENER` (`onConfirmed` with the backordered lines, `onCancelled` with the reason) beside `SALE_LISTENER` (which now carries the invoice's id and total); finance adds `PAYMENT_LISTENER` (`finance/hooks.ts`, a customer payment with the invoices it settled). Notifications binds all three and writes `customer_notifications` (one row per kind and document, `ON CONFLICT DO NOTHING`, never caught) for stores that have an account; its morning job `notifications.invoiceReminders` (09:00) reads finance's open invoices. `MODULE_DEPS.notifications` gains `finance` (the hook token, the invoice and payment foreign keys, the read); finance and sales never import notifications.
6. **The owner's defaults of 2026-10-19** (approved with the plan): a phone change clears the password and ends every session (a new code follows); order notifications for every order of a store with an account, from every channel; reminders «due soon» for an open invoice due within 3 days and «overdue» for one 1–7 days past due, once each; the sign-in phone is an app order's contact; the admin's home warns only while at least one account is active; «үлдсэн боломж» = the limit less the balance and the confirmed orders not yet invoiced, never below 0; an order without lines (an office draft just opened) is not shown to the store.
7. **An accepted limit.** «Зарим нь хойшилж магадгүй» (ADR-0079 #4) tells whether a quantity exceeds the free stock, so a store could narrow the number down by trying quantities; the warning is what ADR-0079 asks for, so it stays.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| `customer_users` in partners (architecture §4's plan) | The guard, the sessions and the token rotation are identity's; partners would need a hook back into identity on every request. |
| A separate `customer_sessions` table | Duplicates the rotation, grace and reuse logic; ADR-0079 #3 asks for kind CUSTOMER in `auth_sessions`; the CHECK keeps the principals apart (ADR-0005 #2). |
| `CUSTOMER` as a third kind of `Actor` | Every staff service taking an `Actor` would accept a customer; sales would treat it as a trusted system caller. |
| A customer facade in each module | ADR-0079 rejected it: the token's own store would be checked in many places. |
| Notifications reading sales and finance tables | Couples the modules both ways; the hooks hand the facts over by value, as the sale already does. |

## Consequences

- Positive: one place decides who may call what; a sweep over the whole OpenAPI document (`test/integrity/customer-isolation.spec.ts`) proves every staff operation refuses a customer token and every customer operation a staff token, and that no route escapes the document.
- Positive: the app (CA3) reads only `/auth/customer/*` and `/customer-app/*`.
- Negative: a customer's own status is checked at sign-in and refresh; an access token already issued lives its 15 minutes after the office closes the customer only if the session survived — deactivation ends the sessions, so in practice the next request is refused.
- Follow-ups: CA3 (the app's screens); push with go-live; a customer's centre when Kharkhorin joins (ADR-0079 follow-ups).

## Related

ADR-0005, ADR-0027, ADR-0060, ADR-0061, ADR-0062, ADR-0079, ADR-0080, `docs/modules/customer.md`, `docs/modules/identity.md`, architecture §4, §7.
