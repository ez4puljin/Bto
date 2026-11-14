# ADR-0197: Which screens are used: counts per day, client and screen, and nothing more

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-14 |
| Deciders | Owner (2026-11-13: «Хэрэглэгчдэд ойлгомжтой, ухаалаг UI/UX» among the four areas to assess, the measuring of screens agreed as its first step; 2026-11-14 «үргэлжлүүл»), Claude (the direct-mode session) |
| Amends | ADR-0040 (identity's housekeeping drops two more kinds of rows), ADR-0192 (one more route of the stores' app on the app replicas) |

## Context

The office web has about 175 routes and 100 menu entries, the staff app about 50 screens, «Bto300» about 20. Which of them carry the work, and which nobody opens, is not known: every decision about the interface so far (what goes on «Нүүр», what gets a shortcut, what is simplified) rests on what the owner and the people around him remember. The audit log says what was changed, not what was looked at, and it cannot answer «how many people open this page».

Making the interface «clear and smart» without that is guessing. The cheapest fact that removes most of the guessing is a count: this screen, this many opens, this many people, this long at a time.

## Decision

1. **A client counts for itself and sends once a minute.** `UsageMeter` (`@tugeel/shared/usage`) knows the screen in front, since when, and what gathered since the last send; the client tells it when a screen comes in front, when the window or the app goes out of sight and comes back, and takes the counts every 60 s and when it goes out of sight. A send is `{ app, events: [{ screen, opens, seconds }] }`, at most 60 screens.
2. **Only a screen's name leaves the device.** The web's name is its address with every parameter put back as its name (`/catalog/products/:id`; `screenKeyFromPath`), the apps' is the route as it was written (`/order/:id`; `screenKeyFromSegments`, without the group folders). A bare number or a long opaque segment is never part of a name, the address's query never is, and nothing on the screen is read. The api accepts only names of that shape (`^/[a-z0-9:_/-]*$`, 120 characters).
3. **What is kept is a count** (`screen_usage`, migration `0102_screen_usage`, owned by `identity`): one row per day (Ulaanbaatar), client (`web`, `staff`, `customer`) and screen, with `opens` and `seconds`. No person, no hour.
4. **«How many people» needs one mark per person**, and that is all that is kept per person (`screen_usage_seen`: day, client, screen, `actor` = `s<user id>` or `c<customer id>`). It answers how many, is shown only as a number, and the housekeeping drops it after 120 days; the counts stay 400 days, for a year's comparison.
5. **A forgotten tab is not use.** Time stops while the window or the app is out of sight, and one open counts at most 10 minutes (`USAGE.maxSecondsPerOpen`), in the meter and again on the server.
6. **Counting never troubles what it counts.** A send is answered 204 whatever it held; a send that fails is dropped, never retried and never shown; the apps' gate renders nothing and waits for nothing. Two upserts per send. A send that arrives twice is counted twice: exactness is not worth an idempotency key a minute.
7. **Routes.** `POST /api/v1/usage/screens` (any signed-in staff member; the web and the staff app; a staff token cannot count for `customer`), `POST /api/v1/customer-app/usage/screens` (a customer token; always counted as `customer`; with the other app routes on the app replicas, ADR-0192), `GET /api/v1/usage/screens?from&to` (`identity.audit.read`): per client and screen the opens, the seconds and the people, the busiest first.
8. **On screen**: «Систем → Дэлгэцийн хэрэглээ» (`/system/usage`, `identity.audit.read`): the last 7, 30 or 90 days; per client a table (screen with the menu's own name, opens, people, time per open, share), and «Нэг ч удаа нээгээгүй цэс»: the entries of the web's menu under which no screen was opened.
9. **No new right and no setting.** Who may read the audit may read this, which says less. The counting cannot be switched off per user: it holds nothing a user could want withheld, and a count with holes misleads.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| An analytics service (PostHog, Plausible, Google Analytics) | Screen names and staff identifiers of a company's ERP sent abroad, a second system to run or pay for, and far more than a count is collected by default. |
| Count from the api's request log | Says which routes were called, not which screen was in front or for how long; one screen calls ten routes, a cached screen none. |
| One row per open, with the user and the time | It becomes a record of what each employee did each minute. The question is what to improve, not who works; the mark per day and screen answers «how many people» and nothing finer. |
| Session recording, clicks, heat maps | Shows what was on the screen: customers' debts, prices, salaries. |
| Count on the server from the page's own data calls | Every page would need a marker; a page that renders from cache would not count. |
| A new permission | The figures are less than the audit log's; one more right is one more thing to grant wrongly. |

## Consequences

**Positive.** After a month the owner can see which ten screens are the work (and deserve the shortcuts and the care), which menu entries nobody opens (and can leave the menu), and whether a new screen is used at all. The same figures say whether a redesign helped: opens up, time per open down.

**Negative.** The apps count only from the build that carries the gate: phones on an older APK send nothing, so the first weeks under-count them. A send lost to a dead network is lost. «People» over a period longer than 120 days counts only the days whose marks are still kept. The apps' screens are shown by their route (`/order/:id`), not by a Mongolian name. A screen opened inside a dialog or a sheet without a route of its own is not seen.

**Follow-ups.**
- Mongolian names for the apps' screens.
- «Нүүр» ordered by what its user opens most.
- Where people give up: a form opened and left without a save (needs one more event, not more data).
- Search words that found nothing (the command palette, the apps' product search).

## Related

ADR-0040, ADR-0042, ADR-0114, ADR-0192, `packages/shared/src/usage/`, `apps/api/src/modules/identity/` (`schema.ts`, `services/usage.service.ts`, `controllers/usage.controller.ts`, `services/housekeeping.service.ts`), `apps/web/src/features/system/` (`use-screen-usage.ts`, `usage-page.tsx`), `apps/mobile/src/usage/usage-gate.tsx`, `docs/modules/identity.md`.
