# Module `ai` — contract

Status: **being built** in delivery 2, 2026-10-13 (ADR-0045). The owner asked for an assistant that answers questions in Mongolian from the company's own data, makes reports and keeps them.

ai depends on `identity` (access decorators, audit, idempotency) in code and on `integrations/llm` for the model. It reads catalog, inventory, partners and pricing data only through its own views in schema `ai`, connected as the read-only role `ai_reader`. Nobody imports it.

## 1. Owner's answers behind the design (interview of 2026-10-13)

- **Provider.** OpenAI first; Anthropic and a local Ollama are supported and chosen by configuration.
- **Method.** The model writes SQL; the system checks it with the PostgreSQL parser and runs it read-only, with limits.
- **Data sent to the provider.** The question, the dataset descriptions, earlier steps of the conversation, and up to 50 result rows so the model writes a summary.
- **Data the assistant reads.** Catalog; stock, movements and costs; customers, suppliers and credit; prices and discounts. Sales and finance come with their modules.
- **Personal data.** Phones, registration numbers and TINs, addresses and GPS points are shown and may be sent to the provider. This is the owner's decision; the legal question is SPEC §11 #24.
- **Who.** A new permission «AI асуулт», ADMIN only at first.
- **Limits.** None per user; every question is logged with its token counts.
- **Keeping results.** History, Excel download, and saved reports that run again without the model.
- **Conversation.** Follow-up questions use the earlier steps.
- **SQL on screen.** Shown, folded under «Яаж тооцсон».
- **Saved reports.** Every holder of the permission sees and runs them. The author and an admin rename or delete them.

## 2. Owned tables and views (migration `0017_ai`)

| Table | What | Guards |
|---|---|---|
| `ai_conversations` | a person's conversation: owner, title (the first question, cut), created / updated | owner only (404 otherwise) |
| `ai_questions` | one asked question: conversation, asker, question, kind (`QUERY` / `CLARIFY` / `UNSUPPORTED`), SQL, explanation, summary, status, row count, truncated, duration, provider, model, input / output tokens, error code, created_at | append-only like `audit_log` (`REVOKE UPDATE, DELETE, TRUNCATE` + the `forbid_update_delete` trigger); never result rows |
| `ai_reports` | a saved report: name, SQL copied on the server from an answered question, source question, creator, deleted_at | soft delete; audited |

Schema `ai` holds views owned by `migrator`; `ai_reader` has `USAGE` on the schema and `SELECT` on the views, `app` has neither. Every view lists its columns explicitly, calls built-in functions only and has no `security_invoker`; "today" is `(now() AT TIME ZONE 'Asia/Ulaanbaatar')::date`.

| View | One row per |
|---|---|
| `ai.categories` | category, with its full path and code range |
| `ai.products` | product, with its category path, status and readiness |
| `ai.product_units` | current unit of a product, with its factor and barcodes |
| `ai.warehouses` | warehouse, with its branch |
| `ai.stock` | warehouse × product: on hand, sellable, average cost, value, min / max, home shelf |
| `ai.low_stock` | product below its minimum in its home warehouse |
| `ai.stock_movements` | ledger line, with the document number, warehouse, shelf and cost |
| `ai.stock_documents` | stock document header (receipts, bin moves, adjustments, stocktakes, transfers) |
| `ai.receipt_lines` | goods-receipt line, with the supplier and the unit cost |
| `ai.customers` | customer, with contact, tax and credit fields |
| `ai.customer_addresses` | customer address, with GPS |
| `ai.suppliers` | supplier, with contact and bank fields |
| `ai.product_suppliers` | product × supplier link |
| `ai.prices_today` | price list × current unit: today's price, its own or derived (base × factor) |
| `ai.price_history` | unit price period |
| `ai.discount_programs` | discount program, with its status today and its steps as text |

The views never read `auth_sessions`, `password_resets`, `idempotency_keys`, `files`, `audit_log` or `import_rows`, and from `users` only `id` and `full_name`. `AI_DATASETS` (`semantic/datasets.ts`) describes every view and column in English. The prompt, the guard and the tests all use it. Mongolian names, the glossary and example questions live in `mn.json` (`ai.datasets`, `ai.glossary`, `ai.examples`).

## 3. Public API

None: nothing imports `modules/ai`. Inside the module:

| Piece | Use |
|---|---|
| `AskFlowService` (`ask-flow.service.ts`) | `status()`, `ask(actor, { conversationId?, question })`: prompt → model → guard → reader → one repair → summary → log; it runs between transactions |
| `sqlGuard(sql)` (`sql/sql-guard.ts`) | parses with `libpg-query` and returns `{ ok: true, sql }` or `{ ok: false, reason }` |
| `AiReaderService` (`sql/ai-reader.service.ts`) | `run(sql, { maxRows, timeoutMs })` → columns, rows (strings), truncated; the pool over `AI_DATABASE_URL` is created on first use |
| `ConversationsService`, `ReportsService` | history and saved reports |
| `AI_DATASETS`, `buildInstructions()` (`semantic/`) | the semantic catalog and the prompt |

## 4. REST surface (`/api/v1/ai`)

| Route | Access | Notes |
|---|---|---|
| `GET /ai/status` | `ai.ask` | `{ configured, provider, model }` (never the key) |
| `POST /ai/questions` | `ai.ask`, Idempotency-Key | `{ conversationId?, question }` → the answer: conversation, question id, status, kind, explanation, summary, SQL, columns, rows (≤ 500), truncated. A replay returns the stored answer without rows; the web then calls `run` |
| `GET /ai/conversations` | `ai.ask` | own conversations, newest first, keyset |
| `GET /ai/conversations/:id` | `ai.ask` | own conversation with its questions (no rows) |
| `POST /ai/questions/:id/run` | `ai.ask` | the asker only: the SQL again (guard + reader) → columns, rows |
| `GET /ai/questions/:id/export` | `ai.ask` | the asker only: `.xlsx`, up to 20,000 rows |
| `GET /ai/reports`, `POST /ai/reports` | `ai.ask` | list; save `{ questionId, name }` from one's own answered question |
| `PATCH /ai/reports/:id`, `DELETE /ai/reports/:id` | `ai.ask` (creator) or `ai.reports.manage` | rename; soft delete |
| `POST /ai/reports/:id/run`, `GET /ai/reports/:id/export` | `ai.ask` | run again; `.xlsx` |

## 5. Rules worth knowing

- **Five barriers.** The curated views, the parser guard, the read-only role, the read-only transaction with timeouts and caps, and the log. Each would stop most mistakes on its own.
- **The guard.**
  - Exactly one `SELECT`; CTEs are `SELECT`s and never recursive.
  - Every node of the parse tree is of an allowed type; relations are `AI_DATASETS` views or CTEs in lexical scope (a schema-qualified name never matches a CTE).
  - Functions, casts and operators come from allow-lists.
  - No `INTO`, locking clause or parameter. The depth, node count, `||` count and length (8,000 characters) are limited.
- **The reader.**
  1. `BEGIN READ ONLY`, then separate `SET LOCAL`s: statement 15 s, lock 2 s, time zone, search path, `work_mem`, `jit = off`, no parallel workers.
  2. `DECLARE ai_c NO SCROLL CURSOR FOR <sql>`; the final text is parsed again and must be exactly one `DeclareCursorStmt`.
  3. `FETCH 501`: array rows, raw strings.
  4. `ROLLBACK`; the connection is destroyed.

  A timeout (57014) or a resource error (53xxx, 54xxx) is never sent back to the model for a repair.
- **The role** `ai_reader` (provisioned): `default_transaction_read_only`, `search_path = ai`, `timezone = Asia/Ulaanbaatar`, `statement_timeout` 30 s, `transaction_timeout` 60 s, `idle_in_transaction_session_timeout` 10 s, `client_connection_check_interval` 2 s, `CONNECTION LIMIT 4`; `temp_file_limit` only where the provisioning user is a superuser.
- **The prompt.**
  - The rules and the datasets, the glossary and examples from `mn.json`.
  - `current_date` instead of literal dates, so a saved report stays relative.
  - The last five steps (question, SQL, summary) go in the user turn as a delimited JSON block, marked as data.
- **The summary.** Written from at most 50 rows (cells cut at 200 characters, 20 KB in all) and shown as plain text. Without rows the web says so from `mn.json`.
- **Statuses.** `ANSWERED`, `CLARIFY` (the model asks back), `UNSUPPORTED` (the data is not there), `REFUSED` (the guard refused twice), `FAILED` (the database failed). Each is a normal 200 answer.
- **Others' data.** A conversation or question of someone else is 404. A report's SQL is always copied on the server; SQL from the client is never accepted. Every run and export passes the guard again.

## 6. Error codes introduced

`AI_NOT_CONFIGURED` (503: no provider, or no `AI_DATABASE_URL`), `AI_PROVIDER_FAILED` (502: timeout, HTTP error, refusal, unreadable answer; `params.reason`). Also used: `NOT_FOUND`, `FORBIDDEN`, `VALIDATION_FAILED`, `IDEMPOTENCY_KEY_IN_PROGRESS`.

## 7. Audit

`ai_reports` CREATE, RENAME, DELETE. Questions are their own log (`ai_questions`).

## 8. Screens (`apps/web`)

- **«AI туслах»** (`/ai`, menu «AI», `ai.ask`):
  - the conversations on the left, with «Шинэ яриа»;
  - the steps of the open conversation, each answer as a card: the summary as plain text, the table (numbers right-aligned, a note when cut at 500), «Яаж тооцсон» with the SQL folded, «Excel татах», «Тайлан болгох»;
  - the question box at the bottom: Enter sends; «Бодож байна…» while waiting; no double sending.

  An empty conversation shows example questions. When the assistant is not configured, a notice says what to set.
- **«Тайлангууд»** (`/ai/reports`): the saved reports with «Ажиллуулах», «Excel татах», rename and delete.
- Home: the quick action «AI-аас асуух».

## 9. Tests

To be written with slices B–F:

- **Unit.** The LLM adapters (request shapes, parsing, errors) with a fake `fetch`; the guard (allowed and refused queries).
- **Integration.**
  - The views (every column; prices, low stock and discount status against their services) and the view contract.
  - The reader: timeout, the 500-row cut, the Ulaanbaatar date, the destroyed connection.
  - The flow with a scripted fake `LLM_CLIENT`, the API, reports and export.
- **Integrity.** `ai-reader-role` (what `ai_reader` cannot do) and the append-only `ai_questions`.
- **Web.** The pages.

## 10. Configuration

`LLM_PROVIDER` (`openai` | `anthropic` | `ollama`; empty = off), `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT_MS`, `AI_DATABASE_URL` (role `ai_reader`), `AI_POOL_MAX`. All are api only, and empty means unset. The key lives only in the gitignored `apps/api/.env`. Tests never see it: the harness deletes `LLM_*`.

## 11. Opening a module's data to the assistant

When `sales`, `finance` or another module is built:

1. Add views in schema `ai` in that module's migration.
2. Add their `AI_DATASETS` entries and the Mongolian names in `mn.json`.
3. Extend the view contract test.

A migration that changes a column an `ai.*` view uses recreates the view in the same migration.

## 12. Open items

- SPEC §11 #24 (legal advice on sending personal data abroad) and #25 (provider retention terms, monthly budget).
- `temp_file_limit` on the managed database at go-live (architecture A6).
- Later, if asked: charts, scheduled reports, a monthly cost limit.
