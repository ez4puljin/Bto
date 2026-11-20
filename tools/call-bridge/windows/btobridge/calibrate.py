"""`bridge calibrate`: how much of the agent's voice comes back on the caller's side (echo), and
how loud the caller arrives (ADR-0232 #12: no echo cancellation until it is measured).

During a test call (another phone rings the line, the line's phone takes it with its audio on the
PC): a 1 kHz tone is played for 2 s where the agent's voice goes, and its level on the call's side
is measured against the room's level before it (the echo leak, dB below what was played). Then the
owner talks into the calling phone for 5 s: the level of the voice, and whether it clips.

The console shows plain words; the numbers go to bridge.log only.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Awaitable, Callable

import numpy as np

from .dsp import clipped, level_dbfs, tone, tone_dbfs

log = logging.getLogger("btobridge.calibrate")

RATE = 16000
TONE_HZ = 1000.0
TONE_DBFS = -12.0
TONE_S = 2.0
#: The echo is measured from this long after the tone starts (the path's own delay).
TONE_SETTLE_S = 0.4
#: An echo leak above this (dB relative to the tone played) is worth the echo gate.
ECHO_GATE_DB = -35.0
#: The tone counts as heard back only this far above the level at 1 kHz before it.
DETECT_MARGIN_DB = 6.0
VOICE_S = 5.0
VOICE_FRAME_MS = 20
VOICE_MIN_DBFS = -45.0


@dataclass
class EchoResult:
    noise_dbfs: float
    heard_dbfs: float
    leak_db: float
    #: "none" (not measurable), "low" (below ECHO_GATE_DB), "high" (the gate is advised).
    verdict: str


def analyse_echo(before: np.ndarray, during: np.ndarray, rate: int = RATE) -> EchoResult:
    noise = tone_dbfs(before, TONE_HZ, rate)
    heard = tone_dbfs(during, TONE_HZ, rate)
    leak = heard - TONE_DBFS
    if heard - noise < DETECT_MARGIN_DB:
        verdict = "none"
    elif leak > ECHO_GATE_DB:
        verdict = "high"
    else:
        verdict = "low"
    return EchoResult(noise_dbfs=noise, heard_dbfs=heard, leak_db=leak, verdict=verdict)


@dataclass
class VoiceResult:
    voiced_share: float
    voice_dbfs: float
    peak_dbfs: float
    clipped: int
    #: "silent", "quiet", "good", "loud", "clipping".
    verdict: str


def analyse_voice(samples: np.ndarray, rate: int = RATE) -> VoiceResult:
    frame = rate * VOICE_FRAME_MS // 1000
    count = samples.size // frame
    levels = [level_dbfs(samples[i * frame : (i + 1) * frame]) for i in range(count)]
    voiced = [i for i, level in enumerate(levels) if level > VOICE_MIN_DBFS]
    clips = clipped(samples)
    peak = float(np.max(np.abs(samples.astype(np.int32)))) if samples.size else 0.0
    peak_dbfs = 20 * np.log10(max(peak, 1.0) / 32768)
    if voiced:
        voiced_samples = np.concatenate([samples[i * frame : (i + 1) * frame] for i in voiced])
        voice = level_dbfs(voiced_samples)
    else:
        voice = -120.0
    share = len(voiced) / count if count else 0.0
    if share < 0.1:
        verdict = "silent"
    elif clips > 10:
        verdict = "clipping"
    elif voice < -35:
        verdict = "quiet"
    elif voice > -8:
        verdict = "loud"
    else:
        verdict = "good"
    return VoiceResult(share, voice, float(peak_dbfs), clips, verdict)


ECHO_WORDS = {
    "none": "AI-гийн дуу залгагчийн талд буцаж сонсогдсонгүй. Цуурай байхгүй: echo_gate хэрэггүй.",
    "low": "AI-гийн дуу маш бага буцаж сонсогдож байна. Хэвийн: echo_gate хэрэггүй.",
    "high": (
        "AI-гийн дуу залгагчийн талд чанга буцаж ирж байна (цуурай). AI өөрийнхөө дууг сонсож"
        " болзошгүй: echo_gate-г асаахыг зөвлөж байна."
    ),
}
VOICE_WORDS = {
    "silent": "Залгагчийн дуу сонсогдсонгүй. Дуудлага компьютер руу шилжсэн эсэх, төхөөрөмжөө шалгана уу.",
    "quiet": "Залгагчийн дуу сул байна. Windows-д тэр төхөөрөмжийн дууг ихэсгэнэ үү.",
    "good": "Залгагчийн дуу хэвийн түвшинд байна.",
    "loud": "Залгагчийн дуу хэт чанга байна. Windows-д тэр төхөөрөмжийн дууг бага зэрэг багасгана уу.",
    "clipping": "Залгагчийн дуу тасарч (хэт чанга) байна. Тэр төхөөрөмжийн дууг багасгана уу.",
}


class _Collector:
    def __init__(self) -> None:
        self.blocks: list[np.ndarray] = []

    def __call__(self, block: np.ndarray) -> None:
        self.blocks.append(block.copy())

    def take(self) -> np.ndarray:
        blocks, self.blocks = self.blocks, []
        return np.concatenate(blocks) if blocks else np.zeros(0, dtype=np.int16)


async def run(
    audio: object,
    say: Callable[[str], None],
    ask: Callable[[str], Awaitable[str]],
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> tuple[EchoResult, VoiceResult]:
    """`audio` is an opened mode's AudioPort (prepare/start/play/close)."""
    collect = _Collector()
    prepare = getattr(audio, "prepare", None)
    if prepare is not None:
        await asyncio.to_thread(prepare)
    say("1. Өөр утаснаас шугамын утас руу залгаж, шугамын утсан дээр дуудлагыг аваарай.")
    say("   Дуу компьютер руу (Phone Link) шилжсэн байх ёстой. Залгасан утсаа чимээгүй барина.")
    await ask("   Дуудлага холбогдсон бол Enter дарна уу...")
    await audio.start(collect, RATE)  # type: ignore[attr-defined]
    try:
        await sleep(1.0)
        collect.take()
        await sleep(1.5)
        before = collect.take()
        say("2. Туршилтын дуу (2 секунд)...")
        audio.play(tone(TONE_HZ, RATE, TONE_S, TONE_DBFS).tobytes(), RATE)  # type: ignore[attr-defined]
        await sleep(TONE_SETTLE_S)
        collect.take()
        await sleep(TONE_S - TONE_SETTLE_S)
        during = collect.take()
        await sleep(0.5)
        collect.take()
        echo = analyse_echo(before, during)
        say(f"3. Одоо залгасан утсаараа {int(VOICE_S)} секунд энгийнээр ярина уу (тоолж болно)...")
        await sleep(VOICE_S)
        voice = analyse_voice(collect.take())
    finally:
        await audio.close()  # type: ignore[attr-defined]
    log.info(
        "calibrate echo noise=%.1f heard=%.1f leak=%.1fdB %s; voice share=%.2f level=%.1f"
        " peak=%.1f clipped=%s %s",
        echo.noise_dbfs,
        echo.heard_dbfs,
        echo.leak_db,
        echo.verdict,
        voice.voiced_share,
        voice.voice_dbfs,
        voice.peak_dbfs,
        voice.clipped,
        voice.verdict,
    )
    say("Дүн:")
    say("  " + ECHO_WORDS[echo.verdict])
    say("  " + VOICE_WORDS[voice.verdict])
    say("  Тасарсан (хэт чанга) дээж: " + ("байгаа" if voice.clipped else "байхгүй"))
    say("  (Тоонууд bridge.log файлд.) Одоо дуудлагаа тасалж болно.")
    return echo, voice
