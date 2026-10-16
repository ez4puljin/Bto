# ADR-0062: App notices v1 — the admin's notices in the sales-rep app, and the rep's sold orders

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-16 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0061 (#1: the app gains a notice popup, a notifications screen, a notice's products and a bell on «Профайл»), ADR-0060 (#1: a third sales hook beside the credit checker and the sale sink) |

## Context

The owner approved a design of the sales-rep app in which a notice pops up in the middle of the screen when the app opens: «Ийм бараа урамшуулалтай боллоо. Үнэ хямдарлаа гэх мэт». The owner then asked: «үндсэн код дээр app-ийн notification бэлдэж илгээдэг болго». The admin should write notices in the Bto web and send them to the app.

What the code offered (2026-10-16):

- The `notifications` module of architecture §4 was planned for push and SMS in deliveries 5–6. No code existed and no table was created.
- The app (ADR-0061) refreshes its data with TanStack Query and has no push setup. Push would need EAS, an FCM project and a Google account, which wait for go-live (ADR-0061 #2).
- A sale stage issues the invoice in the same transaction (ADR-0060 #3). Nothing told the rep that their order was sold.

The owner's answers (2026-10-16, one structured round):

- **Delivery:** inside the app. A popup when the app opens, a count on a bell, and a list. No push.
- **Recipients:** every sales rep.
- **Content:** the admin writes each notice by hand.
- **Order notifications:** «Зөвхөн борлуулалт болсон захиалгын мэдэгдэл авна». The rep is told only when their order reaches the sale.

## Decision

1. **A notice.** Each notice has:
   - a kind: «Урамшуулал», «Үнэ хямдарлаа», «Шинэ бараа» or «Мэдээ»;
   - a title (≤ 80 characters) and a text (≤ 1,000);
   - one optional picture (JPEG, PNG or WebP, ≤ 1 MB, public like product photos);
   - up to 20 products, kept in the admin's order;
   - a first day (today or later, Ulaanbaatar date) and an optional end (the day after the last day — the project's date rule; the web shows the last day);
   - «Апп нээхэд голд харуулах» — whether it pops up.

   A sent notice is never edited. «Буцаах» withdraws it and it leaves the app at once. To correct a notice, withdraw it and send a new one.
2. **Recipients.** Every active user who holds `sales.orders.rep` when the app asks. A rep added later sees the notices that are still running. The admin's count «12/15 уншсан» counts active users who hold the permission through a role other than ADMIN; an admin trying the app reads the notices without being counted.
3. **On the phone.**
   - The app reads a summary when it starts, when it returns to the foreground, and every 60 seconds for the bell's count.
   - Unread pop-up notices that are running appear one by one in the middle of the screen, but only when the app starts or returns to the foreground, never from the 60-second refresh. They do not appear over the cart's sending or the camera.
   - Closing a notice counts as reading it: it does not pop up again, the bell's count drops, and it stays in the list. The design's «Өнөөдөр дахин харуулахгүй» tick is left out.
   - «Бараа харах» opens the notice's products, priced and stocked as in «Бараа».
   - The notifications screen merges the running notices with the rep's own notifications, newest first, grouped by day.
4. **The rep's sold orders.**
   - Sales gains a third hook, `SALE_LISTENER` (`sales/hooks.ts`), with a single listener.
   - `saleInTx` calls it inside the sale's transaction, after the invoice (or without one when finance is absent) and before the SALE audit row. It passes, by value: the order id and number, the channel, the author, the customer, the order's total frozen at the submit, and the invoice number.
   - Notifications answers with one `INSERT … ON CONFLICT DO NOTHING` into `user_notifications`, only for a `SALES_REP` order with an author. The insert is never wrapped in a catch: a failed statement aborts the PostgreSQL transaction anyway.
   - The app shows the amount as «Захиалгын дүн», with the invoice number.
5. **Rights.** A new permission `notifications.send` («Апп мэдэгдэл илгээх») for writing, listing and withdrawing notices. ADMIN holds it, and it can be given to a custom role. The app's routes `/me/notifications*` are `@Authenticated()`; their notices are filtered to `sales.orders.rep`. Architecture §4 keeps `/me/notifications` for drivers and customers later.
6. **Module boundaries.** These are the first tables of `notifications`: `app_notices`, `app_notice_products`, `app_notice_reads` and `user_notifications`.
   - It now depends on `sales`, for the hook token, its payload type and the order foreign key, and on `catalog`, for the products.
   - Nobody imports `notifications`; sales finds the listener through `ModuleRef` (`strict: false`) and does without it when the module is not loaded.
   - Push tokens, templates and SMS stay planned for deliveries 5–6.
7. **Not now:**
   - push or lock-screen notifications;
   - sending by zone, branch or person;
   - editing a sent notice;
   - automatic promotion or price notices;
   - notifications for other order states;
   - the new design of the other app screens.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Push through Expo / FCM now | Needs EAS, an FCM project and a release key before go-live (ADR-0061 #2); the owner chose in-app delivery. |
| One row per recipient when a notice is sent | Reps added later would miss running notices; reads alone (`app_notice_reads`) give the same counts. |
| A «don't show again today» tick | Closing already counts as reading; a second rule for the same popup confuses more than it helps. |
| Notifications reading `sales_orders` to find sold orders | Couples the modules both ways; the sale already hands finance a snapshot by value, and the listener follows the same pattern. |
| A try/catch around the listener so a failure never blocks a sale | A failed statement aborts the PostgreSQL transaction (25P02), so catching it cannot save the sale; the insert is one statement that cannot conflict. |
| Editable notices | A notice already read would change under the rep; withdraw and send again keeps what each rep saw. |

## Consequences

- The app gains a pop-up route, a notifications screen, a notice's products and a bell on «Профайл» (`docs/modules/mobile.md`).
- The web gains «Систем» → «Апп мэдэгдэл» (`/system/app-notices`), with a phone preview in the create dialog.
- Every sale of a rep's order writes one more row inside its transaction.
- Architecture §4 changes: the `notifications` row lists the new tables, and `MODULE_DEPS` adds `sales` and `catalog` to `notifications`.
- `@tugeel/shared/notifications` holds the kinds and limits that the API, the web and the app share.

## Related

ADR-0006 (one Expo codebase), ADR-0027 (permissions), ADR-0030 (file storage), ADR-0056 … ADR-0057 (the sale stage), ADR-0060 (the sales hooks), ADR-0061 (the sales-rep app).
