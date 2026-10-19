# ADR-0072: The core books by configuration: posting keys resolved to accounts by rules, and receivables, payables and advances kept as open items

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0060 (#4: the receivables ledger becomes the core's open items and allocations; #5: allocations are append-only, and an existing credit is applied only by the accountant, through an `ALLOCATION` document; #7: roles become posting rules, the chart takes Erkhet's account codes, and the unallocated remainder becomes a per-document-type setting); ADR-0064 (#4: the four POS roles become seeded posting rules; their accounts are control NONE with `drains`) |

## Context

The Finance Core (ADR-0069) must book a wholesaler, a hotel and later businesses with one engine. The owner's goal (2026-10-18): differences such as the chart of accounts, document types and account-mapping rules are solved by configuration; sub-ledgers such as receivables and payables reconcile with the general ledger; a PMS booking, an advance and a rendered service are separate events, and incoming money is never booked straight to revenue.

What the code has today (HEAD 3577787; `F/` is `apps/api/src/modules/finance/`, `S` is `packages/shared/src/finance/index.ts`):
- **Accounts by role.** 15 fixed roles (`S:91-109`), one account per role in the whole database (`gl_accounts_role`, `F/schema.ts:79`), the POS roles inside a database CHECK (`apps/api/src/db/migrations/0027_pos.sql:321`). The posting templates are code: the invoice (`F/services/invoicing.service.ts:250-292`), the voucher (`F/services/payments.service.ts:226-249`), the credit note (`F/services/credit-notes.service.ts:307-336`), the POS shift (`apps/api/src/modules/pos/services/pos-shifts.service.ts:346-363`). A PMS would need a finance migration and engine code.
- **A balance-forward ledger.** `ar_entries` plus the `customer_balances` cache. The reconcile compares the cache with the ledger and the invoices and never reads the journal (`F/services/ar-ledger.service.ts:431-487`), so a manual entry on the receivables account with no `ar_entries` row goes unnoticed.
- **Mutable allocations.** A payment void sets `voided_at` on its allocations (`F/services/payments.service.ts:344-345`; `F/schema.ts:484`).
- **Advances are never applied.** Allocation happens only while a voucher or a credit note is recorded (`F/services/payments.service.ts:224`, `:558-636`; `F/services/credit-notes.service.ts:294-306`); no route pairs an existing remainder with a later invoice. The `CUSTOMER_ADVANCE` account 320201 is seeded (`apps/api/src/db/migrations/0026_finance.sql:411`) and never posted. An invoice issued while the customer holds a credit stays open and later blocks the customer as OVERDUE (`F/services/credit-control.service.ts:34`).

The owner's answers (2026-10-18): accounts use Erkhet's account codes (D16); advances and overpayments are applied to invoices only by the accountant, by hand (D7). Erkhet was read through its screens only: there an account's «Журнал» setting appears to require line detail (seen in its settings; not tried), and advances appear as account names whose handling was not seen.

## Decision

1. **A closed set of document classes in code; everything else is rows.** The engine knows these classes and checks their rules (`FIN_CLASS_RULE`):

   | Class | What the engine checks |
   |---|---|
   | `AR_INVOICE` | A party. Exactly one DEBIT line on a RECEIVABLE account, opening an item with `dueDate`; none when the amount is 0 (today a zero total skips the receivable line, `F/services/invoicing.service.ts:257-264`). Tax lines allowed |
   | `AR_CREDIT` | A party. One CREDIT line on a RECEIVABLE account that settles the referenced invoice item; a remainder follows `unapplied_key` (#9) |
   | `RECEIPT` / `PAYMENT` | One MONEY line with a money account. Party lines settle FIFO or named targets; a remainder stays open or follows `unapplied_key` |
   | `SETTLEMENT` | Party-control lines that settle or open items, plus revenue, expense and tax keys: a deposit applied, a direct bill, a forfeit, a write-off, a netting, a party transfer |
   | `ALLOCATION` | No lines and no journal entry: pairs existing open items of one party on one account (#7) |
   | `JOURNAL` | Any balanced lines; source `FIN` may name `accountCode`, with `finance.journal.manage` |
   | `OPENING` | As `JOURNAL`; receivable and payable lines open items with `itemRef`, `itemDate` and `dueDate`; the offset goes to an opening-balance account flagged `drains` |
   | `AP_BILL` / `AP_CREDIT` | Mirrors of the AR classes for supplier bills (before procurement, ADR-0077) |

   Per company, document types (class, source system, number mode SOURCE or CORE, number series, `unapplied_key`, `requires_approval`, `allowed_in_soft_close`), posting keys (`required_control`, `requires_tax_code`), posting rules, accounts, tax codes and tax rates are rows, loaded through the configuration port. A new document type, key or rule is configuration; a new class (fixed assets may need one, ADR-0077) needs an ADR and engine code.
2. **How an account is chosen.**
   - Only the rules effective on the line's accounting date count, so a back-dated document posts with the rules of its own date. Among them the most specific wins: document type, then branch, then source system, then the company default. The chosen rule is stored on the line (`posting_rule_id`).
   - Rules are append-only: a change is a new row from a date (`effective_from`, `effective_to`).
   - No match rejects the document with `FIN_MAPPING_MISSING {key, documentType, branch}`. There is no suspense account. In-process the refusal rolls the source back (ADR-0071 #8): a Bto sale with an unmapped key is not sold until the rule exists.
   - A document type becomes ACTIVE only when every key it declares has a rule (the coverage check). A posting preview returns the resolved lines without posting.
   - A line on a party-control account needs a party (`FIN_PARTY_REQUIRED`); a line on a MONEY account needs a money account (`FIN_MONEY_ACCOUNT_REQUIRED`).
3. **The seeded rules equal today's roles.** Phase P2 seeds one company-default rule per role (`S:91-109`) on the account that holds it, so the carve posts exactly what Finance I and POS post today. POS_CASH (100102) and CARD_CLEARING (120301, «Картын төлбөрийн авлага», `packages/shared/i18n/mn.json:3255`) get control NONE with `drains`, not MONEY or RECEIVABLE, because the POS lines carry neither a money account nor a party (`pos-shifts.service.ts:346-363`). The default chart (`S:327-349`) becomes a template of the Mongolian layer (ADR-0074); a company's empty chart is filled from it once, and accounts are never re-added to a chart that has any (today every boot re-adds missing defaults, `F/reference-data.ts:10-15`).
4. **The chart uses Erkhet's account codes** (owner, 2026-10-18, D16). The chart is imported per company before go-live (ADR-0077), keeping its tree (`parent_id`, `is_group`; group accounts are not posted to). The accountant marks each account's control type (NONE, RECEIVABLE, PAYABLE, ADVANCE_RECEIVED, ADVANCE_PAID or MONEY) and `drains` for clearing accounts; rules then point today's keys at the imported codes. `kind`, `normal_side` and `control` freeze once an account is posted (a trigger); `code` stays editable with an audit row, as renumbering is allowed today (`F/reference-data.ts:11-12`). The contra-income accounts 520101 and 520201 (kind INCOME, `S:327-349`) get `normal_side = DEBIT`. TODO-VERIFY (accountant, D16): whether Erkhet's codes are adopted unchanged, and which accounts are control accounts, the POS cash and card-clearing accounts included.
5. **Open items.** Every line on a party-control account (RECEIVABLE, PAYABLE, ADVANCE_RECEIVED, ADVANCE_PAID) opens exactly one `fin.open_items` row: party, account, side, amount, open amount, item and due dates, source system, `item_ref` and `group_ref`. A deferred trigger and an integrity test check the one-to-one rule. The item's foreign key to its line includes the company, the party and the account. Only `open_amount` is updatable (a column grant), with CHECK 0 ≤ open ≤ amount. A `groupRef` (a folio, a reservation) is scoped to the source system that sent it.
6. **Allocations are append-only.** A `fin.allocations` row pairs one debit item and one credit item of the same party on the same account (two composite foreign keys) and lowers both open amounts by its amount; more than an item holds is `FIN_OVER_ALLOCATION`. An allocation is undone by a reversing allocation (`reverses_allocation_id`), never by an update. A receipt's reversal first reverses its own allocations, as today.
7. **Settling at posting; credits applied only by the accountant.**
   - A RECEIPT, PAYMENT or AR_CREDIT settles items while it posts: oldest due first, or the targets named in `settles` (the payment dialog's editable allocation, as today, `F/services/payments.service.ts:558-636`); a credit note settles its own invoice.
   - An existing credit is never applied automatically (owner, D7): an `AR_INVOICE` leaves the party's credit items alone. The accountant pairs them by hand, with an `ALLOCATION` when the credit and the invoice sit on the same account, or a `SETTLEMENT` (Dr the liability, Cr receivables) when the credit sits on another account (#9).
   - The `ALLOCATION` is a document of the core's screens (source `FIN`, `docId` from the `Idempotency-Key`, ADR-0071 #10): the customer's open items, a credit item picked against an invoice item, the amount. It needs `finance.payments.record`, the right that allocates a voucher today (ADR-0060 #9), and is undone by a REVERSE.
   - Until the accountant acts, Bto's credit check nets the unapplied credits against the overdue amount (ADR-0073), so a covering advance does not block the customer.
8. **The sub-ledger equals the general ledger by construction.** For every (company, party, account): Σ open debit − Σ open credit = Σ debit − Σ credit of its lines. A balance moves to another account or party only through a document with lines (advance to receivables, guest ledger to city ledger, a party merge, a write-off). `fin.party_balances` (key company, party, account) is rewritten under the party lock in the same transaction, the ADR-0060 #4 pattern. The nightly reconcile runs per company and records `fin.reconcile_runs` of four kinds: CACHE (cache against items), ITEMS (items against allocations), SUBLEDGER_GL (items against the control-account lines) and DRAIN. CACHE, ITEMS and SUBLEDGER_GL drifts exit 2, as `pnpm finance:reconcile` does. DRAIN reports clearing balances older than a per-account age (set with the accountant, TODO-VERIFY); it is a report and never exits 2, because a clearing account such as POS cash or card clearing is rightly non-zero while money is in transit.
9. **The unallocated remainder keeps today's rule until the accountant decides.** An unallocated receipt or credit-note remainder stays an open credit item on receivables (ADR-0060 #5, #7). RECEIPT and AR_CREDIT document types carry `unapplied_key`: NULL keeps the remainder there; a key makes the engine split the party line (Cr receivables 28,000 and Cr `<key>` 12,000), and the stored result returns the resolved lines. Switching is one configuration row plus a reclassification document for the existing credit items. TODO-VERIFY (accountant, D6): (i) keep the remainder on receivables and reclassify net credit balances in the statements; (ii) one liability account; or (iii) `CUSTOMER_ADVANCE` for orders paid before delivery and `CUSTOMER_REFUNDABLE` for overpayments and credit-note remainders. Also whether VAT is due on Bto customer advances.
10. **Advances for services are liabilities.** A PMS deposit always posts on a key whose rule names an ADVANCE_RECEIVED account, never revenue; a SETTLEMENT applies it to the guest's charges or forfeits it, and a PAYMENT refunds it. The PMS is added with rows only (keys such as GUEST_DEPOSIT, GUEST_LEDGER, CITY_LEDGER, ROOM_REVENUE, CANCEL_FEE on the classes above), proven in phase P3 by the TESTPMS fixture (source system `TEST_PMS`). TODO-VERIFY (accountant, D12, D25): recognition nightly or at checkout, and VAT on deposits, forfeits and refunds.
11. **Reversals.** A REVERSE (ADR-0071 #4) posts the mirror entry dated the command's `accountingDate` or today, never earlier than the original, as today's voids are (`F/services/invoicing.service.ts:203-208`); the mirror's items are allocated against the original's. UNIQUE `(company_id, reverses_document_id)` allows one reversal per document (today "reversed once" is a plain SELECT, `F/services/journal.service.ts:243-253`). A reversal is refused with `FIN_REVERSAL_BLOCKED {allocations}` while other allocations on the target are live. TODO-VERIFY (accountant): a correction dated the correction day, or back-dated to the original while its month is open.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| One account per role (today) | Global, one company, a fixed enum in a database CHECK; every new business needs a migration and engine code. |
| Posting templates in each source's code (POS today) | The sender chooses the accounts; the goal is extension by configuration. |
| A rule language or derivation scripts | Too much to maintain alone; a fixed class set with plain rows covers Bto and the PMS example. `match` selectors can come later as a nullable column. |
| A suspense account for unmapped keys | Books silently; a configuration error would surface only at the close. |
| A balance-forward ledger (`ar_entries`) with a GL check added | It cannot say which invoice a credit paid or which deposit a folio used. |
| Allocations voided in place (`voided_at`, today) | History is lost; a reversing allocation keeps it. |
| Applying credits automatically after each invoice (the design's recommendation) | The owner: only the accountant applies them, by hand (D7). |
| Deposits on receivables or straight to revenue | A deposit is owed back until the service is rendered; the goal forbids booking incoming money as revenue. |
| Today's small built-in chart | The owner chose Erkhet's codes (D16): the accountant knows them, and the opening balances are signed off against Erkhet. |

## Consequences

**Positive.**
- A new business is configuration: keys, rules, document types and accounts, with no engine change.
- Every line names the rule that chose its account; a missing rule refuses instead of misbooking.
- Receivables, payables and advances equal the general ledger by construction, and the nightly reconcile proves it.
- The allocation history is kept, and the accountant decides when a credit pays an invoice.

**Negative.**
- A wrong rule books a wrong account. Mitigations: the coverage check, the preview, seeded rules equal to today's roles, the rule id on every line.
- A missing rule stops a Bto sale until the rule is added.
- The accountant must mark control types before the chart import and allocate credits by hand. Until then a credit and an overdue invoice sit side by side, and statements show the credit on receivables (D6).
- More tables and a deferred trigger; `party_companies` becomes a hot row, as `partners.customers` is today.

**Follow-ups.**
- P2: accounts with their flags, rules seeded from the roles, a read-only rules list.
- P3: the classes, open items, allocations, the coverage check, the preview, the TESTPMS fixture (source system `TEST_PMS`).
- P4: the backfill (every party-control line gets an item, live allocations are copied, voided ones become pairs, historical reversals are allocated, a `DO` block asserts the balances) and the ALLOCATION screen.
- P5: the OPENING path. Before go-live: Erkhet's chart imported with its control types (ADR-0077).
- The accountant's answers: D6, D8 (the COGS and inventory rules), D12, D16, D25, reversal dating, the write-off policy, the DRAIN age per clearing account.

## Related

ADR-0010, ADR-0060, ADR-0064, ADR-0069, ADR-0070, ADR-0071, ADR-0073, ADR-0074, ADR-0075, ADR-0077; `docs/modules/finance-core.md`; `docs/architecture.md` §5.5, §5.8, §5.13, §13.2; `docs/SPEC.md` §5.8, §6.
