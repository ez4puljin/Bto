"""config.json: where Bto is, the line's key, the audio mode and devices, the call limits."""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

#: The modes of the audio path. `local` is stage 2 (the PC's own microphone and speakers, a
#: headset recommended, test calls from the console). `bluetooth` is stage 3 (ADR-0232 #13 B): the
#: line's phone is paired to the PC with Windows Phone Link, the call's audio is captured by WASAPI
#: loopback and the agent's voice goes into VB-Cable, Phone Link's microphone. `cable` (#13 A, a
#: USB sound card wired to the phone) needs parts the owner did not buy (2026-11-20): only its seam
#: and settings exist.
MODES = ("local", "cable", "bluetooth")
#: The modes in which the background task listens for the line's Android phone.
PHONE_MODES = ("cable", "bluetooth")

#: The VB-Cable playback side: whatever plays into it is what Phone Link's microphone hears.
VB_CABLE_INPUT = "CABLE Input"

KEY_PATTERN = re.compile(r"^bpl_\d+_[A-Za-z0-9_-]{20,}$")


def home() -> Path:
    """The bridge's folder: config.json, metrics.csv and bridge.log live here."""
    explicit = os.environ.get("BTOCALL_HOME")
    if explicit:
        return Path(explicit)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "BtoCall"
    return Path.home() / ".btocall"


@dataclass
class Config:
    server: str
    key: str
    mode: str = "local"
    #: A device index or a part of its name; None: Windows' default device.
    input_device: int | str | None = None
    output_device: int | str | None = None
    #: The microphone is sent to ElevenLabs in chunks this long. Each chunk waits until it is full,
    #: so a shorter one answers sooner (ElevenLabs hears the end of a sentence earlier).
    chunk_ms: int = 100
    #: A call is ended after this long (ADR-0232 #12) ...
    max_call_s: int = 600
    #: ... or after this long without the caller's voice.
    silence_s: int = 40
    #: The agent's own limits end the call politely first; the bridge waits this long beyond them
    #: before it closes the conversation itself.
    grace_s: int = 15
    # -- stage 3: the line's Android phone and the call's audio ----------------------------------
    #: The phone connects to ws://<this PC>:<phone_port>/phone.
    phone_port: int = 8766
    #: The paired phone: sha-256 of its token, its LAN address, the name it gave.
    phone_token_hash: str | None = None
    phone_ip: str | None = None
    phone_device: str | None = None
    #: bluetooth: the output device Phone Link plays the call on (captured by loopback); None: the
    #: Windows default output.
    call_output_device: int | str | None = None
    #: bluetooth: where the agent's voice is played: the VB-Cable input, Phone Link's microphone.
    agent_output_device: int | str | None = VB_CABLE_INPUT
    #: cable (not built): the USB sound card's input (the phone's earpiece) and output (its mic).
    cable_input_device: int | str | None = None
    cable_output_device: int | str | None = None
    #: Silence the caller's side while the agent speaks (and `echo_gate_hangover_ms` after), for an
    #: echo `calibrate` measured. Half duplex: the caller cannot talk over the agent then.
    echo_gate: bool = False
    echo_gate_hangover_ms: int = 250
    #: POST /calls must answer within this, or the phone rings for staff (its limit is 3 s).
    decide_s: float = 2.0
    #: After the phone said the call is connected, wait this long before playing the agent (Phone
    #: Link needs a moment to open its Bluetooth audio).
    audio_ready_ms: int = 300
    extra: dict[str, Any] = field(default_factory=dict)

    def problems(self) -> list[str]:
        found = []
        if not self.server.startswith(("http://", "https://")):
            found.append("server must start with http:// or https://")
        if not KEY_PATTERN.match(self.key):
            found.append("key does not look like a Bto phone line key (bpl_...)")
        if self.mode not in MODES:
            found.append(f"mode must be one of {', '.join(MODES)}")
        if not 20 <= self.chunk_ms <= 250:
            found.append("chunk_ms must be 20 ... 250")
        if not 1024 <= int(self.phone_port) <= 65535:
            found.append("phone_port must be 1024 ... 65535")
        if not 0.5 <= float(self.decide_s) <= 2.8:
            found.append("decide_s must be 0.5 ... 2.8 (the phone waits 3 s)")
        if not 0 <= int(self.echo_gate_hangover_ms) <= 2000:
            found.append("echo_gate_hangover_ms must be 0 ... 2000")
        if not 0 <= int(self.audio_ready_ms) <= 2000:
            found.append("audio_ready_ms must be 0 ... 2000")
        return found


def load(path: Path | None = None) -> Config:
    path = path or home() / "config.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    known = {f.name for f in fields(Config)} - {"extra"}
    values = {name: raw[name] for name in known if name in raw}
    extra = {name: value for name, value in raw.items() if name not in known}
    config = Config(**values, extra=extra)
    config.server = config.server.rstrip("/")
    return config


def save(config: Config, path: Path | None = None) -> Path:
    path = path or home() / "config.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    data = asdict(config)
    extra = data.pop("extra")
    data.update(extra)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def update(changes: dict[str, Any], path: Path | None = None) -> Config:
    """Read config.json, change only these settings, write it back. Two processes write it (the
    background task when a phone pairs, the console when a device is picked): each keeps the
    other's settings instead of writing back an old copy of the whole file."""
    path = path or home() / "config.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw.update(changes)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    os.replace(tmp, path)
    return load(path)
