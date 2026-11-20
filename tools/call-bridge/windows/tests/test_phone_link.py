"""Protocol v1 between the PC and the Android app, with a fake phone client over a real local
WebSocket, a recording Bto and a scripted ElevenLabs conversation."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any

import pytest
from websockets.asyncio.client import connect
from websockets.exceptions import ConnectionClosed, InvalidStatus

from btobridge.audio import NullAudio
from btobridge.link import CODE_TRIES, MemoryCredentials, Paired, Pairing, PhoneServer, sha256
from btobridge.phone import AndroidLanPhone, Ring
from btobridge.serve import CallDesk
from btobridge.session import CallSession, Limits

from fakes import FakeBto, FakeConversation, audio_message, metadata_message, tool_call

TOKEN = "t" * 43

LIMITS = Limits(
    max_call_s=30,
    silence_s=30,
    grace_s=1,
    drain_quiet_s=0.05,
    drain_max_s=1.0,
    connect_timeout_s=1.0,
    broken_after_s=0.3,
    flush_every_s=0.05,
    tick_s=0.01,
    start_timeout_s=0.3,
    answer_timeout_s=1.0,
)


class Harness:
    def __init__(
        self,
        tmp: Path,
        *,
        paired: Paired | None = None,
        bto: FakeBto | None = None,
        script: list[Any] | None = None,
        ping_every_s: float = 5.0,
    ) -> None:
        self.credentials = MemoryCredentials(
            paired if paired is not None else Paired(sha256(TOKEN), "127.0.0.1", "S23 FE")
        )
        self.pairing = Pairing(tmp / "pairing.json")
        self.bto = bto or FakeBto()
        self.script = script if script is not None else []
        self.conversations: list[FakeConversation] = []
        self.results: list[Any] = []
        self.server = PhoneServer(
            self.credentials,
            self.pairing,
            lambda ring: self.desk.on_ring(ring),
            port=0,
            host="127.0.0.1",
            ping_every_s=ping_every_s,
        )
        self.desk = CallDesk(self.server.send, self._run_call)

    async def _run_call(self, ring: Ring) -> Any:
        conversation = FakeConversation(list(self.script), close_at_end=False)
        self.conversations.append(conversation)
        phone = AndroidLanPhone(self.server, ring, "BLUETOOTH")
        session = CallSession(
            self.bto,
            conversation.open,
            NullAudio(),
            phone,
            limits=LIMITS,
            say=lambda _text: None,
        )
        result = await session.run()
        self.results.append(result)
        return result

    @property
    def url(self) -> str:
        return f"ws://127.0.0.1:{self.server.port}/phone"


async def hello(ws: Any, token: str = TOKEN) -> dict[str, Any]:
    await ws.send(json.dumps({"type": "hello", "token": token}))
    return json.loads(await ws.recv())


async def next_of(ws: Any, kind: str, timeout: float = 3.0) -> dict[str, Any]:
    async def wait() -> dict[str, Any]:
        while True:
            message = json.loads(await ws.recv())
            if message.get("type") == kind:
                return message

    return await asyncio.wait_for(wait(), timeout)


def ringing(call_ref: str, number: str | None = "+97699112233") -> str:
    return json.dumps({"type": "ringing", "callRef": call_ref, "number": number, "at": 1})


def run(coro: Any) -> Any:
    return asyncio.run(asyncio.wait_for(coro, 15))


# -- pairing and hello ----------------------------------------------------------------------------


def test_pairing_with_the_code_gives_a_token_kept_hashed_then_hello_is_welcome(tmp_path: Path) -> None:
    h = Harness(tmp_path, paired=Paired(None, None))

    async def main() -> None:
        await h.server.start()
        code = h.pairing.new()
        async with connect(h.url) as ws:
            await ws.send(json.dumps({"type": "pair", "code": code, "device": "S23 FE", "app": "1.0"}))
            paired = json.loads(await ws.recv())
        assert paired["type"] == "paired"
        assert len(paired["token"]) >= 32
        stored = h.credentials.get()
        assert stored.token_hash == sha256(paired["token"])
        assert paired["token"] not in json.dumps(stored.__dict__)
        assert stored.ip == "127.0.0.1"
        assert stored.device == "S23 FE"
        assert not h.pairing.active()  # a code pairs once
        async with connect(h.url) as ws:
            assert await hello(ws, paired["token"]) == {"type": "welcome"}
            await asyncio.sleep(0.05)
            assert h.server.connected
        await h.server.stop()

    run(main())


def test_a_wrong_token_is_bad_token(tmp_path: Path) -> None:
    h = Harness(tmp_path)

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            assert await hello(ws, "x" * 43) == {"type": "error", "code": "BAD_TOKEN"}
            with pytest.raises(ConnectionClosed):
                await ws.recv()
        assert not h.server.connected
        await h.server.stop()

    run(main())


def test_a_wrong_code_is_refused_and_the_code_dies_after_its_tries(tmp_path: Path) -> None:
    h = Harness(tmp_path, paired=Paired(None, None))

    async def main() -> None:
        await h.server.start()
        code = h.pairing.new()
        wrong = "000000" if code != "000000" else "111111"
        for _ in range(CODE_TRIES):
            async with connect(h.url) as ws:
                await ws.send(json.dumps({"type": "pair", "code": wrong}))
                assert json.loads(await ws.recv()) == {"type": "error", "code": "BAD_CODE"}
        async with connect(h.url) as ws:
            await ws.send(json.dumps({"type": "pair", "code": code}))
            assert json.loads(await ws.recv()) == {"type": "error", "code": "NO_PAIRING"}
        assert h.credentials.get().token_hash is None
        await h.server.stop()

    run(main())


def test_an_expired_code_does_not_pair(tmp_path: Path) -> None:
    now = [1000.0]
    pairing = Pairing(tmp_path / "p.json", clock=lambda: now[0])
    code = pairing.new()
    now[0] += 601
    assert pairing.check(code) == "NO_PAIRING"


def test_another_address_than_the_paired_phones_is_refused(tmp_path: Path) -> None:
    h = Harness(tmp_path, paired=Paired(sha256(TOKEN), "192.168.1.77", "S23 FE"))

    async def main() -> None:
        await h.server.start()
        with pytest.raises(InvalidStatus) as refused:
            async with connect(h.url):
                pass
        assert refused.value.response.status_code == 403
        # While a code is open any address may pair, but a token from another address is refused.
        h.pairing.new()
        async with connect(h.url) as ws:
            assert await hello(ws) == {"type": "error", "code": "BAD_TOKEN"}
        await h.server.stop()

    run(main())


def test_another_path_is_not_found(tmp_path: Path) -> None:
    h = Harness(tmp_path)

    async def main() -> None:
        await h.server.start()
        with pytest.raises(InvalidStatus) as refused:
            async with connect(f"ws://127.0.0.1:{h.server.port}/other"):
                pass
        assert refused.value.response.status_code == 404
        await h.server.stop()

    run(main())


def test_the_pc_pings_every_interval_and_takes_the_pong(tmp_path: Path) -> None:
    h = Harness(tmp_path, ping_every_s=0.05)

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            ping = await next_of(ws, "ping")
            await ws.send(json.dumps({"type": "pong", "id": ping["id"]}))
            second = await next_of(ws, "ping")
            assert second["id"] == ping["id"] + 1
            assert h.server.status()["connected"] is True
        await h.server.stop()

    run(main())


# -- calls ----------------------------------------------------------------------------------------


def greeting_then_end() -> list[Any]:
    return [
        metadata_message(),
        audio_message(1),
        tool_call("end_call", "t1", reason="done"),
    ]


def test_ringing_is_answered_within_the_deadline_and_end_call_hangs_up(tmp_path: Path) -> None:
    h = Harness(tmp_path, script=greeting_then_end())

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            started = time.monotonic()
            await ws.send(ringing("c-1"))
            answer = await next_of(ws, "answer")
            assert time.monotonic() - started < 1.0
            assert answer == {"type": "answer", "callRef": "c-1", "route": "BLUETOOTH"}
            await ws.send(json.dumps({"type": "state", "callRef": "c-1", "state": "active", "at": 2}))
            await ws.send(
                json.dumps({"type": "route", "callRef": "c-1", "endpoint": "BLUETOOTH", "available": ["EARPIECE", "BLUETOOTH"]})
            )
            hangup = await next_of(ws, "hangup")
            assert hangup == {"type": "hangup", "callRef": "c-1"}
            await h.desk.idle()
        assert h.bto.log[0] == ("start", "+97699112233")
        result = h.results[0]
        assert result.answered and result.end_reason == "COMPLETED"
        assert result.metrics.ring_answer_ms is not None and result.metrics.ring_answer_ms < 1000
        assert result.metrics.answer_greeting_ms is not None
        await h.server.stop()

    run(main())


def test_the_greeting_waits_for_the_phone_to_be_connected(tmp_path: Path) -> None:
    h = Harness(tmp_path, script=[metadata_message(), audio_message(1), 0.3, tool_call("end_call", "t1")])

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-9"))
            await next_of(ws, "answer")
            await asyncio.sleep(0.15)
            # Not connected yet: nothing has been played.
            assert h.results == []
            await ws.send(json.dumps({"type": "state", "callRef": "c-9", "state": "answered"}))
            await next_of(ws, "hangup")
            await h.desk.idle()
        assert h.results[0].metrics.first_audio_at >= h.results[0].metrics.connected_at
        await h.server.stop()

    run(main())


def test_bto_declining_is_ignore(tmp_path: Path) -> None:
    bto = FakeBto({"answer": False, "callId": 3, "reason": "WORKING_HOURS"})
    h = Harness(tmp_path, bto=bto)

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-2"))
            assert await next_of(ws, "ignore") == {"type": "ignore", "callRef": "c-2"}
            await h.desk.idle()
        assert h.results[0].reason == "WORKING_HOURS"
        await h.server.stop()

    run(main())


def test_bto_too_slow_is_ignore_in_time_and_the_late_call_is_closed(tmp_path: Path) -> None:
    bto = FakeBto()
    bto.start_delay = 0.6
    h = Harness(tmp_path, bto=bto)

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            started = time.monotonic()
            await ws.send(ringing("c-3"))
            assert await next_of(ws, "ignore") == {"type": "ignore", "callRef": "c-3"}
            assert time.monotonic() - started < 0.55
            await h.desk.idle()
            await asyncio.sleep(0.5)
        assert h.results[0].reason == "BTO_TIMEOUT"
        assert ("end", "ERROR") in bto.log  # the call Bto opened too late is closed
        await h.server.stop()

    run(main())


def test_bto_unreachable_is_ignore(tmp_path: Path) -> None:
    bto = FakeBto()
    bto.unreachable = True
    h = Harness(tmp_path, bto=bto)

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-4", None))
            await next_of(ws, "ignore")
            await h.desk.idle()
        assert h.bto.log[0] == ("start", None)
        await h.server.stop()

    run(main())


def test_a_second_ring_during_a_call_is_ignored_and_the_caller_hanging_up_ends_it(tmp_path: Path) -> None:
    h = Harness(tmp_path, script=[metadata_message(), audio_message(1), 5.0])

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-5"))
            await next_of(ws, "answer")
            await ws.send(json.dumps({"type": "state", "callRef": "c-5", "state": "active"}))
            await ws.send(ringing("c-6"))
            assert await next_of(ws, "ignore") == {"type": "ignore", "callRef": "c-6"}
            await ws.send(json.dumps({"type": "state", "callRef": "c-5", "state": "ended", "cause": "REMOTE"}))
            await h.desk.idle()
        assert h.results[0].end_reason == "CALLER_HANGUP"
        assert h.desk.ignored_busy == 1
        assert ("end", "CALLER_HANGUP") in h.bto.log
        await h.server.stop()

    run(main())


def test_a_phone_that_never_connects_the_call_ends_it_as_failed(tmp_path: Path) -> None:
    h = Harness(tmp_path, script=[metadata_message(), audio_message(1), 5.0])

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-7"))
            await next_of(ws, "answer")
            await next_of(ws, "hangup", timeout=4)
            await h.desk.idle()
        assert h.results[0].end_reason == "ERROR"
        await h.server.stop()

    run(main())


def test_the_caller_number_never_reaches_the_log(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    # The websockets library logs frames at DEBUG; setup_logging keeps it at WARNING.
    caplog.set_level("DEBUG", logger="btobridge")
    h = Harness(tmp_path, bto=FakeBto({"answer": False, "callId": 3, "reason": "WORKING_HOURS"}))

    async def main() -> None:
        await h.server.start()
        async with connect(h.url) as ws:
            await hello(ws)
            await ws.send(ringing("c-8", "+97699887766"))
            await next_of(ws, "ignore")
            await h.desk.idle()
        await h.server.stop()

    run(main())
    assert "99887766" not in caplog.text
    assert TOKEN not in caplog.text
