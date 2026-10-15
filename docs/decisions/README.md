# Architecture Decision Records (ADRs)

This folder holds the decisions that shape Tugeel (Түгээл). Every ADR records one decision, the situation that forced it, the options that were weighed, and what the team accepts as a consequence. `docs/architecture.md` describes the resulting system; the ADRs explain *why* it looks that way.

## Rules

1. **ADRs are immutable.** Once an ADR is `Accepted`, its text is never edited except to fix typos or add a "Superseded by" line. To change a decision, write a new ADR that supersedes the old one and set the old ADR's status to `Superseded by ADR-00NN`.
2. **One decision per ADR.** If a session needs two unrelated decisions, write two files.
3. **Numbering is sequential and never reused.** The next free number is `ADR-0059`.
4. **Status values:** `Proposed` (written, not yet acted on), `Accepted` (in force), `Deferred` (principles decided now, implementation scheduled for a later delivery), `Superseded by ADR-00NN`, `Rejected`.
5. **Read before building.** A session that starts a delivery reads the ADRs listed under that delivery in `docs/STATUS.md` ("ADRs to read first") and the "Related" section of each. A session must not re-argue an `Accepted` ADR; it writes a superseding ADR if it disagrees.
6. **External facts** (e-Barimt rules, QPay behaviour, package versions, prices) are quoted from `docs/architecture.md` §9 and §13. Business unknowns are tagged `TODO-VERIFY`; tooling choices are never left open.
7. **Vocabulary.** *module* = one of the 16 code modules of `docs/architecture.md` §4 (`identity`, `catalog`, …); *delivery N* = roadmap step N of `docs/SPEC.md` §9 and `docs/STATUS.md` (1–11). ADR text says "delivery N" for roadmap steps and never numbers code modules.

## Index

| ID | Title | Status | Date |
|---|---|---|---|
| [ADR-0001](ADR-0001-typescript-monorepo.md) | TypeScript everywhere in a pnpm-workspaces monorepo, one TypeScript version | Accepted | 2026-10-09 |
| [ADR-0002](ADR-0002-nestjs-modular-monolith.md) | NestJS 12 modular monolith with two entrypoints | Accepted | 2026-10-09 |
| [ADR-0003](ADR-0003-postgres-drizzle.md) | PostgreSQL 18 as the only datastore, Drizzle ORM with hand-edited SQL migrations | Accepted | 2026-10-09 |
| [ADR-0004](ADR-0004-rest-openapi-shared-client.md) | REST + OpenAPI with a generated TypeScript client shared by web and mobile | Accepted | 2026-10-09 |
| [ADR-0005](ADR-0005-auth-model.md) | Self-hosted auth: JWT + rotating refresh tokens, permission strings, phone identity for customers | Accepted | 2026-10-09 |
| [ADR-0006](ADR-0006-one-expo-codebase-two-apps.md) | One Expo codebase, two store apps via APP_VARIANT | Accepted | 2026-10-09 |
| [ADR-0007](ADR-0007-inventory-ledger.md) | Inventory as an append-only ledger with DB-enforced invariants and balance caches | Accepted | 2026-10-09 |
| [ADR-0008](ADR-0008-base-units-and-factors.md) | Base-unit storage with factor snapshots and a single supersede service | Accepted | 2026-10-09 |
| [ADR-0009](ADR-0009-pricing-engine.md) | Pricing engine: effective-dated, non-overlapping price rules resolved by a pure function and frozen at SUBMIT | Accepted | 2026-10-09 |
| [ADR-0010](ADR-0010-money-vat-rounding.md) | Money as NUMERIC MNT with decimal.js, whole-tugrik unit prices, per-line tax split | Accepted | 2026-10-09 |
| [ADR-0011](ADR-0011-i18n-mongolian-first.md) | i18n from day one: i18next keys, `mn` as the only locale, English codes in the database | Accepted | 2026-10-09 |
| [ADR-0012](ADR-0012-hosting-do-sgp1-posapi-tailscale.md) | Hosting: DigitalOcean SGP1 droplet + Managed PostgreSQL; PosAPI on an office mini-PC over Tailscale | Accepted | 2026-10-09 |
| [ADR-0013](ADR-0013-background-jobs-pg-boss.md) | Background jobs with pg-boss, transactional enqueue, separate worker entrypoint | Accepted | 2026-10-09 |
| [ADR-0014](ADR-0014-file-storage-spaces.md) | File storage on DigitalOcean Spaces via presigned URLs | Accepted | 2026-10-09 |
| [ADR-0015](ADR-0015-excel-import-pipeline.md) | Excel import as a validated, previewable, idempotent, revertible job pipeline | Accepted | 2026-10-09 |
| [ADR-0016](ADR-0016-testing-strategy.md) | Testing strategy: isolated real-Postgres integration tests plus a mandatory integrity suite | Accepted | 2026-10-09 |
| [ADR-0017](ADR-0017-ebarimt-integration.md) | e-Barimt integration via PosAPI 3.0 on the office box, two-phase issue, certification gate | Deferred | 2026-10-09 |
| [ADR-0018](ADR-0018-payments-qpay.md) | Payments: QPay Merchant v2 as the single QR rail, callback-then-check, Khan Bank statements | Deferred | 2026-10-09 |
| [ADR-0019](ADR-0019-lot-expiry-readiness.md) | Lot/expiry readiness without implementation | Deferred | 2026-10-09 |
| [ADR-0020](ADR-0020-offline-deferred.md) | Offline mode deferred; idempotent, document-based mutations now | Deferred | 2026-10-09 |
| [ADR-0021](ADR-0021-scanning-and-printing.md) | Scanning and printing: keyboard-wedge first, raster receipts by default, browser labels first | Accepted | 2026-10-09 |
| [ADR-0022](ADR-0022-pos-print-agent.md) | POS print agent: a polling Node service on the supermarket POS PC | Proposed | 2026-10-09 |
| [ADR-0023](ADR-0023-node-26-from-day-one.md) | Node.js 26 everywhere from day one | Accepted | 2026-10-10 |
| [ADR-0024](ADR-0024-database-bootstrap.md) | Database bootstrap: foundation migration 0000, module-owned guards, pg-boss schema installed by `db:migrate` | Accepted | 2026-10-10 |
| [ADR-0025](ADR-0025-module-format.md) | Module format: CommonJS app and workspace packages, ESM-only dependencies through `require(esm)` | Accepted | 2026-10-10 |
| [ADR-0026](ADR-0026-local-only-until-go-live.md) | Local-only development; one production deployment after the last delivery | Accepted | 2026-10-10 |
| [ADR-0027](ADR-0027-access-control-model.md) | Access control model: code-defined permissions, per-request resolution, write-only scopes | Accepted | 2026-10-10 |
| [ADR-0028](ADR-0028-search-keys.md) | Search keys: a strict and a phonetic form for mixed-script names | Accepted | 2026-10-11 |
| [ADR-0029](ADR-0029-barcode-model.md) | Barcode model: one lookup key, a type per barcode, internal EAN-13 codes | Accepted | 2026-10-11 |
| [ADR-0030](ADR-0030-local-file-storage.md) | Local file storage until go-live: API-signed URLs, public images, owner-confirmed files | Accepted | 2026-10-11 |
| [ADR-0031](ADR-0031-camera-scanning-fallback.md) | Camera scanning fallback: barcode-detector with self-hosted ZXing WebAssembly, layout-independent wedge input | Accepted | 2026-10-11 |
| [ADR-0032](ADR-0032-product-supplier-link.md) | The product ↔ supplier link lives in partners, which may depend on catalog | Accepted | 2026-10-11 |
| [ADR-0033](ADR-0033-receipts-and-costing.md) | Goods receipts land on their shelf and are costed after posting | Accepted | 2026-10-11 |
| [ADR-0034](ADR-0034-stock-posting-protocol.md) | The stock posting protocol: lock order, NULL-safe keys, several documents per posting | Accepted | 2026-10-11 |
| [ADR-0035](ADR-0035-transfers.md) | Transfers are requested by the receiver; differences go back to the sender | Accepted | 2026-10-11 |
| [ADR-0036](ADR-0036-import-pipeline.md) | The import pipeline as built: all or nothing, parsed by the worker | Accepted | 2026-10-11 |
| [ADR-0037](ADR-0037-wide-lists.md) | Lists that show several modules' data read them per page; column choices stay in the browser | Accepted | 2026-10-12 |
| [ADR-0038](ADR-0038-blind-stocktakes.md) | Blind stocktakes, counted shelf by shelf | Accepted | 2026-10-13 |
| [ADR-0039](ADR-0039-low-stock-list.md) | The low-stock list comes from levels and empty balances | Accepted | 2026-10-13 |
| [ADR-0040](ADR-0040-nightly-jobs-and-retention.md) | Nightly jobs and retention | Accepted | 2026-10-13 |
| [ADR-0041](ADR-0041-prices-and-stacked-discounts.md) | One price per list, dated unit prices and stacked discount programs | Accepted | 2026-10-13 |
| [ADR-0042](ADR-0042-web-design-system.md) | An Apple-like design system for the web; records read first, rows open their record | Accepted | 2026-10-13 |
| [ADR-0043](ADR-0043-forms-and-row-actions.md) | Settings-style forms, switches and row actions | Accepted | 2026-10-13 |
| [ADR-0044](ADR-0044-product-registration.md) | Product registration: code ranges, products waiting for their prices, no brands | Accepted | 2026-10-13 |
| [ADR-0045](ADR-0045-ai-assistant-text-to-sql.md) | An AI assistant that answers questions with read-only SQL over curated views | Accepted | 2026-10-13 |
| [ADR-0046](ADR-0046-transfer-request-reopen.md) | A sent transfer request can be taken back for editing and keeps its number | Accepted | 2026-10-14 |
| [ADR-0047](ADR-0047-document-flows-and-attention.md) | Shorter document flows on the web, counts kept on the device, and attention counts on the home page | Accepted | 2026-10-14 |
| [ADR-0048](ADR-0048-warehouse-price-and-price-profiles.md) | One warehouse price per product, central price profiles and whole-pack splits | Accepted | 2026-10-14 |
| [ADR-0049](ADR-0049-segments-and-list-filters.md) | Segments are saved conditions that the data owners evaluate; lists narrow through resolver hooks | Accepted | 2026-10-14 |
| [ADR-0050](ADR-0050-column-choices-per-user.md) | A list's column choices are kept per user in each browser | Accepted | 2026-10-14 |
| [ADR-0051](ADR-0051-bulk-product-edits.md) | Ticked products are changed in bulk by the module that owns each field | Accepted | 2026-10-14 |
| [ADR-0052](ADR-0052-hand-picked-product-segments.md) | Hand-picked product segments, and ticks kept across searches | Accepted | 2026-10-14 |
| [ADR-0053](ADR-0053-recent-pages-per-user.md) | Recently opened pages are kept per user in each browser | Accepted | 2026-10-15 |
| [ADR-0054](ADR-0054-price-sheet-import.md) | The price sheet import | Accepted | 2026-10-15 |
| [ADR-0055](ADR-0055-office-orders.md) | Office orders confirm on submit, line by line from the product's home warehouse | Accepted | 2026-10-15 |
| [ADR-0056](ADR-0056-order-boards.md) | Order boards and stages: a free workflow over the order states, picking confirmed by counts, two kinds of sale | Accepted | 2026-10-15 |
| [ADR-0057](ADR-0057-sales-pipelines.md) | Boards hold pipelines; the warehouse sales page, own-orders-only pipelines and the company order number format | Accepted | 2026-10-15 |
| [ADR-0058](ADR-0058-print-formats-and-payment-labels.md) | Sales documents on A4 or an 80 mm roll; the payment method as each order's label, its author on the card | Accepted | 2026-10-15 |

## Template

Copy this into `ADR-00NN-short-slug.md`. Keep the file between 40 and 140 lines.

```markdown
# ADR-00NN: <Title stating the decision, not the topic>

| | |
|---|---|
| Status | Proposed / Accepted / Deferred / Superseded by ADR-00NN / Rejected |
| Date | YYYY-MM-DD |
| Deciders | Owner, Claude (Claude Code session) |

## Context

What situation forces a decision. Facts about external systems are cited from
docs/architecture.md §9 or §13; business unknowns are tagged TODO-VERIFY.

## Decision

The decision in the present tense, concrete enough to implement: table and
column names, service names, limits, error codes.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| ... | ... |

## Consequences

**Positive.** ...

**Negative.** ...

**Follow-ups.** Dated or delivery-bound actions this decision creates.

## Related

ADR-00NN, docs/architecture.md §N, docs/SPEC.md §N.
```
