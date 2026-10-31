# ADR-0128: Staff sign in by their registered phone; the login name is internal; the staff list by role and status; the branch scope hidden in a one-branch installation

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-31 |
| Deciders | Owner (the request of 2026-10-31 from the «Ажилтан бүртгэх» dialog and one question round, every recommended answer taken; the standing instruction relayed by «Bto удирдлага»: build on the recommended answers, ask only for a business unknown), Claude (Claude Code session) |
| Amends | ADR-0027 #9 (the password may not equal the phone either; the limiter keys on the typed identifier), ADR-0027 (`/auth/login` and `/auth/password/setup` take `login`), ADR-0061 #4 (`/auth/mobile/login` likewise), ADR-0079 #3 (unchanged: the customer app's phone sign-in is the model this follows) |
| Migration | `0063_staff_phone_login` |

## Context

The owner, registering staff in «Ажилтан бүртгэх» on 2026-10-31: «Ажилтны бүртгэл дээр нэвтрэх нэр гэж байхгүй, бүртгэлтэй дугаараар нууц үгээ хийж ордог байхаар хий. Дүрээр ангилал хийж харуулдаг болго. Төлөвөөр шүүж хардаг болго. Салбар гэдэг ойлголт юун дээр ашиглаж байгааг тайлбарла.» A keeper, a seller or a rep knows their phone; a login name invented by the admin is one more thing to write on paper and forget. The customer app already signs stores in by phone (ADR-0079 #3), so the phone normalisation, the limiter keyed by phone and the uniform 401 exist.

Facts on `bto_main` (2026-10-31): one ACTIVE branch (`MAIN · Оргил Бөөний төв`), seven staff records, none with a phone (the seeded test logins `import`, `menejer`, `nyarav1`, `nyarav2`, `nyagtlan`, `khudaldagch`), no branch-wide write scope. `users.username` is read by the audit (`actor_username`), the kiosk's cashier list, the AI guard's test query, the profit report's rep code and the CLI.

What «Салбар» does today: a branch is one place of one legal entity and owns warehouses (TRANSIT excepted); a write scope may name a branch, meaning every warehouse of it (`access.service.ts`); boards may belong to a branch; every finance POST and voucher is tagged with the branch, and the Finance Core mirrors ACTIVE branches into `fin.branches` (ADR-0084 #1); the e-Barimt branch number lives on it. One installation books into one company, and Kharkhorin is its own installation (ADR-0084), so this installation has one branch and «Салбараар» says nothing that «every warehouse» does not.

## Decision

1. **The sign-in identifier is the registered phone.** `POST /auth/login`, `POST /auth/mobile/login` and `POST /auth/password/setup` take `login`: the staff member's phone in any local form (`normalizeMnPhone`, E.164 `+976` + 8 digits), or, for a record that has no phone yet, its login name. A value that normalises to a phone is matched against `users.phone`; anything else is matched against `users.username` **only where `phone IS NULL`**: once the admin registers a phone, the phone is the only way in. Wrong phone, unknown phone and wrong password answer the same 401 `INVALID_CREDENTIALS` (ADR-0027 #9 holds); the login limiter and the account lock key on the normalised identifier (`parseStaffLogin` in `@tugeel/shared/auth`). The older field `username` is accepted as a deprecated alias of `login` (one of the two is required), so the staff APK installed before this change keeps signing in.
2. **`users.username` stays, internal.** A registration generates it from the phone: `p` + the 8 digits (`usernameFromPhone`; a clash with an older typed name takes `-1`, `-2`, …), inside `USERNAME_PATTERN`. It is never typed and never shown on a staff screen (the list, the detail, the account page, the top bar, the app's profile show the phone); the audit's `actor_username`, `MeDto.username`, the kiosk (user id + PIN, untouched), the AI guard's query and the profit report's rep code keep working. `MeDto`, `UserSummary` and the POS cashier carry `phone`.
3. **One phone, one account.** Migration `0063_staff_phone_login`: `users_phone_key`, a unique index on `phone WHERE phone IS NOT NULL`. A registration requires a phone (422 `VALIDATION_FAILED`, path `phone`, constraint `required` / `isNotEmpty` / `isMnPhone`) and refuses a registered one with constraint `unique` («Энэ утас өөр ажилтанд бүртгэлтэй байна»); the index is the last line of defence (409 `DUPLICATE_VALUE`). An edit may change the phone (the same uniqueness check, the record itself excepted), never clear it. The CLI `pnpm user:create-admin --phone <8 digits> --full-name "<name>"` creates or recovers the admin by phone; `--username <name>` still recovers an admin registered before this ADR.
4. **Records without a phone keep working.** No backfill: the seven existing records sign in by their login name until an admin writes the phone on `/users/:id` («Засах»). The staff list and the detail page flag them («Утас бүртгээгүй») and the detail page says what to do. The login page's hint says the same to the person signing in.
5. **The password may not be the phone** (`SAME_AS_PHONE`, in any written form), beside `SAME_AS_USERNAME` (ADR-0027 #9); the api is authoritative, the web forms show it at once.
6. **The staff list is grouped by role and filtered by status.** One section per role in the roles' order, a person with two roles under each of them, people without a role last under «Дүргүй»; the status segments Идэвхтэй (default) / Идэвхгүй / Бүгд in the URL (`?status=`), the search (name, phone, login name) kept. The grouping happens in the browser from the loaded pages (100 a page; «load more» stays): an installation's staff fits a page.
7. **«Салбараар» appears only when the installation has two or more branches**, with a hint that says what a branch scope means (every current and future warehouse of that branch). The concept stays: boards, finance documents, the Finance Core's branch mirror and the e-Barimt branch number keep their branch; a second place of this ХХК would appear as a second branch and the scope would show again.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Dropping `users.username` | Six readers across audit, kiosk, AI, reporting and the CLI for no gain; the owner's wish is that nobody types or sees it, which the generated internal value gives. |
| Letting a record with a phone also sign in by login name | Two identifiers per person for ever; the owner said there is no login name. The alias field (`username` in the body) is a wire-compatibility measure for the installed app, not a second identifier. |
| Backfilling phones in the migration | Nobody but the owner knows the staff's phones; a wrong phone would lock a person out. The admin writes them, the flag shows where. |
| Two accounts for one person with two roles | One record holds any number of roles already; a second account per phone would double the audit trail and the password codes. |
| A role filter instead of sections | The owner asked for a view «by role»; the sections show every role's people at once, the status segments narrow them. |
| Hiding «Салбараар» for good | A second place of this legal entity is possible; the scope costs nothing while hidden. |

## Consequences

**Positive.** A staff member signs in with what they know; the admin registers name and phone only; a duplicate phone is refused with a readable message; the list reads by job.

**Negative.** Until the admin writes the phones, the existing records keep their login names, and the login page carries a hint for them. The staff app shows the phone where it showed the login name; its sign-in field reads «Утасны дугаар» but still takes a login name for a record without a phone.

**Follow-ups.** The owner writes the phones of the seven existing records on `/users/:id` on `bto_main`, then the hint on the login page can go (a light change). The staff app's next APK sends `login`; until then the deprecated `username` field keeps it working.

## Related

ADR-0027, ADR-0061, ADR-0079, ADR-0084, `docs/modules/identity.md`, `docs/ui.md`.
