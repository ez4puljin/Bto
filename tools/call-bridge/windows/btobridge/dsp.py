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
