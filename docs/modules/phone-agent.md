# Module `phone-agent` — contract (the phone AI order line, ADR-0232)

Outside the shop's working hours an AI agent answers the order phone in Mongolian. The Android phone takes the GSM call, a Windows bridge beside it holds the conversation with ElevenLabs Agents, and every tool the agent uses is a call from that bridge to Bto over the LAN. This module is Bto's side: who may be answered and when, who is calling, what the agent may say and do, the transcript, and the callback tasks.

Status: **stage 1** (the api) and **stage 2** (the station and calls screens, the Windows bridge `tools/call-bridge/windows` in `local` mode with test calls through the PC's headset, and the agent as code `tools/call-bridge/agent`), built 2026-11-20. Stage 3: the Android app and the `cable` / `bluetooth` audio modes. Nothing here is switched on until a line exists, is active, the sales settings name a PHONE_AI stage and the server has the agent's key.

- **Code:** `apps/api/src/modules/phone-agent/`; the provider's client in `apps/api/src/integrations/elevenlabs/`.
- **Decisions:** ADR-0232 (everything here), ADR-0226 #4 (the station key scheme), ADR-0079 #5 and ADR-0082 #3 (an order without a staff author), ADR-0045 #7 (nothing spoken is logged), ADR-0069 #7 (the module's own error catalog).
- **Tests:** `src/modules/phone-agent/phone-agent.rules.spec.ts` (working hours, «no order without yes», outcomes), `src/integrations/elevenlabs/elevenlabs.client.spec.ts`, `test/integration/phone-agent.int-spec.ts` (the whole flow against a scripted provider).

phone-agent depends on these modules, always through their `index.ts`. Nobody imports its services; `notifications` binds its hook:

- `identity`: the route decorators, `AuditService`, `PhoneLineActor`, `Idempotent`, the foreign key to `users`.
- `catalog`: `UnitConversionService.toBase`.
- `partners`: `CustomersService.findByPhone` and `getMany`, `CustomerAddressesService.defaultAddress`; the foreign key to `customers`.
- `pricing`: `PriceQuoteService.quote`.
- `sales`: `SalesRepShopService` (the shop «Bto300» lists), `SalesPipelinesService.phoneAiPlacement` / `phoneAiOpen` / `channelPipeline`, `SalesOrdersService.createInTx` / `numberOf`, `CustomerOrdersService.statusOf`; the foreign key to `sales_orders`.

## 1. Owned tables (migration `0118_phone_agent`)

| Table | Holds |
|---|---|
| `phone_lines` | A line's station: `name` (1–60), `active` (default false), `schedule` (jsonb, §3), `greeting` (≤ 500, null = the agent's own), `key_hash` (the sha-256 of the whole key `bpl_<id>_<secret>`), `last_seen_at`, `created_by`, `created_at`, `updated_at` |
| `phone_calls` | An incoming call: `line_id`, `call_ref` (Android's id, unique per line), `caller_phone` (E.164 when a Mongolian number), `caller_raw` (as the phone showed it; both null when withheld), `customer_id` (the one store recognised), `el_conversation_id`, `answered`, `decline_reason` (WORKING_HOURS / LINE_INACTIVE / AI_CLOSED / AGENT_UNAVAILABLE, only when not answered), `started_at`, `ended_at`, `end_reason` (COMPLETED / CALLER_HANGUP / TIMEOUT / SILENCE / ERROR), `duration_s`, `outcome` (ORDERED / STATUS_ONLY / CALLBACK / NO_MATCH / ABANDONED / FAILED), `sales_order_id` and `order_number` (both or neither; only with a `customer_id`), `cost_estimate` (the provider's own cost figure, its credits), `reconciled_at` |
| `phone_call_messages` | The transcript: primary key `(call_id, seq)`, `role` USER / AGENT / TOOL, `text` (≤ 4000; a tool's name for TOOL), `at_ms` (from the call's start), `meta` (jsonb object: `source` BRIDGE / RECONCILED; for a tool `tool`, `args`, `ok`, `answer` or `code` and `status`, `no_hit`, `quote_id`, `quote_lines`, `order_id`, `callback_id`; for a reconciled turn `turn`). Partial index of the no-hit searches |
| `phone_callbacks` | A task to ring back: `call_id`, `phone`, `customer_id`, `reason` (1–500), `status` OPEN / DONE / DROPPED, `done_by`, `done_at` (both exactly when closed) |

`phone_call_messages` is append-only: the app's role may not UPDATE, DELETE or TRUNCATE it. The other three may not be deleted or truncated. No housekeeping deletes any of them (transcripts are kept forever); audio is never stored. The store seed leaves all four empty.

The same migration widens, without dropping data: the channel CHECKs of `sales_orders` and `sales_channel_defaults` (PHONE_AI), `audit_log`'s actor kind (PHONE_LINE), `user_notifications` (kinds PHONE_ORDER and PHONE_CALLBACK, `callback_id`, one row per recipient), and adds an index on `customer_contacts.phone`.

## 2. Services

| Service | Use |
|---|---|
| `PhoneLinesService.list / get / create / update / rotateKey / authenticate` | the lines; a key is made with the row and shown once; `authenticate` checks a station's key in constant time and marks the line seen |
| `PhoneCallsService.open / failToAnswer / own / ownAnswered / appendEvents / end / closeAbandoned` | the station's writes: the call and its decision, the turns (`ON CONFLICT DO NOTHING`), the end with its outcome and the reconcile job in one transaction |
| `PhoneCallsService.page / detail / callbacks / closeCallback / noHits` | the office's reads and the callback tasks |
| `PhoneToolsService.run(line, callId, name, { afterSeq, seq, atMs?, args })` | one of the agent's tools (§4) |
| `PhoneCallFlowService.start / status` | `POST /calls`: the decision in a transaction, then the signed URL between transactions; the station's heartbeat |
| `PhoneReconcileFlowService.reconcile(callId) / sweep()` | the worker's side: a finished call against the provider's copy; closing the calls a dead bridge left open |
| `PHONE_AGENT_LISTENER` (`hooks.ts`) | `onPhoneOrder` / `onPhoneCallback`, by value, inside the transaction; `notifications` binds it (`PhoneNotifier`) |
| `phone-agent.rules.ts` | the value lists, `isWorkingTime`, `scheduleIssues`, `confirmed`, `outcomeOf`, `sameTurn` |

## 3. Rules

- **The station's key.** `Authorization: Bearer bpl_<line>_<secret>`; the line keeps a sha-256 of the whole key, compared with `timingSafeEqual`; shown when the line is made or the key made again, when the old one stops at once. Anything else: `PHONE_KEY_INVALID` (401). A line that is switched off still opens to its key: its station shows that it is off and its calls are stored as declined.
- **Idempotency.** Every station route that writes takes `Idempotency-Key`, kept per line (`idempotency_keys.actor_kind = 'PHONE_LINE'`). Besides the header: a call reported twice with one `callRef` is one row; a stored `seq` is never written twice; a tool call sent again with the same `seq`, tool and arguments gets the stored answer (or the stored refusal) instead of a second effect.
- **Who is answered.** `POST /calls` answers `answer: false` (the phone rings for staff) when the line is off (`LINE_INACTIVE`), when the server's clock is inside the line's working hours (`WORKING_HOURS`), when the server has no agent key and id (`AGENT_UNAVAILABLE`), when no stage takes PHONE_AI orders (`AI_CLOSED`), and when ElevenLabs gives no signed URL within 1.5 s (`AGENT_UNAVAILABLE`, the call filed FAILED). A declined call is stored, over at once, without an outcome.
- **Working hours.** `schedule = { week: { "1": [["09:00","18:00"]], … "7": [] }, exceptions: [{ date, intervals }] }`: per ISO weekday the intervals `[from, to)` in Asia/Ulaanbaatar in which staff answer; a dated exception replaces its day (a holiday: no intervals). At most 4 intervals a day, in order and not overlapping, at most 60 exceptions. A new line has no working hours and is off.
- **Who is calling.** The number normalised with `normalizeMnPhone` and matched against the ACTIVE customers' phones and their contacts' phones. Exactly one: recognised. None, several, a number that is not a Mongolian one, or a withheld number: unknown.
- **What an unknown caller gets.** `search_products`, `check_availability`, `new_products`, `request_callback`, `end_call`. `quote`, `place_order` and `order_status` answer `PHONE_CALLER_UNKNOWN` (409).
- **The shop.** The products, their units and their free stock are «Bto300»'s: the customer app's assortment and counted warehouses (`SalesRepShopService.customerScope`).
- **«No order without yes».** `place_order` creates an order only when, in this call: `quoteId` is the call's latest successful `quote`; after that quote's message there is an AGENT message with words and after that a USER message with words; and every `seq` from 1 to `afterSeq` is stored. Otherwise `PHONE_QUOTE_NOT_FOUND` or `PHONE_ORDER_NOT_CONFIRMED` (409). The order's lines are the quote's, never the agent's later words. One order a call (`PHONE_ORDER_PLACED`).
- **The order.** A numbered DRAFT on the PHONE_AI stage (an action-less stage of a SALES pipeline every reader sees), channel `PHONE_AI`, `created_by` null, the audit's actor `PHONE_LINE` with the line's id, the status event labelled `phone-ai`. Payment CREDIT, delivery date tomorrow (Asia/Ulaanbaatar), contact phone the caller's. Fulfilment from the tool; without one, DELIVERY when the store has a default address, else PICKUP; a delivery without a default address is `PHONE_NO_DELIVERY_ADDRESS`. Nothing is reserved and no credit check runs until the office confirms it.
- **Refusals are in the transcript.** A tool call refused with a 4xx is stored at its `seq` with its code, so the numbering has no gap behind it.
- **Outcome**, set when the call ends: an order → ORDERED; else a callback → CALLBACK; else an end reason ERROR → FAILED; else an unknown caller → NO_MATCH; else a told order status → STATUS_ONLY; else ABANDONED.
- **Reconcile.** `phoneagent.reconcile` (enqueued by the end, 20 s later; six retries from a minute apart) reads `GET /v1/convai/conversations/:id` and appends the spoken turns that are not stored, as RECONCILED messages numbered after the last one, with their real `at_ms`; the provider's turns are matched to the stored ones in order, by role and words (case and spacing ignored, a cut turn matched by its beginning). Once per call (`reconciled_at`). A call without a conversation id has nothing to reconcile against.
- **Abandoned calls.** `phoneagent.sweep` (every five minutes) closes an answered call still open 15 minutes after it began, with its outcome and a reconcile job.
- **Told at once.** A new order and a new callback write a `user_notifications` row (`PHONE_ORDER`, `PHONE_CALLBACK`) for every active holder of `phone.calls.read`, in the same transaction.
- **Privacy.** No tool answer carries a price list beyond the quoted cart, a stock number other than «ердөө N», a credit limit, a debt, a hold, another store's data or staff data. Logs carry call ids, milliseconds and error codes only: never a number, a signed URL, a key or a word of a conversation.

## 4. REST surface (`/api/v1`)

The station (`@Public()`, the line's key; a refusal is problem+json with its `code`):

| Route | Notes |
|---|---|
| `GET /phone-agent/station` | the heartbeat: `{ lineId, name, active, workingHours, agentConfigured }`; marks the line seen. No provider call |
| `POST /phone-agent/calls` | Idempotency-Key. `{ callRef, callerPhone? }` → `{ answer, callId, reason, signedUrl, dynamicVariables }`, 201. `dynamicVariables`: `call_id`, `caller_known`, `store_name`, `can_deliver`, `greeting`. The signed URL is fetched for this call and left out of the stored replay: a replayed answer has none, and the bridge then does not pick up |
| `POST /phone-agent/calls/{id}/events` | Idempotency-Key. `{ events: [{ seq, role: USER/AGENT, text, atMs }] (1–200), conversationId? }` → `{ stored, lastSeq }`, 200 |
| `POST /phone-agent/calls/{id}/tools/{name}` | Idempotency-Key. `{ afterSeq, seq, atMs?, args }` → `{ answer }`, 200 |
| `POST /phone-agent/calls/{id}/end` | Idempotency-Key. `{ reason, durationS?, conversationId? }` → `{ callId, outcome, orderNumber }`, 200; a second end changes nothing |

The tools (`args` → `answer`):

| Tool | Arguments | Answer |
|---|---|---|
| `search_products` | `{ query }` | `{ products: [{ productId, name, sellable, stock: available/out, units: [{ unitId, name, factor, base }] }] }` (≤ 5); none found is stored with `meta.no_hit` |
| `check_availability` | `{ productId, unitId, qty }` | `{ status: available }`, `{ status: out }`, or `{ status: only, qty, unit }`: the whole units of the asked unit that are free, or base units when not one of it is |
| `quote` | `{ lines: [{ unitId, qty }] }` (1–20) | `{ quoteId, preliminary: true, lines: [{ productId, name, unitId, unit, qty, total }], total }`, wholesale, today; `PHONE_PRICE_MISSING` for a product without a price |
| `place_order` | `{ quoteId, fulfilment?: DELIVERY/PICKUP, note? }` | `{ number, fulfilment, deliveryDate }` |
| `order_status` | `{ number? }` | `{ found, orders: [{ number, state, createdDate, fulfilment, deliveryDate }] }`: the store's own order with that number, or its newest three; another store's number is `found: false`, like a number that never was |
| `new_products` | `{ limit? ≤ 3 }` (default 2) | `{ products: [{ productId, name, units }] }`: sale-ready within 14 days and in stock; a second ask in the call answers `{ products: [], alreadySuggested: true }` |
| `request_callback` | `{ reason }` | `{ ok: true }`; a call leaves one task |
| `end_call` | `{ reason? }` | `{ ok: true }`; the bridge hangs up after the audio drains, then posts the end |

The office:

| Route | Access | Notes |
|---|---|---|
| `GET /phone-lines` | `phone.lines.manage` | `[{ id, name, active, schedule, greeting, lastSeenAt, online, workingHours, createdAt, updatedAt }]`; `online`: the station called within 2 minutes |
| `POST /phone-lines` | `phone.lines.manage`, Idempotency-Key (the key is not stored in the replay) | `{ name, schedule?, greeting? }` → `{ line, key }`, 201; the line is off |
| `PUT /phone-lines/{id}` | `phone.lines.manage` | `{ name?, active?, schedule?, greeting? }` |
| `POST /phone-lines/{id}/key` | `phone.lines.manage`, Idempotency-Key | a new key `{ line, key }`; the old one stops |
| `GET /phone-calls?outcome&answered&from&to&hasOrder&cursor&limit` | `phone.calls.read` | newest first, keyset; `from` / `to` are Ulaanbaatar days (`YYYY-MM-DD`, both inclusive, by `started_at`); `hasOrder=true` only the calls that placed an order, `false` only the others |
| `GET /phone-calls/{id}` | `phone.calls.read` | `{ call, messages }`, the transcript in the order it was spoken (`at_ms`, then `seq`) |
| `GET /phone-callbacks?status&cursor&limit` | `phone.calls.read` | OPEN unless another status is asked |
| `POST /phone-callbacks/{id}/close` | `phone.calls.read`, Idempotency-Key | `{ status: DONE/DROPPED }`; only an open task closes (`PHONE_CALLBACK_STATE`, 409) |
| `GET /phone-searches/no-hits?cursor&limit` | `phone.calls.read` | «Олдоогүй хайлтууд»: `{ callId, seq, query, createdAt }`, newest first |

### 4.1 How the bridge uses the station routes (stage 2, `tools/call-bridge/windows`)

- One `POST /calls` per ring, no retry (a replay carries no signed URL). The signed URL opens the
  conversation; the first message carries `dynamicVariables`, and the line's `greeting` as the
  `first_message` override only when it is not empty.
- `user_transcript` and `agent_response` take the next `seq` in the WebSocket's order; a
  `client_tool_call` takes the next one when it arrives. Turns go to `/events` in batches of at
  most 200, each second. Before a tool is forwarded every buffered turn is stored; if Bto does not
  take them the tool is not sent at all. The tool call carries `afterSeq = seq - 1`; tools run one
  at a time. A retry reuses its Idempotency-Key.
- The agent hears a tool's `answer` as JSON, or `{"error": "<code>"}` with `is_error` for a refusal;
  `BTO_UNAVAILABLE` when Bto did not answer (the call then ends as ERROR within 20 s).
- `/end` carries the reason (`COMPLETED` after `end_call`, `CALLER_HANGUP`, `TIMEOUT`, `SILENCE`,
  `ERROR`), `durationS` and the conversation id.
- The bridge logs and prints no words, numbers of callers, URLs or answers: ids, milliseconds, counts
  and codes. Its numbers per call (response time, greeting, searches, no-hit searches) stay in the
  PC's `metrics.csv`.

## 5. Error codes (`phone-agent.errors.ts`, messages under `errors.*` of mn.json)

`PHONE_KEY_INVALID` 401; `PHONE_LINE_NOT_FOUND`, `PHONE_CALL_NOT_FOUND`, `PHONE_TOOL_UNKNOWN`, `PHONE_PRODUCT_NOT_FOUND`, `PHONE_CALLBACK_NOT_FOUND` 404; `PHONE_CALL_NOT_ANSWERED`, `PHONE_CALL_ENDED`, `PHONE_SEQ_TAKEN`, `PHONE_CALLER_UNKNOWN`, `PHONE_AI_CLOSED`, `PHONE_QUOTE_NOT_FOUND`, `PHONE_ORDER_NOT_CONFIRMED`, `PHONE_ORDER_PLACED`, `PHONE_PRICE_MISSING`, `PHONE_NO_DELIVERY_ADDRESS`, `PHONE_CALLBACK_STATE` 409. A tool may also answer the owners' codes (`PRODUCT_NOT_IN_APP`, `PRODUCT_OUT_OF_APP_STOCK`, `UNIT_FACTOR_INEXACT`, `UNIT_SUPERSEDED`, `CUSTOMER_INACTIVE`, `VALIDATION_FAILED`).

## 6. Configuration

`ELEVENLABS_API_KEY` (a secret like `LLM_API_KEY`) and `ELEVENLABS_AGENT_ID`, api and worker, from the environment only; empty in both `.env.example` files. Without both the agent is off and every call is declined. `EnvSchema` validates them and `ElevenLabsIntegrationModule` (api and worker) reads them through `AppConfig`; the store's Compose file passes them to both processes.

## 7. Jobs

| Job | When | Does |
|---|---|---|
| `phoneagent.reconcile` `{ callId }` | enqueued by a call's end, in its transaction | §3 Reconcile |
| `phoneagent.sweep` | every 5 minutes | §3 Abandoned calls |

## 8. Open items

- Which roles besides ADMIN hold `phone.calls.read` and `phone.lines.manage` is the owner's to say.
- Whether the apps' minimum order amount applies to a phone order is not decided; it is not applied.
- Stage 3: the Android link and the two audio modes. Stage 2's measurements (recognition, the LLM, latency, cost) decide the agent's settings.
