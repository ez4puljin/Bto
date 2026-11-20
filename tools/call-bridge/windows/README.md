# The Windows call bridge (stage 2)

The PC side of the phone AI order line (ADR-0232). For one call it asks Bto whether to answer,
holds the ElevenLabs conversation over the signed URL Bto hands it, carries the audio between the
conversation and the PC's sound devices, forwards each of the agent's client tools to Bto over the
LAN and stores the transcript in Bto. Stage 2 needs no phone: a test call starts at the console
with the caller's number given by hand, and the owner talks through a headset. The owner's steps,
in Mongolian: [README.mn.md](README.mn.md).

## Install (Windows 10/11, 64-bit, no administrator needed)

An ordinary PowerShell window, the line Bto's station page shows:

```powershell
[Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows/install.ps1))) -Server 'http://192.168.1.250' -Key 'bpl_1_...'
```

`install.ps1` puts everything in `%LOCALAPPDATA%\BtoCall`:

| Path | What |
|---|---|
| `python\` | Python 3.12.10, the official embeddable zip from python.org (SHA-256 pinned in the script). Chosen over the python.org installer because it needs no administrator, registers nothing in Windows and cannot collide with another Python on the PC. `python312._pth` turns on `import site` and adds `..\app` |
| `python\Lib\site-packages\` | `requirements.txt`, installed by pip (its zipapp, SHA-256 pinned) with `--require-hashes --only-binary=:all:`: websockets 17.4, numpy 2.5.4, sounddevice 0.5.6 (with its own PortAudio DLL), soxr 1.1.0, cffi, pycparser |
| `app\btobridge\` | the bridge |
| `config.json` | `server`, `key`, `mode` (`local`), `input_device`, `output_device` (an index or a part of the name, null = Windows' default), `chunk_ms` (100), `max_call_s` (600), `silence_s` (40), `grace_s` (15) |
| `metrics.csv` | one row per call, numbers only (below) |
| `bridge.log` | ids, milliseconds, counts and error codes only; rotated at 1 MB |

It also registers the scheduled task «Bto call bridge» (at the user's sign-in, `pythonw -m
btobridge serve`: the station's heartbeat, so the line's page shows it connected; stage 3 adds the
Android link there). Windows may refuse a sign-in task to an account that is not an administrator;
the script then puts a shortcut in the user's Startup folder instead. The desktop shortcut «Bto AI
call» opens the console menu. `uninstall.ps1` removes all of it. Network once: python.org,
bootstrap.pypa.io and pypi.org (files.pythonhosted.org); after that only the LAN to Bto and
`wss://api.elevenlabs.io`.

`requirements.txt` is generated here with hashes for Windows:

```sh
uv pip compile requirements.in --python-platform x86_64-pc-windows-msvc --python-version 3.12 \
  --generate-hashes --only-binary :all: --exclude-newer <a date two weeks back> --no-header -o requirements.txt
```

## Commands (`python -m btobridge …`)

| Command | What |
|---|---|
| (none) | the menu: test call from a number / a withheld number, the numbers, a check, the devices |
| `call --caller +976XXXXXXXX` | a test call as if that number rang; Ctrl+C is the caller hanging up; `--no-audio` without sound devices |
| `report --last 20` | response time median and p90, greeting, searches and no-hit searches over the last N calls |
| `devices` | the WASAPI microphones and speakers with their numbers |
| `check` | `GET /phone-agent/station`: the line, on or off, working hours now, the agent on the server |
| `serve` | the background task (heartbeat every 60 s) |

## One call (`btobridge/session.py`)

1. `POST /phone-agent/calls` (an Idempotency-Key, no retry: a replay carries no signed URL).
   `answer: false` → printed with its reason, the phone «rings for staff», nothing more. No
   `signedUrl` → not answered, the call ended as ERROR.
2. The WebSocket of the signed URL (6 s); the first message is
   `conversation_initiation_client_data` with the api's `dynamicVariables`, and
   `conversation_config_override.agent.first_message` only when the line has its own greeting.
3. After `conversation_initiation_metadata`: the conversation id, the agent's audio format and the
   microphone format (`pcm_<rate>`); then the microphone goes out as `{"user_audio_chunk": base64}`
   of 16-bit mono PCM in `chunk_ms` pieces (100 ms: each piece waits until it is full, so a shorter
   one lets ElevenLabs hear the end of a sentence sooner).
4. `audio` is played (resampled to the device); `interruption` flushes the playback and drops every
   later `audio` whose `event_id` is not above the interrupted one; `ping` → `pong` with its
   `event_id`.
5. `user_transcript` and `agent_response` take the next `seq` in the WebSocket's order and go to
   `POST /calls/:id/events` in batches (each second, ≤ 200, a fresh Idempotency-Key per batch; a
   resent turn changes nothing on the server).
6. `client_tool_call` takes the next `seq` when it arrives. The tools run one at a time: first every
   buffered turn is stored (the server's «no order without yes» reads them; if Bto does not take
   them, the tool is NOT forwarded and the agent gets `BTO_UNAVAILABLE`), then `POST
   /calls/:id/tools/:name {afterSeq: seq-1, seq, atMs, args}` (retries reuse the key), then
   `client_tool_result` with the answer as JSON, or `{"error": "<code>"}` with `is_error: true`.
7. The end: after `end_call`, once the goodbye has played and 1.2 s passed quietly (8 s at most);
   Ctrl+C (`CALLER_HANGUP`); the provider closing (its `max_duration_seconds` 600 and
   `silence_end_call_timeout` 40 end politely first: `TIMEOUT` / `SILENCE` by the bridge's own
   clocks, else `COMPLETED`); the bridge's backstop 15 s beyond those limits; Bto gone for 20 s
   after a failed tool (`ERROR`). Then the last turns, `POST /calls/:id/end {reason, durationS,
   conversationId}`, the numbers on the screen and a row in `metrics.csv`.

Bto unreachable at the start: a clear line, no call. ElevenLabs unreachable: the call is ended as
ERROR. `serve` never crash-loops: a failure waits a minute.

## The numbers (`btobridge/metrics.py`)

- **Response time** per answer: from the end of the caller's speech to the agent's first audio
  chunk. The end of speech is the last voiced 20 ms frame of the bridge's own energy detector before
  ElevenLabs' `user_transcript` (within 5 s and after the agent last spoke); without one, the
  transcript's arrival. Also the time from the transcript alone (`asr_median_ms`), which leaves out
  ElevenLabs' end-of-turn wait. The chunk is timed when it arrives, before the PC's own playback
  buffer (about 20–40 ms more).
- **Greeting**: from Bto's answer to `POST /calls` to the first agent audio.
- **Searches / no-hit searches**: `search_products` answers, and those with no product.
- `metrics.csv`: `ended_unix, call_id, duration_s, end_reason, turns, latency_median_ms,
  latency_p90_ms, asr_median_ms, greeting_ms, searches, no_hits, tools, tool_errors,
  tool_median_ms, latencies_ms` (the samples, `;`-separated). `report` takes the median and p90
  over every sample of the last N calls.

## Seams for stage 3

- `audio.AudioPort`: `LocalAudio` now; `cable` (the USB sound card wired to the phone) and
  `bluetooth` (Phone Link: WASAPI loopback of the call, the agent into a VB-Cable input) are modes
  of `config.json` that raise «stage 3» until built.
- `phone.PhoneLink`: `LocalPhone` now; `AndroidLanPhone` will hold the LAN WebSocket to the line's
  Android app (`ringing {callRef, caller}` → `answer` / `decline` within 3 s, `hangup`, `ended`).

## Tests (Linux, no sound hardware)

```sh
cd tools/call-bridge/windows
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python websockets==17.4 numpy==2.5.4 soxr==1.1.0 pytest
.venv/bin/python -m pytest -q tests
```

`tests/fakes.py` scripts the ElevenLabs conversation and records Bto's requests: the order of turns
and tools, the flush before a tool, interruption, ping, the limits, the declines, the failures,
the metrics, and that no word of a call reaches the log or the console.

## Not verified here

The sound devices on a real Windows PC (WASAPI defaults, the device's own sample rate and channel
count) and the install script itself were not run on Windows in this stage's build; the first
installation on the owner's PC is that test.
