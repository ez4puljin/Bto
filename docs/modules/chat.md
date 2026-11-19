# Module `chat` — contract (the customer chat of «Bto300», ADR-0224)

A store that uses «Bto300» has one conversation with the company. A scripted bot greets it and answers four topics by button — two from the system (the store's own latest orders, its own balance), two from texts the office edits — and hands the conversation to staff when the store asks. Staff with a chat right list the conversations, answer and close them; both sides get new messages live. The bot is never a language model.

Status: the api side, built 2026-11-19. No screen yet: the customer app's chat, the staff app's and the web's follow, written against `@tugeel/api-client`.

- **Code:** `apps/api/src/modules/chat/`; the shared rules (senders, modes, the bot's buttons, limits, live events) in `packages/shared/src/chat` (`@tugeel/shared/chat`); the bot's Mongolian texts in mn.json `chat.bot.*`.
- **Decisions:** ADR-0224 (everything here), ADR-0079 and ADR-0082 (customer routes), ADR-0173 #4 (the live pattern), ADR-0192 (replicas), ADR-0183 (the rounds).
- **Tests:** `apps/api/test/integration/chat.int-spec.ts`.

chat depends on these modules, always through their `index.ts`; nobody imports chat:

- `identity`: the route decorators, `AuditService` (the settings), `UserNamesService` (a staff message's name; a rep's name and phone), the foreign keys to `users` and `customer_users`.
- `partners`: `CustomersService.getMany` (the store's name and code in the staff list), `creditTerms` (the limit and the hold); the foreign key to `customers`.
- `sales`: `CustomerOrdersService.page` (the latest orders) and `openExposureOf` (confirmed orders not yet invoiced), `streamDuration`; `RepVisitsService.roundRepIds` and `roundCustomerIds` (the reps' weekly rounds: who a store's reps are, which stores a rep answers; a rep counts while the user is active).
- `finance`: `ArLedgerService.balanceOf` and `overdueOf`.

## 1. Owned tables (migration `0114_chat`)

| Table | Holds |
|---|---|
| `chat_settings` | One row (`id = 1`): `greeting`, `delivery_text`, `hours_text` (each null or 1–1,000 characters; null = the default of mn.json `chat.bot.defaults`), `updated_by`, `updated_at`. No row = all defaults |
| `chat_conversations` | One per customer (`customer_id` unique → `customers`): `mode` BOT or STAFF (who answers now); `handed_off_at` (set exactly while STAFF); `awaiting_staff` (with staff, and the last word is the store's or the hand-off); `staff_unread` (the store's messages no staff member has seen since the hand-off); `customer_unread` (messages that reached the store unasked: a staff answer, the closing note); `last_message_id` / `last_message_at` (orders the staff list; no foreign key); `closed_at` / `closed_by` (the last close) |
| `chat_messages` | A message, written once: `conversation_id`, `sender` CUSTOMER / BOT / STAFF, `staff_user_id` (exactly on STAFF), `customer_user_id` (exactly on CUSTOMER: the app account that wrote it), `body` (1–2,000 characters), `buttons` (jsonb array `[{ id, label }]`, BOT only), `button_id` (CUSTOMER only: the pressed button, or the one a typed text repeats), `flow_node` (BOT only: the step that wrote it), `created_at`. Index `(conversation_id, id)`. The app's role may not UPDATE, DELETE or TRUNCATE it |

The app's role may not DELETE or TRUNCATE the other two either. The store seed copies `chat_settings` and leaves the other two empty.

## 2. The bot (`ChatFlow`, `ChatBotService`)

`ChatFlow` is what the chat asks the bot: `greet(customerId)`, `answer(customerId, buttonId, afterFallback)`, `closed()`. Each returns a `BotReply` — `node` (stored as `flow_node`), `body`, `buttons`, `handOff` — or null for silence. The methods only read, and are called before the transaction that writes the answer. `ChatBotService` is the scripted flow:

| Button id | Label | Answer (`flow_node`) |
|---|---|---|
| `ORDER_STATUS` | «Захиалгын төлөв» | The store's three latest orders, one per line: number · day · state in `sales.customerStates` words; or «Танд бүртгэлтэй захиалга алга.» |
| `DELIVERY_INFO` | «Хүргэлтийн мэдээлэл» | The setting `deliveryText` |
| `BALANCE` | «Тооцооны үлдэгдэл» | «Таны өр: N₮» / «Урьдчилгаа: N₮» / «Өргүй»; then, when they apply, the overdue amount, «Зээлийн үлдсэн боломж: A₮ / L₮» and «Зээл хаалттай» — the figures of the app's «Тооцоо» (`customer-app/account`) |
| `HOURS_ADDRESS` | «Ажлын цаг, хаяг» | The setting `hoursText` |
| `STAFF` | «Ажилтантай холбогдох» | `HANDOFF`: «Таны яриаг ажилтанд шилжүүллээ…», no buttons, the conversation moves to STAFF |

Other steps: `GREETING` (the setting `greeting`, on the first open), `FALLBACK` (typed text that repeats no label: once, then silence until a button or a staff message), `CLOSED` (the note when staff close). Every answer but `HANDOFF` carries the five buttons. While `mode` is STAFF the bot writes nothing.

The formula of «Зээлийн үлдсэн боломж» repeats `customer`'s `CustomerAccountService.credit` (nobody may import `customer`): change both together.

## 3. Rules of a write (`ChatService`)

- Every write is one transaction: lock the conversation row, insert the message(s), move the counters and `last_message_*`, `notifyChat(tx, …)`. Nothing is sent over HTTP.
- A store's send: the bot's answer is computed before the transaction from the mode read then; if the locked row's mode differs (staff took or closed it meanwhile) the send starts again, up to three times.
- The store's conversation is created by its first `open` or send, with the greeting; `ON CONFLICT DO NOTHING` on `customer_id` settles two first requests at once.
- Counters: a store's message while STAFF (and the hand-off itself) raises `staff_unread` and sets `awaiting_staff`; a staff answer zeroes both and raises `customer_unread`; a close zeroes the staff's and raises `customer_unread`; `open` and `read` zero the store's; the staff's `read` zeroes `staff_unread` and leaves `awaiting_staff`.
- Limits (`CHAT_LIMITS`): a written message 1–1,000 characters after trimming; 12 customer messages a minute per store, the next answers 429 `TOO_MANY_REQUESTS`; pages of 30 messages, at most 100.
- A customer is never an `Actor`: the store's routes pass `CustomerContext`, and the customer id is always the token's.

## 4. Rights

| Code | Lets | Default roles |
|---|---|---|
| `chat.answer` | list, read, answer, mark read and close every store's conversation | ADMIN, OFFICE |
| `chat.answer_own` | the same for the stores on the caller's own weekly round | ADMIN, SALES_REP |
| `chat.settings.manage` | read and change the three texts | ADMIN |

`ChatRepsService.scopeOf(ctx)` turns the caller's codes into a scope (every store, or the round's stores) and throws 403 with neither. A conversation outside the scope answers 404.

## 5. Routes

The store's, all `@CustomerRoute()` (the token's own store; no id from the client), under `/api/v1/customer-app/chat`:

| Route | Does | Answers |
|---|---|---|
| `POST open` | makes the conversation with the greeting the first time, marks it read | `CustomerChat { conversation, messages (newest page, oldest first), nextCursor, rep { name, phone } \| null }` |
| `GET messages?cursor&limit` | older messages | `ChatMessagePage { data, nextCursor }` |
| `POST messages` (`Idempotency-Key`) `{ text }` or `{ buttonId }` | the store writes; the bot's answer comes back | `CustomerChatSendResult { conversation, messages }`; 422, 429 |
| `POST read` | the store's unread → 0 | `CustomerChatConversation` |
| `GET unread` | the badge; creates nothing | `{ unread }` |
| `GET live` (SSE) | `ready`, `message`, `conversation`, `resync`, `ping` | data of the middle two: `CustomerChatLiveEvent { conversation, message \| null }` |

`CustomerChatConversation` is `{ id, mode, awaitingStaff, unread, handedOffAt, buttons }`; `buttons` are what the app offers now (the bot's latest; empty while staff answer).

The staff's, all `@Authenticated()` with the scope of §4, under `/api/v1/chat`:

| Route | Does | Answers |
|---|---|---|
| `GET conversations?state&cursor&limit` | `state` WAITING (awaiting an answer), STAFF (default: with staff), ALL (also the bot's, to take one over); latest message first | `StaffChatPage { data: StaffChatConversation[], nextCursor }` |
| `GET conversations/:id` | one conversation | `StaffChatConversation` |
| `GET conversations/:id/messages?cursor&limit` | its messages | `ChatMessagePage` |
| `POST conversations/:id/messages` (`Idempotency-Key`) `{ text }` | answers; takes a BOT conversation over | `StaffChatReplyResult { conversation, message }` |
| `POST conversations/:id/read` | `staff_unread` → 0 | `StaffChatConversation` |
| `POST conversations/:id/close` | back to the bot, with the closing note | `StaffChatConversation` |
| `GET unread` | the badge | `{ waiting, unread }` |
| `GET live` (SSE) | as the store's, for the stores in scope | `StaffChatLiveEvent { conversation, message \| null }` |
| `GET settings`, `PUT settings` (`chat.settings.manage`) | the three texts; null or empty = the default | `ChatSettings { greeting, deliveryText, hoursText, defaults, updatedAt }` |

`StaffChatConversation` is `{ id, customerId, customerName, customerCode, mode, awaitingStaff, unread, handedOffAt, closedAt, lastMessage, reps: [{ id, name }] }`.

## 6. Live (`ChatHub`, `chat-notify.ts`)

`notifyChat` sends `pg_notify('bto_chat', '<conversationId>:<customerId>:<messageId or 0>')` inside the write's transaction. `ChatHub` is provided only in the api's HTTP module: one dedicated connection per process, opened with the first stream, LISTENs; for each notice it reads the conversation and the message once (only when a stream of this process cares) and sends the store's streams and the staff streams in scope the same shapes the routes answer with. A rep's round is read again for an open stream when it is older than a minute. A stream ends at its token's expiry; after a lost connection every stream gets `resync` and refetches. The proxy (`deploy/store/Caddyfile.store`) does not compress `*/chat/live`. The customer routes run on the app replicas, the staff routes on the primary (ADR-0192): nothing here is kept in a process's memory between them.

## 7. Not built

Push; a notification row for the bells; the office's flow editor; in-app voice calls; pictures and files; assigning a conversation to one person; working hours. See ADR-0224 «Left for later».
