# ADR-0232: The phone AI order line

|           |                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Status    | Proposed (stage 0: the owner reviews this record before any code is written)                                                      |
| Date      | 2026-11-20                                                                                                                       |
| Deciders  | Owner (2026-11-20 answers below), Claude (brain)                                                                                 |
| Builds on | ADR-0045 (#7, privacy), ADR-0079, ADR-0082 (#3), ADR-0189, ADR-0212, ADR-0226 (#4, station keys)                                  |

## Context

Stores ring the shop to order. Outside working hours nobody answers. The owner wants a dedicated Android phone whose order calls an AI agent answers in Mongolian: it says whether products are available, asks the quantity and the unit (catalog units with factors, «нэг хайрцагт 24 ширхэг»), takes the order, confirms «захиалга авлаа», tells an order's status, suggests new products once and ends politely. The whole conversation is kept in Bto as text and linked to the order it produced.

The owner's design:

```
Caller ─GSM─► Android phone (tools/call-bridge/android: Kotlin, default dialer, InCallService)
          ─LAN WebSocket, paired key─► Windows PC (tools/call-bridge/windows)
          ◄─ audio: A cable, or B Bluetooth through Windows Phone Link ─► phone
PC ─wss─► ElevenLabs Agents (Scribe v2 Realtime mn → LLM → TTS eleven_v4_turbo mn)
PC ─LAN HTTP─► Bto api /api/v1/phone-agent/* (station key bpl_<id>_<secret>)
```

The owner's answers (2026-11-20), which this record takes as decided:

1. An unknown number (no customer in Bto) gets no order, only a callback task; the AI may still say whether a product is available.
2. Stock is spoken as «байгаа» only; when the asked quantity is more than is free, «ердөө N <unit> үлдсэн байна». Exact stock is never read out otherwise.
3. A preliminary price and total are spoken, as «урьдчилсан»; the final total is set when staff confirm.
4. «New products» are those of Bto300 and the rep app: `sale_ready_at` within `NEW_PRODUCT_DAYS` = 14 (`packages/shared/src/catalog/index.ts:259`), in stock; at most 2, suggested once per call.
5. The AI answers outside working hours only; the schedule is on the phone line and set on the station screen. In working hours the phone rings normally for staff.
6. `PHONE_AI` is its own row in `sales_channel_defaults`, chosen in the sales settings like `CUSTOMER_APP`; only a live pipeline and an action-less stage are accepted. The AI asks «хүргэлт үү, очиж авах уу?»; a delivery goes to the store's default address. Payment is not asked.
7. Transcripts are kept forever (no housekeeping deletion). Audio is never stored.
8. A PHONE_AI order's payment method is CREDIT («Зээл»), not asked by the AI; staff can change it when confirming.
9. The delivery date is the next day, not asked by the AI; staff change it when confirming.
10. A number matching several customers is treated as unknown: no order, a callback task only.

What the code has today (checked on this branch): `ORDER_CHANNELS = ['ADMIN','CUSTOMER_APP','SALES_REP','POS']` (`packages/shared/src/sales/index.ts:27`) with the CHECKs `sales_orders_channel` (`apps/api/src/db/migrations/0023_sales_orders.sql:91`) and `sales_channel_defaults_channel` (`0024_sales_boards.sql:30`). The customer app's order goes through `CustomerAppOrdersService.send` (`modules/customer/services/customer-app-orders.service.ts:64-105`): `SalesPipelinesService.customerAppPlacement(tx)` (`sales-pipelines.service.ts:703`) then `SalesOrdersService.createInTx(tx, { kind: 'CUSTOMER', … }, …, { channel: 'CUSTOMER_APP' })` (`sales-orders.service.ts:259`), which writes a numbered DRAFT with `created_by` from `actorUserId(ctx)` (NULL for a customer). A draft holds no reservation and passes no credit check; the CONFIRM stage action does both. The stage rule (`assertCustomerAppStage`, `sales-pipelines.service.ts:429`) is enforced in the service only. `AuditActor = Actor | CustomerActor` (`identity/auth-context.ts`); `AUDIT_ACTOR_KINDS` STAFF/CUSTOMER/SYSTEM with the CHECK `audit_log_actor_kind` (`identity/schema.ts:448/472`). Print stations hold `bps_<id>_<secret>` keys, sha256 hex, compared with `timingSafeEqual` (`printing/services/print-stations.service.ts:51-213`). `CustomersService` has no find-by-phone; partner search normalises with `normalizeMnPhone` (`partners/services/support.ts:82`, `@tugeel/shared/phone`). Staff notifications are rows in `user_notifications` (kind ORDER_SOLD only, unique `(kind, order_id)`), recipients from `PermissionHoldersService.activeHolders`, read by the staff app and the web through `/me/notifications`; nobody imports `notifications`, it binds the hook contracts sales owns (`ORDER_LISTENER`, `SALE_LISTENER`).

`https://app.puljika.site` answers only `STORE_PUBLIC_COUNTRIES=MN` (ADR-0189, `deploy/store/Caddyfile.store:31`); ElevenLabs' servers are not in Mongolia.

## Decision

The project is staged: **0** this record; **1** Bto's side (tables, routes, screens, tests against a fake ElevenLabs); **2** the agent and the Windows bridge against a test number, measuring recognition, latency and the LLM; **3** the Android app and both audio modes, compared; **4** a supervised pilot outside working hours.

1. **Every tool is a client tool, through the PC on the LAN.** ElevenLabs server tools (webhooks) would have to reach `app.puljika.site`, which refuses callers outside Mongolia (ADR-0189), and would open a new public door. The PC already holds the conversation's WebSocket; it forwards each `client_tool_call` to Bto over the LAN and returns the answer. Nothing new is opened to the outside.

2. **A new module `modules/phone-agent`** owns four tables (stage 1, one additive migration whose number stage 1 takes):
   - `phone_lines`: the station: `name`, `active`, `schedule` (jsonb: per weekday the working intervals, Asia/Ulaanbaatar, plus dated exceptions), `greeting`, `key_hash`, `last_seen_at`.
   - `phone_calls`: `line_id`, `call_ref` (Android's id, unique per line), `caller_phone` (E.164 through `@tugeel/shared/phone`, null when withheld), `customer_id?`, `el_conversation_id`, `started_at`, `ended_at`, `duration_s`, `outcome` (ORDERED, STATUS_ONLY, CALLBACK, NO_MATCH, ABANDONED, FAILED), `sales_order_id?`, `cost_estimate`.
   - `phone_call_messages`: primary key `(call_id, seq)`, `role` USER/AGENT/TOOL, `text`, `at_ms` (from the call's start), `meta` jsonb (tool name, arguments, answer summary, `no_hit`, `quote_id`, `source` BRIDGE/RECONCILED). `REVOKE UPDATE, DELETE, TRUNCATE` from the app role: a transcript is a business record.
   - `phone_callbacks`: a task for staff: `call_id`, `phone`, `customer_id?`, `reason`, `status` OPEN/DONE/DROPPED, `done_by`, `done_at`.
   No housekeeping deletes any of them (answer 7). Audio is never stored anywhere, by Bto or by the bridge.

3. **The station's routes** (`/api/v1/phone-agent`, `@Public()` with a Bearer `bpl_<id>_<secret>` checked like a print station's key: sha256 hex, `timingSafeEqual`, shown once, renewable). Every state-changing route requires `Idempotency-Key`.
   - `POST /calls` `{ callRef, callerPhone }`: the line's schedule and the server's clock decide first: inside working hours (or the line inactive) it answers `{ answer: false }` at once and stores the call with outcome none; Android lets the phone ring. Outside, it identifies the customer (below), stores the call, fetches a signed URL (`GET /v1/convai/conversation/get-signed-url`) in `PhoneCallFlowService`, a `*-flow.service.ts`, after the transaction (TX_GUARD), and answers `{ answer: true, callId, signedUrl, dynamicVariables }`. The signed URL's lifetime is undocumented, so it is fetched for each call right before connecting, never cached.
   - `POST /calls/:id/events` `{ events: [{ seq, role, text, atMs, meta? }] }` (1–200): inserted `ON CONFLICT (call_id, seq) DO NOTHING`, so a resent batch changes nothing.
   - `POST /calls/:id/tools/:name` `{ afterSeq, seq, args }`: one tool (#6); the call and its answer are stored as a TOOL message at `seq`.
   - `POST /calls/:id/end` `{ reason, durationS }`: sets the outcome and enqueues `phone-agent.reconcile` (`jobs/phone-agent-reconcile.job.ts`) in the same transaction; the job reads `GET /v1/convai/conversations/:id` and inserts the turns the bridge never delivered (`meta.source = RECONCILED`), so every call ends fully stored. A call never ended (the bridge died) is closed ABANDONED and reconciled by a sweep after 15 minutes.
   - The bridge's own address is not restricted (it is on the LAN, its IP may change); the key is the door, as for print stations.

4. **Who is calling.** `callerPhone` is normalised with `normalizeMnPhone` and matched against the customers' phones and their contacts' phones (a new `CustomersService.findByPhone`, partners' index). Exactly one ACTIVE customer: recognised, addressed by the store's name. None, several (answer 10), or a withheld number: unknown, so no order and no status, only a callback task. Caller ID can be spoofed; that is acceptable because an order is a draft staff confirm (#7), and a status answer carries no money.

5. **The author of a PHONE_AI order is the phone line: `PhoneLineActor { kind: 'PHONE_LINE', phoneLineId, requestId? }`**, a third member of `AuditActor` beside `CustomerActor`, not an `Actor`. `created_by` is NULL; the audit's `actor_kind` gains `PHONE_LINE` with `actor_id` = the line (`AUDIT_ACTOR_KINDS` and the CHECK `audit_log_actor_kind` widened in the stage-1 migration); the events are labelled `phone-ai`. Compared with a `SYSTEM` actor: a SYSTEM actor is an `Actor`, and sales' rights code trusts every non-staff `Actor` as a system caller (the reason for ADR-0082 #3), so a line driven by a stranger's voice must not pass as one; SYSTEM's `label` also names no record, while `PHONE_LINE` points to the line and through the call to the transcript. The cost is one more case wherever `AuditActor` is switched on (`actorUserId`, the audit writer, the idempotency interceptor's key scope, the event label), which stage 1 lists from the graph.

6. **The tools** (all `client` in the agent; argument and answer shapes in `@tugeel/shared/phone-agent`):
   - `search_products { query }`: at most 5 rows: name, units with factors, sellable, `available`/`out`. A query with no hit is stored with `meta.no_hit` and listed on the calls screen («Олдоогүй хайлтууд») so staff add product aliases.
   - `check_availability { productId, unit, qty }`: converted to base units with `@tugeel/shared/units`; answers `available`, or `only { qty, unit }` when the free quantity is less (answer 2). No other number.
   - `quote { lines }`: `PriceQuoteService.quote`, wholesale, today; answers a `quoteId`, the lines and a total marked preliminary (answer 3).
   - `place_order { quoteId, fulfilment?, note? }`: recognised customers only (#4; otherwise 409 `PHONE_CALLER_UNKNOWN`); guarded by #7; answers the order's number.
   - `order_status { number? }`: only the identified customer's own orders, through `CustomerOrdersService` with the call's `customer_id` (the ADR-0079 principle: the store is the server's, never the client's); an unknown caller gets none; a number of another store answers «not found», the same as a number that does not exist.
   - `new_products { limit ≤ 3 }`: answer 4; the prompt suggests at most 2, once.
   - `request_callback { reason }`: a `phone_callbacks` row (#9).
   - `end_call { reason }`: the agent's goodbye; the bridge hangs up after the audio drains.
   No tool answer ever carries a credit limit, a debt, `creditHoldReason`, another customer's data or staff data.

7. **«No order without yes», enforced by the server.** `place_order` succeeds only when, in this call: (a) `quoteId` names a quote issued by `quote` whose lines are the order's lines (the order takes the quote's lines; the agent cannot send other ones); (b) after that quote's TOOL message there is a stored AGENT message (the read-back of every line and the preliminary total) and after that a stored USER message (the caller's answer); (c) every seq up to the tool call's `afterSeq` is stored (no gap). Otherwise 409 `PHONE_ORDER_NOT_CONFIRMED` and the agent asks again. The ordering is reliable because the bridge numbers every event in the order the ElevenLabs WebSocket delivers it, and before it forwards a tool call it flushes all buffered events and waits for their 2xx; the tool call carries `afterSeq`, so the server sees the caller's reply before the order. The server proves that the caller spoke after the read-back, not that the words were «тийм»; the prompt decides that. *Brain's note:* stage 2 can add (d), the last USER text contains an affirmative from a short list (тийм, за, болно, зөв, тэгье), if the measured transcripts show it is reliable; refusing a true «yes» costs a callback, accepting a false one costs a draft staff discard.
   The order is created like the customer app's: `SalesOrdersService.createInTx(tx, phoneLineActor, …, { channel: 'PHONE_AI', placement })` with `PHONE_AI` added to `ORDER_CHANNELS` and both CHECKs widened. It stays a DRAFT on an action-less stage, so it touches neither stock nor credit until staff confirm, and the final prices come at that confirm. `paymentMethod` is CREDIT (answer 8), never asked; the customer app has no default of its own (the store picks one, `apps/mobile/src/cart/cart.ts:181`), so the phone line sets it. The draft passes no credit check: the usual check (the customer row locked) runs only when staff confirm, where they may change the method. The AI never speaks about credit. Delivery: the store's default live address; a store without one is offered pickup only. `deliveryDate` (required by the order) is the next day, Asia/Ulaanbaatar (answer 9), not asked, changed by staff when confirming.

8. **Placement.** `sales_channel_defaults` gains a `PHONE_AI` row, set in the sales settings beside `CUSTOMER_APP`; `phoneAiPlacement(tx)` and the save check are `customerAppPlacement` / `assertCustomerAppStage` generalised over the channel (a live pipeline not own-orders-only, a stage with action NONE; 409 `PHONE_AI_CLOSED` otherwise, and the agent offers a callback).

9. **Staff are told at once.** A new PHONE_AI order and a new callback each write `user_notifications` rows for every active holder of `phone.calls.read` (`PermissionHoldersService.activeHolders`), in the same transaction, through a hook contract `PHONE_AGENT_LISTENER` that `phone-agent` owns and `notifications` binds, as it binds `ORDER_LISTENER` (nobody imports `notifications`). New kinds `PHONE_ORDER`, `PHONE_CALLBACK`; `payload` by value (order number, store name, call id). The unique `(kind, order_id)` allows one recipient per order, so the migration limits it to ORDER_SOLD and adds `(kind, order_id, user_id)`; a callback row carries `callback_id` (nullable column). The bell in the web and the staff app shows them.

10. **Rights and screens.** `phone.calls.read`: «Борлуулалт → Утасны дуудлага» (`/sales/phone-calls`): calls newest first with caller, store, outcome, order link, duration; a call opens its transcript; the callbacks to work through; the unmatched searches. `phone.lines.manage`: «Систем → Утасны AI шугам» (`/system/phone-lines`): the line, its schedule and greeting, the key, last contact. The names follow `packages/shared/src/auth/index.ts` (`module.object.verb`), not `phone_agent.*`.

11. **Data sent to ElevenLabs (and so to its LLM):** product names, units and factors, availability words and «ердөө N үлдсэн», preliminary prices and totals, the caller's own order numbers and statuses, the store's name as a dynamic variable, and the caller's voice. Never: credit limits, debts, `creditHoldReason`, other customers' data, staff data, any key. Transcripts are business records in `phone_call_messages` only; nothing logs a transcript, a prompt or an answer in the api, the bridge or the phone (ADR-0045 #7). `ELEVENLABS_API_KEY` lives only in `deploy/store/.env` and the development `apps/api/.env` (empty in the examples); the PC never holds it. Tests replace the ElevenLabs client with a fake and never reach the provider.

12. **The Windows bridge (`tools/call-bridge/windows`) is Python 3.12, not Node.** Node has no maintained WASAPI binding with per-device loopback and no usable echo cancellation; Python has `sounddevice` / `PyAudioWPatch` (WASAPI loopback) and `speexdsp` / `webrtc-audio-processing` bindings. `install.ps1` installs an embedded Python with its wheels, a scheduled task at the user's sign-in and `config.json`, as `tools/print-bridge` and `tools/scan-bridge` (ADR-0212 #3, #5). No echo cancellation in the first version: in both audio modes the agent's voice leaves on a different path from the caller's voice coming in, so the agent never hears itself through the PC; `calibrate` measures the residual echo and AEC is added only if it is measured. Safety: when Bto or ElevenLabs does not answer in time, it tells Android «do not answer» and the phone rings normally; a call over 10 minutes or with 40 s of silence ends politely; logs carry numbers, durations and error codes only.

13. **Audio modes A and B are both built and compared in stage 3**, and the choice is recorded then. A (cable): USB-C to 3.5 mm TRRS adapter with microphone support and PD charging pass-through, a TRRS splitter, a USB sound card; PC → phone microphone through a 1 µF series capacitor, a 10 kΩ / 100 Ω divider and a 2.2 kΩ load; phone → PC about −20 dB. B (Bluetooth): Windows Phone Link, the agent's voice through a VB-Cable virtual microphone, the call's audio captured by WASAPI loopback. Against B: Microsoft states Phone Link does not relay calls to a Bluetooth headset and does not support dual SIM; using a virtual microphone for a call is undocumented; HFP audio is narrowband.

14. **Android (`tools/call-bridge/android`)** takes `RoleManager.ROLE_DIALER` with an `InCallService`; it answers with `Call.answer(VideoProfile.STATE_AUDIO_ONLY)` and routes audio with `requestCallEndpointChange` (`setAudioRoute` is deprecated since API 34). The dialer role also requires a dialpad and `ACTION_DIAL` handling, so outgoing calls work through the app. If the bridge does not answer within 3 s, the normal incoming-call screen shows. The pairing key is stored on the phone and the PC. Its APK is built by hand, not by the job desk (ADR-0229): it is neither the staff app nor «Bto300».

15. **The agent's configuration is code**, in `tools/call-bridge/agent/`, pushed with the official ElevenLabs CLI (`@elevenlabs/cli`, `agents push`) or `PATCH /v1/convai/agents/{id}`; every tool `client`; prompt overrides and dynamic variables enabled in the agent's override settings. The Mongolian prompt's rules: the greeting exactly «Сайн байна уу, Оргил бөөний төвийн захиалгын AI туслах байна. Яриа бичигдэж байгаа. Юугаар туслах вэ?»; a known customer addressed by the store's name; at most two short sentences a turn; numbers and money in words; product, price, stock and status only from tool answers, otherwise `request_callback`; 2–3 options when several match; always confirm the unit and say the factor; read back every line and the preliminary total before `place_order`; new products once, at most 2; cancellations, complaints and unknown numbers → `request_callback`; two misunderstandings in a row → `request_callback` and end; thank and `end_call`.

## Alternatives considered

| Alternative | Why rejected |
| --- | --- |
| ElevenLabs server tools (webhooks) to Bto | Need a public door from abroad; `app.puljika.site` answers Mongolia only (ADR-0189). |
| The order's author a `SYSTEM` actor | A SYSTEM actor is an `Actor`, trusted by sales' rights code; it names no line or call (#5). |
| A staff user «AI» as the author | A login nobody uses, holding rights; ADR-0082 #3's reason applies. |
| «Yes» enforced by the prompt only | A model's slip would create an order; the owner's acceptance asks for zero, proven by a test. |
| The working-hours decision on the bridge or the phone | Two clocks and two copies of the schedule; the server decides in the same call that already must succeed for the AI to answer. |
| Node for the Windows bridge (with a native addon) | No maintained WASAPI per-device loopback, no usable AEC; a native addon to build and keep. |
| Recording audio for quality review | The owner: never stored; the transcript is the record. |
| Answering every call, also in working hours | Answer 5: staff answer in working hours. |

## Consequences

**Positive.** Orders taken while the shop is closed, as drafts on a stage staff choose, with the conversation beside each; no stock or credit moves until a person confirms; nothing new opened to the internet; a failure anywhere leaves the phone ringing as before.

**Negative.** Four parts to keep (api module, Python bridge, Kotlin dialer, agent config) and a hand-built APK. Each call costs ElevenLabs minutes and LLM tokens. Product names, prices, the store's name and the caller's voice leave the company (#11); whether that needs consent under Mongolia's personal data law stays the open question of ADR-0045 #7. The greeting says the call is being written down. `AuditActor`, the audit CHECK, the channel CHECKs and `user_notifications`' unique change in stage 1 (all relaxing, none dropping data, ADR-0206).

**Acceptance (owner).** Answered within 6 s (two rings); the greeting starts ≤ 1.5 s after the answer; median response ≤ 1.5 s; 100% of calls stored (gaps filled from ElevenLabs); zero orders without «yes» and zero answers about another store's orders (integration tests); PHONE_AI orders touch neither stock nor credit until confirmed; the phone rings normally within 3 s when Bto, the internet or the bridge is down.

## Open points to measure

| Risk | How it is measured, and when |
| --- | --- |
| Mongolian recognition. Scribe v2 puts Mongolian in its «moderate» tier (25–50% word error); Mongolian is not confirmed for `scribe_v2_realtime` nor as an agent language. | Stage 2, first and before anything is built on it: 100 recorded product requests from staff voices against the catalog's names; the share of `search_products` hits in the top 3. Below the bar the owner sets, the project stops or changes provider. |
| The LLM: Haiku 4.5 (speed) against Sonnet 5.5 / 4.6 (quality), among the Claude models ElevenLabs lists. | Stage 2: the same scripted calls on each; median turn latency, tool-argument errors, read-back completeness; reported to the owner, who picks. |
| Latency budget: Android 3 s for `POST /calls` including the signed-URL fetch; greeting ≤ 1.5 s. | Stage 2 logs each leg's milliseconds (no text); stage 4 the same on real calls. |
| Cost: about USD 0.08–0.10 per agent minute plus the LLM (third-party figures). | Stage 2 checks the official price page; `cost_estimate` per call from stage 1; a monthly total on the calls screen. |
| Event order: a USER transcript must reach Bto before the tool call that follows it (#7). | Stage 1 integration test with a fake bridge; stage 2 checks the real WebSocket's order on 50 calls. |
| Echo and audio quality in modes A and B. | Stage 3: `calibrate`, recognition rate per mode; the mode is chosen and recorded. |
| Signed URL lifetime (undocumented). | Fetched per call (#3); stage 2 notes any expiry seen. |

## Related

ADR-0045, ADR-0057, ADR-0068, ADR-0079, ADR-0082, ADR-0189, ADR-0206, ADR-0212, ADR-0226, ADR-0229; `docs/modules/sales.md`, `customer.md`, `catalog.md`, `pricing.md`, `notifications.md`, `ai.md`; `docs/architecture.md` §4, §9, §12.
