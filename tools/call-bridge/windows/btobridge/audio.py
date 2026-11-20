"""The audio path between the conversation and the outside world.

`AudioPort` is the seam: the call session only hands it the agent's PCM and takes the caller's PCM
from it. Stage 2 builds `LocalAudio` (the PC's microphone and speakers through sounddevice /
PortAudio, WASAPI preferred). Stage 3 adds `cable` (a USB sound card wired to the phone, ADR-0232
#13 A) and `bluetooth` (Phone Link: the call's audio by WASAPI loopback, the agent's voice into a
VB-Cable virtual microphone, #13 B); both will be an `AudioPort` too, nothing else changes.

sounddevice is imported only when a real device is opened, so the tests need no sound hardware.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any, Callable, Protocol

import numpy as np

from .config import Config
from .dsp import Resampler, to_mono

log = logging.getLogger("btobridge.audio")

#: Called with mono int16 samples at the rate the conversation asked for.
MicSink = Callable[[np.ndarray], None]


class AudioPort(Protocol):
    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        """Start capturing; `on_mic` is called on the event loop with each block."""

    def play(self, pcm: bytes, rate: int) -> None:
        """Queue the agent's 16-bit mono PCM at `rate` for playback."""

    def flush(self) -> None:
        """Drop everything queued (the caller interrupted the agent)."""

    def pending_ms(self) -> float:
        """How much queued audio is still to be heard."""

    async def close(self) -> None: ...


class NullAudio:
    """No device: silence in, audio out counted and thrown away. For tests and `--no-audio`."""

    def __init__(self) -> None:
        self.played_bytes = 0
        self.flushes = 0
        self.on_mic: MicSink | None = None
        self.mic_rate = 16000

    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        self.on_mic = on_mic
        self.mic_rate = mic_rate

    def play(self, pcm: bytes, rate: int) -> None:
        self.played_bytes += len(pcm)

    def flush(self) -> None:
        self.flushes += 1

    def pending_ms(self) -> float:
        return 0.0

    async def close(self) -> None:
        self.on_mic = None


class LocalAudio:
    """The PC's own microphone and speakers (stage 2). A headset keeps the agent from hearing
    itself: there is no echo cancellation (ADR-0232 #12)."""

    def __init__(self, input_device: int | str | None, output_device: int | str | None) -> None:
        self.input_device = input_device
        self.output_device = output_device
        self._in: Any = None
        self._out: Any = None
        self._buffer = bytearray()
        self._lock = threading.Lock()
        self._out_rate = 48000
        self._out_channels = 1
        self._play_resampler: Resampler | None = None
        self._play_source = 0

    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        import sounddevice as sd  # noqa: PLC0415 - only with a real device

        loop = asyncio.get_running_loop()
        in_index = pick_device(sd, self.input_device, "input")
        out_index = pick_device(sd, self.output_device, "output")
        in_info = sd.query_devices(in_index)
        out_info = sd.query_devices(out_index)

        in_rate = int(in_info["default_samplerate"])
        in_channels = min(2, int(in_info["max_input_channels"])) or 1
        capture = Resampler(in_rate, mic_rate)

        def on_input(frames: np.ndarray, _count: int, _time: Any, status: Any) -> None:
            if status:
                log.debug("input status %s", status)
            block = capture.process(to_mono(frames.copy()))
            if block.size:
                loop.call_soon_threadsafe(on_mic, block)

        self._out_rate = int(out_info["default_samplerate"])
        self._out_channels = min(2, int(out_info["max_output_channels"])) or 1

        def on_output(out: np.ndarray, count: int, _time: Any, status: Any) -> None:
            want = count * 2
            with self._lock:
                chunk = bytes(self._buffer[:want])
                del self._buffer[:want]
            samples = np.frombuffer(chunk, dtype=np.int16)
            if samples.size < count:
                samples = np.concatenate((samples, np.zeros(count - samples.size, np.int16)))
            out[:] = np.repeat(samples.reshape(-1, 1), out.shape[1], axis=1)

        self._in = sd.InputStream(
            device=in_index,
            samplerate=in_rate,
            channels=in_channels,
            dtype="int16",
            blocksize=in_rate // 50,
            latency="low",
            callback=on_input,
        )
        self._out = sd.OutputStream(
            device=out_index,
            samplerate=self._out_rate,
            channels=self._out_channels,
            dtype="int16",
            blocksize=self._out_rate // 50,
            latency="low",
            callback=on_output,
        )
        self._in.start()
        self._out.start()
        log.info(
            "audio open: in %s Hz x%s, out %s Hz x%s",
            in_rate,
            in_channels,
            self._out_rate,
            self._out_channels,
        )

    def play(self, pcm: bytes, rate: int) -> None:
        if self._play_resampler is None or self._play_source != rate:
            self._play_resampler = Resampler(rate, self._out_rate)
            self._play_source = rate
        samples = self._play_resampler.process(np.frombuffer(pcm, dtype=np.int16))
        with self._lock:
            self._buffer.extend(samples.tobytes())

    def flush(self) -> None:
        with self._lock:
            self._buffer.clear()

    def pending_ms(self) -> float:
        with self._lock:
            return len(self._buffer) / 2 / self._out_rate * 1000

    async def close(self) -> None:
        for stream in (self._in, self._out):
            if stream is not None:
                try:
                    stream.stop()
                    stream.close()
                except Exception:  # noqa: BLE001 - closing a dead device must not fail the call
                    log.warning("audio close failed")
        self._in = self._out = None


def pick_device(sd: Any, wanted: int | str | None, kind: str) -> int:
    """A configured index or name part; else the WASAPI default (lower latency than MME); else
    PortAudio's default."""
    channels = "max_input_channels" if kind == "input" else "max_output_channels"
    devices = sd.query_devices()
    if isinstance(wanted, int):
        return wanted
    if isinstance(wanted, str) and wanted.strip():
        part = wanted.strip().lower()
        hosts = sd.query_hostapis()
        matches = [
            index
            for index, device in enumerate(devices)
            if part in device["name"].lower() and device[channels] > 0
        ]
        # The same device appears once per host API: prefer its WASAPI entry.
        matches.sort(key=lambda index: "WASAPI" not in hosts[devices[index]["hostapi"]]["name"])
        if matches:
            return matches[0]
        raise LookupError(f"no {kind} device named like '{wanted}'")
    for host in sd.query_hostapis():
        if "WASAPI" in host["name"]:
            index = host["default_input_device" if kind == "input" else "default_output_device"]
            if index is not None and index >= 0:
                return int(index)
    default = sd.default.device[0 if kind == "input" else 1]
    return int(default)


def list_devices() -> list[str]:
    import sounddevice as sd  # noqa: PLC0415

    hosts = sd.query_hostapis()
    lines = []
    for index, device in enumerate(sd.query_devices()):
        host = hosts[device["hostapi"]]["name"]
        if "WASAPI" not in host:
            continue
        kinds = []
        if device["max_input_channels"] > 0:
            kinds.append("mic")
        if device["max_output_channels"] > 0:
            kinds.append("speaker")
        lines.append(f"{index:3d}  {'/'.join(kinds):12s} {device['name']}")
    return lines


class StageThree(NotImplementedError):
    pass


def open_audio(config: Config) -> AudioPort:
    if config.mode == "local":
        return LocalAudio(config.input_device, config.output_device)
    # Stage 3 (ADR-0232 #13): `cable` opens the USB sound card wired to the phone (its input is the
    # caller, its output the agent); `bluetooth` captures the Phone Link call by WASAPI loopback
    # and plays the agent into a VB-Cable input that Phone Link uses as its microphone.
    raise StageThree(f"audio mode '{config.mode}' comes with stage 3; use 'local'")
