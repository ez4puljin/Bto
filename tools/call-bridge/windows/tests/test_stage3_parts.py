"""Stage 3's parts without sound hardware: the device roles, the loopback filler, the echo gate,
calibrate's analysis, the Windows checks' words, metrics and config."""

from __future__ import annotations

import csv
import json
from pathlib import Path

import numpy as np
import pytest

from btobridge.audio import (
    BluetoothAudio,
    RoleError,
    StageThree,
    check_roles,
    match_loopback,
    open_audio,
    pick_call_output,
)
from btobridge.calibrate import analyse_echo, analyse_voice
from btobridge.checks import Facts, findings, has_vb_cable
from btobridge.config import Config, load, save, update
from btobridge.dsp import EchoGate, Resampler, SilenceFiller, clipped, level_dbfs, tone, tone_dbfs
from btobridge.metrics import COLUMNS, CallMetrics, append_csv, report

KEY = "bpl_3_" + "a" * 32

LOOPBACKS = [
    "Speakers (Realtek(R) Audio) [Loopback]",
    "Headset Earphone (HyperX Cloud Alpha S Chat) [Loopback]",
    "Speakers (ASUS AI Noise-cancelling Speaker) [Loopback]",
    "Headphones (HyperX Cloud Alpha S Game) [Loopback]",
    "CABLE Input (VB-Audio Virtual Cable) [Loopback]",
]


# -- device roles ---------------------------------------------------------------------------------


def test_the_loopback_of_the_call_device_is_found_by_its_name_or_a_part() -> None:
    assert match_loopback("Headset Earphone (HyperX Cloud Alpha S Chat)", LOOPBACKS) == 1
    assert match_loopback("hyperx cloud alpha s game", LOOPBACKS) == 3
    assert match_loopback("Realtek", LOOPBACKS) == 0
    assert match_loopback("Bluetooth Hands-Free", LOOPBACKS) is None
    assert match_loopback("", LOOPBACKS) is None


def test_the_agent_never_plays_on_the_call_device_and_only_into_vb_cable() -> None:
    check_roles(
        "Headset Earphone (HyperX Cloud Alpha S Chat)", "CABLE Input (VB-Audio Virtual Cable)", True
    )
    with pytest.raises(RoleError):
        check_roles("Speakers (Realtek(R) Audio)", "Speakers (Realtek(R) Audio)", True)
    with pytest.raises(RoleError):
        check_roles("Headset Earphone (HyperX)", "Headphones (HyperX Game)", True)
    # local mode: a microphone and a headset, no rule
    check_roles("Microphone (HyperX)", "Headset Earphone (HyperX)", False)


def test_the_modes_open_their_audio_and_cable_is_not_built() -> None:
    audio = open_audio(Config(server="http://x", key=KEY, mode="bluetooth", call_output_device=19))
    assert isinstance(audio, BluetoothAudio)
    assert audio.capture.wanted == 19
    assert audio.playback.wanted == "CABLE Input"
    agent_none = open_audio(Config(server="http://x", key=KEY, mode="bluetooth", agent_output_device=None))
    assert agent_none.playback.wanted == "CABLE Input"  # type: ignore[attr-defined]
    with pytest.raises(StageThree):
        open_audio(Config(server="http://x", key=KEY, mode="cable"))


def test_the_call_output_is_the_one_clearly_loudest_during_a_test_call() -> None:
    levels = [
        ("Speakers (Realtek(R) Audio)", -90.0),
        ("Headset Earphone (HyperX Cloud Alpha S Chat)", -28.0),
        ("Headphones (HyperX Cloud Alpha S Game)", -70.0),
        ("CABLE Input (VB-Audio Virtual Cable)", -10.0),
    ]
    assert pick_call_output(levels) == "Headset Earphone (HyperX Cloud Alpha S Chat)"
    # nothing plays: no answer
    assert pick_call_output([("A", -100.0), ("B", -110.0)]) is None
    # two play alike (the call and a video): no guess
    assert pick_call_output([("A", -30.0), ("B", -33.0)]) is None


# -- resampling for ElevenLabs and back -----------------------------------------------------------


@pytest.mark.parametrize("source", [44100, 48000])
def test_the_loopback_rate_goes_to_16k_mono_and_the_agent_back_to_the_device(source: int) -> None:
    stereo = np.repeat(tone(1000, source, 1.0, -12).reshape(-1, 1), 2, axis=1)
    from btobridge.dsp import to_mono

    down = Resampler(source, 16000)
    out = np.concatenate([down.process(to_mono(block)) for block in np.array_split(stereo, 50)])
    # A streaming resampler holds back a few ms until more comes.
    assert abs(out.size - 16000) <= 16000 * 0.04
    assert abs(tone_dbfs(out[1000:15000], 1000, 16000) - -12) < 1.5
    up = Resampler(16000, source)
    back = np.concatenate([up.process(block) for block in np.array_split(out, 20)])
    assert abs(back.size - source) <= source * 0.04


# -- the loopback's silence -----------------------------------------------------------------------


def test_the_filler_owes_silence_only_when_the_capture_falls_behind() -> None:
    filler = SilenceFiller(16000, slack_ms=100)
    assert filler.owed(0.0) == 0
    filler.delivered(1600, 0.1)
    assert filler.owed(0.1) == 0  # keeping up
    # nothing plays for half a second: the loopback delivers nothing
    owed = filler.owed(0.6)
    assert 6000 <= owed <= 8000
    assert filler.owed(0.6) == 0  # paid once
    # it keeps real time over a long silence
    total = sum(filler.owed(0.6 + step * 0.02) for step in range(1, 251))
    assert abs(total - 80000) <= 1600


# -- the echo gate --------------------------------------------------------------------------------


def test_the_echo_gate_silences_the_caller_while_the_agent_plays_and_a_hangover_after() -> None:
    gate = EchoGate(hangover_ms=250)
    block = np.full(320, 1000, dtype=np.int16)
    assert np.array_equal(gate.apply(block, 0.0), block)  # nobody speaks
    gate.agent_playing(pending_ms=500, now=1.0)
    assert not gate.apply(block, 1.2).any()  # agent playing
    assert not gate.apply(block, 1.7).any()  # hangover
    assert np.array_equal(gate.apply(block, 1.8), block)  # open again
    assert gate.apply(block, 1.2).size == block.size  # the same length (timing stays right)
    assert gate.closed_blocks == 3


def test_the_session_sends_silence_through_a_closed_gate() -> None:
    from btobridge.audio import NullAudio
    from btobridge.phone import LocalPhone
    from btobridge.session import CallSession

    from fakes import FakeBto

    class Playing(NullAudio):
        def pending_ms(self) -> float:
            return 400.0

    clock = [10.0]
    session = CallSession(
        FakeBto(),
        None,  # type: ignore[arg-type]
        Playing(),
        LocalPhone(None),
        clock=lambda: clock[0],
        echo_gate=EchoGate(200),
        say=lambda _t: None,
    )
    session._on_mic(np.full(1600, 5000, dtype=np.int16))
    chunk = session._outgoing.get_nowait()
    assert not np.frombuffer(chunk, dtype=np.int16).any()


# -- calibrate ------------------------------------------------------------------------------------


def _noise(seconds: float, dbfs: float, seed: int = 1) -> np.ndarray:
    rng = np.random.default_rng(seed)
    scale = 32768 * 10 ** (dbfs / 20)
    return np.clip(rng.normal(0, scale, int(16000 * seconds)), -32768, 32767).astype(np.int16)


def test_calibrate_measures_the_echo_leak_against_the_tone_played() -> None:
    before = _noise(1.5, -60)
    loud = (tone(1000, 16000, 1.6, -30) + _noise(1.6, -60, 2)).astype(np.int16)
    echo = analyse_echo(before, loud)
    assert echo.verdict == "high"
    assert -20 < echo.leak_db < -16  # -30 heard of -12 played
    faint = (tone(1000, 16000, 1.6, -55) + _noise(1.6, -70, 3)).astype(np.int16)
    assert analyse_echo(_noise(1.5, -70), faint).verdict == "low"
    assert analyse_echo(before, _noise(1.6, -60, 4)).verdict == "none"


def test_calibrate_judges_the_callers_level_and_clipping() -> None:
    assert analyse_voice(_noise(5, -80)).verdict == "silent"
    assert analyse_voice(_noise(5, -20)).verdict == "good"
    assert analyse_voice(_noise(5, -40)).verdict == "quiet"
    hot = tone(300, 16000, 5, 3)  # above full scale: clipped
    hot = np.clip(hot.astype(np.int32) * 2, -32768, 32767).astype(np.int16)
    result = analyse_voice(hot)
    assert result.verdict == "clipping"
    assert result.clipped > 10
    assert clipped(np.array([0, 32767, -32768, 100], dtype=np.int16)) == 2
    assert abs(level_dbfs(tone(1000, 16000, 1, -6)) - -6) < 0.2


# -- the Windows checks ---------------------------------------------------------------------------


def test_the_checks_say_what_is_missing_in_plain_words() -> None:
    good = Facts(radios=1, radios_ok=1, handsfree=1, service="Running", phone_link=True, vb_cable=True)
    assert all(f.ok for f in findings(good))
    missing = findings(Facts())
    texts = " ".join(f.text for f in missing if not f.ok)
    assert "Bluetooth алга" in texts
    assert "Phone Link суугаагүй" in texts
    assert "https://vb-audio.com/Cable/" in texts
    off = findings(Facts(radios=1, radios_ok=0, service="Stopped"))
    assert any("ажиллахгүй" in f.text for f in off if not f.ok)
    assert any("үйлчилгээ" in f.text for f in off if not f.ok)


def test_vb_cable_is_both_its_ends() -> None:
    outs = ["Speakers (Realtek(R) Audio)", "CABLE Input (VB-Audio Virtual Cable)"]
    ins = ["Microphone (HyperX)", "CABLE Output (VB-Audio Virtual Cable)"]
    assert has_vb_cable(outs, ins)
    assert not has_vb_cable(outs[:1], ins)


# -- metrics and config ---------------------------------------------------------------------------


def test_ring_to_answer_and_answer_to_greeting_are_measured_and_kept(tmp_path: Path) -> None:
    now = [100.0]
    metrics = CallMetrics(clock=lambda: now[0])
    metrics.rang(100.0)
    now[0] = 101.2
    metrics.answered()
    now[0] = 101.3
    metrics.answer_sent()
    now[0] = 102.0
    metrics.connected()
    now[0] = 102.4
    metrics.agent_audio()
    assert round(metrics.ring_answer_ms or 0) == 1300
    assert round(metrics.answer_greeting_ms or 0) == 400
    # An older metrics.csv (without the new columns) is upgraded, its rows kept.
    path = tmp_path / "metrics.csv"
    old = [c for c in COLUMNS if c not in ("ring_answer_ms", "answer_greeting_ms")]
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=old)
        writer.writeheader()
        writer.writerow({name: "" for name in old} | {"call_id": "1", "latencies_ms": "900"})
    append_csv(path, metrics.row(2, 10, "COMPLETED"))
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    assert [r["call_id"] for r in rows] == ["1", "2"]
    assert rows[1]["ring_answer_ms"] == "1300"
    summary = report(path, 10)
    assert summary.turns == 1
    assert summary.ring_answer_median_ms == 1300
    assert summary.answer_greeting_median_ms == 400


def test_config_keeps_stage_three_settings_and_update_keeps_the_rest(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    save(Config(server="http://192.168.1.250", key=KEY, mode="bluetooth"), path)
    config = load(path)
    assert config.phone_port == 8766
    assert config.agent_output_device == "CABLE Input"
    assert config.echo_gate is False
    assert config.problems() == []
    update({"phone_token_hash": "h", "phone_ip": "192.168.1.40"}, path)
    update({"call_output_device": 19}, path)  # another process, another setting
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert raw["phone_token_hash"] == "h" and raw["call_output_device"] == 19
    assert raw["key"] == KEY
    assert Config(server="http://x", key=KEY, decide_s=3.5).problems() == [
        "decide_s must be 0.5 ... 2.8 (the phone waits 3 s)"
    ]
