# hr — attendance (ADR-0131)

Status: attendance built 2026-10-31 (branch `claude/hr-attendance`, migration `0064_hr_attendance`). Employees, contracts, leave and payroll stay planned (architecture §4 row 11).

## 1. Purpose

Staff press «Ирсэн» and «Явсан» on the staff app; the press counts only inside one of the work sites HR keeps; HR reads a dashboard (who is in, late, absent, who forgot to press «Явсан»), the day log and the month per person, and corrects with a note. The rules the api, the web and the app share live in `@tugeel/shared/hr` and `@tugeel/shared/geo`.

## 2. Owned tables

| Table | What |
|---|---|
| `hr_work_sites` | name (unique among live sites, case-insensitive), `lat` / `lng` NUMERIC(9,6) inside Mongolia, `radius_m` 30–2000 (default 150), `branch_id` NULL, `archived_at`. `REVOKE DELETE, TRUNCATE` from `app` |
| `hr_settings` | one row (`id = 1`): `work_start` / `work_end` `HH:mm`, `grace_minutes` 0–120 (default 10), `workdays` seven 0/1 flags Monday first (default `1111110`). No row = `DEFAULT_SCHEDULE`. `REVOKE DELETE, TRUNCATE` |
| `hr_employees` | per user: `tracked` (default true), own `work_start` / `work_end` / `grace_minutes` / `workdays` (NULL = the company's). No row = the company schedule, tracked. `REVOKE DELETE, TRUNCATE` |
| `hr_employee_sites` | (user, site): the sites a person may punch at; no row = every active site. Rewritten whole on each save |
| `hr_attendance_events` | `kind` IN / OUT, `at` (server instant), `business_date` (Ulaanbaatar), `source` APP (with `lat`, `lng`, `accuracy_m`, `distance_m`, `site_id`, all required) or OFFICE (with `note`), `created_by`, `deleted_at` / `deleted_by` / `delete_reason` (the strike-out). `REVOKE UPDATE, DELETE, TRUNCATE` from `app`; `GRANT UPDATE (deleted_at, deleted_by, delete_reason)`. Indexes (user, date, at) and (date, at) |

## 3. Public services (`modules/hr/index.ts`)

- `WorkSitesService.list(includeArchived) / active() / create / update / setArchived` — HR's sites; `ATTENDANCE_VIEW = 'hr.attendance.view'`, `ATTENDANCE_MANAGE = 'hr.attendance.manage'`.
- `HrSettingsService.schedule() / updateSchedule(ctx, schedule)`; `employees()` (every staff record from identity's `UserNamesService.allStaff()` with its terms and the schedule that applies), `employee(userId)`, `updateEmployee(ctx, userId, terms)`.
- `AttendanceService.punch(ctx, { kind, lat, lng, accuracyM })` (the geofence and the turn, under a per-user advisory lock), `me(ctx)` (today, the sites, the schedule, this month), `myDays(ctx, month)`, `dashboard(date)`, `days({ from, to, userId? })` (≤ 62 days), `events(userId, date)` (struck-out ones included), `addEvent(ctx, { userId, kind, at, note })` (source OFFICE, must keep the day's turns), `strike(ctx, id, reason)`.

Nobody imports hr; the composition root mounts `HrHttpModule`.

## 4. REST

| Route | Right | What |
|---|---|---|
| `GET /hr/work-sites?includeArchived=` · `POST /hr/work-sites` · `PUT /hr/work-sites/:id` · `PUT /hr/work-sites/:id/archived` | view / manage | the sites |
| `GET /hr/schedule` · `PUT /hr/schedule` | view / manage | the company schedule |
| `GET /hr/employees` · `PUT /hr/employees/:userId` | view / manage | the employees' terms and sites |
| `GET /hr/attendance/me` · `GET /hr/attendance/me/days?month=` · `POST /hr/attendance/punch` | any signed-in staff | the app's screen |
| `GET /hr/attendance/dashboard?date=` · `GET /hr/attendance/days?from&to&userId?` · `GET /hr/attendance/events?userId&date` | view | the dashboard and the log |
| `POST /hr/attendance/events` · `DELETE /hr/attendance/events/:id` (body `reason`) | manage | HR's corrections |

Refusals: `ATTENDANCE_NO_SITE` 409, `ATTENDANCE_OUT_OF_RANGE` 409 (`site`, `distanceM`, `radiusM`), `ATTENDANCE_LOCATION_IMPRECISE` 422 (`accuracyM`), `ATTENDANCE_ALREADY_IN` 409 (`at`), `ATTENDANCE_NOT_IN` 409, `ATTENDANCE_EVENT_ORDER` 409.

## 5. Invariants

1. A punch from the app carries a fix no looser than 200 m and lies within the radius of one of the person's sites; the server computes the distance and stores it.
2. Within a day a person's live events alternate IN, OUT, IN …; HR's typed event must keep that order.
3. A punch is never changed or removed; a strike-out keeps the row and names a reason; every write has an audit row (`hr_attendance_event` PUNCH / CREATE / DELETE, `hr_work_site`, `hr_settings`, `hr_employee`).
4. Late, worked, ABSENT / OFF and the open IN come from `summarizeDay` in `@tugeel/shared/hr`, computed on read; the dashboard, the log, the app and the tests use the same function.
5. A person's schedule = the company's with their own values over it; `tracked = false` keeps them off the dashboard's counts but still lets them punch.

## 6. Tests

`apps/api/test/integration/hr-attendance.int-spec.ts` (rights; sites; the geofence, the accuracy and the turns; assigned sites and an untracked person; the schedule; the dashboard and the log; corrections and the strike-out; the `app` role's privileges; archiving a site). `packages/shared/src/hr/hr.test.ts` (the day summary, the schedule helpers, the haversine).

## 7. Screens

Web (`apps/web/src/features/hr/`, `docs/ui.md` «Attendance pages»): «Ирцийн самбар» `/hr/attendance`, «Ирцийн бүртгэл» `/hr/attendance/days`, «Ирцийн тохиргоо» `/hr/setup` under «Харилцагч → Ирц». Staff app (`docs/modules/mobile.md`): «Ирц» (`/attendance`) and «Миний ирц» (`/attendance/history`); every staff member signs in since 0.11.0.
