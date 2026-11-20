"""The Windows side of Bto's phone AI order line (ADR-0232, tools/call-bridge/windows).

The bridge holds one conversation at a time with ElevenLabs Agents over the signed WebSocket URL
Bto hands it, carries the audio between that conversation and the PC's sound devices, forwards
every client tool call to Bto over the LAN and stores the transcript there. It never holds the
ElevenLabs key and never logs a word of a conversation: only call ids, timings, counts and codes.

Python 3.12 (the embeddable build install.ps1 installs); the code stays 3.12-compatible.
"""

__version__ = "0.3.0"
