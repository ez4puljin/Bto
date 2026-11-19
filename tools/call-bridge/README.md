# Call bridge

The «phone AI order line» (draft ADR-0232): a customer calls the store's ordinary phone number,
an Android phone answers, and the AI takes the order through the PC. This folder will hold the
pieces of that bridge:

| Folder | What | Stage |
|---|---|---|
| `android/` | the app on the line's phone: the default phone app (dialer role), answers calls and carries their audio | stage 0 now: the probe |
| `windows/` | the PC side the phone talks to over the LAN (audio in and out, pairing) | later |
| `agent/` | the AI side: the conversation, and the order it hands to Bto | later |

## Stage 0: the probe

`android/` is now only a probe, «Bto дуудлага», for ONE phone. It answers one question before
anything else is built: can an app on this phone become the default phone app, answer an
incoming call by itself, move the audio to a headset or Bluetooth, and hang up? It keeps a list of
the last 20 calls with what it saw (ring→answer time, audio endpoints, how the call ended, errors),
which the owner sends back with «Илгээх». It talks to no server and has no audio bridge.

Build and test steps: `android/README.md`.
