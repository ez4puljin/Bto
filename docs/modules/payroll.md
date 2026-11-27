# payroll — «Цалин» with KPI evaluation (ADR-0235)

Status: the api built 2026-11-20 (branch `task/payroll-core`, migration `0119_payroll`). The web pages and the staff app's screens are separate tasks and build from this document. Nothing is posted to the books yet (finance-core D21).

## 1. Purpose

For one month HR computes every employee's pay from a KPI sheet — fixed salary + an attendance KPI scored by the attendance system + any number of work-evaluation KPIs scored by a person, each worth a fixed amount — minus the advances and the taxes; approves the month; and each employee reads their own payslip. The fixed salary of someone who joined or left inside the month is split by their planned workdays (owner 2026-11-21, ADR-0235 «Amendment 2026-11-21»). The arithmetic lives in `@tugeel/shared/payroll` (`kpiEarned`, `attendanceCounts`, `attendanceScore`, `salaryDays`, `proratedSalary`, `employedSpan`, `plannedWorkdays`, `isSalaryProrated`, `payslipTotals`, `pitCreditFor`, `checkPayrollSettings`, `DEFAULT_PAYROLL_SETTINGS`, the patterns and limits) and is never re-implemented.

Money in every request and response is **text** with at most two decimals (`"300000"`, `"173800.00"`); a percent is text 0–100 with at most two decimals (`"86.9"`); a month is `YYYY-MM`.

Since ADR-0243, an assigned employee's fixed salary comes from HR's effective-month salary assignments and position rates. The initial position rate starts in its creation month; a later rate change starts next month. A newly registered employee's salary assignment starts this month; binding an existing employee or moving them to another position starts next month, while the position's permissions change immediately. Personal terms still own the KPI sheet, insurance flag and active flag. An employee with an applicable position salary and no `payroll_terms` row participates automatically with insurance enabled and no KPI items. An explicitly inactive row excludes them. Legacy employees without a position continue using their stored personal salary. Before the first salary assignment/rate, only a personal row marked as holding a genuine legacy salary supplies a fallback; otherwise the employee is excluded, rather than assigning a current rate retroactively. Saving or applying KPI items for assigned staff never creates a legacy fallback.

Since ADR-0244, an assigned employee can have an explicit PERSONAL salary override, effective next month. `payroll_salary_overrides` holds dated amounts; null resumes position inheritance. The override survives position rate changes and reassignment until reset. A salary omitted from a terms save does not create or reset an override; KPI-only saves preserve inheritance. The effective override is resolved by payroll run month before the position default and never rewrites approved history. The public identity access gate serializes terms writes with HR assignments. A holder of `hr.payroll.manage` may change their own employee-only override as well as another employee's; this does not grant position assignment or self-position moves. Each revision/reset is audited, with historical audit amounts masked unless `hr.payroll.view` or actual ADMIN authorizes them.

## 2. Owned tables

| Table | What |
|---|---|
| `payroll_settings` | one row (`id = 1`): `late_penalty_percent`, `employee_si_percent`, `employer_si_percent`, `minimum_wage`, `si_cap_multiplier`, `pit_percent`, `pit_credits` jsonb (`{ upTo, credit }[]`, lowest first, the last may be open). No row = `DEFAULT_PAYROLL_SETTINGS`. `REVOKE DELETE, TRUNCATE` |
| `payroll_kpi_templates` | name (unique among live ones, case-insensitive), `items` jsonb (`{ key, name, source, amount, sort }[]`), `archived_at`. `REVOKE DELETE, TRUNCATE` |
| `payroll_terms` | per user: `base_salary` (legacy salary, preserved when a position is assigned), `position_legacy_salary` (true only for a genuine personal salary; migration preserves existing rows, newly assigned rows default false), `pays_social_insurance`, `template_id` (origin only), `items` jsonb (the person's own sheet), `active`. Salary assignments and position rates belong to HR. `REVOKE DELETE, TRUNCATE` |
| `payroll_salary_overrides` | user + effective month, nullable base_salary (null = resume position default), updated_by/at. Only next-month revisions, immutable once effective; REVOKE DELETE, TRUNCATE |
| `payroll_advances` | user, `month`, `amount` > 0, `paid_on`, `note`, `created_by`, `voided_at` / `voided_by` / `void_reason`. `REVOKE DELETE, TRUNCATE` |
| `payroll_runs` | `month` (unique), `status` DRAFT / APPROVED, `note`, `settings` jsonb (the rates last computed with), `attendance_to`, `computed_at`, `created_by`, `approved_by` / `approved_at`, `reopened_by` / `reopened_at` / `reopen_reason`. `REVOKE DELETE, TRUNCATE` |
| `payroll_lines` | (run, user) unique: the snapshot (`full_name`, `position`, `division_name`, `base_salary` = the terms' monthly salary, `pays_social_insurance`), the fixed salary's split (`salary_days`, `salary_month_days`, `salary_paid`; NULL on a line computed before 2026-11-21 = `base_salary` paid whole, migration `0121_payroll_prorate`), attendance (`attendance_measured`, `workdays`, `attended_days`, `late_days`) and the totals (`kpi_total`, `taxable_additions`, `gross`, `si_base`, `employee_si`, `employer_si`, `pit_credit`, `pit`, `advance`, `other_additions`, `deductions`, `net`) |
| `payroll_line_items` | a KPI item on a payslip: `key`, `name`, `source`, `amount`, `sort`, `score_percent` (NULL = not scored), `base_percent` / `penalty_percent` (attendance), `earned`, `note`, `scored_by` / `scored_at` |
| `payroll_line_adjustments` | a free line: `kind` ADDITION / DEDUCTION, `name`, `amount` > 0, `taxable` (ADDITION only), `created_by` |

The last three are a draft's working paper (`REVOKE TRUNCATE` only); the triggers `payroll_lines_keep_approved`, `payroll_line_items_keep_approved` and `payroll_line_adjustments_keep_approved` refuse every insert, update and delete once the run is APPROVED (SQLSTATE 23514).

## 3. Services (`modules/payroll`)

- `PayrollSettingsService.get() / update(ctx, settings)`.
- `PayrollTermsService`: `templates(includeArchived)`, `saveTemplate(ctx, id | null, input)`, `archiveTemplate`, `applyTemplate(ctx, id, userIds)`; `list()`, `one(userId)`, `save(ctx, userId, input)`, `mine(userId)`, `activeByUser(tx, month)`.
- `PayrollAdvancesService.list(filter) / create(ctx, input) / void(ctx, id, reason)`.
- `PayrollRunsService`: `list()`, `get(id)`, `line(runId, lineId)`, `create(ctx, { month, note })`, `recompute(ctx, id, refreshTerms)`, `score(ctx, id, scores)`, `addAdjustment` / `removeAdjustment`, `approve(ctx, id)`, `reopen(ctx, id, reason)`, `scoringRuns(ctx)`, `scoring(ctx, id)`, `myPayslips(ctx)`, `myPayslip(ctx, month)`, `advanceChangedInTx(tx, month, userId)`.
- `PayrollExportsService.runWorkbook(id)` (api only). `PayrollPeopleService` reads hr's staff list and each person's week plan (`HrSettingsService.employees`).

`modules/payroll/index.ts` exports the two Nest modules, the three right codes, and the trusted `PayrollSourceDeductionsService` source port. Expiry imports that public port; payroll still depends only on `identity` and `hr` (`WorkforceService`, `HrReportsService`, `HrSettingsService`, `PositionsService`). Salary assignments and rates are resolved through `PositionsService.baseSalariesForUsers(tx, userIds, month)`, never through HR tables. Current pay terms also read `salarySchedulesForUsers` to show an upcoming assignment or rate even when the employee has no current salary assignment yet.

### Durable expiry sale deductions (ADR-0245)

`payroll_source_deductions` owns immutable source kind/key/reference, employee, signed money,
original requested month and an optional original allocation (`reverses_id`). Only the assigned
month and its actor/time can change. `(source_kind, source_key, user_id)` is unique. The source
module supplies the already calculated VAT-exclusive actual-sale loss and frozen employee split;
payroll never reads expiry/receipt/cost tables or recalculates those prices. Sale allocations are
nonnegative; return allocations are nonpositive and cannot cumulatively exceed the original
employee's sale allocation. Finite NUMERIC(14,2), immutable identity/amount and cumulative return
checks also hold in PostgreSQL. Neither source rows nor settlement history can be deleted or
truncated by the application.

`PayrollSourceDeductionsService.recordInTx(tx, actor: Actor, input)` is a server-only port, with
`{ sourceKind: 'EXPIRY_SALE' | 'EXPIRY_RETURN', sourceKey, sourceReference, requestedMonth,
reversesSourceKey?, allocations: { userId, amount: string }[] }`. It writes in the caller's sale
transaction and needs no payroll permission. Exact immutable payload replay returns the same
rows; a changed payload conflicts. IDs must be unique per request and money must be finite text
with no more than two decimals. There is no HTTP endpoint for creating arbitrary source charges.
Commerce calls `lockInTx(tx)` once for the whole batch before its first expiry financial row
lock, following the stock posting flow's existing order for stock locks. The port reacquires
that transaction-reentrant gate defensively on each allocation write.

The operator chooses any writable month, including a past DRAFT month. A future chosen month
can wait for its run; future run creation remains prohibited. Missing runs, missing/ineligible
payroll lines and approved months retain
their sources without rejecting a completed sale or choosing another month. Read states are
`NEEDS_MONTH`, `WAITING_RUN`, `MONTH_CLOSED`, `MISSING_LINE`, `READY`, `SETTLED`. Pending sources
are independent of draft lines, so `recompute(refreshTerms: true)` can remove and later restore
an employee without losing an obligation. Every draft recompute derives source totals afresh.
Positive source money adds to deductions after SI/PIT; negative money adds to untaxed additions,
leaving gross and the tax basis unchanged. The existing negative-net policy remains unchanged.

Before settlement, returns inherit the original allocation's assigned month. After an approved
settlement, a return becomes an unassigned credit and needs an explicitly chosen writable
month; the approved payslip is unchanged. Reassigning a pending source moves that employee's
pending sale and pending returns together, while settled sources cannot move. No other month
is selected automatically.

`payroll_source_settlements` freezes each exact source amount and run on approval, with one active
settlement per source. Reopening first makes the run DRAFT, then releases its settlements while
preserving their history and recalculates the draft. Reapproval appends fresh settlement rows;
it never pays or deducts the same source twice. Source writes enter a transaction-scoped source
batch gate before source keys and sorted payroll months, so repeated calls for a multi-line sale
cannot invert source/month locks. Approval/recompute/reopen use the same month locks and take
neither source locks nor the batch gate.

| Route | Right | Contract |
|---|---|---|
| `GET /source-deductions?sourceReference=&sourceKey=&userId=&month=&pendingOnly=` | view | up to 2000 newest source allocations, state and settlement/release history |
| `PUT /source-deductions/:id/month` | manage | `{ month: 'YYYY-MM' }`; choose any month with no APPROVED run, returning the pending employee group |

`Payslip` / `Line` additionally carry `sourceDeductions[] = { id, name, sourceKind,
sourceReference, amount }`; the signed amount is only that employee's allocation. The transparent
label is **Хугацааны хямдралын алданги**. An employee's own approved payslip contains no source
key, purchase/receipt cost, other employee's allocation or employer cost. Score-only users see
no source amounts. Protected source reads require payroll view, month assignment requires
manage. New source audit payloads contain IDs, month and state metadata only; approval audit
also omits monetary totals because generic audit readers need not hold payroll rights.

`apps/api/test/integration/expiry-payroll.int-spec.ts` covers exact/concurrent replay, invalid
money and duplicate employees, sale rollback, chosen future and past DRAFT months, pending and settled returns,
explicit credit assignment, draft projection and unchanged tax basis, recompute/removed line
durability, protected reads, employee isolation, approval/reopen history, and SQL immutability.
`apps/api/test/integrity/expiry-payroll-races.spec.ts` covers cumulative concurrent returns,
database over-reversal/NaN guards and approval racing a finalized sale without losing its debt.

## 4. REST (`/api/v1/payroll/…`)

Rights: **view** = `hr.payroll.view`, **manage** = `hr.payroll.manage`, **score** = `hr.payroll.score` or manage, **self** = any signed-in staff member. `Idem` = needs an `Idempotency-Key` header.

### The employee's own side (self)

| Route | Answer |
|---|---|
| `GET /me/payslips` | `Payslip[]`: the caller's payslips of APPROVED runs, newest month first |
| `GET /me/payslips/:month` | `Payslip`; 404 when the month has no approved payslip for the caller (no run, a draft, or not on it); 422 for a bad month |
| `GET /me/terms` | `{ hasTerms, positionId, position, positionSalaryEffectiveMonth, baseSalary, nextBaseSalary, nextEffectiveMonth, paysSocialInsurance, items: KpiItem[], kpiTotal }`: the caller's own active sheet and current salary (`hasTerms: false` with zeros when none or explicitly inactive) |

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
| `PUT /terms/:userId` | manage | `{ baseSalary?, usePositionSalary?, paysSocialInsurance, templateId?, items: KpiItemRequest[], active }` → `Terms`; for assigned employees, explicit salary schedules a personal override next month; omit to preserve the mode or usePositionSalary=true to reset next month (cannot accompany baseSalary); salary remains required for legacy unassigned employees |

`Terms` = `{ userId, fullName, positionId, position, positionSalaryEffectiveMonth, divisionId, divisionName, left, hasTerms, active, baseSalary, nextBaseSalary, nextEffectiveMonth, paysSocialInsurance, templateId, templateName, items: KpiItem[], kpiTotal, updatedAt }`. `positionId` and `position` identify the employee's current card binding; the nullable `positionSalaryEffectiveMonth` says when that binding supplies salary. `baseSalary` is the current month's effective assignment/rate, or preserved legacy fallback, so a pending card change does not change current pay. The nullable next fields identify the nearest scheduled salary. ADR-0244 adds `salarySource` / nullable `nextSalarySource` (`POSITION`, `PERSONAL`, `LEGACY`) and independent nullable `positionBaseSalary`, `positionNextBaseSalary`, `positionNextEffectiveMonth` defaults to both Terms and own Terms. They distinguish an employee override from a shared position rate. `hasTerms` includes an applicable position's automatic defaults. Changing terms changes no existing run.

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
4. A sheet holds at most one ATTENDANCE item; a person is on a run only with active terms (including an assigned position's defaults) and employed at some point of the month.
5. A run holds a snapshot: later changes of terms, templates, cards or rates reach a DRAFT only through `recompute`, and never an APPROVED run. Creation and `recompute(refreshTerms: true)` resolve the salary assignment and position rate using the run's month, so a scheduled increase or reassignment cannot change earlier months. The payslip's position label follows that month's salary assignment. Without `refreshTerms`, the salary, position and KPI snapshot stays; manual scores survive a refresh by item key.
6. An APPROVED run's lines, items and free lines never change (services and database triggers); its month takes no new or voided advance. Reopening needs `hr.payroll.manage` and a reason and is audited.
7. One run per month; never for a future month. Every write of a month holds that month's advisory lock.
8. An employee reads only their own payslips, only of APPROVED runs, without the employer's cost; a scorer without `hr.payroll.view` sees names and scores, never an amount.
9. Every write has an audit row in its transaction; the settings, templates, terms, advances and runs are never deleted.
10. The AI assistant reads nothing of payroll (no `ai.*` view).

## 6. Tests

`packages/shared/src/payroll/payroll.test.ts` (the KPI percent and its clamp; the counts from report days; the owner's 200,000 example; the fixed salary split by workdays — the owner's 1,000,000 → 500,000 example, a leaver mid-month, a whole month; the floor; an insured employee's НДШ and ХХОАТ with the credit; a non-insured employee; the capped base; a negative net; the credit table; the settings check; the month). `apps/api/test/integration/payroll.int-spec.ts` (the rates and the rights; templates, a duplicate name, two attendance items; a template applied and the sheet edited; a run built from 22 planned days with 20 attended and 2 late; an advance deducted; a manager scoring without seeing pay; an uninsured employee; free lines; recompute with and without `refreshTerms`; approval refused while unscored, then freezing — services and the `app` role's SQL; an employee reading only their own approved payslip; the Excel; reopen with a reason, a voided advance, the audit rows; a newcomer joined on 16 September: salary 11 / 22 = 500,000, attendance 11 of 11, a corrected card read on recompute, the approved line frozen and the payslip showing the split).

`apps/api/test/integration/payroll-positions.int-spec.ts` covers assigned new staff without personal rows, preserved legacy fallback and exclusion before the first salary assignment (also after KPI terms are saved), pending legacy bindings and reassignments taking salary next month, rejection of personal salary overrides, current versus next-month rates, stable manual scores on refresh, unchanged approved salary and position snapshots, and explicit inactive terms excluding an assigned employee.

## 7. Screens

Web «Хүний нөөц → Цалин» (`apps/web/src/features/payroll`: runs, a run's sheet with scoring, pay terms and templates, advances, settings) and the staff app's «Миний цалин» (`apps/mobile/app/(staff)/payroll`: the payslips, the own sheet, a scorer's screen). Under «Тогтмол цалин» the run's table, the line window (with the monthly salary) and the payslip show «11 / 22 ажлын өдөр» when the salary was split.

Migration 0124 adds a nullable legacy marker without a default, preserving existing terms as NULL. The new column then defaults to false for future inserts. Existing NULL terms retain legacy salary; a normal save records true. Missing terms are never legacy. No existing business row is rewritten.
