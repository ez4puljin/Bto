# payroll — «Цалин» with KPI evaluation (ADR-0235)

Status: the api built 2026-11-20 (branch `task/payroll-core`, migration `0119_payroll`). The web pages and the staff app's screens are separate tasks and build from this document. Nothing is posted to the books yet (finance-core D21).

## 1. Purpose

For one month HR computes every employee's pay from a KPI sheet — fixed salary + an attendance KPI scored by the attendance system + any number of work-evaluation KPIs scored by a person, each worth a fixed amount — minus the advances and the taxes; approves the month; and each employee reads their own payslip. The fixed salary of someone who joined or left inside the month is split by their planned workdays (owner 2026-11-21, ADR-0235 «Amendment 2026-11-21»). The arithmetic lives in `@tugeel/shared/payroll` (`kpiEarned`, `attendanceCounts`, `attendanceScore`, `salaryDays`, `proratedSalary`, `employedSpan`, `plannedWorkdays`, `isSalaryProrated`, `payslipTotals`, `pitCreditFor`, `checkPayrollSettings`, `DEFAULT_PAYROLL_SETTINGS`, the patterns and limits) and is never re-implemented.

Money in every request and response is **text** with at most two decimals (`"300000"`, `"173800.00"`); a percent is text 0–100 with at most two decimals (`"86.9"`); a month is `YYYY-MM`.

## 2. Owned tables

| Table | What |
|---|---|
| `payroll_settings` | one row (`id = 1`): `late_penalty_percent`, `employee_si_percent`, `employer_si_percent`, `minimum_wage`, `si_cap_multiplier`, `pit_percent`, `pit_credits` jsonb (`{ upTo, credit }[]`, lowest first, the last may be open). No row = `DEFAULT_PAYROLL_SETTINGS`. `REVOKE DELETE, TRUNCATE` |
| `payroll_kpi_templates` | name (unique among live ones, case-insensitive), `items` jsonb (`{ key, name, source, amount, sort }[]`), `archived_at`. `REVOKE DELETE, TRUNCATE` |
| `payroll_terms` | per user: `base_salary`, `pays_social_insurance`, `template_id` (origin only), `items` jsonb (the person's own sheet), `active`. `REVOKE DELETE, TRUNCATE` |
| `payroll_advances` | user, `month`, `amount` > 0, `paid_on`, `note`, `created_by`, `voided_at` / `voided_by` / `void_reason`. `REVOKE DELETE, TRUNCATE` |
| `payroll_runs` | `month` (unique), `status` DRAFT / APPROVED, `note`, `settings` jsonb (the rates last computed with), `attendance_to`, `computed_at`, `created_by`, `approved_by` / `approved_at`, `reopened_by` / `reopened_at` / `reopen_reason`. `REVOKE DELETE, TRUNCATE` |
| `payroll_lines` | (run, user) unique: the snapshot (`full_name`, `position`, `division_name`, `base_salary` = the terms' monthly salary, `pays_social_insurance`), the fixed salary's split (`salary_days`, `salary_month_days`, `salary_paid`; NULL on a line computed before 2026-11-21 = `base_salary` paid whole, migration `0121_payroll_prorate`), attendance (`attendance_measured`, `workdays`, `attended_days`, `late_days`) and the totals (`kpi_total`, `taxable_additions`, `gross`, `si_base`, `employee_si`, `employer_si`, `pit_credit`, `pit`, `advance`, `other_additions`, `deductions`, `net`) |
| `payroll_line_items` | a KPI item on a payslip: `key`, `name`, `source`, `amount`, `sort`, `score_percent` (NULL = not scored), `base_percent` / `penalty_percent` (attendance), `earned`, `note`, `scored_by` / `scored_at` |
| `payroll_line_adjustments` | a free line: `kind` ADDITION / DEDUCTION, `name`, `amount` > 0, `taxable` (ADDITION only), `created_by` |

The last three are a draft's working paper (`REVOKE TRUNCATE` only); the triggers `payroll_lines_keep_approved`, `payroll_line_items_keep_approved` and `payroll_line_adjustments_keep_approved` refuse every insert, update and delete once the run is APPROVED (SQLSTATE 23514).

## 3. Services (`modules/payroll`)

- `PayrollSettingsService.get() / update(ctx, settings)`.
- `PayrollTermsService`: `templates(includeArchived)`, `saveTemplate(ctx, id | null, input)`, `archiveTemplate`, `applyTemplate(ctx, id, userIds)`; `list()`, `one(userId)`, `save(ctx, userId, input)`, `mine(userId)`, `activeByUser(tx)`.
- `PayrollAdvancesService.list(filter) / create(ctx, input) / void(ctx, id, reason)`.
- `PayrollRunsService`: `list()`, `get(id)`, `line(runId, lineId)`, `create(ctx, { month, note })`, `recompute(ctx, id, refreshTerms)`, `score(ctx, id, scores)`, `addAdjustment` / `removeAdjustment`, `approve(ctx, id)`, `reopen(ctx, id, reason)`, `scoringRuns(ctx)`, `scoring(ctx, id)`, `myPayslips(ctx)`, `myPayslip(ctx, month)`, `advanceChangedInTx(tx, month, userId)`.
- `PayrollExportsService.runWorkbook(id)` (api only). `PayrollPeopleService` reads hr's staff list and each person's week plan (`HrSettingsService.employees`).

`modules/payroll/index.ts` exports the two Nest modules and the three right codes. Nobody imports payroll; it imports `identity` and `hr` (`WorkforceService`, `HrReportsService`, `HrSettingsService`).

## 4. REST (`/api/v1/payroll/…`)

Rights: **view** = `hr.payroll.view`, **manage** = `hr.payroll.manage`, **score** = `hr.payroll.score` or manage, **self** = any signed-in staff member. `Idem` = needs an `Idempotency-Key` header.

### The employee's own side (self)

| Route | Answer |
|---|---|
| `GET /me/payslips` | `Payslip[]`: the caller's payslips of APPROVED runs, newest month first |
| `GET /me/payslips/:month` | `Payslip`; 404 when the month has no approved payslip for the caller (no run, a draft, or not on it); 422 for a bad month |
| `GET /me/terms` | `{ hasTerms, baseSalary, paysSocialInsurance, items: KpiItem[], kpiTotal }`: the caller's own active sheet (`hasTerms: false` with zeros when none) |

### Settings

| Route | Right | Body → answer |
|---|---|---|
| `GET /settings` | view | → `Settings` |
| `PUT /settings` | manage | `Settings` → `Settings`; 422 for a percent outside 0–100 or credit steps that do not rise |

`Settings` = `{ latePenaltyPercent, employeeSiPercent, employerSiPercent, minimumWage, siCapMultiplier, pitPercent, pitCredits: { upTo: string | null, credit }[] }`.

### KPI templates

| Route | Right | Body → answer |
|---|---|---|
| `GET /templates?includeArchived=` | view | → `Template[]` |
| `POST /templates` (Idem) | manage | `{ name, items: KpiItemRequest[] }` → 201 `Template`; 409 `DUPLICATE_VALUE` for a live name; 422 for two ATTENDANCE items |
| `PUT /templates/:id` | manage | the same body → `Template` |
| `PUT /templates/:id/archived` | manage | `{ archived }` → `Template` |
| `POST /templates/:id/apply` | manage | `{ userIds: number[] }` → `Terms[]`: the template's items replace those people's sheets (salary and insurance flag kept; a person without terms gets them with salary 0) |

`KpiItem` = `{ key, name, source: 'ATTENDANCE' | 'MANUAL', amount, sort }`. `KpiItemRequest` = `{ key?, name, source, amount, sort? }`: send an existing item's `key` back so its score on a draft survives a refresh; omit it for a new item. `Template` = `{ id, name, items, total, archivedAt, updatedAt }`.

### Pay terms

| Route | Right | Body → answer |
|---|---|---|
| `GET /terms` | view | → `Terms[]`: every employed person (and anyone who left but still holds terms), with or without terms |
| `GET /terms/:userId` | view | → `Terms` |
| `PUT /terms/:userId` | manage | `{ baseSalary, paysSocialInsurance, templateId?, items: KpiItemRequest[], active }` → `Terms` |

`Terms` = `{ userId, fullName, position, divisionId, divisionName, left, hasTerms, active, baseSalary, paysSocialInsurance, templateId, templateName, items: KpiItem[], kpiTotal, updatedAt }`. Changing terms changes no existing run.

### Advances

| Route | Right | Body → answer |
|---|---|---|
| `GET /advances?month=&userId=&includeVoided=` | view | → `Advance[]` (at most 2000, newest first) |
| `POST /advances` (Idem) | manage | `{ userId, month, amount, paidOn, note? }` → 201 `Advance`; 409 `DOC_STATE_INVALID` when the month's run is APPROVED |
| `POST /advances/:id/void` | manage | `{ reason }` → `Advance`; 409 when voided already or the month's run is APPROVED |

`Advance` = `{ id, userId, fullName, month, amount, paidOn, note, createdByName, createdAt, voidedAt, voidedByName, voidReason }`. A DRAFT line of that person follows in the same transaction.

### Runs (HR)

| Route | Right | Body → answer |
|---|---|---|
| `GET /runs` | view | → `Run[]`, newest month first |
| `POST /runs` (Idem) | manage | `{ month, note? }` → 201 `RunDetail`; 409 `DUPLICATE_VALUE` (the month has one, `params.id`); 422 for a future month |
| `GET /runs/:id` | view | → `RunDetail` |
| `GET /runs/:id/lines/:lineId` | view | → `Line` |
| `GET /runs/:id/export.xlsx` | view | the run as Excel, one row per employee |
| `POST /runs/:id/recompute` | manage | `{ refreshTerms? }` → `RunDetail`: attendance, the fixed salary's workdays (the employed span from the card), advances and the rates read again; with `refreshTerms` the snapshot follows the terms as they are (people added and removed, salaries, items; a score stays with its item's `key`) |
| `POST /runs/:id/approve` | manage | → `RunDetail`; 409 `DOC_STATE_INVALID` with `params.unscored` while a MANUAL item has no score, or `params.lines = 0` |
| `POST /runs/:id/reopen` | manage | `{ reason }` → `RunDetail`; 409 unless APPROVED |
| `POST /runs/:id/lines/:lineId/adjustments` (Idem) | manage | `{ kind: 'ADDITION' | 'DEDUCTION', name, amount, taxable? }` → 201 `Line` |
| `DELETE /runs/:id/lines/:lineId/adjustments/:adjustmentId` | manage | → `Line` |

Every write on an APPROVED run answers 409 `DOC_STATE_INVALID` (`params.status`).

`Run` = `{ id, month, status, note, settings: Settings, attendanceTo, computedAt, createdAt, createdByName, approvedAt, approvedByName, reopenedAt, reopenedByName, reopenReason, lineCount, unscoredCount, totals }`; `totals` = `{ baseSalary, kpiTotal, gross, employeeSi, employerSi, pit, advance, otherAdditions, deductions, net, totalCost }`. `RunDetail` = `Run` + `lines: Line[]` (by name).

`Payslip` (the employee's view) = `{ id, runId, month, runStatus, approvedAt, userId, fullName, position, divisionName, baseSalary, monthlySalary, salaryDays, salaryMonthDays, paysSocialInsurance, attendanceMeasured, workdays, attendedDays, lateDays, items, adjustments, advances, unscoredCount, kpiTotal, taxableAdditions, gross, siBase, employeeSi, pitCredit, pit, advance, otherAdditions, deductions, net }` with
- `baseSalary` is the fixed salary **paid**: `monthlySalary` (the terms') × `salaryDays` ÷ `salaryMonthDays`, the planned workdays inside the employed span and in the whole month (null on a line computed before 2026-11-21). Prorated when `salaryDays < salaryMonthDays` (`isSalaryProrated`); the screens then show «11 / 22 ажлын өдөр» under «Тогтмол цалин»;
- `items[]` = `{ id, key, name, source, amount, scorePercent | null, basePercent | null, penaltyPercent | null, earned, note, scoredByName, scoredAt }` — for the ATTENDANCE item `basePercent` is attended ÷ workdays and `penaltyPercent` what the late days took off; the counts are on the payslip itself;
- `adjustments[]` = `{ id, kind, name, amount, taxable, createdAt }`; `advances[]` = `{ id, amount, paidOn, note }`.

`Line` (HR's view) = `Payslip` + `{ employerSi, totalCost }`.

Reading order of a payslip: `baseSalary` + each item's `earned` (= `kpiTotal`) + `taxableAdditions` = `gross`; − `employeeSi` (НДШ) − `pit` (ХХОАТ, after `pitCredit`) − `advance` − `deductions` + `otherAdditions` = `net`.

### Scoring (score)

These three routes are `@Authenticated()` and check `hr.payroll.score` or `hr.payroll.manage` in the service (403 otherwise). They show no amount.

| Route | Body → answer |
|---|---|
| `GET /scoring/runs` | → `{ runId, month, status, manualCount, unscoredCount }[]` |
| `GET /scoring/runs/:id` | → `Scoring` = `{ runId, month, status, lines: { lineId, userId, fullName, position, divisionName, items: { itemId, name, scorePercent, note, scoredByName, scoredAt }[] }[] }` (MANUAL items only; a person without one is left out) |
| `PUT /scoring/runs/:id/scores` | `{ scores: { itemId, scorePercent: string | null, note? }[] }` (1–500; `null` takes a score back) → `Scoring`; 422 for an ATTENDANCE item, an item of another run or a percent outside 0–100; 409 on an APPROVED run |

## 5. Invariants

1. All arithmetic goes through `@tugeel/shared/payroll`; money is two decimals HALF_UP, the attendance ratio one decimal.
2. A KPI item earns `amount × score %`, the score within 0–100; an unscored MANUAL item earns 0 and blocks approval.
3. The attendance score comes only from the time report's days (`HrReportsService.days`): attended ÷ planned workdays − late days × the penalty, never below 0; an untracked person gets 100 %, a month without planned days 100 %. The report holds only the days inside the employed span, so a newcomer's score counts from the day they joined; the KPI items' amounts are never prorated.
   - The fixed salary paid (ADR-0235, 2026-11-21) = the monthly salary × planned workdays inside the employed span (max(month start, `employed_on`) … min(month end, `left_on`)) ÷ planned workdays of the month, from the person's own week plan, money HALF_UP; whole when the span holds every workday or the month has none. Both counts and the amount are a snapshot on the line, read again on create and recompute of a DRAFT only.
4. A sheet holds at most one ATTENDANCE item; a person is on a run only with active terms and employed at some point of the month.
5. A run holds a snapshot: later changes of terms, templates, cards or rates reach a DRAFT only through `recompute`, and never an APPROVED run.
6. An APPROVED run's lines, items and free lines never change (services and database triggers); its month takes no new or voided advance. Reopening needs `hr.payroll.manage` and a reason and is audited.
7. One run per month; never for a future month. Every write of a month holds that month's advisory lock.
8. An employee reads only their own payslips, only of APPROVED runs, without the employer's cost; a scorer without `hr.payroll.view` sees names and scores, never an amount.
9. Every write has an audit row in its transaction; the settings, templates, terms, advances and runs are never deleted.
10. The AI assistant reads nothing of payroll (no `ai.*` view).

## 6. Tests

`packages/shared/src/payroll/payroll.test.ts` (the KPI percent and its clamp; the counts from report days; the owner's 200,000 example; the fixed salary split by workdays — the owner's 1,000,000 → 500,000 example, a leaver mid-month, a whole month; the floor; an insured employee's НДШ and ХХОАТ with the credit; a non-insured employee; the capped base; a negative net; the credit table; the settings check; the month). `apps/api/test/integration/payroll.int-spec.ts` (the rates and the rights; templates, a duplicate name, two attendance items; a template applied and the sheet edited; a run built from 22 planned days with 20 attended and 2 late; an advance deducted; a manager scoring without seeing pay; an uninsured employee; free lines; recompute with and without `refreshTerms`; approval refused while unscored, then freezing — services and the `app` role's SQL; an employee reading only their own approved payslip; the Excel; reopen with a reason, a voided advance, the audit rows; a newcomer joined on 16 September: salary 11 / 22 = 500,000, attendance 11 of 11, a corrected card read on recompute, the approved line frozen and the payslip showing the split).

## 7. Screens

Web «Хүний нөөц → Цалин» (`apps/web/src/features/payroll`: runs, a run's sheet with scoring, pay terms and templates, advances, settings) and the staff app's «Миний цалин» (`apps/mobile/app/(staff)/payroll`: the payslips, the own sheet, a scorer's screen). Under «Тогтмол цалин» the run's table, the line window (with the monthly salary) and the payslip show «11 / 22 ажлын өдөр» when the salary was split.
