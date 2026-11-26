# ADR-0244: Employee-only fixed salary overrides

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-22 |
| Decider | Owner, local payroll terms request |
| Amends | ADR-0243 decision 5 (position-bound salary overrides were refused) |

## Decision

1. A position continues to provide the default fixed salary. A holder of `hr.payroll.manage` may explicitly save or change a different fixed amount for any employee, including their own record, in Payroll Terms (owner confirmation 2026-11-26). There is no self-override restriction. This does not relax ADR-0243: only ADMIN assigns/moves positions and nobody moves their own position. This writes no position rate or other employee's terms.
2. Employee overrides belong to payroll in `payroll_salary_overrides`, keyed by employee and effective month. An amount including zero selects PERSONAL pay; a null event resumes the applicable position's salary. An explicit personal amount persists across position rate changes and reassignments until reset.
3. Assigned employees' overrides and resets take effect next calendar month in Asia/Ulaanbaatar. Only that pending month's event can be revised. Existing effective history cannot be edited, deleted or truncated by the runtime. Migration `0125_payroll_salary_overrides` is additive and guesses no salary.
4. Omitting `baseSalary` preserves the salary mode when KPI, insurance or participation changes. `usePositionSalary: true` explicitly resets and cannot accompany `baseSalary`. Legacy unassigned terms retain their compatibility behavior. Position-backed terms never fabricate legacy eligibility for earlier months.
5. Payroll resolves the override as of the run's month before the applicable position salary; approved snapshots and existing draft snapshots change only through their existing authorized workflow. Old genuine legacy fallback remains unchanged.
6. The public identity access gate is taken first, before rereading the employee's binding and locking terms, matching HR's lock order and serializing the first terms insert with assignment changes. The existence and current-binding reads use that same transaction through HR's public service; they never check out a second pooled connection while holding the access lock. Every override revision/reset is audited in the same transaction. Audit metadata records the mode, effective month and change indicator without disclosing amounts to audit readers who lack payroll permission; amounts remain in protected payroll history and snapshots.
7. Terms and own-terms responses show the current effective amount/source, the next effective amount/source, and independent current/next position defaults. Privacy and payroll permissions are unchanged. Generic audit amounts remain hidden without `hr.payroll.view` or actual ADMIN.

## Consequences

The editable terms salary starts from the applicable saved/default amount. A personal edit no longer requires changing a position shared with colleagues. Restoring inheritance follows whatever position rate is in force when the reset takes effect.
