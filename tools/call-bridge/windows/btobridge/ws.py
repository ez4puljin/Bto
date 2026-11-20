"""The ElevenLabs conversation over the `websockets` library, as a session `Connection`."""

from __future__ import annotations

import json
from typing import Any

import websockets
from websockets.exceptions import ConnectionClosed


class WsConnection:
    def __init__(self, socket: Any) -> None:
        self._socket = socket
        self.close_code: int | None = None

    @classmethod
    async def open(cls, url: str) -> WsConnection:
        socket = await websockets.connect(
            url,
            open_timeout=6,
            max_size=8 * 1024 * 1024,
            # The provider pings at the application level (ping/pong messages); keep the
            # library's own keepalive too, so a dead network is noticed.
            ping_interval=20,
            ping_timeout=20,
            close_timeout=2,
        )
        return cls(socket)

    async def send(self, text: str) -> None:
        await self._socket.send(text)

    async def recv(self) -> dict[str, Any] | None:
        while True:
            try:
                raw = await self._socket.recv()
            except ConnectionClosed as closed:
                self.close_code = closed.rcvd.code if closed.rcvd is not None else 1006
                return None
            if isinstance(raw, bytes):
                continue
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if isinstance(message, dict):
                return message

    async def close(self) -> None:
        await self._socket.close()
