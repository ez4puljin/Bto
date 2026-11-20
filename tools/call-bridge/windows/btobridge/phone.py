"""The phone side: who rings, picking up, hanging up.

`PhoneLink` is the seam the call session uses. `LocalPhone` is stage 2: a call «rings» when the
owner starts one at the console, and Ctrl+C is the caller hanging up. `AndroidLanPhone` is stage 3:
one ring of the line's Android app (tools/call-bridge/android), over the link of `link.py`
(protocol v1: the PC answers `answer {callRef, route}` or `ignore {callRef}` within the phone's
three seconds, later `hangup {callRef}`; the phone tells `state answered|active|ended` and
`route`).
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Protocol

log = logging.getLogger("btobridge.phone")


@dataclass
class Ring:
    call_ref: str
    caller: str | None
    #: The PC's monotonic clock when the ring arrived (ring -> answer is measured from here).
    received_at: float = field(default_factory=time.monotonic)


class PhoneLink(Protocol):
    #: Set when the call is over on the phone's side (the caller hung up, the link was lost).
    hung_up: asyncio.Event
    #: Set when the phone says the call is connected (its audio flows).
    connected: asyncio.Event
    #: The end reason Bto is told when `hung_up` ends the call.
    end_reason: str

    async def next_ring(self) -> Ring: ...

    async def answer(self, ring: Ring) -> None: ...

    async def decline(self, ring: Ring) -> None:
        """Do not pick up: the phone rings for staff."""

    async def hangup(self, ring: Ring) -> None: ...


class LocalPhone:
    """A test call from the console: no phone at all."""

    def __init__(self, caller: str | None) -> None:
        self.caller = caller
        self.hung_up = asyncio.Event()
        self.connected = asyncio.Event()
        self.end_reason = "CALLER_HANGUP"
        self.answered = False
        self.declined = False

    async def next_ring(self) -> Ring:
        return Ring(call_ref=f"local-{uuid.uuid4()}", caller=self.caller)

    async def answer(self, ring: Ring) -> None:
        self.answered = True
        self.connected.set()

    async def decline(self, ring: Ring) -> None:
        self.declined = True

    async def hangup(self, ring: Ring) -> None:
        self.hung_up.set()


#: The phone's audio routes (Android `CallEndpoint` types) per audio mode.
ROUTES = {"bluetooth": "BLUETOOTH", "cable": "WIRED_HEADSET"}


class Link(Protocol):
    """What one ring needs of the phone link (`link.PhoneServer`)."""

    async def send(self, message: dict[str, Any]) -> bool: ...

    def watch(self, call_ref: str, listener: Any) -> None: ...

    def unwatch(self, call_ref: str) -> None: ...


class AndroidLanPhone:
    """One ring of the line's Android phone."""

    def __init__(self, link: Link, ring: Ring, route: str) -> None:
        self.link = link
        self.ring = ring
        self.route = route
        self.hung_up = asyncio.Event()
        self.connected = asyncio.Event()
        self.end_reason = "CALLER_HANGUP"
        self.endpoint: str | None = None
        self.ended = False
        link.watch(ring.call_ref, self)

    async def next_ring(self) -> Ring:
        return self.ring

    async def answer(self, ring: Ring) -> None:
        sent = await self.link.send({"type": "answer", "callRef": ring.call_ref, "route": self.route})
        if not sent:
            log.warning("answer not delivered: the phone is not connected")
            self.end_reason = "ERROR"
            self.hung_up.set()

    async def decline(self, ring: Ring) -> None:
        await self.link.send({"type": "ignore", "callRef": ring.call_ref})
        self.link.unwatch(ring.call_ref)

    async def hangup(self, ring: Ring) -> None:
        if not self.ended:
            if not await self.link.send({"type": "hangup", "callRef": ring.call_ref}):
                log.warning("hangup not delivered: the phone is not connected")
        self.link.unwatch(ring.call_ref)

    # -- what the phone tells about this call ---------------------------------------------------

    def on_state(self, state: str, cause: str | None) -> None:
        if state in ("answered", "active"):
            self.connected.set()
        elif state == "ended":
            self.ended = True
            log.info("phone: call ended (%s)", (cause or "-")[:40])
            self.hung_up.set()

    def on_route(self, endpoint: str | None, available: list[str]) -> None:
        self.endpoint = endpoint
        if endpoint != self.route:
            log.warning(
                "phone: audio on %s, not %s (available: %s)",
                (endpoint or "-")[:30],
                self.route,
                ",".join(a[:30] for a in available[:6]) or "-",
            )
