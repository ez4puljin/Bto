# ADR-0045: An AI assistant that answers questions with read-only SQL over curated views

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-13 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | ADR-0002 #8 (the first integration and flow service), architecture §3.1 rule 4 (`ai` reads like `reporting`), §10.2 (a third database role and pool) |
| Amended by | ADR-0076 (#2: finance views filter by company and are `security_barrier`; #5 and #9: the AI reader sets, on every query, the companies where the user holds `finance.read`) |

## Context

On 2026-10-13 the owner asked for an "Enterprise AI" module: reports and answers to questions in plain Mongolian, based on the company's own data (products, sales, customers). They asked for:

- a separate module that talks to a large language model (OpenAI, Anthropic or a local Ollama);
- base logic that turns a question into a database query safely ("Text-to-SQL");
- a guide for wiring it into the existing API and the web.

Three interview rounds settled the details:

| Topic | Answer |
|---|---|
| Provider | OpenAI first; the code also supports Anthropic and Ollama, chosen by configuration |
| Data sent to the provider | The question and the schema to write the SQL; then the first result rows, so the model writes a Mongolian summary |
| Who uses it | A new permission «AI асуулт», ADMIN only at first; the assistant sees every number, costs and credit included |
| Method | The model writes SQL; the system checks it with a parser and runs it with a read-only database role and limits |
| Data | Catalog; stock, movements and costs; customers, suppliers and credit; prices and discounts. Sales arrive with `sales` |
| Personal data | Phones, registration numbers and TINs, addresses and GPS points may be shown (the owner's decision, legal risk noted below) |
| Limits | None per user; every question is logged with its token counts |
| Keeping results | A history, an Excel download and «тайлан» (saved reports) that run again without the model |
| Conversation | Follow-up questions build on the earlier ones |
| SQL on screen | Shown, folded under «Яаж тооцсон» |
| Saved reports | Every holder of the permission sees and runs them; the author and an admin rename or delete them |
| When | Now: the base over today's data, growing with every module |

The system so far has no outbound HTTP call and no integration. The database has two roles, `app` and `migrator`, and no views.

## Decision

1. **Three layers.**
   - `apps/api/src/integrations/llm/` — the first integration. `LlmClient` with three adapters over Node's `fetch` (no SDK dependency): OpenAI Responses (`POST /v1/responses`, `text.format` JSON schema, `strict`, `store: false`), Anthropic Messages (`POST /v1/messages`, `output_config.format`, `anthropic-version: 2023-06-01`) and Ollama (`POST /api/chat`, `format` = JSON schema, `stream: false`). A request carries instructions, messages, an optional output schema and a token limit; a result carries the text, the model and the token counts. Errors are `LlmError` with a reason (`TIMEOUT`, `NETWORK`, `HTTP` with the status and the provider's short error code, `REFUSED`, `INCOMPLETE`, `INVALID_RESPONSE`) and never carry a request or response body. `LlmModule` (global) provides the token `LLM_CLIENT`, or `null` when no provider is configured; only the composition root imports it.
   - `apps/api/src/modules/ai/` — the module: the question flow, conversations, saved reports, Excel. It depends on `identity` only. Like `reporting` it reads other modules' data through SQL views of its own and is imported by nobody.
   - `apps/web/src/features/ai/` — «AI туслах» and «Тайлангууд».
2. **Curated views (the semantic layer).** A migration creates schema `ai` with views owned by `migrator`:
   - catalog: `categories` (with a precomputed path), `products`, `product_units`;
   - organisation and stock: `warehouses`, `stock`, `low_stock`, `stock_movements`, `stock_documents`, `receipt_lines`;
   - partners: `customers`, `customer_addresses`, `suppliers`, `product_suppliers`;
   - pricing: `prices_today`, `price_history`, `discount_programs`.

   Views list their columns explicitly, call built-in functions only and never use `security_invoker`. "Today" is `(now() AT TIME ZONE 'Asia/Ulaanbaatar')::date`. They never read `auth_sessions`, `password_resets`, `idempotency_keys`, `files`, `audit_log` or `import_rows`, and from `users` only `id` and `full_name`. A contract test checks this through `information_schema.view_column_usage`. One code catalog, `AI_DATASETS` (view, columns, English descriptions), feeds the prompt, the SQL guard and the tests; Mongolian names, a glossary and example questions live in `mn.json`.

   A few views repeat rules that live in services: a unit's derived price (base × factor, rounded half up), the low-stock status and a discount program's status. This is a deliberate exception to "shared rules are never re-implemented": integration tests compare each with `UnitPricesService`, `StockQueryService` and `DiscountProgramsService`. A later migration that changes a column a view uses recreates the view in the same migration; `sales` and `finance` add their views when they are built.
3. **The SQL guard** (`libpg-query` 18.1.5: the PostgreSQL 18 parser compiled to WASM, no build scripts). A statement passes only when:
   - it is exactly one `SELECT`, its CTEs are `SELECT`s and none is recursive;
   - every node of the parse tree is of an allowed type; JSON, XML, `ARRAY(subquery)`, `TABLESAMPLE`, `ROWS FROM`, `INTO`, locking clauses at any depth and parameters (`$1`) are refused;
   - every relation is an `AI_DATASETS` view, or a CTE in lexical scope (a schema-qualified name never matches a CTE);
   - every function, cast target and operator is on an allow-list (aggregates, arithmetic, dates, text, window functions). Functions that build large values or reach the server (`string_agg`, array and JSON aggregates, `generate_series`, `repeat`, `lpad`, `current_setting`, `set_config`, `pg_*`, `lo_*`, `query_to_xml`) are not on it;
   - the tree's depth, node count and concatenations, and the text length (8,000 characters), stay under limits.
4. **The read-only role `ai_reader`** (password from `AI_DATABASE_URL`, created by `pnpm db:provision` and the test harness):
   - privileges: `USAGE` on schema `ai`, `SELECT` on its views, `CONNECT`; nothing else. `PUBLIC` loses `CONNECT` and `TEMPORARY` on the database and every privilege on schema `public`; `app` and `migrator` keep their explicit grants. `migrate.ts` takes `app`'s default privileges on the `ai` views back;
   - role settings: `default_transaction_read_only`, `search_path = ai`, `timezone = Asia/Ulaanbaatar`, `statement_timeout` 30 s, `transaction_timeout` 60 s, `idle_in_transaction_session_timeout` 10 s, `client_connection_check_interval` 2 s, `CONNECTION LIMIT 4`; `temp_file_limit` where the provisioning user is a superuser (on DigitalOcean: TODO-VERIFY at go-live).
5. **Running a query** (`AiReaderService`, its own pool of `AI_POOL_MAX` connections, api only): `BEGIN READ ONLY`; `SET LOCAL` statement and lock timeouts, the Ulaanbaatar time zone, the search path, `work_mem`, `jit = off`, no parallel workers; `DECLARE ai_c NO SCROLL CURSOR FOR <sql>` (the final text is parsed again and must be one `DeclareCursorStmt`); `FETCH 501` in the extended protocol with array rows and raw string values; `ROLLBACK`; the connection is destroyed, so no session state or advisory lock survives. At most 500 rows are shown ("cut at 500"); an Excel export fetches up to 20,000 rows within 30 s.
6. **The question flow** (`AskFlowService`, a `*-flow.service.ts`; no HTTP call while a transaction is open, now also checked by ESLint):
   1. the instructions (rules, the datasets, the glossary, examples, `current_date` instead of literal dates so saved reports stay relative) and, in the user turn, the conversation's last five steps (question, SQL, summary) as a delimited JSON block marked as data;
   2. the model answers with `{ kind: query | clarify | unsupported, sql, explanation }`;
   3. the guard and the database run the SQL; a guard refusal or a database error is sent back once for a repair (never a timeout or a resource error);
   4. with rows, the model writes a short Mongolian summary from at most 50 rows (cells cut at 200 characters, 20 KB in all); without rows, the web says so from `mn.json`;
   5. the question is logged.

   Answers have a status: `ANSWERED`, `CLARIFY`, `UNSUPPORTED`, `REFUSED` or `FAILED`. Only the infrastructure raises errors: `AI_NOT_CONFIGURED` (503) and `AI_PROVIDER_FAILED` (502); a saved query that no longer runs (run again, Excel) is `AI_QUERY_FAILED` (422).
7. **Privacy** (the owner's decisions, 2026-10-13). The provider receives the question, the schema, earlier steps of the conversation and up to 50 result rows, which may contain names, phones, TINs, addresses and amounts. Secrets never reach it. The web shows summaries as plain text (no markdown, so a summary cannot load an image from elsewhere). Nothing logs prompts, answers or rows. Whether sending customer data abroad needs consent under Mongolia's personal data law is an open question for the owner (SPEC §11).
8. **History and reports.**
   - `ai_conversations` (per user); `ai_questions` (append-only like `audit_log`: who, when, the question, the SQL, the status, row count, duration, provider, model, tokens; never rows).
   - `ai_reports`: a name and the SQL copied on the server from one of the user's answered questions (never SQL from the client); soft-deleted and audited.
   - Running a question or a report again, and every Excel export, pass the guard again. A question is run again only by the person who asked it.
   - `POST /ai/questions` is idempotent; the idempotency interceptor gains `storeWithout` so the stored replay keeps no rows (a replay without rows makes the web run the question again).
9. **Permissions.** `ai.ask` «AI асуулт» (ask, own conversations, see, run and save reports). Its label says that the assistant shows costs, credit and personal data that `inventory.costs.manage` and `partners.customers.read` hide on screens. `ai.reports.manage` lets a holder rename and delete other people's reports. Both are ADMIN's and assignable to custom roles.
10. **Configuration** (api only, empty = unset): `LLM_PROVIDER` (`openai` | `anthropic` | `ollama`; unset turns the assistant off), `LLM_MODEL` (example `gpt-6-astra`; `gpt-6.1-sol` is cheaper), `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT_MS`, `AI_DATABASE_URL`, `AI_POOL_MAX` (required when the assistant is on). Keys live only in the gitignored `.env`; the worker's environment drops them. Tests never use a real key: the harness removes `LLM_*`.
11. **Excel numbers.** Numeric cells are written as numbers through a converter in `apps/api/src/common/excel/` (ESLint G3 covers modules only). Excel stores doubles; NUMERIC(14,2) amounts are exact in them. Large exports use the exceljs streaming writer.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| The model fills a structured query (JSON) and our code builds the SQL | Safest, but questions that join several datasets or need subqueries would not fit; the owner chose SQL checked by the system |
| SQL against the base tables | Credentials and audit data sit in the same schema, and every module's tables would become an API; curated views keep the boundary and give the model readable names |
| A regular-expression or hand-written SQL check | SQL is too rich (comments, quoting, nesting); the real PostgreSQL parser sees what the server will see |
| The `app` role with `SET TRANSACTION READ ONLY` | One mistake in the guard would read every table; a separate role limits what can be read at all |
| Provider SDKs | Three more dependencies for three small JSON calls; `fetch` keeps the code short and testable |
| Answers in a chat that keeps result rows | Rows are personal and commercial data; questions and SQL are enough to run them again |

## Consequences

**Positive.** The owner can ask in Mongolian and get tables, summaries, Excel files and reusable reports. Five independent barriers stand between a question and the data: the curated views, the parser, the read-only role, the read-only transaction with timeouts and caps, and the log.

**Negative.**
- Answers are only as good as the model and the views; a wrong but valid query returns wrong numbers. Showing the SQL lets people check.
- Data and costs leave the company to the provider (OpenAI by default), by the owner's choice.
- Views couple the `ai` schema to other modules' columns: migrations must keep them in step.
- A third role, pool and set of environment variables to provision and deploy.

**Follow-ups.**
- `sales` and `finance` add their views and `AI_DATASETS` entries.
- Go-live: `temp_file_limit` on the managed database; the provider's data retention terms.
- The owner seeks advice on sending personal data abroad (SPEC §11).
- Possible later: charts, scheduled reports, a monthly cost limit.

## Related

ADR-0002 #8, ADR-0013, ADR-0027, ADR-0030, ADR-0036, ADR-0041; `docs/modules/ai.md`; `docs/architecture.md` §3.1, §4, §5.11, §9.5, §10.2; `docs/SPEC.md` §5.15, §6.14, §11.
