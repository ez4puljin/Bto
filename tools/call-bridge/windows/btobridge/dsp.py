"""Small sound helpers, free of any sound device so the tests run anywhere: mono, resampling, and a
voice detector for the response-time measurement and the silence limit."""

from __future__ import annotations

import math

import numpy as np

try:  # soxr: a proper streaming resampler (pinned in requirements.txt)
    import soxr as _soxr
except ImportError:  # pragma: no cover - the fallback is tested by forcing it
    _soxr = None


def to_mono(frames: np.ndarray) -> np.ndarray:
    """int16 frames (n,) or (n, channels) to mono int16."""
    if frames.ndim == 1:
        return frames.astype(np.int16, copy=False)
    if frames.shape[1] == 1:
        return frames[:, 0].astype(np.int16, copy=False)
    return frames.astype(np.int32).mean(axis=1).astype(np.int16)


class Resampler:
    """Streaming int16 mono resampling, block by block, keeping its state between blocks."""

    def __init__(self, source: int, target: int, *, use_soxr: bool = True) -> None:
        self.source = source
        self.target = target
        self._stream = None
        if source != target and use_soxr and _soxr is not None:
            self._stream = _soxr.ResampleStream(source, target, 1, dtype="int16", quality="LQ")
            # LQ: a real anti-alias filter that holds back ~6 ms; HQ holds back ~21 ms per pass.
        # The linear fallback: input samples seen, the next output's input position, the last one.
        self._consumed = 0
        self._next = 0.0
        self._last: float | None = None

    def process(self, samples: np.ndarray) -> np.ndarray:
        if self.source == self.target or samples.size == 0:
            return samples.astype(np.int16, copy=False)
        if self._stream is not None:
            return self._stream.resample_chunk(samples.astype(np.int16, copy=False))
        return self._linear(samples)

    def _linear(self, samples: np.ndarray) -> np.ndarray:
        values = samples.astype(np.float64)
        if self.source > self.target:
            # A crude low-pass before dropping samples: average over the decimation width.
            width = max(1, int(round(self.source / self.target)))
            if width > 1:
                values = np.convolve(values, np.ones(width) / width, mode="same")
        # Global input coordinates: the block starts at `self._consumed`; the previous block's last
        # sample (kept) sits just before it, so an output between two blocks is interpolated too.
        if self._last is None:
            joined, base = values, float(self._consumed)
        else:
            joined, base = np.concatenate(([self._last], values)), float(self._consumed - 1)
        top = base + len(joined) - 1
        step = self.source / self.target
        positions = np.arange(self._next, top + 1e-9, step)
        self._consumed += len(values)
        self._last = float(joined[-1])
        if positions.size == 0:
            return np.zeros(0, dtype=np.int16)
        self._next = float(positions[-1] + step)
        out = np.interp(positions - base, np.arange(len(joined)), joined)
        return np.clip(np.round(out), -32768, 32767).astype(np.int16)


class VoiceDetector:
    """Energy-based: a 20 ms frame is voiced when it is well above the room's noise floor.

    Good enough to timestamp the end of the caller's speech and to tell silence from talk; it is not
    sent anywhere (ElevenLabs runs its own turn detection).
    """

    def __init__(self, rate: int = 16000, frame_ms: int = 20, floor_dbfs: float = -50.0) -> None:
        self.frame = rate * frame_ms // 1000
        self._carry = np.zeros(0, dtype=np.int16)
        self.noise_db = floor_dbfs
        self.min_db = -45.0
        self.margin_db = 12.0

    @staticmethod
    def level_db(frame: np.ndarray) -> float:
        if frame.size == 0:
            return -120.0
        rms = math.sqrt(float(np.mean(frame.astype(np.float64) ** 2)))
        return 20 * math.log10(max(rms, 1.0) / 32768.0)

    def feed(self, samples: np.ndarray) -> int:
        """Returns how many voiced frames this block held."""
        data = np.concatenate((self._carry, samples.astype(np.int16, copy=False)))
        voiced = 0
        count = len(data) // self.frame
        for index in range(count):
            level = self.level_db(data[index * self.frame : (index + 1) * self.frame])
            if level > max(self.min_db, self.noise_db + self.margin_db):
                voiced += 1
            else:
                # The floor follows quiet frames quickly down and slowly up.
                rate = 0.2 if level < self.noise_db else 0.02
                self.noise_db += (level - self.noise_db) * rate
        self._carry = data[count * self.frame :]
        return voiced


def tone(freq: float, rate: int, seconds: float, dbfs: float = -12.0) -> np.ndarray:
    """A sine tone as int16 mono, `dbfs` its peak level."""
    count = int(rate * seconds)
    amplitude = 32767 * 10 ** (dbfs / 20)
    t = np.arange(count) / rate
    return np.round(amplitude * np.sin(2 * math.pi * freq * t)).astype(np.int16)


def level_dbfs(samples: np.ndarray) -> float:
    """RMS level relative to a full-scale sine's RMS (a full-scale sine is 0 dBFS)."""
    if samples.size == 0:
        return -120.0
    rms = math.sqrt(float(np.mean(samples.astype(np.float64) ** 2)))
    return 20 * math.log10(max(rms, 1e-3) / (32768 / math.sqrt(2)))


def tone_dbfs(samples: np.ndarray, freq: float, rate: int) -> float:
    """The level of one frequency in the samples (Goertzel), in the same scale as `level_dbfs`:
    the noise and speech around it do not count."""
    if samples.size == 0:
        return -120.0
    x = samples.astype(np.float64)
    n = x.size
    k = 2 * math.cos(2 * math.pi * freq / rate)
    s1 = s2 = 0.0
    for value in x:
        s0 = value + k * s1 - s2
        s2, s1 = s1, s0
    power = s1 * s1 + s2 * s2 - k * s1 * s2
    amplitude = 2 * math.sqrt(max(power, 0.0)) / n
    return 20 * math.log10(max(amplitude, 1e-3) / 32768)


def clipped(samples: np.ndarray, limit: int = 32700) -> int:
    """How many samples are at full scale (the input is too loud and the voice is cut off)."""
    return int(np.count_nonzero(np.abs(samples.astype(np.int32)) >= limit))


class EchoGate:
    """Half duplex against echo (`echo_gate: true`): while the agent's voice is still to be heard,
    and `hangover_ms` after it, the caller's side is sent as silence (the same length, so
    ElevenLabs' timing stays right). The caller cannot interrupt the agent while it is closed."""

    def __init__(self, hangover_ms: int) -> None:
        self.hangover_s = hangover_ms / 1000
        self._open_at = 0.0
        self.closed_blocks = 0

    def agent_playing(self, pending_ms: float, now: float) -> None:
        """Told on every block: how much of the agent's audio is still queued."""
        if pending_ms > 0:
            self._open_at = max(self._open_at, now + pending_ms / 1000 + self.hangover_s)

    def is_closed(self, now: float) -> bool:
        return now < self._open_at

    def apply(self, block: np.ndarray, now: float) -> np.ndarray:
        if self.is_closed(now):
            self.closed_blocks += 1
            return np.zeros_like(block)
        return block


class SilenceFiller:
    """WASAPI loopback delivers nothing while nothing plays: the call's silence would never reach
    ElevenLabs, which needs the silence to hear that the caller stopped talking. This counts what
    the capture delivered against the clock and says how many zero samples are owed."""

    def __init__(self, rate: int, slack_ms: int = 100) -> None:
        self.rate = rate
        self.slack = rate * slack_ms // 1000
        self._start: float | None = None
        self._delivered = 0

    def delivered(self, samples: int, now: float) -> None:
        if self._start is None:
            self._start = now
        self._delivered += samples

    def owed(self, now: float) -> int:
        """Zero samples to send now (0 while the capture keeps up)."""
        if self._start is None:
            self._start = now
            return 0
        expected = int((now - self._start) * self.rate)
        behind = expected - self._delivered
        if behind <= self.slack:
            return 0
        fill = behind - self.slack // 2
        self._delivered += fill
        return fill
