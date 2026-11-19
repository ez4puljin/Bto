# ADR-0228: e-Barimt's purchase receipts pulled by the API

|           |                                                                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Accepted                                                                                                                                |
| Date      | 2026-11-20                                                                                                                              |
| Deciders  | Owner (2026-11-20, through the brain's brief), Claude (the brain's session; the worker `bto-core`)                                      |
| Amends    | ADR-0168 (a month's e-Barimt file now comes from an upload or from the API), ADR-0170 #5 (the file is read in the request; a pull is a flow) |

## Context

«Санхүү → Ebarimt» (ADR-0168) compares a month's posted goods receipts with what the suppliers entered into e-Barimt. Until now the e-Barimt side came only from the monthly Excel export «EBARIMT Падаан (Худалдан авалт)» that staff download from e-invoice.ebarimt.mn by hand and upload. Late receipts make them do it again and again.

The tax authority publishes a service for exactly this, «Толгой татвар төлөгч өөрийн охин компанийн худалдан авалт татах сервис» (developer.itc.gov.mn, `POST /api/tpi/receipt/getSaleListERP`): with an empty `subPin` it lists the company's own purchase receipts for a span of days, with ДДТД, the seller's register and name, the date, VAT, city tax, net and total, and the receipt's type. It wants an OAuth2 token from the authority's realm (password grant, client `vatps`) and an `X-API-KEY`. The key and the production sign-in are given only on an official letter to the tax authority's taxpayer service; a staging environment with public test values is open now. A sign-in to etax.mta.mn is not such a key and is not used.

Facts that shape the design (the study of 2026-11-20 and the portal's own example):

- The service has no paging; a third-party project pulls a week at a time.
- The authority's sister services answer production calls only between 01:00 and 07:00 Ulaanbaatar time; this one is assumed to as well.
- Amounts come as JSON numbers with up to six decimals (`252.272727`).
- The portal's example hides part of the seller's register and name with stars (`57***85`, `ГУР*****МБА`). Whether real answers do is not known until the first real call.
- No delivery-note number comes, so a line's key is its ДДТД (else the day, the register and the total), as for a file's line without one.

## Decision

1. **The connection is typed on the Ebarimt page** (right `ebarimt.check.settings`), beside the accounts that count, in one row `ebarimt_check_connection`: the environment (`STAGING` / `PRODUCTION`), the user name, the password, the key, the company's register (`pin`, prefilled on the page from «Компани» when Bto has it) and a nightly switch (default off). The password and the key are sealed under `ERKHET_KEY_SECRET` with their own contexts (`ebarimt_check_connection.password`, `.api_key`), as erxes's and WeSend's are; they never go into a response, an audit row or a log, and the page shows «хадгалсан». Changing the environment forgets both, so the real key never goes to the test system or back. When the letter's answer comes, only these settings change.
2. **A pull writes a month's file the way an upload does.** `ebarimt_check_files` gets `source` (`FILE` | `API`, default `FILE`) and `file_id` becomes nullable: an API file has no stored object (`(source = 'FILE') = (file_id IS NOT NULL)`) and no download. Lines map prPosRno → ДДТД, regNo → ТТД, name → «Харилцагчийн нэр», date → «Огноо», amountVat → НӨАТ, amountNet → «Цэвэр дүн», amountTotal → «Нийт дүн», receiptType (else fromType) → «Төрөл»; no «Падаан №». Amounts are read from the answer's text into Decimal (JSON.parse's source text), never through a float, and rounded to two decimals half up per line. A line of another month or with no register is left out; a receipt listed twice is one line. The `receipt_key` rule stays.
3. **A pull becomes the month's ACTIVE file only when its lines differ** from the file in force (every field but the line's place), so an unchanged night adds no file and no history row. A pull that finds no receipt writes nothing: an empty answer never takes a month's receipts away. An Excel upload still works and still replaces; the newest wins either way. A pull and an upload of the same month take turns on the month's advisory lock.
4. **Every night at 01:30 Ulaanbaatar time** (pg-boss `ebarimtcheck.pull`, inside the 01:00–07:00 window), when the switch is on: this month up to yesterday, and the whole month before while today is the 1st to the 10th (late receipts). «Одоо татах» (right `ebarimt.check.edit`, `POST /ebarimt-check/pull`, idempotent) pulls the month on screen up to today at once. Each month is asked in windows of at most seven days. The calls are made between transactions, from `EbarimtPullFlowService` and the job only (G1, TX_GUARD); each month is written in its own transaction.
5. **A refusal is an answer, not an error.** A pull returns `{ ok, reason, message, receipts, masked, months }`; the reasons are `NOT_CONFIGURED`, `KEY_UNREADABLE`, `SIGN_IN_REFUSED`, `REFUSED`, `UNREACHABLE`, `BAD_RESPONSE`, `NO_DAYS`, and `message` is the service's own words (its `msg`, cut to 300 characters). The last pull's outcome is kept on the connection row; the page shows «Сүүлд татсан: {огноо}, {n} баримт» or «Татаж чадсангүй: {шалтгаан}», the month bar «Эх сурвалж: API» / «Эх сурвалж: Excel», and a note that the real service answers only between 01:00 and 07:00. A token is cached until it ends and asked for again once when the service refuses it; nothing else is retried, and a failed night waits for the next.
6. **A seller's register that comes masked (holds `*`) is kept as it came**, counted (`maskedCount` per file, `masked` per pull) and shown on the page («{n} баримтын ТТД далд»). Nothing guesses which supplier it is: such a line matches no register and stays in the unregistered list, where it can be linked to a supplier by its ДДТД as before.
7. **Tests never reach the tax authority.** The hosts of each environment come from the token `EBARIMT_HOSTS`; the integration suite points both at a fake server on the loopback. The public staging values are not committed anywhere.

## Consequences

- The owner sends the letter (draft in the study); until the answer, the page works in «Туршилтын» against staging and by Excel.
- If real answers do hide registers, the comparison by register is weaker for those lines; the count on the page shows how many, and links by ДДТД still work.
- `ebarimt_check_files.file_id` is nullable: a reader of it handles NULL (only the download did).

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| A new env secret for the sealed values | ERKHET_KEY_SECRET already seals erxes's and WeSend's values with their own contexts; a new secret needs the deploy scripts and the server's `.env` for no gain. |
| Every pull a new file | A history row and a new file every night for an unchanged month would bury the real changes. |
| An empty answer empties the month | A service fault or a wrong `pin` would wipe a month's receipts. |
| Guessing a masked register from the name | The name is masked too; a wrong guess would count a receipt for the wrong supplier. |
| Reading the receipts through an etax.mta.mn browser sign-in | Not a key: tied to a person's session, it ends, and automating it is not allowed. |
