"""`python -m btobridge <command>`; without a command, a small menu (the desktop shortcut).

  call [--caller +976XXXXXXXX] [--no-audio]   a test call through the PC's headset (no phone)
  report [--last N]                            response times and searches over the last N calls
  devices                                      the microphones and speakers (WASAPI)
  check                                        does Bto know this station, would the AI answer now
  serve                                        the background task: the station's heartbeat and,
                                               in the bluetooth mode, the Android phone's link
  pair                                         a 6-digit code for the phone app «Bto дуудлага»
  status                                       what the background task sees (the phone's link)
  doctor                                       Bluetooth, Phone Link, VB-Cable on this PC
  find-call-device                             during a call: which output Phone Link plays it on
  calibrate                                    during a call: echo and the caller's level
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
from .audio import (
    NullAudio,
    StageThree,
    list_devices,
    measure_outputs,
    open_audio,
    open_local_audio,
    pick_call_output,
)
from .bto import BtoClient, BtoError, BtoUnreachable
from .config import PHONE_MODES, VB_CABLE_INPUT, Config, home, load, update
from .link import Pairing, PhoneServer, lan_address, port_in_use
from .metrics import report
from .phone import LocalPhone
from .serve import PAIRING_FILE, ConfigCredentials, read_status
from .serve import serve as serve_phone
from .session import CallSession, Limits

log = logging.getLogger("btobridge")


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
    # Always the PC's own headset: a test call without the phone, whatever the mode.
    audio = NullAudio() if no_audio else open_local_audio(config)
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
        elif error.status == 403:
            print(
                "Cloudflare хүсэлтийг хаалаа (403). Серверийн хаягийг дотоод сүлжээний "
                "http://192.168.1.250 болгож дахин суулгана уу."
            )
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


async def pair(config: Config) -> int:
    if config.mode not in PHONE_MODES:
        print("Утас холбохын өмнө Bluetooth горимд суулгана уу (install.ps1 -Mode bluetooth).")
        return 2
    pairing = Pairing(home() / PAIRING_FILE)
    code = pairing.new()
    before = config.phone_token_hash
    address = lan_address(config.server) or "?"
    print()
    print(f"  Холбох код:        {code[:3]} {code[3:]}")
    print(f"  Компьютерийн хаяг: {address}   порт {config.phone_port}")
    print("  «Bto дуудлага» апп → «Компьютер холбох» дээр энэ хаяг, кодыг оруулна.")
    print("  Код 10 минут хүчинтэй.")
    own: PhoneServer | None = None
    if not port_in_use(int(config.phone_port)):
        # The background task is not listening: listen here until the phone pairs.
        own = PhoneServer(
            ConfigCredentials(), pairing, lambda _ring: None, port=int(config.phone_port)
        )
        try:
            await own.start()
        except OSError as error:
            print(f"Порт {config.phone_port} нээгдсэнгүй ({type(error).__name__}).")
            return 1
    try:
        while True:
            await asyncio.sleep(1)
            try:
                now = load()
            except (OSError, ValueError):
                continue
            if now.phone_token_hash and now.phone_token_hash != before:
                print(f"Холбогдлоо: {now.phone_device or 'утас'} ({now.phone_ip}).")
                log.info("paired")
                return 0
            if not pairing.active():
                print("Код хугацаа нь дууссан эсвэл 5 удаа буруу оруулсан. Дахин «холбох» сонгоно уу.")
                return 1
    finally:
        if own is not None:
            await own.stop()


def status_lines(config: Config, status: dict[str, Any] | None, now: float) -> list[str]:
    lines = [f"  горим: {MODE_WORDS.get(config.mode, config.mode)}"]
    if status is None or now - float(status.get("updated") or 0) > 120:
        lines.append("  арын програм: АЖИЛЛАХГҮЙ байна (компьютерээ дахин асаах эсвэл дахин суулгах)")
        return lines
    station = status.get("station") or {}
    if station.get("error"):
        lines.append(f"  Bto: холбогдохгүй ({station.get('error')})")
    else:
        lines.append(
            "  Bto: холбогдсон; "
            + ("ажлын цаг (ажилтан авна)" if station.get("workingHours") else "ажлын бус цаг (AI авна)")
            + ("" if station.get("active") else "; шугам УНТРААЛТТАЙ")
        )
    link = status.get("link")
    if config.mode in PHONE_MODES:
        if not link:
            lines.append("  утас: арын програм утсыг хүлээгээгүй (дахин эхлүүлнэ үү)")
        elif not link.get("paired"):
            lines.append("  утас: холбоогүй (цэс → утас холбох)")
        elif link.get("connected"):
            lines.append(
                f"  утас: ХОЛБОГДСОН ({link.get('pairedDevice') or '-'})"
                + ("; яг одоо ярьж байна" if status.get("inCall") else "")
            )
        else:
            lines.append(f"  утас: холбогдоогүй байна ({link.get('pairedDevice') or '-'}): апп, Wi-Fi-г шалгана уу")
    return lines


MODE_WORDS = {"local": "компьютерийн чихэвч (туршилт)", "bluetooth": "Bluetooth (Phone Link)", "cable": "кабель"}


async def doctor(config: Config) -> int:
    from . import checks  # noqa: PLC0415

    facts = checks.windows_facts()
    if facts is None:
        print("Windows-ийн шалгалт хийгдсэнгүй (Windows биш эсвэл PowerShell хариулсангүй).")
        return 1
    try:
        import sounddevice as sd  # noqa: PLC0415

        devices = sd.query_devices()
        outs = [str(d["name"]) for d in devices if d["max_output_channels"] > 0]
        ins = [str(d["name"]) for d in devices if d["max_input_channels"] > 0]
        facts.vb_cable = checks.has_vb_cable(outs, ins)
    except Exception:  # noqa: BLE001
        facts.vb_cable = False
    bad = 0
    for finding in checks.findings(facts):
        print(("  OK   " if finding.ok else "  ДУТУУ ") + finding.text)
        bad += 0 if finding.ok else 1
    log.info(
        "doctor radios=%s ok=%s handsfree=%s service=%s phoneLink=%s cable=%s",
        facts.radios,
        facts.radios_ok,
        facts.handsfree,
        facts.service,
        facts.phone_link,
        facts.vb_cable,
    )
    return 0 if bad == 0 else 1


def find_call_device(interactive: bool = True) -> int:
    print("Өөр утаснаас шугамын утас руу залгаж, Phone Link дээр дуудлагыг аваарай.")
    print("Залгасан утсаараа тасралтгүй ярь (эсвэл хөгжим тавь).")
    if interactive:
        input("Дуудлага холбогдсон бол Enter дарна уу...")
    print("4 секунд сонсож байна...")
    try:
        levels = measure_outputs(4.0)
    except Exception as error:  # noqa: BLE001
        print(f"Хэмжиж чадсангүй ({type(error).__name__}).")
        return 1
    log.info("find-call-device %s", ";".join(f"{n[:40]}={db:.1f}" for n, db in levels))
    found = pick_call_output(levels)
    if found is None:
        print("Дуудлагын дуу аль төхөөрөмж дээр гарч байгааг тодорхойлж чадсангүй.")
        print("Дуудлага Phone Link дээр холбогдсон эсэхийг шалгаад дахин оролдоно уу, эсвэл дугаараар сонгоно.")
        return 1
    update({"call_output_device": found})
    print(f"Дуудлагын дуу: «{found}». Хадгаллаа.")
    return 0


async def calibrate(config: Config) -> int:
    from . import calibrate as cal  # noqa: PLC0415

    try:
        audio = open_audio(config)
    except StageThree as error:
        print(error)
        return 2

    async def ask(prompt: str) -> str:
        return await asyncio.to_thread(input, prompt)

    try:
        echo, _voice = await cal.run(audio, print, ask)
    except LookupError as error:
        print(f"Төхөөрөмж олдсонгүй: {error}")
        return 1
    if echo.verdict == "high" and not config.echo_gate:
        answer = (await ask("echo_gate-г асаах уу? (т/ү): ")).strip().lower()
        if answer in ("т", "t", "y", "тийм"):
            update({"echo_gate": True})
            print("Асаалаа: AI ярьж байхад залгагчийн тал чимээгүй болно (AI-г яриан дунд нь таслах боломжгүй).")
    elif echo.verdict != "high" and config.echo_gate:
        print("Цуурай бага байна: echo_gate-г унтрааж болно (config.json → echo_gate: false).")
    return 0


async def serve(config: Config) -> int:
    """The background task at sign-in."""
    return await serve_phone(config)


def _ask_device(label: str) -> int | str | None:
    answer = input(f"{label} (Enter: өмнөх хэвээр): ").strip()
    if answer.isdigit():
        return int(answer)
    return answer or None


def pick_devices(config: Config) -> Config:
    try:
        lines = list_devices()
    except Exception as error:  # noqa: BLE001
        print(f"Дууны төхөөрөмж олдсонгүй ({type(error).__name__}).")
        return config
    print("\n".join(lines))
    changes: dict[str, Any] = {}
    if config.mode == "bluetooth":
        print("Дуудлагын дуу гарч буй төхөөрөмж (Phone Link тоглуулдаг, ихэвчлэн чихэвч).")
        print("Мэдэхгүй бол цэсний «дуудлагын төхөөрөмж олох»-ыг ашиглана.")
        call = _ask_device("  дуудлагын (speaker) дугаар")
        if call is not None:
            changes["call_output_device"] = call
        agent = _ask_device(f"  AI-гийн дуу орох төхөөрөмж (ихэвчлэн «{VB_CABLE_INPUT}»)")
        if agent is not None:
            changes["agent_output_device"] = agent
    for field, label in (("input_device", "  туршилтын микрофоны дугаар"), ("output_device", "  туршилтын чихэвчийн дугаар")):
        value = _ask_device(label)
        if value is not None:
            changes[field] = value
    if not changes:
        return config
    config = update(changes)
    print("Хадгаллаа.")
    return config


def menu(config: Config) -> int:
    while True:
        print()
        print(f"Bto AI дуудлага {__version__}  ({config.server})")
        for line in status_lines(config, read_status(), time.time()):
            print(line)
        print("  1  туршилтын дуудлага, компьютерийн чихэвчээр (дэлгүүрийн дугаараас)")
        print("  2  туршилтын дуудлага, компьютерийн чихэвчээр (нууцалсан дугаараас)")
        print("  3  сүүлийн 20 дуудлагын хэмжилт")
        print("  4  Bto-той холболт шалгах")
        print("  5  дууны төхөөрөмж сонгох")
        print("  6  утас холбох («Bto дуудлага» апп)")
        print("  7  Bluetooth, Phone Link, VB-Cable шалгах")
        print("  8  дуудлагын төхөөрөмж олох (дуудлагын үеэр)")
        print("  9  цуурай, дууны түвшин хэмжих (дуудлагын үеэр)")
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
            config = pick_devices(config)
        elif choice == "6":
            asyncio.run(pair(config))
            config = load()
        elif choice == "7":
            asyncio.run(doctor(config))
        elif choice == "8":
            find_call_device()
            config = load()
        elif choice == "9":
            asyncio.run(calibrate(config))
            config = load()
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
    sub.add_parser("pair", help="a pairing code for the phone app")
    sub.add_parser("status", help="what the background task sees")
    sub.add_parser("doctor", help="Bluetooth, Phone Link and VB-Cable on this PC")
    find = sub.add_parser("find-call-device", help="during a call: the output Phone Link plays on")
    find.add_argument("--no-wait", action="store_true", help="measure at once, no Enter")
    sub.add_parser("calibrate", help="during a call: echo and the caller's level")
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
    if args.command == "pair":
        return asyncio.run(pair(config))
    if args.command == "status":
        print("\n".join(status_lines(config, read_status(), time.time())))
        return 0
    if args.command == "doctor":
        return asyncio.run(doctor(config))
    if args.command == "find-call-device":
        return find_call_device(interactive=not args.no_wait)
    if args.command == "calibrate":
        return asyncio.run(calibrate(config))
    if args.command == "serve":
        while True:  # never a crash loop: a failure waits a minute and starts again
            try:
                return asyncio.run(serve(config))
            except Exception as error:  # noqa: BLE001
                log.warning("serve stopped (%s); again in a minute", type(error).__name__)
                time.sleep(60)
    return menu(config)
