"""`python -m btobridge <command>`; without a command, a small menu (the desktop shortcut).

  call [--caller +976XXXXXXXX] [--no-audio]   a test call, as if the phone rang from that number
  report [--last N]                            response times and searches over the last N calls
  devices                                      the microphones and speakers (WASAPI)
  check                                        does Bto know this station, would the AI answer now
  serve                                        the background task: the station's heartbeat
                                               (stage 3 adds the Android phone's link here)
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import logging.handlers
import signal
import sys
import time
from pathlib import Path
from typing import Any

from . import __version__
from .audio import NullAudio, StageThree, list_devices, open_audio
from .bto import BtoClient, BtoError, BtoUnreachable
from .config import Config, home, load, save
from .metrics import report
from .phone import LocalPhone
from .session import CallSession, Limits

log = logging.getLogger("btobridge")

HEARTBEAT_S = 60


def setup_logging(folder: Path, console: bool) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    handler = logging.handlers.RotatingFileHandler(
        folder / "bridge.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    if console:
        quiet = logging.StreamHandler()
        quiet.setLevel(logging.WARNING)
        root.addHandler(quiet)
    # websockets logs frames at DEBUG only; keep it at WARNING so no payload is ever written.
    logging.getLogger("websockets").setLevel(logging.WARNING)


def normalise_caller(raw: str | None) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    return value or None


async def run_call(config: Config, caller: str | None, no_audio: bool) -> int:
    from .ws import WsConnection  # noqa: PLC0415 - websockets only when a call is made

    phone = LocalPhone(caller)
    loop = asyncio.get_running_loop()

    def hang_up(*_args: Any) -> None:
        loop.call_soon_threadsafe(phone.hung_up.set)

    previous = signal.signal(signal.SIGINT, hang_up)
    try:
        audio = NullAudio() if no_audio else open_audio(config)
    except StageThree as error:
        print(error)
        return 2
    session = CallSession(
        BtoClient(config.server, config.key),
        WsConnection.open,
        audio,
        phone,
        limits=Limits(
            max_call_s=config.max_call_s, silence_s=config.silence_s, grace_s=config.grace_s
        ),
        chunk_ms=config.chunk_ms,
        metrics_path=home() / "metrics.csv",
    )
    print(
        f"{caller or 'Нууцалсан дугаар'}-аас залгаж байна. Мэндчилгээний дараа ярина уу;"
        " Ctrl+C дарвал тасална."
    )
    try:
        result = await session.run()
    finally:
        signal.signal(signal.SIGINT, previous)
    return 0 if result.answered and result.end_reason != "ERROR" else 1


async def check(config: Config) -> int:
    try:
        station = await BtoClient(config.server, config.key).station()
    except BtoUnreachable:
        print(f"Bto ({config.server}) хариу өгөхгүй байна. Сүлжээ, хаягаа шалгана уу.")
        return 1
    except BtoError as error:
        if error.code == "PHONE_KEY_INVALID":
            print("Bto түлхүүрийг хүлээж авсангүй. Шугамын хуудаснаас шинэ түлхүүр аваад дахин суулгана.")
        else:
            print(f"Bto татгалзлаа: {error.code}")
        return 1
    print(f"Шугам {station.get('lineId')} «{station.get('name')}»")
    print(f"  асаалттай:         {'тийм' if station.get('active') else 'ҮГҮЙ'}")
    print(f"  одоо ажлын цаг:    {'тийм (ажилтан хариулна)' if station.get('workingHours') else 'үгүй'}")
    print(f"  серверт AI бэлэн:  {'тийм' if station.get('agentConfigured') else 'ҮГҮЙ'}")
    would = (
        station.get("active") and not station.get("workingHours") and station.get("agentConfigured")
    )
    print("  Одоо залгавал AI хариулна." if would else "  Одоо залгавал AI ХАРИУЛАХГҮЙ.")
    return 0


async def serve(config: Config) -> int:
    """The background task at sign-in. Stage 2 only keeps the station's heartbeat (the station
    page shows «Холбогдсон»); stage 3 listens here for the Android phone."""
    client = BtoClient(config.server, config.key)
    last: str | None = None
    while True:
        try:
            station = await client.station()
            state = (
                f"active={station.get('active')} working={station.get('workingHours')}"
                f" agent={station.get('agentConfigured')}"
            )
        except BtoUnreachable as error:
            state = f"unreachable:{error.why}"
        except BtoError as error:
            state = f"refused:{error.code}"
        if state != last:
            log.info("station %s", state)
            last = state
        await asyncio.sleep(HEARTBEAT_S)


def pick_devices(config: Config) -> None:
    try:
        lines = list_devices()
    except Exception as error:  # noqa: BLE001
        print(f"Дууны төхөөрөмж олдсонгүй ({type(error).__name__}).")
        return
    print("\n".join(lines))
    for field, label in (("input_device", "микрофоны"), ("output_device", "чихэвч/чанга яригчийн")):
        answer = input(f"{label} дугаар (Enter: Windows-ийн үндсэн): ").strip()
        setattr(config, field, int(answer) if answer.isdigit() else None)
    print(f"Хадгаллаа: {save(config)}")


def menu(config: Config) -> int:
    while True:
        print()
        print(f"Bto AI дуудлага {__version__}  ({config.server})")
        print("  1  туршилтын дуудлага (дэлгүүрийн дугаараас)")
        print("  2  туршилтын дуудлага (нууцалсан дугаараас)")
        print("  3  сүүлийн 20 дуудлагын хэмжилт")
        print("  4  холболт шалгах")
        print("  5  микрофон, чихэвч сонгох")
        print("  0  гарах")
        choice = input("> ").strip()
        if choice == "1":
            number = input("Залгагчийн дугаар (жишээ нь 99112233): ").strip()
            asyncio.run(run_call(config, normalise_caller(number), False))
        elif choice == "2":
            asyncio.run(run_call(config, None, False))
        elif choice == "3":
            print("\n".join(report(home() / "metrics.csv", 20).lines()))
        elif choice == "4":
            asyncio.run(check(config))
        elif choice == "5":
            pick_devices(config)
        elif choice in ("0", "q", ""):
            return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="bridge", description="Bto's phone AI call bridge")
    sub = parser.add_subparsers(dest="command")
    call = sub.add_parser("call", help="a test call through the PC's microphone and speakers")
    call.add_argument("--caller", help="the number the call seems to come from, e.g. +976...")
    call.add_argument("--no-audio", action="store_true", help="no sound devices (a dry run)")
    rep = sub.add_parser("report", help="response times and searches over the last calls")
    rep.add_argument("--last", type=int, default=20)
    sub.add_parser("devices", help="the microphones and speakers")
    sub.add_parser("check", help="ask Bto about this station")
    sub.add_parser("serve", help="the background task")
    args = parser.parse_args(argv)

    if sys.stdout and hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (OSError, ValueError):
            pass

    if args.command == "devices":
        print("\n".join(list_devices()))
        return 0
    if args.command == "report":
        print("\n".join(report(home() / "metrics.csv", args.last).lines()))
        return 0

    try:
        config = load()
    except FileNotFoundError:
        print(f"{home()} хавтсанд config.json алга: эхлээд install.ps1-ээр суулгана.")
        return 2
    problems = config.problems()
    if problems:
        print("config.json: " + "; ".join(problems))
        return 2
    setup_logging(home(), console=args.command != "serve")
    log.info("bridge %s start: %s", __version__, args.command or "menu")

    if args.command == "call":
        return asyncio.run(run_call(config, normalise_caller(args.caller), args.no_audio))
    if args.command == "check":
        return asyncio.run(check(config))
    if args.command == "serve":
        while True:  # never a crash loop: a failure waits a minute and starts again
            try:
                return asyncio.run(serve(config))
            except Exception as error:  # noqa: BLE001
                log.warning("serve stopped (%s); again in a minute", type(error).__name__)
                time.sleep(60)
    return menu(config)
