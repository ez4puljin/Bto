# ADR-0194: A report page's conditions kept under a name: saved views, private or shared

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «Аналитик загвар: тайлангийн хүссэн загвараа үүсгэж хадгалах боломжтой», then «Тийм, хий» to saved views first), Claude (the direct-mode session) |
| Amends | ADR-0108 and ADR-0133 (the report pages gain «Загвар»), ADR-0050 (what a browser keeps per user is still the columns; a view is kept on the server) |

## Context

Every report page keeps its prompt and conditions in its address (`?from&to&by&…`, ADR-0133, ADR-0135): a reload or a link shows the same report. That is all a user could keep: a browser bookmark, on one PC, with the dates frozen in it. The owner asked for report templates that are made once and kept; the people who take the same report every morning set the same six conditions every morning.

## Decision

1. **A saved view is a page's address parameters under a name** (`report_views`, migration `0101_report_views`, owned by `reporting`): `page`, `name`, `query`, `period`, `shared`, the author. Nothing of a report's result is kept, and no new way to compute one: opening a view is opening the page with those parameters, so the report's own rights decide what is shown, at that moment.
2. **Nine pages keep views** (`REPORT_VIEW_PAGES` in `@tugeel/shared/reports`, each with the right its page needs): `party-ledger` and `money-ledger` (`finance.read`), `stock-balance`, `product-sales`, `stock-documents`, `aging`, `stock` (`reports.view`), `profit` and `suppliers` (`reports.margins.view`). The dashboard has only its month and keeps none. A new report page joins by one line in that table and one prop on its header.
3. **A period can move with the calendar.** A view is saved with the dates on screen, or with a preset: «Энэ сар», «Өнгөрсөн сар», «Энэ улирал», «Энэ он» (the prompt's own presets, now in the shared package). A preset keeps no dates in `query`; they are worked out on the day the view is opened (`openViewQuery`). The save dialog suggests the preset when the dates on screen are exactly one's today.
4. **Private or shared.** A view is its author's alone, or `shared`: then everyone who may open the page sees it under «Бусдын хуваалцсан» with the author's name. Only the author changes a view (the name, the conditions, the period, the sharing). The author deletes it; a holder of `identity.settings.manage` may delete a shared view of someone else (a person who left), never a private one. No new right.
5. **A name is one view per person and page** (unique without case). Saving under a name the caller already uses replaces that view; the dialog says so before the save. At most 30 views per person and page (`REPORT_VIEW_LIMIT` 409 past it).
6. **Routes** (`/api/v1/reports/views`, every signed-in user; the service asks for the page's right): `GET ?page=`, `POST` (idempotent), `PATCH :id`, `DELETE :id`. They are light: outside the reports' gate (ADR-0193), and they keep nothing in a process's memory, so they run on the report replicas with the other `/reports/*` routes (ADR-0192 #2).
7. **On screen** (`features/reports/report-views.tsx`): «Загвар» in the page header beside «Excel»: the caller's views, then the shared ones, each opened with one press; a bin on the ones the caller may delete; «Одоогийн харагдацыг хадгалах» opens the dialog (name, period when the address has both dates, «Бусадтай хуваалцах»).
8. **The address is kept as written.** `query` is the browser's encoded parameters in a stable order (printable ASCII, at most 2 000 characters), checked by shape only: it is only ever given back to the same page's router, which reads its parameters as it reads any address.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep views in the browser, like the columns (ADR-0050) | Lost with the PC or the browser, and cannot be shared: the two things asked for. |
| Structured conditions per report (a column per filter) | Nine pages with different conditions, each change of a page a migration; the address already is the page's own complete, versionless description. |
| A free pivot builder (rows, columns, measures chosen by the user) | The larger wish and still open; a saved view is what makes any builder's result worth building, and is useful without it. |
| A default view opened by itself | A page that opens on yesterday's choice hides that a choice was made; one press on «Загвар» is cheap. Open if asked. |
| A new right for sharing | Sharing shows a name and conditions, never data the other person may not already open. |

## Consequences

**Positive.** A morning report is one press; a manager's way of reading a report can be given to the whole office; «this month» stays this month; nothing about the reports' figures or rights changed; a new report page gets views for one line.

**Negative.** A view saved today may name a warehouse, customer or category that is later retired: the page then shows what it shows for such an address (usually nothing chosen), the view is not checked. If a page's parameter is renamed, old views lose that condition silently. Shared views can pile up: the list is own first, and the settings right tidies.

**Follow-ups.**
- Scheduled reports: a view run in the background each morning and kept (with ADR-0193's stored reports).
- A free pivot of the sales lines (ADR-0135's cube with the user's own rows and columns).
- The finance statements, the trial balance and HR's day report as view pages.
- The AI assistant's saved reports (ADR-0045) and these views in one «Миний тайлангууд» list.

## Related

ADR-0050, ADR-0108, ADR-0133, ADR-0135, ADR-0192, ADR-0193, `packages/shared/src/reports/`, `apps/api/src/modules/reporting/` (`schema.ts`, `services/report-views.service.ts`, `controllers/report-views.controller.ts`), `apps/web/src/features/reports/report-views.tsx`, `docs/modules/reporting.md`.
