# ADR-0146: The staff's own side and the HR dashboard — notices, votes, surveys, mood, feedback, thanks, a calendar and a map, after timely.mn's home and dashboard

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-05 |
| Deciders | Owner («https://admin.timely.mn/dashboard болон https://admin.timely.mn/home дээр байгаа дутуу зүйлсийг бүгдийн нэм. … Ажилтны апп руу notication, судалгаа, санал хураалга гэх мэт зүйлс хийх боломжтой байх. Энэ сарын үйл явдлууд календар хөтлөдөг байх. Бүх ажилчдын апп харагддаг байх. Ажлын байршилыг газрын зураг дээр хардаг байх. … хүйс, Төрсөн өдрийн мэдээлэл, Ажилласан хугацааны тархалт, Ажилтны хүүхдүүдийн мэдээлэл гэх мэт зүйлсийг нэм. Dashboard график мэргэжлийн түвшинд animation хөдөлгөөнтэй зэрэг гаргадаг хамгийн шилдэг tech ашиглаарай», 2026-11-05), Claude (the direct-mode session) |
| Amends | ADR-0144 (the employee card gets more fields), ADR-0108 (Recharts stays for the reports; the HR dashboards draw with ECharts) |

## Context

ADR-0144 moved timely's employees, schedules and time requests to Bto. Timely's home page and dashboard still hold what the staff and HR look at daily. Its «Ирц» and «Хүсэлт» dashboards are Premium demonstrations with sample figures and its «Цалин» tab is empty, so only their structure is followed, on Bto's own data.

## Decision

1. **Migration `0070_hr_engagement`**, all in module `hr`, which depends on identity alone. The staff's messages stay out of module `notifications` (its notices go to reps and customers with product links; `hr` may not import it).
2. **Notices and news** `hr_messages`: to everybody or to chosen people (`hr_message_recipients`), published now or at a moment, withdrawn and never deleted, with who read them (`hr_message_reads`). A notice pops up when the staff app opens. There is no push: a closed app learns on its next opening.
3. **Votes and surveys** `hr_polls`: a vote is one question, a survey several (`SINGLE`, `MULTI`, `TEXT`, `SCALE` 1–5). Settings: show the results after answering, allow changing the answer, anonymous. Anonymous means the screens name nobody; a row keeps its user so that a person answers once. An answer is written whole; a required question may not be skipped.
4. **An employee's details**, kept by themselves from the staff app or by HR: birth date, gender, education, marital status, district, children (`hr_employee_children`). HR alone sets the job level, and the left reason's kind when marking someone as left. They are not copied from timely, where almost nothing is filled in; the dashboard names what is still empty. The audit records that details were saved, not the dates.
5. **The dashboard** `/hr/insights` (`hr.attendance.view`), worked out on each request and stored nowhere (`HrInsightsService`): the people (totals against the previous equal period, division × level, tenure, education, age × gender, gender, district, marital status, children, joined and left per month, left reasons), attendance (planned against worked, per division and person, average arrival and departure, the year's trend; ≤ 62 days as the report) and requests (types, senders, months, statuses). The history starts on the import day (ADR-0144 #7), so earlier months read empty.
6. **The calendar and the map.** `GET /hr/calendar` is open to every staff member: HR's events (`hr_events`), birthdays and work anniversaries of those still employed. A birthday shows the day only, never the year or the age. «Ажлын байршил» `/hr/sites` shows the work sites with their radii on MapLibre with OpenFreeMap's streets, no key and no account, as the staff app's map (ADR-0068). No satellite view: the free imagery services' terms do not cover this use, and the owner dropped satellite in the app. `deploy/Caddyfile` opens `connect-src` to the tile host.
7. **Charts: Apache ECharts** 6.1.0 for these dashboards, canvas, in a chunk loaded with the first chart. Chosen over staying on Recharts for the owner's animated, professional look: entry animations per mark, values moving between states on a new filter, plus heatmap, radar and gauge, which Recharts lacks or draws poorly. `prefers-reduced-motion` is honoured, each chart keeps its figures in the page for screen readers, and colours come from tokens: `--series-1…5`, checked for colour blindness in that order. Recharts stays in the reports; a later session may move them.
8. **Mood, feedback, thanks, a sent location.** HR reads only the counts of the mood. Feedback sent without a name stores no user, so its sender cannot read it back. Thanks are read by everybody. A sent location goes to HR only. Every write here is the person's own; only HR writes for others.

Not built, on purpose: timely's «Ажлын тайлан», «ХАБ», «Онлайн шалгалт» and «Гэрээ» (none is on the two pages asked for), the annual leave balance (Bto holds no entitlement yet), and payroll figures (ADR-0144 keeps payroll apart; the accountant reviews its tables first).

## Consequences

**Positive.** One place for the staff's daily exchange; HR sees its people at a glance; the app reaches every employee, not only the reps.

**Negative.** A second chart library in the web bundle, loaded only on these pages. Dashboards stay thin until the staff fill in their details. Anonymous answers are anonymous by screen, not against whoever reads the database.

## Related

ADR-0068, ADR-0108, ADR-0131, ADR-0144, ADR-0145, docs/modules/hr.md, docs/modules/mobile.md.
