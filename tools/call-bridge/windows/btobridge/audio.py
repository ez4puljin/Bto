"""The audio path between the conversation and the outside world.

`AudioPort` is the seam: the call session only hands it the agent's PCM and takes the caller's PCM
from it. The modes (config `mode`, ADR-0232 #13):

- `local` (stage 2): the PC's microphone and speakers through sounddevice / PortAudio (WASAPI).
- `bluetooth` (stage 3): the line's phone is the PC's Bluetooth headset through Windows Phone Link.
  The caller's voice is what Phone Link plays on `call_output_device`: captured by WASAPI loopback
  (PyAudioWPatch). The agent's voice is played ONLY into VB-Cable's «CABLE Input», whose other end
  «CABLE Output» is the microphone Phone Link sends to the phone. The agent never plays on the call
  device, so the loopback never hears it.
- `cable` (#13 A, a USB sound card wired to the phone): needs parts that were not bought
  (owner, 2026-11-20); `open_audio` refuses it. When built it is `DeviceAudio` with
  `cable_input_device` / `cable_output_device` and nothing else changes.

sounddevice and PyAudioWPatch are imported only when a real device is opened, so the tests need no
sound hardware.
"""
from __future__ import annotations

import asyncio
import logging
import threading
import time
from typing import Any, Callable, Protocol

import numpy as np

from .config import VB_CABLE_INPUT, Config
from .dsp import Resampler, SilenceFiller, to_mono

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


class _Playback:
    """The agent's voice to one output device (sounddevice, WASAPI), resampled to its rate."""

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.index: int | None = None
        self.name = ""
        self._stream: Any = None
        self._buffer = bytearray()
        self._lock = threading.Lock()
        self._rate = 48000
        self._resampler: Resampler | None = None
        self._source = 0

    def prepare(self, sd: Any) -> None:
        self.index = pick_device(sd, self.wanted, "output")
        self.name = str(sd.query_devices(self.index)["name"])

    def start(self, sd: Any) -> None:
        if self.index is None:
            self.prepare(sd)
        info = sd.query_devices(self.index)
        self._rate = int(info["default_samplerate"])
        channels = min(2, int(info["max_output_channels"])) or 1

        def on_output(out: np.ndarray, count: int, _time: Any, status: Any) -> None:
            want = count * 2
            with self._lock:
                chunk = bytes(self._buffer[:want])
                del self._buffer[:want]
            samples = np.frombuffer(chunk, dtype=np.int16)
            if samples.size < count:
                samples = np.concatenate((samples, np.zeros(count - samples.size, np.int16)))
            out[:] = np.repeat(samples.reshape(-1, 1), out.shape[1], axis=1)

        self._stream = sd.OutputStream(
            device=self.index,
            samplerate=self._rate,
            channels=channels,
            dtype="int16",
            blocksize=self._rate // 50,
            latency="low",
            callback=on_output,
        )
        self._stream.start()
        log.info("playback open: %s Hz x%s", self._rate, channels)

    def play(self, pcm: bytes, rate: int) -> None:
        if self._resampler is None or self._source != rate:
            self._resampler = Resampler(rate, self._rate)
            self._source = rate
        samples = self._resampler.process(np.frombuffer(pcm, dtype=np.int16))
        with self._lock:
            self._buffer.extend(samples.tobytes())

    def flush(self) -> None:
        with self._lock:
            self._buffer.clear()

    def pending_ms(self) -> float:
        with self._lock:
            return len(self._buffer) / 2 / self._rate * 1000

    def close(self) -> None:
        _close_stream(self._stream)
        self._stream = None


class _InputCapture:
    """A microphone-like input device (sounddevice, WASAPI)."""

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.index: int | None = None
        self.name = ""
        self._stream: Any = None

    def prepare(self, sd: Any) -> None:
        self.index = pick_device(sd, self.wanted, "input")
        self.name = str(sd.query_devices(self.index)["name"])

    async def start(self, sd: Any, on_mic: MicSink, mic_rate: int) -> None:
        if self.index is None:
            self.prepare(sd)
        loop = asyncio.get_running_loop()
        info = sd.query_devices(self.index)
        rate = int(info["default_samplerate"])
        channels = min(2, int(info["max_input_channels"])) or 1
        capture = Resampler(rate, mic_rate)

        def on_input(frames: np.ndarray, _count: int, _time: Any, status: Any) -> None:
            if status:
                log.debug("input status %s", status)
            block = capture.process(to_mono(frames.copy()))
            if block.size:
                loop.call_soon_threadsafe(on_mic, block)

        self._stream = sd.InputStream(
            device=self.index,
            samplerate=rate,
            channels=channels,
            dtype="int16",
            blocksize=rate // 50,
            latency="low",
            callback=on_input,
        )
        self._stream.start()
        log.info("capture open: %s Hz x%s", rate, channels)

    async def close(self) -> None:
        _close_stream(self._stream)
        self._stream = None


class _LoopbackCapture:
    """What an output device plays, by WASAPI loopback (PyAudioWPatch): in `bluetooth` mode, the
    call as Phone Link plays it. Loopback delivers nothing while nothing plays; `SilenceFiller`
    sends that silence on, so ElevenLabs still hears the caller stop talking."""

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.name = ""
        self._pa: Any = None
        self._info: dict[str, Any] | None = None
        self._stream: Any = None
        self._filler_task: asyncio.Task[None] | None = None

    def prepare(self, sd: Any) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415 - Windows only, with a real device

        if self._pa is None:
            self._pa = pyaudio.PyAudio()
        if self.wanted is None:
            self._info = dict(self._pa.get_default_wasapi_loopback())
        else:
            name = (
                str(sd.query_devices(self.wanted)["name"])
                if isinstance(self.wanted, int)
                else str(self.wanted)
            )
            loopbacks = [dict(d) for d in self._pa.get_loopback_device_info_generator()]
            found = match_loopback(name, [str(d["name"]) for d in loopbacks])
            if found is None:
                raise LookupError(f"no loopback of an output device named like '{name}'")
            self._info = loopbacks[found]
        self.name = loopback_base(str(self._info["name"]))

    async def start(self, sd: Any, on_mic: MicSink, mic_rate: int) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415

        if self._info is None:
            self.prepare(sd)
        assert self._info is not None
        loop = asyncio.get_running_loop()
        rate = int(self._info["defaultSampleRate"])
        channels = max(1, int(self._info["maxInputChannels"]))
        capture = Resampler(rate, mic_rate)
        filler = SilenceFiller(mic_rate)

        def deliver(block: np.ndarray) -> None:
            filler.delivered(block.size, time.monotonic())
            on_mic(block)

        def on_input(data: bytes, _count: int, _time: Any, _status: Any) -> tuple[None, int]:
            frames = np.frombuffer(data, dtype=np.int16).reshape(-1, channels)
            block = capture.process(to_mono(frames))
            if block.size:
                loop.call_soon_threadsafe(deliver, block)
            return (None, pyaudio.paContinue)

        async def fill() -> None:
            while True:
                await asyncio.sleep(0.02)
                owed = filler.owed(time.monotonic())
                if owed:
                    on_mic(np.zeros(owed, dtype=np.int16))

        self._stream = self._pa.open(
            format=pyaudio.paInt16,
            channels=channels,
            rate=rate,
            input=True,
            input_device_index=int(self._info["index"]),
            frames_per_buffer=rate // 50,
            stream_callback=on_input,
        )
        self._stream.start_stream()
        self._filler_task = loop.create_task(fill())
        log.info("loopback open: %s Hz x%s", rate, channels)

    async def close(self) -> None:
        if self._filler_task is not None:
            self._filler_task.cancel()
            self._filler_task = None
        if self._stream is not None:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception:  # noqa: BLE001 - closing a dead device must not fail the call
                log.warning("loopback close failed")
            self._stream = None
        if self._pa is not None:
            try:
                self._pa.terminate()
            except Exception:  # noqa: BLE001
                pass
            self._pa = None


class DeviceAudio:
    """A capture side and a playback side, both real devices."""

    def __init__(self, capture: _InputCapture | _LoopbackCapture, playback: _Playback) -> None:
        self.capture = capture
        self.playback = playback
        self._sd: Any = None

    def _sounddevice(self) -> Any:
        if self._sd is None:
            import sounddevice as sd  # noqa: PLC0415 - only with a real device

            self._sd = sd
        return self._sd

    def prepare(self) -> None:
        """Find both devices (before a call is answered: a missing device leaves the phone
        ringing for staff instead of a silent call). Raises LookupError."""
        sd = self._sounddevice()
        self.capture.prepare(sd)
        self.playback.prepare(sd)
        check_roles(self.capture.name, self.playback.name, isinstance(self.capture, _LoopbackCapture))

    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        sd = self._sounddevice()
        self.playback.start(sd)
        await self.capture.start(sd, on_mic, mic_rate)

    def play(self, pcm: bytes, rate: int) -> None:
        self.playback.play(pcm, rate)

    def flush(self) -> None:
        self.playback.flush()

    def pending_ms(self) -> float:
        return self.playback.pending_ms()

    async def close(self) -> None:
        await self.capture.close()
        self.playback.close()


class LocalAudio(DeviceAudio):
    """The PC's own microphone and speakers (stage 2). A headset keeps the agent from hearing
    itself: there is no echo cancellation (ADR-0232 #12)."""

    def __init__(self, input_device: int | str | None, output_device: int | str | None) -> None:
        super().__init__(_InputCapture(input_device), _Playback(output_device))


class BluetoothAudio(DeviceAudio):
    """Phone Link: the call captured from `call_output_device`, the agent into VB-Cable."""

    def __init__(self, call_output: int | str | None, agent_output: int | str | None) -> None:
        super().__init__(_LoopbackCapture(call_output), _Playback(agent_output or VB_CABLE_INPUT))


def _close_stream(stream: Any) -> None:
    if stream is None:
        return
    try:
        stream.stop()
        stream.close()
    except Exception:  # noqa: BLE001 - closing a dead device must not fail the call
        log.warning("audio close failed")


LOOPBACK_SUFFIX = " [Loopback]"


def loopback_base(name: str) -> str:
    """PyAudioWPatch names a loopback «<output device> [Loopback]»."""
    return name[: -len(LOOPBACK_SUFFIX)] if name.endswith(LOOPBACK_SUFFIX) else name


def match_loopback(wanted: str, names: list[str]) -> int | None:
    """The loopback of the output device named `wanted` (its whole name, else a part of it,
    ignoring case); None if there is none."""
    part = wanted.strip().lower()
    if not part:
        return None
    bases = [loopback_base(name).lower() for name in names]
    for index, base in enumerate(bases):
        if base == part:
            return index
    for index, base in enumerate(bases):
        if part in base:
            return index
    return None


class RoleError(LookupError):
    pass


def check_roles(capture: str, playback: str, loopback: bool) -> None:
    """The safety of the bluetooth mode: the agent is played only into VB-Cable and never on the
    device the call is captured from, or the AI would hear itself through the loopback."""
    if not loopback:
        return
    if capture.strip().lower() == playback.strip().lower():
        raise RoleError("the agent would play on the call's own device (the AI would hear itself)")
    if "cable" not in playback.lower():
        raise RoleError("the agent's voice must go to VB-Cable («CABLE Input»), Phone Link's microphone")


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
    """The audio of a phone call in the configured mode."""
    if config.mode == "local":
        return LocalAudio(config.input_device, config.output_device)
    if config.mode == "bluetooth":
        return BluetoothAudio(config.call_output_device, config.agent_output_device)
    # ADR-0232 #13 A: a USB sound card wired to the phone. Not built: the owner bought no parts
    # (2026-11-20). It would be DeviceAudio(_InputCapture(cable_input_device),
    # _Playback(cable_output_device)).
    raise StageThree(f"audio mode '{config.mode}' needs a USB sound card and cables; not built")


def open_local_audio(config: Config) -> AudioPort:
    """The PC's headset, whatever the mode: the console's test call."""
    return LocalAudio(config.input_device, config.output_device)


#: The call's output is the loudest one, if it is loud enough and clearly the loudest.
DETECT_MIN_DBFS = -55.0
DETECT_MARGIN_DB = 6.0


def pick_call_output(levels: list[tuple[str, float]]) -> str | None:
    """From (output name, level dBFS) measured during a test call: the device the call plays on,
    or None when nothing stands out (no call, or two devices play the same)."""
    candidates = [(name, db) for name, db in levels if "cable" not in name.lower()]
    candidates.sort(key=lambda item: item[1], reverse=True)
    if not candidates or candidates[0][1] < DETECT_MIN_DBFS:
        return None
    if len(candidates) > 1 and candidates[0][1] - candidates[1][1] < DETECT_MARGIN_DB:
        return None
    return candidates[0][0]


def measure_outputs(seconds: float = 4.0) -> list[tuple[str, float]]:
    """Every output device's level by loopback for `seconds` (Windows, PyAudioWPatch). An output
    nothing plays on delivers no samples and reads as silence."""
    import pyaudiowpatch as pyaudio  # noqa: PLC0415

    from .dsp import level_dbfs  # noqa: PLC0415

    pa = pyaudio.PyAudio()
    streams: list[tuple[str, Any]] = []
    collected: dict[str, list[bytes]] = {}
    try:
        for info in pa.get_loopback_device_info_generator():
            name = loopback_base(str(info["name"]))
            if "cable" in name.lower() or name in collected:
                continue
            channels = max(1, int(info["maxInputChannels"]))
            collected[name] = []

            def on_input(data: bytes, _n: int, _t: Any, _s: Any, *, key: str = name) -> tuple[None, int]:
                collected[key].append(data)
                return (None, pyaudio.paContinue)

            try:
                stream = pa.open(
                    format=pyaudio.paInt16,
                    channels=channels,
                    rate=int(info["defaultSampleRate"]),
                    input=True,
                    input_device_index=int(info["index"]),
                    stream_callback=on_input,
                )
                stream.start_stream()
                streams.append((name, stream))
            except Exception:  # noqa: BLE001 - a device that will not open is not the call's
                collected.pop(name, None)
        time.sleep(seconds)
    finally:
        for _name, stream in streams:
            try:
                stream.stop_stream()
                stream.close()
            except Exception:  # noqa: BLE001
                pass
        pa.terminate()
    levels = []
    for name, chunks in collected.items():
        samples = np.frombuffer(b"".join(chunks), dtype=np.int16)
        levels.append((name, level_dbfs(samples)))
    return levels
