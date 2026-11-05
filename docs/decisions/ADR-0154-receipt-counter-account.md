# ADR-0154: A receipt's «Харилцсан данс» is a payable account

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Орлого цонх дээр 310 Дансны өглөг - данснууд л харагддаг байх ёстой. Мөн тооллогоны зөрүү гэсэн», 2026-11-05), Claude (the direct-mode session) |
| Supersedes | ADR-0153 #4 (the payable and the money accounts); amends ADR-0091 (a bill credits the key AP's account unless the receipt names another) |

## Decision

1. **The list.** The window's «Харилцсан данс» offers the active accounts of the chart's group 310, coded `3101…`, and `313011` «Тооллогын зөрүү», nothing else. The default is the account of the key AP. Cash and bank are no longer offered; a receipt from the window is always on credit, and an older or imported draft that names cash or bank turns to credit when an account is chosen.
2. **`goods_receipts.counter_account_code`** (migration `0075_receipt_counter_account`), null meaning the key AP's account; a code, not a foreign key, as inventory cannot depend on finance. Checked through the `RECEIPT_COUNTER_ACCOUNTS` hook, which finance binds.
3. **A source still names a key, never an account (ADR-0071).** Each such account has its own posting key `AP_<code>` with a rule from 2000-01-01, so a receipt dated earlier than the account still finds it. The migration writes them for the accounts that exist; a new account by hand or from Erkhet's chart takes its key as the staff member adds it. The payable's own account needs none: choosing it stores null and books by the key AP. The bill and its re-costings credit that key.

## Consequences

**Positive.** Each kind of payable has its own balance in the books.

**Negative.** Supplier settling («Хаах», allocation) works on the key AP's account only (`ALLOCATION_ACCOUNT`), so a bill on another of these accounts is not paired there; such a balance is reduced with a transaction on «Авлага өглөг» (ADR-0150). A receipt on «Тооллогын зөрүү» still names a supplier: the account controls a party (TODO-VERIFY with the owner which party a count difference names).

## Related

ADR-0071, ADR-0078, ADR-0091, ADR-0097, ADR-0150, ADR-0153.
