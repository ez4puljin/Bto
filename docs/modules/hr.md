# hr — attendance and workforce (ADR-0131, ADR-0144)

Status: attendance built 2026-10-31 (branch `claude/hr-attendance`, migration `0064_hr_attendance`). The employee cards, divisions, named schedules, time requests and the time report built 2026-11-04 (ADR-0144, migration `0069_hr_workforce`). Contracts and payroll stay planned (architecture §4 row 11).

## 1. Purpose

Staff press «Ирсэн» and «Явсан» on the staff app; the press counts only inside one of the work sites HR keeps; HR reads a dashboard (who is in, late, absent, who forgot to press «Явсан»), the day log and the month per person, and corrects with a note. The rules the api, the web and the app share live in `@tugeel/shared/hr` and `@tugeel/shared/geo`.

## 2. Owned tables

| Table | What |
|---|---|
| `hr_work_sites` | name (unique among live sites, case-insensitive), `lat` / `lng` NUMERIC(9,6) inside Mongolia, `radius_m` 30–2000 (default 150), `branch_id` NULL, `archived_at`. `REVOKE DELETE, TRUNCATE` from `app` |
| `hr_settings` | one row (`id = 1`): `work_start` / `work_end` `HH:mm`, `grace_minutes` 0–120 (default 10), `workdays` seven 0/1 flags Monday first (default `1111110`). No row = `DEFAULT_SCHEDULE`. `REVOKE DELETE, TRUNCATE` |
| `hr_employees` | per user: `tracked` (default true), own `work_start` / `work_end` / `grace_minutes` / `workdays` (NULL = the company's). No row = the company schedule, tracked. The card (ADR-0144): `first_name`, `last_name`, `position`, `division_id`, `employment_type`, `gender`, `employed_on`, `left_on`, `left_reason`, `photo_file_id`, `schedule_id`, `external_ref` (unique). `REVOKE DELETE, TRUNCATE` |
| `hr_divisions` | name (unique among live ones, case-insensitive), `sort`, `archived_at`. `REVOKE DELETE, TRUNCATE` |
| `hr_schedules` | name, `kind` FIXED / FLEXIBLE, `color`, `days` jsonb (weekday 1–7, start, end, break, minutes), `archived_at`; members are `hr_employees.schedule_id`. `REVOKE DELETE, TRUNCATE` |
| `hr_request_types` | name, `group` (NOT_WORKED, WORKED, OVERTIME, OVERTIME_LEAVE, PUNCH_CHOSEN, PUNCH_SENT, OTHER), `color`, `whole_days`, `active`, `sort`; timely's ten seeded at boot. `REVOKE DELETE, TRUNCATE` |
| `hr_requests` | user, type, `from_date` / `to_date`, `starts_at` / `ends_at`, `punch_kind`, `note`, GPS of a sent punch, `status` PENDING / APPROVED / REJECTED / CANCELLED, `decided_by` / `decided_at` / `decision_note`, `event_id` (the punch an approval wrote), `created_by`. `REVOKE DELETE, TRUNCATE` |
| `hr_employee_sites` | (user, site): the sites a person may punch at; no row = every active site. Rewritten whole on each save |
| `hr_attendance_events` | `kind` IN / OUT, `at` (server instant), `business_date` (Ulaanbaatar), `source` APP (with `lat`, `lng`, `accuracy_m`, `distance_m`, `site_id`, all required) or OFFICE (with `note`), `created_by`, `deleted_at` / `deleted_by` / `delete_reason` (the strike-out). `REVOKE UPDATE, DELETE, TRUNCATE` from `app`; `GRANT UPDATE (deleted_at, deleted_by, delete_reason)`. Indexes (user, date, at) and (date, at) |

## 3. Public services (`modules/hr/index.ts`)

- `WorkSitesService.list(includeArchived) / active() / create / update / setArchived` — HR's sites; `ATTENDANCE_VIEW = 'hr.attendance.view'`, `ATTENDANCE_MANAGE = 'hr.attendance.manage'`.
- `HrSettingsService.schedule() / updateSchedule(ctx, schedule)`; `employees()` (every staff record from identity's `UserNamesService.allStaff()` with its terms and the schedule that applies), `employee(userId)`, `updateEmployee(ctx, userId, terms)`.
- `AttendanceService.punch(ctx, { kind, lat, lng, accuracyM })` (the geofence and the turn, under a per-user advisory lock), `me(ctx)` (today, the sites, the schedule, this month), `myDays(ctx, month)`, `dashboard(date)`, `days({ from, to, userId? })` (≤ 62 days), `events(userId, date)` (struck-out ones included), `addEvent(ctx, { userId, kind, at, note })` (source OFFICE, must keep the day's turns), `strike(ctx, id, reason)`.

- `WorkforceService` (ADR-0144): divisions, `employees()` (the cards with photo URL, division and schedule names), `create` / `update` (through identity's `StaffAccountsService`), `setLeft`, `setPhoto`, schedules (`list`, `save` assigning members, `archive`), the timely import (`importDivisions`, `importEmployees`, `importSchedule`, `tidyImportedSchedules`).
- `RequestsService`: `types` / `saveType`, `list(filter)`, `mine(ctx)`, `pendingCount`, `create(ctx, input)` (own, or anybody's with manage), `decide(ctx, id, …)` (an approved punch writes the event via `AttendanceService.addRequestEventInTx`), `cancel`, `approvedIn(range)`.
- `HrReportsService.days({ from, to, userId?, divisionId? })` (≤ 62 days) and `HrExportsService` (api only: the report and the staff list as Excel).

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

| `GET /hr/divisions?includeArchived=` · `POST /hr/divisions` · `PUT /hr/divisions/:id` · `PUT /hr/divisions/:id/archived` | view / manage | the divisions |
| `GET /hr/staff` · `GET /hr/staff.xlsx` · `POST /hr/staff` (Idempotency-Key, a new phone and a first password) · `PUT /hr/staff/:userId` · `PUT /hr/staff/:userId/left` · `PUT /hr/staff/:userId/password` · `PUT /hr/staff/:userId/photo` | view / manage | the one staff list and the employees' cards (ADR-0145) |
| `GET /hr/schedules` · `POST /hr/schedules` · `PUT /hr/schedules/:id` · `DELETE /hr/schedules/:id` | view / manage | the named schedules |
| `GET /hr/request-types` · `POST /hr/request-types` · `PUT /hr/request-types/:id` | signed-in / manage | the request types |
| `GET /hr/requests?status&userId&typeId&from&to` · `GET /hr/requests/pending-count` | view | HR's list |
| `GET /hr/requests/mine` · `POST /hr/requests` (Idempotency-Key) · `POST /hr/requests/:id/cancel` | signed-in (anybody's with manage) | one's own requests |
| `POST /hr/requests/:id/decision` | manage | approve or reject |
| `GET /hr/reports/days?from&to&userId&divisionId` · `GET /hr/reports/days.xlsx` | view | the time report |

Refusals: `ATTENDANCE_NO_SITE` 409, `ATTENDANCE_OUT_OF_RANGE` 409 (`site`, `distanceM`, `radiusM`), `ATTENDANCE_LOCATION_IMPRECISE` 422 (`accuracyM`), `ATTENDANCE_ALREADY_IN` 409 (`at`), `ATTENDANCE_NOT_IN` 409, `ATTENDANCE_EVENT_ORDER` 409.

| `GET /hr/me/feed` · `GET /hr/me/messages` · `POST /hr/me/messages/read` · `GET /hr/me/polls` · `POST /hr/me/polls/:id/answers` · `PUT /hr/me/mood` · `GET`/`POST /hr/me/feedback` · `GET`/`POST /hr/me/locations` · `GET`/`PUT /hr/me/profile` · `GET /hr/calendar` · `GET`/`POST /hr/thanks` | any signed-in staff | the staff's own side (ADR-0146) |
| `GET`/`POST /hr/messages`, `POST /hr/messages/:id/withdraw` · `GET`/`POST /hr/polls`, `POST /hr/polls/:id/close` · `GET /hr/moods` · `GET /hr/feedback`, `PUT /hr/feedback/:id` · `GET /hr/location-shares` · `POST`/`PUT`/`DELETE /hr/events` · `PUT /hr/staff/:userId/details` · `GET /hr/insights/{workforce,attendance,requests}` | view to read / manage to write | HR's side and the dashboard (ADR-0146) |

## 5. Invariants

1. A punch from the app carries a fix no looser than 200 m and lies within the radius of one of the person's sites; the server computes the distance and stores it.
2. Within a day a person's live events alternate IN, OUT, IN …; HR's typed event must keep that order.
3. A punch is never changed or removed; a strike-out keeps the row and names a reason; every write has an audit row (`hr_attendance_event` PUNCH / CREATE / DELETE, `hr_work_site`, `hr_settings`, `hr_employee`).
4. Late, worked, ABSENT / OFF and the open IN come from `summarizeDay` in `@tugeel/shared/hr`, computed on read; the dashboard, the log, the app and the tests use the same function.
5. A person's week = their named schedule, else their own values over the company's, else the company's; `tracked = false` keeps them off the dashboard's counts but still lets them punch.
6. A request is decided once; an approved punch request writes its event in the same transaction (source REQUEST, the day's turns kept). Leaving disables the staff account and revokes its sessions; the card and the history stay. A closed account is one who left, by whatever path it was closed (`isEmployeeLeft`, ADR-0145). Without `identity.users.manage` a password goes only to an account with no roles, and an admin's name, phone and leaving are refused; the last active ADMIN never leaves.
7. A report day is `reportDay` over `summarizeDay` (`@tugeel/shared/hr`): an approved whole-day leave turns ABSENT into LEAVE, a whole-day trip makes the day AWAY at the plan's hours, overtime adds to the total.

7. The staff's side (ADR-0146): a message or poll with recipients reaches only them; a vote holds one question and a person answers a poll once unless it allows a change; HR reads only the mood's counts; feedback without a name stores no user; a colleague sees a birthday's day, never the year; the dashboard stores nothing.

## 6. Tests

`apps/api/test/integration/hr-attendance.int-spec.ts` (rights; sites; the geofence, the accuracy and the turns; assigned sites and an untracked person; the schedule; the dashboard and the log; corrections and the strike-out; the `app` role's privileges; archiving a site). `apps/api/test/integration/hr-workforce.int-spec.ts` (ADR-0144: divisions, an employee registered with a first password signing in by phone, a weak password refused, a schedule per weekday, requests sent, decided, cancelled, a missed punch written on approval, the report with the leave, leaving and returning, the rights). `packages/shared/src/hr/hr.test.ts` (the day summary, the schedule helpers, the haversine).

## 7. Screens

Web (`apps/web/src/features/hr/`, `docs/ui.md` «Attendance pages»), the top-bar module «Хүний нөөц» (ADR-0144): «Ажилтан» group — «Ажилтны бүртгэл» `/hr/staff` (the one staff list, ADR-0145; a row opens `/hr/staff/:id` with the card, the password reset, the roles and scopes, the devices; `/users` redirects here), «Алба хэлтэс» `/hr/divisions`, «Цагийн хуваарь» `/hr/schedules`, «Цагийн хүсэлт» `/hr/requests`; «Ирц» group — «Ирцийн самбар» `/hr/attendance`, «Цагийн тайлан» `/hr/report`, «Ирцийн бүртгэл» `/hr/attendance/days`, «Ирцийн тохиргоо» `/hr/setup`. Staff app (`docs/modules/mobile.md`): «Ирц» (`/attendance`) and «Миний ирц» (`/attendance/history`), «Цагийн хүсэлт» (`/attendance/requests`, ADR-0144); every staff member signs in since 0.11.0.

ADR-0146 adds, under «Хүний нөөц»: «Нүүр хуудас» `/hr/home`, «Хянах самбар» `/hr/insights`, «Үйл явдлын календарь» `/hr/calendar`, «Мэдэгдэл» `/hr/notices`, «Мэдээ» `/hr/news`, «Санал хураалт» `/hr/polls`, «Судалгаа» `/hr/surveys`, «Санал хүсэлт» `/hr/feedback`, «Илгээсэн байршил» `/hr/shares`, «Ажлын байршил» `/hr/sites`; the staff app's «Хамт олон» (`/community`).

## 8. The timely.mn import

`pnpm hr:import-timely -- --file tmp/timely/export.json --photos tmp/timely/photos` with `HR_IMPORT_PASSWORD` set for the first password (never an argument, never printed); the export sits in the gitignored `tmp/timely/`. Idempotent by `external_ref` (`timely:<id>`), else by phone. Ran on bto_main 2026-11-04: 40 employees (5 photos), 7 divisions, 9 schedules with 24 members, the work site «Бүтэн-Оргил».
