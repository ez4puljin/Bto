# ADR-0245: Identified expiry markdowns and sold-only payroll loss

| | |
|---|---|
| Status | Accepted, local development |
| Date | 2026-11-22 |
| Decider | Owner: acquisition-cost shortfall, actual sold quantities only, operator-selected payroll month |
| Amends | ADR-0172's observation-only register by adding an explicit commercial approval; its counts and stock rules remain |

## Decision

1. An expiry register row remains an observation. Existing rows, status changes and liability annotations create no stock posting, price change or salary charge. An unmatched historic acquisition is unavailable, never an inferred latest purchase or a zero price.
2. A cost manager explicitly selects one posted, costed receipt **line for the same product**, and a supported base quantity. Source reservations cannot exceed the receipt line's actual received quantity across records. Separate intentional product/date records can identify separate sources. A published source is frozen; changing provenance requires a new record rather than rewriting sale evidence.
3. Source detail distinguishes first valuation V1 printed gross amount, its original quantity, allocated purchase discount and free-goods evidence from the latest corrected accounting amount and version. Supplier net payable is a separate amount. Acquisition N+M campaign names and paid/free pairing are not recorded by receipts and are not invented. ADR-0236 keeps purchase discounts outside accounting stock cost; recorded accounting cost, including a genuine historical costing method, is the authoritative loss basis. Free goods have zero accounting cost.
4. A markdown is an immutable revision with its own internal Code128 `BTOEXP-<id>` label, explicit warehouse, retail till or wholesale pipeline, strictly positive base-unit gross selling price, quantity budget, acquisition amount/quantity ratio, costing version, responsible users and payroll month. Existing POS requires a positive tender; a zero-only cart is not introduced by this feature. Free-goods acquisition cost remains zero. The namespace is reserved from normal catalogue barcodes. It never becomes a product-wide price or program: ordinary fresh-stock barcodes retain normal pricing.
5. Publication takes **all** `inventory.costs.manage`, `expiry.liability.manage` and `pricing.prices.manage`, plus the warehouse write scope. A below-cost approval needs an explicit payroll month and at least one active liable user. The context adapter determines the actual tax-exclusive price; warehouse price is not fabricated as a per-warehouse price. Current comparison quotes name the channel/till/pipeline and mean one base unit in its own cart, using the normal quote engine. A sale fixes its source price and cannot stack another program or manual override onto the employee liability.
6. `SPECIFIC` expands saved role IDs and explicit users once; `ALL_STAFF` expands active staff once. Stable user IDs are deduplicated and frozen, with names as evidence. The loss is divided equally in cents; any remainder goes to ascending user IDs. Later staff membership, liability annotations or receipt re-costing cannot rewrite an approved sale's evidence.
   A financial draft pins the item edit version, source version/line, costing version and a protected SHA256 fingerprint of its liability annotation plus expanded active IDs. The confirmation shows that pinned cost/source/employee basis. Publication compares each token after locking the item and receipt, returning a conflict on drift. Refetch never silently substitutes a different financial basis; the operator explicitly reviews the current basis while retaining typed price/quantity/context/month.
7. Only a finalized POS or wholesale sale with explicit barcode attribution creates an allocation, in the **same database transaction** as the normal sale posting. The trusted sale module supplies actual base quantity, gross amount and actual VAT-exclusive revenue. Loss is `max(0, frozen accounting amount × sold base quantity / frozen receipt base quantity − actual VAT-exclusive revenue)`, rounded once to money. A stored ratio avoids rounding unit acquisition cost before multiplication. No SKU/date matching or editable manual sold counter proves a sale.
8. The quantity budget is separate from original counts and stock. Item gates serialize allocations across revisions; actual sold quantities cannot exceed either observed or receipt-supported quantity. An offline sale completed before an approval's stop may consume still-unsold proven units, reducing every replacement offer's available capacity. Stopping an approval affects later sales and cannot erase older allocations. Archiving appends stop records under the same gate; restoring never revives an old label. Source selection/publication marks a carried record touched, so re-carry cannot overwrite its commercial evidence. Expiry date is printed evidence, not an invented legal or commercial prohibition on sale.
9. Replays use stable source kind/sale/line identity and must match the immutable input. An offline completed sale whose price, historical approval or capacity cannot safely allocate is kept as a durable, visible **unallocated exception** with no employee charge or budget overdraw. Replay preserves that disposition even after capacity changes. A privileged operator may explicitly close it without charge with a reason. This does not silently allocate it later. POS also retains its diagnostic on the sold line.
10. A real return follows the original allocation and reverses only its original responsible employees' shares. Partial returns use cumulative proportional rounding; a final return reverses every remaining original cent exactly. Return identity is unique, quantity cannot exceed the original sale, and a repeated return cannot refund twice. Valid returns restore eligible shared quantity capacity; a stopped label stays stopped.
11. Payroll owns durable source obligations and settlement history independently of draft payroll lines. The selected month is preserved when a run is absent, closed or the employee is ineligible. Such an obligation waits for the payroll manager's explicit writable-month assignment; completed sales never edit approved old salary. Returns credit unsettled original obligations in their month; a settled original waits for an explicitly chosen refund month. Recompute, eligibility refresh and reopening cannot lose or duplicate the source obligation. Payroll remains separate from Finance Core employee receivables (ADR-0235).
12. A source-commerce transaction acquires the expiry batch gate and payroll source gate **before inventory, finance or expiry financial row locks**. Publish/stop/source changes use the same gate. Item locks precede per-markdown balances and guard cumulative returns; original sale facts remain immutable reads, with UPDATE still revoked. This prevents opposite-order barcode batches from holding each other's rows while waiting for payroll.
13. Ordinary expiry and cashier contracts contain no acquisition cost, payroll month or private deduction detail. Commerce source/cost reads require `inventory.costs.manage`; payroll month and frozen employee IDs are additionally redacted without liability permission. Payroll private details retain payroll rights. Generic audit metadata names identifiers and the operation, never acquisition prices, loss amounts or deduction amounts (ADR-0244).
14. Migration `0129_expiry_commerce` is additive and backfills no commercial source, sale allocation or salary. Immutable snapshots, append-only sale/return evidence, finite nonnegative money/quantity checks, source capacity, employee reversal bounds and payroll settlement guards are enforced by the database as well as services. No applied migration is changed. The namespace and finite-quantity CHECKs on existing tables are added NOT VALID: migration does not scan or change legacy rows, while all new inserts and updates must satisfy them. No VALIDATE or cleanup runs as part of this delivery. Applying the migration creates no commercial transaction or payroll deduction; those require explicit authorized service calls.

## Consequences

Staff must label and sell the identified expiry units through the special barcode. Ordinary product sales cannot retrospectively prove an expiry sale. Offline tills can oversell a stale snapshot; those completed sales stay visible for an explicit disposition instead of creating an unsupported salary charge. Receipt-source reservations are conservative and cannot be reused by merely archiving a register row.

## Related

`docs/modules/expiry.md`, `docs/modules/inventory.md`, `docs/modules/pricing.md`, `docs/modules/payroll.md`, ADR-0172, ADR-0233, ADR-0236, ADR-0244.

## Inbox implementation amendment: synchronous ports

Sales owns `EXPIRY_SALE_POSTING`, POS owns `POS_EXPIRY_OFFERS`, and expiry owns
`EXPIRY_PAYROLL_SOURCE`. Application composition binds synchronous adapters to the public
expiry and payroll services in both API and worker roots. Consumers resolve the required
binding through `ModuleRef`; missing commercial bindings fail closed, never silently skip
allocation or liability. Wholesale and payroll adapters pass the identical `Tx` and actor and await the owner service.
POS uses a nested savepoint on that same physical transaction, as specified below. The expiry-before-payroll transaction lock order,
source idempotency keys, frozen allocation shares and exact return reversals stay unchanged.
There is no asynchronous event or out-of-transaction fallback. No sales/POS-to-expiry or
expiry-to-payroll module dependency is added to the lint guard.


## Completed POS document failure policy (2026-11-25)

A paid edge SALE or completed edge RETURN is an immutable commercial fact. Any expiry-side
`AppError` must not park that document in `pos_sync_rejections`. The POS composition adapter
runs each explicitly attributed expiry line inside a nested database transaction (savepoint).
On an `AppError`, it first rolls back that savepoint, including any partial allocation, budget
change, audit record and payroll insertion, then records a durable diagnostic in the parent
transaction and lets normal central stock/accounting posting finish. Successful other lines
retain their valid allocations. Wholesale finalization retains its strict existing policy.

Non-`AppError` failures, including PostgreSQL statement timeout `57014`, lock timeout `55P03`,
programming failures and missing composition bindings, abort the whole central document.
The edge receipt remains committed and its outbox event remains PENDING for retry. Failure to
persist the fallback diagnostic also aborts the central transaction; no diagnostic is discarded.

`expiry_pos_exceptions` has canonical operation/document/line identity, trusted original sale
identity for returns, product/unit/warehouse/till/barcode facts, quantity/time and a bounded
stable error code or explicitly allowlisted reason. It has no required expiry item or markdown
foreign key, so missing provenance can be recorded. Arbitrary error detail, parameters, causes,
SQL and stacks are never persisted. A previous diagnostic prevents automatic later allocation;
central event replay remains idempotent. Existing FK-backed sale exceptions are retained.

Only a RETURN whose trusted original sale line carries an expiry barcode enters this policy.
A marked return with no original allocation becomes `EXPIRY_RETURN_SOURCE_MISSING`; ordinary
returns remain ordinary. A failed expiry reversal does **not** erase the original sale charge
or restore its expiry quantity budget: both remain pending explicit review, while the completed
return's normal central stock/accounting facts post. No new charge or negative payroll entry
is invented. The admin report always labels this as an unresolved reversal, even after acknowledgement.

The cost-protected global exception list combines old and new origins using the complete
(created-at, origin, ID) cursor; itemless rows and return exceptions remain visible. Reads retain
ADR-0027's global visibility. Acknowledgement requires all three cost/liability/price permissions
and the warehouse write scope. It records one immutable note and actor/time, performs no
financial repair, and does not clear the return's unresolved-liability label. Application grants
and insert/update triggers reject pre-acknowledged inserts, fact changes, repeat acknowledgement
changes, deletion and truncation. No automatic compensation, reassignment or retrospective
employee charge is introduced.
