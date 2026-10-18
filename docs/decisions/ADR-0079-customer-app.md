# ADR-0079: The customer app «Bto300» v1 — linked stores only, phone and password without SMS, orders the office confirms, the store's full account

| | |
|---|---|
| Status | Accepted (built after the `rep-app` branch lands on `main`) |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0005 (#2: one store has one app account, `customer_users.customer_id` unique; #4–#6: phone + password only, codes issued by the office, no SMS OTP and no rep reset), ADR-0006 (#1: the customer variant is Android first as a locally built APK, iOS and the store listings at go-live; #3: no EAS before go-live, as ADR-0061 #2 does for the staff variant), ADR-0055 and ADR-0057 (the `CUSTOMER_APP` channel lands only on a stage without an action; the office confirms), ADR-0062 (notices get an audience: sales reps or customers), architecture §7 (customer sign-in), §8 (the customer variant) |
| Related | ADR-0080 (no QPay anywhere, decided in the same interview) |

## Context

SPEC §9.3 put the customer app in delivery 6: SMS OTP sign-in, a catalog with the customer's own prices, a cart with server quotes, idempotent orders, tracking, invoices and balance, QPay, push. Since then:

- Prices are the same for every customer (ADR-0041, ADR-0048); there is no "own price list".
- The sales-rep app (ADR-0061, ADR-0062, ADR-0068) built the Expo project (`apps/mobile`, SDK 57, the `staff` variant), the native token transport (`/auth/mobile/*`), the shop, cart, checkout and order screens, in-app notices, the local APK build and the design kit. It lives on the `worktree-rep-app` branch and is not on `main` yet.
- Finance I (ADR-0060) issues invoices at the sale and keeps the receivables ledger, `customer_balances`, payments and allocations.
- No SMS provider or QPay merchant contract was signed (Week 0 #6, #8).

The owner's answers (2026-10-18, six rounds):

- **Who:** only stores already in the system; the office links a phone to the customer's card. No self sign-up.
- **Sign-in:** phone + password only, never SMS; a forgotten password is a new code from the office. **One phone — one store**, both ways.
- **Phones:** Android first.
- **Centres:** one centre for now (Оргил Бөөний төв, Mörön); Kharkhorin joins later.
- **Stock:** «available / low / out», never the number.
- **Money:** the full account — the debt, the overdue amount, open invoices with due dates, payments, the credit limit and what remains.
- **Orders:** every order of the store (office, rep and app), with its progress and backordered lines.
- **Receiving:** delivery or pickup, and the day.
- **Confirmation:** the office checks the app's orders and confirms them.
- **Payment method:** the customer chooses cash, bank transfer or credit.
- **After sending:** no edits and no cancelling by the customer (they call the office).
- **QPay:** none, in the app or anywhere else (ADR-0080).
- **Notifications:** inside the app now, push later; order progress, the admin's notices and payment reminders.
- **v1:** ordering + the account + notifications, plus repeating an earlier order, favourites and barcode scanning.
- **A blocked customer** (hold, overdue invoice, over the limit) is warned and may still send; the office's confirmation refuses it as today.
- **Name:** «Bto300». **Look:** the rep app's design (ADR-0068). **Codes:** issued by the office on the web only. **Timing:** after the rep app is merged into `main`.

## Decision

1. **Scope of v1.** The `customer` variant of `apps/mobile` (ADR-0006 #1), named «Bto300», for Android. Screens: sign-in and setting the password with the office's code; «Нүүр»; «Бараа» (search, categories, filters, barcode camera, favourites); a product; «Сагс»; checkout; «Захиалга» (the store's orders, an order's page, «Дахин захиалах»); «Тооцоо» (the account, invoices, payments, the company's bank accounts); notifications (a bell and a popup); «Профайл» (the store, the password, sign-out). Not in v1: paying in the app (ADR-0080), push, iOS, self sign-up, editing or cancelling an order, a minimum order amount, a second centre.

2. **Accounts.** `customer_users` (ADR-0005 #2): id, `customer_id` unique, `phone` unique in E.164 (`+976` + 8 digits, `@tugeel/shared/phone`), the argon2id password hash, status ACTIVE / DISABLED, `last_sign_in_at`, created and changed by staff with audit rows. Only the office creates them, on the customer's page: one active store per phone and one phone per store. An archived or inactive customer cannot sign in. The phone is not one of the customer's contact phones; nothing copies one into the other.

3. **Sign-in without SMS** (amends ADR-0005 #4–#6).
   - Phone + password with the staff rules (ADR-0027: at least 8 characters, argon2id over NFC text, the per-IP + phone failure limiter, a 15-minute lock after 20 failures).
   - The office presses «Код үүсгэх» on the customer's page and reads the code to the customer: a one-time code of 30 minutes and 5 attempts (HMAC with `AUTH_PEPPER`, as staff codes). In the app the customer types the phone, the code and the new password. A forgotten password is a new code; setting a password ends the account's other sessions.
   - Sessions use the native token transport (ADR-0061 #4) with kind CUSTOMER in `auth_sessions`. A customer session lasts until sign-out or 90 days without use (Claude's default; a setting `auth.customer_session_days`). «Аппыг хаах» on the customer's page disables the account and ends its sessions.
   - A customer token reaches only the customer routes; every staff route refuses it, and the customer routes refuse a staff token. The customer is always the token's own store: no route takes a customer id from the client.
   - **No SMS in the system:** `integrations/sms`, `sms_log` and the SMS templates are dropped from the plan, the Week 0 SMS contract (#8) is not needed, and SPEC §11 #8 is closed.

4. **The shop.**
   - **Products:** every ACTIVE, sale-ready product with a home warehouse, as the rep app shows (one centre today). When the second centre joins, a customer gets a centre and sees its warehouses' products; that is a new decision then.
   - **Prices:** the wholesale unit prices and the server's quotes (`POST /pricing/quote` through the customer routes); the app never computes a price (ADR-0006 #6). Discounts appear in the cart as the server applies them.
   - **Stock in three words:** «Байгаа», «Цөөхөн үлдсэн», «Дууссан» from the home warehouse's available quantity. The number never reaches a customer token. «Цөөхөн» means below the product's minimum level in its home warehouse (ADR-0039) when one is set, otherwise below one full pack (ADR-0048), or 10 base units for a product without a pack (Claude's default). A product that is «Дууссан» cannot be added. A cart quantity above the available quantity shows «Зарим нь хойшилж магадгүй»: the real reservation happens when the office confirms.
   - **Favourites:** a star per product, kept on the server per customer account (a new phone keeps them), with their own filter in «Бараа».
   - **Barcode:** the rep app's camera path (ADR-0061, `useScanner`'s camera half); a box barcode opens the box unit.

5. **Sending an order.**
   - The checkout chooses «Хүргэлтээр» (the store's default address, or another of its live addresses) or «Өөрөө авна» (from the home warehouse), the day (today, tomorrow, the day after, or another day within 60 days), the payment method (cash, bank transfer, credit) and a note. The send carries an Idempotency-Key that survives a lost answer (ADR-0061 #8).
   - The order is created on the `CUSTOMER_APP` channel on that channel's default stage (`sales_channel_defaults`, ADR-0057). That stage must have **no action**: the channel settings refuse a CONFIRM or other action stage for `CUSTOMER_APP`, and without a default the app refuses to send («Захиалга хүлээн авах тохиргоо хийгдээгүй байна») and the admin's home shows a warning. The order gets its number at creation (ADR-0057) and waits: no prices frozen, no reservation, no credit check.
   - The office opens it in the order panel, may correct its lines and header, and moves it to a CONFIRM stage: the prices are resolved again and frozen, the credit check runs with no tolerance (ADR-0060 #2), the stock is reserved and the rest backordered (ADR-0055). The customer sees what was confirmed.
   - The customer never edits or cancels a sent order; the office cancels it with a reason, which the customer sees.
   - **Credit warning:** before sending, the checkout shows the store's credit state from the server — a hold («Зээл хаалттай»), an overdue amount, or the amount over the limit — and still allows sending. The hold's internal reason is never shown.

6. **The store's orders.** Every order of the store, from every channel, newest first by day, with its stage put into the customer's words: «Хүлээгдэж буй» (not confirmed yet), «Батлагдсан», «Бэлтгэж буй», «Бэлэн», «Хүргэгдсэн», «Цуцлагдсан» (with its reason). An order's page shows its lines, the backordered quantities and, once sold, the invoice. Archived orders stay visible to the customer. «Дахин захиалах» puts an earlier order's lines into the cart at today's prices; products that are inactive, not sale-ready or «Дууссан» are skipped with a note.

7. **«Тооцоо».** From finance's own records, read-only: the balance (a debt, or an advance), the overdue amount and the oldest due date, the credit limit and what remains of it (only when a limit is set; nothing about limits otherwise), «Зээл хаалттай» without its internal reason; the open invoices (number, date, due date, amount, open amount, days overdue) and an invoice's lines; the store's payments, newest first, with the invoices they settled. The company's bank accounts that the finance settings mark «Харилцагчид харуулах» (a new flag on `money_accounts`) are shown with the advice to write the invoice number in the transfer's description (SPEC §6.12 #3). Payments are recorded only by the accountant (SPEC §6.12 #1).

8. **Notifications inside the app** (the feed and the popup of ADR-0062, per customer account): the order confirmed (with its backordered lines), cancelled (with the reason), sold (the invoice number and amount); a payment recorded; an invoice due in 3 days; an invoice overdue (once, the day after its due date); the admin's notices addressed to customers (a notice gets an audience: sales reps or customers). No push before go-live; Expo push with Firebase comes then (row 12). No SMS.

9. **The look.** The rep app's design kit and tokens (ADR-0068): the floating tab bar, the two-card product grid, the cart rows, the checkout cards, the grouped lists, Inter, the 1.15 font-scale cap. The map, the customer picker and the order-placement settings are left out; «Тооцоо» and favourites are added. The screens are drawn first as boards in an artifact and approved by the owner before they are built.

10. **Build and install.** One Expo project; `APP_VARIANT=customer` sets the name «Bto300», the package `mn.butenorgil.bto300` (TODO-VERIFY: permanent once handed out), the icon and the route group `app/(customer)`. Release APKs are built on the owner's PC with `pnpm mobile:apk` for the chosen variant (ADR-0061 #2). Development builds keep the server-address screen; a production build has its server fixed. iOS, the store listings, EAS and push come with go-live (row 12).

11. **The office's side.** The customer's page gets an «Апп» card: the phone, the status, the last sign-in, «Код үүсгэх», «Аппыг хаах / нээх». A new permission `partners.customer_app.manage` («Харилцагчийн апп») is held by ADMIN and OFFICE and may go into custom roles. The customer list gets an «Апп» column and filter.

12. **Order of work.** The `rep-app` branch lands on `main` first (its ADR-0061, ADR-0062, ADR-0068 and migration renumbering). Until then only the documents and the design boards are made. The build then runs as its own sessions (the plan in `docs/STATUS.md`).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| SMS OTP (ADR-0005 #4) | The owner wants no SMS at all; no provider is contracted; codes read out by the office work without one. |
| Self sign-up with the office's approval | The owner links stores themselves; strangers never reach the shop or the credit check. |
| Several phones per store, or one phone for several stores | The owner chose one phone — one store; the unique `customer_id` can be relaxed later by a new decision. |
| Orders confirmed at once, as the rep app's CONFIRM stage does | The owner wants the office to check every app order before stock is reserved. |
| Exact stock numbers | The owner does not show them to customers. |
| Editing or cancelling by the customer | The office handles changes by phone. |
| A separate customer facade in every module | One set of customer routes keeps "the token's own store" in one place; the modules still own their reads through their public services. |
| iOS now | Needs an Apple organisation account and cloud builds; most customers use Android. |
| Building on the `rep-app` branch now | That branch still changes daily; building on top would mean repeated rebases. |

## Consequences

**Positive.**
- Stores order at any hour without calling; the office keeps control of every order and every credit decision.
- No SMS or payment contract is needed; the system has fewer integrations to run alone.
- The app reuses the rep app's screens, session and send logic.

**Negative.**
- Every new password needs a call to the office.
- An app order reserves nothing until the office confirms it, so stock shown as «Байгаа» may be gone by then; backorders are the answer, as for every order.
- Customers see no instant payment confirmation; transfers wait for the accountant.
- Android only until go-live.

**Follow-ups.**
- After the `rep-app` branch lands: the design boards, then the build sessions (`docs/STATUS.md`).
- TODO-VERIFY (owner): the package id `mn.butenorgil.bto300`, a 1024×1024 logo, a release key.
- When Kharkhorin joins: a customer's centre (a new ADR).
- Go-live (row 12): push, iOS, store listings, EAS.

## Related

ADR-0005, ADR-0006, ADR-0027, ADR-0039, ADR-0041, ADR-0048, ADR-0055, ADR-0057, ADR-0060, ADR-0061, ADR-0062, ADR-0068, ADR-0080, `docs/architecture.md` §7, §8, `docs/SPEC.md` §3, §5.17, §6.
