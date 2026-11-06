# ADR-0149: An account's type is Erkhet's journal, and every account names a currency

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («Дансны төрөл бүгдийн устгаж — оронд нь эрхэтийн … Журналын багана байгаа нэршлээр төрөл үүсгэж данс бүрт тохируул. Данс бүрт: Валют сонгодог байна», 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0148 #3 (the journal and currency are now kept) |

## Context

«Дансны төлөвлөгөө» showed Bto's five kinds (Хөрөнгө, Өр төлбөр, …) as the account's type, and accounts had no currency. Erkhet shows a journal (eight kinds in its form) and a currency (35) on each account.

## Decision

1. **`fin.accounts.journal`** (GENERAL, CASH, BANK, MONEY, RECEIVABLE_PAYABLE, VAT, INVENTORY, FIXED_ASSET, in Erkhet's names) **and `currency`** (migration `0073_account_journal`). The chart's «Төрөл» column and the account's form show and set the journal; «Валют» is a new column and a field, with Erkhet's 35 currencies.
2. **The five kinds leave the screen, not the books.** The balance sheet, the income statement and the year close read `kind`, and the normal side follows it, so it stays, worked out from the code when an account is made: 1, 2 asset; 3 liability; 4, 92 equity; 5 income; other 6–9 expense (`accountKindOfCode`). Nobody chooses it any more. This is the reading of «төрөл бүгдийг устга» that keeps the statements right.
3. **The journal sets the control:** cash, bank and money accounts become MONEY; «Авлага өглөг» a party's account (receivable on an asset, payable on a liability, a customer advance staying one); the others NONE. A change that takes a control from an account an automatic posting needs is refused.
4. **As in Erkhet, an account with entries keeps its journal and currency** (`FIN_ACCOUNT_IN_USE`).
5. **The currency is a label for now.** The ledger stays in MNT (architecture §12): no rate, no foreign amount, no revaluation. An account marked USD still books tugriks until multi-currency is built.

## Consequences

**Positive.** The accountant reads and sets accounts as in Erkhet.

**Negative.** A currency that looks operative is not yet; the form must not be taken as foreign-currency bookkeeping.

## Related

ADR-0102, ADR-0148, docs/modules/finance-core.md.
