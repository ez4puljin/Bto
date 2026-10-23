# ADR-0073: Bto's `billing` module owns the product invoice, the sales return and the credit policy; the core owns the money side

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-18 |
| Deciders | Owner, Claude (Claude Code session) |
| Amended by | ADR-0083 (2026-10-20: the billing split, H1, moves after go-live; modules/finance calls the core directly until then); ADR-0101 (2026-10-23: #5 superseded — an overdue amount never refuses, so `credit.overdue_nets_credits` and `creditsOpen` are gone; HOLD and LIMIT stand) |
| Supersedes | ADR-0060 #3 (ownership only: the invoice is a Bto document of `billing`; its rules stand — one invoice per sold order, the delivered quantities, the part filling, the tax split per line, the due date, immutability, the void); ADR-0060 #6 (stock handling leaves finance: the sales return of `billing` posts `RETURN_IN`; the core receives an `AR_CREDIT`) |
| Amends | ADR-0060 #2 (the balance and the overdue amount come from the core's exposure; by default unapplied credits net the overdue amount; HOLD → OVERDUE → LIMIT, no tolerance, every payment method and the open orders summed by sales are unchanged); SPEC §6.2 #1–#2; architecture §4 (the `finance` row; new `billing` and `fin-bridge` rows) and §5.5 |

## Context

Finance I (ADR-0060) built three commercial things inside `modules/finance` (a file named without a folder below is in `apps/api/src/modules/finance/services/`):
- **The product invoice.** `InvoicingService.onSold` (`apps/api/src/modules/finance/services/invoicing.service.ts:53-158`) fills the order's frozen parts with the delivered quantity (`invoicePartsFor`, `packages/shared/src/finance/index.ts:236`), splits the tax per line and sets the due date from the customer's term (`invoicing.service.ts:99-100`). Its tables hold products, units, factors, price bases and warehouses, with foreign keys into catalog, identity, inventory, partners and sales (`apps/api/src/modules/finance/schema.ts:32-36`; `invoices_order` at `:259`).
- **The credit note with goods back.** `CreditNotesService.create` checks the warehouse scope (`credit-notes.service.ts:158`), keeps each line within what is left of it (`returned_base`, `:184-192`) and posts `RETURN_IN` into the RETURNS bin (`:230`, `:257-277`); without a warehouse it is a price correction (`:43-44`). Inventory reads the credit note's number by raw SQL (`apps/api/src/modules/inventory/services/stock-posting.service.ts:717`), which ESLint cannot see.
- **The credit check.** `CreditControlService.check` (`credit-control.service.ts:18-39`) answers HOLD, OVERDUE or LIMIT from the receivables balance (`ar-ledger.service.ts:142`) and the live overdue amount (`:160-173`). The limit, the hold and the term live on `partners.customers` (`apps/api/src/modules/partners/schema.ts:71-75`); sales sums the other open orders under the customer lock (`apps/api/src/modules/sales/services/sales-orders.service.ts:679-711`).

ADR-0069 makes the Finance Core depend on no Bto module, so products, units, warehouses, bins, orders and Bto's credit terms cannot live in it. The core books the receivable, the open items and the journal entry (ADR-0071, ADR-0072).

The owner's answers (2026-10-18): a finance refusal stops the Bto sale, as today (D11); advances and overpayments are applied to invoices only by the accountant, by hand (D7); no preference on whether an overdue invoice should block while the customer has an unapplied advance (D7b). Defaults kept because they were not asked: credit limits stay in partners (D14); a voided invoice is re-billed through a new order (D23).

Today any overdue amount blocks every order (`credit-control.service.ts:34`), even when the customer has paid more than it in advance. No route applies an existing remainder to a later invoice: the only allocation paths are the payment's own (`payments.service.ts:223-225`, `:558-636`) and the credit note's (`credit-notes.service.ts:294-306`). With credits applied only by hand, such a block lasts until the accountant allocates.

## Decision

1. **A Bto module `billing`.** In phase H1 (before delivery 5; ADR-0077) `modules/finance` becomes two Bto modules: `billing` (this ADR) and `fin-bridge` (the legacy finance routes, the call contexts and the party refs; ADR-0069, ADR-0071, ADR-0076). Until H1 the code stays in `modules/finance`; phase P4 only switches its writes to the intake. `MODULE_DEPS.billing = ['identity', 'catalog', 'partners', 'inventory', 'sales', 'ebarimt', 'fin-bridge']` plus `finance-core/index.ts`. Sales reaches billing only through its hooks (`CREDIT_CHECKER` and `SALE_SINK`, `apps/api/src/modules/sales/hooks.ts:44`, `:100`) and never imports it.

2. **What billing owns.** The tables `invoices`, `invoice_lines`, `credit_notes` and `credit_note_lines` stay in schema `public` with every commercial column; in code the credit note becomes the sales return (`billing/sales-returns.service.ts`). Billing keeps:
   - the numbering `Н-…` and `К-…` (`FINANCE_NUMBER_DEFAULTS`, `packages/shared/src/finance/index.ts:25-31`; scopes `INV_NO` and `CN_NO` in identity's `number_sequences`), the patterns in a `billing_settings` row split off `finance_settings`;
   - the invoice rules of ADR-0060 #3: one invoice per sold order (`invoices_order`), lines with products, units and factors, the part filling (moved to `@tugeel/shared/billing`), the tax split per line from `@tugeel/shared/mn` (ADR-0074), the due date = the invoice date + the customer's term (`credit.payment_term_days` stays a Bto setting);
   - the sales return: it names an invoice and the quantities per line, stays within `returned_base`, checks the warehouse scope and posts `RETURN_IN` through `StockPostingService` into the chosen bin (RETURNS by default); without a warehouse it is a price correction;
   - the void, allowed while nothing is allocated to the invoice; a voided invoice is re-billed through a new order (D23; `invoices_order` unchanged).

   The raw SQL by which inventory reads a credit note's number is removed in H1.

3. **What billing sends the core.** Billing writes no `fin.*` table and the core reads no billing table. In the sale's transaction, after the stock issue, billing calls `FinIntakeInTx.submitInTx` (ADR-0071) with the SOURCE principal `BTO`, in a context only `fin-bridge` builds (ADR-0076):
   - the invoice → class `AR_INVOICE`, document type `BTO.SALES_INVOICE`, source key `BTO/SALES_INVOICE/<invoice id>`, source number `Н-…`; lines by posting key (ADR-0072): AR debit for the total with an open item due on the due date (no AR line when the total is 0), SALES_DISCOUNT debit, SALES credit, VAT_OUTPUT and CITY_TAX credits with their tax code and base;
   - the sales return → class `AR_CREDIT`, source key `BTO/SALES_RETURN/<id>`, settling the invoice's item (target `BTO/SALES_INVOICE/<invoice id>`); a remainder follows the document type's `unapplied_key` (ADR-0072);
   - the void → `REVERSE` of the invoice's key, dated the day of the void as today (`invoicing.service.ts:203-208`); the core refuses it with `FIN_REVERSAL_BLOCKED` while other allocations on the item are live.

   Billing stores the core's document id and journal number (`fin_document_id`, `fin_journal_no`) beside its own number. `invoices.open_amount` is read from the core from P4 and dropped in H1. The sale sink keeps returning `{ invoiceId, number }` (`sales/hooks.ts:91-98`). A core refusal throws inside the sale's transaction and rolls back the stock issue and the INVOICED step (owner D11; today `sales-orders.service.ts:808-817`).

4. **The credit policy is Bto's.** `billing/credit-policy.ts` binds `CREDIT_CHECKER` in place of `CreditControlService`. The limit, the hold and the term stay on `partners.customers` (D14). The checker asks the core for the customer's exposure in the same transaction: `FinCreditPortInTx.exposureInTx(tx, ctx, { company, party })` returns `{ receivableOpen, creditsOpen, net, overdue, oldestDueDate }`; `overdue` is live in the company's timezone, and the company setting `exposure.accounts` names the control accounts that count (`docs/modules/finance-core.md`). Sales still sums the other open orders (CONFIRMED, PICKING, PACKED, DELIVERED). The reasons keep their order: HOLD on `credit_hold`; OVERDUE as in #5; LIMIT when a limit is set and `net + openOrders + amount` exceeds it. A refusal stays 409 `CREDIT_BLOCKED` with its params, plus `creditsOpen`.

5. **The default overdue rule (owner: no preference, 2026-10-18).** OVERDUE only when the overdue amount exceeds the customer's unapplied credits: `overdue > creditsOpen`, the credit items on the exposure accounts not yet allocated. A customer who paid 200,000 in advance and has 150,000 past due on an invoice the accountant has not matched is not blocked; with 250,000 past due it is. A Bto setting `credit.overdue_nets_credits` (default on) lets the owner return to today's rule, where any overdue amount blocks. This is credit policy only: the items stay open until the accountant allocates them (ADR-0072).

6. **Locks while the core runs in-process.**
   - Confirmation or re-price: `customers.lockForUpdate` (`apps/api/src/modules/partners/services/customers.service.ts:517-531`) → sales sums the open orders → `exposureInTx` takes the party's `party_companies` row `FOR NO KEY UPDATE` → the decision.
   - Sale: order → stock → customer → `submitInTx` (intake row → period → party → money accounts → items → counters; ADR-0071). The order turns INVOICED in the same transaction, so its amount is never counted twice or not at all.
   - Both calls run as the source `BTO`; the staff member is attribution only. The SALE stage needs only `sales.orders.read` (`apps/api/src/modules/sales/controllers/sales-orders.controller.ts:33`, `:267-269`) and warehouse staff run it, so a user-based check would hand finance rights to every warehouse user.
   - The gate: `apps/api/test/integrity/finance-races.spec.ts:50` passes after every phase, run with a sales rep who holds no finance grant.

7. **Credit reservations only when needed.** If the core runs in another process, or a second system extends credit to the same company and party, the core offers credit reservations: requested before Bto's confirmation, evaluated under the party lock against a limit the core holds, consumed by the `AR_INVOICE`, released by a cancel. That replaces "sales sums the open orders" and gets its own ADR. Nothing of it is built now.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The product invoice and the return in the core, with product lines | The core would carry products, units, warehouses and bins, and a PMS using it would carry Bto's code: the boundary fails the requirements' own test (ADR-0069). |
| The invoice and the return in `sales` | Sales would import the core and `ebarimt`, ending ADR-0060 #1's rule that sales never imports finance; a return is not an order state. `billing` keeps the order workflow apart from the documents that bill it. |
| The credit limit and hold on the core's parties now | No second system extends credit (owner default D14); the limit, hold and term are Bto's commercial terms, and #7 is the path when one does. |
| Commit the sale and post the invoice later, with an «awaiting finance» state | Owner D11: a refusal stops the sale. Without reservations an order would be counted twice or not at all while its post is pending. |
| Keep today's rule: any overdue amount blocks | With credits applied only by hand, a customer who paid in advance is refused because of an invoice issued after the payment, until the accountant allocates. |
| Apply credits automatically after every invoice | Owner D7: only the accountant applies credits. |

## Consequences

**Positive.**
- The core holds no product, unit, warehouse or order concept; a PMS posts the same AR classes without Bto's code.
- The wholesale screens, numbers and printouts stay as they are.
- The credit check keeps its strength and its race test.
- A customer who paid in advance is not refused for an invoice the accountant has not matched yet.

**Negative.**
- A sale makes two records, billing's invoice and the core's document, linked by the source key and the stored numbers.
- Every confirmation takes one more row lock, the party row in the core.
- By default a customer may buy while an overdue invoice and an unallocated credit both stand; the accountant still has to allocate.
- Bto's sale stays bound to the core's transaction: a remote core needs reservations and an «awaiting finance» state first.
- H1 is a refactor of about two sessions that changes no screen.

**Follow-ups.**
- P4: invoicing, the void and the credit note through `submitInTx`; `exposureInTx`; the credit policy over it with the default rule; the race gate with a rep who holds no finance grant.
- H1: the split into `billing` and `fin-bridge`, `billing_settings`, `open_amount` dropped, the inventory raw SQL removed, `MODULE_DEPS`, `docs/modules/billing.md`.
- TODO-VERIFY (accountant): whether the `Н-` daily numbers are a valid legal invoice numbering (D15); the discount shown gross or net of VAT (D9); revenue earned at the SALE stage or on delivery (D24).
- The owner may change the default overdue rule (`credit.overdue_nets_credits`) at any time.

## Related

ADR-0055, ADR-0056, ADR-0060, ADR-0069, ADR-0071, ADR-0072, ADR-0074, ADR-0075, ADR-0076, ADR-0077; `docs/SPEC.md` §6.2, §6.9; `docs/architecture.md` §4, §5.5; `docs/modules/finance.md`, `docs/modules/finance-core.md`.
