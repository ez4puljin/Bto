"""The pure parts: protocol messages, metrics, resampling, voice detection, config, the client."""

from __future__ import annotations

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from btobridge import protocol
from btobridge.audio import StageThree, open_audio
from btobridge.bto import BtoClient, BtoError, BtoUnreachable
from btobridge.config import Config, load, save
from btobridge.dsp import Resampler, VoiceDetector, to_mono
from btobridge.metrics import CallMetrics, append_csv, percentile, report

KEY = "bpl_3_" + "a" * 32


class Clock:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


def test_percentile_interpolates_like_numpy() -> None:
    values = [300.0, 100.0, 200.0, 400.0]
    assert percentile(values, 0.5) == pytest.approx(float(np.percentile(values, 50)))
    assert percentile(values, 0.9) == pytest.approx(float(np.percentile(values, 90)))
    assert percentile([], 0.5) is None


def test_response_time_runs_from_the_end_of_speech_to_the_first_agent_audio() -> None:
    clock = Clock()
    metrics = CallMetrics(clock=clock)
    metrics.answered()
    clock.now += 0.9
    metrics.agent_audio()  # the greeting
    assert metrics.greeting_ms == pytest.approx(900)
    assert metrics.latencies_ms == []
    clock.now += 3.0
    metrics.user_voice()  # the caller's last voiced frame
    clock.now += 0.6
    metrics.user_transcript()  # ElevenLabs decided the turn is over
    clock.now += 0.5
    metrics.agent_audio()
    metrics.agent_audio()  # the same answer's next chunk is not a new sample
    assert metrics.latencies_ms == [pytest.approx(1100)]
    assert metrics.asr_ms == [pytest.approx(500)]
    # No voice seen (a muted mic): measured from the transcript.
    clock.now += 10
    metrics.user_transcript()
    clock.now += 0.7
    metrics.agent_audio()
    assert metrics.latencies_ms[-1] == pytest.approx(700)


def test_the_report_reads_the_last_calls(tmp_path: Path) -> None:
    path = tmp_path / "metrics.csv"
    for call_id, latencies in ((1, [800, 1200]), (2, [1000]), (3, [3000, 900, 1100])):
        clock = Clock()
        metrics = CallMetrics(clock=clock)
        metrics.latencies_ms = [float(v) for v in latencies]
        metrics.searches, metrics.no_hits = 2, 1
        append_csv(path, metrics.row(call_id, 30, "COMPLETED"))
    everything = report(path, 20)
    assert (everything.calls, everything.turns) == (3, 6)
    assert everything.median_ms == pytest.approx(1050)
    assert (everything.searches, everything.no_hits) == (6, 3)
    assert report(path, 1).turns == 3
    text = path.read_text(encoding="utf-8")
    assert text.splitlines()[0].startswith("ended_unix,call_id")


def test_initiation_and_results_are_the_providers_shapes() -> None:
    message = json.loads(protocol.initiation({"a": "x", "b": True, "n": 2, "bad": {}}, None))
    assert message == {
        "type": "conversation_initiation_client_data",
        "dynamic_variables": {"a": "x", "b": True, "n": 2},
    }
    assert json.loads(protocol.user_audio(b"\x01\x02")) == {"user_audio_chunk": "AQI="}
    assert json.loads(protocol.pong(5)) == {"type": "pong", "event_id": 5}
    result = json.loads(protocol.tool_result("c1", {"ok": True}, False))
    assert result == {
        "type": "client_tool_result",
        "tool_call_id": "c1",
        "result": '{"ok": true}',
        "is_error": False,
    }
    meta = protocol.metadata(
        {
            "type": "conversation_initiation_metadata",
            "conversation_initiation_metadata_event": {
                "conversation_id": "c",
                "agent_output_audio_format": "pcm_24000",
                "user_input_audio_format": "pcm_16000",
            },
        }
    )
    assert (meta.conversation_id, meta.output_rate, meta.input_rate) == ("c", 24000, 16000)
    with pytest.raises(ValueError):
        protocol.pcm_rate("ulaw_8000")


@pytest.mark.parametrize("use_soxr", [True, False])
@pytest.mark.parametrize(("source", "target"), [(48000, 16000), (16000, 48000), (44100, 16000)])
def test_resampling_keeps_the_length_and_the_tone(use_soxr: bool, source: int, target: int) -> None:
    resampler = Resampler(source, target, use_soxr=use_soxr)
    seconds = 1.0
    t = np.arange(int(source * seconds)) / source
    tone = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16)
    out = np.concatenate([resampler.process(block) for block in np.array_split(tone, 37)])
    # A streaming filter holds back its delay (soxr LQ: 6 ms, 21 ms for 44.1 kHz) until more comes.
    assert abs(len(out) - target * seconds) <= target * 0.025
    # The tone survives: its strongest frequency is still 440 Hz.
    spectrum = np.abs(np.fft.rfft(out[: target // 2].astype(np.float64)))
    peak = np.argmax(spectrum) * target / (target // 2)
    assert abs(peak - 440) < 10


def test_mono_and_voice_detection() -> None:
    stereo = np.array([[100, 300], [-100, -300]], dtype=np.int16)
    assert to_mono(stereo).tolist() == [200, -200]
    detector = VoiceDetector(rate=16000)
    rng = np.random.default_rng(1)
    hiss = (rng.normal(0, 30, 16000)).astype(np.int16)
    assert detector.feed(hiss) == 0
    speech = (np.sin(np.arange(3200) / 5) * 8000).astype(np.int16)
    assert detector.feed(speech) == 10


def test_config_round_trip_and_checks(tmp_path: Path) -> None:
    path = tmp_path / "config.json"
    save(Config(server="http://192.168.1.250/", key=KEY, extra={"note": 1}), path)
    config = load(path)
    assert config.server == "http://192.168.1.250"
    assert config.extra == {"note": 1}
    assert config.problems() == []
    assert Config(server="x", key="bps_1_x", mode="radio").problems() == [
        "server must start with http:// or https://",
        "key does not look like a Bto phone line key (bpl_...)",
        "mode must be one of local, cable, bluetooth",
    ]
    with pytest.raises(StageThree):
        open_audio(Config(server="http://x", key=KEY, mode="cable"))


class _Handler(BaseHTTPRequestHandler):
    seen: list[dict[str, Any]] = []
    plan: list[tuple[int, dict[str, Any]]] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        _Handler.seen.append(
            {
                "path": self.path,
                "auth": self.headers.get("Authorization"),
                "key": self.headers.get("Idempotency-Key"),
                "body": body,
            }
        )
        status, answer = _Handler.plan.pop(0)
        data = json.dumps(answer).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args: Any) -> None:
        pass


def test_the_client_retries_with_the_same_key_and_keeps_only_the_code() -> None:
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = BtoClient(f"http://127.0.0.1:{server.server_port}", KEY)
        _Handler.seen.clear()
        _Handler.plan[:] = [(503, {}), (200, {"answer": {"products": []}})]
        reply = asyncio.run(client.tool(7, "search_products", {"seq": 1}, "k-1"))
        assert reply == {"answer": {"products": []}}
        assert [s["key"] for s in _Handler.seen] == ["k-1", "k-1"]
        assert _Handler.seen[0]["path"] == "/api/v1/phone-agent/calls/7/tools/search_products"
        assert _Handler.seen[0]["auth"] == f"Bearer {KEY}"

        _Handler.plan[:] = [(409, {"code": "PHONE_ORDER_NOT_CONFIRMED", "detail": "x"})]
        with pytest.raises(BtoError) as refused:
            asyncio.run(client.tool(7, "place_order", {"seq": 2}, "k-2"))
        assert (refused.value.status, refused.value.code) == (409, "PHONE_ORDER_NOT_CONFIRMED")

        _Handler.plan[:] = [(200, {"answer": True, "callId": 1})]
        asyncio.run(client.start_call("ref", None))
        assert _Handler.seen[-1]["body"] == {"callRef": "ref", "callerPhone": None}
    finally:
        server.shutdown()
    with pytest.raises(BtoUnreachable):
        asyncio.run(BtoClient("http://127.0.0.1:9", KEY, timeout=0.5).end(1, {}, "k"))
