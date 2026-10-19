# ADR-0075: Monthly periods per company with a guarded close and an audited reopen, drafts with approval, and separate rights

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0027 (#2: finance permissions are resolved per company from `identity.user_company_roles`); ADR-0060 (#9: seven new finance rights, and manual and opening entries post only after approval) |

## Context

The owner's corrected goal (2026-10-18) asks the Finance Core (ADR-0069) for reporting periods that are closed and reopened under permission control, and for separate rights to create, approve and view documents. Erkhet stops on Bto's go-live day (owner, 2026-10-18; ADR-0077), so Bto's month-end close becomes the company's real close.

Today nothing guards a period:
- There is no period table. The only date check is `assertNotFuture` (`apps/api/src/modules/finance/services/journal.service.ts:596-598`), used for payments, credit notes and manual entries, so any past date is accepted.
- The finance rights separate viewing from writing only (`packages/shared/src/auth/index.ts:49-55`). `finance.journal.manage` both writes and reverses a manual entry, which posts at once; there is no approval state.
- Roles are global: `user_roles(user_id, role_id)` has no company (`apps/api/src/modules/identity/schema.ts:100-114`).
- The approval precedent is inventory adjustments: DRAFT → SUBMITTED → POSTED | CANCELLED (`apps/api/src/modules/inventory/schema.ts:52`), posted with the separate `inventory.adjustments.approve` (`apps/api/src/modules/inventory/controllers/moves-adjustments.controller.ts:206-212`). The service never checks that the approver differs from the submitter.
- A POS shift close is dated the Ulaanbaatar day of the close (`apps/api/src/modules/pos/services/pos-shifts.service.ts:179`) and booked when the centre accepts it, which may be later (ADR-0064 "Negative"). A refused document is parked in `pos_sync_rejections` (`apps/api/src/modules/pos/schema.ts:513-534`) and replayed by the admin (`apps/api/src/modules/pos/services/pos-replay.service.ts:23-51`).
- A goods receipt may be re-costed until the end of the month after its posting month (ADR-0033 #7), so cost corrections arrive after a month has ended.
- Erkhet, read through its screens only, shows twelve months per year, each with a "closed" checkbox that is toggled at once with no reason, approval or history. That a tick locks the month comes from help text; no toggle was sent. Its roles are about 258 menu checkboxes plus a per-account level, with no approve right.

The owner's answers (2026-10-18): a document dated in a closed month waits in a pending list until the accountant decides (D10); no maker ≠ checker rule while there is one accountant, the option kept (D18 default).

## Decision

1. **Periods.** `fin.fiscal_periods(company_id, code 'YYYY-MM', starts_on, ends_on, status)` holds one row per company and calendar month in the company's timezone (ADR-0070). Phase P2 creates every month from the first entry's month to the current one. After that a row is created OPEN on demand, by the first posting in its month, only for a month later than the company's latest SOFT_CLOSED or CLOSED month; a document dated in an earlier month that has no row is refused with `FIN_PERIOD_CLOSED` and goes to the pending list like any closed-month document (#5). So a back-dated document never opens a month older than a closed one. Statuses: OPEN → SOFT_CLOSED → CLOSED. `fin.period_events` is append-only: the action, the old and new status, the reason, the checklist result, the actor and the time. Months move in order: a month is soft-closed only when every earlier month is soft-closed or closed, and closed only when every earlier month is closed (`FIN_PERIOD_ORDER` otherwise).
2. **Soft close and close** each need `finance.periods.close` and:
   - the month's last day has passed in the company's timezone (`FIN_PERIOD_NOT_ENDED`);
   - a checklist built from the reconcile runs of ADR-0072, the pending list (#5), the drain report of the clearing accounts and each source's completeness check (for Bto: every POS close accepted, no edge backlog). Which items block and which only warn is agreed with the accountant before phase P5 (TODO-VERIFY).

   A blocking item refuses with `FIN_CHECKLIST_FAILED {items}`. A holder of `finance.periods.override` may close anyway; the failed items are kept in the event row. A close takes the period row `FOR UPDATE` and every posting takes it `FOR SHARE` (third in the lock order of ADR-0071 #6), so a posting and a close never interleave.
3. **What may post.** OPEN: everything. SOFT_CLOSED: only document types flagged `allowed_in_soft_close` (Bto's daily cost of goods sold and the re-costing variances of ADR-0033 #7), and documents typed in the core's screens by a holder of `finance.periods.override`. CLOSED: nothing. The refusal is `FIN_PERIOD_CLOSED {period, status}`. When the year-end closing entry posts, and into which month, is the accountant's rule (TODO-VERIFY, ADR-0077).
4. **Reopen** needs `finance.periods.reopen` and a reason. It applies only to the company's latest month that is not OPEN and moves it back to OPEN, with an event row and an audit row; no other month changes with it. A reopen releases the month's HELD documents for a retry.
5. **A late document waits; nothing is moved automatically** (owner, 2026-10-18):
   - **Asynchronous intake** (from phase A1; the PMS): the intake row is HELD and shown on the core's pending list. After a reopen it is retried; otherwise its source cancels it (a REVERSE of a HELD target answers CANCELLED, ADR-0071 #3).
   - **In-process posting** (every `submitInTx`, and the POS close's journal posting until phase H2): refused with `FIN_PERIOD_CLOSED`, so the caller's transaction rolls back (ADR-0071 #8) and the source keeps the document. POS parks a late close in `pos_sync_rejections`, and the admin replays it after the reopen. A Bto sale is dated today (`apps/api/src/modules/finance/services/invoicing.service.ts:58`) and a month cannot close before its end, so a sale never meets a closed month.
   - **The core's own screens:** refused on screen; a draft stays a draft.
   - The per-company setting `intake.late_posting` has one value now, `HOLD`, the default. Moving a late document's accounting date into the first open month is not built; it needs a new owner answer and an ADR.
6. **Drafts and approval.** Manual entries (class JOURNAL) and opening entries (class OPENING) typed in the core's screens start in `fin.drafts`, the core's only mutable document store: DRAFT → SUBMITTED → POSTED, or CANCELLED; an approver may return a submitted draft to DRAFT. A draft has no number; posting hands it to the intake (ADR-0071), which numbers it. `fin.document_types.requires_approval` marks the types that need this, seeded on for these two. It is refused on any type a source posts in-process, because a sale cannot wait for a person. Vouchers and allocations the accountant records still post at once, as today.
   - `finance.journal.manage` writes, submits and cancels a draft; `finance.documents.approve` posts it or returns it.
   - **Maker ≠ checker** is the per-company setting `approval.maker_checker`, off by default (owner: one accountant). When it is on, the service refuses an approver who submitted the draft (`FIN_APPROVER_IS_SUBMITTER`). While it is off, a holder of both rights may submit and post in one action; the draft still records who submitted and who posted.
7. **Rights.** The codes are declared in `@tugeel/fin-contract` (ADR-0069). A unit test asserts that `packages/shared/src/auth/index.ts` lists the same strings, and each gets an `mn.json` label. ADMIN holds every code (ADR-0027 #4). The system-role defaults below are the owner's to change: any code may go into a custom role (ADR-0027 #5).

   | Code | Allows | System roles |
   |---|---|---|
   | `finance.read` | view a company's books | ACCOUNTANT, OFFICE (unchanged) |
   | `finance.payments.record`, `finance.invoices.manage`, `finance.journal.manage` | create documents, as ADR-0060 #9 | ACCOUNTANT (unchanged) |
   | `finance.settings.manage` | as ADR-0060 #9 | ADMIN (unchanged) |
   | `finance.documents.approve` | post or return a submitted draft | ACCOUNTANT |
   | `finance.periods.close` | soft-close and close a month | ACCOUNTANT |
   | `finance.periods.reopen` | reopen the latest closed month | ADMIN: the owner reopens what the accountant closed |
   | `finance.periods.override` | close despite the checklist; post into a soft-closed month from the core's screens | ADMIN |
   | `finance.intake.replay` | retry or cancel an item on the pending list | ACCOUNTANT |
   | `finance.config.manage` | the core's configuration (`FinConfig`): accounts and their control types, posting rules, document types, tax codes and rates, source grants | ACCOUNTANT (owner: the accountant marks the control types) |
   | `finance.control.approve` | open a company to the later control system (ADR-0076) | ADMIN |

8. **Rights per company.** `identity.user_company_roles(user_id, company_code, role_id)`, primary key over all three, owned by identity. A user's finance rights in a company are the `finance.*` codes of the roles granted there; no row means no finance access in that company, ADMIN included. Phase P1 backfills company BO from `user_roles`, with explicit rows for ADMIN. Bto's route guards keep the global roles (ADR-0027 #2). The per-request query (`apps/api/src/modules/identity/services/access.service.ts:46-63`) also reads the company grants, so a changed grant applies on the next request, and `fin-bridge` copies them into the `FinCallContext` (ADR-0076). If the core is ever run apart (ADR-0069 #9), the table moves into it, keyed by the principal.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Erkhet's month checkbox grid | No reason, no approval and no history; a month can be unlocked silently. |
| One lock date per company | No soft close, so the cost of goods sold and the re-costing variances that arrive after the month's end (ADR-0033 #7) would need the month reopened. |
| Move a late document into the first open month automatically | The owner chose the pending list (D10): a closed month stays closed and the accountant decides. |
| Reopen any month, or a reopen that reopens every later month (NetSuite) | Reopening only the latest month keeps the order of months simple and never reopens a month nobody asked for. |
| A permanently closed status now | Not needed before the first audited year; it can be added as a status later. |
| Locks per source system (NetSuite's "Lock A/R") | `allowed_in_soft_close` per document type covers the one case known today. |
| Approval for every document | A Bto sale or a POS close cannot wait for a person, and the accountant records the cash every day. |
| Maker ≠ checker on | One accountant (owner); the setting stays for when a second person joins. |
| A company as a `user_scopes` row | Scopes limit writes only (ADR-0027 #7); a company must also limit reads (ADR-0076). |

## Consequences

**Positive.**
- A closed month stays closed; nothing is moved silently, and every close, override and reopen leaves its reason in a row.
- Closing and reopening are separate rights, so the owner can check the accountant's months.
- Manual and opening entries can get a second look the day a second person joins.
- Rights are per company before company RES exists.

**Negative.**
- A close needs a clean checklist, so the accountant clears the pending list and the POS backlog first.
- A late POS close refused into a closed month keeps the shift OPEN at the centre, so the next shift on that till is refused with `POS_TILL_BUSY` (`apps/api/src/modules/pos/services/pos-shifts.service.ts:83-88`) until the month is reopened and the close replayed. The checklist's POS item makes this rare.
- Every finance user needs a company row; the backfill gives today's users theirs.
- A manual entry takes two steps unless the accountant uses the combined action.

**Follow-ups.**
- P1: `identity.user_company_roles` and the backfill. P2: `fin.fiscal_periods`, every month from the first entry's month to the current one, OPEN. P5: close, soft close, reopen, override, the checklist, drafts with approval, the pending list page and its attention tile, the new codes in the catalog with their `mn.json` labels.
- The accountant: which checklist items block (TODO-VERIFY), the closing entry's timing (ADR-0077), reversal dating (TODO-VERIFY).
- Tests (`apps/api/test/integrity/fin-periods.spec.ts`): posting into CLOSED (refused in-process, HELD from A1); a document dated in a month without a row before the latest soft-closed or closed month (refused with `FIN_PERIOD_CLOSED`, no row created) and in one after it (the row created OPEN); SOFT_CLOSED by type and with override; closing before the end date; a failed checklist with and without override; reopen without the right (403), without a reason, of a month that is not the latest, and its release of HELD documents; a close racing a post, in both orders.

## Related

ADR-0027, ADR-0033, ADR-0060, ADR-0063, ADR-0064, ADR-0069, ADR-0070, ADR-0071, ADR-0072, ADR-0076, ADR-0077; `docs/modules/finance-core.md`; `docs/SPEC.md` §3, §5.8, §6; `docs/architecture.md` §7.
