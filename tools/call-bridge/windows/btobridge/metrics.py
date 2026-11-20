"""What stage 2 measures (ADR-0232 «Open points»), numbers only.

- **Response time**: from the end of the caller's speech to the agent's first audio chunk of the
  answer. The end of speech is the last voiced frame the bridge's own voice detector saw before
  ElevenLabs sent the caller's transcript (`user_transcript`); without one (a muted or noisy mic),
  the transcript's arrival. The time from the transcript alone is kept too (`asr_ms`): it leaves
  out ElevenLabs' end-of-turn wait, so the two together show where the time goes.
- **Greeting**: from the moment Bto answered `POST /calls` to the first agent audio.
- **Ring -> answer** (stage 3): from the phone's `ringing` to the bridge telling it `answer`; the
  phone's limit is 3000 ms.
- **Answer -> greeting** (stage 3): from the phone saying the call is connected to the first agent
  audio played into it (the owner's bar: 1500 ms).
- **Searches**: `search_products` calls Bto answered, and how many found nothing.

A call's numbers are appended to metrics.csv as one row; nothing in it is a word of the call.
"""

from __future__ import annotations

import csv
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

#: The local voice end counts only if it is this close before the transcript (else it was an
#: earlier sentence, or noise).
VOICE_WINDOW_S = 5.0

COLUMNS = (
    "ended_unix",
    "call_id",
    "duration_s",
    "end_reason",
    "turns",
    "latency_median_ms",
    "latency_p90_ms",
    "asr_median_ms",
    "greeting_ms",
    "searches",
    "no_hits",
    "tools",
    "tool_errors",
    "tool_median_ms",
    "latencies_ms",
    "ring_answer_ms",
    "answer_greeting_ms",
)


def percentile(values: list[float], share: float) -> float | None:
    """Linear interpolation between the closest ranks (numpy's default); None for no values."""
    if not values:
        return None
    ordered = sorted(values)
    position = (len(ordered) - 1) * share
    low = int(position)
    high = min(low + 1, len(ordered) - 1)
    return ordered[low] + (ordered[high] - ordered[low]) * (position - low)


def _ms(value: float | None) -> str:
    return "" if value is None else str(round(value))


@dataclass
class CallMetrics:
    clock: Callable[[], float] = time.monotonic
    answered_at: float | None = None
    first_audio_at: float | None = None
    latencies_ms: list[float] = field(default_factory=list)
    asr_ms: list[float] = field(default_factory=list)
    tool_ms: list[float] = field(default_factory=list)
    searches: int = 0
    no_hits: int = 0
    tools: int = 0
    tool_errors: int = 0
    _last_voice_at: float | None = None
    _last_agent_audio_at: float | None = None
    _turn_end: float | None = None
    _transcript_at: float | None = None
    rang_at: float | None = None
    answer_sent_at: float | None = None
    connected_at: float | None = None

    def rang(self, at: float | None = None) -> None:
        self.rang_at = self.clock() if at is None else at

    def answered(self) -> None:
        self.answered_at = self.clock()

    def answer_sent(self) -> None:
        self.answer_sent_at = self.clock()

    def connected(self) -> None:
        self.connected_at = self.clock()

    @property
    def ring_answer_ms(self) -> float | None:
        if self.rang_at is None or self.answer_sent_at is None:
            return None
        return (self.answer_sent_at - self.rang_at) * 1000

    @property
    def answer_greeting_ms(self) -> float | None:
        if self.connected_at is None or self.first_audio_at is None:
            return None
        return max(0.0, (self.first_audio_at - self.connected_at) * 1000)

    def user_voice(self, at: float | None = None) -> None:
        """A voiced frame of the caller's microphone."""
        self._last_voice_at = self.clock() if at is None else at

    def user_transcript(self) -> None:
        now = self.clock()
        voice = self._last_voice_at
        recent = (
            voice is not None
            and now - voice <= VOICE_WINDOW_S
            and (self._last_agent_audio_at is None or voice > self._last_agent_audio_at)
        )
        self._turn_end = voice if recent else now
        self._transcript_at = now

    def agent_audio(self) -> None:
        now = self.clock()
        if self.first_audio_at is None:
            self.first_audio_at = now
        if self._turn_end is not None:
            self.latencies_ms.append((now - self._turn_end) * 1000)
            if self._transcript_at is not None:
                self.asr_ms.append((now - self._transcript_at) * 1000)
            self._turn_end = None
            self._transcript_at = None
        self._last_agent_audio_at = now

    def tool(self, name: str, ok: bool, answer: dict[str, Any] | None, ms: float) -> None:
        self.tools += 1
        self.tool_ms.append(ms)
        if not ok:
            self.tool_errors += 1
        if name == "search_products" and ok:
            self.searches += 1
            products = (answer or {}).get("products")
            if isinstance(products, list) and len(products) == 0:
                self.no_hits += 1

    @property
    def greeting_ms(self) -> float | None:
        if self.answered_at is None or self.first_audio_at is None:
            return None
        return (self.first_audio_at - self.answered_at) * 1000

    def row(self, call_id: int, duration_s: int, end_reason: str) -> dict[str, str]:
        return {
            "ended_unix": str(int(time.time())),
            "call_id": str(call_id),
            "duration_s": str(duration_s),
            "end_reason": end_reason,
            "turns": str(len(self.latencies_ms)),
            "latency_median_ms": _ms(percentile(self.latencies_ms, 0.5)),
            "latency_p90_ms": _ms(percentile(self.latencies_ms, 0.9)),
            "asr_median_ms": _ms(percentile(self.asr_ms, 0.5)),
            "greeting_ms": _ms(self.greeting_ms),
            "searches": str(self.searches),
            "no_hits": str(self.no_hits),
            "tools": str(self.tools),
            "tool_errors": str(self.tool_errors),
            "tool_median_ms": _ms(percentile(self.tool_ms, 0.5)),
            "latencies_ms": ";".join(str(round(value)) for value in self.latencies_ms),
            "ring_answer_ms": _ms(self.ring_answer_ms),
            "answer_greeting_ms": _ms(self.answer_greeting_ms),
        }

    def summary_lines(self) -> list[str]:
        median = percentile(self.latencies_ms, 0.5)
        p90 = percentile(self.latencies_ms, 0.9)
        lines = [
            f"  хариулах хугацаа: медиан {_ms(median) or '-'} мс, p90 {_ms(p90) or '-'} мс"
            f" ({len(self.latencies_ms)} хариулт; бичвэр ирснээс: медиан"
            f" {_ms(percentile(self.asr_ms, 0.5)) or '-'} мс)",
            f"  мэндчилгээ: Bto хариулснаас {_ms(self.greeting_ms) or '-'} мс;"
            f" дуугарснаас авах хүртэл {_ms(self.ring_answer_ms) or '-'} мс,"
            f" холбогдсоноос мэндлэх хүртэл {_ms(self.answer_greeting_ms) or '-'} мс",
            f"  хайлт: {self.searches}, олдоогүй: {self.no_hits};"
            f" хэрэгсэл: {self.tools}, татгалзсан/алдаа: {self.tool_errors},"
            f" медиан {_ms(percentile(self.tool_ms, 0.5)) or '-'} мс",
        ]
        return lines


def append_csv(path: Path, row: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    _upgrade_header(path)
    new = not path.exists() or path.stat().st_size == 0
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        if new:
            writer.writeheader()
        writer.writerow(row)


def _upgrade_header(path: Path) -> None:
    """An older metrics.csv has fewer columns: rewrite it with today's, the old rows kept."""
    if not path.exists() or path.stat().st_size == 0:
        return
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) == COLUMNS:
            return
        rows = list(reader)
    tmp = path.with_suffix(".tmp")
    with tmp.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for old in rows:
            writer.writerow({name: old.get(name) or "" for name in COLUMNS})
    tmp.replace(path)


@dataclass
class Report:
    calls: int
    turns: int
    median_ms: float | None
    p90_ms: float | None
    greeting_median_ms: float | None
    searches: int
    no_hits: int
    ring_answer_median_ms: float | None = None
    answer_greeting_median_ms: float | None = None

    def lines(self) -> list[str]:
        share = f"{round(100 * self.no_hits / self.searches)}%" if self.searches else "-"
        return [
            f"дуудлага: {self.calls}, хэмжсэн хариулт: {self.turns}",
            f"хариулах хугацаа: медиан {_ms(self.median_ms) or '-'} мс,"
            f" p90 {_ms(self.p90_ms) or '-'} мс (зорилт: медиан 1500 мс-ээс бага)",
            f"мэндчилгээ: медиан {_ms(self.greeting_median_ms) or '-'} мс"
            " (зорилт: 1500 мс-ээс бага)",
            f"хайлт: {self.searches}, олдоогүй: {self.no_hits} ({share})",
            f"утас: дуугарснаас авах хүртэл медиан {_ms(self.ring_answer_median_ms) or '-'} мс"
            " (3000 мс-ээс бага байх ёстой), холбогдсоноос мэндлэх хүртэл медиан"
            f" {_ms(self.answer_greeting_median_ms) or '-'} мс (зорилт: 1500 мс-ээс бага)",
        ]


def report(path: Path, last: int = 20) -> Report:
    rows: list[dict[str, str]] = []
    if path.exists():
        with path.open(newline="", encoding="utf-8") as handle:
            rows = list(csv.DictReader(handle))
    rows = rows[-last:] if last > 0 else rows
    latencies: list[float] = []
    greetings: list[float] = []
    searches = no_hits = 0
    ring_answer: list[float] = []
    answer_greeting: list[float] = []
    for row in rows:
        if row.get("ring_answer_ms"):
            ring_answer.append(float(row["ring_answer_ms"]))
        if row.get("answer_greeting_ms"):
            answer_greeting.append(float(row["answer_greeting_ms"]))
        latencies.extend(float(v) for v in (row.get("latencies_ms") or "").split(";") if v)
        if row.get("greeting_ms"):
            greetings.append(float(row["greeting_ms"]))
        searches += int(row.get("searches") or 0)
        no_hits += int(row.get("no_hits") or 0)
    return Report(
        calls=len(rows),
        turns=len(latencies),
        median_ms=percentile(latencies, 0.5),
        p90_ms=percentile(latencies, 0.9),
        greeting_median_ms=percentile(greetings, 0.5),
        searches=searches,
        no_hits=no_hits,
        ring_answer_median_ms=percentile(ring_answer, 0.5),
        answer_greeting_median_ms=percentile(answer_greeting, 0.5),
    )
