# ADR-0162: The AI's connection on the settings screen, data groups per role, limits and a usage meter

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-06 |
| Deciders | Owner (2026-11-06: «ai чат өгөгдөл өөрчилж чадах уу?», «/system/status дотор ai credit хэрэглээ харагддаг байх. Мөн холбоотой байгаа эсэх», «/settings ai api холболт хийдэг болго. Эрхийн тохиргоог сонгож болох уу? Хэрэглээний хязгаарлалт зэрэг.») with Claude Code |
| Supersedes | ADR-0045 #10 where a key lives («Keys live only in the gitignored `.env`») |
| Amends | ADR-0045 #1 «Limits: none per user» and its «a monthly cost limit» follow-up; ADR-0045 «Who»: `ai.ask` no longer opens every view |

## Context

The owner connected `/ai` to Claude on 2026-11-06 by editing `apps/api/.env`, and the key landed on the wrong line, which stopped the api from starting. A key in a file on the server is hard for a non-developer owner to change, and every change needs a restart.

Reading the code to answer the owner's question showed a real gap: whoever holds `ai.ask` reads all 23 views, costs and customers' phones included, whatever their other rights say. It has been harmless only because ADMIN alone holds it.

The owner answered three questions: seal the key in the database; choose the data per role; stop at the limit (2026-11-06).

## Decision

### 1. The assistant stays read-only

No setting lets the assistant change data. ADR-0045's five barriers stand. A data group decides what it may read, never whether it may write.

### 2. The connection is saved on the settings screen

- `ai_settings` (migration `0079_ai_settings`, one row, module `ai`) holds the switch, the provider, the model, the key, the prices and the limits.
- The key is sealed with AES-256-GCM under `AI_KEY_SECRET` (32 bytes in base64, api only, like `JWT_SECRET`; `modules/ai/services/secret-box.ts`), bound to its column by additional data. A database backup alone does not reveal it.
- The key is written and never read back: `PATCH /ai/settings` takes it, no response, audit row or log carries it, and the screen shows only its last four characters. `ai_reader` cannot read the table.
- A saved connection overrides the `.env`; with none saved, the `.env` stays in force, so an installation need not change. Removing the saved connection returns to the `.env`.
- The switch stops every model call, whatever the `.env` says. Saved reports need no model and keep running.
- A key never follows a connection to another provider: changing the provider drops the saved key. A key goes only to its provider's own address: a typed address is accepted only for Ollama, which takes no key.
- A saved key works at once, with no restart: `LlmGateway` reads the connection at every call, and tests replace its `LLM_FETCH`.
- A wrong or changed `AI_KEY_SECRET` leaves the assistant off and the page saying so («KEY_UNREADABLE»); the key is typed again. Without the secret, saving a key answers 503 `AI_KEY_SECRET_MISSING`.

### 3. Data groups per role

- Seven permissions `ai.data.catalog`, `stock`, `customers`, `suppliers`, `pricing`, `sales`, `finance` each open a fixed set of views (`semantic/data-groups.ts`; a test fails on a view left out).
- A group goes by view, not by column: a view shows all its columns to the group's holder, so `sales_orders` shows the customer's name without `customers`.
- The prompt describes only the person's views, glossary and examples; the SQL guard refuses any other view (`DATA_ACCESS`); the reader's `access` argument is required, so no caller can forget it.
- A saved report or an earlier question that reads outside the person's groups answers 403 `AI_DATA_FORBIDDEN`, and so does `ai.ask` with no group at all.
- ADMIN holds every group. System roles other than ADMIN have their rights from the code, so the screen's switches are for custom roles, like every other right (ADR-0027 #5).
- `ai.settings.manage` covers the connection, the limits and the usage page. Holders of `ai.ask` see only a state without amounts.
- A conversation's earlier steps are the person's own; a rights change does not rewrite them.

### 4. Limits stop new work

- `monthly_budget_usd`: the calendar month in Asia/Ulaanbaatar. Once the recorded cost reaches it, new questions and invoice checks answer 429 `AI_BUDGET_REACHED`; from 80 % the status page and `/ai` warn. Empty: no limit.
- `user_daily_questions`: questions a person may ask in a day; past it 429 `AI_USER_LIMIT_REACHED`. Empty: no limit.
- The limit is checked once before the work starts and a question in progress finishes, so two at once can pass the limit by a little. A paid-for answer is not thrown away to be exact.
- A month's limit needs a price: saving one for a model of unknown price answers 422 `AI_PRICE_REQUIRED`, so it cannot silently fail to stop.

### 5. The meter counts what the provider answered

- `ai_usage` (append-only like `ai_questions`): one row per answered call, with its purpose (`ASK`, `INVOICE_CHECK`), person, model, tokens and the cost at that day's price. Never the prompt or the answer. History before this decision is not back-filled.
- The invoice check was not counted before; it now counts, and stops at the limit too.
- Prices are a catalog in code (`AI_MODEL_CATALOG`, read from the provider's page on 2026-11-06), which the admin may override per connection. Costs are estimates: the provider's bill is what counts.
- The provider has no call for the credit left, so the page shows Bto's own count and links to the provider's billing page. The status page's connection check is a free request about the model, which spends no tokens, kept 5 minutes unless someone asks again. It does not prove there is credit: an empty account fails only on a real question, and then the page shows the last failure, «credit» included.

## Consequences

- One more secret: `AI_KEY_SECRET` in `.env`, `deploy/.env.example`, the runbook; the entrypoint removes it from the worker.
- A lost `AI_KEY_SECRET` costs only retyping the key, at the provider's console.
- A custom role holding `ai.ask` today would see nothing until it gets groups. None exists on the owner's database.

## Alternatives rejected

| Alternative | Why not |
|---|---|
| Keep the key in `.env`, settings only for the model and limits | The owner chose otherwise; each key change would need a file edit and a restart |
| Derive the sealing key from `JWT_SECRET` | Rotating the sign-in secret would lose the AI key; two uses of one secret |
| A table of role × data group | The role page, `AuthContext` and the guards already work with permissions; a second mechanism would have to match them |
| The provider's Admin API for real costs | It needs an organization's admin key and still gives no balance |
| Stop mid-question at the limit | The tokens are already paid for; the person would get nothing for them |

## Related

ADR-0045, ADR-0122 (the invoice check), ADR-0027 #5, `docs/modules/ai.md`, `deploy/runbook.md`.
