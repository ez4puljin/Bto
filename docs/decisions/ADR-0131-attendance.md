# ADR-0131: Attendance from the staff app — punches inside a work site, HR's corrections, the dashboard

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31 «Ажилтны апп дээр ирц бүртгэл байх хэрэгтэй шүү. Ирсэн болон явсангаа дардаг. Гол нь байршил нь ажлын байршил хүрээнд ирсэн явсан нь дарагддаг байх. Ирц тайлан dashboard хэлбэрээр гоё харагддаг байх» and one question round the same day, every proposal accepted: HR keeps named work sites with a radius and assigns them to employees; one company schedule with per-employee changes; every staff member signs in to the staff app, those without a sales or transfer right see the attendance screen alone; HR corrects on the web with an audit trail), Claude (the worker session «Ирц») |
| Amends | ADR-0061 #5 and ADR-0116 #1 (who may use the staff app), architecture §4 (the `hr` module starts with attendance; employees, payroll and the rest stay planned) |

## Context

Staff arrive and leave with nothing recorded; the owner wants each person to press «Ирсэн» and «Явсан» on the phone they already carry for Bto, wants the press to count only when the phone is at the workplace, and wants a dashboard that shows at a glance who is in, who is late and who did not come. The staff app so far let in sales reps (ADR-0061 #5) and store sellers (ADR-0116 #1) only; keepers, cashiers and drivers had no reason to sign in.

## Decision

### 1. Work sites and the geofence

- `hr_work_sites` (migration `0064_hr_attendance`): a name, a point (six decimals, inside Mongolia as the customer addresses), a radius of 30–2000 m (default 150), an optional branch. Kept by `hr.attendance.manage`; archived, never deleted (punches point at it).
- A punch (`POST /hr/attendance/punch`, every signed-in staff member) carries the phone's fix and its accuracy. The server, not the phone, decides: a fix looser than 200 m is refused (`ATTENDANCE_LOCATION_IMPRECISE`); the nearest of the person's sites is found with the shared haversine (`@tugeel/shared/geo distanceMeters`); outside its radius the punch is refused with the site, the distance and the radius (`ATTENDANCE_OUT_OF_RANGE`); with no site at all, `ATTENDANCE_NO_SITE`. The phone shows the same rule live (the nearest site, the distance, the button enabled inside) so a refusal is rare.
- `hr_employee_sites`: the sites one person may punch at; no row = every active site.

### 2. One schedule, the employees' own terms

- `hr_settings` (one row): the day's start and end (`HH:mm`), the grace in minutes (default 10), the workdays as seven flags Monday first (default Monday–Saturday). `hr_employees` holds a person's own start, end, grace and workdays where they differ, and `tracked` (off for staff whose attendance is not counted, the owner). Defaults in `@tugeel/shared/hr DEFAULT_SCHEDULE`.
- Late = the first IN after the start plus the grace, by the minutes over it. A day with no IN on a workday is ABSENT, on a rest day OFF. Worked time pairs each IN with the OUT after it; an IN still open counts up to now on the day itself and nothing on a past day, which the dashboard marks «явсан дараагүй». All of this is `summarizeDay` in `@tugeel/shared/hr`, used by the api, the web and the app alike.

### 3. The punches

- `hr_attendance_events`: IN or OUT at the server's instant, on the Ulaanbaatar date it fell on, with the fix, the site and the distance (source APP) or HR's note (source OFFICE). IN and OUT alternate within a day (`ATTENDANCE_ALREADY_IN`, `ATTENDANCE_NOT_IN`); several pairs a day are fine (a lunch break). One person's punches are written under an advisory lock, so two taps or HR and the phone together cannot cross.
- A punch is never rewritten or removed: the `app` role has `REVOKE UPDATE, DELETE` on the table and `GRANT UPDATE` on the three `deleted_*` columns only. HR strikes a wrong punch out with a reason and types the missing one beside it (`POST /hr/attendance/events`, which must keep the day's turns — `ATTENDANCE_EVENT_ORDER`). Every write leaves an audit row.

### 4. Who sees what

- Every staff member signs in to the staff app (`mayUseApp` is true for staff): a rep lands on the shop, a seller on «Шилжүүлэг», everyone else on «Ирц»; the attendance screen, its month history and the profile are reachable by all. The app shows the person their own day, their month and the sites; nothing about others.
- `hr.attendance.view`: the dashboard (`GET /hr/attendance/dashboard?date`: the counts, one row per tracked active employee, the 14-day trend, the month per employee), the day log (`/hr/attendance/days`, ≤ 62 days) and the events of a day; `hr.attendance.manage`: the sites, the schedule, the employees' terms, the corrections. The HR system role holds both; ADMIN everything. The web pages live under «Харилцагч → Ирц» beside «Ажилтан»: «Ирцийн самбар», «Ирцийн бүртгэл», «Ирцийн тохиргоо».

## Alternatives considered

- **Trusting the phone's own geofence check** and storing a flag: the server would record whatever the client claims; the server computes the distance from the raw fix instead and keeps it.
- **Background location or automatic punches on entering the site**: the staff variant blocks `ACCESS_BACKGROUND_LOCATION` (privacy, battery); the owner asked for a press.
- **A per-branch radius without named sites**: a branch has several places (the wholesale centre, the supermarket, the northern store); named sites with their own radius fit, and the branch stays an optional label.
- **Editing a punch in place**: a corrected time would hide what the phone recorded; a strike-out with a reason plus a typed row keeps both.
- **A nightly job closing forgotten days**: the open IN is a fact of the record; computing «явсан дараагүй» on read needs no job and HR adds the OUT when the person says when they left.

## Consequences

**Positive.** Attendance without a terminal, proved by place; one rule for lateness shared by every screen; the whole staff on the app, which the transfers and the coming modules can build on; a record that cannot be rewritten.

**Negative.** A phone with poor GPS indoors may need the person to step to a window or outside (the screen says so); a person without a phone is typed in by HR. The dashboard computes every row on read (events of ≤ 14 days plus the month for the tracked staff: small for this company; a cached day table comes when it is not). The `hr` module's planned tables (employees, contracts, payroll) are not touched; `hr_employees` is the attendance terms only and is renamed or merged when HR proper is built.

**Follow-ups.** An Excel of the day log; a monthly closing of the attendance for payroll (HR proper, architecture §4 row 11); a per-site default schedule if the stores' hours differ from the centre's.

## Related

ADR-0027 (permissions), ADR-0061, ADR-0116 (the staff app's gate), ADR-0100 (the app's look), ADR-0108 (the dashboard pattern), `docs/modules/hr.md`, `docs/modules/mobile.md`, `docs/ui.md` «Attendance pages».
