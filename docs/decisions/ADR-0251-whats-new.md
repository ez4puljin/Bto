# ADR-0251: «Шинэ өөрчлөлт» — what changed, shown to each person until they have read it

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-26 |
| Deciders | Owner (2026-11-26: «app.puljika.site руу ороход шууд сүүлд хийгдсэн Update changelog монголоор харуулдаг байхаар … Миний уншаагүй update changelog бүр харагддаг байхаар. Би харж амжаагүй байхад олон өөрчлөлт хийгдсэн бол надад бүгд харагддаг байхаар.»), Claude |

## Context

Changes reach the real system minutes after a push (ADR-0204), often several a day from two developers (ADR-0242). The people who use Bto learn of them only by chance. The owner asked that opening Bto shows, in Mongolian, every update they have not read yet, all of them when several came while they were away.

## Decision

1. **One Markdown file per change** in the web's code, `apps/web/src/features/news/content/<YYYY-MM-DD>-<slug>.md`: the date is the day it goes live, the first `# ` line the title, then a few plain Mongolian lines (the guide's renderer and subset, ADR-0214 #3), usually ending with a link to the guide article. The entry ships with the change and reaches the real system with it. Newest first; on one day, the later file name first.
2. **The shell opens a dialog** «Шинэ өөрчлөлт» after sign-in (any page) with every entry this person has not read, newest first. «Ойлголоо», ✕, Escape or «Бүх өөрчлөлтийг харах» mark every shipped entry read. «Систем → Шинэ өөрчлөлтүүд» (`/news`, no right needed) lists them all to read again.
3. **Read is kept per person in the browser** (`localStorage` key `bto.news.read.<user id>`, the list of read entry ids), not in the database: no migration, so this change cannot collide with the migrations other branches hold (0125–0127 on the board that day). The cost: on another computer or browser a person sees the newest entries once more. A set of ids, not a «read up to» mark, so an entry that lands after a newer one is still shown. A browser that never kept anything for that person (a new person, a new PC) shows only the newest five, not the whole history.
4. **Who writes it**: whoever builds a change that people see (a screen, a flow, a rule, a print) adds its entry in the same commit, like the guide's article; the brain names the file in the task's held paths; the second developer adds it in the `in/` branch. Fixes nobody notices, tests, tools and documents need none. The text is for the person who does the work: what is new, where it is in the menu, who can use it.
5. Tests run with the dialog off (`lib/features.ts` `NEWS_DIALOG`, mocked in `src/test/setup.ts`) so it never covers the page a test reads; `news-pages.test.tsx` turns it on.

## Consequences

- No api, schema or right changes; the change is LIGHT for the inbox gate (ADR-0242).
- If people come to use several devices a day and the repeat annoys them, the read list moves to the server in its own migration; the entry files and the dialog stay.
