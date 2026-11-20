"""Bto's station routes (docs/modules/phone-agent.md §4), over the LAN with the line's key.

Plain urllib in a worker thread: no HTTP library to install or keep. Every request that writes
carries an `Idempotency-Key`; a retry after a lost answer reuses it, so the server answers the
stored result instead of acting twice. A refusal is problem+json: only its `code` is kept, never
its body, and nothing here logs a request's or an answer's content.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.request
import uuid
from typing import Any, Protocol

from . import __version__

API = "/api/v1/phone-agent"
USER_AGENT = f"BtoCallBridge/{__version__} (Windows)"


class BtoUnreachable(Exception):
    """Bto did not answer (no network, a timeout, a 5xx after the retries)."""

    def __init__(self, why: str) -> None:
        super().__init__(why)
        self.why = why


class BtoError(Exception):
    """Bto refused the request; `code` is the problem's stable code (PHONE_..., VALIDATION_FAILED)."""

    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"{status} {code}")
        self.status = status
        self.code = code


def new_key() -> str:
    return str(uuid.uuid4())


class StationApi(Protocol):
    """What a call needs from Bto; tests give a fake."""

    async def station(self) -> dict[str, Any]: ...

    async def start_call(
        self, call_ref: str, caller: str | None, *, timeout: float | None = None
    ) -> dict[str, Any]: ...

    async def post_events(
        self, call_id: int, events: list[dict[str, Any]], conversation_id: str | None, key: str
    ) -> dict[str, Any]: ...

    async def tool(
        self, call_id: int, name: str, body: dict[str, Any], key: str
    ) -> dict[str, Any]: ...

    async def end(self, call_id: int, body: dict[str, Any], key: str) -> dict[str, Any]: ...


#: Retries after the first try and the pause before each: a lost answer is asked again by the same
#: key. 4xx is final (but an idempotency key still in progress is worth one more look).
RETRY_PAUSES = (0.25, 0.75, 1.5)


class BtoClient:
    def __init__(self, server: str, key: str, timeout: float = 6.0) -> None:
        self.server = server.rstrip("/")
        self._key = key
        self.timeout = timeout

    # -- the routes ---------------------------------------------------------------------------

    async def station(self) -> dict[str, Any]:
        return await self._request("GET", "/station", retries=1)

    async def start_call(
        self, call_ref: str, caller: str | None, *, timeout: float | None = None
    ) -> dict[str, Any]:
        # No retry: a replayed answer carries no signed URL (the line does not pick up), and the
        # phone's three seconds would be gone anyway. With a phone the caller of this keeps it
        # under two seconds (`decide_s`).
        return await self._request(
            "POST",
            "/calls",
            {"callRef": call_ref, "callerPhone": caller},
            idempotency=new_key(),
            retries=0,
            timeout=timeout or 4.0,
        )

    async def post_events(
        self, call_id: int, events: list[dict[str, Any]], conversation_id: str | None, key: str
    ) -> dict[str, Any]:
        body: dict[str, Any] = {"events": events}
        if conversation_id:
            body["conversationId"] = conversation_id
        return await self._request("POST", f"/calls/{call_id}/events", body, idempotency=key)

    async def tool(
        self, call_id: int, name: str, body: dict[str, Any], key: str
    ) -> dict[str, Any]:
        return await self._request(
            "POST", f"/calls/{call_id}/tools/{name}", body, idempotency=key, timeout=10.0
        )

    async def end(self, call_id: int, body: dict[str, Any], key: str) -> dict[str, Any]:
        return await self._request("POST", f"/calls/{call_id}/end", body, idempotency=key)

    # -- the plumbing -------------------------------------------------------------------------

    async def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        idempotency: str | None = None,
        retries: int = len(RETRY_PAUSES),
        timeout: float | None = None,
    ) -> dict[str, Any]:
        last: Exception | None = None
        for attempt in range(retries + 1):
            if attempt > 0:
                await asyncio.sleep(RETRY_PAUSES[min(attempt - 1, len(RETRY_PAUSES) - 1)])
            try:
                return await asyncio.to_thread(
                    self._send, method, path, body, idempotency, timeout or self.timeout
                )
            except BtoError as error:
                if error.code != "IDEMPOTENCY_KEY_IN_PROGRESS":
                    raise
                last = error
            except BtoUnreachable as error:
                last = error
        if isinstance(last, BtoError):
            raise last
        raise last if last else BtoUnreachable("no attempt")

    def _send(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None,
        idempotency: str | None,
        timeout: float,
    ) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {self._key}",
            "Accept": "application/json",
            # Cloudflare blocks the default «Python-urllib/x» agent (403) on the public address.
            "User-Agent": USER_AGENT,
        }
        data = None
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency:
            headers["Idempotency-Key"] = idempotency
        request = urllib.request.Request(
            self.server + API + path, data=data, headers=headers, method=method
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
        except urllib.error.HTTPError as error:
            status = error.code
            code = _problem_code(error)
            if status >= 500:
                raise BtoUnreachable(f"http {status}") from None
            raise BtoError(status, code) from None
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
            raise BtoUnreachable(type(error).__name__) from None
        if not raw:
            return {}
        parsed = json.loads(raw.decode("utf-8"))
        return parsed if isinstance(parsed, dict) else {"value": parsed}


def _problem_code(error: urllib.error.HTTPError) -> str:
    try:
        problem = json.loads(error.read().decode("utf-8"))
    except Exception:  # noqa: BLE001 - anything unreadable is just "HTTP_<status>"
        return f"HTTP_{error.code}"
    code = problem.get("code") if isinstance(problem, dict) else None
    return code if isinstance(code, str) and code else f"HTTP_{error.code}"
