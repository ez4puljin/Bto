# ADR-0083: The Finance Core goes live lean: six phases of what the books need on the go-live day, no copy of Finance I's history, the rest after go-live

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0077 (#1 the go-live scope, #2 the phases, #3 the go-live additions, #4 the order constraints, #5 the roadmap), ADR-0075 (#2 soft close, #6 drafts and approval, #7 and #8 the rights wait), ADR-0076 (#2–#4 and the isolation tests of #10 wait for the PMS), ADR-0071 (#12 the pending list waits), ADR-0073 (the `billing` split, phase H1, moves after go-live) |

## Context

The owner (2026-10-20): «Хамгийн чухал нь санхүүгийн цөмийг хурдан хийж дуусгах… Товчилсон төлөвлөгөөг эхлээд гарга. Хойшлуулж болох зүйлсийг хойшлуул.»

ADR-0077 planned about 27–34 core sessions before go-live. The carve (P1–P5, H1, H2) alone was 17–20 sessions. P0b, the scaffold, is done (2026-10-18). P1 would come next.

Three facts make most of that carve unnecessary before go-live.

1. **There is no production database.** ADR-0026 deploys once, after the last delivery. On the go-live day the books start from Erkhet's opening trial balance (ADR-0077 #3). The copy migrations, the receivables backfill, the migration-path tests and the golden trial balance of P2 and P4 (`docs/modules/finance-core.md` §16) would only protect the development database's test documents. They are the heaviest and riskiest part of the carve.
2. **The PMS starts after go-live** (D22). Company isolation in services and reads, the HTTP and asynchronous transports and the TESTPMS proof serve a second company and a second source. Bto alone books into one company.
3. **Erkhet stops on the go-live day** (D5). What the company cannot be without that day is the journal on Erkhet's chart, receivables and payables, stock and cost postings, the month close, the opening balances, and the statements and VAT return. A fixed-asset register, the bank-statement import, drafts with approval and a soft close are conveniences the accountant can replace by hand for a while.

## Decision

1. **Kept, because they are cheap now and costly to add later:**
   - the `finance-core` boundary and its lint (ADR-0069, P0b);
   - schema `fin`;
   - one intake with the durable source key, synchronous and in-process only (`submitInTx`, ADR-0071 #1–#8, #10, #11);
   - posting keys resolved to accounts by rules held as data (ADR-0072 #1–#4);
   - open items for receivables, payables and advances, with credits applied only by hand (ADR-0072 #5–#11);
   - an append-only, balanced journal;
   - `company_id` in every `fin` key and foreign key, with one company BO (ADR-0070, ADR-0076 #1, #5);
   - the Mongolian layer `@tugeel/shared/mn` (ADR-0074).
2. **No copy of Finance I's history.**
   - The `fin` tables are created empty. Bto's writers (invoices, vouchers, credit notes, the POS shift close and hand-over) are switched to the core in the phase that replaces their tables.
   - Finance I's ledger tables are dropped in that same phase, with no frozen copy kept beside them.
   - The development database's finance documents are posted again through the new path by a one-off development script, run once and checked by `pnpm finance:reconcile`.
   - There is no migration-path test, no golden trial balance and no backfill `DO` block.
   - The rule of `docs/modules/finance-core.md` §16 still holds: today's HTTP scenarios stay unchanged, and the raw-SQL guards and race tests move to `fin.*` with the same scenario and SQLSTATE.
3. **Six phases before go-live** (about 11–15 sessions, re-planned in STATUS after each):

   | Phase | Content | Sessions | Waits on |
   |---|---|---|---|
   | F1 Foundation and ledger | schema `fin`; one tenant, the company BO, branches, the sources BTO and FIN; parties from customers; accounts and money accounts; monthly periods OPEN / CLOSED; the journal with its balance guards; rules seeded from today's roles; `fin-bridge`; Bto's journal writers switched; `journal_entries` / `journal_lines` dropped; the development re-post | 2–3 | — |
   | F2 Intake and open items | the synchronous intake with every document class (AR_INVOICE, AR_CREDIT, RECEIPT, PAYMENT, AP_BILL, AP_CREDIT, JOURNAL, ALLOCATION, REVERSE); receivables on the engine (`ar_entries`, `customer_balances`, `allocations` dropped); `exposureInTx` behind the credit check (ADR-0073); the manual allocation dialog; the nightly core reconcile | 2–3 | — |
   | F3 Payables | goods receipts (ADR-0078) become AP_BILLs, or bills settled at once for CASH and BANK; supplier payments; supplier returns as AP_CREDIT; the accountant's screens | 2 | — |
   | F4 Stock and cost | receipts (stock, input VAT), goods issues by expense type (ADR-0081), adjustments, stocktakes and the cost of goods sold, as JOURNAL documents | 1–2 | D8 |
   | F5 Close and opening | close and reopen of the latest month with a reason and an event row; a closed month refuses postings; Erkhet's chart import; the opening trial balance with receivables and payables per party and due date | 2 | D16, D27 |
   | F6 Reports | trial balance, general ledger, party statements, the balance sheet and income statement from templates held as data, the VAT-return rows, the closing entry | 2–3 | D17, D25 |

   The order is F1 → F2 → F3 and F4 (either order) → F5 → F6. e-Barimt keeps its own track (ADR-0074).
4. **After go-live, each with its interim practice:**

   | Waits | Until then |
   |---|---|
   | Fixed-asset register and depreciation runs | the register in a spreadsheet; depreciation as a monthly manual entry; balances in the opening trial balance |
   | Bank-statement import | cash and bank vouchers typed by hand (built in Finance I) |
   | Drafts with approval, soft close, override, the pending list, HELD documents (ADR-0071 #12, ADR-0075 #2, #6) | manual entries post at once and are audited; a closed month refuses |
   | The new rights beyond `periods.close` and `periods.reopen`, and rights per company (ADR-0075 #7, #8) | today's finance permissions |
   | Company isolation in services and reads, `finRead`, the scope setting and the isolation tests (ADR-0076 #2–#4, #10), the TESTPMS proof, A1 and A2 | one company; all of it at the PMS kickoff, before the PMS posts |
   | H1, the `billing` split (ADR-0073), and H2, the POS through the intake | `modules/finance` and `pos` call the core directly; same behaviour |
   | The control-system reader, payroll postings | as ADR-0077 (payroll by hand until `hr`) |

5. **Order constraints change.**
   - H1 no longer precedes delivery 5. The drivers' cash sessions record their vouchers through the core from F2.
   - Payables (F3) still precede procurement (delivery 8).
   - A1 and A2, together with the isolation work, precede the PMS.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep ADR-0077's plan | 27–34 sessions. Its copy migrations and backfill protect test data only, because there is no production yet. |
| Extend Finance I in place, with no core | Fastest today, but payables, periods and reports would be built on the wrong shape and rebuilt for the PMS; the P0b boundary would be thrown away. |
| An open-source ledger or ERP (Odoo, ERPNext, Bigcapital, TigerBeetle, Formance) | The hard parts are Mongolian tax forms, the accountant's rules, the Erkhet opening and the automatic postings from Bto's operations; none is solved by them. Integration and licences add work. |
| Copy Erkhet's behaviour | Only its screens were seen. Its one-sided and editable documents stay rejected (ADR-0077 #6). |

## Consequences

**Positive.**
- The books can be ready in about 11–15 sessions instead of 27–34.
- The risky copy migrations disappear.
- The intake, the rules and `company_id` keep the PMS an addition rather than a rewrite.

**Negative.**
- The accountant works by hand for fixed assets, the bank statement and approvals after go-live, so this must be agreed with them first.
- The development database's finance documents are rewritten once by a script.
- The isolation work is still owed before the PMS posts.
- The accountant's answers (D8, D16, D17, D25, D27) are now the pace setter.

**Follow-ups.**
- `docs/modules/finance-core.md` §16 and §17 follow this ADR.
- STATUS's "Next session" is F1.
- The accountant's questionnaire for D6–D27 goes out before F4.

## Related

ADR-0026, ADR-0069 … ADR-0077, ADR-0078, ADR-0081, `docs/modules/finance-core.md` §16–§18, SPEC §9.3.
