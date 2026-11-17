# ADR-0216: Settlement SMS through WeSend, sent only by a staff member's press

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: SMS for the settlement reminders, WeSend (wesend.mn) contracted, the page «Санхүү → Тооцооны SMS» with the group, ticks, one text with placeholders and the result), the brain (the brief), Claude (the bto-core worker) |
| Migration | `0109_settlement_sms` |
| Amends | ADR-0079 #3 («No SMS in the system»): SMS now exists for one use only, the settlement reminders staff send by hand. ADR-0079's sign-in without SMS stays, and so does ADR-0195's «no SMS» for the watchman |

## Context

Customers settle on their group's day (ADR-0101): the 20th («Мөрөн») or the month's last day («Орон нутаг»). Before that day the accountant phones or messages each store about its balance by hand. The customer app shows the balance (ADR-0086), but most stores do not open it. The owner has contracted WeSend, a Mongolian SMS provider with a plain HTTPS api (`POST /v1/sms`, `GET /v1/balance`, a bearer key, an `Idempotency-Key` header, a JSON error with a stable code), and asked for a page that sends each store of a group its own balance.

ADR-0079 #3 had removed SMS from the plan, because no provider was contracted and the sign-in did not need one.

## Decision

1. **SMS exists only as settlement reminders that a person sends.** A staff member with the new right `finance.sms.send` (given by default to the ADMIN and ACCOUNTANT system roles) ticks customers on «Санхүү → Тооцооны SMS» (`/finance/settlement-sms`), writes one text and confirms. Nothing is sent automatically: there is no schedule and no trigger from another event. There is still no OTP or sign-in SMS (ADR-0079 #3–#6 otherwise stand), and the watchman does not send SMS (ADR-0195). Reading the list and the history needs `finance.read`.
2. **Provider: WeSend**, through `apps/api/src/integrations/sms` (`WesendClient`, `SmsGateway`, a global module in the api and the worker, with an injectable `fetch` that tests script). It is called only from `*-flow.service.ts`, between transactions.
3. **The key is sealed in the database**, typed on «Тохиргоо → SMS» (`/settings?tab=sms`, the same right as the AI key, `ai.settings.manage`) and never shown again: only «тохируулсан» and its last four characters. It is sealed with `ERKHET_KEY_SECRET` under its own context `sms_settings.api_key`. That secret already reaches both the api, which seals, and the worker, which opens and sends. `AI_KEY_SECRET` cannot be used because the entrypoint keeps it from the worker (ADR-0162). No new environment variable is added. A switch on the same tab stops all sending. A change of the key is audited, without the key.
4. **Texts are frozen per message.** The press of «Илгээх» (`POST /settlement-sms/batches`, `Idempotency-Key`) re-reads each customer's name, phone, group and current receivable balance. The server renders the text with `renderSmsTemplate` (`@tugeel/shared/notifications`, the same function the dialog's preview uses) and writes one `sms_batches` row and one `sms_messages` row per customer, with the text, the phone and the balance as they were. It then enqueues the job `notifications.sendSms`, all in one transaction. The app role cannot change a message's text, number or balance afterwards. The placeholders are `{Харилцагч_нэр}`, `{Эцсийн үлдэгдэл}` (whole MNT with thousands separators, no currency sign), `{Харилцагч_код}` and `{Тооцооны_өдөр}` (the customer's current settlement day as `YYYY.MM.DD`). An unknown placeholder is refused, naming it. A customer without a valid phone is kept as SKIPPED (`no_phone`). With «Зөвхөн үлдэгдэлтэй» on, a customer whose balance is no longer above zero is also SKIPPED (`no_balance`).
5. **WeSend's counting is shared code.** `smsSize` counts a Latin text at 155 characters a part. Any other character (Cyrillic, ₮, №, « », curly quotes, and the ASCII `[ \ ] ^ { | } ~`) makes the text Unicode, at 65 characters a part. At most 4 parts are allowed: a longer rendered text refuses the whole batch (`SMS_TOO_LONG`). Each part costs 80₮. The dialog shows the longest text's parts, the estimated total and WeSend's balance, and warns when the estimate exceeds the balance; it does not block the send.
6. **Sending is safe to repeat.** The worker sends message by message, never inside a transaction. It re-reads each message as QUEUED before sending it, and marks it SENT or FAILED only while it is still QUEUED. Every attempt at a message carries the same `Idempotency-Key` (`bto-sms-<the message's uuid>`). So a job that runs twice sends nothing twice, and a worker that dies between WeSend's answer and the mark gets WeSend's first answer back instead of sending a second SMS. A 429 is waited out: its `Retry-After`, at most 30 s, three attempts with the same key. A timeout is FAILED `timeout` and never sent again. 401, 402 and 403 (`sending_paused`, `forbidden`, `ip_not_allowed`) are refusals of the whole account, so they stop the batch: the rest are marked FAILED with that code and the batch keeps it as `stopped_code`. Every code has a Mongolian text (`sms.errors.*`).
7. **Data.** `sms_settings`, `sms_batches` and `sms_messages` are owned by `notifications`, which reads customers through partners' `CustomersService` and balances through finance's new `ArLedgerService.balancesOfCustomers`. Both are read only, so no ledger number changes. The audit records a batch's creation (group, template, counts) and every key change. The customer ledger page `/finance/customers/:id` gains a totals strip («Эхний үлдэгдэл», «Дебит», «Кредит», «Эцсийн үлдэгдэл») when it has `from` and `to`, through `GET /customer-balances/:customerId/statement-totals` (`finance.read`, `to` cut to today). The SMS list's code and name open that page for the current settlement period.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Send automatically before each settlement day | The owner wants a person to choose who gets a text and to read the cost first; an automatic sender also needs rules for disputed balances |
| A new secret `SMS_KEY_SECRET` | One more variable to keep in step in `deploy/`, the test harness and every `.env`, for the same protection: the context already binds the sealed value to its column |
| `AI_KEY_SECRET` | The worker is deliberately kept without it (ADR-0162) |
| Render each text when it is sent | The balance could change between the press and the send; the person confirmed the figures they saw, and the history must show exactly what was sent |
| Send from the api during the request | Several hundred texts at WeSend's pace would hold the request for minutes; an HTTP call inside a transaction is forbidden |

## Consequences

**Positive.** A group's reminders go out in a few minutes instead of an afternoon of calls. Each store receives its own figure, and the history shows every text, its state and why it failed. **Negative.** A store's phone and balance leave the company to WeSend. Every text costs money, and the estimate is the dialog's: WeSend's `credits` per message are stored when it gives them. Rotating `ERKHET_KEY_SECRET` makes both Erkhet's password and the WeSend key unreadable, so both must be typed again. A batch whose job has used up its retries stays SENDING with its QUEUED messages; nothing sweeps it yet. The shape of WeSend's `GET /v1/balance` answer is read leniently (`balance`, `credits` or `data.balance`), because the builder never saw a real answer.

**Follow-ups.** The owner types the WeSend key once on «Тохиргоо → SMS» on the real system and presses «Холболт шалгах». While WeSend's account is in its trial, only the owner's own number can receive (`trial_recipient`).

## Related

ADR-0079, ADR-0086, ADR-0101, ADR-0162, ADR-0165, ADR-0195, ADR-0203, ADR-0214, `docs/modules/notifications.md`, `docs/modules/finance.md`, docs/architecture.md §4, §9.8, §10.2.
