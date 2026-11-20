# The ElevenLabs agent, as code

The phone AI order line's agent (ADR-0232 #15). Four files make it; `push.mjs` sends them.

| File | What |
|---|---|
| `agent.json` | the agent: language `mn`, the exact greeting as `first_message`, ASR `scribe_realtime` (pcm 16 kHz), TTS `eleven_v4_turbo` (pcm 16 kHz), LLM `claude-sonnet-5-5` (the owner, 2026-11-20; before that `claude-haiku-4-5`) with thinking off (`thinking_budget: 0`), temperature 0 and no parallel tool calls (the bridge runs one tool at a time, in order), time zone Asia/Ulaanbaatar, `turn_timeout` 8 s, `turn_eagerness` `patient` (waits longer before it takes the turn, so a caller who pauses mid-sentence is not cut off), `spelling_patience` `auto`, `silence_end_call_timeout` 40 s, `max_duration_seconds` 600 with a polite closing message, the client events the bridge reads, the dynamic variables' placeholders, and the `first_message` override enabled (a line's own greeting). Keys starting with `_` are notes and are not sent; `null` values are left out (a null `voice_id` keeps the provider's default voice) |
| `prompt.mn.md` | the Mongolian system prompt: the rules of ADR-0232 #15 and how to read each tool's answer and error code |
| `keywords.json` | `asr.keywords`: up to 50 brand words (each ≤ 20 characters, Scribe realtime's keyterm limits) the recogniser should prefer; checked by `push.mjs` |
| `tools.json` | the 8 tools, all `type: client`, `expects_response: true`; their parameters are the api's arguments (docs/modules/phone-agent.md §4, the zod schemas in `phone-tools.service.ts`), checked by `push.test.mjs` |

## Push (on the server, where the key is)

```sh
cd ~/bto
export PATH="$HOME/.local/opt/node/bin:$PATH"
set -a; . deploy/store/.env; set +a; node tools/call-bridge/agent/push.mjs
```

1. Each tool is looked up by name (`GET /v1/convai/tools?search=<name>`), updated with `PATCH
   /v1/convai/tools/{id}` or created with `POST /v1/convai/tools`.
2. Without `ELEVENLABS_AGENT_ID` in the environment: `POST /v1/convai/agents/create`, and the script
   prints `ELEVENLABS_AGENT_ID=agent_…` for `deploy/store/.env`. With it: `PATCH
   /v1/convai/agents/{id}`.
3. `--llm claude-haiku-4-5` pushes the same agent with the faster LLM (without it, the file's,
   Sonnet 5.5); to switch for good, change `prompt.llm` in `agent.json`. `--asr scribe_v3_live`
   tries the newer recogniser for one push. `--dry-run` prints the body and sends nothing.

## Keywords

`keywords.json` was made from the development database on 2026-11-20 (the brand words most sale-ready
products start with; that database has no order history). To put the most-ordered brands in their
place, run on the server against the real system's database and edit the file by hand (Cyrillic, as
the caller says it: «Пепси», not «Pepsi»):

```sql
SELECT lower(split_part(p.name, ' ', 1)) AS word, sum(l.qty_base) AS sold
FROM sales_order_lines l JOIN products p ON p.id = l.product_id
WHERE l.created_at > now() - interval '90 days'
GROUP BY 1 ORDER BY 2 DESC LIMIT 100;
```

then push again.

The key is read from `ELEVENLABS_API_KEY` and never printed; an error prints the HTTP status and the
provider's validation detail only. Tests: `node --test tools/call-bridge/agent/push.test.mjs` (a
fake provider; nothing leaves the PC).

## Checked against the provider's public docs (2026-11-20)

Confirmed on elevenlabs.io/docs: the WebSocket messages the bridge uses (AsyncAPI page of the
agent WebSocket); `POST /v1/convai/agents/create` → `{agent_id}`, `PATCH /v1/convai/agents/{id}`;
`POST /v1/convai/tools`, `PATCH /v1/convai/tools/{id}`, `GET /v1/convai/tools` (`search` is a name
prefix, `page_size` ≤ 100, `has_more`/`next_cursor`); `prompt.tools` is deprecated in favour of
`tool_ids`; `asr.provider` `scribe_realtime` (also `scribe_v3_live`, its successor); `tts.model_id`
`eleven_v4_turbo` (the default, Mongolian `mn` in its language list); the LLM ids
`claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5-5`; `turn.silence_end_call_timeout`,
`conversation.max_duration_seconds`, `agent.max_conversation_duration_message`,
`prompt.enable_parallel_tool_calls`, `prompt.timezone`; the override switch
`platform_settings.overrides.conversation_config_override.agent.first_message`.

Checked again on 2026-11-20 (the create-agent schema): `asr.keywords` (list of strings, «boosts
prediction probability», no limit stated for agents), `asr.quality` (`high` only), `asr.provider`
(`scribe_realtime`, `scribe_v2_turbo`, `scribe_v3_live`, …), `prompt.thinking_budget` (0 turns thinking
off where the model supports it), `prompt.reasoning_effort` (only some models; not set),
`turn.turn_eagerness` (`patient` / `normal` / `eager`), `turn.spelling_patience` (`auto` / `off`),
`turn.retranscribe_on_turn_timeout`, `turn.soft_timeout_config`; `claude-sonnet-5-5` and
`claude-haiku-4-5` in the LLM list. The 50 × 20-character keyterm limit is the speech-to-text API's
for Scribe v2 realtime; whether the agent applies the same limit, and how much keywords help
Mongolian, is not stated.

Not confirmed: that `mn` is accepted as the agent's `language` by the create call (it is in the
TTS and Scribe language lists, not stated for agents) and how well `scribe_realtime` recognises
Mongolian (ADR-0232's first stage-2 measurement); which voice speaks Mongolian best; whether a
literal parameter may carry `enum` together with `description` (the docs list both as fields, with
`description` the value source); whether a tool name already used by another tool of the workspace
should be reused (the script takes the first client tool of that exact name). A 422 from the
provider names the field.
