"""The background task (`bridge serve`, started at sign-in): the station's heartbeat and, in the
`bluetooth` and `cable` modes, the Android phone's link and its calls, one at a time.

A ring while a call is on is told `ignore` at once (the phone rings for staff). Every call reads
config.json again, so a device or a setting changed at the console counts from the next call.
`link.json` tells the console what the task sees (the phone's link, the station, a call on).
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Awaitable, Callable

from .audio import StageThree, open_audio
from .bto import BtoClient, BtoError, BtoUnreachable
from .config import PHONE_MODES, Config, home, load, update
from .dsp import EchoGate
from .link import Paired, Pairing, PhoneServer
from .phone import ROUTES, AndroidLanPhone, Ring
from .session import CallSession, Limits

log = logging.getLogger("btobridge.serve")

HEARTBEAT_S = 60
STATUS_FILE = "link.json"
PAIRING_FILE = "pairing.json"


class ConfigCredentials:
    """The paired phone in config.json (only the token's hash)."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path

    def get(self) -> Paired:
        config = load(self.path)
        return Paired(config.phone_token_hash, config.phone_ip, config.phone_device)

    def set(self, paired: Paired) -> None:
        update(
            {
                "phone_token_hash": paired.token_hash,
                "phone_ip": paired.ip,
                "phone_device": paired.device,
            },
            self.path,
        )


class CallDesk:
    """One call at a time."""

    def __init__(self, send: Callable[[dict[str, Any]], Awaitable[bool]], run_call: Callable[[Ring], Awaitable[Any]]) -> None:
        self.send = send
        self.run_call = run_call
        self.current: Ring | None = None
        self._task: asyncio.Task[None] | None = None
        self._side: set[asyncio.Task[Any]] = set()
        self.ignored_busy = 0

    @property
    def busy(self) -> bool:
        return self.current is not None

    def on_ring(self, ring: Ring) -> None:
        if self.current is not None:
            if ring.call_ref == self.current.call_ref:
                return  # the same ring told twice
            self.ignored_busy += 1
            log.info("ring during a call: ignored")
            task = asyncio.ensure_future(self.send({"type": "ignore", "callRef": ring.call_ref}))
            self._side.add(task)
            task.add_done_callback(self._side.discard)
            return
        self.current = ring
        self._task = asyncio.ensure_future(self._run(ring))

    async def _run(self, ring: Ring) -> None:
        try:
            await self.run_call(ring)
        except Exception as error:  # noqa: BLE001 - a call's crash must not stop the desk
            log.warning("call crashed (%s); phone told to ignore", type(error).__name__)
            await self.send({"type": "ignore", "callRef": ring.call_ref})
        finally:
            self.current = None

    async def idle(self) -> None:
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)


def limits_for(config: Config) -> Limits:
    return Limits(
        max_call_s=config.max_call_s,
        silence_s=config.silence_s,
        grace_s=config.grace_s,
        start_timeout_s=float(config.decide_s),
        audio_ready_s=int(config.audio_ready_ms) / 1000,
    )


def make_call_runner(link: PhoneServer, fallback: Config) -> Callable[[Ring], Awaitable[Any]]:
    async def run_call(ring: Ring) -> Any:
        from .ws import WsConnection  # noqa: PLC0415

        try:
            config = load()
        except (OSError, ValueError):
            config = fallback
        try:
            audio = open_audio(config)
        except StageThree:
            log.warning("mode %s is not built: ring ignored", config.mode)
            await link.send({"type": "ignore", "callRef": ring.call_ref})
            return None
        phone = AndroidLanPhone(link, ring, ROUTES.get(config.mode, "BLUETOOTH"))
        gate = EchoGate(int(config.echo_gate_hangover_ms)) if config.echo_gate else None
        session = CallSession(
            BtoClient(config.server, config.key),
            WsConnection.open,
            audio,
            phone,
            limits=limits_for(config),
            chunk_ms=config.chunk_ms,
            metrics_path=home() / "metrics.csv",
            say=lambda _text: None,
            echo_gate=gate,
        )
        result = await session.run()
        if result.metrics is not None:
            log.info(
                "call %s ring->answer %sms answer->greeting %sms",
                result.call_id,
                _ms(result.metrics.ring_answer_ms),
                _ms(result.metrics.answer_greeting_ms),
            )
        elif not result.answered:
            log.info("ring not answered (%s)", result.reason)
        return result

    return run_call


def _ms(value: float | None) -> str:
    return "-" if value is None else str(round(value))


def write_status(data: dict[str, Any], folder: Path | None = None) -> None:
    path = (folder or home()) / STATUS_FILE
    try:
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass


def read_status(folder: Path | None = None) -> dict[str, Any] | None:
    try:
        data = json.loads(((folder or home()) / STATUS_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


async def serve(config: Config) -> int:
    client = BtoClient(config.server, config.key)
    state: dict[str, Any] = {"mode": config.mode, "station": None}
    link: PhoneServer | None = None
    desk: CallDesk | None = None

    def publish() -> None:
        data = dict(state)
        data["updated"] = time.time()
        if link is not None:
            data["link"] = link.status()
            data["inCall"] = desk.busy if desk is not None else False
        write_status(data)

    if config.mode in PHONE_MODES:
        holder: dict[str, CallDesk] = {}
        link = PhoneServer(
            ConfigCredentials(),
            Pairing(home() / PAIRING_FILE),
            lambda ring: holder["desk"].on_ring(ring),
            port=int(config.phone_port),
            on_change=publish,
        )
        desk = CallDesk(link.send, make_call_runner(link, config))
        holder["desk"] = desk
        await link.start()

    last: str | None = None
    while True:
        try:
            station = await client.station()
            now = (
                f"active={station.get('active')} working={station.get('workingHours')}"
                f" agent={station.get('agentConfigured')}"
            )
            state["station"] = {
                "active": station.get("active"),
                "workingHours": station.get("workingHours"),
                "agentConfigured": station.get("agentConfigured"),
            }
        except BtoUnreachable as error:
            now = f"unreachable:{error.why}"
            state["station"] = {"error": "unreachable"}
        except BtoError as error:
            now = f"refused:{error.code}"
            state["station"] = {"error": error.code}
        if now != last:
            log.info("station %s", now)
            last = now
        publish()
        # The status file stays fresh while the link is quiet.
        for _ in range(HEARTBEAT_S // 10):
            await asyncio.sleep(10)
            publish()
