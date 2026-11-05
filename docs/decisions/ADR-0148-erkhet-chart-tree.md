# ADR-0148: Erkhet's chart of accounts with its group tree

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («/finance/accounts-ийг дахин данс бүртгэ. Одоо байгаа бүх дансыг устгаж Эрхэт дээрхи дансны ангилал, нэршил, кодоор бүртгэл үүсгэ»; chose to delete for real and to keep Bto's own accounts apart, 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0102 #4 (the chart import adds the groups' tree), ADR-0106's assumption 2.4 (Bto's chart now is Erkhet's chart) |

## Context

Bto's chart held 31 accounts of its own, and no groups. Erkhet holds 103 accounts in a tree of 55 groups whose codes do not sort into their order (5 Хөрөнгө → 1 Эргэлтийн хөрөнгө → 10 Мөнгөн хөрөнгө → 100). The ADR-0102 import takes accounts and a flat group, and is fed from a sheet; it cannot make a group that holds no account.

## Decision

1. **The tree** (migration `0072_account_group_tree`): `fin.account_groups` gets `parent_id` and `sort`. «Дансны төлөвлөгөө» shows the tree in Erkhet's order with each group's accounts under it, a search, and inactive accounts only on request.
2. **`POST /gl-accounts/chart`** (`finance.settings.manage`): the groups, the accounts and the codes to make inactive, in one transaction. The accounts go through `importChartInTx` (ADR-0102 #4), so an account with journal lines keeps its kind, side and control. Erkhet's own export stays out of git: names hold bank account numbers (`tmp/erkhet-accounts/`, gitignored).
3. **What was taken from Erkhet:** code, name, group, and from «Шинж» the normal side. Kind by the code's first digits: 1, 2 asset; 3 liability; 4, 92 equity; 51, 52 income; 61, 7, 91 expense. Control from «Журнал»: «Мөнгөн хөрөнгө» money; «Авлага өглөг» receivable on an asset, payable on a liability. «Хэлтэс», «Хувь» and the currency are not kept; 110201 (доллар) is an account on an MNT ledger, and Kharkhorin's accounts sit unused here (ADR-0084).
4. **Four posting keys moved:** VAT_INPUT 130301 → 121004, INVENTORY 140101 → 150101, RETAINED_EARNINGS 340101 → 440101, STOCK_LOSS 740201 → 702007. The accountant may correct them.
5. **Fifteen accounts Erkhet has no equivalent for stay** in a group of their own, «Bto автомат бичилтийн данс» (`BTO`), with their codes: 120302, 120303, 310201, 311005, 320301, 390101, 511030, 511040, 730201–730205, 730209, 730301. Automatic postings need them until the accountant moves them.
6. **The old accounts' removal is the owner's own step.** The ledger is append-only (ADR-0089) and permanent deletion is not done for the owner by an agent, so the delete is a script in `tmp/erkhet-accounts/purge.sql` that the owner runs on `bto_main`. Rehearsed in a rolled-back transaction: it removes the two documents of GR-2026-000001, their journal and the four old accounts. It keeps the audit log, the goods receipt and the stock.

## Consequences

**Positive.** The accountant reads Bto's chart as in Erkhet, under the same codes and names.

**Negative.** After the delete, the 42,000 ₮ of GR-2026-000001 stays in stock with no books behind it, and `finance:reconcile` reports that difference until an opening or an adjusting entry covers it. Without the delete, the old accounts stay inactive and 140101 keeps that balance. Erkhet's control mapping is a default: an account marked receivable or payable requires a party on a manual entry.

## Related

ADR-0083, ADR-0084, ADR-0089, ADR-0102, ADR-0106, docs/modules/finance-core.md.
