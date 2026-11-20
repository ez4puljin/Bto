"""config.json: where Bto is, the line's key, the audio mode and devices, the call limits."""

from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any

#: The modes of the audio path. `local` is stage 2 (the PC's own microphone and speakers, a
#: headset recommended); `cable` and `bluetooth` are stage 3 (ADR-0232 #13) and not built yet.
MODES = ("local", "cable", "bluetooth")

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
