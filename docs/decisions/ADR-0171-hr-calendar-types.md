# ADR-0171: The calendar's types are HR's own list

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-07 |
| Deciders | Owner («Тохиргоо дотор төрлийн жагсаалт гаргаж өг», «Label = Төрөл»), Claude (the direct-mode session) |
| Amends | ADR-0146 (the calendar's fixed kinds) |
| Migrations | `0088_hr_event_types`, `0089_hr_event_done` |

## Context

ADR-0146 gave an event one of three kinds fixed in code: `EVENT`, `MEETING`, `HOLIDAY`. The old system's calendar lets its users keep their own labels, and the owner wants that calendar's year in Bto with its labels as the types.

Staff apps already installed draw a calendar item from a table keyed by `kind`. A value they do not know throws, and the whole calendar screen falls over, so the response's `kind` cannot simply carry a new word.

## Decision

1. **`hr_event_types` is the list:** a name unique without regard to case, a colour as `#rrggbb` (as on `hr_request_types`), and `kind`. The migration seeds the three old kinds as its first rows with their old colours.
2. **`hr_events.type_id` replaces `hr_events.kind`.**
3. **`kind` on a type is for installed apps only.** The three seeded types keep their own; every type HR adds is `EVENT`. `GET /hr/calendar` still answers `kind` from the fixed set, and adds `typeId`, `typeName` and `typeColor` (null on a birthday and an anniversary). An old app draws a new type as «Үйл явдал» and does not break; the web and the next staff app show its name and colour.
4. **Birthdays and work anniversaries stay outside the list.** The system works them out from the staff records; they are not HR's types to rename or archive.
5. **A type is archived, never deleted.** An archived type leaves the event dialog, takes no new event, and stays on the events that hold it, which can still be edited without changing it. It leaves the legend too, except in a month where it still holds events, because those events are drawn in its colour. A name stays taken while archived: restore the type rather than make a second one.
6. **The list lives on `/hr/setup`, renamed «Хүний нөөцийн тохиргоо».** `hr.attendance.manage` manages it. It is not on `/settings`: the HR role has no `identity.settings.read`, so the people who keep this list could not open it there. The calendar page links to it. Reading the list is open to every signed-in staff member, because the legend needs it.
7. **The old calendar comes through `tools/hr-calendar-carry`**, through Bto's API so the audit is real, from gitignored files under `tmp/hr-calendar-old`. An old note becomes the event's title; an empty note takes the label's name. A gitignored ledger remembers which old label became which type and which old rows came over, so running it again brings only rows new in the old system and leaves what HR has renamed, moved or archived as HR left it. An old row marked done is marked done here at the time of the run, by whoever runs the tool, because the old system kept neither who nor when. The old author is not carried.
8. **The calendar tracks work (owner: «Ажил хянах зорилгоор ашиглана»): an event can be marked done.** `hr_events` keeps `done_at` and `done_by`, set together. Any signed-in staff member marks or unmarks it through `PUT /hr/events/:id/done`, as on the old calendar, because whoever does the work ticks it; who and when are shown and audited. Asking for what already stands changes nothing, so a second tick does not take the first one's name. Editing an event leaves its mark. The web's legend shows each type's done and total for the month.
9. **The calendar is open to every staff member** (owner, 2026-11-07), work notes included. `/hr/calendar` and its menu entry need no right any more, as its API already did, so the module «Хүний нөөц» shows every staff member that one page. Adding, changing and archiving events stays with `hr.attendance.manage`.

## Consequences

- HR adds, renames, recolours and archives types without a release.
- The web's `CALENDAR_MARKS` now colours only birthdays, anniversaries and the home card's heading dot. Events take the type's colour.
- `POST` and `PUT /hr/events` take `typeId` instead of `kind`. Only the web writes them.
- The staff app ticks an event from its next APK. An APK already installed keeps showing the calendar and cannot tick.
- The integration harness truncates every table between suites, so the migration's seeded rows do not exist in a suite: suites make the types they use.

## Alternatives considered

- **Add values to the `kind` CHECK:** still a release per label, and it breaks installed apps on the first new value.
- **Answer `kind` as a free word:** the same crash on installed apps.
- **A tab on `/settings`:** matches the word «Тохиргоо» but locks out the HR role, unless the page's right is widened for one list.

## Related

ADR-0146, ADR-0131, `docs/modules/hr.md`.
