"""A scripted ElevenLabs conversation and a recording Bto, for the session's tests."""

from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

from btobridge.bto import BtoError, BtoUnreachable


class FakeBto:
    """Records every request in order; stores events and tool calls like the server would."""

    def __init__(self, start: dict[str, Any] | None = None) -> None:
        self.start = start or {
            "answer": True,
            "callId": 7,
            "reason": None,
            "signedUrl": "wss://el.test/conv?token=t",
            "dynamicVariables": {
                "call_id": "7",
                "caller_known": True,
                "store_name": "Дэлгүүр",
                "can_deliver": True,
                "greeting": "",
            },
        }
        self.log: list[tuple[str, Any]] = []
        self.stored: dict[int, dict[str, Any]] = {}
        self.ended: dict[str, Any] | None = None
        self.tool_answers: dict[str, Any] = {}
        self.unreachable = False
        self.events_fail = 0
        self.tool_delay = 0.0

    async def station(self) -> dict[str, Any]:
        return {"lineId": 1, "name": "x", "active": True, "workingHours": False}

    async def start_call(self, call_ref: str, caller: str | None) -> dict[str, Any]:
        self.log.append(("start", caller))
        if self.unreachable:
            raise BtoUnreachable("down")
        return self.start

    async def post_events(
        self, call_id: int, events: list[dict[str, Any]], conversation_id: str | None, key: str
    ) -> dict[str, Any]:
        if self.events_fail > 0:
            self.events_fail -= 1
            raise BtoUnreachable("flaky")
        if self.unreachable:
            raise BtoUnreachable("down")
        self.log.append(("events", [event["seq"] for event in events], conversation_id))
        for event in events:
            self.stored.setdefault(event["seq"], event)
        return {"stored": len(events), "lastSeq": max(self.stored)}

    async def tool(
        self, call_id: int, name: str, body: dict[str, Any], key: str
    ) -> dict[str, Any]:
        if self.tool_delay:
            await asyncio.sleep(self.tool_delay)
        if self.unreachable:
            raise BtoUnreachable("down")
        self.log.append(("tool", name, body["seq"], body["afterSeq"]))
        # What the server checks for «no order without yes»: nothing before afterSeq is missing.
        missing = [seq for seq in range(1, body["afterSeq"] + 1) if seq not in self.stored]
        self.stored[body["seq"]] = {"seq": body["seq"], "role": "TOOL", "text": name}
        if name == "place_order" and missing:
            raise BtoError(409, "PHONE_ORDER_NOT_CONFIRMED")
        answer = self.tool_answers.get(name, {"ok": True})
        if isinstance(answer, BtoError):
            raise answer
        return {"answer": answer}

    async def end(self, call_id: int, body: dict[str, Any], key: str) -> dict[str, Any]:
        self.log.append(("end", body["reason"]))
        if self.unreachable:
            raise BtoUnreachable("down")
        self.ended = body
        return {"callId": call_id, "outcome": "ORDERED", "orderNumber": "SO-1"}


def audio_message(event_id: int, samples: int = 1600) -> dict[str, Any]:
    pcm = b"\x10\x00" * samples
    return {
        "type": "audio",
        "audio_event": {"audio_base_64": base64.b64encode(pcm).decode(), "event_id": event_id},
    }


def metadata_message(output: str = "pcm_16000") -> dict[str, Any]:
    return {
        "type": "conversation_initiation_metadata",
        "conversation_initiation_metadata_event": {
            "conversation_id": "conv_1",
            "agent_output_audio_format": output,
            "user_input_audio_format": "pcm_16000",
        },
    }


def user(text: str, event_id: int = 1) -> dict[str, Any]:
    return {
        "type": "user_transcript",
        "user_transcription_event": {"user_transcript": text, "event_id": event_id},
    }


def agent(text: str, event_id: int = 1) -> dict[str, Any]:
    return {
        "type": "agent_response",
        "agent_response_event": {"agent_response": text, "event_id": event_id},
    }


def tool_call(name: str, call_id: str, **parameters: Any) -> dict[str, Any]:
    return {
        "type": "client_tool_call",
        "client_tool_call": {
            "tool_name": name,
            "tool_call_id": call_id,
            "parameters": parameters,
            "event_id": 1,
            "expects_response": True,
        },
    }


class FakeConversation:
    """The provider's side: a script of messages (or pauses, as floats), and what the bridge sent."""

    def __init__(self, script: list[Any], close_at_end: bool = False) -> None:
        self.script = list(script)
        self.close_at_end = close_at_end
        self.sent: list[dict[str, Any]] = []
        self.close_code: int | None = None
        self.closed = False
        self._inbox: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue()
        self._waiters: list[tuple[str, asyncio.Future[dict[str, Any]]]] = []

    async def open(self, url: str) -> FakeConversation:
        self.url = url
        asyncio.get_running_loop().create_task(self._play())
        return self

    async def _play(self) -> None:
        for item in self.script:
            if isinstance(item, (int, float)):
                await asyncio.sleep(item)
            elif isinstance(item, str) and item.startswith("await:"):
                await self.wait_for(item.split(":", 1)[1])
            else:
                await self._inbox.put(item)
        if self.close_at_end:
            self.close_code = 1000
            await self._inbox.put(None)

    async def wait_for(self, kind: str) -> dict[str, Any]:
        for message in self.sent:
            if message.get("type") == kind:
                return message
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        self._waiters.append((kind, future))
        return await future

    async def send(self, text: str) -> None:
        message = json.loads(text)
        self.sent.append(message)
        for kind, future in list(self._waiters):
            if message.get("type") == kind and not future.done():
                future.set_result(message)
                self._waiters.remove((kind, future))

    async def recv(self) -> dict[str, Any] | None:
        if self.closed:
            return None
        return await self._inbox.get()

    async def close(self) -> None:
        self.closed = True
        await self._inbox.put(None)

    def of_type(self, kind: str) -> list[dict[str, Any]]:
        return [message for message in self.sent if message.get("type") == kind]
