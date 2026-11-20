"""`bridge audio-test`: the call's audio opened exactly as a call opens it, before a call.

For 5 s: the loopback of the call device (what Phone Link plays the call on) and the agent's
output («CABLE Input») are opened through the same plan and the same audio thread a call uses; a
1 kHz tone is played into the cable after 1 s; «CABLE Output» (Phone Link's microphone, VB-Cable's
other end) is listened to for that tone when it opens. The console says «OK» or the exact error,
with every way that was tried; the same goes to bridge.log (device names, rates, PortAudio's words
and codes: no call content).
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import numpy as np

from .audio import CABLE_OUTPUT_NAME, describe_error
from .dsp import level_dbfs, tone, tone_dbfs

log = logging.getLogger("btobridge.audiotest")

RATE = 16000
TEST_S = 5.0
TONE_AT_S = 1.0
TONE_S = 1.0
TONE_HZ = 1000.0
TONE_DBFS = -12.0
#: The tone counts as having passed through VB-Cable this loud on «CABLE Output».
HEARD_MIN_DBFS = -40.0
#: The agent's queue must be this empty at the end: the device took the tone.
DRAINED_MS = 60.0
#: VB-Cable's recording side, Phone Link's microphone.
CABLE_OUTPUT = CABLE_OUTPUT_NAME


@dataclass
class AudioTestResult:
    ok: bool = False
    error: str | None = None
    failures: list[str] = field(default_factory=list)
    playback: str | None = None
    capture: str | None = None
    #: Sound that came from the call's device (silence while there is no call is normal).
    call_ms: float = 0.0
    call_dbfs: float = -120.0
    #: The agent's audio still queued at the end: the output did not take it.
    tone_left_ms: float = 0.0
    #: The tone heard on «CABLE Output»; None when it was not listened to.
    cable_dbfs: float | None = None
    cable_error: str | None = None


class _Collector:
    def __init__(self) -> None:
        self.blocks: list[np.ndarray] = []

    def __call__(self, block: np.ndarray) -> None:
        self.blocks.append(block.copy())

    def take(self) -> np.ndarray:
        blocks, self.blocks = self.blocks, []
        return np.concatenate(blocks) if blocks else np.zeros(0, dtype=np.int16)


def loudest(samples: np.ndarray, measure: Callable[[np.ndarray], float], window_s: float = 0.2) -> float:
    """The loudest window's level, so a short sound is not averaged away by the silence around it."""
    width = max(1, int(RATE * window_s))
    if samples.size == 0:
        return -120.0
    return max(measure(samples[start : start + width]) for start in range(0, samples.size, width))


def judge(result: AudioTestResult) -> bool:
    if result.error is not None:
        return False
    if result.tone_left_ms > DRAINED_MS:
        return False
    return result.cable_dbfs is None or result.cable_dbfs >= HEARD_MIN_DBFS


def _opened(audio: Any, side: str) -> str | None:
    opened = getattr(getattr(audio, side, None), "opened", None)
    return opened.label() if opened is not None else None


async def _close(port: Any) -> None:
    try:
        await port.close()
    except Exception as error:  # noqa: BLE001 - the result matters, not the close
        log.warning("audio-test close failed (%s)", describe_error(error))


async def run(
    audio: Any,
    listen: Any | None,
    say: Callable[[str], None],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> AudioTestResult:
    """`audio` is the mode's AudioPort (prepare/start/play/pending_ms/close); `listen` an input on
    «CABLE Output» (or None)."""
    result = AudioTestResult()
    call = _Collector()
    heard = _Collector()
    say(f"Дууны зам шалгаж байна ({int(TEST_S)} секунд)...")
    try:
        prepare = getattr(audio, "prepare", None)
        if prepare is not None:
            await asyncio.to_thread(prepare)
        await audio.start(call, RATE)
    except Exception as error:  # noqa: BLE001 - exactly what a call would meet
        result.error = describe_error(error)
        result.failures = list(getattr(error, "failures", []))
        await _close(audio)
        _report(result, say)
        return result
    result.playback = _opened(audio, "playback")
    result.capture = _opened(audio, "capture")
    listening = False
    if listen is not None:
        try:
            await asyncio.to_thread(listen.prepare)
            await listen.start(heard, RATE)
            listening = True
        except Exception as error:  # noqa: BLE001 - the check of the cable is extra
            result.cable_error = describe_error(error)
            await _close(listen)
    try:
        await sleep(TONE_AT_S)
        audio.play(tone(TONE_HZ, RATE, TONE_S, TONE_DBFS).tobytes(), RATE)
        await sleep(TEST_S - TONE_AT_S)
        result.tone_left_ms = float(audio.pending_ms())
    finally:
        await _close(audio)
        if listening:
            await _close(listen)
    samples = call.take()
    device_samples = getattr(getattr(audio, "capture", None), "device_samples", None)
    result.call_ms = (samples.size if device_samples is None else int(device_samples)) / RATE * 1000
    result.call_dbfs = loudest(samples, level_dbfs)
    if listening:
        result.cable_dbfs = loudest(heard.take(), lambda part: tone_dbfs(part, TONE_HZ, RATE))
    result.ok = judge(result)
    _report(result, say)
    return result


def _report(result: AudioTestResult, say: Callable[[str], None]) -> None:
    log.info(
        "audio-test ok=%s playback=%s capture=%s call=%.0fms/%.1fdBFS left=%.0fms cable=%s error=%s",
        result.ok,
        result.playback,
        result.capture,
        result.call_ms,
        result.call_dbfs,
        result.tone_left_ms,
        "-" if result.cable_dbfs is None else f"{result.cable_dbfs:.1f}",
        result.error or result.cable_error or "-",
    )
    if result.error is not None:
        say("АЛДАА: дуу нээгдсэнгүй.")
        say(f"  {result.error}")
        if result.failures:
            say("  Оролдсон бүх арга:")
            for line in result.failures:
                say(f"    {line}")
        say("  Энэ бичвэрийг (bridge.log-д бас бий) хөгжүүлэгчид илгээнэ үү.")
        return
    say(f"  дуудлагын дуу (loopback): {result.capture or '-'}")
    say(f"  AI-гийн дуу (VB-Cable):   {result.playback or '-'}")
    if result.call_ms > 0:
        say(f"  дуудлагын төхөөрөмжөөс ирсэн дуу: {result.call_ms / 1000:.1f} с, хамгийн чанга {result.call_dbfs:.0f} dBFS")
    else:
        say("  дуудлагын төхөөрөмж чимээгүй (дуудлага байхгүй үед хэвийн)")
    if result.tone_left_ms > DRAINED_MS:
        say(f"  VB-Cable руу тоглуулсан дохио тоглогдсонгүй ({result.tone_left_ms:.0f} мс үлдсэн)")
    else:
        say("  VB-Cable руу тоглуулсан дохио бүрэн тоглогдлоо")
    if result.cable_dbfs is not None:
        heard = "сонсогдлоо" if result.cable_dbfs >= HEARD_MIN_DBFS else "СОНСОГДСОНГҮЙ"
        say(f"  «{CABLE_OUTPUT}» (Phone Link-ийн микрофон) дээр дохио {heard}: {result.cable_dbfs:.0f} dBFS")
    elif result.cable_error is not None:
        say(f"  «{CABLE_OUTPUT}»-г сонсож чадсангүй ({result.cable_error})")
    if result.ok:
        say("OK: дуудлагын дуу нээгдэж байна. Одоо залгаж болно.")
    else:
        say("АЛДАА: AI-гийн дуу VB-Cable-аар дамжихгүй байна. Windows-ийн дууны тохиргоонд «CABLE Input»-ийг шалгана уу.")
