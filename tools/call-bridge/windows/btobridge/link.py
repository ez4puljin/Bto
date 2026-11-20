"""The line's Android phone over the LAN (ADR-0232 stage 3): protocol v1.

JSON text frames over a plain WebSocket; the PC is the server (`ws://<PC>:<phone_port>/phone`),
the phone the client.

Pairing: `bridge pair` writes a 6-digit code (10 minutes, 5 tries) to `pairing.json`; the phone
sends `{"type":"pair","code","device","app"}` and gets `{"type":"paired","token"}`. The token's
sha-256 and the phone's address go to config.json. Later the phone opens with
`{"type":"hello","token"}` and gets `{"type":"welcome"}` or `{"type":"error","code":"BAD_TOKEN"}`.
Once paired, only the paired phone's address may connect (others are refused at the handshake),
except while a pairing code is open, when any address may send `pair` (and only that).

Phone -> PC: `ringing {callRef, number, at}`, `state {callRef, state, cause, at}`,
`route {callRef, endpoint, available}`, `pong {id}`.
PC -> phone: `answer {callRef, route}`, `ignore {callRef}`, `hangup {callRef}`, `ping {id}` every
5 s. Errors the PC may send before closing: `BAD_TOKEN`, `BAD_CODE` (wrong or used up code),
`NO_PAIRING` (no code open), `BAD_MESSAGE`. A pairing server of the console that stops closes the
phone's connection with 1012 («service restart»): the app reconnects with `hello`.

Nothing here logs a caller's number or a token.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import hmac
import json
import logging
import secrets
import socket
import time
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from typing import Any, Callable, Protocol
from urllib.parse import urlparse

from .phone import Ring

log = logging.getLogger("btobridge.link")

PATH = "/phone"
PING_EVERY_S = 5.0
PONG_TIMEOUT_S = 16.0
FIRST_MESSAGE_S = 10.0
CODE_TTL_S = 600
CODE_TRIES = 5
TEXT_MAX = 100
#: WebSocket close code «service restart»: the app reconnects with `hello`.
RECONNECT_CODE = 1012


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class Pairing:
    """The open pairing code, in a file: `bridge pair` (the console) writes it, the background
    task's link reads it. Only its hash is kept."""

    def __init__(self, path: Path, clock: Callable[[], float] = time.time) -> None:
        self.path = path
        self.clock = clock

    def new(self) -> str:
        code = f"{secrets.randbelow(10**6):06d}"
        self._write({"hash": sha256(code), "expires": self.clock() + CODE_TTL_S, "tries": 0})
        return code

    def active(self) -> bool:
        return self._read() is not None

    def expires_in(self) -> float:
        data = self._read()
        return max(0.0, data["expires"] - self.clock()) if data else 0.0

    def check(self, code: str) -> str:
        """'ok' (the code is used up), 'BAD_CODE' or 'NO_PAIRING'."""
        data = self._read()
        if data is None:
            return "NO_PAIRING"
        if hmac.compare_digest(sha256(str(code)), str(data["hash"])):
            self.clear()
            return "ok"
        data["tries"] = int(data.get("tries", 0)) + 1
        if data["tries"] >= CODE_TRIES:
            self.clear()
        else:
            self._write(data)
        return "BAD_CODE"

    def clear(self) -> None:
        with contextlib.suppress(FileNotFoundError):
            self.path.unlink()

    def _read(self) -> dict[str, Any] | None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if not isinstance(data, dict) or float(data.get("expires", 0)) <= self.clock():
            return None
        return data

    def _write(self, data: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data), encoding="utf-8")


@dataclass
class Paired:
    token_hash: str | None
    ip: str | None
    device: str | None = None


class Credentials(Protocol):
    """Where the paired phone is kept (config.json; a dict in the tests)."""

    def get(self) -> Paired: ...

    def set(self, paired: Paired) -> None: ...


class MemoryCredentials:
    def __init__(self, paired: Paired | None = None) -> None:
        self.paired = paired or Paired(None, None)

    def get(self) -> Paired:
        return self.paired

    def set(self, paired: Paired) -> None:
        self.paired = paired


class CallListener(Protocol):
    def on_state(self, state: str, cause: str | None) -> None: ...

    def on_route(self, endpoint: str | None, available: list[str]) -> None: ...


def _text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()[:TEXT_MAX]
    return None


class PhoneServer:
    def __init__(
        self,
        credentials: Credentials,
        pairing: Pairing,
        on_ring: Callable[[Ring], None],
        *,
        port: int,
        host: str = "0.0.0.0",
        ping_every_s: float = PING_EVERY_S,
        pong_timeout_s: float = PONG_TIMEOUT_S,
        on_change: Callable[[], None] | None = None,
        clock: Callable[[], float] = time.monotonic,
        role: str = "background",
    ) -> None:
        self.credentials = credentials
        self.pairing = pairing
        self.on_ring = on_ring
        self.host = host
        self.port = port
        self.ping_every_s = ping_every_s
        self.pong_timeout_s = pong_timeout_s
        self.on_change = on_change or (lambda: None)
        self.clock = clock
        #: Which process holds the link, for the log: "background" (`serve`) or "pairing" (the
        #: console's own server while the background task does not listen).
        self.role = role
        self._server: Any = None
        self._ws: Any = None
        self._calls: dict[str, CallListener] = {}
        self._ping_id = 0
        self.last_pong: float | None = None
        self.connected_since: float | None = None
        self.phone_ip: str | None = None
        self.refused = 0

    # -- the server -----------------------------------------------------------------------------

    async def start(self) -> None:
        from websockets.asyncio.server import serve  # noqa: PLC0415

        self._server = await serve(
            self._handle,
            self.host,
            self.port,
            process_request=self._check_request,
            ping_interval=20,
            ping_timeout=20,
            max_size=64 * 1024,
            close_timeout=2,
        )
        sockets = list(self._server.sockets)
        if sockets:
            self.port = int(sockets[0].getsockname()[1])
        log.info("phone link listening on port %s (%s)", self.port, self.role)

    async def stop(self, *, reconnect: bool = False) -> None:
        """Stop listening. `reconnect`: the phone's connection is closed with 1012 («service
        restart») first, so the app reconnects with `hello` to whoever listens next."""
        ws = self._ws
        if reconnect and ws is not None:
            with contextlib.suppress(Exception):
                await ws.close(RECONNECT_CODE, "reconnect")
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    @property
    def connected(self) -> bool:
        return self._ws is not None

    def status(self) -> dict[str, Any]:
        paired = self.credentials.get()
        return {
            "listening": self._server is not None,
            "port": self.port,
            "paired": bool(paired.token_hash),
            "pairedDevice": paired.device,
            "connected": self.connected,
            "phoneIp": self.phone_ip if self.connected else None,
            "pongAgeS": (
                round(self.clock() - self.last_pong, 1)
                if self.connected and self.last_pong is not None
                else None
            ),
        }

    def _check_request(self, connection: Any, request: Any) -> Any:
        path = urlparse(request.path).path
        if path != PATH:
            return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")
        ip = _ip(connection)
        paired = self.credentials.get()
        if paired.ip and ip != paired.ip and not self.pairing.active():
            self.refused += 1
            log.warning("phone link: an address that is not the paired phone's was refused")
            return connection.respond(HTTPStatus.FORBIDDEN, "not the paired phone\n")
        return None

    # -- one connection -------------------------------------------------------------------------

    async def _handle(self, ws: Any) -> None:
        ip = _ip(ws)
        try:
            first = await asyncio.wait_for(self._recv(ws), FIRST_MESSAGE_S)
        except (asyncio.TimeoutError, Exception):  # noqa: BLE001 - closed, silent, garbage
            return
        kind = first.get("type") if first else None
        paired = self.credentials.get()
        if kind == "pair":
            result = self.pairing.check(str(first.get("code") or ""))
            if result != "ok":
                log.warning("phone link: pairing refused (%s)", result)
                await self._error(ws, result)
                return
            token = secrets.token_urlsafe(32)
            device = _text(first.get("device"))
            self.credentials.set(Paired(sha256(token), ip, device))
            log.info("phone link: a phone paired (%s, app %s)", device or "-", _text(first.get("app")) or "-")
            await ws.send(json.dumps({"type": "paired", "token": token}))
        elif kind == "hello":
            token = str(first.get("token") or "")
            good = (
                paired.token_hash is not None
                and hmac.compare_digest(sha256(token), paired.token_hash)
                and ip == paired.ip
            )
            if not good:
                log.warning("phone link: hello refused (BAD_TOKEN)")
                await self._error(ws, "BAD_TOKEN")
                return
            await ws.send(json.dumps({"type": "welcome"}))
        else:
            await self._error(ws, "BAD_MESSAGE")
            return
        await self._session(ws, ip)

    async def _session(self, ws: Any, ip: str) -> None:
        old = self._ws
        self._ws = ws
        self.phone_ip = ip
        self.last_pong = self.connected_since = self.clock()
        if old is not None:
            with contextlib.suppress(Exception):
                await old.close(4000, "replaced")
        log.info("phone link: connected (%s)", self.role)
        self.on_change()
        pinger = asyncio.create_task(self._pinger(ws))
        try:
            while True:
                message = await self._recv(ws)
                if message is None:
                    break
                self._dispatch(message)
        finally:
            pinger.cancel()
            if self._ws is ws:
                self._ws = None
                log.info(
                    "phone link: disconnected (%s; close %s %s)",
                    self.role,
                    getattr(ws, "close_code", None),
                    str(getattr(ws, "close_reason", "") or "")[:40],
                )
                self.on_change()

    async def _pinger(self, ws: Any) -> None:
        while True:
            await asyncio.sleep(self.ping_every_s)
            if self.last_pong is not None and self.clock() - self.last_pong > self.pong_timeout_s:
                log.warning("phone link: no pong, closing")
                with contextlib.suppress(Exception):
                    await ws.close(1011, "no pong")
                return
            self._ping_id += 1
            with contextlib.suppress(Exception):
                await ws.send(json.dumps({"type": "ping", "id": self._ping_id}))

    def _dispatch(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        call_ref = _text(message.get("callRef"))
        if kind == "pong":
            self.last_pong = self.clock()
        elif kind == "ringing" and call_ref:
            number = message.get("number")
            caller = number.strip()[:40] if isinstance(number, str) and number.strip() else None
            log.info("phone link: ringing %s", call_ref[:40])
            self.on_ring(Ring(call_ref=call_ref, caller=caller, received_at=self.clock()))
        elif kind == "state" and call_ref:
            listener = self._calls.get(call_ref)
            state = _text(message.get("state")) or ""
            if listener is not None:
                listener.on_state(state, _text(message.get("cause")))
        elif kind == "route" and call_ref:
            listener = self._calls.get(call_ref)
            available = message.get("available")
            names = [str(a)[:30] for a in available] if isinstance(available, list) else []
            if listener is not None:
                listener.on_route(_text(message.get("endpoint")), names)
        else:
            log.info("phone link: message ignored (%s)", str(kind)[:30])

    # -- for the calls --------------------------------------------------------------------------

    async def send(self, message: dict[str, Any]) -> bool:
        ws = self._ws
        if ws is None:
            return False
        try:
            await ws.send(json.dumps(message))
            return True
        except Exception as error:  # noqa: BLE001
            log.warning("phone link: send failed (%s)", type(error).__name__)
            return False

    def watch(self, call_ref: str, listener: CallListener) -> None:
        self._calls[call_ref] = listener

    def unwatch(self, call_ref: str) -> None:
        self._calls.pop(call_ref, None)

    # -- plumbing -------------------------------------------------------------------------------

    @staticmethod
    async def _recv(ws: Any) -> dict[str, Any] | None:
        from websockets.exceptions import ConnectionClosed  # noqa: PLC0415

        while True:
            try:
                raw = await ws.recv()
            except ConnectionClosed:
                return None
            if isinstance(raw, bytes):
                continue
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if isinstance(message, dict):
                return message

    @staticmethod
    async def _error(ws: Any, code: str) -> None:
        with contextlib.suppress(Exception):
            await ws.send(json.dumps({"type": "error", "code": code}))
            await ws.close(4001, code)


def _ip(connection: Any) -> str:
    address = getattr(connection, "remote_address", None)
    host = str(address[0]) if address else ""
    return host[7:] if host.startswith("::ffff:") else host


def lan_address(server: str) -> str | None:
    """This PC's address on the LAN the server is on (the route the OS would take to it)."""
    host = urlparse(server).hostname or "192.168.1.250"
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect((host, 80))
            return str(probe.getsockname()[0])
    except OSError:
        return None


def port_in_use(port: int) -> bool:
    """Something on this PC listens on `port`. The background task binds 0.0.0.0, which takes
    connections to 127.0.0.1 too (on Windows as on Linux); loopback is never firewalled."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(0.5)
        return probe.connect_ex(("127.0.0.1", port)) == 0
