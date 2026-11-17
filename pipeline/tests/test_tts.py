"""Tests for tts.py with edge-tts replaced by a fake (no network)."""

import asyncio

import aiohttp
import pytest

from french_tts import tts
from french_tts.config import DEFAULT_VOICE, NORMAL_RATE, SLOW_RATE
from french_tts.tts import TICKS_PER_SECOND, VOICES, EdgeTTSBackend, check_rate, resolve_voice


class FakeCommunicate:
    """Stands in for ``edge_tts.Communicate``; records each construction."""

    calls: list[dict] = []
    failures_left = 0

    def __init__(self, text, voice, *, rate, boundary):
        FakeCommunicate.calls.append({"text": text, "voice": voice, "rate": rate, "boundary": boundary})

    async def stream(self):
        if FakeCommunicate.failures_left > 0:
            FakeCommunicate.failures_left -= 1
            raise aiohttp.ClientError("connection reset")
        yield {"type": "audio", "data": b"ID3"}
        yield {"type": "WordBoundary", "offset": 1_000_000, "duration": 4_000_000, "text": "Bonjour"}
        yield {"type": "audio", "data": b"mp3"}


@pytest.fixture
def fake_edge(monkeypatch):
    FakeCommunicate.calls = []
    FakeCommunicate.failures_left = 0
    monkeypatch.setattr(tts.edge_tts, "Communicate", FakeCommunicate)
    return FakeCommunicate


def test_defaults_are_valid():
    assert DEFAULT_VOICE in VOICES
    for rate in (NORMAL_RATE, SLOW_RATE):
        assert check_rate(rate) == rate


def test_voices_are_french():
    assert all(name.startswith("fr-FR-") and name.endswith("Neural") for name in VOICES.values())


def test_resolve_voice_accepts_short_and_full_names():
    assert resolve_voice("henri") == "fr-FR-HenriNeural"
    assert resolve_voice("fr-FR-HenriNeural") == "fr-FR-HenriNeural"
    with pytest.raises(ValueError, match="Unknown voice"):
        resolve_voice("nestoras")


@pytest.mark.parametrize("rate", ["-25%", "+0%", "+10%"])
def test_check_rate_accepts_signed_percentages(rate):
    assert check_rate(rate) == rate


@pytest.mark.parametrize("rate", ["25%", "-25", "-0.25", "slow", "", "-25 %"])
def test_check_rate_rejects_other_forms(rate):
    with pytest.raises(ValueError, match="Bad rate"):
        check_rate(rate)


def test_synthesize_passes_rate_and_collects_audio_and_words(fake_edge):
    result = asyncio.run(EdgeTTSBackend().synthesize("Bonjour.", "denise", "-25%"))
    assert fake_edge.calls == [
        {"text": "Bonjour.", "voice": "fr-FR-DeniseNeural", "rate": "-25%", "boundary": "WordBoundary"}
    ]
    assert result.audio == b"ID3mp3"
    assert result.rate == "-25%"
    assert result.voice == "fr-FR-DeniseNeural"
    [word] = result.words
    assert word.text == "Bonjour"
    assert word.start == pytest.approx(1_000_000 / TICKS_PER_SECOND)
    assert word.end == pytest.approx(5_000_000 / TICKS_PER_SECOND)


def test_synthesize_defaults_to_normal_rate(fake_edge):
    asyncio.run(EdgeTTSBackend().synthesize("Bonjour.", "henri"))
    assert fake_edge.calls[0]["rate"] == NORMAL_RATE


def test_bad_rate_fails_before_any_request(fake_edge):
    with pytest.raises(ValueError):
        asyncio.run(EdgeTTSBackend().synthesize("Bonjour.", "denise", "slow"))
    assert fake_edge.calls == []


def test_transient_errors_are_retried(fake_edge):
    fake_edge.failures_left = 2
    result = asyncio.run(EdgeTTSBackend(retries=3, backoff_seconds=0).synthesize("Bonjour.", "denise"))
    assert result.audio == b"ID3mp3"
    assert len(fake_edge.calls) == 3


def test_gives_up_after_retries(fake_edge):
    fake_edge.failures_left = 10
    with pytest.raises(aiohttp.ClientError):
        asyncio.run(EdgeTTSBackend(retries=2, backoff_seconds=0).synthesize("Bonjour.", "denise"))
    assert len(fake_edge.calls) == 3
