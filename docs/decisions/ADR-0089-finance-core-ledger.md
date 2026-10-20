# ADR-0089: The Finance Core's ledger (the rest of F1): the chart and money accounts move with their ids, roles become append-only rules, the journal moves without its history

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-20 |
| Deciders | Owner (plan approved 2026-10-20), Claude (Claude Code session, Finance Core F1 ledger) |
| Implements | ADR-0083 #2 and #3 (F1's ledger half), ADR-0072 #1–#4 (posting keys and rules as data), ADR-0075 (periods, OPEN / CLOSED only), on P1's organisation (ADR-0084) and within ADR-0088 (one company per installation) |
| Amends | ADR-0060 #7 (the chart, the roles and the journal are the core's; the role dialog writes a dated rule), ADR-0064 #2 (the shift entry posts by role through finance's façade; the FKs to the journal and the money accounts are dropped), docs/modules/finance-core.md §4.1 and §16.0 (F1 done) |

## Context

P1 built the organisation: schema `fin`, company BO, branches, sources, posting keys and parties (ADR-0084). F1's other half is the ledger (ADR-0083 #3):
- accounts with today's codes;
- money accounts;
- monthly periods;
- the journal with its balance guards and a reversal key;
- rules from today's roles;
- Bto's journal writers switched to the core;
- `journal_entries` / `journal_lines` dropped with no copy;
- a one-off development re-post.

There is no production database (ADR-0026). The development database held, on 2026-10-20:
- 15 accounts;
- one money account (CASH-1 on branch MAIN);
- two journal entries, both POS shift closes;
- no invoices, vouchers or credit notes;
- no manual entries.

## Decision

1. **The chart and the money accounts move into the core in F1, with their ids kept.**
   - Migration `0033_fin_ledger` copies `gl_accounts` into `fin.accounts` and `money_accounts` into `fin.money_accounts` (`OVERRIDING SYSTEM VALUE`, sequences set), then drops both public tables.
   - They are configuration, not history. Keeping the ids keeps `payments.gl_account_id`, `payments.money_account_id`, `pos_settings.handover_money_account_id` and `goods_receipts.money_account_id` valid. These are now plain ids: no foreign key crosses `fin` (ADR-0076).
   - An account gets:
     - its normal side from its kind; the contra-income accounts of sales returns and discounts are debit-normal;
     - a control from its role's key: AR is RECEIVABLE, CASH and BANK are MONEY, CUSTOMER_ADVANCE is ADVANCE_RECEIVED.
   - A money account's branch goes through `fin.branch_refs`. The migration maps the ACTIVE Bto branches, as the boot step does. A money account on a closed, unmapped branch keeps no branch.
   - A new money account on a branch added after boot maps that branch on the spot (`FinOrgService.syncBranchInTx`). A closed branch takes no new money account (422 `branchId` `active`); before, any branch did.
   - Bto's money-account balance is still Σ of its posted vouchers until the receivables move (F2).
2. **Roles become append-only posting rules.**
   - `fin.posting_rules` holds, per company and posting key, an account or NULL ("no account"). Each row has an `effective_from`. The newest row in force on the accounting date wins.
   - The migration and the boot seed of an empty chart (`ensureDefaultChart`, from fin-bridge's template: `DEFAULT_GL_ACCOUNTS`, mn.json names, `POSTING_KEY_OF_ROLE`) write one rule per role, in force from 2000-01-01.
   - The role dialog keeps its meaning and its answers (`ACCOUNT_ROLE_TAKEN`; "an account holding a role stays active"). It writes rows dated today: the new role's key maps to the account, and the role the account held before is unmapped.
   - **Behaviour change:** an entry dated before a role change still posts to the account that held the role on its own date. Before, the current holder was used.
   - A missing or unmapped key is `FIN_MAPPING_MISSING`. Finance answers it, like an inactive account found by role, as today's 409 `ACCOUNT_ROLE_MISSING`.
   - The boot never re-seeds a chart that has accounts. Before, it re-added any default account that was missing.
3. **The journal is the core's.**
   - The tables are `fin.journal_entries` and `fin.journal_lines`, with company-scoped composite keys and UNIQUE `(company_id, number)` and `(company_id, reverses_id)`.
   - Both are append-only: REVOKE UPDATE / DELETE / TRUNCATE, plus `fin.forbid_update_delete`.
   - `fin.journal_entry_balanced()` is the core's own deferred trigger: at least two lines and Σ debit = Σ credit at commit, for every role.
   - An entry keeps:
     - its source key: the source system, the document type and id (`INVOICE` / `PAYMENT` / `CREDIT_NOTE` / `POS_SHIFT`), kept on a reversal too;
     - its period;
     - its actor by value.
   - A line keeps its posting key and rule, its party (`customer:<id>` through `party_companies`) and its money account.
   - Bto's `source` values (AUTO_INVOICE …, MANUAL, AUTO_VOID) are derived from these columns, so the HTTP answers are unchanged:
     - source FIN is MANUAL;
     - a BTO entry with `reverses_id` is AUTO_VOID;
     - otherwise the document type decides.
   - The old tables are dropped with their FKs and the public `journal_entry_balanced()`. The documents' entry ids are cleared.
4. **Numbers stay Bto's until F2.** Finance allocates the `Ж-` number (JE_NO, `finance_settings`) and passes it in, so the lock order and «Дугаарлалт» are unchanged. The core's own number series comes with F2's documents.
5. **Periods are OPEN / CLOSED only.**
   - A posting creates its month's `fin.fiscal_periods` row OPEN on demand and share-locks it.
   - A CLOSED month, or a month without a row before the latest CLOSED one, refuses with `FIN_PERIOD_CLOSED`.
   - Nothing closes a month before F5.
6. **The façade.**
   - `FinJournalPosting.postEntryInTx` / `reverseEntryInTx` post inside the caller's transaction until F2's intake replaces them. ESLint lets only `modules/finance` import them. pos keeps posting through finance's `JournalService`.
   - Accounts come from three places, in order: an explicit account id, a money account's account, or the key's rule.
   - The core checks the balance, the scale, the accounts' status and the period again.
   - F1 does not yet enforce the party and money-account controls; F2 does, with open items. Kind, side and control are not frozen yet.
   - Reads (`FinJournalReader`: entries, an entry, an account's ledger, the turnover per account) live beside the posting code, because only `finance-core/posting/**` may name the journal tables.
7. **Who calls.**
   - Automatic entries post as source BTO (`FinContexts.forSource`).
   - A manual entry and its reversal post as the staff member (`forUser`; source FIN, right `finance.journal.manage` in BO).
   - The chart, the rules and the money accounts are changed by the staff member with today's rights (`finance.journal.manage`, `finance.settings.manage`) or `finance.config.manage`.
   - Finance depends on fin-bridge (`MODULE_DEPS`) for the contexts and the customers' parties. A customer the core has not seen gets its party from its facts first.
8. **No copy of the journal; a typed entry stops the migration.**
   - The automatic entries are posted again from their documents by the one-off `pnpm finance:repost-journal` (development only, idempotent):
     - invoices, credit notes and vouchers, dated as the document;
     - their voids, dated on the day they were voided;
     - closed POS shifts, from the totals kept on the shift.
   - A manual or opening entry has no document to post it from, so `0033` raises when one exists. Such entries are exported first. The development database had none.
9. **The assistant's voucher view `ai.payments`** is recreated over `fin.money_accounts` and `fin.accounts` with the same columns. There is one company per installation (ADR-0088), so it has no company filter.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep `gl_accounts` and `money_accounts` in Bto and only move the journal | Two charts: the role dialog and the journal would drift apart, and the core could not resolve keys or money accounts without reading Bto |
| Seed a fresh chart and fresh money accounts in `fin` (new ids) | The payments, POS settings and goods receipts would point at the wrong rows; the copy with ids is configuration, not history |
| Mutable rules (a role column on `fin.accounts`) | ADR-0072 makes rules append-only and dated; a mutable mapping loses which account a past entry was meant to hit |
| The core numbering its entries now | It needs F2's number series and moves «Дугаарлалт»; the caller's number keeps today's order and screens |
| A frozen copy of the old journal | ADR-0083 #2: no production data exists; the re-post rebuilds the development books from the documents |
| Enforcing the party / money-account controls in F1 | Manual entries today post to AR without a customer; the controls come with open items (F2), where the sub-ledger needs them |

## Consequences

- Migration `0033_fin_ledger`, in this order:
  - six `fin` tables;
  - grants and triggers;
  - the data section: posting keys, branch maps, the chart and rules with ids, money accounts with ids, the documents' entry ids cleared, and a `DO` check;
  - the old FKs, `ai.payments`, the four old tables and the old balance function dropped;
  - `ai.payments` recreated.
- The api's boot (fin-bridge) seeds an empty chart. Finance's own boot sync (`reference-data.ts`) is gone.
- The test gate:
  - today's HTTP scenarios are unchanged;
  - `finance-guards.spec.ts` asserts the same SQLSTATEs on `fin.*`: 42501 for app, 23001 for migrator, 23514 at COMMIT, now for app as well;
  - `fin-ledger-guards.spec.ts` adds two racing reversals (exactly one commits) and append-only rules;
  - `fin-ledger.int-spec.ts` proves the ledger with no Bto module.
- The ESLint G2 ban `finJournalPosting`, and `ensureDefaultChart` beside `ensureDefaultCompany` for fin-bridge only. The two schema aggregators may list the ledger tables.
- The owner runs `pnpm db:migrate` and then `pnpm finance:repost-journal` once on the development database, with dev stopped. The walk copies (`tugeel_ca3`, `tugeel_rep`) take the same two steps when they next need `main`.

## Related

ADR-0060, ADR-0064, ADR-0072, ADR-0075, ADR-0076, ADR-0083, ADR-0084, ADR-0088; docs/modules/finance-core.md §3.7, docs/modules/finance.md, docs/modules/fin-bridge.md.
