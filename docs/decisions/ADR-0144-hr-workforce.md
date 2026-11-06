# ADR-0144: HR beyond the punch — employee cards, divisions, schedules, time requests and the time report, like timely.mn

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-04 |
| Deciders | Owner («ажилтан болон ирц бүртгэ, цагийн хуваарь, цагийн хүсэлтийн талаар судалж bto систем дээр хий. Харагдах байдлыг ингэж хий» with admin.timely.mn, «ажилчдын мэдээллийг авч bto систем дээр бүртгэл үүсгэ. profile зургийн хамт»; then: employees are users who sign in to Bto at once with the given first password, history starts fresh, everything in one go, 2026-11-04), Claude (the direct-mode session) |
| Amends | ADR-0131 #3 (one company schedule with per-employee terms: a named schedule now comes first) |

## Context

The company keeps its staff, schedules and time requests in timely.mn. Bto has had attendance since ADR-0131 (sites, punches, one company schedule, the dashboard and the day log). The owner wants the rest of timely's employee side in Bto, with timely's look, and the 40 employees moved over with their photos.

## Decision

1. **The employee card on `hr_employees`** (migration `0069_hr_workforce`): first and last name, position, division, employment type (PERMANENT, PROBATION, CONTRACT, PART_TIME, INTERN), gender, employed / left date and reason, photo (`hr.employee_photo`, public, ≤ 1 MB, cut square in the browser), schedule, `external_ref` (unique; `timely:<id>` for the import). The account stays identity's: `StaffAccountsService` (identity) creates the staff user who signs in by phone (ADR-0128) with a first password, renames, sets a new password and disables or enables; leaving disables the account and revokes its sessions, returning enables it. Roles are still given on «Систем → Ажилтан».
2. **Divisions** `hr_divisions` (name unique among live ones, sort, archived).
3. **Named schedules** `hr_schedules`: FIXED (start, end, break per weekday) or FLEXIBLE (hours per weekday), a colour, the members (each employee follows at most one). A person's week: their schedule, else their own hours (ADR-0131), else the company's. `scheduleOnDate` and `planOfSchedule` in `@tugeel/shared/hr` feed `summarizeDay`, so the dashboard, the day log and the app follow the same week. Removing a schedule archives it; its people go back to the company's hours.
4. **Time requests** `hr_request_types` (timely's ten seeded: leave, annual leave, sick, trip, remote, online work, overtime, overtime leave, a missed punch chosen, a punch sent from afar; each with a report group, a colour, whole days or hours, active) and `hr_requests` (the employee, the type, from–to dates or the hours of one day or the punch's kind and moment, a note, the GPS of a sent punch; PENDING → APPROVED / REJECTED by HR with a note, or CANCELLED by the sender). An approved punch request writes the attendance event with source REQUEST (keeping the day's turns). Any staff member sends their own (web or app); HR (`hr.attendance.manage`) sends one for anybody and decides.
5. **The time report** `GET /hr/reports/days` (≤ 62 days, by division or employee): each tracked employee's day — the plan, the first in and last out, arrival and departure against the plan, worked (inside the plan and in all), late, early leave, overtime, the status with the approved requests over it (`reportDay`: LEAVE, AWAY, …) — and the period's totals; the web pivots it into «Өдрөөр», «Ажилтнаар» and «Ерөнхий» (letters per day). Excel: the report's days and the employees' list.
6. **Screens.** A top-bar module «Хүний нөөц» (ADR-0114) holds «Ажилтан» (the card list with photos and the pending requests on top, «Ажлаас гарсан ажилтнууд», «Excel экспорт», «Ажилтан нэмэх»), «Алба хэлтэс», «Цагийн хуваарь» (a month calendar of the schedules, the list of their weeks, the count of those without one), «Цагийн хүсэлт» (filters, approve / reject, a request for someone, the types), and the attendance pages with «Цагийн тайлан». The staff app gets «Цагийн хүсэлт» under «Ирц».
7. **The import from timely.mn.** `pnpm hr:import-timely -- --file tmp/timely/export.json --photos tmp/timely/photos` reads a file the owner's browser session exported (gitignored `tmp/timely/`): divisions, employees with photos (no register numbers), schedules, the location as a work site (radius at least 30 m). The first password comes only from `HR_IMPORT_PASSWORD` at run time. It is idempotent by `external_ref`, else by phone; repeated schedule copies are archived. History is not copied: Bto's attendance starts on the import day.

## Consequences

**Positive.** The company's staff, schedules and requests live where the punches are; the report counts leave and trips instead of showing them absent; every employee can sign in to the staff app.

**Negative.** Everyone imported shares the same first password until they change it; the imported employees have no roles until the owner gives them. Payroll still reads nothing from here.

## Related

ADR-0027, ADR-0114, ADR-0128, ADR-0131, docs/modules/hr.md, docs/modules/mobile.md.
