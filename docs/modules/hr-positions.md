# HR positions (ADR-0243)

Migration `0124_hr_positions` adds `hr_positions`, `hr_position_roles`, `hr_position_salaries`, `hr_employee_position_assignments`, nullable `hr_employees.position_id`, identity's nullable `users.roles_managed_by`, and the payroll legacy salary marker. It does not infer mappings from existing text, roles or amounts.

## API

| Route | Access | Body/result |
|---|---|---|
| `GET /hr/positions?includeArchived=true` | HR attendance view/manage or ADMIN | `HrPosition[]` |
| `GET /hr/positions/:id` | same | `HrPosition` |
| `POST /hr/positions` | actual ADMIN | `{ name, baseSalary: string, roleIds: number[] }` → 201 `HrPosition` |
| `PUT /hr/positions/:id` | actual ADMIN | same body → `HrPosition` |
| `PUT /hr/positions/:id/archived` | actual ADMIN | `{ archived: boolean }` → `HrPosition` |

`HrPosition` = `{ id, name, roleIds, roles: {id,code,name,permissions}[], baseSalary, nextBaseSalary, nextEffectiveMonth, salaryHistory: {effectiveMonth,baseSalary}[], archivedAt, employeeCount, grantsAdmin, canAssign }`. Money is a two-decimal string. Without payroll view or ADMIN, monetary fields are null and history is empty. `canAssign` is true only for actual ADMIN and non-archived positions. Only ADMIN registers staff or assigns/moves positions. HR can edit an unchanged staff card without assignment/access writes. All self-position moves, including an ADMIN's, require another ADMIN.

`POST /hr/staff` requires a positive `positionId`. On update it may be omitted to retain the current position. An unassigned legacy employee may remain unassigned; only ADMIN maps them. A bound employee cannot clear `positionId`. Legacy `position` text remains for compatibility and imports; bound readers use the catalog's current label. The staff DTO adds `positionId`, `positionSalaryEffectiveMonth`, `positionBaseSalary`, `positionNextBaseSalary`, `positionNextEffectiveMonth`. Monetary values are masked in every HR staff HTTP response without payroll view/ADMIN.

## Time and access

The current card position grants roles immediately. Salary assignments are dated independently: a new employee starts this month; an existing employee's binding/reassignment starts next month. Repeated changes replace that next-month assignment. Initial catalog salary is this month and edits are next month. Current/past salary/assignment rows are immutable; SQL rejects backdated and arbitrary future writes. Approved payroll snapshots remain unchanged.

`PositionsService.baseSalariesForUsers(executor, userIds, month)` returns a map from user ID to `{ positionId, position, baseSalary, nextBaseSalary, nextEffectiveMonth }`, omitting users without a salary assignment/rate applicable to the target month. `salarySchedulesForUsers` returns `{ current: {positionId,position,baseSalary}|null, next: {positionId,position,baseSalary,effectiveMonth}|null }`; this exposes an upcoming mapping even when current salary remains a legacy individual term. Both use an explicit caller transaction when supplied.

Identity owns role validation/writes through `StaffAccountsService`; HR never writes identity tables. The shared access lock serializes position edits, assignments and identity account edits. A position configuration updates all bound users and company mirrors in one transaction, preserving scopes/passwords. Self-access, ADMIN assignment and last-admin guards apply. `/users/:id` refuses manual `roleIds` writes for a managed account. Deferred SQL checks require the final position, marker and exact role set to agree. Role references are restrictive foreign keys. Archived positions retain existing members' access and salary lookup.

An ADMIN cannot change the role IDs of their own bound position; the API returns an explicit field validation message before any writes. Its name and next-month salary remain editable with unchanged role IDs. The staff form disables position selection for non-ADMIN and self edits, and only ADMIN sees registration.

## Verification

`hr-positions.int-spec.ts`: ADMIN configuration, required registration, existing role IDs and company mirror, password guard, next-month rate upsert, legacy mapping, dated reassignment, ADMIN/self-access, canonical labels and monetary privacy. Existing workforce/directory registration fixtures select explicit catalog positions. `hr-position-guards.spec.ts`: current/past rate/assignment immutability, insert month limits, deferred direct-role drift guards and table truncation refusal. Payroll's position integration suite covers resulting runs and the explicit legacy fallback.
