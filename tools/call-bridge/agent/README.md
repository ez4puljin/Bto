# The ElevenLabs agent, as code

The phone AI order line's agent (ADR-0232 #15). Three files make it; `push.mjs` sends them.

| File | What |
|---|---|
| `agent.json` | the agent: language `mn`, the exact greeting as `first_message`, ASR `scribe_realtime` (pcm 16 kHz), TTS `eleven_v4_turbo` (pcm 16 kHz), LLM `claude-haiku-4-5` with temperature 0 and no parallel tool calls (the bridge runs one tool at a time, in order), time zone Asia/Ulaanbaatar, `turn_timeout` 8 s, `silence_end_call_timeout` 40 s, `max_duration_seconds` 600 with a polite closing message, the client events the bridge reads, the dynamic variables' placeholders, and the `first_message` override enabled (a line's own greeting). Keys starting with `_` are notes and are not sent; `null` values are left out (a null `voice_id` keeps the provider's default voice) |
| `prompt.mn.md` | the Mongolian system prompt: the rules of ADR-0232 #15 and how to read each tool's answer and error code |
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
3. `--llm claude-sonnet-4-6` (or `claude-sonnet-5-5`) pushes the same agent with another LLM for the
   stage-2 comparison; without it, the file's (Haiku 4.5). `--dry-run` prints the body and sends
   nothing.

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

Not confirmed: that `mn` is accepted as the agent's `language` by the create call (it is in the
TTS and Scribe language lists, not stated for agents) and how well `scribe_realtime` recognises
Mongolian (ADR-0232's first stage-2 measurement); which voice speaks Mongolian best; whether a
literal parameter may carry `enum` together with `description` (the docs list both as fields, with
`description` the value source); whether a tool name already used by another tool of the workspace
should be reused (the script takes the first client tool of that exact name). A 422 from the
provider names the field.
