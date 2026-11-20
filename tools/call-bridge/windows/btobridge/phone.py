"""The phone side: who rings, picking up, hanging up.

`PhoneLink` is the seam. Stage 2 has `LocalPhone`: a call «rings» when the owner starts one at the
console, with the caller's number given on the command line, and Ctrl+C is the caller hanging up.
Stage 3 adds `AndroidLanPhone`: the line's Android app (tools/call-bridge/android) connects to the
bridge over a LAN WebSocket, paired once with a key kept on both sides, and sends `ringing
{callRef, caller}`; the bridge answers `answer` or `decline` within the phone's three seconds
(ADR-0232 #14) and later `hangup`; the phone sends `ended` when the caller hangs up.
"""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass
from typing import Protocol


@dataclass
class Ring:
    call_ref: str
    caller: str | None


class PhoneLink(Protocol):
    #: Set when the caller hangs up (stage 2: Ctrl+C).
    hung_up: asyncio.Event

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
        self.answered = False
        self.declined = False

    async def next_ring(self) -> Ring:
        return Ring(call_ref=f"local-{uuid.uuid4()}", caller=self.caller)

    async def answer(self, ring: Ring) -> None:
        self.answered = True

    async def decline(self, ring: Ring) -> None:
        self.declined = True

    async def hangup(self, ring: Ring) -> None:
        self.hung_up.set()


class AndroidLanPhone:
    """Stage 3: the line's Android phone over the LAN (see the module's docstring)."""

    def __init__(self, *_args: object, **_kwargs: object) -> None:
        raise NotImplementedError("the Android phone link comes with stage 3")
