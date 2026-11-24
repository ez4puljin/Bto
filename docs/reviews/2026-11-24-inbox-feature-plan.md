# Remaining inbox features: review and landing plan

Review baseline: `origin/main` at `0f6467c80692b928dfefa192af1e42b6db128e48` (2026-11-24). This document is a review artifact, not a claim that the remaining features have landed. No database, launcher or demo/history generator was run to prepare it.

The original linked work covered 284 distinct paths; overlapping paths appear in more than one feature delta below. Reserved renumbering, regression coverage and transaction ports add or relocate paths. Counts below are exact sizes of the listed prepared manifests, not promises about a future generated API contract. Each actual submission is reconstructed from fresh `origin/main` only after every earlier feature touching its files has **LANDED**. Local cumulative review commits are never submitted as a feature branch.

The four excluded files remain excluded: `eslint.config.mjs`, `tools/brain/brain.test.mjs`, `docs/STATUS.md`, and `docs/decisions/README.md`. Existing LF policy needs no change. Board claims, inbox reads and number reservations follow ADR-0248; this plan requests no additional numbers.

## Landing order and file ownership

Existing translation values never ride with functional features: those branches add only genuinely new `mn.json` keys. Existing-value edits are separate wording branches and all four land LAST, serially, after functional, audit and tooling work. The listed wording manifests describe the current prepared paths; any matching literal test/guide follow-up must be inventoried with its final wording branch before push. They do not block HR or expiry. Functional tests and guides retain the accepted current labels; any literal wording expectations move with the later wording branch. New keys already landed by a predecessor are preserved; later branches add only their remaining new keys.

| Order | Submission                           | Prepared files | Dependency / scope                                                  |
| ----- | ------------------------------------ | -------------: | ------------------------------------------------------------------- |
| 1     | `in/low-stock-supplier-status`       |             11 | Existing-value wording removed; fresh current-main revision.        |
| 2     | `in/hr-position-salary-access`       |             59 | 0124 / ADR-0243; salary audit privacy lands before first exposure.  |
| 3     | `in/employee-salary-overrides`       |             20 | 0125 / ADR-0244; after HR.                                          |
| 4     | `in/expiry-payroll-foundation`       |             32 | 0126 / ADR-0245; pure ports and payroll foundation.                 |
| 5     | `in/expiry-sale-transactions`        |             58 | Consumers, both root adapters and transaction regressions together. |
| 6     | `in/expiry-commerce-screens`         |             29 | After transaction behavior.                                         |
| 7     | `in/supplier-location-price-engine`  |             61 | 0127 / ADR-0246; includes required import lock regression.          |
| 8     | `in/supplier-location-price-screens` |             24 | After pricing engine.                                               |
| 9     | `in/audit-request-validation`        |             30 | Remaining request validation; privacy already belongs to HR.        |
| 10    | `in/audit-interface-clarity`         |             27 | Four genuinely new translation keys stay with functionality.        |
| 11    | `in/qa-history-tools`                |             22 | Source only; existing accepted history retained.                    |
| 12    | `in/dual-local-start`                |              6 | Existing environments only; launchers are not executed.             |
| 13    | `in/local-audit-report`              |              1 | Historical local evidence, not current deployment proof.            |
| 14    | `in/wording-permission-bundles`      |              1 | LAST group: four existing values.                                   |
| 15    | `in/wording-inventory-movements`     |              3 | LAST group: 54 existing values and two guides.                      |
| 16    | `in/wording-expiry-rules`            |              1 | LAST group: one existing value.                                     |
| 17    | `in/wording-ui-clarity`              |              1 | LAST group: 88 existing values.                                     |

The pricing engine is **61 files**, rather than the earlier 60-file estimate: its existing price-import regression must expect the shared pricing lock as soon as the engine lands. This is within the requested approximate 60-file scope; its exact count and required regression are disclosed here. All other feature manifests remain below 60.

Shared files belong to the earliest feature that changes them. Their later entries mean incremental hunks against that already-landed main, never replacement by a cumulative historical file. This particularly applies to schema/journal/API metadata, payroll DTOs/services, POS/sales code, `mn.json`, and module documentation. Each migration belongs to one feature; the four migrations are not bundled.

The earlier catalog source group had seven files and has landed with follow-up header compatibility work. Its historical wording changes are not reapplied by this plan. Low-stock is shown because its wording-separated revision is part of the remaining handoff.

### Exact prepared manifests

#### 1. low-stock-supplier-status (11 files)

Existing-value wording removed; fresh current-main revision.

```text
apps/api/src/modules/inventory/dto/stock.dto.ts
apps/api/src/modules/inventory/services/stock-query.service.ts
apps/api/test/integration/stock.int-spec.ts
apps/web/src/features/guide/content/inventory/50-low-stock-filters.md
apps/web/src/features/inventory/api.ts
apps/web/src/features/inventory/low-stock-page.test.tsx
apps/web/src/features/inventory/low-stock-page.tsx
docs/modules/inventory.md
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/i18n/mn.json
```

#### 2. hr-position-salary-access (59 files)

0124 / ADR-0243; salary audit privacy lands before first exposure.

```text
apps/api/src/db/migrations/0124_hr_positions.sql
apps/api/src/db/migrations/meta/0124_snapshot.json
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/schema.ts
apps/api/src/modules/hr/controllers/engagement.controller.ts
apps/api/src/modules/hr/controllers/positions.controller.ts
apps/api/src/modules/hr/controllers/workforce.controller.ts
apps/api/src/modules/hr/dto/positions.dto.ts
apps/api/src/modules/hr/dto/workforce.dto.ts
apps/api/src/modules/hr/hr.module.ts
apps/api/src/modules/hr/index.ts
apps/api/src/modules/hr/schema.ts
apps/api/src/modules/hr/services/hr-settings.service.ts
apps/api/src/modules/hr/services/positions.service.ts
apps/api/src/modules/hr/services/workforce.service.ts
apps/api/src/modules/identity/controllers/org.controller.ts
apps/api/src/modules/identity/index.ts
apps/api/src/modules/identity/schema.ts
apps/api/src/modules/identity/services/audit-privacy.spec.ts
apps/api/src/modules/identity/services/audit-privacy.ts
apps/api/src/modules/identity/services/audit-query.service.ts
apps/api/src/modules/identity/services/roles.service.ts
apps/api/src/modules/identity/services/staff-accounts.service.ts
apps/api/src/modules/identity/services/users.service.ts
apps/api/src/modules/payroll/dto/payroll.dto.ts
apps/api/src/modules/payroll/schema.ts
apps/api/src/modules/payroll/services/payroll-people.service.ts
apps/api/src/modules/payroll/services/payroll-runs.service.ts
apps/api/src/modules/payroll/services/payroll-terms.service.ts
apps/api/test/integration/hr-directory.int-spec.ts
apps/api/test/integration/hr-positions.int-spec.ts
apps/api/test/integration/hr-workforce.int-spec.ts
apps/api/test/integration/payroll-positions.int-spec.ts
apps/api/test/integration/sensitive-audit.int-spec.ts
apps/api/test/integrity/hr-position-guards.spec.ts
apps/web/src/app/nav-items.ts
apps/web/src/app/router.tsx
apps/web/src/features/guide/content/hr/11-positions.md
apps/web/src/features/hr/community/community-pages.test.tsx
apps/web/src/features/hr/employee-page.test.tsx
apps/web/src/features/hr/employee-page.tsx
apps/web/src/features/hr/position-helpers.ts
apps/web/src/features/hr/position-kit.tsx
apps/web/src/features/hr/positions-page.test.tsx
apps/web/src/features/hr/positions-page.tsx
apps/web/src/features/hr/staff-dialog.tsx
apps/web/src/features/hr/workforce-api.ts
apps/web/src/features/identity/staff-permissions.tsx
apps/web/src/features/identity/user-access.tsx
apps/web/src/features/identity/user-form.tsx
apps/web/src/features/payroll/terms-page.tsx
docs/decisions/ADR-0243-position-salary-access.md
docs/modules/hr-positions.md
docs/modules/hr.md
docs/modules/identity.md
docs/modules/payroll.md
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/i18n/mn.json
```

#### 3. employee-salary-overrides (20 files)

0125 / ADR-0244; after HR.

```text
apps/api/src/db/migrations/0125_payroll_salary_overrides.sql
apps/api/src/db/migrations/meta/0125_snapshot.json
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/schema.ts
apps/api/src/modules/payroll/controllers/payroll.controller.ts
apps/api/src/modules/payroll/dto/payroll.dto.ts
apps/api/src/modules/payroll/schema.ts
apps/api/src/modules/payroll/services/payroll-terms.service.ts
apps/api/test/integration/payroll-positions.int-spec.ts
apps/api/test/integrity/payroll-salary-overrides.spec.ts
apps/web/src/features/guide/content/hr/10-payroll-kpi.md
apps/web/src/features/guide/content/hr/11-positions.md
apps/web/src/features/hr/positions-page.test.tsx
apps/web/src/features/payroll/payroll-pages.test.tsx
apps/web/src/features/payroll/terms-page.tsx
docs/decisions/ADR-0244-employee-salary-overrides.md
docs/modules/payroll.md
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/i18n/mn.json
```

#### 4. expiry-payroll-foundation (32 files)

0126 / ADR-0245; pure ports and payroll foundation.

```text
apps/api/jest.config.js
apps/api/src/db/migrations/0126_expiry_commerce.sql
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/migrations/meta/0126_snapshot.json
apps/api/src/db/schema.ts
apps/api/src/modules/expiry/ports.ts
apps/api/src/modules/expiry/schema.ts
apps/api/src/modules/payroll/controllers/payroll.controller.ts
apps/api/src/modules/payroll/dto/payroll.dto.ts
apps/api/src/modules/payroll/index.ts
apps/api/src/modules/payroll/payroll-month.ts
apps/api/src/modules/payroll/payroll.module.ts
apps/api/src/modules/payroll/schema.ts
apps/api/src/modules/payroll/services/payroll-runs.service.ts
apps/api/src/modules/payroll/services/payroll-source-deductions.service.ts
apps/api/src/modules/pos/expiry-offers.ts
apps/api/src/modules/pos/index.ts
apps/api/src/modules/pos/schema.ts
apps/api/src/modules/sales/hooks.ts
apps/api/src/modules/sales/index.ts
apps/api/src/modules/sales/schema.ts
apps/api/test/integration/expiry-payroll.int-spec.ts
apps/api/test/integrity/expiry-payroll-races.spec.ts
docs/decisions/ADR-0245-expiry-markdowns-and-payroll.md
docs/modules/expiry.md
docs/modules/payroll.md
docs/modules/pos.md
docs/modules/sales.md
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/i18n/mn.json
packages/shared/src/expiry/index.ts
```

#### 5. expiry-sale-transactions (58 files)

Consumers, both root adapters and transaction regressions together.

```text
apps/api/src/app.module.ts
apps/api/src/edge/dto/kiosk.dto.ts
apps/api/src/edge/services/checkout.service.ts
apps/api/src/edge/services/outbox.service.ts
apps/api/src/edge/services/returns.service.ts
apps/api/src/edge/services/snapshot.store.ts
apps/api/src/edge/services/sync.runner.ts
apps/api/src/expiry-commerce.module.spec.ts
apps/api/src/expiry-commerce.module.ts
apps/api/src/modules/catalog/services/barcode.service.ts
apps/api/src/modules/expiry/controllers/expiry-commerce.controller.ts
apps/api/src/modules/expiry/dto/expiry-commerce.dto.ts
apps/api/src/modules/expiry/expiry.module.ts
apps/api/src/modules/expiry/index.ts
apps/api/src/modules/expiry/services/expiry-commerce-gate.service.ts
apps/api/src/modules/expiry/services/expiry-commerce.service.ts
apps/api/src/modules/expiry/services/expiry-items.service.ts
apps/api/src/modules/expiry/services/expiry-money.spec.ts
apps/api/src/modules/expiry/services/expiry-money.ts
apps/api/src/modules/finance/finance.module.ts
apps/api/src/modules/finance/services/credit-notes.service.ts
apps/api/src/modules/finance/services/invoicing.service.ts
apps/api/src/modules/identity/services/user-names.service.ts
apps/api/src/modules/inventory/services/receipts.service.ts
apps/api/src/modules/inventory/services/stock-posting.service.ts
apps/api/src/modules/pos/controllers/pos-sync.controller.ts
apps/api/src/modules/pos/controllers/to-docs.ts
apps/api/src/modules/pos/dto/pos.dto.ts
apps/api/src/modules/pos/event-codec.ts
apps/api/src/modules/pos/pos.module.ts
apps/api/src/modules/pos/sale-doc.ts
apps/api/src/modules/pos/services/pos-accept.service.ts
apps/api/src/modules/pos/services/pos-query.service.ts
apps/api/src/modules/pos/services/pos-snapshot.service.ts
apps/api/src/modules/pos/services/pos-tills.service.ts
apps/api/src/modules/pricing/controllers/mappers.ts
apps/api/src/modules/pricing/controllers/pricing.controller.ts
apps/api/src/modules/pricing/dto/pricing.dto.ts
apps/api/src/modules/pricing/index.ts
apps/api/src/modules/pricing/services/price-quote.service.ts
apps/api/src/modules/sales/controllers/sales-orders.controller.ts
apps/api/src/modules/sales/dto/sales-orders.dto.ts
apps/api/src/modules/sales/sales.module.ts
apps/api/src/modules/sales/services/order-changes.ts
apps/api/src/modules/sales/services/sales-order-query.service.ts
apps/api/src/modules/sales/services/sales-orders.service.ts
apps/api/src/modules/sales/services/sales-pipelines.service.ts
apps/api/src/modules/sales/services/sales-rep-orders.service.ts
apps/api/src/worker.module.ts
apps/api/test/harness/expiry-commerce.ts
apps/api/test/integration/expiry-commerce-sales.int-spec.ts
apps/api/test/integration/expiry-commerce.int-spec.ts
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/src/pos/edge.ts
packages/shared/src/pricing/bonus.ts
packages/shared/src/pricing/cart.test.ts
packages/shared/src/pricing/cart.ts
```

#### 6. expiry-commerce-screens (29 files)

After transaction behavior.

```text
apps/web/src/features/expiry/approval-basis.ts
apps/web/src/features/expiry/commerce-api.ts
apps/web/src/features/expiry/expiry-barcode-encoding.ts
apps/web/src/features/expiry/expiry-barcode.test.ts
apps/web/src/features/expiry/expiry-barcode.tsx
apps/web/src/features/expiry/expiry-commerce-section.tsx
apps/web/src/features/expiry/expiry-page.test.tsx
apps/web/src/features/expiry/expiry-record-panel.tsx
apps/web/src/features/guide/content/inventory/60-expiry-markdown.md
apps/web/src/features/payroll/payroll-api.ts
apps/web/src/features/payroll/payroll-pages.test.tsx
apps/web/src/features/payroll/run-page.tsx
apps/web/src/features/payroll/runs-page.tsx
apps/web/src/features/payroll/source-deductions.tsx
apps/web/src/features/sales/expiry-order-scanner.tsx
apps/web/src/features/sales/order-products.tsx
apps/web/src/features/sales/order-request.ts
apps/web/src/pos/cart.test.ts
apps/web/src/pos/cart.ts
apps/web/src/pos/components/cart-table.tsx
apps/web/src/pos/components/product-finder.tsx
apps/web/src/pos/components/receipt-view.tsx
apps/web/src/pos/components/returns-dialog.tsx
apps/web/src/pos/kiosk-sale.test.tsx
apps/web/src/pos/kiosk-tools.test.tsx
apps/web/src/pos/queries.ts
apps/web/src/pos/receipt-view.test.tsx
apps/web/src/pos/screens/sale-screen.tsx
packages/shared/i18n/mn.json
```

#### 7. supplier-location-price-engine (61 files)

0127 / ADR-0246; includes required import lock regression.

```text
apps/api/src/app.module.ts
apps/api/src/db/migrations/0127_supplier_base_location_prices.sql
apps/api/src/db/migrations/meta/0127_snapshot.json
apps/api/src/db/migrations/meta/_journal.json
apps/api/src/db/schema.ts
apps/api/src/edge/services/checkout.service.ts
apps/api/src/expiry-commerce.module.ts
apps/api/src/modules/customer/services/customer-shop.service.ts
apps/api/src/modules/inventory/controllers/mappers.ts
apps/api/src/modules/inventory/controllers/receipts.controller.ts
apps/api/src/modules/inventory/dto/receipts.dto.ts
apps/api/src/modules/inventory/hooks.ts
apps/api/src/modules/inventory/index.ts
apps/api/src/modules/inventory/schema.ts
apps/api/src/modules/inventory/services/receipts.service.ts
apps/api/src/modules/notifications/dto/notifications.dto.ts
apps/api/src/modules/notifications/index.ts
apps/api/src/modules/notifications/notifications.module.ts
apps/api/src/modules/notifications/schema.ts
apps/api/src/modules/notifications/services/inbox.service.ts
apps/api/src/modules/notifications/services/receipt-price-notifier.ts
apps/api/src/modules/phone-agent/services/phone-tools.service.ts
apps/api/src/modules/pos/services/pos-snapshot.service.ts
apps/api/src/modules/pricing/controllers/pricing.controller.ts
apps/api/src/modules/pricing/controllers/supplier-pricing.controller.ts
apps/api/src/modules/pricing/dto/pricing.dto.ts
apps/api/src/modules/pricing/dto/product-prices.dto.ts
apps/api/src/modules/pricing/dto/supplier-pricing.dto.ts
apps/api/src/modules/pricing/index.ts
apps/api/src/modules/pricing/pricing.module.ts
apps/api/src/modules/pricing/schema.ts
apps/api/src/modules/pricing/services/base-price-ports.ts
apps/api/src/modules/pricing/services/price-profiles.service.ts
apps/api/src/modules/pricing/services/price-quote.service.ts
apps/api/src/modules/pricing/services/product-deals.service.ts
apps/api/src/modules/pricing/services/product-prices.service.ts
apps/api/src/modules/pricing/services/supplier-pricing.service.ts
apps/api/src/modules/sales/services/sales-orders.service.ts
apps/api/src/modules/sales/services/sales-rep-orders.service.ts
apps/api/src/modules/sales/services/sales-rep-shop.service.ts
apps/api/src/supplier-pricing.module.ts
apps/api/src/worker.module.ts
apps/api/test/integration/imports-prices.int-spec.ts
apps/api/test/integration/supplier-base-pricing.int-spec.ts
apps/api/test/integration/supplier-price-flows.int-spec.ts
apps/api/test/integrity/imports-scale.spec.ts
apps/api/test/integrity/supplier-pricing-guards.spec.ts
docs/decisions/ADR-0246-supplier-base-location-prices.md
docs/modules/inventory.md
docs/modules/notifications.md
docs/modules/pos.md
docs/modules/pricing.md
packages/api-client/openapi.json
packages/api-client/src/generated/schema.ts
packages/shared/src/notifications/index.ts
packages/shared/src/pos/edge.ts
packages/shared/src/pricing/bonus.ts
packages/shared/src/pricing/cart.ts
packages/shared/src/pricing/index.ts
packages/shared/src/pricing/location.test.ts
packages/shared/src/pricing/location.ts
```

#### 8. supplier-location-price-screens (24 files)

After pricing engine.

```text
apps/mobile/app/(staff)/notifications.tsx
apps/web/src/app/nav-items.ts
apps/web/src/app/router.tsx
apps/web/src/app/shell.test.tsx
apps/web/src/features/guide/content/pricing/10-supplier-location-prices.md
apps/web/src/features/inventory/api.ts
apps/web/src/features/inventory/helpers.ts
apps/web/src/features/inventory/receipt-costing.tsx
apps/web/src/features/inventory/receipt-discounts.tsx
apps/web/src/features/inventory/receipt-form.tsx
apps/web/src/features/inventory/receipt-line-panel.tsx
apps/web/src/features/inventory/receipt-prices.ts
apps/web/src/features/inventory/receipt-reference.test.tsx
apps/web/src/features/inventory/receipts-pages.test.tsx
apps/web/src/features/notifications/api.ts
apps/web/src/features/notifications/inbox.tsx
apps/web/src/features/pricing/base-price-view.tsx
apps/web/src/features/pricing/price-labels-page.tsx
apps/web/src/features/pricing/product-prices-card.tsx
apps/web/src/features/pricing/supplier-price-rule-form.tsx
apps/web/src/features/pricing/supplier-pricing-api.ts
apps/web/src/features/pricing/supplier-pricing-page.test.tsx
apps/web/src/features/pricing/supplier-pricing-page.tsx
packages/shared/i18n/mn.json
```

#### 9. audit-request-validation (30 files)

Remaining request validation; privacy already belongs to HR.

```text
apps/api/jest.config.js
apps/api/src/common/pagination/page.spec.ts
apps/api/src/common/pagination/page.ts
apps/api/src/common/validation/comma-separated-ids.spec.ts
apps/api/src/common/validation/comma-separated-ids.ts
apps/api/src/common/validation/date-only.spec.ts
apps/api/src/common/validation/date-only.ts
apps/api/src/finance-core/ledger/periods.spec.ts
apps/api/src/finance-core/ledger/periods.ts
apps/api/src/finance-core/posting/report-reader.service.ts
apps/api/src/modules/finance/dto/bank-statements.dto.ts
apps/api/src/modules/finance/dto/finance.dto.ts
apps/api/src/modules/finance/dto/ledger-reports.dto.ts
apps/api/src/modules/finance/dto/statements.dto.ts
apps/api/src/modules/hr/dto/engagement.dto.ts
apps/api/src/modules/hr/dto/hr.dto.ts
apps/api/src/modules/hr/dto/workforce.dto.ts
apps/api/src/modules/identity/dto/usage.dto.ts
apps/api/src/modules/payroll/dto/payroll.dto.ts
apps/api/src/modules/pos/dto/pos.dto.ts
apps/api/src/modules/reporting/dto/book-reports.dto.ts
apps/api/src/modules/reporting/dto/reports.dto.ts
apps/api/src/modules/sales/controllers/sales-document-templates.controller.ts
apps/api/src/modules/sales/dto/sales-boards.dto.ts
apps/api/src/modules/sales/dto/sales-document-templates.dto.ts
apps/api/src/modules/sales/dto/sales-orders.dto.ts
apps/api/src/modules/sales/services/sales-document-templates.service.ts
apps/api/test/integration/request-boundaries.int-spec.ts
apps/api/test/integration/sales-document-templates.int-spec.ts
packages/api-client/openapi.json
```

#### 10. audit-interface-clarity (27 files)

Four genuinely new translation keys stay with functionality.

```text
apps/mobile/app/(staff)/notifications.tsx
apps/web/src/app/app-shell.tsx
apps/web/src/app/nav-items.ts
apps/web/src/app/router.tsx
apps/web/src/app/shell.test.tsx
apps/web/src/app/top-bar.tsx
apps/web/src/components/document-layout.tsx
apps/web/src/features/finance/cash-page.tsx
apps/web/src/features/finance/finance-settings-page.tsx
apps/web/src/features/guide/content/pricing/10-supplier-location-prices.md
apps/web/src/features/hr/position-kit.tsx
apps/web/src/features/inventory/stock-count-page.tsx
apps/web/src/features/inventory/stock-count-print-page.tsx
apps/web/src/features/inventory/stock-counts-pages.tsx
apps/web/src/features/inventory/stocktakes-pages.test.tsx
apps/web/src/features/pricing/base-price-view.tsx
apps/web/src/features/pricing/discount-form.tsx
apps/web/src/features/pricing/pricing-pages.test.tsx
apps/web/src/features/pricing/profile-form.tsx
apps/web/src/features/pricing/profile-pages.tsx
apps/web/src/features/pricing/profiles-pages.test.tsx
apps/web/src/features/pricing/supplier-pricing-page.test.tsx
apps/web/src/features/pricing/supplier-pricing-page.tsx
apps/web/src/lib/favorite-pages.ts
apps/web/src/lib/page-path.ts
apps/web/src/lib/recent-pages.ts
packages/shared/i18n/mn.json
```

#### 14. wording-permission-bundles (1 files)

LAST group: four existing values.

```text
packages/shared/i18n/mn.json
```

Existing-key replacements: 4. No functional or schema change.

#### 15. wording-inventory-movements (3 files)

LAST group: 54 existing values and two guides.

```text
packages/shared/i18n/mn.json
apps/web/src/features/guide/content/sales/20-rep-offline-orders.md
apps/web/src/features/guide/content/inventory/50-low-stock-filters.md
```

Existing-key replacements: 54. No functional or schema change.

#### 16. wording-expiry-rules (1 files)

LAST group: one existing value.

```text
packages/shared/i18n/mn.json
```

Existing-key replacements: 1. No functional or schema change.

#### 17. wording-ui-clarity (1 files)

LAST group: 88 existing values.

```text
packages/shared/i18n/mn.json
```

Existing-key replacements: 88. No functional or schema change.

### Specific hunk transfers

- HR owns all six paths of the salary-audit privacy fix: `positions.service.ts` stops recording a new salary value; the audit controller/query carry the reader context; the helper and unit test redact historical salary snapshots; the sensitive-audit integration remains with HR. Its later formatting-only change is normalized there. This closes the salary disclosure before HR lands, not several features later.
- The price-import template header compatibility hunk already landed. The separate `advisoryLocks` expectation from one to two moves into the pricing engine, matching its new shared price gate. It is removed from the later audit manifest.
- Expiry foundation adds the sales posting contract, POS offer contract, shared data types and expiry payroll contract without resolving them. It adds only `payroll.web.sourceDeductions.title` from the later expiry translations. All service consumers and both composition roots land together in expiry transactions; foundation cannot require an unbound commerce provider.
- Audit request validation preserves the newer main VAT/report query behavior. Where the cumulative audit removes the old `DATE` regex, its two newer query decorators use the existing `IsDateOnly()` validator. This adaptation belongs to audit, not expiry.

### Other separately prepared work

QA tooling (22 paths including ADR-0247), existing-environment launchers (six paths), and the historical audit report (one path) are independent small submissions. Publishing their source does not authorize execution. Their static/fake-only validation is separate from the 284-path feature review; the accepted historical dataset is retained.

#### qa-history-tools (22 paths)

```text
docs/decisions/ADR-0247-overnight-qa-history.md
tools/qa-six-month/README.md
tools/qa-six-month/catalogue.mjs
tools/qa-six-month/clock.mjs
tools/qa-six-month/clock.test.mjs
tools/qa-six-month/dataset.mjs
tools/qa-six-month/dataset.test.mjs
tools/qa-six-month/history.mjs
tools/qa-six-month/journal.mjs
tools/qa-six-month/journal.test.mjs
tools/qa-six-month/plan.mjs
tools/qa-six-month/pos-accounts.mjs
tools/qa-six-month/pos-accounts.test.mjs
tools/qa-six-month/reconcile.mjs
tools/qa-six-month/reconcile.test.mjs
tools/qa-six-month/repair-rejected-location.mjs
tools/qa-six-month/run-current-expiry.mjs
tools/qa-six-month/run.mjs
tools/qa-six-month/run.test.mjs
tools/qa-six-month/runtime.mjs
tools/qa-six-month/safety.mjs
tools/qa-six-month/safety.test.mjs
```

#### dual-local-start (6 paths)

```text
start-main.cmd
start-test.cmd
tools/local-start/README.md
tools/local-start/child.mjs
tools/local-start/start.mjs
tools/local-start/start.test.mjs
```

#### local-audit-report (1 paths)

```text
docs/reviews/2026-11-24-code-audit.md
```

## Reserved numbers and metadata

| Feature                     | Migration                                | ADR                                         |
| --------------------------- | ---------------------------------------- | ------------------------------------------- |
| HR positions                | `0124_hr_positions.sql`                  | `ADR-0243-position-salary-access.md`        |
| Individual salary overrides | `0125_payroll_salary_overrides.sql`      | `ADR-0244-employee-salary-overrides.md`     |
| Expiry/payroll              | `0126_expiry_commerce.sql`               | `ADR-0245-expiry-markdowns-and-payroll.md`  |
| Supplier/location prices    | `0127_supplier_base_location_prices.sql` | `ADR-0246-supplier-base-location-prices.md` |
| Historical QA tools         | none                                     | `ADR-0247-overnight-qa-history.md`          |

These are the previously reserved numbers. Local source migrations 0122–0125 and ADRs 0237–0241 map in order to this table; unrelated newer-main ADRs and migrations with those old numbers are not renamed. Each submitted snapshot/journal must be regenerated or reconciled against its landed predecessor, preserving reporting/VAT and the entire `id`/`prevId` chain. Applied local migrations are not edited or replayed.

One harmless stale source comment inside prepared 0126 still says “append to 0124”; actual foundation assembly corrects that comment to 0126. It does not change any SQL statement.

## Module boundaries: synchronous ports, no new forbidden edge

The rejected direct edges have been removed in reviewed local adaptation `bc6b1e17b0c035baf2956727f08ddd03fd79197a`. No ESLint boundary change is requested. The following shows each previous import and the implemented replacement.

| Importing file                                                         | Removed direct symbol            | Replacement / purpose                                                                                                     |
| ---------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/modules/sales/sales.module.ts`                           | `ExpiryModule`                   | Removed; application composition supplies the posting binding.                                                            |
| `apps/api/src/modules/sales/services/sales-orders.service.ts`          | `ExpiryCommerceService`          | `EXPIRY_SALE_POSTING`, `ExpirySalePosting` from its own hooks; locks, sale and return posting use the caller transaction. |
| `apps/api/src/modules/pos/pos.module.ts`                               | `ExpiryModule`                   | Removed; root composition owns the binding.                                                                               |
| `apps/api/src/modules/pos/services/pos-accept.service.ts`              | `ExpiryCommerceService`          | Sales public `EXPIRY_SALE_POSTING` / `ExpirySalePosting`; same POS acceptance transaction and idempotency.                |
| `apps/api/src/modules/pos/services/pos-snapshot.service.ts`            | `ExpiryCommerceService`          | Own `POS_EXPIRY_OFFERS` / `PosExpiryOffers`; reads current approved public offers.                                        |
| `apps/api/src/modules/expiry/expiry.module.ts`                         | `PayrollModule`                  | Removed; root binds the liability sink.                                                                                   |
| `apps/api/src/modules/expiry/services/expiry-commerce-gate.service.ts` | `PayrollSourceDeductionsService` | Own `EXPIRY_PAYROLL_SOURCE` / `ExpiryPayrollSource`; expiry lock then payroll lock on identical `Tx`.                     |
| `apps/api/src/modules/expiry/services/expiry-commerce.service.ts`      | `PayrollSourceDeductionsService` | Own payroll source port; allocation/reversal liability is recorded before the same transaction commits.                   |

`ExpirySaleInput`, `ExpiryReturnInput` and `ExpirySaleOffer` are pure shared data contracts in `packages/shared/src/expiry/index.ts`. Consumer contracts live in sales `hooks.ts`, POS `expiry-offers.ts`, and expiry `ports.ts`, exported through public indexes. `apps/api/src/expiry-commerce.module.ts` implements `ExpirySalePostingAdapter` and `ExpiryPayrollSourceAdapter` using public module services, with `useExisting` token bindings. The API imports this root module; `apps/api/src/worker.module.ts` now does too. `ModuleRef.get(..., { strict: false })` is required and fails closed: no optional/no-op fallback.

An asynchronous event cannot retain the caller transaction, capacity lock, reversal limit, payroll lock order or rollback when liability recording fails. Existing order listeners carry order summaries, not all line provenance, partial returns, POS offer reads and payroll serialization. Shared money/type utilities do not own these rows. The new synchronous contracts solve this without granting forbidden imports: adapters pass the exact `Tx`, actor and input, await failures, and leave ownership/idempotency in the original services.

### Failure behavior at the POS boundary

The edge cashier's completed sale and outbox are committed independently before central acceptance. A central rollback does not erase that paid sale. The current prepared behavior has several distinct paths:

| Failure                                                                                           | Current prepared central/edge behavior                                                                                                                                       | Evidence / limit                                                                                                                                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recognized POS approval invalidity returned as `AppError` by the guarded `resolveInTx` call       | Record an unallocated exception (`EXPIRY_APPROVAL_INVALID`) rather than inventing a payroll allocation; central sale acceptance can finish.                                  | This is a narrow catch, not a blanket catch around all expiry operations.                                                                                |
| POS price mismatch, exhausted budget or missing liability shares                                  | Return the corresponding unallocated exception path.                                                                                                                         | Existing integrations cover business-invalid offline evidence and actual POS/edge sales.                                                                 |
| Wholesale validation failure                                                                      | Propagate; caller transaction rolls back.                                                                                                                                    | Existing sale/return and payroll integration cover business rollback.                                                                                    |
| `AppError` outside the recognized expiry exception path, including an early missing markdown/item | Central sale/expiry work rolls back. `PosAcceptService.applyEvent` normally records a `pos_sync_rejections` entry; edge item becomes REJECTED and needs manual admin replay. | Exceptions are `BIN_LOCKED_FOR_COUNT` and `STOCK_INSUFFICIENT`, the existing retryable set. Do not claim every secondary error automatically retries.    |
| Non-`AppError` programming error, missing provider binding or database/lock failure               | Error propagates as an HTTP failure. `SyncRunner` catches it and marks outbox failure while keeping the item PENDING for its existing exponential retry.                     | The dated appendix covers a full-flow injected bug and actual statement timeout; a missing binding and shared-lock-gate failure remain integration gaps. |
| Payroll liability recording fails after expiry allocation                                         | Same central transaction rolls back; the outer error classification above determines rejection versus pending retry.                                                         | The dated appendix now verifies rollback after actual liability/reversal insertion followed by an injected throw. Classification is unchanged.           |

A missing-markdown/item `AppError` can therefore park an already-paid edge sale before central completion. Whether that is acceptable remains an explicit owner review condition **before the expiry transactions branch is pushed**. The dated preflight appendix below now proves injected programming failure, actual PostgreSQL statement timeout, payroll failure after insertion, injected missing-provenance rejection, and sale/return recovery through the real edge and central HTTP flow. It does not prove actual lock timeout (`55P03`), a shared-lock-gate failure, or missing-provider behavior through the complete integration flow. The adapter unit test covers a missing binding, but that is not a full-flow substitute. No queue behavior is changed or policy decision inferred from passing tests.

ADR-0245 is the already-reserved expiry decision and contains the synchronous-port amendment; it will explicitly cover all three removed edges and the approved failure policy. No sixth ADR number is requested.

## Validation and remaining acceptance

Cumulative preflight, before final split: expiry sales/edge integration **3/3**, expiry commerce/payroll integration **20/20**, and payroll races integrity **2/2**, totaling **25/25**. The integrity suite ran once, without retry or weakened assertions. Four adapter unit tests cover exact transaction/actor forwarding, required bindings, error propagation and expiry-before-payroll lock order. Independent static review approved those ports.

The initial cumulative fast check passed its other eleven steps, including all types and four unit tests; two mock-only `require-await` lint errors were corrected and focused ESLint then passed. This is not a substitute for a green fast check on each actual submitted head. The pricing sidecar separately passed **12/12** integration tests, including interleaved inbox pagination, read ownership and write privileges. All runtime checks used the isolated PostgreSQL service on port 15435; no original main or accepted QA database was used.

Every guarded feature still needs its own current-main checks, matching stock/money/rights suites and owner gate review. The manifests are prepared plans, not already-pushed branches, production acceptance, or authorization to regenerate demo/history data.

## SQL review: final additive preparation

The inventory below is recomputed from the SQL at local reviewed preparation `46d14bf40e8c93afdd09977c6626f5016770a149`, which includes the nullable HR marker and the final price-notification sidecar. It does not repeat the obsolete notification `DROP CONSTRAINT` as proposed SQL. Source locations use that commit; each full statement below can be compared directly with its file. No SQL was executed for this inventory.

No top-level statement performs `DROP`, `RENAME`, `ALTER TYPE`, `SET NOT NULL`, `UPDATE` or `DELETE` of existing rows, and there is no `DO` block. Trigger event lists containing UPDATE/DELETE/TRUNCATE describe future guarded writes, not data changes during migration. Function bodies below are installed, not invoked by their `CREATE FUNCTION`; their row locks and checks run only on a later business write.

Existing-table nullable additions preserve old values as NULL. Two checks also inspect existing non-null fields: barcode namespace and expiry NaN quantities, so installation safety cannot be inferred from nullable-column safety. New checks/triggers are still behavior changes and are explicitly shown; they are retained because removing them would permit inconsistent access, oversold expiry budgets or mutation of posted receipt evidence. The owner reviews these guards with the feature. Foreign keys/checks on newly created tables protect only new feature records.

The HR legacy marker is added nullable with no initial default, then only that new column gets a future-insert default of false. Existing NULL means legacy; a missing row never does. All three early HR readers/save paths use this distinction. A normal authorized save may normalize the marker to true; migration does not backfill or change a salary.

The price sidecar leaves `user_notifications`, its kind constraint and existing rows unchanged. `user_price_notifications` uses the existing positive-ID sequence without reseeding, permits only payload-column inserts and read-marker updates to `app`, and preserves one numeric-ID cursor across a union of both inbox streams. No old table/column is dropped.

### Owner preflight for existing rows

The real database has not been queried by this preparation. Before approving 0126, the owner can run these SELECT-only checks in the intended database using its normal read access. Both counts must be zero; a nonzero result requires a reviewed data decision, not a hidden migration UPDATE or weaker constraint.

```sql
SELECT count(*) AS reserved_expiry_barcode_count
FROM product_barcodes
WHERE upper(code) LIKE 'BTOEXP-%';

SELECT count(*) AS nonfinite_expiry_quantity_count
FROM expiry_items
WHERE qty_floor = 'NaN'::numeric OR qty_warehouse = 'NaN'::numeric;
```

New nullable-column checks accept existing NULL fields. Installing triggers does not validate or rewrite old rows; those triggers govern subsequent writes, including changes to older records. Preflight on a fresh synthetic test database does not establish the state of the owner's existing data.

### 0124_hr_positions.sql

Source SHA-256: `636758f1c0b2c009c6aadcf3a92be67befdea9195b596a928c4b6023002063d8`. 25 complete top-level statements; 17 statement bodies expanded below. Pure new table/index creation not otherwise listed is additive.

#### 0124.1: lines 2–2

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "users" ADD COLUMN "roles_managed_by" text;
```

#### 0124.2: lines 3–3

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Check on an existing table for the new nullable feature fields; old NULL rows satisfy it. Retained to reject invalid future values rather than weaken the invariant.

```sql
ALTER TABLE "users" ADD CONSTRAINT "users_roles_managed_by" CHECK ("roles_managed_by" IS NULL OR "roles_managed_by" = 'HR_POSITION');
```

#### 0124.3: lines 31–31

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "hr_employees" ADD COLUMN "position_id" bigint CONSTRAINT "hr_employees_position_id_hr_positions_id_fk" REFERENCES "hr_positions"("id");
```

#### 0124.4: lines 45–45

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "payroll_terms" ADD COLUMN "position_legacy_salary" boolean;
```

#### 0124.5: lines 46–46

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Default applies only to future inserts into the just-added nullable legacy marker. Existing NULL values remain untouched; readers preserve their legacy meaning.

```sql
ALTER TABLE "payroll_terms" ALTER COLUMN "position_legacy_salary" SET DEFAULT false;
```

#### 0124.6: lines 48–67

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Installs a future-write validation function; no body is executed during migration. Protects effective salary history and exact agreement between HR position, identity ownership marker and role membership.

```sql
CREATE FUNCTION hr_position_assignment_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_month text := to_char(timezone('Asia/Ulaanbaatar', now()), 'YYYY-MM');
  next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.effective_month <> next_month AND NOT (
      NEW.effective_month = current_month
      AND NOT EXISTS (SELECT 1 FROM hr_employee_position_assignments WHERE user_id = NEW.user_id)
      AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND created_at = transaction_timestamp())
    ) THEN
      RAISE EXCEPTION 'existing employee salary assignments start next month' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.user_id <> OLD.user_id OR NEW.effective_month <> OLD.effective_month OR OLD.effective_month <= current_month THEN
    RAISE EXCEPTION 'effective employee salary assignments cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0124.7: lines 68–69

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER hr_position_assignment_history_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_employee_position_assignments
FOR EACH ROW EXECUTE FUNCTION hr_position_assignment_history_guard();
```

#### 0124.8: lines 72–90

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Installs a future-write validation function; no body is executed during migration. Protects effective salary history and exact agreement between HR position, identity ownership marker and role membership.

```sql
CREATE FUNCTION hr_position_salary_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_month text := to_char(timezone('Asia/Ulaanbaatar', now()), 'YYYY-MM');
  next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM 1 FROM hr_positions WHERE id = NEW.position_id FOR UPDATE;
    IF (NOT EXISTS (SELECT 1 FROM hr_position_salaries WHERE position_id = NEW.position_id) AND NEW.effective_month <> current_month)
      OR (EXISTS (SELECT 1 FROM hr_position_salaries WHERE position_id = NEW.position_id) AND NEW.effective_month <> next_month) THEN
      RAISE EXCEPTION 'initial salary is current month; later changes start next month' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' OR NEW.position_id <> OLD.position_id OR NEW.effective_month <> OLD.effective_month
    OR OLD.effective_month <= current_month THEN
    RAISE EXCEPTION 'position salary history cannot be rewritten' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0124.9: lines 91–92

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER hr_position_salary_history_guard BEFORE INSERT OR UPDATE OR DELETE ON hr_position_salaries
FOR EACH ROW EXECUTE FUNCTION hr_position_salary_history_guard();
```

#### 0124.10: lines 96–114

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Installs a future-write validation function; no body is executed during migration. Protects effective salary history and exact agreement between HR position, identity ownership marker and role membership.

```sql
CREATE FUNCTION hr_position_check_user(target_user bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE position_ref bigint; owner_source text; actual_roles bigint[]; position_roles bigint[];
BEGIN
  SELECT e.position_id, u.roles_managed_by INTO position_ref, owner_source
    FROM users u LEFT JOIN hr_employees e ON e.user_id = u.id WHERE u.id = target_user;
  IF NOT FOUND THEN RETURN; END IF;
  IF position_ref IS NULL THEN
    IF owner_source IS NOT NULL THEN
      RAISE EXCEPTION 'position-managed account needs a position' USING ERRCODE = '23514';
    END IF;
    RETURN;
  END IF;
  SELECT coalesce(array_agg(role_id ORDER BY role_id), '{}'::bigint[]) INTO actual_roles FROM user_roles WHERE user_id = target_user;
  SELECT coalesce(array_agg(role_id ORDER BY role_id), '{}'::bigint[]) INTO position_roles FROM hr_position_roles WHERE position_id = position_ref;
  IF owner_source IS DISTINCT FROM 'HR_POSITION' OR actual_roles IS DISTINCT FROM position_roles THEN
    RAISE EXCEPTION 'employee roles must match the assigned position' USING ERRCODE = '23514';
  END IF;
END;
$$;
```

#### 0124.11: lines 115–137

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Installs a future-write validation function; no body is executed during migration. Protects effective salary history and exact agreement between HR position, identity ownership marker and role membership.

```sql
CREATE FUNCTION hr_position_access_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE member_id bigint; position_ref bigint;
BEGIN
  IF TG_TABLE_NAME = 'hr_position_roles' THEN
    IF TG_OP = 'DELETE' THEN position_ref := OLD.position_id; ELSE position_ref := NEW.position_id; END IF;
    FOR member_id IN SELECT user_id FROM hr_employees WHERE position_id = position_ref LOOP
      PERFORM hr_position_check_user(member_id);
    END LOOP;
    IF TG_OP = 'UPDATE' AND OLD.position_id <> NEW.position_id THEN
      FOR member_id IN SELECT user_id FROM hr_employees WHERE position_id = OLD.position_id LOOP
        PERFORM hr_position_check_user(member_id);
      END LOOP;
    END IF;
  ELSIF TG_TABLE_NAME = 'users' THEN
    PERFORM hr_position_check_user(NEW.id);
  ELSE
    IF TG_OP = 'DELETE' THEN member_id := OLD.user_id; ELSE member_id := NEW.user_id; END IF;
    PERFORM hr_position_check_user(member_id);
    IF TG_OP = 'UPDATE' AND OLD.user_id <> NEW.user_id THEN PERFORM hr_position_check_user(OLD.user_id); END IF;
  END IF;
  RETURN NULL;
END;
$$;
```

#### 0124.12: lines 138–139

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Existing-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER hr_employee_position_access_guard AFTER INSERT OR UPDATE OR DELETE ON hr_employees
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();
```

#### 0124.13: lines 140–141

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER hr_position_roles_access_guard AFTER INSERT OR UPDATE OR DELETE ON hr_position_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();
```

#### 0124.14: lines 142–143

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Existing-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER user_position_roles_access_guard AFTER INSERT OR UPDATE OR DELETE ON user_roles
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();
```

#### 0124.15: lines 144–145

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Existing-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER user_position_owner_guard AFTER INSERT OR UPDATE ON users
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hr_position_access_guard();
```

#### 0124.16: lines 146–146

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE DELETE, TRUNCATE ON hr_positions, hr_position_salaries, hr_employee_position_assignments FROM app;
```

#### 0124.17: lines 148–148

File: `apps/api/src/db/migrations/0124_hr_positions.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE TRUNCATE ON hr_position_roles FROM app;
```

### 0125_payroll_salary_overrides.sql

Source SHA-256: `d6e9bd1fc6ea63d9b38579af066437fd54d9e4728dc28961648f51887664efa3`. 4 complete top-level statements; 3 statement bodies expanded below. Pure new table/index creation not otherwise listed is additive.

#### 0125.1: lines 13–27

File: `apps/api/src/db/migrations/0125_payroll_salary_overrides.sql`. Installs a future-write validation function; no body is executed during migration. Protects effective personal salary override history from backdated or repeated destructive edits.

```sql
CREATE FUNCTION payroll_salary_override_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE next_month text := to_char(timezone('Asia/Ulaanbaatar', now()) + interval '1 month', 'YYYY-MM');
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'employee salary history cannot be deleted' USING ERRCODE = '23514';
  END IF;
  IF NEW.effective_month <> next_month THEN
    RAISE EXCEPTION 'employee salary changes start next month' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.user_id <> OLD.user_id OR NEW.effective_month <> OLD.effective_month) THEN
    RAISE EXCEPTION 'employee salary history keys cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0125.2: lines 28–29

File: `apps/api/src/db/migrations/0125_payroll_salary_overrides.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER payroll_salary_override_history_guard BEFORE INSERT OR UPDATE OR DELETE ON payroll_salary_overrides
FOR EACH ROW EXECUTE FUNCTION payroll_salary_override_history_guard();
```

#### 0125.3: lines 30–30

File: `apps/api/src/db/migrations/0125_payroll_salary_overrides.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE DELETE, TRUNCATE ON payroll_salary_overrides FROM app;
```

### 0126_expiry_commerce.sql

Source SHA-256: `b0783daf75b1334714869f1fdecd08b138f0c5434340370d5d9a7ab1cce7f62e`. 83 complete top-level statements; 63 statement bodies expanded below. Pure new table/index creation not otherwise listed is additive.

#### 0126.1: lines 132–132

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "pos_sale_lines" ADD COLUMN "expiry_barcode" text;
```

#### 0126.2: lines 133–133

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "pos_sale_lines" ADD COLUMN "expiry_exception" text;
```

#### 0126.3: lines 134–134

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "sales_order_excluded_lines" ADD COLUMN "expiry_barcode" text;
```

#### 0126.4: lines 135–135

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE "sales_order_lines" ADD COLUMN "expiry_barcode" text;
```

#### 0126.5: lines 136–136

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.6: lines 137–137

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.7: lines 138–138

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_item_sources" ADD CONSTRAINT "expiry_item_sources_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.8: lines 139–139

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdown_balances" ADD CONSTRAINT "expiry_markdown_balances_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.9: lines 140–140

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdown_stops" ADD CONSTRAINT "expiry_markdown_stops_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.10: lines 141–141

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdown_stops" ADD CONSTRAINT "expiry_markdown_stops_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.11: lines 142–142

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_item_id_expiry_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."expiry_items"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.12: lines 143–143

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.13: lines 144–144

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_product_unit_id_product_units_id_fk" FOREIGN KEY ("product_unit_id") REFERENCES "public"."product_units"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.14: lines 145–145

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_receipt_line_id_goods_receipt_lines_id_fk" FOREIGN KEY ("receipt_line_id") REFERENCES "public"."goods_receipt_lines"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.15: lines 146–146

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.16: lines 147–147

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_markdowns" ADD CONSTRAINT "expiry_markdowns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.17: lines 148–148

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_return_allocations" ADD CONSTRAINT "expiry_return_allocations_sale_allocation_id_expiry_sale_allocations_id_fk" FOREIGN KEY ("sale_allocation_id") REFERENCES "public"."expiry_sale_allocations"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.18: lines 149–149

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_sale_allocations" ADD CONSTRAINT "expiry_sale_allocations_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.19: lines 150–150

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_sale_exceptions" ADD CONSTRAINT "expiry_sale_exceptions_markdown_id_expiry_markdowns_id_fk" FOREIGN KEY ("markdown_id") REFERENCES "public"."expiry_markdowns"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.20: lines 151–151

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "expiry_sale_exceptions" ADD CONSTRAINT "expiry_sale_exceptions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.21: lines 152–152

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.22: lines 153–153

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_reverses_id_payroll_source_deductions_id_fk" FOREIGN KEY ("reverses_id") REFERENCES "public"."payroll_source_deductions"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.23: lines 154–154

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.24: lines 155–155

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_deductions" ADD CONSTRAINT "payroll_source_deductions_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.25: lines 156–156

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_deduction_id_payroll_source_deductions_id_fk" FOREIGN KEY ("deduction_id") REFERENCES "public"."payroll_source_deductions"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.26: lines 157–157

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_run_id_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."payroll_runs"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.27: lines 158–158

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.28: lines 159–159

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "payroll_source_settlements" ADD CONSTRAINT "payroll_source_settlements_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
```

#### 0126.29: lines 173–174

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Existing barcode namespace check: existing BTOEXP-prefixed codes would block installation. The owner must run the read-only preflight in this section and resolve any conflict before applying; no automatic rename or delete is proposed.

```sql
ALTER TABLE product_barcodes ADD CONSTRAINT product_barcodes_expiry_namespace
CHECK (upper(code) NOT LIKE 'BTOEXP-%');
```

#### 0126.30: lines 175–176

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Existing expiry quantity check: existing NaN values would block installation. The owner must run the read-only preflight in this section; this plan neither silently changes quantities nor weakens validation.

```sql
ALTER TABLE expiry_items ADD CONSTRAINT expiry_items_finite_quantities
CHECK (qty_floor <> 'NaN'::numeric AND qty_warehouse <> 'NaN'::numeric);
```

#### 0126.31: lines 178–182

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_commerce_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'expiry commercial history is immutable' USING ERRCODE = '23514';
END;
$$;
```

#### 0126.32: lines 183–184

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_markdowns_immutable BEFORE UPDATE OR DELETE ON expiry_markdowns
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.33: lines 185–186

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_markdown_stops_immutable BEFORE UPDATE OR DELETE ON expiry_markdown_stops
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.34: lines 187–188

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_sale_allocations_immutable BEFORE UPDATE OR DELETE ON expiry_sale_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.35: lines 189–190

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_return_allocations_immutable BEFORE UPDATE OR DELETE ON expiry_return_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.36: lines 191–192

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_markdowns_no_truncate BEFORE TRUNCATE ON expiry_markdowns
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.37: lines 193–194

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_markdown_stops_no_truncate BEFORE TRUNCATE ON expiry_markdown_stops
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.38: lines 195–196

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_sale_allocations_no_truncate BEFORE TRUNCATE ON expiry_sale_allocations
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.39: lines 197–198

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_return_allocations_no_truncate BEFORE TRUNCATE ON expiry_return_allocations
FOR EACH STATEMENT EXECUTE FUNCTION expiry_commerce_immutable();
```

#### 0126.40: lines 199–200

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON expiry_markdowns, expiry_markdown_stops,
  expiry_sale_allocations, expiry_return_allocations FROM app;
```

#### 0126.41: lines 201–201

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE DELETE, TRUNCATE ON expiry_item_sources, expiry_markdown_balances, expiry_sale_exceptions FROM app;
```

#### 0126.42: lines 203–224

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item expiry_items%ROWTYPE; source goods_receipt_lines%ROWTYPE; reserved numeric;
BEGIN
  SELECT * INTO STRICT item FROM expiry_items WHERE id=NEW.item_id FOR UPDATE;
  SELECT * INTO STRICT source FROM goods_receipt_lines WHERE id=NEW.receipt_line_id;
  PERFORM 1 FROM goods_receipts WHERE id=source.receipt_id AND status='POSTED' AND costing_version>0 FOR UPDATE;
  IF NOT FOUND OR item.product_id<>source.product_id OR NEW.qty_base>source.qty_base
     OR NEW.qty_base>item.qty_floor+item.qty_warehouse THEN
    RAISE EXCEPTION 'expiry requires a real posted costed product source and supported quantity' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.item_id<>OLD.item_id OR NEW.version<>OLD.version+1
    OR EXISTS(SELECT 1 FROM expiry_markdowns WHERE item_id=OLD.item_id)) THEN
    RAISE EXCEPTION 'published expiry provenance is frozen' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(qty_base),0) INTO reserved FROM expiry_item_sources
   WHERE receipt_line_id=NEW.receipt_line_id AND item_id<>NEW.item_id;
  IF reserved+NEW.qty_base>source.qty_base THEN
    RAISE EXCEPTION 'receipt quantity already assigned to expiry records' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.43: lines 225–226

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_source_guard BEFORE INSERT OR UPDATE ON expiry_item_sources
FOR EACH ROW EXECUTE FUNCTION expiry_source_guard();
```

#### 0126.44: lines 228–257

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_markdown_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item expiry_items%ROWTYPE; source expiry_item_sources%ROWTYPE; line goods_receipt_lines%ROWTYPE;
        valuation stock_valuation_adjustments%ROWTYPE; committed numeric;
BEGIN
  SELECT * INTO STRICT item FROM expiry_items WHERE id=NEW.item_id FOR UPDATE;
  SELECT * INTO STRICT source FROM expiry_item_sources WHERE item_id=NEW.item_id;
  SELECT * INTO STRICT line FROM goods_receipt_lines WHERE id=NEW.receipt_line_id;
  PERFORM 1 FROM goods_receipts WHERE id=line.receipt_id FOR UPDATE;
  SELECT * INTO valuation FROM stock_valuation_adjustments WHERE doc_type='GR' AND doc_id=line.receipt_id AND doc_line_id=line.id ORDER BY version DESC LIMIT 1;
  IF item.status='ARCHIVED' OR source.receipt_line_id<>NEW.receipt_line_id OR item.product_id<>NEW.product_id
    OR NEW.expiry_date<>item.expiry_date OR NEW.receipt_qty_base<>line.qty_base
    OR valuation.id IS NULL OR NEW.costing_version<>valuation.version OR NEW.accounting_amount<>valuation.amount
    OR NOT EXISTS(SELECT 1 FROM product_units WHERE id=NEW.product_unit_id AND product_id=item.product_id AND is_base) THEN
    RAISE EXCEPTION 'expiry approval source snapshot does not match authoritative provenance' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(sum(CASE WHEN s.markdown_id IS NULL THEN m.qty_budget ELSE b.qty_sold END),0)
    INTO committed FROM expiry_markdowns m JOIN expiry_markdown_balances b ON b.markdown_id=m.id
    LEFT JOIN expiry_markdown_stops s ON s.markdown_id=m.id WHERE m.item_id=NEW.item_id;
  IF committed+NEW.qty_budget>least(source.qty_base,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry approval exceeds observed or source quantity' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.liable_users) u
    WHERE jsonb_typeof(u)<>'object' OR NOT EXISTS(SELECT 1 FROM users WHERE id=(u->>'id')::bigint AND status='ACTIVE'))
    OR (SELECT count(*) FROM jsonb_array_elements(NEW.liable_users)) <>
       (SELECT count(DISTINCT u->>'id') FROM jsonb_array_elements(NEW.liable_users) u) THEN
    RAISE EXCEPTION 'expiry liable users must be active and deduplicated' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.45: lines 258–259

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_markdown_guard BEFORE INSERT ON expiry_markdowns
FOR EACH ROW EXECUTE FUNCTION expiry_markdown_guard();
```

#### 0126.46: lines 261–279

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_balance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved expiry_markdowns%ROWTYPE; item expiry_items%ROWTYPE; source_qty numeric; other_sold numeric; actual numeric;
BEGIN
  SELECT * INTO STRICT approved FROM expiry_markdowns WHERE id=NEW.markdown_id;
  SELECT * INTO STRICT item FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  IF TG_OP='UPDATE' AND NEW.markdown_id<>OLD.markdown_id THEN
    RAISE EXCEPTION 'expiry budget identity is immutable' USING ERRCODE='23514';
  END IF;
  SELECT qty_base INTO STRICT source_qty FROM expiry_item_sources WHERE item_id=approved.item_id;
  SELECT coalesce(sum(b.qty_sold),0) INTO other_sold FROM expiry_markdown_balances b
    JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=approved.item_id AND m.id<>NEW.markdown_id;
  SELECT coalesce((SELECT sum(qty_base) FROM expiry_sale_allocations WHERE markdown_id=NEW.markdown_id),0)
    - coalesce((SELECT sum(r.qty_base) FROM expiry_return_allocations r JOIN expiry_sale_allocations s ON s.id=r.sale_allocation_id WHERE s.markdown_id=NEW.markdown_id),0) INTO actual;
  IF NEW.qty_sold<>actual OR NEW.qty_sold>approved.qty_budget OR other_sold+NEW.qty_sold>least(source_qty,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry budget must equal finalized allocations within proven units' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.47: lines 280–281

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_balance_guard BEFORE INSERT OR UPDATE ON expiry_markdown_balances
FOR EACH ROW EXECUTE FUNCTION expiry_balance_guard();
```

#### 0126.48: lines 283–299

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_sale_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE approved expiry_markdowns%ROWTYPE; split_total numeric;
BEGIN
  SELECT * INTO STRICT approved FROM expiry_markdowns WHERE id=NEW.markdown_id;
  PERFORM 1 FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  SELECT coalesce(sum((s->>'amount')::numeric),0) INTO split_total FROM jsonb_array_elements(NEW.shares) s;
  IF NEW.cost_amount<>round(approved.accounting_amount*NEW.qty_base/approved.receipt_qty_base,2)
    OR NEW.loss_amount<>greatest(0,NEW.cost_amount-NEW.revenue_amount) OR split_total<>NEW.loss_amount THEN
    RAISE EXCEPTION 'expiry loss must follow frozen acquisition cost and actual sale revenue' USING ERRCODE='23514';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.shares) s WHERE (s->>'amount')::numeric<0 OR NOT EXISTS
      (SELECT 1 FROM jsonb_array_elements(approved.liable_users) u WHERE u->>'id'=s->>'userId')) THEN
    RAISE EXCEPTION 'expiry sale shares require frozen liable users' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.49: lines 300–301

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_sale_allocation_guard BEFORE INSERT ON expiry_sale_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_sale_allocation_guard();
```

#### 0126.50: lines 303–327

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_return_allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original expiry_sale_allocations%ROWTYPE; returned numeric; split_total numeric; original_share jsonb; expected numeric; actual numeric; owner_item bigint;
BEGIN
  SELECT m.item_id INTO STRICT owner_item FROM expiry_sale_allocations s JOIN expiry_markdowns m ON m.id=s.markdown_id WHERE s.id=NEW.sale_allocation_id;
  PERFORM 1 FROM expiry_items WHERE id=owner_item FOR UPDATE;
  -- The mutable parent gate above serializes every return, including direct app-role inserts.
  -- Original allocations are immutable; row-locking them would require the UPDATE privilege
  -- deliberately revoked from app. Read their frozen facts without widening that privilege.
  SELECT * INTO STRICT original FROM expiry_sale_allocations WHERE id=NEW.sale_allocation_id;
  SELECT coalesce(sum(qty_base),0) INTO returned FROM expiry_return_allocations WHERE sale_allocation_id=original.id;
  SELECT coalesce(-sum((s->>'amount')::numeric),0) INTO split_total FROM jsonb_array_elements(NEW.shares) s;
  IF returned+NEW.qty_base>original.qty_base OR split_total<>NEW.loss_amount OR jsonb_array_length(NEW.shares)<>jsonb_array_length(original.shares) THEN
    RAISE EXCEPTION 'expiry return exceeds the original allocation' USING ERRCODE='23514';
  END IF;
  FOR original_share IN SELECT * FROM jsonb_array_elements(original.shares) LOOP
    expected := round((original_share->>'amount')::numeric*(returned+NEW.qty_base)/original.qty_base,2)
               - round((original_share->>'amount')::numeric*returned/original.qty_base,2);
    SELECT -(s->>'amount')::numeric INTO actual FROM jsonb_array_elements(NEW.shares) s WHERE s->>'userId'=original_share->>'userId';
    IF actual IS NULL OR actual<>expected THEN
      RAISE EXCEPTION 'expiry return must reverse each original employee share cumulatively' USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
```

#### 0126.51: lines 328–329

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_return_allocation_guard BEFORE INSERT ON expiry_return_allocations
FOR EACH ROW EXECUTE FUNCTION expiry_return_allocation_guard();
```

#### 0126.52: lines 333–352

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_allocation_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_markdown_id bigint; approved expiry_markdowns%ROWTYPE; item expiry_items%ROWTYPE;
        actual numeric; cached numeric; source_qty numeric; global_sold numeric;
BEGIN
  IF TG_TABLE_NAME='expiry_sale_allocations' THEN target_markdown_id:=NEW.markdown_id;
  ELSE SELECT s.markdown_id INTO STRICT target_markdown_id FROM expiry_sale_allocations s WHERE s.id=NEW.sale_allocation_id;
  END IF;
  SELECT * INTO STRICT approved FROM expiry_markdowns m WHERE m.id=target_markdown_id;
  SELECT * INTO STRICT item FROM expiry_items WHERE id=approved.item_id FOR UPDATE;
  SELECT b.qty_sold INTO cached FROM expiry_markdown_balances b WHERE b.markdown_id=target_markdown_id;
  SELECT coalesce((SELECT sum(s.qty_base) FROM expiry_sale_allocations s WHERE s.markdown_id=target_markdown_id),0)
    -coalesce((SELECT sum(r.qty_base) FROM expiry_return_allocations r JOIN expiry_sale_allocations s ON s.id=r.sale_allocation_id WHERE s.markdown_id=target_markdown_id),0) INTO actual;
  SELECT src.qty_base INTO STRICT source_qty FROM expiry_item_sources src WHERE src.item_id=approved.item_id;
  SELECT coalesce(sum(b.qty_sold),0) INTO global_sold FROM expiry_markdown_balances b JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=approved.item_id;
  IF cached IS NULL OR cached<>actual OR actual<0 OR actual>approved.qty_budget OR global_sold>least(source_qty,item.qty_floor+item.qty_warehouse) THEN
    RAISE EXCEPTION 'expiry allocation and bounded budget must commit atomically' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END;
$$;
```

#### 0126.53: lines 353–354

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER expiry_sale_allocation_consistency AFTER INSERT ON expiry_sale_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expiry_allocation_consistency();
```

#### 0126.54: lines 355–356

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE CONSTRAINT TRIGGER expiry_return_allocation_consistency AFTER INSERT ON expiry_return_allocations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expiry_allocation_consistency();
```

#### 0126.55: lines 358–367

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_exception_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.resolved_at IS NOT NULL OR (to_jsonb(NEW)-ARRAY['resolved_at','resolved_by','resolution_note']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['resolved_at','resolved_by','resolution_note']) OR NEW.resolved_at IS NULL
    OR NEW.resolved_by IS NULL OR length(btrim(NEW.resolution_note)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'expiry exception facts are immutable; only explicit no-charge resolution is allowed' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.56: lines 368–369

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_exception_guard BEFORE UPDATE ON expiry_sale_exceptions
FOR EACH ROW EXECUTE FUNCTION expiry_exception_guard();
```

#### 0126.57: lines 371–381

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION expiry_count_commerce_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE sold numeric;
BEGIN
  SELECT coalesce(sum(b.qty_sold),0) INTO sold FROM expiry_markdown_balances b
    JOIN expiry_markdowns m ON m.id=b.markdown_id WHERE m.item_id=NEW.id;
  IF NEW.qty_floor+NEW.qty_warehouse<sold THEN
    RAISE EXCEPTION 'expiry observation cannot fall below already finalized sold units' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.58: lines 382–383

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Existing-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER expiry_count_commerce_guard BEFORE UPDATE OF qty_floor,qty_warehouse ON expiry_items
FOR EACH ROW EXECUTE FUNCTION expiry_count_commerce_guard();
```

#### 0126.59: lines 387–387

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE DELETE, TRUNCATE ON payroll_source_deductions, payroll_source_settlements FROM app;
```

#### 0126.60: lines 389–414

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION payroll_source_deductions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original payroll_source_deductions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.source_kind, NEW.source_key, NEW.source_reference, NEW.user_id, NEW.amount, NEW.requested_month, NEW.reverses_id, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.source_kind, OLD.source_key, OLD.source_reference, OLD.user_id, OLD.amount, OLD.requested_month, OLD.reverses_id, OLD.created_by, OLD.created_at) THEN
      RAISE EXCEPTION 'payroll source identity and allocation are immutable' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (SELECT 1 FROM payroll_source_settlements WHERE deduction_id = OLD.id AND released_at IS NULL) THEN
      RAISE EXCEPTION 'a settled payroll source is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_month IS NOT NULL AND EXISTS (SELECT 1 FROM payroll_runs WHERE month = NEW.assigned_month AND status = 'APPROVED') THEN
      RAISE EXCEPTION 'an approved payroll month cannot receive a source assignment' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.source_kind = 'EXPIRY_RETURN' THEN
    SELECT * INTO original FROM payroll_source_deductions WHERE id = NEW.reverses_id FOR UPDATE;
    IF NOT FOUND OR original.source_kind <> 'EXPIRY_SALE' OR original.user_id <> NEW.user_id THEN
      RAISE EXCEPTION 'a return must reverse its original employee allocation' USING ERRCODE = '23514';
    END IF;
    IF original.amount + COALESCE((SELECT sum(amount) FROM payroll_source_deductions WHERE reverses_id = original.id), 0) + NEW.amount < 0 THEN
      RAISE EXCEPTION 'a source allocation cannot be over-reversed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.61: lines 415–415

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER payroll_source_deductions_guard BEFORE INSERT OR UPDATE ON payroll_source_deductions FOR EACH ROW EXECUTE FUNCTION payroll_source_deductions_guard();
```

#### 0126.62: lines 417–441

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. Installs a future-write validation function; no body is executed during migration. Enforces the named expiry provenance, quantity, allocation/reversal or payroll settlement invariant; locks and checks remain inside the later caller transaction.

```sql
CREATE FUNCTION payroll_source_settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source payroll_source_deductions%ROWTYPE;
DECLARE run payroll_runs%ROWTYPE;
BEGIN
  SELECT * INTO run FROM payroll_runs WHERE id = NEW.run_id;
  IF run.status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'payroll source settlement requires a draft run' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF ROW(NEW.id, NEW.deduction_id, NEW.run_id, NEW.amount, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM ROW(OLD.id, OLD.deduction_id, OLD.run_id, OLD.amount, OLD.created_by, OLD.created_at)
       OR OLD.released_at IS NOT NULL OR NEW.released_at IS NULL THEN
      RAISE EXCEPTION 'payroll settlement history is immutable except one authorized release' USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT * INTO source FROM payroll_source_deductions WHERE id = NEW.deduction_id;
    IF NOT FOUND OR NEW.released_at IS NOT NULL OR NEW.released_by IS NOT NULL
       OR source.assigned_month IS DISTINCT FROM run.month OR NEW.amount IS DISTINCT FROM source.amount
       OR NOT EXISTS (SELECT 1 FROM payroll_lines WHERE run_id = run.id AND user_id = source.user_id) THEN
      RAISE EXCEPTION 'payroll settlement must match its source and eligible line' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0126.63: lines 442–442

File: `apps/api/src/db/migrations/0126_expiry_commerce.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER payroll_source_settlements_guard BEFORE INSERT OR UPDATE ON payroll_source_settlements FOR EACH ROW EXECUTE FUNCTION payroll_source_settlements_guard();
```

### 0127_supplier_base_location_prices.sql

Source SHA-256: `a7425e3e30e8e265775b6d00fd5a28515373fbff0cff68b4a05ab4beb0417dad`. 47 complete top-level statements; 37 statement bodies expanded below. Pure new table/index creation not otherwise listed is additive.

#### 0127.1: lines 88–88

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.2: lines 89–89

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.3: lines 90–90

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_events" ADD CONSTRAINT "base_price_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

#### 0127.4: lines 91–91

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.5: lines 92–92

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_last_receipt_id_goods_receipts_id_fk" FOREIGN KEY ("last_receipt_id") REFERENCES "public"."goods_receipts"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.6: lines 93–93

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "base_price_states" ADD CONSTRAINT "base_price_states_last_event_id_base_price_events_id_fk" FOREIGN KEY ("last_event_id") REFERENCES "public"."base_price_events"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.7: lines 94–94

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "location_price_rule_versions" ADD CONSTRAINT "location_price_rule_versions_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.8: lines 95–95

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "location_price_rule_versions" ADD CONSTRAINT "location_price_rule_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

#### 0127.9: lines 96–96

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "location_price_rules" ADD CONSTRAINT "location_price_rules_warehouse_id_warehouses_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouses"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.10: lines 97–97

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "location_price_rules" ADD CONSTRAINT "location_price_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

#### 0127.11: lines 98–98

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "supplier_price_rules" ADD CONSTRAINT "supplier_price_rules_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
```

#### 0127.12: lines 99–99

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE "supplier_price_rules" ADD CONSTRAINT "supplier_price_rules_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
```

#### 0127.13: lines 104–104

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE goods_receipt_lines ADD COLUMN printed_unit_price numeric(14, 2);
```

#### 0127.14: lines 106–106

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New nullable column on an existing table; old rows remain NULL and old columns stay in place.

```sql
ALTER TABLE goods_receipt_lines ADD COLUMN printed_price_factor numeric(18, 6);
```

#### 0127.15: lines 108–110

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Check on an existing table for the new nullable feature fields; old NULL rows satisfy it. Retained to reject invalid future values rather than weaken the invariant.

```sql
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_printed_price_basis
  CHECK ((printed_unit_price IS NULL) = (printed_price_factor IS NULL)
    AND (printed_price_factor IS NULL OR (printed_price_factor > 0 AND printed_price_factor < 'Infinity'::numeric)));
```

#### 0127.16: lines 112–113

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Check on an existing table for the new nullable feature fields; old NULL rows satisfy it. Retained to reject invalid future values rather than weaken the invariant.

```sql
ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_printed_price
  CHECK (printed_unit_price IS NULL OR (printed_unit_price >= 0 AND printed_unit_price < 'Infinity'::numeric));
```

#### 0127.17: lines 117–126

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Additive sidecar replaces the rejected old-kind constraint replacement, preserving old table/data and using a shared ID sequence.

```sql
CREATE TABLE user_price_notifications (
  id bigint PRIMARY KEY DEFAULT nextval('public.user_notifications_id_seq'::regclass),
  user_id bigint NOT NULL CONSTRAINT user_price_notifications_user_id_users_id_fk REFERENCES users(id),
  price_change_key text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT user_price_notifications_key CHECK (length(price_change_key) BETWEEN 1 AND 128),
  CONSTRAINT user_price_notifications_event_user UNIQUE (price_change_key, user_id)
);
```

#### 0127.18: lines 132–132

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON user_price_notifications FROM app;
```

#### 0127.19: lines 134–134

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Allows only the new sidecar payload INSERT and read_at UPDATE; ID, timestamp and immutable payload rewrites remain denied.

```sql
GRANT INSERT (user_id, price_change_key, payload), UPDATE (read_at) ON user_price_notifications TO app;
```

#### 0127.20: lines 136–136

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Allows the new sidecar to consume the existing inbox sequence, preserving global positive numeric IDs without reseeding it.

```sql
GRANT USAGE ON SEQUENCE user_notifications_id_seq TO app;
```

#### 0127.21: lines 138–138

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE UPDATE, DELETE, TRUNCATE ON base_price_events, location_price_rule_versions FROM app;
```

#### 0127.22: lines 140–140

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Restricts app writes to the newly introduced feature tables, preserving immutable evidence/history; no existing row is changed.

```sql
REVOKE DELETE, TRUNCATE ON supplier_price_rules, location_price_rules, base_price_states FROM app;
```

#### 0127.23: lines 142–143

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER base_price_events_append_only BEFORE UPDATE OR DELETE ON base_price_events
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
```

#### 0127.24: lines 145–146

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER base_price_events_no_truncate BEFORE TRUNCATE ON base_price_events
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
```

#### 0127.25: lines 148–149

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER location_price_rule_versions_append_only BEFORE UPDATE OR DELETE ON location_price_rule_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
```

#### 0127.26: lines 151–152

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER location_price_rule_versions_no_truncate BEFORE TRUNCATE ON location_price_rule_versions
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete();
```

#### 0127.27: lines 154–174

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Installs a future-write validation function; no body is executed during migration. Protects rule version progression, product/event ownership or posted printed-price evidence.

```sql
CREATE FUNCTION supplier_price_rule_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 THEN
      RAISE EXCEPTION 'a price rule starts at version one' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'a price rule update advances exactly one version' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'supplier_price_rules' THEN
      IF NEW.supplier_id IS DISTINCT FROM OLD.supplier_id THEN
        RAISE EXCEPTION 'a supplier price rule keeps its supplier' USING ERRCODE = '23514';
      END IF;
    ELSIF NEW.warehouse_id IS DISTINCT FROM OLD.warehouse_id THEN
      RAISE EXCEPTION 'a location price rule keeps its warehouse' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0127.28: lines 176–177

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER supplier_price_rules_revision BEFORE INSERT OR UPDATE ON supplier_price_rules
  FOR EACH ROW EXECUTE FUNCTION supplier_price_rule_revision_guard();
```

#### 0127.29: lines 179–180

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER location_price_rules_revision BEFORE INSERT OR UPDATE ON location_price_rules
  FOR EACH ROW EXECUTE FUNCTION supplier_price_rule_revision_guard();
```

#### 0127.30: lines 182–191

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Installs a future-write validation function; no body is executed during migration. Protects rule version progression, product/event ownership or posted printed-price evidence.

```sql
CREATE FUNCTION base_price_state_event_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.last_event_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM base_price_events WHERE id = NEW.last_event_id AND product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'a base-price state references its own product event' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
```

#### 0127.31: lines 193–194

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. New-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER base_price_states_event BEFORE INSERT OR UPDATE ON base_price_states
  FOR EACH ROW EXECUTE FUNCTION base_price_state_event_guard();
```

#### 0127.32: lines 196–214

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Installs a future-write validation function; no body is executed during migration. Protects rule version progression, product/event ownership or posted printed-price evidence.

```sql
CREATE FUNCTION receipt_printed_price_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE header goods_receipts%ROWTYPE;
BEGIN
  SELECT * INTO header FROM goods_receipts WHERE id = OLD.receipt_id;
  IF header.status = 'POSTED' AND ROW(NEW.receipt_id, NEW.product_id) IS DISTINCT FROM ROW(OLD.receipt_id, OLD.product_id) THEN
    RAISE EXCEPTION 'posted printed reference keeps its receipt and product' USING ERRCODE = '23001';
  END IF;
  IF ROW(NEW.printed_unit_price, NEW.printed_price_factor)
     IS NOT DISTINCT FROM ROW(OLD.printed_unit_price, OLD.printed_price_factor) THEN RETURN NEW; END IF;
  IF header.status = 'DRAFT' THEN RETURN NEW; END IF;
  IF header.status = 'POSTED' AND header.costing_version = 0
     AND ((OLD.printed_unit_price IS NULL AND OLD.printed_price_factor IS NULL) OR OLD.free_goods IS NOT TRUE)
     AND NEW.printed_unit_price IS NOT NULL AND NEW.printed_price_factor IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'posted printed receipt price is immutable after first pricing'
    USING ERRCODE = '23001';
END;
$$;
```

#### 0127.33: lines 216–217

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Existing-table future-write guard: attaches the named validation/immutability function. Installation does not invoke it or rewrite existing rows; retain to enforce the stated invariant on subsequent writes.

```sql
CREATE TRIGGER goods_receipt_lines_printed_price_immutable BEFORE UPDATE ON goods_receipt_lines
  FOR EACH ROW EXECUTE FUNCTION receipt_printed_price_guard();
```

#### 0127.34: lines 220–220

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Nullable extension of a table created in this same migration; no preexisting business data.

```sql
ALTER TABLE base_price_events ADD COLUMN printed_price_amount numeric(14, 2);
```

#### 0127.35: lines 222–222

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Nullable extension of a table created in this same migration; no preexisting business data.

```sql
ALTER TABLE base_price_events ADD COLUMN printed_price_qty_base numeric(18, 6);
```

#### 0127.36: lines 224–227

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Constraint on a table created in this same migration: establishes referential or value integrity for new feature records, without modifying preexisting table rows.

```sql
ALTER TABLE base_price_events ADD CONSTRAINT base_price_events_printed_ratio
  CHECK ((printed_price_amount IS NULL) = (printed_price_qty_base IS NULL)
    AND (printed_price_amount IS NULL OR (printed_price_amount >= 0 AND printed_price_amount < 'Infinity'::numeric
      AND printed_price_qty_base > 0 AND printed_price_qty_base < 'Infinity'::numeric)));
```

#### 0127.37: lines 233–233

File: `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`. Nullable extension of a table created in this same migration; no preexisting business data.

```sql
ALTER TABLE base_price_events ADD COLUMN rule_snapshot jsonb;
```

## Removed draft statements: not part of the final migration

The following entire old notification block is **removed**, not proposed for execution. It widened the old kind constraint to store price events in the existing inbox. The final sidecar shown above preserves that old constraint, table, IDs and rows instead.

Source of obsolete draft: `05fabcce`, `apps/api/src/db/migrations/0127_supplier_base_location_prices.sql`.

```sql
ALTER TABLE user_notifications ADD COLUMN price_change_key text;

ALTER TABLE user_notifications DROP CONSTRAINT user_notifications_kind;

ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_kind
  CHECK (kind IN ('ORDER_SOLD', 'PHONE_ORDER', 'PHONE_CALLBACK', 'PRICE_CHANGED'));

ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_price_change
  CHECK ((kind = 'PRICE_CHANGED') = (price_change_key IS NOT NULL));

ALTER TABLE user_notifications ADD CONSTRAINT user_notifications_price_change_key
  CHECK (price_change_key IS NULL OR length(price_change_key) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX user_notifications_price_change_user
  ON user_notifications (kind, price_change_key, user_id) WHERE price_change_key IS NOT NULL;
```

The original HR source used the following populated/non-null marker. This old ADD is removed; the final nullable ADD plus future default shown in 0124 replaces it. Existing rows are not backfilled and salaries are not changed. The subsequent SET DEFAULT is retained, but now applies to the new nullable column.

Source of obsolete draft: `fe9a6663`, `apps/api/src/db/migrations/0122_hr_positions.sql` (renumbered to 0124 in preparation).

```sql
ALTER TABLE "payroll_terms" ADD COLUMN "position_legacy_salary" boolean NOT NULL DEFAULT true;
ALTER TABLE "payroll_terms" ALTER COLUMN "position_legacy_salary" SET DEFAULT false;
```

The redundant change of newly created `base_price_events.valid_from` was folded into that new table's initial definition. These are unapplied source adaptations only; applied local database migrations were left intact.

## 2026-11-24: expiry failure preflight and exact review patch

Status: **prepared and tested locally; not a production behavior change and not a submitted expiry feature**. This document exposes the test patch for review before any actual expiry transactions branch. The test path is already in that feature's manifest, so it adds no path or reserved number. The fresh-main feature must still incorporate and validate it after its predecessors land.

The complete `expiry-commerce-sales.int-spec.ts` suite passed **9/9 tests in 49.297 seconds** in one invocation: the original three tests plus six new fault cases. Focused ESLint passed. An independent static review approved the exact test delta, subject to that passing integration run. All runtime checks used the isolated service on port 15435; no original database, accepted QA history, generator or launcher was touched.

| New case                                                  | Observed outcome                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expiry programming error after an edge sale has committed | Central marked sale, stock movement, allocation and staff liability roll back. Its edge event stays PENDING. An earlier ordinary sale in the same batch remains committed; replay recognizes its duplicate and applies the marked sale once.                                                                                                                        |
| Actual PostgreSQL `statement_timeout`                     | The transaction executes `SET LOCAL statement_timeout = '25ms'` and `SELECT pg_sleep(1)`. The test checks SQLSTATE **57014**, verifies rollback/PENDING, and proves successful replay after restoring the service. This is **not** a lock-timeout test for SQLSTATE **55P03**.                                                                                      |
| Payroll throws after actually inserting liability         | Central sale/allocation/liability roll back together; restored retry produces one sale, one allocation and two employee charges totaling 100.00. Replaying the same wire event does not duplicate charges.                                                                                                                                                          |
| Early missing-markdown `AppError`                         | `notFound` is injected at `recordSaleInTx`, outside the resolver's narrow unallocated-exception catch. No immutable provenance row is deleted. The paid edge sale becomes REJECTED, ordinary push stays idle, and explicit idempotent admin replay applies it once after restoring the service. The edge event **remains REJECTED after the central admin replay**. |
| Completed return receives a domain `AppError`             | The edge return remains committed but parked REJECTED; no central return, stock reversal or liability reversal commits. Explicit admin replay later reverses the original charge once.                                                                                                                                                                              |
| Payroll throws after actually inserting a return reversal | The central return/reversal rolls back and the edge event stays PENDING. Restored retry reverses 50.00 once, leaving net original liability 50.00. Duplicate wire replay does not change the result.                                                                                                                                                                |

Every spy is restored in `finally`, with an `afterEach` fallback. Recovery assertions include central document count, stock quantity, expiry quantity sold, source-charge count/amount, edge persistence and duplicate behavior. These are observed outcomes of the current implementation, not new business rules.

Still unresolved: the owner must accept or change the policy that a missing-provenance `AppError` can park an already-paid sale for manual admin replay. The tests establish current semantics; they do not authorize changing that classification. They also do not claim that a failure in the shared `lockInTx` gate leaves ordinary central sales unaffected, that missing provider bindings are covered by full integration, or that statement-timeout coverage proves lock-timeout behavior.

### Test provenance

- Parent port-preparation commit: `bc6b1e17b0c035baf2956727f08ddd03fd79197a`.
- Local test-only commit: `58e45fe10e78f82ddc8657221478179ba892061c`.
- Sole changed test source: `apps/api/test/integration/expiry-commerce-sales.int-spec.ts`; **331 added lines**, no production source edits.
- SHA-256 of the complete committed test file (Git blob bytes): `6291ac7b84d448d4d9fcec5c308c443a46f7e71f2b400768288fbd55ec14adbb`.
- SHA-256 of the exact parent-to-test diff below (UTF-8 Git diff bytes, including its final newline): `1fd76f6501c132d2c41891523040f7ef914e272cb8c08855c132025c15a156b8`.

The local preparation commits need not be present on the public remote. The complete diff below is supplied so review does not depend on access to a private checkout or a local-only commit. It is documentation only; this branch does not install the test or change runtime behavior.

### Complete test-only diff

```diff
diff --git a/apps/api/test/integration/expiry-commerce-sales.int-spec.ts b/apps/api/test/integration/expiry-commerce-sales.int-spec.ts
index b61f41f6..a9254098 100644
--- a/apps/api/test/integration/expiry-commerce-sales.int-spec.ts
+++ b/apps/api/test/integration/expiry-commerce-sales.int-spec.ts
@@ -10,6 +10,12 @@ import type {
   PosSnapshot,
 } from '@tugeel/shared/pos';
 import type { Client } from 'pg';
+import { eq, sql as sqlQuery } from 'drizzle-orm';
+import { notFound } from '../../src/common/errors/app-error';
+import { EDGE_DB, type EdgeDb } from '../../src/edge/db/edge-db';
+import { edgeOutbox, edgeSales } from '../../src/edge/db/schema';
+import { ExpiryCommerceService } from '../../src/modules/expiry';
+import { PayrollSourceDeductionsService } from '../../src/modules/payroll';
 import request from 'supertest';
 import { SyncRunner } from '../../src/edge/services/sync.runner';
 import { OutboxService } from '../../src/edge/services/outbox.service';
@@ -86,6 +92,107 @@ describe('expiry source sales', () => {
     if (lines[0]) lines[0].expiryBarcode = barcode;
     return { ...doc, ...extra };
   };
+  /** Real edge checkout and transport; fault injection happens only after local commit. */
+  const faultTill = async () => {
+    await edge?.close();
+    edge = undefined;
+    const p = await product();
+    const till = (
+      await store.pos
+        .createTill({
+          edgeNodeId: store.node.id,
+          warehouseId: store.store.id,
+          code: `F${serial}`,
+          name: `Synthetic failure till ${serial}`,
+          printerHost: null,
+        })
+        .expect(201)
+    ).body as { id: number; code: string };
+    const approval = await approve(p, { contextId: till.id });
+    const offer = approval.commerce.markdowns[0];
+    if (!offer) throw new Error('missing failure-test approval');
+    const port = (app.getHttpServer().address() as AddressInfo).port;
+    edge = await createEdgeApp({
+      databaseUrl: await edgeDatabase(),
+      centralUrl: `http://127.0.0.1:${port}`,
+      nodeToken: store.edgeToken,
+    });
+    const kiosk = kioskApi(edge);
+    const sync = edge.get(SyncRunner);
+    const edgeDb = edge.get<EdgeDb>(EDGE_DB);
+    const pair = (await store.pos.pairingCode(till.id).expect(200)).body as { code: string };
+    expect(await sync.pullOnce()).toBe('changed');
+    const paired = (
+      await kiosk
+        .post('/pair', {
+          tillCode: till.code,
+          pairingCode: pair.code,
+        })
+        .expect(200)
+    ).body as EdgePairResponse;
+    kiosk.setDevice(paired.deviceToken);
+    const loggedIn = (
+      await kiosk
+        .post('/auth/pin', {
+          userId: store.cashierId,
+          pin: '123456',
+        })
+        .expect(200)
+    ).body as EdgeLoginResponse;
+    kiosk.setSession(loggedIn.token);
+    await kiosk.post('/shifts/open', { openingFloat: '0' }).expect(200);
+    expect(await sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
+    const complete = async (marked = true) => {
+      const body = {
+        clientId: randomUUID(),
+        lines: [
+          {
+            productUnitId: base(p),
+            qty: marked ? '2' : '1',
+            ...(marked ? { expiryBarcode: offer.barcode } : {}),
+          },
+        ],
+        tenders: [
+          { kind: 'CASH', amount: marked ? '110' : '1300', tendered: marked ? '110' : '1300' },
+        ],
+      };
+      const receipt = (await kiosk.post('/sales', body).expect(200)).body.receipt as EdgeReceipt;
+      const local = await edgeDb
+        .select()
+        .from(edgeSales)
+        .where(eq(edgeSales.clientId, receipt.clientId));
+      expect(local).toHaveLength(1);
+      return { receipt, body };
+    };
+    const event = async (clientId: string) => {
+      const rows = await edgeDb.select().from(edgeOutbox).where(eq(edgeOutbox.clientId, clientId));
+      const row = rows.find((entry) => entry.kind === 'SALE' || entry.kind === 'RETURN');
+      if (!row) throw new Error('completed edge document is missing its outbox event');
+      return row;
+    };
+    return { kiosk, sync, edgeDb, approval, offer, complete, event };
+  };
+  const centralDocument = async (clientId: string) =>
+    (
+      await sql.query<{ sales: number; stock_qty: string }>(
+        `SELECT (SELECT count(*)::int FROM pos_sales WHERE client_id=$1) AS sales,
+       coalesce((SELECT sum(l.qty_base) FROM stock_ledger l JOIN pos_sales s
+         ON l.doc_type='POS' AND l.doc_id=s.id WHERE s.client_id=$1),0)::numeric(14,3)::text AS stock_qty`,
+        [clientId],
+      )
+    ).rows[0];
+  const sourceCharges = async (itemId: number, markdownId: number) =>
+    (
+      await sql.query<{ rows: number; amount: string }>(
+        `SELECT count(*)::int AS rows,coalesce(sum(amount),0)::numeric(14,2)::text AS amount
+       FROM payroll_source_deductions WHERE source_reference=$1
+       OR reverses_id IN (SELECT id FROM payroll_source_deductions WHERE source_reference=$1)`,
+        [`expiry:${itemId}/markdown:${markdownId}`],
+      )
+    ).rows[0];
+  afterEach(() => {
+    jest.restoreAllMocks();
+  });
   beforeAll(async () => {
     app = await createHttpApp();
     await app.listen(0, '127.0.0.1');
@@ -443,4 +550,228 @@ describe('expiry source sales', () => {
     expect(await edge.get(OutboxService).counts()).toEqual(before);
     expect(await allocations(tiny.itemId)).toEqual([]);
   });
+
+  it.each(['expiry bug', 'database timeout', 'payroll failure'] as const)(
+    'keeps paid edge sales pending on %s, rolls back expiry and retries without duplicate stock or charges',
+    async (failure) => {
+      const ctx = await faultTill();
+      // A separate ordinary sale precedes the faulty marked sale in the real outbox batch.
+      const ordinary = await ctx.complete(false);
+      const marked = await ctx.complete();
+      const expiry = app.get(ExpiryCommerceService);
+      const payroll = app.get(PayrollSourceDeductionsService);
+      const recordPayroll = payroll.recordInTx.bind(payroll);
+      let databaseCode: string | undefined;
+      const fault =
+        failure === 'payroll failure'
+          ? jest.spyOn(payroll, 'recordInTx').mockImplementation(async (...args) => {
+              await recordPayroll(...args);
+              throw new Error('synthetic failure after liability insert');
+            })
+          : jest.spyOn(expiry, 'recordSaleInTx').mockImplementation(async (tx) => {
+              if (failure === 'database timeout') {
+                await tx.execute(sqlQuery`SET LOCAL statement_timeout = '25ms'`);
+                try {
+                  await tx.execute(sqlQuery`SELECT pg_sleep(1)`);
+                } catch (error) {
+                  const databaseError = error as { code?: string; cause?: { code?: string } };
+                  databaseCode = databaseError.cause?.code ?? databaseError.code;
+                  throw error;
+                }
+                throw new Error('expected PostgreSQL statement timeout');
+              }
+              throw new Error('synthetic expiry programming failure');
+            });
+      try {
+        expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'failed' });
+        expect(fault).toHaveBeenCalled();
+        if (failure === 'database timeout') expect(databaseCode).toBe('57014');
+        expect(await ctx.event(marked.receipt.clientId)).toMatchObject({
+          status: 'PENDING',
+          attempts: 1,
+        });
+        expect(await ctx.event(ordinary.receipt.clientId)).toMatchObject({ status: 'PENDING' });
+        expect(await centralDocument(ordinary.receipt.clientId)).toEqual({
+          sales: 1,
+          stock_qty: '-1.000',
+        });
+        expect(await centralDocument(marked.receipt.clientId)).toEqual({
+          sales: 0,
+          stock_qty: '0.000',
+        });
+        expect(await allocations(ctx.approval.itemId)).toEqual([]);
+        expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+          rows: 0,
+          amount: '0.00',
+        });
+        expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('0');
+        expect(
+          (await ctx.kiosk.post('/sales', marked.body).expect(200)).body.receipt.clientId,
+        ).toBe(marked.receipt.clientId);
+      } finally {
+        fault.mockRestore();
+      }
+      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
+      expect(await ctx.event(marked.receipt.clientId)).toMatchObject({
+        status: 'SENT',
+        attempts: 2,
+      });
+      expect(await centralDocument(ordinary.receipt.clientId)).toEqual({
+        sales: 1,
+        stock_qty: '-1.000',
+      });
+      expect(await centralDocument(marked.receipt.clientId)).toEqual({
+        sales: 1,
+        stock_qty: '-2.000',
+      });
+      expect(await allocations(ctx.approval.itemId)).toHaveLength(1);
+      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+        rows: 2,
+        amount: '100.00',
+      });
+      expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('2');
+      expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
+      // Resend the already applied wire event, not just an empty outbox.
+      expect(
+        (await store.replay([(await ctx.event(marked.receipt.clientId)).payload]))[0]?.status,
+      ).toBe('DUPLICATE');
+      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+        rows: 2,
+        amount: '100.00',
+      });
+    },
+  );
+
+  it('parks a paid sale on an early missing-markdown AppError until explicit admin replay', async () => {
+    const ctx = await faultTill();
+    const marked = await ctx.complete();
+    // Simulate missing central provenance outside resolveInTx's narrow unallocated catch.
+    const fault = jest
+      .spyOn(app.get(ExpiryCommerceService), 'recordSaleInTx')
+      .mockRejectedValue(notFound('expiry markdown', ctx.offer.id));
+    try {
+      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 1 });
+      expect(await ctx.event(marked.receipt.clientId)).toMatchObject({
+        status: 'REJECTED',
+        code: 'NOT_FOUND',
+      });
+      expect(await centralDocument(marked.receipt.clientId)).toEqual({
+        sales: 0,
+        stock_qty: '0.000',
+      });
+      expect(await allocations(ctx.approval.itemId)).toEqual([]);
+      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+        rows: 0,
+        amount: '0.00',
+      });
+    } finally {
+      fault.mockRestore();
+    }
+    expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
+    const rejection = (
+      await sql.query<{ id: number }>('SELECT id FROM pos_sync_rejections WHERE client_id=$1', [
+        marked.receipt.clientId,
+      ])
+    ).rows;
+    expect(rejection).toHaveLength(1);
+    const key = idempotency();
+    const route = `/api/v1/pos/sync-rejections/${rejection[0]!.id}/replay`;
+    expect(
+      (await http().post(route).set(bearer(admin)).set(key).send({}).expect(200)).body.status,
+    ).toBe('APPLIED');
+    await http().post(route).set(bearer(admin)).set(key).send({}).expect(200);
+    expect(await centralDocument(marked.receipt.clientId)).toEqual({
+      sales: 1,
+      stock_qty: '-2.000',
+    });
+    expect(await allocations(ctx.approval.itemId)).toHaveLength(1);
+    expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+      rows: 2,
+      amount: '100.00',
+    });
+    // Central admin replay does not silently rewrite the edge's parked status.
+    expect(await ctx.event(marked.receipt.clientId)).toMatchObject({ status: 'REJECTED' });
+    expect((await ctx.kiosk.post('/sales', marked.body).expect(200)).body.receipt.clientId).toBe(
+      marked.receipt.clientId,
+    );
+  });
+
+  it.each(['domain rejection', 'payroll failure'] as const)(
+    'preserves a completed edge return through %s and reverses the original charge once after recovery',
+    async (failure) => {
+      const ctx = await faultTill();
+      const marked = await ctx.complete();
+      expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
+      const body = {
+        clientId: randomUUID(),
+        refundsSaleClientId: marked.receipt.clientId,
+        lines: [{ refundsLineNo: 1, qty: '1', damaged: false }],
+        approval: { supervisorUserId: store.supervisorId, pin: '654321' },
+      };
+      const returned = (await ctx.kiosk.post('/returns', body).expect(200)).body
+        .receipt as EdgeReceipt;
+      const payroll = app.get(PayrollSourceDeductionsService);
+      const recordPayroll = payroll.recordInTx.bind(payroll);
+      const fault =
+        failure === 'domain rejection'
+          ? jest
+              .spyOn(app.get(ExpiryCommerceService), 'recordReturnInTx')
+              .mockRejectedValue(notFound('expiry allocation', ctx.offer.id))
+          : jest.spyOn(payroll, 'recordInTx').mockImplementation(async (...args) => {
+              await recordPayroll(...args);
+              throw new Error('synthetic failure after reversal insert');
+            });
+      try {
+        expect(await ctx.sync.pushOnce()).toMatchObject(
+          failure === 'domain rejection' ? { state: 'sent', rejected: 1 } : { state: 'failed' },
+        );
+        expect(fault).toHaveBeenCalled();
+        expect(await ctx.event(returned.clientId)).toMatchObject({
+          status: failure === 'domain rejection' ? 'REJECTED' : 'PENDING',
+        });
+        expect(await centralDocument(returned.clientId)).toEqual({ sales: 0, stock_qty: '0.000' });
+        expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('2');
+        expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+          rows: 2,
+          amount: '100.00',
+        });
+        expect((await ctx.kiosk.post('/returns', body).expect(200)).body.receipt.clientId).toBe(
+          returned.clientId,
+        );
+      } finally {
+        fault.mockRestore();
+      }
+      if (failure === 'domain rejection') {
+        expect(await ctx.sync.pushOnce()).toEqual({ state: 'idle' });
+        const [rejection] = (
+          await sql.query<{ id: number }>('SELECT id FROM pos_sync_rejections WHERE client_id=$1', [
+            returned.clientId,
+          ])
+        ).rows;
+        if (!rejection) throw new Error('return rejection missing');
+        const key = idempotency();
+        const route = `/api/v1/pos/sync-rejections/${rejection.id}/replay`;
+        expect(
+          (await http().post(route).set(bearer(admin)).set(key).send({}).expect(200)).body.status,
+        ).toBe('APPLIED');
+        await http().post(route).set(bearer(admin)).set(key).send({}).expect(200);
+      } else {
+        expect(await ctx.sync.pushOnce()).toMatchObject({ state: 'sent', rejected: 0 });
+        expect(await ctx.event(returned.clientId)).toMatchObject({ status: 'SENT', attempts: 2 });
+      }
+      expect(await centralDocument(returned.clientId)).toEqual({ sales: 1, stock_qty: '1.000' });
+      expect((await detail(ctx.approval.itemId)).markdowns[0]?.qtySold).toBe('1');
+      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+        rows: 4,
+        amount: '50.00',
+      });
+      expect((await store.replay([(await ctx.event(returned.clientId)).payload]))[0]?.status).toBe(
+        'DUPLICATE',
+      );
+      expect(await sourceCharges(ctx.approval.itemId, ctx.offer.id)).toEqual({
+        rows: 4,
+        amount: '50.00',
+      });
+    },
+  );
 });
```
