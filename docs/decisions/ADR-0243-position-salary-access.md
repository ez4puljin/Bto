# ADR-0243: A position owns staff access and the monthly base salary

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-22 |
| Decider | Owner, through the local position architecture brief |
| Amends | ADR-0144 employee position text; ADR-0235 individual fixed salary; ADR-0027 manual staff role assignment |

## Decision

1. HR owns an explicit position catalog. Only an actor holding the actual identity `ADMIN` role creates, edits, archives or restores a position. A position names existing identity role IDs and one monthly base salary. Role IDs are preserved, including custom roles and the IDs used by sales pipeline/stage rights; there is no second permission engine. Existing role permission edits continue to affect every holder.
2. New HR staff registration must select a position. Only actual ADMIN may register staff or assign/move any position; HR attendance management alone grants neither role assignment nor pay changes. No actor, including ADMIN, may change their own position: another ADMIN must do it. HR may edit an unchanged non-ADMIN staff card without rewriting roles or assignment history. An ADMIN maps existing unassigned staff deliberately. Old text positions, roles and pay terms remain readable and untouched until that mapping: names with differing salaries or rights are never merged by inference.
3. `hr_employees.position_id` is the current position for access. Identity's public `StaffAccountsService.assignPositionRoles` replaces exact roles and mirrors the installation's company roles in the same transaction as the HR write. It preserves scopes and credentials, holds the shared ADMIN access lock before positions/users, and keeps the self-access and last-active-ADMIN guards. The `users.roles_managed_by = HR_POSITION` ownership marker blocks manual role edits in `/users/:id`; a bound employee cannot clear the position to escape it. Existing password reset restrictions remain.
4. **Salary changes start next calendar month in Ulaanbaatar**, including a raise obtained by changing position. A new position's initial salary rate is effective this month; later saves upsert next month's rate without rewriting the current/past rows. A new employee's initial salary assignment is effective this month; mapping an existing employee or reassigning one upserts next month's salary assignment, while access changes immediately. Assignment history is the minimum extra history needed so recomputing an earlier draft cannot read today's new position. It is separate from employment dates, which still govern payroll proration.
5. Payroll resolves the salary assignment as of the run month, then the position's salary rate as of that month. No applicable assignment/rate means no position salary entry. Existing genuine individual terms remain the compatibility fallback before that first assignment. `payroll_terms.position_legacy_salary` stays NULL on pre-existing terms and is true for terms explicitly created while unassigned; NULL or true on an existing row preserves the legacy fallback, while newly created position-backed terms are false, so an artificial zero base cannot invent historical payroll. Current/future position pay keeps individual KPI items, social-insurance and active flags; individual fixed salary overrides are rejected while bound.
6. Approved payroll lines remain their immutable snapshots. Position/role/salary changes reach only the relevant later draft computation and never rewrite an approved run. Position salary and assignment history cannot be rewritten once effective. Deferred database guards reject role/ownership/card drift at commit while permitting their atomic replacement.
7. Archiving prevents new assignments; existing staff keep their access and dated salaries. Position roles still prevent deletion of the referenced identity role, even when the position is archived or has no staff.
8. Salary amounts/history are visible only with `hr.payroll.view` or actual ADMIN. HR without payroll view can read positions and preview configured application rights, but position list/staff mutation responses mask pay amounts. The trusted payroll reader has no HTTP authorization bypass.
An ADMIN editing the position they hold may change its name or salary with unchanged role IDs. Changing its role IDs is refused before any writes with an explicit instruction to ask another ADMIN. Generic audit reads also hide historical `payroll_*` before/after payloads and position salary fields without payroll view or actual ADMIN; stored audit rows remain intact.

9. All mutations audit inside the same transaction. Migration `0124_hr_positions` only adds tables/nullable columns and the explicit legacy-terms marker; it infers or updates no existing employee's position, roles or salary.

## Consequences

HR exposes `/hr/positions` and the staff request's `positionId`; its staff rows show the current access position and current/next effective salary metadata. Payroll uses `PositionsService.baseSalariesForUsers` and `salarySchedulesForUsers` through the HR public index. The separate salary assignment dates make immediate access changes compatible with next-month salary changes. Legacy users remain an explicit administrator mapping queue rather than a guessed migration.

Migration 0124 adds a nullable legacy marker without a default, preserving existing terms as NULL. The new column then defaults to false for future inserts. Existing NULL terms retain legacy salary; a normal save records true. Missing terms are never legacy. No existing business row is rewritten.
