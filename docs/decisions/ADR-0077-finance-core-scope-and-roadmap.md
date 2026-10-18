# ADR-0077: Bto's books replace Erkhet on the go-live day, so the core's go-live scope is the full set of books, built in phases from now

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Supersedes | ADR-0060's scope sentence (Context, the owner's answers: "Balance sheet, income statement, payroll and fixed assets stay in Erkhet for now") |
| Amends | ADR-0018 (#6: the bank statement import is a go-live addition of the Finance Core, matched to open items, no longer delivery 10); ADR-0026 (#3 and its delivery-3 follow-up: the cut-over imports Erkhet's chart and the opening full trial balance instead of opening receivables per customer, and the delivery-3 opening-receivables importer becomes the chart and opening import); SPEC §5.8 (the full books), §5.11 (supplier bills are payables in the core, not `supplier_bills` in finance), §5.13 (payroll posts through the intake), §9.3 (a Finance Core track), §11 #13 (Erkhet stops at go-live); `docs/STATUS.md` rows 3, 8 and 10 |

## Context

ADR-0060 built the sales side of finance (invoices, the receivables ledger, vouchers, credit notes, a small journal) and left the balance sheet, the income statement, payroll and fixed assets in Erkhet, the accounting program the company uses today. SPEC §5.8 and §11 #13 say the same. Supplier bills were planned as `supplier_bills` in finance with procurement (SPEC §5.11, delivery 8); bank import, VAT reports and statements as Finance II (delivery 10); payroll in `hr` (delivery 11). ADR-0026 deploys once, after delivery 11, and imports the opening receivables per customer at the cut-over.

What Finance I lacks: periods (the only date check is `assertNotFuture`, `apps/api/src/modules/finance/services/journal.service.ts:596-598`); opening entries (`OPENING` exists only as an enum value, `packages/shared/src/finance/index.ts:118`); payables; cost-of-goods postings; statements; a VAT return; fixed assets.

The owner's answers (2026-10-18):
- Erkhet stops on Bto's go-live day (D5): no parallel run, no Erkhet bridge, no export.
- Erkhet's sub-system "BTO" (an API key, the host erkhet.bto.mn) is the company's previous sales and till program, which feeds Erkhet today (D19). Bto replaces it and Erkhet together.
- The chart keeps Erkhet's account codes; it is imported and the accountant marks the control types (D16).
- Fixed assets with depreciation go into the new books. A daily bank statement import is needed before go-live, Khan Bank Excel first.
- Payroll moves into the new system later, through `hr` (D21).
- The PMS is a separate repository, starts after go-live, and the resort runs its own small server (D22, D4, D3). Work starts now.

Erkhet was studied through its screens and handbook only: report outputs need a POST and were never generated, and exactly one posted transaction (an imported sale) was opened. Its closing run, depreciation run and VAT-return rows were seen as forms, data or help text; none was run.

## Decision

1. **Bto's books are the company's official books from the go-live day.** The Finance Core (ADR-0069) carries the full set of books, not a sales sub-ledger beside Erkhet. Before go-live it needs, besides the carve: periods with close and reopen (ADR-0075); payables; statements in the forms the accountant names, the VAT return and the closing entry; fixed assets with depreciation; the daily bank import; the cost-of-goods and inventory postings from Bto; Erkhet's chart; and the opening full trial balance, signed off against Erkhet's closing trial balance per account and per party. Payroll is posted by `hr` through the intake as source `HR` (delivery 11); until `hr` does so, the accountant posts payroll as manual entries.
2. **The carve, in phases.** A session is one Claude Code session, tests and documents included.

   | Phase | Content | Sessions | Order |
   |---|---|---|---|
   | R | Merge the `rep-app` branch (it holds migration `0028_notifications.sql`) | 0.5 | before P1 |
   | P0a | These decisions (ADR-0069 … ADR-0077), SPEC, architecture, STATUS | 1 | before e-Barimt on invoices |
   | P0b | `packages/fin-contract`, an empty `apps/api/src/finance-core/`, a Bto-free `common/**`, `@tugeel/shared/mn`, the lint elements, `pnpm core:standalone` (ADR-0069, ADR-0074) | 1 | the next finance session |
   | P1 | Schema `fin`, tenant, company BO, branches, source systems, parties, `bto.company_code`, `identity.user_company_roles`, `fin-bridge` (ADR-0070, ADR-0075) | 1 | |
   | P2 | Accounts, money accounts, rules seeded from today's roles, periods, the journal moved into `fin`, the FKs into moved tables dropped, AI views recreated (ADR-0072, ADR-0076) | 3 | |
   | P3 | The intake log, every document class, open items, allocations, `FinReader`, `FinConfig`, proven by the TESTPMS fixture (source system `TEST_PMS`; ADR-0071, ADR-0072) | 2–3 | |
   | P4 | Bto's receivables onto the engine: backfill, vouchers and invoices through the intake, `exposureInTx`, the core reconcile, the manual allocation screen (ADR-0072, ADR-0073) | 2–3 | |
   | P5 | Close, soft close, reopen, the new rights, drafts with approval, the pending list, the OPENING path (ADR-0075) | 2 | |
   | H1 | `modules/finance` becomes `billing` + `fin-bridge` (ADR-0073) | 2 | before delivery 5 |
   | H2 | The POS shift close and hand-over through the intake (ADR-0071 #8) | 1 | after POS S3 merges, before S4 |
   | A1 | The asynchronous transport: HELD, dependencies, the outbox, the result feed (ADR-0071 #9) | 1 | at the PMS kickoff |
   | A2 | HTTP intake and ports under `/api/fin/v1`, source tokens; `@tugeel/fin-contract` and the `mn` rules the PMS needs as versioned packages (the package cut is chosen then, ADR-0074; the PMS installs them from a private package registry or a git tag, decided in the A2 session's ADR) | 1–2 | before the PMS |

3. **The go-live additions**, caused by Erkhet stopping at go-live:

   | Addition | Content | Sessions | Order |
   |---|---|---|---|
   | Payables | Supplier bills and credits (`AP_BILL`, `AP_CREDIT`, ADR-0072) and supplier payments as open items, with the accountant's screens; the source facts are Bto's goods receipts (their payment method, money account, frozen VAT rate and VAT-inclusive line prices, the main session's ADR-0078), which post no payables themselves; procurement later only sends `AP_BILL` commands | 2 | after P3, before delivery 8 |
   | Bank import | The daily statement import, Khan Bank Excel first: lines normalised, duplicates dropped, matched to open items in the order of SPEC §5.8, the rest by hand | 1–2 | after P4 |
   | Fixed assets | A core sub-ledger reusable by the PMS: the asset register, classes with their accounts and rates, depreciation runs posting through the intake, disposals | 2 | after P3 |
   | Cost of goods and inventory | Bto posts the daily cost of goods sold and the inventory postings (receipts, adjustments, stocktakes, transfers, returns) as JOURNAL documents | 1–2 | after P5, once D8 is answered |
   | Statements, VAT return, closing | Statement and VAT-return templates as data (ADR-0074), the reports over the journal, the closing entry | 3–4 | after P5, once D17 and D25 are answered |
   | Chart and opening import | Erkhet's chart with the control types, then the opening trial balance: AR and AP per party with due dates, fixed assets with accumulated depreciation, dated the day before go-live (default; TODO-VERIFY D27) in a month closed after the sign-off | 1–2 | after P5 and the fixed assets; run at the cut-over |

   **Totals.** R to P5: about 13–15 sessions, after which the PMS can be added without rewriting the engine. With H1, H2 and 1–2 sessions of rebase overhead: about 17–20. The go-live additions: 10–14 (the bank import 1–2). So **about 27–34 core sessions before go-live**. A1 and A2 (2–3 sessions) follow at the PMS kickoff, after go-live; the `fin_control` role (about 1, ADR-0076) comes with the control system. These are estimates, re-planned in `docs/STATUS.md` after every phase.
4. **Order constraints.**
   - P0a precedes the e-Barimt-on-invoices session, so `ebarimt_receipts` is source-keyed from its first migration (ADR-0074); that session then runs whenever the PosAPI spike allows. The certification gate of 2026-11-13 is unchanged.
   - H1 precedes delivery 5; payables precede procurement (delivery 8); A2 precedes the PMS.
   - POS S3 (ADR-0065, reserved) runs in parallel on the edge: P0b's `mn` subpath lands before S3 starts, and H2 waits until S3 merges.
   - `pnpm check` runs one at a time on one PostgreSQL container.
5. **The roadmap.** SPEC §9.3 gains a Finance Core track (P0b … P5, H1, H2, A1, A2 and the additions) ahead of deliveries 5 and 8. Delivery 3 keeps e-Barimt; its opening-receivables importer becomes the chart and opening import. Delivery 8 sends supplier bills to the core. Delivery 10 keeps `reporting`, reminders and the driver and rep printing; its bank import and matching and its VAT and city-tax reports move into the track (the cash and bank books were built in Finance I). Delivery 11 posts payroll through the intake. STATUS re-plans the weeks when it is next written.
6. **Erkhet stays a reference, never a specification.** What its screens showed may guide our screens and checklists. Behaviour that was only inferred (how it closes, depreciates, nets VAT or posts purchases) is adopted only after the accountant confirms it. Its one-sided documents, saved "incomplete" documents, edits in place, deletion of an import with its documents and a month lock with no reason or history stay rejected.
7. **The accountant's answers** (each TODO-VERIFY; the default holds until answered):

   | # | Question | Blocks | Default |
   |---|---|---|---|
   | D6 | How an unallocated payment is presented; VAT on customer advances | the `unapplied_key` setting, the statements | an open credit item on AR (ADR-0072) |
   | D8 | Cost-of-goods method and the inventory posting set; the cost of a return | cost of goods and inventory | nothing posted |
   | D9 | Discounts gross with VAT, or net | the seeded invoice rules | gross, as today |
   | D12 | Hotel revenue point, VAT on deposits and forfeits, city tax at the resort | the PMS configuration | — |
   | D15 | Legal invoice numbering | go-live | Bto's daily `Н-` numbers |
   | D16 | Which Erkhet accounts are receivable, payable, advance, money or clearing | the chart import | — |
   | D17 | Statement forms and VAT-return rows | statements, VAT return | — |
   | D24 | Wholesale revenue at the SALE stage or on delivery | the month-end cut-off | the SALE stage |
   | D25 | The VAT tax point per document type; GL VAT against e-Barimt | the VAT return | the document date |
   | D26 | Receivables per branch | balance sheets per branch | company level |
   | D27 | The opening date and sign-off method; how Erkhet's closing figures are exported | the opening import | the full trial balance (owner) |
   | — | Reversal dating | the REVERSE default | the correction day, as today |
   | — | Write-off and expected-credit-loss policy | write-off document types | none |
   | — | Asset classes, lives and depreciation method (Erkhet shows straight line by days) | fixed assets | — |
   | — | The closing entry's accounts, its month and the income-tax step | the closing entry | — |

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep Erkhet as the official books for a while and compare | The owner stops it at go-live. Two sets of books drift, and whether Erkhet can import balanced journal entries is unknown: its import kinds were seen only as a list. |
| A bridge or a daily export to Erkhet | Nothing reads it after go-live; the "BTO" sub-system such a bridge would mimic is the program Bto replaces. |
| Go live with the sales books only, the rest after | From go-live day the company would have no balance sheet, VAT return or fixed-asset books. |
| Keep Finance II as Bto work in delivery 10 | Payables, statements and periods are core work that the PMS uses too (ADR-0069). |
| Supplier bills as `supplier_bills` owned by procurement or Bto's finance (SPEC §5.11) | Payables are open items in the core (ADR-0072); procurement only sends the bill. |
| Copy Erkhet's screens and menus | The owner's goal is one core reused by several business systems; Erkhet is a reference for capabilities and the accountant's order of work. |

## Consequences

**Positive.**
- One set of books from the go-live day, with no second program to reconcile.
- e-Barimt and procurement land on their final homes; the PMS joins an engine that already carries full books.
- Every phase ends with `pnpm check` green and today's screens working.

**Negative.**
- About 27–34 core sessions before go-live, far more than the 4–5 weeks of Finance II planned in delivery 10; feature work waits during P2–P4.
- Go-live now depends on the accountant's answers (D8, D15, D16, D17, D25, D27 and the asset and closing rules).
- With Erkhet gone as a fallback, the opening import and its sign-off become the riskiest step of the cut-over.

**Follow-ups.**
- P0b is the next finance session; the main session writes STATUS with this track.
- An interview with the accountant on #7 before P5; D16, D17, D25 and D27 first.
- The owner sends a sample Khan Bank statement in Excel, and with the accountant finds how Erkhet exports its chart, closing trial balance, party balances and asset register (TODO-VERIFY).
- SPEC §9.4 gains a rehearsal of the opening import and its sign-off on staging.

## Related

ADR-0017, ADR-0018, ADR-0026, ADR-0060, ADR-0064, ADR-0065 (reserved), ADR-0069, ADR-0070, ADR-0071, ADR-0072, ADR-0073, ADR-0074, ADR-0075, ADR-0076; `docs/SPEC.md` §5.8, §5.11, §5.13, §9.3, §9.4, §11; `docs/modules/finance-core.md`; `docs/STATUS.md`.
