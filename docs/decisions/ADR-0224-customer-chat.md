# ADR-0224: A customer chat in «Bto300»: a scripted bot first, staff on request

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-19 |
| Deciders | Owner (2026-11-19: one conversation per customer; a scripted bot with the buttons «Захиалгын төлөв», «Хүргэлтийн мэдээлэл», «Тооцооны үлдэгдэл», «Ажлын цаг, хаяг» and «Ажилтантай холбогдох»; the store's sales rep answers first and the office can answer too; staff are told outside working hours as well; «Залгах» calls the sales rep; a flow the office draws itself comes later), Claude (the brain and a `bto-core` worker) |
| Migration | `0114_chat` (three new tables, nothing else changed) |
| Amends | ADR-0061 #5 (the SALES_REP role held the rep app's right only: it now also holds `chat.answer_own`); architecture §4 (a new module `chat`) and §10.2 (one more listener connection per api process that serves a chat stream) |
| Related | ADR-0079 (the customer app; push at go-live), ADR-0082 (customer routes), ADR-0062 (app notices), ADR-0173 #4 (live streams over LISTEN/NOTIFY), ADR-0183 (the reps' weekly rounds), ADR-0192 (api replicas), ADR-0045 (the AI assistant, which the chat does not use) |

## Context

A store that uses «Bto300» can order, read its balance and see the company's contact people, but it cannot ask anything in the app. The owner wants a chat: the common questions answered at once by a bot from the system's own data, and a person when the store asks for one. The owner's picture of the bot is a flow drawn in the office (nodes «message», «action: add a tag», «wait N hours», «question with buttons», «notify admin»); that editor is a later piece, and what is built now must not stand in its way.

Three facts of the system shape the design. A customer token reads only its own store and a customer is never an `Actor` (ADR-0079, ADR-0082). The apps' routes run on several api processes (ADR-0192), so the store and the staff member who answers it are usually on different ones. And a customer has no sales rep column: the only link between a rep and a store is the rep's weekly round (`rep_visit_plans`, ADR-0183).

## Decision

1. **One conversation per store, kept for good.** `chat_conversations` has one row per customer (unique). It belongs to the customer, not to the app account (`customer_users`): the account is the sign-in phone, which the office may change, and the rep, the orders and the balance are the store's. A message (`chat_messages`) is text, written once and never changed or removed (the database refuses UPDATE and DELETE to the app's role). Its sender is `CUSTOMER` (with the app account that wrote it), `BOT`, or `STAFF` (with the staff user). A bot message may carry buttons (`[{ id, label }]`); a customer message that was a pressed button carries the button's id and the label as its text.
2. **The bot is scripted, never a language model.** It calls neither `integrations/llm` nor the `ai` module. Opening the chat the first time writes its greeting with five buttons, in this order: «Захиалгын төлөв», «Хүргэлтийн мэдээлэл», «Тооцооны үлдэгдэл», «Ажлын цаг, хаяг», «Ажилтантай холбогдох». Every bot answer offers them again, the last one always.
   - «Захиалгын төлөв»: the store's own three latest orders — number, day, and the state in the words the app's order list already uses (`sales.customerStates`).
   - «Тооцооны үлдэгдэл»: what «Тооцоо» already shows the store — the debt or the advance, what is overdue, with a credit limit what is left of it, and «Зээл хаалттай» without its reason. Nothing about stock or costs.
   - «Хүргэлтийн мэдээлэл» and «Ажлын цаг, хаяг»: a text the office edits. With the greeting they are the module's three settings (`chat_settings`, one row; null = the built-in default). The defaults promise nothing: no delivery time, price or hour is invented.
   - Typed text that repeats a button's label is that button. Any other typed text gets one answer, «choose a button», with the buttons; further typed texts in a row get no second one, and the buttons stay offered. The bot never guesses.
   - The answers are computed when asked and stored as text, so the history shows what the store was told.
3. **Hand-off.** «Ажилтантай холбогдох» moves the conversation to `STAFF`: the bot says so and is then silent. A staff member may also take over a conversation the store has not handed off, simply by answering it. A staff member closes a conversation: it goes back to `BOT`, the bot writes a closing note with the buttons, and the next message starts with the bot again. Closing removes nothing.
4. **Who answers: the rep first, the office as well.** There is no assignment and no queue: every staff member whose scope holds the store sees the conversation and may answer it. «The store's sales rep» is every active rep on whose weekly round the store stands, read through the sales module's public index; «Залгах» in the app calls the first of them (lowest user id), and the open route returns that rep's name and phone, or null — the app then shows «Холбоо барих». No in-app voice call.
5. **Rights.** Three new codes:
   - `chat.answer` — read, answer and close every store's conversation. ADMIN (which holds every code) and **OFFICE** by default: the office already links stores to the app, enters their orders and reads their balances, so it is the role that answers them. ACCOUNTANT, WAREHOUSE and the others get it only by an admin's tick on «Дүр».
   - `chat.answer_own` — the same, only for the stores on the caller's own round. **SALES_REP** by default (this amends ADR-0061 #5).
   - `chat.settings.manage` — the three texts. ADMIN only by default, named like the other modules' settings rights.
   The staff routes are `@Authenticated()` and the service decides the scope (a route decorator takes one code, the chat has two): with neither code every staff route answers 403, a conversation outside the scope 404.
6. **Told in the app, at any hour.** There is no business-hours rule. Push does not exist yet (ADR-0079), so «told» means the chat's own counters and the live stream: for staff the conversations awaiting an answer and the stores' unread messages (`GET chat/unread`), for the store the messages that reached it unasked — a staff answer, the closing note (`GET customer-app/chat/unread`). A bot answer to the store's own question is read at birth and is not counted. The staff's read mark is one per conversation, shared by everyone who answers it. No row is written into `user_notifications`: the web bell and the rep app's bell know one kind today (a sold order) and their screens would need a second one; the chat's own badge does the work until push.
7. **Live over LISTEN/NOTIFY.** Every chat write calls `pg_notify('bto_chat', '<conversation>:<customer>:<message or 0>')` inside its transaction; PostgreSQL delivers it at commit to every api process. Each process that has a chat stream open holds one dedicated listening connection (`ChatHub`, the pattern of ADR-0173 #4: connected with the first stream, liveness check, reconnect with backoff, `resync` after a gap), reads the conversation and the message once, and sends them to the store's stream (`customer-app/chat/live`) and to the staff streams whose scope holds the store (`chat/live`). No state is fed by a direct call, so the store on one replica and the staff member on the primary both hear it. The proxy does not compress `*/chat/live`.
8. **The flow is behind an interface.** `ChatFlow` (`greet`, `answer`, `closed`) returns what the bot says next — a text, buttons, whether it hands off, and the name of the step (`flow_node`); the chat service writes it. The scripted flow is its one implementation. A button's id and a step's name are opaque strings in the tables, so a flow the office draws can offer its own without a change of `chat_messages`.
9. **Limits.** A written message is 1–1,000 characters; a store may send 12 messages a minute (429 beyond); sends carry an `Idempotency-Key`, so a phone's retry writes one message.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The AI assistant answers the stores | The owner asked for a scripted bot. A model would also need a customer-safe view of the data and would send store text to a provider (ADR-0045 keeps both away from customers) |
| The conversation belongs to the app account | A changed sign-in phone would lose the history; the rep and the figures are the store's |
| A rep column on the customer | A business rule the owner has not given; the round already says who visits the store |
| One right `chat.answer` for the rep too, narrowed by role | A custom role could not be told apart from the office; two codes say what each holder sees |
| Bot answers as structured data the apps render | Three clients would each format orders and money, and the history would change when a format does; the owner asked for text |
| A row in `user_notifications` per waiting conversation | Widens the notifications module and its two bells for what the chat's badge already shows; right when push is built |
| Events through the process's memory | The store and the staff member are on different replicas (ADR-0192) |
| Sharing the live stock listener's connection | It would tie sales' hub to the chat; one more connection per process is cheap (below) |

## Consequences

**Positive.** A store gets its order states and balance in the chat at once and a person when it asks; the rep and the office see the same conversation; nothing is lost when a process restarts. **Negative.** Nobody is told outside the apps until push exists: a store that leaves the chat sees a staff answer only as a badge. One read mark per conversation means a rep cannot tell whether the office has read it or only they have. A store on several reps' rounds is every one of those reps' to answer, and «Залгах» calls one of them. **Connections.** One more per api process with a chat stream open: on the PC of ADR-0187 the primary and four app replicas, 92 → 97 of 200. **The formula of «Зээлийн үлдсэн боломж»** (the limit less the balance and the confirmed orders not yet invoiced) now stands in two places, the customer module and the chat's bot, because nobody may import the customer module; a change of one must change the other.

## Left for later

- **Push** to the store and to staff (ADR-0079: at go-live), and with it a notification row per waiting conversation.
- **A flow editor in the office**, as in the owner's picture: nodes «message», «action: add a tag», «wait N hours», «question with buttons», «notify admin». It replaces the scripted flow behind `ChatFlow`; «wait» and «notify» need a job and the flow's position per conversation (new columns or a table, not a change of the messages).
- **In-app voice calls.** «Залгах» dials the rep's phone.
- Pictures and files in a message; assigning a conversation to one person; working hours and an auto-reply outside them; the chat's data for the AI assistant and the reports.
