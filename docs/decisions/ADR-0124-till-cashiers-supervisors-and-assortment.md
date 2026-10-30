# ADR-0124: A till's own cashiers, approvers and assortment

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner («Пос бүр дээр касс нэмж, хасдаг, Админ эрх нэмдэг … Пос бүр дээр ямар бараа зарахыг тохируулах боломжтой болго»), Claude (the direct-mode session) |
| Amends | ADR-0063 #3 (every cashier worked every till; every supervisor approved everywhere; every till sold the whole snapshot) |

## Context

With a till per sales floor (ADR-0123) the owner wants each till to have its own people and its own goods: the alcohol floor's till sells alcohol and is worked by its own cashiers, approved by its own supervisors. The store-wide lists of ADR-0063 stay the default.

## Decision

1. **`pos_till_users`** (`till_id`, `user_id`, `role` CASHIER | SUPERVISOR): who may sign in at the till and who may approve there. **`pos_till_categories`** (`till_id`, `category_id`): the categories the till sells, everything under a category included. A till with no rows of a kind keeps the store-wide rule: every active cashier, every holder of `pos.till.supervise`, every product. Migration `0059_pos_till_access`.
2. **The admin** sets the three lists in one dialog («Эрх ба бараа», `PUT /pos/tills/:id/access`, `pos.manage`; the lists replace the old ones; every user must be a cashier of the store, every category must exist; audited as `ACCESS pos_tills`); the till's row and the «Байгууллагын бүтэц» page show the counts; the cashiers' list says who is a supervisor.
3. **The snapshot** carries each till's `cashierUserIds`, `supervisorUserIds` and `categoryIds` (the subtrees expanded by the centre; an older edge ignores them).
4. **The edge enforces** them: the sign-in list and the PIN check of a till take its cashiers (`POS_CASHIER_NOT_ON_TILL`); the approvers offered and accepted take its supervisors (`POS_SUPERVISOR_NOT_ON_TILL`); the search, the barcode, the quick buttons and the sale itself take its categories (`POS_PRODUCT_NOT_ON_TILL`).
5. **The centre guards** the replay the same way: a shift opened or a sale made by a cashier off the till's list, an approver off its supervisors, or a SALE line outside its categories is a permanent rejection with that code (ADR-0063's rejection log), so a stale edge cannot slip past a changed list. Returns are not checked against the categories (the goods come back wherever they are handed back).

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Products per till by explicit product lists | Thousands of rows per till, stale on every registration; the category subtree is what the owner names («архи»). |
| Rights per till through the roles module | A cashier's PIN and till are POS facts; the roles stay company-wide (ADR-0027). |
| Enforcing at the edge only | The replay would accept documents a changed list no longer allows. |

## Consequences

**Positive.** A floor's till shows its own cashiers and goods; a wrong-floor sale is refused at the scan, not found at the count.

**Negative.** A list changed at the centre reaches the till with the next snapshot (the pull interval); a product moved to another category changes which tills sell it.

**Follow-ups.** The kiosk could name the till's floor and its restriction on the sign-in screen; products per till by brand, if the owner asks.

## Related

ADR-0063, ADR-0067, ADR-0123, `docs/modules/pos.md`.
