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

**One audio thread (0.3.1).** Every PortAudio call (both copies: sounddevice's DLL and the one
PyAudioWPatch links in) runs on one thread of this process, which joins COM's multithreaded
apartment first. 0.3.0 found the devices on a worker thread (`asyncio.to_thread`, where the first
`import sounddevice` and `PyAudio()` ran `Pa_Initialize`, and COM was initialised) and opened the
streams on the event loop's thread, which had no COM: WASAPI then refuses to activate the device
(`CO_E_NOTINITIALIZED`, PortAudio's «Unanticipated host error»), and every bluetooth call ended
in 1–2 s with «audio did not open (PortAudioError)». The thread also keeps the two PortAudio copies
from ever being entered at once.

**Every open has a plan.** A device is tried in a fixed order (`device_plan`): its WASAPI entry
at its own rate with WASAPI's converter on (`auto_convert`: any rate, any channel count in shared
mode), then 48000 and 44100; then its DirectSound entry, then its MME entry (the same device found
by name across host APIs, MME's names cut at 31 characters; never «CABLE In 16ch»). In bluetooth
mode PyAudioWPatch's own WASAPI output is the last try for the agent's voice. Each failed try is
logged with PortAudio's own words and code (no call content), and the one that opened is logged.

sounddevice and PyAudioWPatch are imported only when a real device is opened, so the tests need no
sound hardware.
"""
from __future__ import annotations

import asyncio
import functools
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, Protocol, TypeVar

import numpy as np

from .config import VB_CABLE_INPUT, Config
from .dsp import Resampler, SilenceFiller, to_mono

log = logging.getLogger("btobridge.audio")

#: Called with mono int16 samples at the rate the conversation asked for.
MicSink = Callable[[np.ndarray], None]

T = TypeVar("T")


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


# -- the audio thread -----------------------------------------------------------------------------

_executor: ThreadPoolExecutor | None = None
_executor_lock = threading.Lock()
_local = threading.local()
#: COINIT_MULTITHREADED: the thread joins the process's multithreaded apartment. PortAudio's own
#: `CoInitialize` (single-threaded) then answers RPC_E_CHANGED_MODE, which it accepts.
COINIT_MULTITHREADED = 0x0


def _init_audio_thread() -> None:
    _local.audio = True
    if sys.platform != "win32":
        return
    try:
        import ctypes  # noqa: PLC0415

        result = ctypes.windll.ole32.CoInitializeEx(None, COINIT_MULTITHREADED)  # type: ignore[attr-defined]
    except Exception as error:  # noqa: BLE001 - logged; PortAudio still initialises COM itself
        log.warning("audio thread: COM not initialised (%s)", type(error).__name__)
        return
    log.info("audio thread: COM 0x%08X", int(result) & 0xFFFFFFFF)


def _audio_executor() -> ThreadPoolExecutor:
    global _executor
    with _executor_lock:
        if _executor is None:
            _executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="btoaudio", initializer=_init_audio_thread
            )
        return _executor


def on_audio_thread(fn: Callable[..., T], *args: Any) -> T:
    """Run `fn` on the audio thread and wait for it (from any thread but an event loop's)."""
    if getattr(_local, "audio", False):
        return fn(*args)
    return _audio_executor().submit(fn, *args).result()


async def on_audio_thread_async(fn: Callable[..., T], *args: Any) -> T:
    """Run `fn` on the audio thread without blocking the event loop."""
    if getattr(_local, "audio", False):
        return fn(*args)
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_audio_executor(), functools.partial(fn, *args))


def is_audio_thread() -> bool:
    return bool(getattr(_local, "audio", False))


# -- what went wrong, in the library's own words --------------------------------------------------


def describe_error(error: BaseException) -> str:
    """The error's class, PortAudio's text and code, the host API's error (WASAPI's HRESULT); no
    call content is in any of them. E.g. «PortAudioError: Error opening OutputStream: Unanticipated
    host error [PaErrorCode -9999] [host api 13 error -2147221008 = 0x800401F0: ...]»."""
    name = type(error).__name__
    args = error.args
    if name == "PortAudioError" and args:
        text = str(args[0])
        if len(args) > 1:
            text += f" [PaErrorCode {args[1]}]"
        if len(args) > 2 and isinstance(args[2], tuple) and len(args[2]) == 3:
            host_api, code, host_text = args[2]
            hex_code = f" = 0x{int(code) & 0xFFFFFFFF:08X}" if isinstance(code, int) else ""
            text += f" [host api {host_api} error {code}{hex_code}: {host_text}]"
    elif isinstance(error, OSError) and error.errno is not None:
        text = f"[Errno {error.errno}] {error.strerror}"
    elif isinstance(error, AudioOpenError):
        return f"{name}: {error}"[:600]
    else:
        text = str(error)
    return f"{name}: {text}"[:400]


class AudioOpenError(RuntimeError):
    """Every way to open a device failed; `failures` holds one line per try."""

    def __init__(self, what: str, failures: list[str]) -> None:
        self.what = what
        self.failures = failures
        last = failures[-1] if failures else "nothing to try"
        super().__init__(f"{what}: all {len(failures)} tries failed; last: {last}")


# -- the plan of an open --------------------------------------------------------------------------


@dataclass(frozen=True)
class OpenTry:
    """One way to open a device: the library, its index there, the host API, rate and channels."""

    backend: str  # "sounddevice" | "pyaudiowpatch"
    index: int
    host: str
    name: str
    rate: int
    channels: int
    auto_convert: bool = False

    def label(self) -> str:
        via = "" if self.backend == "sounddevice" else f" ({self.backend})"
        convert = ", auto-convert" if self.auto_convert else ""
        return f"{self.name} | {self.host}{via} | {self.rate} Hz x{self.channels}{convert}"


#: The host APIs a device is tried on, in order: WASAPI first (low latency, and its converter takes
#: any rate), then DirectSound and MME (they convert themselves, at a higher latency).
HOST_ORDER = ("WASAPI", "DirectSound", "MME")
#: After the device's own rate.
FALLBACK_RATES = (48000, 44100)
#: MME cuts a device's name at 31 characters (MAXPNAMELEN 32 with its terminator).
MME_NAME_LEN = 31


def same_device(a: str, b: str) -> bool:
    """The same device seen through two host APIs: the same name, or one is the other cut at MME's
    length. «CABLE Input (VB-Audio Virtual C» is «CABLE Input (VB-Audio Virtual Cable)»;
    «CABLE In 16ch (...)» is not."""
    left, right = a.strip().lower(), b.strip().lower()
    if left == right:
        return True
    short, long = sorted((left, right), key=len)
    return len(short) >= MME_NAME_LEN - 1 and long.startswith(short)


def rates_to_try(native: int) -> list[int]:
    return list(dict.fromkeys([int(native), *FALLBACK_RATES]))


def device_plan(
    devices: list[dict[str, Any]], hosts: list[dict[str, Any]], chosen: int, kind: str
) -> list[OpenTry]:
    """The tries for device `chosen` (a sounddevice index), `kind` "input" or "output", in order."""
    key = "max_input_channels" if kind == "input" else "max_output_channels"
    name = str(devices[chosen]["name"])

    def host_of(index: int) -> str:
        return str(hosts[int(devices[index]["hostapi"])]["name"])

    def tries_for(index: int, wasapi: bool) -> list[OpenTry]:
        info = devices[index]
        channels = min(2, int(info[key])) or 1
        return [
            OpenTry(
                "sounddevice", index, host_of(index), str(info["name"]), rate, channels, wasapi
            )
            for rate in rates_to_try(int(info["default_samplerate"]))
        ]

    plan: list[OpenTry] = []
    if not any(part in host_of(chosen) for part in HOST_ORDER):
        # WDM-KS or ASIO, chosen by its number: as it is, before the others.
        plan.extend(tries_for(chosen, False))
    for part in HOST_ORDER:
        same = [
            index
            for index, device in enumerate(devices)
            if part in host_of(index) and int(device[key]) > 0 and same_device(name, str(device["name"]))
        ]
        if not same:
            continue
        same.sort(key=lambda index: index != chosen)
        plan.extend(tries_for(same[0], part == "WASAPI"))
    return plan


def loopback_plan(info: dict[str, Any]) -> list[OpenTry]:
    """A WASAPI loopback opens only in the device's own format: its rate and channels exactly
    first; the common rates after, in case the driver reports another."""
    channels = max(1, int(info["maxInputChannels"]))
    native = int(info["defaultSampleRate"])
    name = loopback_base(str(info["name"]))
    plan = [
        OpenTry("pyaudiowpatch", int(info["index"]), "Windows WASAPI loopback", name, rate, channels)
        for rate in rates_to_try(native)
    ]
    if channels > 2:
        plan.append(
            OpenTry("pyaudiowpatch", int(info["index"]), "Windows WASAPI loopback", name, native, 2)
        )
    return plan


def pa_output_plan(pa_devices: list[dict[str, Any]], name: str) -> list[OpenTry]:
    """PyAudioWPatch's own WASAPI entry of the output `name` (its loopbacks left out): the last try
    for the agent's voice in bluetooth mode, the other PortAudio copy."""
    plan = []
    for info in pa_devices:
        if info.get("isLoopbackDevice") or int(info.get("maxOutputChannels") or 0) <= 0:
            continue
        if not same_device(name, str(info["name"])):
            continue
        channels = min(2, int(info["maxOutputChannels"])) or 1
        plan.append(
            OpenTry(
                "pyaudiowpatch",
                int(info["index"]),
                "Windows WASAPI",
                str(info["name"]),
                int(info["defaultSampleRate"]),
                channels,
            )
        )
        break
    return plan


def open_first(
    what: str, plan: list[OpenTry], open_one: Callable[[OpenTry], Any]
) -> tuple[OpenTry, Any, list[str]]:
    """Each try in order until one opens; every failure is logged and kept. Raises AudioOpenError."""
    failures: list[str] = []
    for number, attempt in enumerate(plan, 1):
        try:
            stream = open_one(attempt)
        except Exception as error:  # noqa: BLE001 - PortAudioError, OSError, ValueError
            reason = describe_error(error)
            failures.append(f"{attempt.label()}: {reason}")
            log.warning("%s try %s/%s failed: %s: %s", what, number, len(plan), attempt.label(), reason)
            continue
        log.info("%s open (try %s/%s): %s", what, number, len(plan), attempt.label())
        return attempt, stream, failures
    raise AudioOpenError(what, failures)


class _PaStream:
    """A PyAudioWPatch stream with sounddevice's stop/close."""

    def __init__(self, stream: Any) -> None:
        self.stream = stream

    def stop(self) -> None:
        self.stream.stop_stream()

    def close(self) -> None:
        self.stream.close()


def _latency(attempt: OpenTry) -> str:
    return "low" if "WASAPI" in attempt.host else "high"


# -- the devices ----------------------------------------------------------------------------------


class _Playback:
    """The agent's voice to one output device, resampled to the rate it opened at."""

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.index: int | None = None
        self.name = ""
        self.opened: OpenTry | None = None
        self.failures: list[str] = []
        self._stream: Any = None
        self._buffer = bytearray()
        self._lock = threading.Lock()
        self._rate = 48000
        self._resampler: Resampler | None = None
        self._source = 0

    def prepare(self, sd: Any) -> None:
        self.index = pick_device(sd, self.wanted, "output")
        self.name = str(sd.query_devices(self.index)["name"])

    def open(self, sd: Any, pa: Any = None, extra: list[OpenTry] | None = None) -> None:
        if self.index is None:
            self.prepare(sd)
        assert self.index is not None
        plan = device_plan(list(sd.query_devices()), list(sd.query_hostapis()), self.index, "output")
        plan += extra or []
        try:
            attempt, stream, self.failures = open_first(
                "playback", plan, lambda attempt: self._open_one(sd, pa, attempt)
            )
        except AudioOpenError as error:
            self.failures = error.failures
            raise
        with self._lock:
            self._rate = attempt.rate
            self._resampler = None
        self.opened = attempt
        self._stream = stream

    def _take(self, count: int, channels: int) -> np.ndarray:
        want = count * 2
        with self._lock:
            chunk = bytes(self._buffer[:want])
            del self._buffer[:want]
        samples = np.frombuffer(chunk, dtype=np.int16)
        if samples.size < count:
            samples = np.concatenate((samples, np.zeros(count - samples.size, np.int16)))
        return np.repeat(samples.reshape(-1, 1), channels, axis=1)

    def _open_one(self, sd: Any, pa: Any, attempt: OpenTry) -> Any:
        if attempt.backend == "pyaudiowpatch":
            import pyaudiowpatch as pyaudio  # noqa: PLC0415 - Windows only, with a real device

            channels = attempt.channels

            def on_pa_output(_data: Any, count: int, _time: Any, _status: Any) -> tuple[bytes, int]:
                return (self._take(count, channels).tobytes(), pyaudio.paContinue)

            if pa is None:
                raise LookupError("no PyAudioWPatch instance for this try")
            raw = pa.open(
                format=pyaudio.paInt16,
                channels=channels,
                rate=attempt.rate,
                output=True,
                output_device_index=attempt.index,
                frames_per_buffer=attempt.rate // 50,
                stream_callback=on_pa_output,
            )
            stream = _PaStream(raw)
            try:
                raw.start_stream()
            except Exception:
                _close_stream(stream)
                raise
            return stream

        def on_output(out: np.ndarray, count: int, _time: Any, _status: Any) -> None:
            out[:] = self._take(count, out.shape[1])

        stream = sd.OutputStream(
            device=attempt.index,
            samplerate=attempt.rate,
            channels=attempt.channels,
            dtype="int16",
            blocksize=attempt.rate // 50,
            latency=_latency(attempt),
            callback=on_output,
            extra_settings=sd.WasapiSettings(auto_convert=True) if attempt.auto_convert else None,
        )
        try:
            stream.start()
        except Exception:
            _close_stream(stream)
            raise
        return stream

    def play(self, pcm: bytes, rate: int) -> None:
        with self._lock:
            if self._resampler is None or self._source != rate:
                self._resampler = Resampler(rate, self._rate)
                self._source = rate
            resampler = self._resampler
        samples = resampler.process(np.frombuffer(pcm, dtype=np.int16))
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
    """A microphone-like input device (sounddevice)."""

    pa: Any = None

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.index: int | None = None
        self.name = ""
        self.opened: OpenTry | None = None
        self.failures: list[str] = []
        self.device_samples = 0
        self._stream: Any = None

    def prepare(self, sd: Any) -> None:
        self.index = pick_device(sd, self.wanted, "input")
        self.name = str(sd.query_devices(self.index)["name"])

    def output_fallbacks(self, _name: str) -> list[OpenTry]:
        return []

    def open(self, sd: Any, loop: asyncio.AbstractEventLoop, on_mic: MicSink, mic_rate: int) -> None:
        if self.index is None:
            self.prepare(sd)
        assert self.index is not None
        plan = device_plan(list(sd.query_devices()), list(sd.query_hostapis()), self.index, "input")

        def open_one(attempt: OpenTry) -> Any:
            capture = Resampler(attempt.rate, mic_rate)

            def on_input(frames: np.ndarray, _count: int, _time: Any, status: Any) -> None:
                if status:
                    log.debug("input status %s", status)
                block = capture.process(to_mono(frames.copy()))
                if block.size:
                    self.device_samples += block.size
                    try:
                        loop.call_soon_threadsafe(on_mic, block)
                    except RuntimeError:  # the loop is closing: the call is over
                        pass

            stream = sd.InputStream(
                device=attempt.index,
                samplerate=attempt.rate,
                channels=attempt.channels,
                dtype="int16",
                blocksize=attempt.rate // 50,
                latency=_latency(attempt),
                callback=on_input,
                extra_settings=sd.WasapiSettings(auto_convert=True) if attempt.auto_convert else None,
            )
            try:
                stream.start()
            except Exception:
                _close_stream(stream)
                raise
            return stream

        try:
            self.opened, self._stream, self.failures = open_first("capture", plan, open_one)
        except AudioOpenError as error:
            self.failures = error.failures
            raise

    def started(self, loop: asyncio.AbstractEventLoop) -> None:
        pass

    def stop_tasks(self) -> None:
        pass

    def close_streams(self) -> None:
        _close_stream(self._stream)
        self._stream = None


class _LoopbackCapture:
    """What an output device plays, by WASAPI loopback (PyAudioWPatch): in `bluetooth` mode, the
    call as Phone Link plays it. Loopback delivers nothing while nothing plays; `SilenceFiller`
    sends that silence on, so ElevenLabs still hears the caller stop talking."""

    def __init__(self, wanted: int | str | None) -> None:
        self.wanted = wanted
        self.name = ""
        self.pa: Any = None
        self.opened: OpenTry | None = None
        self.failures: list[str] = []
        #: Samples (at the conversation's rate) that came from the device, not the filler.
        self.device_samples = 0
        self._info: dict[str, Any] | None = None
        self._stream: Any = None
        self._filler: SilenceFiller | None = None
        self._on_mic: MicSink | None = None
        self._filler_task: asyncio.Task[None] | None = None

    def prepare(self, sd: Any) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415 - Windows only, with a real device

        if self.pa is None:
            self.pa = pyaudio.PyAudio()
        if self.wanted is None:
            self._info = dict(self.pa.get_default_wasapi_loopback())
        else:
            name = (
                str(sd.query_devices(self.wanted)["name"])
                if isinstance(self.wanted, int)
                else str(self.wanted)
            )
            loopbacks = [dict(d) for d in self.pa.get_loopback_device_info_generator()]
            found = match_loopback(name, [str(d["name"]) for d in loopbacks])
            if found is None:
                raise LookupError(f"no loopback of an output device named like '{name}'")
            self._info = loopbacks[found]
        self.name = loopback_base(str(self._info["name"]))

    def output_fallbacks(self, name: str) -> list[OpenTry]:
        """PyAudioWPatch's own entry of the agent's output, the last try for it."""
        if self.pa is None:
            return []
        import pyaudiowpatch as pyaudio  # noqa: PLC0415

        try:
            devices = [dict(d) for d in self.pa.get_device_info_generator_by_host_api(host_api_type=pyaudio.paWASAPI)]
        except Exception as error:  # noqa: BLE001 - only a fallback
            log.warning("no PyAudioWPatch output list (%s)", describe_error(error))
            return []
        return pa_output_plan(devices, name)

    def open(self, sd: Any, loop: asyncio.AbstractEventLoop, on_mic: MicSink, mic_rate: int) -> None:
        import pyaudiowpatch as pyaudio  # noqa: PLC0415

        if self._info is None:
            self.prepare(sd)
        assert self._info is not None
        self._filler = SilenceFiller(mic_rate)
        self._on_mic = on_mic
        self.device_samples = 0

        def open_one(attempt: OpenTry) -> Any:
            capture = Resampler(attempt.rate, mic_rate)
            channels = attempt.channels

            def on_input(data: bytes, _count: int, _time: Any, _status: Any) -> tuple[None, int]:
                frames = np.frombuffer(data, dtype=np.int16).reshape(-1, channels)
                block = capture.process(to_mono(frames))
                if block.size:
                    try:
                        loop.call_soon_threadsafe(self._deliver, block)
                    except RuntimeError:  # the loop is closing: the call is over
                        return (None, pyaudio.paComplete)
                return (None, pyaudio.paContinue)

            raw = self.pa.open(
                format=pyaudio.paInt16,
                channels=channels,
                rate=attempt.rate,
                input=True,
                input_device_index=attempt.index,
                frames_per_buffer=attempt.rate // 50,
                stream_callback=on_input,
            )
            stream = _PaStream(raw)
            try:
                raw.start_stream()
            except Exception:
                _close_stream(stream)
                raise
            return stream

        try:
            self.opened, self._stream, self.failures = open_first(
                "loopback", loopback_plan(self._info), open_one
            )
        except AudioOpenError as error:
            self.failures = error.failures
            raise

    def _deliver(self, block: np.ndarray) -> None:
        self.device_samples += block.size
        if self._filler is not None:
            self._filler.delivered(block.size, time.monotonic())
        if self._on_mic is not None:
            self._on_mic(block)

    def started(self, loop: asyncio.AbstractEventLoop) -> None:
        self._filler_task = loop.create_task(self._fill())

    async def _fill(self) -> None:
        while True:
            await asyncio.sleep(0.02)
            if self._filler is None or self._on_mic is None:
                continue
            owed = self._filler.owed(time.monotonic())
            if owed:
                self._on_mic(np.zeros(owed, dtype=np.int16))

    def stop_tasks(self) -> None:
        if self._filler_task is not None:
            self._filler_task.cancel()
            self._filler_task = None
        self._on_mic = None

    def close_streams(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            except Exception:  # noqa: BLE001 - closing a dead device must not fail the call
                log.warning("loopback close failed")
            self._stream = None
        if self.pa is not None:
            try:
                self.pa.terminate()
            except Exception:  # noqa: BLE001
                pass
            self.pa = None
            self._info = None


def _import_sounddevice() -> Any:
    import sounddevice as sd  # noqa: PLC0415 - only with a real device

    return sd


class DeviceAudio:
    """A capture side and a playback side, both real devices; every PortAudio call on the audio
    thread."""

    def __init__(self, capture: _InputCapture | _LoopbackCapture, playback: _Playback) -> None:
        self.capture = capture
        self.playback = playback
        self._prepared = False

    def prepare(self) -> None:
        """Find both devices (before a call is answered: a missing device leaves the phone
        ringing for staff instead of a silent call). Raises LookupError."""
        on_audio_thread(self._prepare)

    def _prepare(self) -> None:
        sd = _import_sounddevice()
        self.capture.prepare(sd)
        self.playback.prepare(sd)
        check_roles(self.capture.name, self.playback.name, isinstance(self.capture, _LoopbackCapture))
        self._prepared = True

    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        loop = asyncio.get_running_loop()
        await on_audio_thread_async(self._open, loop, on_mic, mic_rate)
        self.capture.started(loop)

    def _open(self, loop: asyncio.AbstractEventLoop, on_mic: MicSink, mic_rate: int) -> None:
        if not self._prepared:
            self._prepare()
        sd = _import_sounddevice()
        extra = self.capture.output_fallbacks(self.playback.name)
        self.playback.open(sd, self.capture.pa, extra)
        try:
            self.capture.open(sd, loop, on_mic, mic_rate)
        except BaseException:
            self.playback.close()
            raise

    def play(self, pcm: bytes, rate: int) -> None:
        self.playback.play(pcm, rate)

    def flush(self) -> None:
        self.playback.flush()

    def pending_ms(self) -> float:
        return self.playback.pending_ms()

    async def close(self) -> None:
        self.capture.stop_tasks()
        await on_audio_thread_async(self._close)

    def _close(self) -> None:
        self.capture.close_streams()
        self.playback.close()
        self._prepared = False


class LocalAudio(DeviceAudio):
    """The PC's own microphone and speakers (stage 2). A headset keeps the agent from hearing
    itself: there is no echo cancellation (ADR-0232 #12)."""

    def __init__(self, input_device: int | str | None, output_device: int | str | None) -> None:
        super().__init__(_InputCapture(input_device), _Playback(output_device))


class BluetoothAudio(DeviceAudio):
    """Phone Link: the call captured from `call_output_device`, the agent into VB-Cable."""

    def __init__(self, call_output: int | str | None, agent_output: int | str | None) -> None:
        super().__init__(_LoopbackCapture(call_output), _Playback(agent_output or VB_CABLE_INPUT))


class ListenAudio:
    """An input alone (`audio-test` listens on «CABLE Output» for its tone)."""

    def __init__(self, wanted: int | str | None) -> None:
        self.capture = _InputCapture(wanted)

    def prepare(self) -> None:
        on_audio_thread(lambda: self.capture.prepare(_import_sounddevice()))

    async def start(self, on_mic: MicSink, mic_rate: int) -> None:
        loop = asyncio.get_running_loop()
        await on_audio_thread_async(
            lambda: self.capture.open(_import_sounddevice(), loop, on_mic, mic_rate)
        )

    async def close(self) -> None:
        await on_audio_thread_async(self.capture.close_streams)


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
    PortAudio's default. Among the names that match: the whole name first, then the WASAPI entry;
    VB-Cable's «CABLE In 16ch» only when nothing else matches."""
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
        matches.sort(
            key=lambda index: (
                "16ch" in devices[index]["name"].lower() and "16ch" not in part,
                "WASAPI" not in hosts[devices[index]["hostapi"]]["name"],
            )
        )
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


#: VB-Cable's recording side: Phone Link's microphone in bluetooth mode.
CABLE_OUTPUT_NAME = "CABLE Output"


def output_and_input_names() -> tuple[list[str], list[str]]:
    """Every output's and every input's name (all host APIs), read on the audio thread."""

    def read() -> tuple[list[str], list[str]]:
        devices = _import_sounddevice().query_devices()
        outs = [str(d["name"]) for d in devices if d["max_output_channels"] > 0]
        ins = [str(d["name"]) for d in devices if d["max_input_channels"] > 0]
        return outs, ins

    return on_audio_thread(read)


def list_devices() -> list[str]:
    def read() -> tuple[Any, Any]:
        sd = _import_sounddevice()
        return sd.query_hostapis(), sd.query_devices()

    hosts, devices = on_audio_thread(read)
    lines = []
    for index, device in enumerate(devices):
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
    """Every output device's level by loopback for `seconds` (Windows, PyAudioWPatch), on the
    audio thread. An output nothing plays on delivers no samples and reads as silence."""
    return on_audio_thread(_measure_outputs, seconds)


def _measure_outputs(seconds: float) -> list[tuple[str, float]]:
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
            except Exception as error:  # noqa: BLE001 - a device that will not open is not the call's
                log.info("find-call-device: %s did not open (%s)", name[:40], describe_error(error))
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
