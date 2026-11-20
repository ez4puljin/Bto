# The Windows call bridge (stages 2 and 3)

The PC side of the phone AI order line (ADR-0232). For one call it asks Bto whether to answer,
holds the ElevenLabs conversation over the signed URL Bto hands it, carries the audio between the
conversation and the PC's sound devices, forwards each of the agent's client tools to Bto over the
LAN and stores the transcript in Bto. Stage 2 (`mode: local`) needs no phone: a test call starts at the console
with the caller's number given by hand, and the owner talks through a headset. Stage 3
(`mode: bluetooth`, below) takes real calls from the line's Android app «Bto дуудлага» over the
LAN and carries their audio through Windows Phone Link. The owner's steps, in Mongolian:
[README.mn.md](README.mn.md) (E: the bluetooth mode).

## Install (Windows 10/11, 64-bit, no administrator needed)

An ordinary PowerShell window, the line Bto's station page shows:

```powershell
[Net.ServicePointManager]::SecurityProtocol='Tls12'; & ([scriptblock]::Create((irm https://raw.githubusercontent.com/ez4puljin/Bto/main/tools/call-bridge/windows/install.ps1))) -Server 'http://192.168.1.250' -Key 'bpl_1_...'
```

`install.ps1` puts everything in `%LOCALAPPDATA%\BtoCall`:

| Path | What |
|---|---|
| `python\` | Python 3.12.10, the official embeddable zip from python.org (SHA-256 pinned in the script). Chosen over the python.org installer because it needs no administrator, registers nothing in Windows and cannot collide with another Python on the PC. `python312._pth` turns on `import site` and adds `..\app` |
| `python\Lib\site-packages\` | `requirements.txt`, installed by pip (its zipapp, SHA-256 pinned) with `--require-hashes --only-binary=:all:`: websockets 17.4, numpy 2.5.4, sounddevice 0.5.6 (with its own PortAudio DLL), soxr 1.1.0, PyAudioWPatch 0.2.12.9 (PortAudio with WASAPI loopback, the bluetooth mode's capture), cffi, pycparser |
| `app\btobridge\` | the bridge |
| `config.json` | `server`, `key`, `mode` (`local` / `bluetooth`; `cable` is refused), `input_device`, `output_device` (the console's test call: an index or a part of the name, null = Windows' default), `chunk_ms` (100), `max_call_s` (600), `silence_s` (40), `grace_s` (15); stage 3: `phone_port` (8766), `phone_token_hash` / `phone_ip` / `phone_device` (the paired phone; only the token's sha-256), `call_output_device` (null = the default output), `agent_output_device` (`CABLE Input`), `echo_gate` (false), `echo_gate_hangover_ms` (250), `decide_s` (2.0), `audio_ready_ms` (300), `cable_input_device` / `cable_output_device` (not used: the cable mode is not built) |
| `pairing.json` | an open pairing code's sha-256, its expiry and tries (gone once used) |
| `link.json` | what the background task sees, for the menu: the station, the phone's link, a call on |
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
| `serve` | the background task: the station's heartbeat every 60 s; in the bluetooth mode also the phone's link and its calls |
| `pair` | a 6-digit pairing code (10 min, 5 tries) and this PC's LAN address for the phone app; listens itself when the background task does not |
| `status` | the station and the phone's link as the background task last saw them |
| `doctor` | Bluetooth radio, Bluetooth service, Phone Link, a phone paired as a hands-free gateway, VB-Cable; plain Mongolian lines, exit 1 when something is missing |
| `find-call-device [--no-wait]` | during a test call: every output's loopback level for 4 s; the clearly loudest (6 dB above the next, above −55 dBFS, never VB-Cable) is saved as `call_output_device` |
| `calibrate` | during a test call: the echo leak of a 1 kHz tone and the caller's level (below) |

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

## Stage 3: the phone link (`btobridge/link.py`, protocol v1)

JSON text frames over a plain WebSocket; the PC is the server on `phone_port` (8766), path
`/phone` (any other path 404); the phone is the client.

- **Pairing.** `bridge pair` (menu 6) writes a 6-digit code to `pairing.json` (sha-256, 10 min,
  5 wrong tries end it) and prints the PC's LAN address. Phone → `{"type":"pair","code","device",
  "app"}`; PC → `{"type":"paired","token"}` (43 url-safe chars from `secrets`); the token's sha-256,
  the phone's address and its name go to config.json. A new pairing replaces the old phone.
- **Hello.** `{"type":"hello","token"}` → `{"type":"welcome"}`, or `{"type":"error","code":
  "BAD_TOKEN"}` and the socket closed. Once paired, any other address is refused at the handshake
  (403), except while a code is open, when it may only `pair`. A second hello replaces the first
  connection.
- **Errors before closing:** `BAD_TOKEN`, `BAD_CODE`, `NO_PAIRING` (no code open, or used up),
  `BAD_MESSAGE` (the first frame is neither).
- **Phone → PC:** `ringing {callRef, number, at}`, `state {callRef, state answered|active|ended,
  cause, at}`, `route {callRef, endpoint, available}`, `pong {id}`.
- **PC → phone:** `answer {callRef, route BLUETOOTH|WIRED_HEADSET}`, `ignore {callRef}`,
  `hangup {callRef}`, `ping {id}` every 5 s; no pong for 16 s closes the link (the phone reconnects).

`serve.CallDesk` takes one call at a time: a ring during a call is told `ignore` at once (the same
`callRef` told twice is one ring). Each ring reads config.json again.

## Stage 3: one phone call (`session.py` with `phone.AndroidLanPhone`)

1. On `ringing`: `POST /calls {callRef, callerPhone: number}` (`decide_s` = 2 s for the whole
   request; the api's own signed-URL fetch is 1.5 s) and, at the same time, the audio devices are
   found (`DeviceAudio.prepare`). `answer: false`, Bto unreachable or refusing, no answer within
   `decide_s`, no signed URL, or a device missing → `ignore` (the phone rings for staff well within
   its 3 s). A `POST /calls` that answers `answer: true` after the deadline gets `POST /end ERROR`.
2. `answer {callRef, route: BLUETOOTH}` and the ElevenLabs WebSocket open at the same time; the
   initiation is sent as soon as the socket is open, so the greeting is ready when the line is.
3. The agent's audio is held until the phone says `state answered|active` and `audio_ready_ms`
   more (Phone Link's Bluetooth audio needs a moment), then played. No `answered`/`active` within
   6 s ends the call as ERROR with `hangup`.
4. `state ended` (the caller hung up) ends the call as `CALLER_HANGUP`. The agent's `end_call`
   (after its goodbye drained) and every other end send `hangup`. A lost link does not end a call
   (the audio still flows through Bluetooth); the silence limit does, if the caller is gone.
5. `route` with an endpoint other than the one asked is logged.

## Stage 3: audio (`audio.py`)

| Mode | Caller's voice (to ElevenLabs, 16 kHz mono) | Agent's voice (resampled to the device) |
|---|---|---|
| `local` | `input_device` (sounddevice) | `output_device` |
| `bluetooth` | WASAPI loopback of `call_output_device` (PyAudioWPatch; null = the default output), plus zero samples while the loopback delivers nothing (`SilenceFiller`: loopback is silent when nothing plays, and ElevenLabs needs the silence to hear the end of a turn) | `agent_output_device` = «CABLE Input» (sounddevice); «CABLE Output» is Phone Link's microphone |
| `cable` | not built (the owner bought no parts, 2026-11-20): `open_audio` refuses it; it would be `DeviceAudio(_InputCapture(cable_input_device), _Playback(cable_output_device))` | |

`check_roles` refuses (the phone keeps ringing) an agent output that is the call device itself or
not VB-Cable: the agent must never play where the loopback listens. A loopback device is found by
the output's name (`<name> [Loopback]`), whole or in part. The Windows sound settings the owner
sets (README.mn.md E3): Recording «CABLE Output» as the default and default communication device,
«Listen to this device» off; Playback: the call device as the default communication device, never
«CABLE Input».

**Echo.** No echo cancellation (ADR-0232 #12). `calibrate` (menu 9), during a test call: 2.5 s of
the line's level, a 1 kHz tone at −12 dBFS for 2 s into the agent's output, its level on the call's
side by Goertzel from 0.4 s on (the echo leak, dB below the tone); not 6 dB above the line's level
at 1 kHz → «none»; above −35 dB → «high», and the owner is offered `echo_gate: true`. Then 5 s of
the owner talking into the calling phone: the share of voiced 20 ms frames (above −45 dBFS), the
voiced level, the peak and the clipped samples → silent / quiet (below −35) / good / loud (above
−8) / clipping (more than 10 clipped samples). The console shows words; the numbers go to
`bridge.log` only. `echo_gate` sends the caller's side as zeros (same length) while the agent's
audio is queued and `echo_gate_hangover_ms` after: half duplex, the caller cannot barge in.

**Metrics** add `ring_answer_ms` (ring → `answer` sent; the phone's limit is 3000) and
`answer_greeting_ms` (the phone's «connected» → the first agent audio played; the bar is 1500) to
`metrics.csv` (an older file is rewritten with the new header, its rows kept) and to `report`.

**Firewall.** `install.ps1 -Mode bluetooth` adds the inbound rule «Bto call bridge (phone link)»
(TCP 8766, `-RemoteAddress LocalSubnet`, every profile) when its window is an administrator's;
otherwise it prints that one command for an administrator's PowerShell. Nothing else needs one.
`uninstall.ps1` removes the rule when it can.

**`doctor`** (also run by the installer in the bluetooth mode): one PowerShell call reads
`Get-PnpDevice -Class Bluetooth` (a radio is one on a bus: USB, PCI, ACPI, SD), the `bthserv`
service, `BTHENUM` devices with the hands-free UUIDs 111E/111F (a phone paired for calls),
`Get-AppxPackage Microsoft.YourPhone` (Phone Link); VB-Cable is both «CABLE Input» and
«CABLE Output» in sounddevice's list.

## Tests (Linux, no sound hardware)

```sh
cd tools/call-bridge/windows
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python websockets==17.4 numpy==2.5.4 soxr==1.1.0 pytest
.venv/bin/python -m pytest -q tests
```

`tests/fakes.py` scripts the ElevenLabs conversation and records Bto's requests: the order of turns
and tools, the flush before a tool, interruption, ping, the limits, the declines, the failures,
the metrics, and that no word of a call reaches the log or the console. `tests/test_phone_link.py`
runs the link over a real local WebSocket with a fake phone: pairing, the code's tries and expiry,
hello and `BAD_TOKEN`, another address refused, ping/pong, ringing → `POST /calls` → `answer`
well inside the deadline, the greeting held until «connected», declines, a slow or unreachable Bto
→ `ignore` in time (and the late call closed), a second ring ignored, the caller hanging up,
`hangup` after `end_call`, no number or token in the log. `tests/test_stage3_parts.py`: device
roles, the loopback match, the call device detection, resampling, the silence filler, the echo
gate (also inside the session), calibrate's analysis, the Windows checks' words, metrics, config.

## Not verified here

Built and tested on Linux without sound hardware. Not run on Windows yet: PyAudioWPatch's
loopback on the owner's devices, two PortAudio libraries in one process (sounddevice's and
PyAudioWPatch's), whether Phone Link takes «CABLE Output» as its microphone through the default
communication device (Microsoft does not document a virtual microphone for calls, ADR-0232 #13),
the delay Phone Link needs after a call connects (`audio_ready_ms` 300 is a guess), whether a
muted call device still gives loopback audio, the `doctor` PowerShell probe on that PC, the
firewall rule and the installer's new prompts.
