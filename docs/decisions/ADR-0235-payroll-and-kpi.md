# ADR-0235: Payroll («Цалин») with KPI evaluation: a KPI sheet per employee, the attendance score from the time report, a monthly run that is approved and frozen

|          |                                                                                          |
| -------- | ---------------------------------------------------------------------------------------- |
| Status   | Accepted                                                                                 |
| Date     | 2026-11-20                                                                               |
| Deciders | Owner (2026-11-20, through the brain's brief), Claude (the worker `bto-core`)            |
| Amends   | ADR-0131 / ADR-0144 (hr's time report gains a reader: payroll); ADR-0165 (three new codes on the HR role); architecture §4 row 11 (payroll is its own module, not a part of `hr`) |

## Context

Attendance, the employees' cards and the time report exist (ADR-0131, ADR-0144); pay was computed outside the system. The owner decided on 2026-11-20 how pay is made: every employee has a KPI sheet; the month's pay is the fixed salary plus an attendance KPI plus any number of work-evaluation KPIs, each worth a fixed amount of money, minus the advance and the taxes where they apply. HR computes a month, approves it, and each employee reads their own payslip. This ADR is the api; the web pages and the staff app's screens follow in their own tasks.

## Decision

1. **A module of its own**, `modules/payroll` (depends on `identity` and `hr`; nobody imports it), with the pure arithmetic in `@tugeel/shared/payroll`. It reads the staff list and the time report through hr's services (`WorkforceService.employees`, `HrReportsService.days`) and writes only its own tables. It posts nothing to the books yet: finance-core D21 (source `HR` through the intake) stays open and nothing here stands in its way — an approved run holds every amount a posting needs.
2. **Pay.** `gross = fixed salary + Σ KPI earned + taxable additions`; `net = gross − НДШ − ХХОАТ − advances − other deductions + untaxed additions`. Net may be negative (advances above the pay) and is shown so.
3. **A KPI item** has a name, a `source` and a fixed amount. It earns `amount × score %`, the score held to 0–100. `source` is `ATTENDANCE` (scored by the attendance system) or `MANUAL` (scored by a person, with an optional note); a new automatic source (sales, say) is a new value of `KPI_SOURCES` and a branch where the attendance score is computed. A sheet holds at most one `ATTENDANCE` item.
4. **The attendance score** = days attended ÷ planned workdays of the month, as a percent rounded to **one decimal**, minus `late days × the late penalty` (setting, default 2 %), never below 0. The owner's example is the unit test: 200,000₮, 22 workdays, 20 attended, 2 late → 90.9 % − 4 % = 86.9 % → 173,800₮.
   - The days are the time report's own (`reportDay` over `summarizeDay`), never recomputed: a planned day is a workday; it is attended unless the report says `ABSENT` (so an approved whole-day leave `LEAVE`, a trip `AWAY` and a day with a forgotten «Явсан» `OPEN` count); an attended workday with late minutes is a late day. Work on a day off counts nowhere.
   - A month still running is read up to today, as the report reads it (`payroll_runs.attendance_to`). A month with no planned day scores 100 %.
   - **Claude's default:** a person whose attendance is not tracked (`hr_employees.tracked = false`) gets the attendance item in full, shown as «not measured».
5. **Rounding.** Money is MNT with **two decimals, HALF_UP** (the project's `NUMERIC(14,2)` rule), not whole tugrik; a score has at most two decimals.
6. **Templates and terms.** HR keeps reusable KPI templates (`payroll_kpi_templates`: «Кассчин», «Жолооч»). An employee's pay terms (`payroll_terms`) are the fixed salary, `pays_social_insurance`, and their own list of items — a copy of a template (one by one, or `POST /payroll/templates/:id/apply` for many), edited per person afterwards; changing a template changes nobody's sheet. Each item carries a stable `key`. Only `active` terms put a person on a run.
7. **Taxes are settings, never constants** (`payroll_settings`, one row, edited by HR; the defaults are Mongolia's rates as Claude knows them for 2026 and **the owner or the accountant should confirm them on the settings page**):
   - employee НДШ 11.5 % of gross, the base capped at `si_cap_multiplier` (10) × `minimum_wage` (792,000₮); employer НДШ 12.5 % of the same base — a cost shown to HR, never deducted;
   - ХХОАТ 10 % of (gross − employee НДШ), minus the monthly credit by that taxable income: ≤ 500,000 → 20,000; ≤ 1,000,000 → 18,000; ≤ 1,500,000 → 16,000; ≤ 2,000,000 → 14,000; ≤ 2,500,000 → 12,000; ≤ 3,000,000 → 10,000; above → 0. The credit never exceeds the tax;
   - `pays_social_insurance = false`: no НДШ and no ХХОАТ.
   - Not modelled: the higher income-tax steps above 120 million a year, and the employer's rate by industry.
8. **Advances** (`payroll_advances`): amount, date, note, per employee and month; the month's payslip deducts their sum. Never edited or deleted — voided with a reason and typed again. **Free lines** on a payslip (`payroll_line_adjustments`): a name, an amount, `ADDITION` or `DEDUCTION`; an addition is `taxable` (part of gross) or paid on top of the net.
9. **The run** (`payroll_runs`, one per `YYYY-MM`, never for a future month).
   - `DRAFT`: creating it builds a line per person employed in the month with active terms — a snapshot of name, position, division, salary, the insurance flag and the items — and scores attendance. `recompute` reads attendance, the advances and the rates again; with `refreshTerms` the snapshot also follows the terms as they now are (who is on the run, salaries, items), an item keeping its score by its `key`. Scores, free lines and advances recompute their line at once with the rates the run holds.
   - `APPROVED`: every `MANUAL` item must be scored first (409 otherwise, never a silent zero). From then on nothing changes: the services refuse, and a database trigger refuses any insert, update or delete of the lines, items and free lines of an approved run (SQLSTATE 23514). The month takes no new or voided advance either.
   - `reopen` (manage, with a reason, audited) returns it to `DRAFT`; the payslips leave the employees' lists until it is approved again.
   - Every write of a month runs under that month's advisory lock.
10. **Rights.** `hr.payroll.view` reads every run, payslip, sheet, advance and the rates; `hr.payroll.manage` writes all of it, approves and reopens; `hr.payroll.score` scores `MANUAL` items through the scoring routes, which show the people and their items and **no amount at all**. The HR role holds the three; a manager gets the score code by a custom role or an admin's tick. Every signed-in staff member reads their own approved payslips and their own sheet under `/payroll/me` and nothing of anyone else; the employee's payslip carries no employer's cost.
11. **Audit and deletion.** Every write records an audit row in its transaction (`payroll_settings`, `payroll_kpi_template`, `payroll_terms`, `payroll_advance`, `payroll_run` CREATE / RECOMPUTE / APPROVE / REOPEN, `payroll_line_item` SCORE, `payroll_line_adjustment`). `REVOKE DELETE, TRUNCATE` on the settings, templates, terms, advances and runs; a draft's lines are working paper (rebuilt by `refreshTerms`), guarded by the trigger once approved.
12. **Excel**: `GET /payroll/runs/:id/export.xlsx`, one row per employee.
13. **The AI assistant does not read payroll.** No `ai.*` view and no `AI_DATASETS` entry: pay is private, and the assistant's answers are not filtered per person.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Building payroll inside `modules/hr` | hr is already the largest module after sales; payroll has its own rights, its own privacy rule and a later posting to the books. It reads hr through two services. |
| Recomputing attendance from the punches in payroll | Two readings of the same month would disagree; the time report is what HR already corrects and trusts. |
| Whole-tugrik rounding | The project's money rule is two decimals; the taxes' amounts are filed with decimals. |
| Template items and sheet items as tables | They are configuration rewritten whole on every save; the money that is paid lives in the run's own rows (`payroll_line_items`). |
| A sheet following its template | The owner wants amounts per person; a later change of a template would silently change people's pay. |
| Soft-deleting a draft's lines instead of the trigger | The trigger states the rule where it cannot be bypassed: an approved payslip never changes. |
| An unscored item earning 0 at approval | A forgotten score would cut somebody's pay unseen. |

## Consequences

- Migration `0119_payroll`: eight new tables, two trigger functions, nothing existing changed.
- `eslint.config.mjs` `MODULE_DEPS` needs `payroll: ['identity', 'hr']` and architecture §4 a row for the module (outside this task's paths; reported to the brain).
- `modules/hr/index.ts` exports `HrReportsService` and `WorkforceService`.
- `@tugeel/shared/payroll` is a new subpath; `packages/api-client` is regenerated.
- The web pages («Хүний нөөц → Цалин») and the staff app's «Миний цалин» follow; the staff app needs a new APK then.
- Open for the owner (defaults taken, each changeable): the tax rates and the minimum wage; that the tax credit's step is read from the taxable income (gross − НДШ); an untracked person's full attendance item; no proration of the fixed salary for someone who joined or left inside the month; a scorer scores everybody, not only their own division; a run may be approved before its month ends.

## Related

ADR-0131, ADR-0144, ADR-0145, ADR-0165, ADR-0206, ADR-0213, docs/modules/payroll.md, docs/modules/hr.md, docs/modules/finance-core.md D21.
