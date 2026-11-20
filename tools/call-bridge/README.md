# Call bridge

The «phone AI order line» (ADR-0232): a customer calls the store's ordinary phone number, an
Android phone answers, and the AI takes the order through the PC. This folder holds the pieces of
that bridge; Bto's side is `apps/api/src/modules/phone-agent` (docs/modules/phone-agent.md).

| Folder | What | Stage |
|---|---|---|
| `android/` | the app on the line's phone: the default phone app (dialer role), answers calls and carries their audio | stage 0: the probe; the real app is stage 3 |
| `windows/` | the PC side: asks Bto whether to answer, holds the ElevenLabs conversation, plays and records the audio, forwards the agent's tools to Bto, stores the transcript, measures the response time | stage 2: test calls through the PC's headset (`local` mode), no phone |
| `agent/` | the ElevenLabs agent as code: settings, the Mongolian prompt, the 8 client tools, and the script that pushes them | stage 2 |

- Install and test calls: `windows/README.md`, for the owner `windows/README.mn.md`.
- The agent: `agent/README.md`.
- The probe: `android/README.md`.

Stage 3 adds the Android link (a LAN WebSocket between the phone and `windows/`) and the two audio
modes (`cable`, `bluetooth`) behind the seams `windows/btobridge/phone.py` and `audio.py`.
