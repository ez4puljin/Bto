"""Opening the call's audio (0.3.1): which device, host API, rate and channels are tried and in
what order, that every PortAudio call runs on the one audio thread (not the event loop's: COM),
the failures logged in PortAudio's own words, and `audio-test`."""

from __future__ import annotations

import asyncio
import logging
import sys
import threading
from typing import Any

import pytest

from btobridge import audiotest
from btobridge.audio import (
    AudioOpenError,
    BluetoothAudio,
    ListenAudio,
    OpenTry,
    describe_error,
    device_plan,
    loopback_plan,
    open_first,
    pa_output_plan,
    pick_device,
    same_device,
)
from btobridge.audio import is_audio_thread
from btobridge.phone import LocalPhone
from btobridge.session import CallSession

from fake_sound import (
    CABLE_INPUT_WASAPI,
    CALL_OUTPUT_WASAPI,
    DEVICES,
    HOSTS,
    Recorder,
    make_pyaudiowpatch,
    make_sounddevice,
    pa_devices,
)
from fakes import FakeBto, FakeConversation, metadata_message
from test_session import FAST


def host(index: int) -> str:
    return str(HOSTS[DEVICES[index]["hostapi"]]["name"])


# -- the plan -------------------------------------------------------------------------------------


def test_the_same_device_is_found_across_host_apis_and_never_the_16ch_cable() -> None:
    full = "CABLE Input (VB-Audio Virtual Cable)"
    assert same_device(full, "CABLE Input (VB-Audio Virtual C")  # MME's cut name
    assert same_device("cable input (vb-audio virtual cable) ", full)
    assert not same_device(full, "CABLE In 16ch (VB-Audio Virtual Cable)")
    assert not same_device(full, "CABLE In 16ch (VB-Audio Virtua")
    assert not same_device(full, "CABLE")  # too short to be a cut name


def test_the_cable_output_is_tried_on_wasapi_then_directsound_then_mme_at_its_rate_then_48k_44k() -> None:
    plan = device_plan(DEVICES, HOSTS, CABLE_INPUT_WASAPI, "output")
    assert [(t.host, t.rate, t.auto_convert) for t in plan] == [
        ("Windows WASAPI", 44100, True),
        ("Windows WASAPI", 48000, True),
        ("Windows DirectSound", 44100, False),
        ("Windows DirectSound", 48000, False),
        ("MME", 44100, False),
        ("MME", 48000, False),
    ]
    assert plan[0].index == CABLE_INPUT_WASAPI
    assert all("16ch" not in t.name for t in plan)
    assert all(t.channels == 2 for t in plan)


def test_a_device_chosen_by_its_mme_number_still_tries_wasapi_first() -> None:
    mme_cable = next(i for i, d in enumerate(DEVICES) if d["name"] == "CABLE Input (VB-Audio Virtual C")
    plan = device_plan(DEVICES, HOSTS, mme_cable, "output")
    assert plan[0].index == CABLE_INPUT_WASAPI
    assert plan[-1].index == mme_cable


def test_a_16_channel_device_opens_with_two() -> None:
    sixteen = CABLE_INPUT_WASAPI + 1
    plan = device_plan(DEVICES, HOSTS, sixteen, "output")
    assert plan[0].channels == 2 and plan[0].index == sixteen


def test_the_loopback_opens_in_its_own_format_first() -> None:
    info = {"index": 7, "name": "Headset Earphone (HyperX Cloud Alpha S Chat) [Loopback]",
            "defaultSampleRate": 48000.0, "maxInputChannels": 2}
    plan = loopback_plan(info)
    assert [(t.rate, t.channels) for t in plan] == [(48000, 2), (44100, 2)]
    assert plan[0].name == "Headset Earphone (HyperX Cloud Alpha S Chat)"
    surround = loopback_plan({**info, "defaultSampleRate": 44100.0, "maxInputChannels": 8})
    assert [(t.rate, t.channels) for t in surround] == [(44100, 8), (48000, 8), (44100, 2)]


def test_pyaudiowpatch_is_the_last_try_for_the_agent_and_never_a_loopback() -> None:
    plan = pa_output_plan(pa_devices(), "CABLE Input (VB-Audio Virtual Cable)")
    assert len(plan) == 1
    assert plan[0].backend == "pyaudiowpatch" and plan[0].index == 1 and plan[0].rate == 44100


def test_the_cable_by_name_is_the_wasapi_entry_and_not_16ch() -> None:
    sd = make_sounddevice(Recorder())
    assert pick_device(sd, "CABLE Input", "output") == CABLE_INPUT_WASAPI
    assert pick_device(sd, "CABLE In", "output") == CABLE_INPUT_WASAPI
    assert pick_device(sd, "16ch", "output") == CABLE_INPUT_WASAPI + 1


# -- the tries and their log ----------------------------------------------------------------------


class PortAudioError(Exception):
    pass


def test_the_first_try_that_opens_wins_and_each_failure_is_logged_in_portaudios_words(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    plan = device_plan(DEVICES, HOSTS, CABLE_INPUT_WASAPI, "output")
    seen: list[OpenTry] = []

    def open_one(attempt: OpenTry) -> str:
        seen.append(attempt)
        if len(seen) < 3:
            raise PortAudioError(
                "Error opening OutputStream: Invalid sample rate", -9997
            )
        return "stream"

    attempt, stream, failures = open_first("playback", plan, open_one)
    assert stream == "stream" and attempt == plan[2]
    assert len(failures) == 2
    assert "Invalid sample rate [PaErrorCode -9997]" in caplog.text
    assert "playback try 1/6 failed: CABLE Input (VB-Audio Virtual Cable) | Windows WASAPI | 44100 Hz x2" in caplog.text
    assert "playback open (try 3/6): CABLE Input (VB-Audio Virtual Cable) | Windows DirectSound | 44100 Hz x2" in caplog.text


def test_when_every_try_fails_the_error_carries_each_one() -> None:
    plan = device_plan(DEVICES, HOSTS, CABLE_INPUT_WASAPI, "output")

    def open_one(_attempt: OpenTry) -> None:
        raise OSError(-9997, "Invalid sample rate")

    with pytest.raises(AudioOpenError) as raised:
        open_first("playback", plan, open_one)
    assert len(raised.value.failures) == 6
    assert "[Errno -9997] Invalid sample rate" in str(raised.value)
    assert "MME" in raised.value.failures[-1]


def test_a_host_error_is_described_with_its_hresult() -> None:
    error = PortAudioError(
        "Error opening OutputStream: Unanticipated host error", -9999, (13, -2147221008, "")
    )
    text = describe_error(error)
    assert text.startswith("PortAudioError: Error opening OutputStream: Unanticipated host error")
    assert "[PaErrorCode -9999]" in text
    assert "0x800401F0" in text


# -- the bluetooth audio against fake libraries ---------------------------------------------------


@pytest.fixture
def sound(monkeypatch: pytest.MonkeyPatch) -> Any:
    def install(sd_fail: Any = None, pa_fail: Any = None) -> Recorder:
        recorder = Recorder()
        sd = make_sounddevice(recorder, sd_fail) if sd_fail else make_sounddevice(recorder)
        pa = make_pyaudiowpatch(recorder, pa_fail) if pa_fail else make_pyaudiowpatch(recorder)
        monkeypatch.setitem(sys.modules, "sounddevice", sd)
        monkeypatch.setitem(sys.modules, "pyaudiowpatch", pa)
        return recorder

    return install


def _bluetooth() -> BluetoothAudio:
    return BluetoothAudio(CALL_OUTPUT_WASAPI, "CABLE Input")


def test_every_portaudio_call_runs_on_one_thread_that_is_not_the_event_loops(sound: Any) -> None:
    recorder = sound()
    audio = _bluetooth()
    blocks: list[Any] = []

    async def call() -> int:
        await asyncio.to_thread(audio.prepare)  # as the session does, before answering
        await audio.start(blocks.append, 16000)
        await asyncio.sleep(0.05)
        await audio.close()
        return threading.get_ident()

    loop_thread = asyncio.run(call())
    assert len(recorder.threads) == 1
    assert loop_thread not in recorder.threads
    assert threading.get_ident() not in recorder.threads
    assert blocks, "the loopback delivered the call"
    kinds = [(r["kind"], r["device"], r["rate"], r["channels"]) for r in recorder.opened]
    assert kinds[0] == ("output", CABLE_INPUT_WASAPI, 44100, 2)
    assert recorder.opened[0]["auto_convert"] is True
    assert kinds[1] == ("pa-input", 3 + 0, 48000, 2)  # the HyperX Chat's loopback, its own format
    assert not is_audio_thread()


def test_wasapi_refusing_the_cable_falls_back_to_directsound(sound: Any, caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO)

    def sd_fail(kind: str, record: dict[str, Any]) -> BaseException | None:
        if kind == "output" and host(record["device"]) == "Windows WASAPI":
            sd = sys.modules["sounddevice"]
            return sd.PortAudioError(  # type: ignore[attr-defined, no-any-return]
                "Error opening OutputStream: Unanticipated host error", -9999, (13, -2147221008, "")
            )
        return None

    recorder = sound(sd_fail=sd_fail)
    audio = _bluetooth()

    async def call() -> None:
        await audio.start(lambda _b: None, 16000)
        await audio.close()

    asyncio.run(call())
    assert host(recorder.opened[0]["device"]) == "Windows DirectSound"
    assert audio.playback.opened is not None and audio.playback.opened.host == "Windows DirectSound"
    assert len(audio.playback.failures) == 2
    assert "0x800401F0" in caplog.text
    assert "playback open (try 3/" in caplog.text


def test_a_loopback_that_will_not_open_closes_the_cable_and_says_why(sound: Any) -> None:
    def pa_fail(kind: str, _record: dict[str, Any]) -> BaseException | None:
        return OSError(-9997, "Invalid sample rate") if kind == "pa-input" else None

    recorder = sound(pa_fail=pa_fail)
    audio = _bluetooth()

    async def call() -> None:
        try:
            await audio.start(lambda _b: None, 16000)
        finally:
            await audio.close()

    with pytest.raises(AudioOpenError) as raised:
        asyncio.run(call())
    assert raised.value.what == "loopback"
    assert "[Errno -9997] Invalid sample rate" in describe_error(raised.value)
    assert [r["kind"] for r in recorder.opened] == ["output"]


def test_the_session_logs_the_exact_error_when_the_audio_does_not_open(
    sound: Any, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.INFO)

    def sd_fail(kind: str, record: dict[str, Any]) -> BaseException | None:
        sd = sys.modules["sounddevice"]
        return sd.PortAudioError(  # type: ignore[attr-defined, no-any-return]
            "Error opening OutputStream: Invalid number of channels", -9998
        )

    def pa_fail(kind: str, _record: dict[str, Any]) -> BaseException | None:
        return OSError(-9996, "Invalid device") if kind == "pa-output" else None

    sound(sd_fail=sd_fail, pa_fail=pa_fail)
    said: list[str] = []
    conversation = FakeConversation([metadata_message()])
    session = CallSession(
        FakeBto(), conversation.open, _bluetooth(), LocalPhone("+97699112233"),
        limits=FAST, chunk_ms=100, say=said.append,
    )

    async def main() -> Any:
        return await asyncio.wait_for(session.run(), 10)

    result = asyncio.run(main())
    assert result.end_reason == "ERROR"
    assert "audio did not open (AudioOpenError: playback: all " in caplog.text
    assert "Invalid number of channels [PaErrorCode -9998]" in caplog.text
    assert "Invalid device" in caplog.text
    assert any("дуу нээгдсэнгүй" in line for line in said)


# -- audio-test -----------------------------------------------------------------------------------


def _fast(seconds: float) -> Any:
    return asyncio.sleep(seconds / 10)


def test_audio_test_says_ok_when_the_tone_comes_out_of_cable_output(sound: Any) -> None:
    sound()
    said: list[str] = []
    result = asyncio.run(audiotest.run(_bluetooth(), ListenAudio("CABLE Output"), said.append, _fast))
    assert result.ok, said
    assert result.error is None
    assert result.playback is not None and "CABLE Input" in result.playback
    assert result.capture is not None and "HyperX Cloud Alpha S Chat" in result.capture
    assert result.call_ms > 0
    assert result.tone_left_ms <= audiotest.DRAINED_MS
    assert result.cable_dbfs is not None and result.cable_dbfs > -20
    assert said[-1].startswith("OK")


def test_audio_test_prints_the_exact_error_and_every_try(sound: Any) -> None:
    def sd_fail(kind: str, _record: dict[str, Any]) -> BaseException | None:
        sd = sys.modules["sounddevice"]
        return sd.PortAudioError("Error opening OutputStream: Device unavailable", -9985)  # type: ignore[attr-defined, no-any-return]

    def pa_fail(kind: str, _record: dict[str, Any]) -> BaseException | None:
        return OSError(-9985, "Device unavailable") if kind == "pa-output" else None

    sound(sd_fail=sd_fail, pa_fail=pa_fail)
    said: list[str] = []
    result = asyncio.run(audiotest.run(_bluetooth(), None, said.append, _fast))
    assert not result.ok
    assert result.error is not None and "Device unavailable" in result.error
    # WASAPI x2, DirectSound x2, MME x2, PyAudioWPatch's own WASAPI entry
    assert len(result.failures) == 7
    assert "(pyaudiowpatch)" in result.failures[-1]
    assert said[1].startswith("АЛДАА")
    assert any("[PaErrorCode -9985]" in line for line in said)


def test_audio_test_fails_when_the_cable_does_not_carry_the_tone() -> None:
    result = audiotest.AudioTestResult(cable_dbfs=-90.0)
    assert not audiotest.judge(result)
    assert audiotest.judge(audiotest.AudioTestResult(cable_dbfs=-15.0))
    assert audiotest.judge(audiotest.AudioTestResult(cable_dbfs=None))
    assert not audiotest.judge(audiotest.AudioTestResult(tone_left_ms=900.0))
