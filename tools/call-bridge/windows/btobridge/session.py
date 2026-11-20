"""One call, from the ring to the stored transcript (ADR-0232 #3, #7, #12).

1. `POST /calls` decides, within `start_timeout_s` with a phone (the phone rings for staff by
   itself 3 s after the ring). `answer: false` (working hours, the line off, no stage for PHONE_AI
   orders, no agent), no answer in time, or the audio devices missing: the phone is told `ignore`
   and rings for staff.
2. The phone is told to answer and, at the same time, the signed URL opens the ElevenLabs
   conversation; the first message carries the call's dynamic variables (and the line's own
   greeting, when it has one). The agent's audio is held until the phone says the call is
   connected (and `audio_ready_s` more), so the greeting is not played into a line still opening.
3. The caller's microphone goes out as 16-bit mono PCM chunks; the agent's audio is played,
   dropped from the interrupted point on when the caller talks over it.
4. Every transcript turn gets the next sequence number in the order the WebSocket delivers it and
   goes to Bto in batches. A tool call takes the next number too; before it is forwarded, every
   turn buffered so far is stored (the server's «no order without yes» reads them), and it tells
   Bto `afterSeq` (everything before it is stored). One tool at a time, in order.
5. The end: the agent's `end_call` (after its goodbye has been heard), the caller hanging up
   (Ctrl+C), the provider closing, or the bridge's own limits (10 minutes, 40 s without the
   caller's voice; the agent's configuration ends politely first, the bridge waits `grace_s`
   more). Then `POST /end` with the reason, and the call's numbers.

Nothing here logs or prints a word of the conversation, a prompt or a tool's answer.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Protocol

import numpy as np

from . import protocol
from .audio import AudioPort, describe_error
from .bto import BtoError, BtoUnreachable, StationApi, new_key
from .dsp import EchoGate, VoiceDetector
from .metrics import CallMetrics, append_csv
from .phone import PhoneLink, Ring

log = logging.getLogger("btobridge.session")

#: Bto's decline reasons, as the owner reads them.
DECLINES = {
    "WORKING_HOURS": "ажлын цаг (ажилтан хариулна)",
    "LINE_INACTIVE": "шугам унтраалттай",
    "AI_CLOSED": "утасны AI захиалгын шат тохируулаагүй",
    "AGENT_UNAVAILABLE": "AI бэлэн биш (түлхүүр эсвэл агентын дугаар)",
}
#: Bto takes at most this many events in one request (PHONE_LIMITS.eventsMax).
BATCH_MAX = 200
#: Bto keeps at most this many characters of a turn (PHONE_LIMITS.textMax).
TEXT_MAX = 4000


class Connection(Protocol):
    close_code: int | None

    async def send(self, text: str) -> None: ...

    async def recv(self) -> dict[str, Any] | None:
        """The next message, or None once the conversation is closed."""

    async def close(self) -> None: ...


Connector = Callable[[str], Awaitable[Connection]]


@dataclass
class Limits:
    max_call_s: float = 600
    silence_s: float = 40
    grace_s: float = 15
    #: After `end_call`: hang up once the goodbye has been played and this long passed quietly ...
    drain_quiet_s: float = 1.2
    #: ... or this long after `end_call` at the latest.
    drain_max_s: float = 8.0
    connect_timeout_s: float = 6.0
    #: Bto stopped answering a tool call: the agent apologises; the call ends this long after.
    broken_after_s: float = 20.0
    flush_every_s: float = 1.0
    tick_s: float = 0.1
    #: POST /calls must answer within this (None: the HTTP client's own timeout, the console).
    start_timeout_s: float | None = None
    #: After `answer`, the phone must say the call is connected within this.
    answer_timeout_s: float = 6.0
    #: After it is connected, the agent's audio waits this long more (Phone Link's audio opening).
    audio_ready_s: float = 0.0


@dataclass
class CallResult:
    answered: bool
    call_id: int | None = None
    #: Why not answered (Bto's decline reason, or BTO_UNREACHABLE / BTO_REFUSED / NO_SIGNED_URL).
    reason: str | None = None
    end_reason: str | None = None
    outcome: str | None = None
    order_number: str | None = None
    duration_s: int = 0
    metrics: CallMetrics | None = None


@dataclass
class Transcript:
    """The call's numbering and the turns not yet stored in Bto."""

    last_seq: int = 0
    pending: list[dict[str, Any]] = field(default_factory=list)

    def add(self, role: str, text: str, at_ms: int) -> int | None:
        if not text:
            return None
        self.last_seq += 1
        self.pending.append(
            {"seq": self.last_seq, "role": role, "text": text[:TEXT_MAX], "atMs": max(at_ms, 0)}
        )
        return self.last_seq

    def reserve(self) -> int:
        self.last_seq += 1
        return self.last_seq


@dataclass
class _ToolJob:
    call: protocol.ToolCall
    seq: int
    at_ms: int


class CallSession:
    def __init__(
        self,
        bto: StationApi,
        connect: Connector,
        audio: AudioPort,
        phone: PhoneLink,
        *,
        limits: Limits | None = None,
        chunk_ms: int = 100,
        metrics_path: Path | None = None,
        say: Callable[[str], None] = print,
        clock: Callable[[], float] = time.monotonic,
        echo_gate: EchoGate | None = None,
    ) -> None:
        self.bto = bto
        self.connect = connect
        self.audio = audio
        self.phone = phone
        self.limits = limits or Limits()
        self.chunk_ms = chunk_ms
        self.metrics_path = metrics_path
        self.say = say
        self.clock = clock
        self.metrics = CallMetrics(clock=clock)
        self.transcript = Transcript()
        self.call_id: int | None = None
        self.conversation_id: str | None = None
        self.end_reason: str | None = None
        self.unknown_types: dict[str, int] = {}
        self._ws: Connection | None = None
        self._done = asyncio.Event()
        self._write_lock = asyncio.Lock()
        self._tools: asyncio.Queue[_ToolJob] = asyncio.Queue()
        self._outgoing: asyncio.Queue[bytes] = asyncio.Queue()
        self._mic = bytearray()
        self._mic_rate = 16000
        self._out_rate = 16000
        self._vad = VoiceDetector()
        self._audio_started = False
        self._interrupted_id = -1
        self._t0 = 0.0
        self._last_user_at = 0.0
        self._last_agent_audio_at: float | None = None
        self._ending_at: float | None = None
        self._broken_at: float | None = None
        self._flush_failures = 0
        self.echo_gate = echo_gate
        #: The agent's audio that came before the phone's line was ready.
        self._held: list[bytes] | None = []
        self._late_tasks: set[asyncio.Task[Any]] = set()

    # -- the call -----------------------------------------------------------------------------

    async def run(self) -> CallResult:
        ring = await self.phone.next_ring()
        self.metrics.rang(ring.received_at)
        started, audio_problem = await asyncio.gather(self._start(ring), self._prepare_audio())
        if isinstance(started, CallResult):
            await self.phone.decline(ring)
            return started
        self.call_id = int(started["callId"])
        signed_url = started.get("signedUrl")
        if not signed_url or audio_problem:
            # A replayed answer carries no URL; a missing device would be a silent call. Do not
            # pick up, and close the call as failed.
            if audio_problem:
                self.say(f"Дуудлага {self.call_id}: дууны төхөөрөмж олдсонгүй, хариулахгүй.")
            else:
                self.say(f"Дуудлага {self.call_id}: Bto ярианы хаяг өгсөнгүй, хариулахгүй.")
            await self.phone.decline(ring)
            await self._post_end("ERROR", duration_s=0)
            reason = "AUDIO_DEVICE" if audio_problem else "NO_SIGNED_URL"
            return CallResult(answered=False, call_id=self.call_id, reason=reason)

        self.metrics.answered()
        self._t0 = self._last_user_at = self.clock()
        # The conversation opens while the phone picks up: the greeting is ready sooner.
        connecting = asyncio.create_task(
            asyncio.wait_for(self.connect(str(signed_url)), self.limits.connect_timeout_s)
        )
        await self.phone.answer(ring)
        self.metrics.answer_sent()
        self.say(f"Дуудлага {self.call_id}: хариуллаа, AI-тай холбогдож байна...")
        try:
            self._ws = await connecting
        except Exception as error:  # noqa: BLE001 - a timeout, DNS, TLS, a refused handshake
            log.warning("call %s: agent not reached (%s)", self.call_id, type(error).__name__)
            self.say("ElevenLabs хариу өгсөнгүй (интернэтээ шалгана уу). Дуудлагыг амжилтгүй гэж хаалаа.")
            await self.phone.hangup(ring)
            await self._post_end("ERROR", duration_s=self._duration())
            return self._result("ERROR", None)

        variables = started.get("dynamicVariables") or {}
        greeting = variables.get("greeting") if isinstance(variables, dict) else None
        await self._ws.send(protocol.initiation(variables, greeting or None))
        tasks = [
            asyncio.create_task(self._reader(), name="reader"),
            asyncio.create_task(self._sender(), name="sender"),
            asyncio.create_task(self._tool_worker(), name="tools"),
            asyncio.create_task(self._flusher(), name="flusher"),
            asyncio.create_task(self._watchdog(), name="watchdog"),
            asyncio.create_task(self._line_ready(), name="line"),
        ]
        await self._done.wait()
        return await self._close(ring, tasks)

    async def _prepare_audio(self) -> bool:
        """Find the devices before the call is answered; True when they are missing."""
        prepare = getattr(self.audio, "prepare", None)
        if prepare is None:
            return False
        try:
            await asyncio.to_thread(prepare)
        except Exception as error:  # noqa: BLE001 - LookupError, a driver error
            log.warning("audio devices not ready (%s)", describe_error(error))
            return True
        return False

    async def _line_ready(self) -> None:
        """Release the held agent audio once the phone's line carries sound."""
        try:
            await asyncio.wait_for(self.phone.connected.wait(), self.limits.answer_timeout_s)
        except asyncio.TimeoutError:
            log.warning("call %s: the phone never said the call is connected", self.call_id)
            self.finish("ERROR")
            return
        if self.metrics.connected_at is None:
            self.metrics.connected()
        if self.limits.audio_ready_s > 0:
            await asyncio.sleep(self.limits.audio_ready_s)
        self._release()

    def _release(self) -> None:
        if self._held is None:
            return
        held, self._held = self._held, None
        for pcm in held:
            self.metrics.agent_audio()
            self.audio.play(pcm, self._out_rate)

    async def _start(self, ring: Ring) -> dict[str, Any] | CallResult:
        timeout = self.limits.start_timeout_s
        asking = asyncio.ensure_future(
            self.bto.start_call(ring.call_ref, ring.caller, timeout=timeout)
        )
        try:
            started = await asyncio.wait_for(asyncio.shield(asking), timeout)
        except asyncio.TimeoutError:
            log.warning("start: Bto did not decide within %.1fs", timeout or 0)
            self.say("Bto цагтаа хариулсангүй: утас ажилтанд дуугарна.")
            asking.add_done_callback(self._late_start)
            return CallResult(answered=False, reason="BTO_TIMEOUT")
        except BtoUnreachable as error:
            log.warning("start: Bto unreachable (%s)", error.why)
            self.say("Bto хариу өгөхгүй байна: сүлжээ, серверийн хаягаа шалгана уу.")
            return CallResult(answered=False, reason="BTO_UNREACHABLE")
        except BtoError as error:
            log.warning("start: Bto refused (%s %s)", error.status, error.code)
            self.say(f"Bto дуудлагыг хүлээж авсангүй: {error.code}")
            return CallResult(answered=False, reason="BTO_REFUSED")
        if not started.get("answer"):
            reason = str(started.get("reason") or "UNKNOWN")
            log.info("call %s: not answered (%s)", started.get("callId"), reason)
            self.say(
                f"Дуудлага {started.get('callId')}: Bto «хариулахгүй» гэв:"
                f" {DECLINES.get(reason, reason)}"
            )
            return CallResult(answered=False, call_id=started.get("callId"), reason=reason)
        return started

    def _late_start(self, asking: asyncio.Future[dict[str, Any]]) -> None:
        """Bto answered after the phone was told to ring for staff: a call it opened is closed."""
        if asking.cancelled() or asking.exception() is not None:
            return
        late = asking.result()
        if late.get("answer") and late.get("callId") is not None:
            task = asyncio.ensure_future(
                self.bto.end(int(late["callId"]), {"reason": "ERROR", "durationS": 0}, new_key())
            )
            self._late_tasks.add(task)
            task.add_done_callback(self._late_done)

    def _late_done(self, task: asyncio.Task[Any]) -> None:
        self._late_tasks.discard(task)
        error = None if task.cancelled() else task.exception()
        if error is not None:
            log.warning("a late call was not closed (%s)", _code(error))

    async def _close(self, ring: Ring, tasks: list[asyncio.Task[None]]) -> CallResult:
        reason = self.end_reason or "ERROR"
        if reason == "CALLER_HANGUP" or self.phone.hung_up.is_set():
            self.audio.flush()
        else:
            await self._drain(3.0)
        # A tool already on its way to Bto finishes, so its answer is stored before the end.
        try:
            await asyncio.wait_for(self._tools.join(), 5.0)
        except asyncio.TimeoutError:
            pass
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
        await self.audio.close()
        await self.phone.hangup(ring)
        duration = self._duration()
        try:
            await self._flush()
        except (BtoUnreachable, BtoError) as error:
            log.warning("call %s: last turns not stored (%s)", self.call_id, _code(error))
            self.say("Зарим яриа Bto-д хүрсэнгүй; дараа нь ElevenLabs-аас нөхөгдөнө.")
        ended = await self._post_end(reason, duration_s=duration)
        result = self._result(reason, ended)
        self._report(result)
        return result

    def _result(self, reason: str, ended: dict[str, Any] | None) -> CallResult:
        return CallResult(
            answered=True,
            call_id=self.call_id,
            end_reason=reason,
            outcome=(ended or {}).get("outcome"),
            order_number=(ended or {}).get("orderNumber"),
            duration_s=self._duration(),
            metrics=self.metrics,
        )

    def _report(self, result: CallResult) -> None:
        self.say(
            f"Дуудлага {result.call_id} дууслаа ({result.end_reason}), {result.duration_s} сек;"
            f" үр дүн {result.outcome or '-'}"
            + (f", захиалга {result.order_number}" if result.order_number else "")
        )
        for line in self.metrics.summary_lines():
            self.say(line)
        log.info(
            "call %s ended %s %ss turns=%s tools=%s searches=%s no_hits=%s unknown=%s",
            result.call_id,
            result.end_reason,
            result.duration_s,
            len(self.metrics.latencies_ms),
            self.metrics.tools,
            self.metrics.searches,
            self.metrics.no_hits,
            sum(self.unknown_types.values()),
        )
        if self.metrics_path is not None and result.call_id is not None:
            try:
                append_csv(
                    self.metrics_path,
                    self.metrics.row(result.call_id, result.duration_s, result.end_reason or ""),
                )
            except OSError:
                log.warning("metrics.csv not written")

    def _duration(self) -> int:
        return max(0, round(self.clock() - self._t0)) if self._t0 else 0

    def _at_ms(self) -> int:
        return int((self.clock() - self._t0) * 1000)

    def finish(self, reason: str) -> None:
        if self.end_reason is None:
            self.end_reason = reason
            log.info("call %s: ending (%s)", self.call_id, reason)
        self._done.set()

    # -- the conversation ---------------------------------------------------------------------

    async def _reader(self) -> None:
        assert self._ws is not None
        while True:
            try:
                message = await self._ws.recv()
            except Exception as error:  # noqa: BLE001
                log.warning("call %s: conversation lost (%s)", self.call_id, type(error).__name__)
                self.finish("ERROR")
                return
            if message is None:
                self.finish(self._closed_reason())
                return
            await self._handle(message)

    async def _handle(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        now = self.clock()
        if kind == "audio":
            event_id, pcm = protocol.audio(message)
            if event_id <= self._interrupted_id or not pcm:
                return
            self._last_agent_audio_at = now
            if self._held is not None:
                if self.phone.connected.is_set() and self.limits.audio_ready_s <= 0:
                    if self.metrics.connected_at is None:
                        self.metrics.connected()
                    self._release()
                else:
                    self._held.append(pcm)
                    return
            self.metrics.agent_audio()
            self.audio.play(pcm, self._out_rate)
        elif kind == "user_transcript":
            text = protocol.user_transcript(message)
            self.metrics.user_transcript()
            self._last_user_at = now
            seq = self.transcript.add("USER", text, self._at_ms())
            if seq is not None:
                self.say(f"  [{self._at_ms() / 1000:6.1f}s] залгагч  #{seq}")
        elif kind == "agent_response":
            seq = self.transcript.add("AGENT", protocol.agent_response(message), self._at_ms())
            if seq is not None:
                self.say(f"  [{self._at_ms() / 1000:6.1f}s] AI       #{seq}")
        elif kind == "client_tool_call":
            call = protocol.tool_call(message)
            seq = self.transcript.reserve()
            await self._tools.put(_ToolJob(call=call, seq=seq, at_ms=self._at_ms()))
        elif kind == "interruption":
            self._interrupted_id = max(self._interrupted_id, protocol.interruption(message))
            if self._held:
                self._held.clear()
            self.audio.flush()
        elif kind == "ping":
            await self._send(protocol.pong(protocol.ping(message)))
        elif kind == "conversation_initiation_metadata":
            meta = protocol.metadata(message)
            self.conversation_id = meta.conversation_id
            self._out_rate = meta.output_rate
            self._mic_rate = meta.input_rate
            self._vad = VoiceDetector(rate=self._mic_rate)
            if not self._audio_started:
                self._audio_started = True
                try:
                    await self.audio.start(self._on_mic, self._mic_rate)
                except Exception as error:  # noqa: BLE001 - a device gone or busy
                    log.warning(
                        "call %s: audio did not open (%s)", self.call_id, describe_error(error)
                    )
                    self.say(
                        f"Дуудлага {self.call_id}: дуу нээгдсэнгүй. Цэс → «дууны зам шалгах»-аар"
                        " шалгана уу (алдаа bridge.log-д)."
                    )
                    self.finish("ERROR")
        elif kind == "client_error":
            log.warning("call %s: provider error %s", self.call_id, protocol.client_error(message))
        elif kind in ("vad_score", "agent_response_correction", "agent_response_complete"):
            pass
        else:
            name = str(kind)[:40]
            self.unknown_types[name] = self.unknown_types.get(name, 0) + 1

    def _closed_reason(self) -> str:
        if self._ending_at is not None:
            return "COMPLETED"
        now = self.clock()
        if now - self._t0 >= self.limits.max_call_s - 5:
            return "TIMEOUT"
        if now - self._last_user_at >= self.limits.silence_s - 5:
            return "SILENCE"
        code = self._ws.close_code if self._ws is not None else None
        return "COMPLETED" if code in (None, 1000) else "ERROR"

    async def _send(self, text: str) -> None:
        if self._ws is None or self._done.is_set():
            return
        try:
            await self._ws.send(text)
        except Exception as error:  # noqa: BLE001
            log.warning("call %s: send failed (%s)", self.call_id, type(error).__name__)
            self.finish(self._closed_reason())

    # -- the microphone -----------------------------------------------------------------------

    def _on_mic(self, block: np.ndarray) -> None:
        if self._done.is_set():
            return
        if self.echo_gate is not None:
            now = self.clock()
            self.echo_gate.agent_playing(self.audio.pending_ms(), now)
            block = self.echo_gate.apply(block, now)
        if self._vad.feed(block) > 0:
            self.metrics.user_voice()
            self._last_user_at = self.clock()
        self._mic.extend(block.astype(np.int16, copy=False).tobytes())
        size = self._mic_rate * self.chunk_ms // 1000 * 2
        while len(self._mic) >= size:
            self._outgoing.put_nowait(bytes(self._mic[:size]))
            del self._mic[:size]

    async def _sender(self) -> None:
        while True:
            chunk = await self._outgoing.get()
            await self._send(protocol.user_audio(chunk))

    # -- Bto ----------------------------------------------------------------------------------

    async def _flush(self) -> None:
        """Store every buffered turn, in order; raises when Bto does not take them."""
        if self.call_id is None:
            return
        async with self._write_lock:
            while self.transcript.pending:
                batch = self.transcript.pending[:BATCH_MAX]
                await self.bto.post_events(self.call_id, batch, self.conversation_id, new_key())
                del self.transcript.pending[: len(batch)]

    async def _flusher(self) -> None:
        while True:
            await asyncio.sleep(self.limits.flush_every_s)
            if not self.transcript.pending:
                continue
            try:
                await self._flush()
                self._flush_failures = 0
            except (BtoUnreachable, BtoError) as error:
                self._flush_failures += 1
                if self._flush_failures == 1:
                    log.warning("call %s: turns not stored yet (%s)", self.call_id, _code(error))

    async def _tool_worker(self) -> None:
        while True:
            job = await self._tools.get()
            try:
                await self._run_tool(job)
            finally:
                self._tools.task_done()

    async def _run_tool(self, job: _ToolJob) -> None:
        assert self.call_id is not None
        name = job.call.name
        started = self.clock()
        answer: dict[str, Any] | None = None
        ok = False
        try:
            # The server's «no order without yes» reads the turns before the tool: store them first.
            await self._flush()
            body = {
                "afterSeq": job.seq - 1,
                "seq": job.seq,
                "atMs": job.at_ms,
                "args": job.call.parameters,
            }
            async with self._write_lock:
                reply = await self.bto.tool(self.call_id, name, body, new_key())
            answer = reply.get("answer") if isinstance(reply.get("answer"), dict) else {}
            ok = True
            result: Any = answer
            code = "ok"
        except BtoError as error:
            result = {"error": error.code}
            code = error.code
        except BtoUnreachable:
            # Bto is down: the agent is told (its prompt says to apologise and end), and the call
            # ends shortly whatever it says.
            result = {"error": "BTO_UNAVAILABLE"}
            code = "BTO_UNAVAILABLE"
            if self._broken_at is None:
                self._broken_at = self.clock()
        ms = (self.clock() - started) * 1000
        self.metrics.tool(name, ok, answer, ms)
        log.info("call %s: tool %s seq=%s %s %.0fms", self.call_id, name[:40], job.seq, code, ms)
        detail = ""
        if ok and name == "search_products":
            detail = f" ({len((answer or {}).get('products') or [])} олдсон)"
        self.say(
            f"  [{self._at_ms() / 1000:6.1f}s] хэрэгсэл #{job.seq} {name[:40]}: {code}"
            f" {ms:.0f} ms{detail}"
        )
        if job.call.tool_call_id:
            await self._send(protocol.tool_result(job.call.tool_call_id, result, not ok))
        if name == "end_call" and self._ending_at is None:
            self._ending_at = self.clock()

    async def _post_end(self, reason: str, duration_s: int) -> dict[str, Any] | None:
        if self.call_id is None:
            return None
        body: dict[str, Any] = {"reason": reason, "durationS": duration_s}
        if self.conversation_id:
            body["conversationId"] = self.conversation_id
        try:
            return await self.bto.end(self.call_id, body, new_key())
        except (BtoUnreachable, BtoError) as error:
            log.warning("call %s: end not stored (%s)", self.call_id, _code(error))
            self.say("Bto дуудлагын төгсгөлийг авсангүй; 15 минутын дараа өөрөө хаана.")
            return None

    # -- limits -------------------------------------------------------------------------------

    async def _watchdog(self) -> None:
        hung_up = self.phone.hung_up
        while not self._done.is_set():
            await asyncio.sleep(self.limits.tick_s)
            now = self.clock()
            if hung_up.is_set():
                self.finish(getattr(self.phone, "end_reason", "CALLER_HANGUP"))
            elif self._ending_at is not None:
                quiet_since = max(self._ending_at, self._last_agent_audio_at or 0.0)
                drained = self.audio.pending_ms() <= 0
                if (drained and now - quiet_since >= self.limits.drain_quiet_s) or (
                    now - self._ending_at >= self.limits.drain_max_s
                ):
                    self.finish("COMPLETED")
            elif self._broken_at is not None and now - self._broken_at >= self.limits.broken_after_s:
                self.finish("ERROR")
            elif now - self._t0 >= self.limits.max_call_s + self.limits.grace_s:
                self.finish("TIMEOUT")
            elif now - self._last_user_at >= self.limits.silence_s + self.limits.grace_s:
                self.finish("SILENCE")

    async def _drain(self, at_most: float) -> None:
        deadline = self.clock() + at_most
        while self.audio.pending_ms() > 0 and self.clock() < deadline:
            await asyncio.sleep(0.05)


def _code(error: Exception) -> str:
    if isinstance(error, BtoError):
        return error.code
    if isinstance(error, BtoUnreachable):
        return f"unreachable:{error.why}"
    return type(error).__name__

