"""The call session against a scripted ElevenLabs conversation and a recording Bto."""

from __future__ import annotations

import asyncio
import csv
import json
import logging
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from btobridge.audio import NullAudio
from btobridge.bto import BtoError
from btobridge.phone import LocalPhone
from btobridge.session import CallResult, CallSession, Limits

from fakes import (
    FakeBto,
    FakeConversation,
    agent,
    audio_message,
    metadata_message,
    tool_call,
    user,
)

FAST = Limits(
    max_call_s=30,
    silence_s=30,
    grace_s=1,
    drain_quiet_s=0.05,
    drain_max_s=1.0,
    connect_timeout_s=1.0,
    broken_after_s=0.3,
    flush_every_s=0.05,
    tick_s=0.01,
)

SECRET_WORDS = ("Кола байна уу", "Кола байгаа", "Тийм", "Хоёр хайрцаг")


def run(
    script: list[Any],
    bto: FakeBto | None = None,
    *,
    limits: Limits = FAST,
    caller: str | None = "+97699112233",
    close_at_end: bool = False,
    metrics_path: Path | None = None,
    connector: Any = None,
    during: Any = None,
) -> tuple[CallResult, FakeBto, FakeConversation, NullAudio, LocalPhone, list[str]]:
    bto = bto or FakeBto()
    conversation = FakeConversation(script, close_at_end=close_at_end)
    audio = NullAudio()
    phone = LocalPhone(caller)
    said: list[str] = []
    session = CallSession(
        bto,
        connector or conversation.open,
        audio,
        phone,
        limits=limits,
        chunk_ms=100,
        metrics_path=metrics_path,
        say=said.append,
    )

    async def main() -> CallResult:
        if during is not None:
            asyncio.get_running_loop().create_task(during(session, phone, audio))
        return await asyncio.wait_for(session.run(), 10)

    result = asyncio.run(main())
    return result, bto, conversation, audio, phone, said


def ordered_order() -> list[Any]:
    return [
        metadata_message(),
        audio_message(1),
        agent("Сайн байна уу", 1),
        user("Кола байна уу", 2),
        agent("Кола байгаа. Хэдийг авах вэ?", 3),
        user("Хоёр хайрцаг", 4),
        tool_call("quote", "t1", lines=[{"unitId": 5, "qty": 2}]),
        "await:client_tool_result",
        agent("Хоёр хайрцаг кола, нийт хорин дөрвөн мянга. Зөв үү?", 5),
        user("Тийм", 6),
        tool_call("place_order", "t2", quoteId="q-1"),
        "await:client_tool_result",
        0.05,
        agent("Захиалга авлаа. Баярлалаа.", 7),
        audio_message(8),
        tool_call("end_call", "t3", reason="done"),
    ]


def test_turns_are_numbered_in_order_and_stored_before_each_tool() -> None:
    bto = FakeBto()
    bto.tool_answers["quote"] = {"quoteId": "q-1", "preliminary": True, "total": "24000"}
    bto.tool_answers["place_order"] = {"number": "SO-1"}
    result, bto, conversation, _audio, _phone, _said = run(ordered_order(), bto)

    assert result.end_reason == "COMPLETED"
    assert result.outcome == "ORDERED"
    # Every tool came after the turns before it were stored, and said so with afterSeq.
    writes = [entry for entry in bto.log if entry[0] in ("events", "tool")]
    seen: set[int] = set()
    for entry in writes:
        if entry[0] == "events":
            seen.update(entry[1])
        else:
            _, name, seq, after = entry
            assert after == seq - 1
            assert set(range(1, after + 1)) <= seen | {
                e[2] for e in writes if e[0] == "tool" and e[2] < seq
            }, name
            seen.add(seq)
    tools = [(entry[1], entry[2]) for entry in bto.log if entry[0] == "tool"]
    assert tools == [("quote", 5), ("place_order", 8), ("end_call", 10)]
    assert sorted(bto.stored) == list(range(1, 11))
    roles = [bto.stored[seq]["role"] for seq in sorted(bto.stored)]
    assert roles == ["AGENT", "USER", "AGENT", "USER", "TOOL", "AGENT", "USER", "TOOL", "AGENT", "TOOL"]
    # The provider was told each answer, by its call id.
    results = conversation.of_type("client_tool_result")
    assert [r["tool_call_id"] for r in results] == ["t1", "t2", "t3"]
    assert json.loads(results[1]["result"]) == {"number": "SO-1"}
    assert all(r["is_error"] is False for r in results)
    # The end carries the provider's conversation id; the events did too.
    assert bto.ended == {"reason": "COMPLETED", "durationS": 0, "conversationId": "conv_1"}
    assert all(entry[2] == "conv_1" for entry in bto.log if entry[0] == "events")


def test_the_first_message_carries_the_dynamic_variables_and_the_lines_greeting() -> None:
    bto = FakeBto()
    bto.start["dynamicVariables"]["greeting"] = "Өөр мэндчилгээ"
    _result, _bto, conversation, *_ = run([metadata_message()], bto, close_at_end=True)
    first = conversation.sent[0]
    assert first["type"] == "conversation_initiation_client_data"
    assert first["dynamic_variables"]["store_name"] == "Дэлгүүр"
    assert first["dynamic_variables"]["caller_known"] is True
    assert first["conversation_config_override"] == {
        "agent": {"first_message": "Өөр мэндчилгээ"}
    }
    assert conversation.url == "wss://el.test/conv?token=t"

    _result, _bto, conversation, *_ = run([metadata_message()], close_at_end=True)
    assert "conversation_config_override" not in conversation.sent[0]


def test_a_tool_is_not_forwarded_while_its_turns_are_not_stored() -> None:
    bto = FakeBto()
    bto.events_fail = 100  # Bto takes no events: the order must not go ahead of them
    script = [
        metadata_message(),
        user("Тийм", 1),
        tool_call("place_order", "t1", quoteId="q-1"),
        "await:client_tool_result",
    ]
    result, bto, conversation, *_ = run(script, bto)
    assert [entry for entry in bto.log if entry[0] == "tool"] == []
    answer = conversation.of_type("client_tool_result")[0]
    assert answer["is_error"] is True
    assert json.loads(answer["result"]) == {"error": "BTO_UNAVAILABLE"}
    assert result.end_reason == "ERROR"


def test_a_refusal_is_told_to_the_agent_as_an_error_with_its_code() -> None:
    bto = FakeBto()
    bto.tool_answers["quote"] = BtoError(409, "PHONE_CALLER_UNKNOWN")
    script = [metadata_message(), tool_call("quote", "t1", lines=[]), "await:client_tool_result"]
    _result, _bto, conversation, *_ = run(script, bto, close_at_end=True)
    answer = conversation.of_type("client_tool_result")[0]
    assert answer == {
        "type": "client_tool_result",
        "tool_call_id": "t1",
        "result": json.dumps({"error": "PHONE_CALLER_UNKNOWN"}),
        "is_error": True,
    }


def test_an_interruption_drops_the_queued_and_the_late_audio() -> None:
    script = [
        metadata_message(),
        audio_message(1),
        audio_message(2),
        {"type": "interruption", "interruption_event": {"event_id": 2}},
        audio_message(2),  # late audio of the interrupted answer
        audio_message(1),
        audio_message(3),
    ]
    _result, _bto, _conv, audio, *_ = run(script, close_at_end=True)
    assert audio.flushes == 1
    assert audio.played_bytes == 3 * 1600 * 2


def test_a_ping_is_answered_with_its_event_id() -> None:
    script = [
        metadata_message(),
        {"type": "ping", "ping_event": {"event_id": 42, "ping_ms": 80}},
        "await:pong",
    ]
    _result, _bto, conversation, *_ = run(script, close_at_end=True)
    assert conversation.of_type("pong") == [{"type": "pong", "event_id": 42}]


def test_silence_ends_the_call_after_the_limit() -> None:
    limits = Limits(**{**FAST.__dict__, "silence_s": 0.2, "grace_s": 0.1})
    result, bto, *_ = run([metadata_message()], limits=limits)
    assert result.end_reason == "SILENCE"
    assert bto.ended and bto.ended["reason"] == "SILENCE"


def test_a_long_call_ends_at_the_limit() -> None:
    limits = Limits(**{**FAST.__dict__, "max_call_s": 0.2, "grace_s": 0.1})

    async def keep_talking(session: CallSession, _phone: LocalPhone, audio: NullAudio) -> None:
        loud = (np.sin(np.arange(1600) / 3) * 12000).astype(np.int16)
        while True:
            await asyncio.sleep(0.02)
            if audio.on_mic:
                audio.on_mic(loud)

    result, *_ = run([metadata_message()], limits=limits, during=keep_talking)
    assert result.end_reason == "TIMEOUT"


def test_the_caller_hanging_up_ends_the_call() -> None:
    async def hang_up(_session: CallSession, phone: LocalPhone, _audio: NullAudio) -> None:
        await asyncio.sleep(0.1)
        phone.hung_up.set()

    result, bto, *_ = run([metadata_message(), user("Кола байна уу")], during=hang_up)
    assert result.end_reason == "CALLER_HANGUP"
    # The last turns still reached Bto before the end.
    assert bto.log[-1] == ("end", "CALLER_HANGUP")
    assert 1 in bto.stored


def test_the_microphone_goes_out_in_chunks() -> None:
    async def speak(_session: CallSession, _phone: LocalPhone, audio: NullAudio) -> None:
        while audio.on_mic is None:
            await asyncio.sleep(0.01)
        audio.on_mic(np.zeros(4000, dtype=np.int16))  # 250 ms at 16 kHz

    script = [metadata_message(), 0.2]
    _result, _bto, conversation, *_ = run(script, close_at_end=True, during=speak)
    chunks = [m for m in conversation.sent if "user_audio_chunk" in m]
    assert len(chunks) == 2  # two full 100 ms chunks; the rest waits for more
    assert all(len(m) == 1 for m in chunks)


def test_bto_declining_leaves_the_phone_ringing() -> None:
    bto = FakeBto(
        {
            "answer": False,
            "callId": 9,
            "reason": "WORKING_HOURS",
            "signedUrl": None,
            "dynamicVariables": None,
        }
    )
    connected: list[str] = []

    async def connector(url: str) -> Any:
        connected.append(url)
        raise AssertionError("must not connect")

    result, bto, _conv, _audio, phone, _said = run([], bto, connector=connector)
    assert result == CallResult(answered=False, call_id=9, reason="WORKING_HOURS")
    assert phone.declined and not phone.answered
    assert connected == []
    assert bto.ended is None


def test_bto_unreachable_is_a_clear_message_not_a_crash() -> None:
    bto = FakeBto()
    bto.unreachable = True
    result, _bto, _conv, _audio, phone, said = run([], bto)
    assert result.reason == "BTO_UNREACHABLE"
    assert phone.declined
    assert any("Bto" in line for line in said)


def test_elevenlabs_unreachable_ends_the_call_as_failed() -> None:
    async def connector(url: str) -> Any:
        raise OSError("no route")

    result, bto, *_ = run([], connector=connector)
    assert result.end_reason == "ERROR"
    assert bto.ended and bto.ended["reason"] == "ERROR"


def test_metrics_count_searches_and_no_hits_and_go_to_the_csv(tmp_path: Path) -> None:
    bto = FakeBto()
    answers = iter([{"products": []}, {"products": [{"productId": 1}]}])

    async def tool(call_id: int, name: str, body: dict[str, Any], key: str) -> dict[str, Any]:
        bto.log.append(("tool", name, body["seq"], body["afterSeq"]))
        bto.stored[body["seq"]] = {"role": "TOOL"}
        return {"answer": next(answers)}

    bto.tool = tool  # type: ignore[method-assign]
    script = [
        metadata_message(),
        user("Кола байна уу", 1),
        tool_call("search_products", "s1", query="кола"),
        "await:client_tool_result",
        0.05,
        audio_message(2),
        user("Ус", 3),
        tool_call("search_products", "s2", query="ус"),
        0.1,
    ]
    path = tmp_path / "metrics.csv"
    result, *_ = run(script, bto, close_at_end=True, metrics_path=path)
    assert result.metrics is not None
    assert (result.metrics.searches, result.metrics.no_hits) == (2, 1)
    assert len(result.metrics.latencies_ms) == 1
    rows = list(csv.DictReader(path.open(encoding="utf-8")))
    assert rows[0]["searches"] == "2" and rows[0]["no_hits"] == "1"
    assert rows[0]["call_id"] == "7"


def test_nothing_said_reaches_the_log_or_the_console(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    bto = FakeBto()
    bto.tool_answers["quote"] = {"quoteId": "q-1", "total": "24000", "lines": ["Хоёр хайрцаг"]}
    bto.tool_answers["place_order"] = {"number": "SO-1"}
    _result, _bto, _conv, _audio, _phone, said = run(ordered_order(), bto)
    written = caplog.text + "\n".join(said)
    for words in SECRET_WORDS:
        assert words not in written
    assert "+97699112233" not in written
    assert "token=t" not in written
