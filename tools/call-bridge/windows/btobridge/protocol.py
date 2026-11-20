"""The ElevenLabs Agents WebSocket messages the bridge sends and reads.

Shapes from the provider's AsyncAPI page (elevenlabs.io/docs/eleven-agents/api-reference/
eleven-agents/websocket, read 2026-11-20). Every server message has a `type` and its payload under
a type-specific key; the client's microphone audio is the one message without a `type`.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from typing import Any

PCM_RATES = {
    "pcm_8000": 8000,
    "pcm_16000": 16000,
    "pcm_22050": 22050,
    "pcm_24000": 24000,
    "pcm_44100": 44100,
    "pcm_48000": 48000,
}


def pcm_rate(audio_format: str | None, default: int = 16000) -> int:
    """The sample rate of a `pcm_<rate>` format; ulaw_8000 is refused (the agent is set to PCM)."""
    if audio_format is None:
        return default
    rate = PCM_RATES.get(audio_format)
    if rate is None:
        raise ValueError(f"unsupported audio format {audio_format}")
    return rate


# -- client -> server ---------------------------------------------------------------------------


def initiation(dynamic_variables: dict[str, Any], first_message: str | None) -> str:
    """The first message: the call's dynamic variables, and the line's own greeting if it has one
    (the agent's `first_message` override must be enabled, which agent.json does)."""
    message: dict[str, Any] = {
        "type": "conversation_initiation_client_data",
        "dynamic_variables": {
            name: value
            for name, value in dynamic_variables.items()
            if isinstance(value, (str, int, float, bool))
        },
    }
    if first_message:
        message["conversation_config_override"] = {"agent": {"first_message": first_message}}
    return json.dumps(message, ensure_ascii=False)


def user_audio(pcm: bytes) -> str:
    return json.dumps({"user_audio_chunk": base64.b64encode(pcm).decode("ascii")})


def pong(event_id: int) -> str:
    return json.dumps({"type": "pong", "event_id": event_id})


def tool_result(tool_call_id: str, result: Any, is_error: bool) -> str:
    text = result if isinstance(result, str) else json.dumps(result, ensure_ascii=False)
    message: dict[str, Any] = {
        "type": "client_tool_result",
        "tool_call_id": tool_call_id,
        "result": text,
        "is_error": is_error,
    }
    return json.dumps(message, ensure_ascii=False)


# -- server -> client ---------------------------------------------------------------------------


@dataclass
class Metadata:
    conversation_id: str | None
    output_rate: int
    input_rate: int


@dataclass
class ToolCall:
    tool_call_id: str
    name: str
    parameters: dict[str, Any]


def metadata(message: dict[str, Any]) -> Metadata:
    event = message.get("conversation_initiation_metadata_event") or {}
    return Metadata(
        conversation_id=event.get("conversation_id"),
        output_rate=pcm_rate(event.get("agent_output_audio_format")),
        input_rate=pcm_rate(event.get("user_input_audio_format")),
    )


def audio(message: dict[str, Any]) -> tuple[int, bytes]:
    event = message.get("audio_event") or {}
    return int(event.get("event_id") or 0), base64.b64decode(event.get("audio_base_64") or "")


def user_transcript(message: dict[str, Any]) -> str:
    event = message.get("user_transcription_event") or {}
    return str(event.get("user_transcript") or "").strip()


def agent_response(message: dict[str, Any]) -> str:
    event = message.get("agent_response_event") or {}
    return str(event.get("agent_response") or "").strip()


def interruption(message: dict[str, Any]) -> int:
    event = message.get("interruption_event") or {}
    return int(event.get("event_id") or 0)


def ping(message: dict[str, Any]) -> int:
    event = message.get("ping_event") or {}
    return int(event.get("event_id") or 0)


def tool_call(message: dict[str, Any]) -> ToolCall:
    event = message.get("client_tool_call") or {}
    parameters = event.get("parameters")
    return ToolCall(
        tool_call_id=str(event.get("tool_call_id") or ""),
        name=str(event.get("tool_name") or ""),
        parameters=parameters if isinstance(parameters, dict) else {},
    )


def client_error(message: dict[str, Any]) -> str:
    event = message.get("error_event") or {}
    return str(event.get("error_name") or event.get("code") or "client_error")
