# ADR-0112: The supermarket's bonus card — members found by phone, points earned on money paid and spent with the member's PIN, tiers by lifetime spend

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-28 |
| Deciders | Owner, Claude (Claude Code session) |

## Context

The owner asked on 2026-10-27:

> «Хэрэглэгчийн бонус карт оффис дээр ирж бүртгэл үүсгэдэг, Касс дээр утасны дугаар болон пин кодоо хийж хөнгөлөлт хадгалах болон ашиглах сонголттой байна. Жишээ нь 10 сая хүртэл 1% хөнгөлөлт буюу оноо цуглуулдаг, 20 сая хүрснээр 2% автоматаар авдаг гэх мэт тохиргоотой байна. Тэгэхээр Бонус карттай харилцагчдын бүртгэл бас байх ёстой.»

ADR-0110 split the bonus card off from the coupons and partner vouchers. The till already has:
- payment types and rows (ADR-0111);
- CREDIT to a registered customer (ADR-0109);
- coupons and VOUCHER tenders (ADR-0110).

One store edge serves every till of the supermarket and sells offline (ADR-0063, ADR-0067). Kharkhorin is a separate installation (ADR-0084).

The owner answered in five rounds on 2026-10-27/28:

1. **Points, spent at will.** Every member sale earns points, and the customer chooses when to spend them. **1 point = 1 ₮.**
2. **Tiers by lifetime spend.** The spend counts from registration and never falls, except by returns. The admin sets the tiers freely: a name, a threshold in ₮ and a percentage.
3. **No expiry.**
4. **Points are earned on what is actually paid:**
   - after the discount programs and coupons;
   - nothing on points, partner vouchers or credit;
   - a sale paid partly with points still earns on its money part.
5. **No spending limit.** The customer spends any number of points, up to what is due.
6. **A new register of members**, apart from partners' customers:
   - required: name, phone and PIN;
   - optional: register number, birth date, gender and note.
7. **Phone and PIN only.** There is no card or barcode.
8. **The 4-digit PIN.**
   - It is needed only to spend points, not to earn them.
   - It is set and reset at the office only.
   - Five wrong tries lock the card for a while.
   - No supervisor's PIN is needed.
9. **Returns.**
   - The earned points are taken back by share. The balance may go below zero.
   - The spent points come back as points.
   - The lifetime spend falls too.
10. **The supermarket's till only.** No wholesale orders, rep app or «Bto300».
11. **Never with credit.** The card works together with coupons and partner vouchers.
12. **The books and e-Barimt, until the accountant answers:**
    - points are a payment form, like a voucher;
    - the receipt shows the full price;
    - earned points sit on a points liability.
13. **The balance is shown on the receipt and the cashier's screen.** There is no SMS and no app.
14. **Who may change what.**
    - A new permission «Бонус карт удирдах» (ADMIN, OFFICE).
    - Only the admin sets the tiers.
    - The admin may add or remove points by hand, with a reason. The lifetime spend does not change.

## Decision

1. **Tables at the centre** (`modules/pos`, migration `0051_pos_loyalty`).
   - `pos_loyalty_tiers`: name, `from_amount` (whole ₮), `percent` (0, 100], sort, status ACTIVE / INACTIVE.
     - The admin saves the list as a whole (`PUT /pos/loyalty-tiers`, `pos.manage`).
     - A tier left out is retired, never deleted. Active thresholds are unique.
     - There are no default tiers: nobody earns until the admin enters them.
   - `pos_loyalty_members`:
     - name; phone in E.164, one member per phone;
     - the PIN's argon2id hash, keyed with `POS_PIN_PEPPER` like a cashier's (`PinHasher`), and `pin_version`;
     - the optional fields;
     - status ACTIVE / BLOCKED;
     - the caches `balance` and `lifetime_spend`.
   - `pos_loyalty_entries`, append-only (REVOKE plus `forbid_update_delete` triggers):
     - kinds EARN, SPEND, RETURN_EARN, RETURN_SPEND and ADJUST;
     - signed whole `points` and `spend_delta`, with a CHECK per kind;
     - Σ points = balance and Σ spend_delta = lifetime spend (tested).
   - `pos_sale_loyalty`: one row per member sale or return.
     - It keeps the base, the percent, the points earned, spent, given back and taken back, the balance after, an `issue` and its review.
     - Members, tiers and these rows are never deleted.
2. **Rules shared by the centre, the edge and the kiosk** (`@tugeel/shared/pos` `loyalty.ts`).
   - `tierFor(lifetime, tiers)` takes the highest threshold reached, judged on the spend before the sale. The sale that crosses 20 M still earns 1 %; the next one earns 2 %.
   - `pointsEarned(base, percent)` rounds down to whole points.
   - `loyaltyEarnBase(tenders)` = CASH + CARD + TRANSFER amounts. These are the amounts applied, never the cash handed over.
   - `loyaltyReturn` settles a return:
     - points first, up to what the sale spent and was not given back yet;
     - then money;
     - clawback = HALF_UP(earned × money ÷ base), capped at what is left of the earned points;
     - spend delta = −money, capped at what is left of the base.
   - A new tender kind **POINTS** (`TENDER_KINDS`, the `pos_tenders_kind` CHECK; whole amounts). It is not a payment type the admin lists.
3. **The feed.**
   - The edge pulls `GET /api/v1/pos/sync/loyalty?since=` beside the customers and vouchers, every pull.
   - It carries the active tiers and every member: hash, PIN version, status, balance, lifetime. A content-hash version comes with it.
   - The edge keeps it in `edge_state.loyalty` (edge migration `0006_loyalty`).
4. **At the till** (the edge).
   - **Finding a member.** `GET /edge/v1/members?phone=` answers `EdgeMember`:
     - the masked phone, the tier and the next tier;
     - the balance and lifetime as this edge counts them: the feed's figures plus its own documents not yet counted (not replayed, or replayed after the feed was built);
     - otherwise 404 `POS_MEMBER_NOT_FOUND`.
   - **The PIN.** `POST /edge/v1/members/:id/pin-check` checks the member's own PIN against the feed's hash.
     - Five wrong ones in a row lock the card for **15 minutes** on this edge (`edge_member_pin_attempts`).
     - A new PIN from the office (a higher version) starts again.
     - The errors are `POS_MEMBER_PIN_INVALID` (401, with `attemptsLeft`) and `POS_MEMBER_LOCKED` (423).
   - **A sale.** `POST /sales` takes `member: { id, pin }` and at most one whole POINTS tender.
     - A blocked card answers 422 `POS_MEMBER_BLOCKED`. A member beside credit answers 422 `POS_POINTS_WITH_CREDIT`. Points without a member are refused.
     - Spending checks the PIN again.
     - Inside the sale's transaction the edge takes an advisory lock on the member and reads its balance again (two tills at once). Spending past it answers 409 `POS_POINTS_INSUFFICIENT` with `available`.
     - The doc carries `loyalty`. `edge_sales` keeps `member_id`, `points_amount`, `points_delta` and `spend_delta`.
     - The receipt gets a loyalty block.
   - **A return** of a member sale applies `loyaltyReturn`.
     - It pays a POINTS tender for the points given back, then cash.
     - The voucher cap of ADR-0110 still holds, and counts points as refundable.
5. **The kiosk.**
   - «Бонус карт (F3)» opens the member dialog: phone, then the member's name, points, tier and next tier, then «Холбох». A blocked card cannot be attached.
   - The attached card shows on the sale screen until the sale is paid or cancelled.
   - In the payment dialog:
     - CREDIT types are hidden;
     - «Бонус оноо» is a row of its own, pre-filled with min(balance, what is left), whole points;
     - its row asks for the member's PIN;
     - «Олох оноо ≈» shows the estimate.
   - The receipt prints «Бонус карт: нэр (утас)», the tier, the points earned, spent, given back and taken back, and «Онооны үлдэгдэл».
   - The return dialog explains the points rule.
6. **The centre accepts every sale** (ADR-0063 #5).
   - **Shape checks** before any read:
     - earned = `pointsEarned(base, percent)`;
     - base = the cash, card and transfer tenders;
     - spent = the POINTS tender;
     - no credit;
     - a return earns and spends nothing, and its POINTS tender is the points given back.
   - **Locks.** The member is locked after the codes and before the shelf.
   - **A return** must match `loyaltyReturn` from the sale's row and its earlier returns.
   - **Issues.** A BLOCKED card, or more spent than the centre's balance, is kept as `issue` (BLOCKED / OVERDRAWN):
     - it is counted in `/pos/attention` as `loyaltyToCheck`;
     - it is listed at `GET /pos/sale-loyalty`;
     - it is marked «Шалгасан» by `pos.manage`.
   - An unknown member, or a shape that does not add up, is a permanent rejection.
7. **The books** (temporary codes until D16, **TODO-VERIFY** with the accountant).
   - **The shift's close** (`shiftCloseLines`, amends ADR-0064 #2), with the totals on `pos_shifts`:
     - Dr **LOYALTY_LIABILITY** (320301 «Бонус онооны өр») for the points spent, Cr for the points given back;
     - the points earned: Dr **LOYALTY_EXPENSE** (730301 «Бонус онооны зардал») / Cr LOYALTY_LIABILITY;
     - the points taken back: the reverse.
   - **The sale itself** stays at full price on POS_SALES with its VAT.
   - **A hand adjustment** (`POST /pos/loyalty-members/:id/adjust`, idempotent) is an ADJUST entry plus a journal entry at once, through `JournalService.post` with source MANUAL:
     - points added: Dr expense / Cr liability;
     - points removed: the reverse;
     - the balance may not go below zero by hand.
8. **e-Barimt.** The receipt covers the full price. The points part is a payment under `LOYALTY_PAYMENT_CODE` = `CASH`. This is **TODO-VERIFY** with the accountant and ITC, like the voucher's.
9. **The office** (`pos.loyalty.manage`; OFFICE has it, ADMIN has everything).
   - «Супермаркет → Бонус карт» (`/pos/members`):
     - the list, searched by name or phone digits;
     - `?new=1` registration with the PIN typed twice;
     - the `?member=` panel: the details, tier, next tier, balance, lifetime and history, with «Засах», «ПИН солих», «Оноо нэмэх/хасах» and «Хаах»/«Нээх».
   - The tiers card on «Супермаркет → Тохиргоо».
   - The routes are `GET/POST /pos/loyalty-members`, `GET/PATCH /:id`, `GET /:id/entries`, and `POST /:id/pin`, `/block`, `/unblock`, `/adjust`.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| An instant discount instead of points | The owner chose points to save and spend (answer 1). |
| Points as a discount on the lines (lower e-Barimt) | The owner chose a payment form until the accountant answers (answer 12). It is one change in `LOYALTY_PAYMENT_CODE` and the books if the accountant says otherwise. |
| Members as partners' customers | The owner: a separate register (answer 6). Customers are stores with credit; members are people at the till. |
| The balance only at the centre, spent online | The store must sell offline (ADR-0063). One edge serves the store, so it can count its own documents and hold a member's lock. |
| Earned points booked per sale | The till's sales are booked at the shift's close (ADR-0064). The points join that entry. |
| A card number or barcode | The owner: phone and PIN only (answer 7). |

## Consequences

**Positive.**
- The office registers members. Any till of the store finds them by phone and earns and spends points offline too, with one lock per member.
- The accountant sees the points owed on one liability account.

**Negative.**
- **Offline.** A spend can pass the centre's balance when an adjustment or a block happens between pulls. The centre keeps the sale and lists it.
- **Returns.** A card that spent its points already may go below zero after a return.
- **Two installations.** Members of Kharkhorin's installation are its own (ADR-0084).
- **Accounting and e-Barimt.** The accounts and the PosAPI payment code are temporary until the accountant answers.

**Follow-ups.**
- `TODO-VERIFY` (accountant, ITC):
  - liability versus a discount at redemption;
  - the e-Barimt payment code of points;
  - the accounts (D16).
- A view `ai.pos_*` of the points, without personal data (S4).
- Showing the balance in «Bto300» if the owner ever asks for it.

## Related

ADR-0048 (programs), ADR-0063, ADR-0064 (amended: #2, the close's points lines), ADR-0065, ADR-0067, ADR-0084, ADR-0109, ADR-0110, ADR-0111; `docs/modules/pos.md`; SPEC §5.7, §11 #26.
