"""Fake sounddevice and PyAudioWPatch modules: the owner's devices (2026-11-20) on four host APIs,
streams that call their callbacks from their own thread (ten times faster than real time), VB-Cable
carrying what is played into «CABLE Input» to «CABLE Output», and every PortAudio call recorded
with the thread it came from."""

from __future__ import annotations

import threading
import types
from typing import Any, Callable

import numpy as np

from btobridge.dsp import tone

TICK_S = 0.002

HOSTS = [
    {"name": "MME", "default_input_device": 1, "default_output_device": 0},
    {"name": "Windows DirectSound", "default_input_device": -1, "default_output_device": -1},
    {"name": "Windows WASAPI", "default_input_device": 32, "default_output_device": 25},
    {"name": "Windows WDM-KS", "default_input_device": -1, "default_output_device": -1},
]

#: (host index, name, inputs, outputs, rate)
_FULL = [
    ("Speakers (Realtek(R) Audio)", 0, 2, 48000),
    ("Headset Earphone (HyperX Cloud Alpha S Chat)", 0, 2, 48000),
    ("CABLE Input (VB-Audio Virtual Cable)", 0, 2, 44100),
    ("CABLE In 16ch (VB-Audio Virtual Cable)", 0, 16, 44100),
    ("Microphone (HyperX Cloud Alpha S Chat)", 1, 0, 48000),
    ("CABLE Output (VB-Audio Virtual Cable)", 2, 0, 44100),
]


def _devices() -> list[dict[str, Any]]:
    devices: list[dict[str, Any]] = []

    def add(host: int, name: str, ins: int, outs: int, rate: int) -> None:
        devices.append(
            {
                "name": name,
                "hostapi": host,
                "max_input_channels": ins,
                "max_output_channels": outs,
                "default_samplerate": float(rate),
            }
        )

    for name, ins, outs, rate in _FULL:  # MME: names cut at 31 characters
        add(0, name[:31], ins, outs, rate)
    for name, ins, outs, rate in _FULL:
        add(1, name, ins, outs, rate)
    while len(devices) < 24:  # the owner's WASAPI entries start at 24
        add(3, f"Filler {len(devices)}", 0, 2, 48000)
    owner = [
        ("Speakers (Realtek(R) Audio)", 0, 2, 48000),
        ("Headset Earphone (HyperX Cloud Alpha S Chat)", 0, 2, 48000),
        ("CABLE Input (VB-Audio Virtual Cable)", 0, 2, 44100),
        ("CABLE In 16ch (VB-Audio Virtual Cable)", 0, 16, 44100),
        ("AI Noise-cancelling Output (ASUS Utility)", 0, 2, 48000),
        ("Speakers (HyperX Cloud Alpha S Game)", 0, 2, 48000),
        ("Microphone Array (Realtek)", 2, 0, 48000),
        ("Microphone (HyperX Cloud Alpha S Chat)", 1, 0, 48000),
        ("CABLE Output (VB-Audio Virtual Cable)", 2, 0, 44100),
        ("AI Noise-cancelling Input (ASUS)", 2, 0, 48000),
    ]
    for name, ins, outs, rate in owner:
        add(2, name, ins, outs, rate)
    return devices


DEVICES = _devices()
CABLE_INPUT_WASAPI = 26
CALL_OUTPUT_WASAPI = 25


class Recorder:
    def __init__(self) -> None:
        self.threads: set[int] = set()
        self.opened: list[dict[str, Any]] = []
        self.lock = threading.Lock()

    def touch(self) -> None:
        with self.lock:
            self.threads.add(threading.get_ident())


class _Ticker:
    def __init__(self, tick: Callable[[], None]) -> None:
        self._tick = tick
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.wait(TICK_S):
            self._tick()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(1)


class Cable:
    """VB-Cable: what is played into «CABLE Input» comes out of «CABLE Output»."""

    def __init__(self) -> None:
        self.blocks: list[np.ndarray] = []
        self.lock = threading.Lock()

    def put(self, block: np.ndarray) -> None:
        with self.lock:
            self.blocks.append(block.copy())

    def take(self, count: int, channels: int) -> np.ndarray:
        with self.lock:
            block = self.blocks.pop(0) if self.blocks else None
        if block is None or block.shape[0] != count:
            return np.zeros((count, channels), dtype=np.int16)
        mono = block.mean(axis=1).astype(np.int16)
        return np.repeat(mono.reshape(-1, 1), channels, axis=1)


def make_sounddevice(
    recorder: Recorder,
    fail: Callable[[str, dict[str, Any]], BaseException | None] = lambda _kind, _args: None,
) -> types.ModuleType:
    sd = types.ModuleType("sounddevice")
    cable = Cable()

    class PortAudioError(Exception):
        pass

    class WasapiSettings:
        def __init__(self, exclusive: bool = False, auto_convert: bool = False) -> None:
            self.auto_convert = auto_convert

    def query_devices(device: int | None = None) -> Any:
        recorder.touch()
        return DEVICES if device is None else DEVICES[device]

    def query_hostapis() -> Any:
        recorder.touch()
        return HOSTS

    class _Stream:
        kind = ""

        def __init__(self, **args: Any) -> None:
            recorder.touch()
            settings = args.get("extra_settings")
            record = {
                "kind": self.kind,
                "device": args["device"],
                "rate": args["samplerate"],
                "channels": args["channels"],
                "auto_convert": bool(settings and settings.auto_convert),
            }
            problem = fail(self.kind, record)
            if problem is not None:
                raise problem
            recorder.opened.append(record)
            self.args = args
            self.name = DEVICES[args["device"]]["name"]
            self._ticker = _Ticker(self._tick)

        def start(self) -> None:
            recorder.touch()
            self._ticker.start()

        def stop(self) -> None:
            recorder.touch()
            self._ticker.stop()

        def close(self) -> None:
            recorder.touch()

    class OutputStream(_Stream):
        kind = "output"

        def _tick(self) -> None:
            count = self.args["blocksize"]
            out = np.zeros((count, self.args["channels"]), dtype=np.int16)
            self.args["callback"](out, count, None, None)
            if "CABLE Input" in self.name:
                cable.put(out)

    class InputStream(_Stream):
        kind = "input"

        def _tick(self) -> None:
            count = self.args["blocksize"]
            frames = cable.take(count, self.args["channels"]) if "CABLE Output" in self.name else np.zeros(
                (count, self.args["channels"]), dtype=np.int16
            )
            self.args["callback"](frames, count, None, None)

    sd.PortAudioError = PortAudioError  # type: ignore[attr-defined]
    sd.WasapiSettings = WasapiSettings  # type: ignore[attr-defined]
    sd.query_devices = query_devices  # type: ignore[attr-defined]
    sd.query_hostapis = query_hostapis  # type: ignore[attr-defined]
    sd.OutputStream = OutputStream  # type: ignore[attr-defined]
    sd.InputStream = InputStream  # type: ignore[attr-defined]
    sd.default = types.SimpleNamespace(device=(1, 0))  # type: ignore[attr-defined]
    return sd


#: PyAudioWPatch's WASAPI list: the outputs, then their loopbacks.
PA_OUTPUTS = [
    ("Headset Earphone (HyperX Cloud Alpha S Chat)", 48000, 2),
    ("CABLE Input (VB-Audio Virtual Cable)", 44100, 2),
    ("CABLE In 16ch (VB-Audio Virtual Cable)", 44100, 16),
]


def pa_devices() -> list[dict[str, Any]]:
    devices = []
    for name, rate, channels in PA_OUTPUTS:
        devices.append(
            {"index": len(devices), "name": name, "maxInputChannels": 0, "maxOutputChannels": channels,
             "defaultSampleRate": float(rate), "isLoopbackDevice": False}
        )
    for name, rate, channels in PA_OUTPUTS:
        devices.append(
            {"index": len(devices), "name": f"{name} [Loopback]", "maxInputChannels": channels,
             "maxOutputChannels": 0, "defaultSampleRate": float(rate), "isLoopbackDevice": True}
        )
    return devices


def make_pyaudiowpatch(
    recorder: Recorder,
    fail: Callable[[str, dict[str, Any]], BaseException | None] = lambda _kind, _args: None,
) -> types.ModuleType:
    pa_module = types.ModuleType("pyaudiowpatch")
    devices = pa_devices()

    class Stream:
        def __init__(self, **args: Any) -> None:
            recorder.touch()
            kind = "pa-input" if args.get("input") else "pa-output"
            index = args.get("input_device_index", args.get("output_device_index"))
            record = {"kind": kind, "device": index, "rate": args["rate"], "channels": args["channels"]}
            problem = fail(kind, record)
            if problem is not None:
                raise problem
            recorder.opened.append(record)
            self.args = args
            self.kind = kind
            self._ticker = _Ticker(self._tick)
            self._ticker.start()  # PyAudio starts a stream when it opens it
            self._phase = 0

        def _tick(self) -> None:
            count = self.args["frames_per_buffer"]
            channels = self.args["channels"]
            if self.kind == "pa-input":  # the caller talks: a 440 Hz tone at -20 dBFS
                mono = tone(440, self.args["rate"], 1.0, -20.0)
                start = self._phase % (mono.size - count)
                self._phase += count
                block = np.repeat(mono[start : start + count].reshape(-1, 1), channels, axis=1)
                self.args["stream_callback"](block.tobytes(), count, None, 0)
            else:
                self.args["stream_callback"](None, count, None, 0)

        def start_stream(self) -> None:
            recorder.touch()

        def stop_stream(self) -> None:
            recorder.touch()
            self._ticker.stop()

        def close(self) -> None:
            recorder.touch()
            self._ticker.stop()

    class PyAudio:
        def __init__(self) -> None:
            recorder.touch()

        def get_loopback_device_info_generator(self) -> Any:
            recorder.touch()
            return iter([d for d in devices if d["isLoopbackDevice"]])

        def get_device_info_generator_by_host_api(self, **_kwargs: Any) -> Any:
            recorder.touch()
            return iter(devices)

        def get_default_wasapi_loopback(self) -> dict[str, Any]:
            return devices[len(PA_OUTPUTS)]

        def open(self, **args: Any) -> Stream:
            return Stream(**args)

        def terminate(self) -> None:
            recorder.touch()

    pa_module.PyAudio = PyAudio  # type: ignore[attr-defined]
    pa_module.paInt16 = 8  # type: ignore[attr-defined]
    pa_module.paContinue = 0  # type: ignore[attr-defined]
    pa_module.paComplete = 1  # type: ignore[attr-defined]
    pa_module.paWASAPI = 13  # type: ignore[attr-defined]
    return pa_module
