"""TTS backends: turn French text into MP3 audio plus per-word timings.

The pipeline only depends on the ``TTSBackend`` protocol, so edge-tts can be
swapped for the official Azure Speech SDK later without touching the callers.

Run as a script to synthesise one phrase and print its word timings:

    uv run python -m french_tts.tts "Je voudrais un café." --voice henri --rate=-25% --out sample.mp3

(``--rate=-25%`` needs the ``=``: argparse would read a bare ``-25%`` as a flag.)
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import aiohttp
import edge_tts
from edge_tts.exceptions import EdgeTTSException

from french_tts.config import DEFAULT_VOICE, NORMAL_RATE

# Short names used throughout the pipeline (YAML overrides, bake-off labels).
VOICES: dict[str, str] = {
    "denise": "fr-FR-DeniseNeural",  # female
    "eloise": "fr-FR-EloiseNeural",  # female
    "henri": "fr-FR-HenriNeural",  # male
    "remy": "fr-FR-RemyMultilingualNeural",  # male
    "vivienne": "fr-FR-VivienneMultilingualNeural",  # female
}

# Speaking-rate offset in edge-tts / SSML prosody form: "+0%", "-25%".
# Same pattern edge-tts enforces, checked here so a bad value fails before any
# network call and the string stays canonical for the audio cache key.
RATE_PATTERN = re.compile(r"^[+-]\d+%$")

# Azure / edge-tts report boundary offsets and durations in 100-ns ticks.
TICKS_PER_SECOND = 10_000_000


@dataclass(frozen=True)
class WordBoundary:
    """One spoken word and where it sits in the audio, in seconds."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Synthesis:
    """Result of one TTS call: MP3 bytes plus the timing of each word."""

    text: str
    voice: str
    rate: str
    audio: bytes  # MP3, 24 kHz mono, 48 kbit/s for edge-tts
    words: list[WordBoundary]


class TTSBackend(Protocol):
    async def synthesize(self, text: str, voice: str, rate: str = NORMAL_RATE) -> Synthesis:
        """Synthesise ``text`` with ``voice`` (a key of ``VOICES``) at ``rate`` ("-25%")."""
        ...


class EdgeTTSBackend:
    """Uses the Microsoft Edge read-aloud service via the ``edge-tts`` package.

    Unofficial but free and keyless; it serves the same neural voices as Azure.
    Transient network/service errors are retried with exponential backoff.
    """

    def __init__(self, retries: int = 3, backoff_seconds: float = 1.0) -> None:
        self.retries = retries
        self.backoff_seconds = backoff_seconds

    async def synthesize(self, text: str, voice: str, rate: str = NORMAL_RATE) -> Synthesis:
        voice_name = resolve_voice(voice)
        rate = check_rate(rate)
        for attempt in range(self.retries + 1):
            try:
                return await self._synthesize_once(text, voice_name, rate)
            except (EdgeTTSException, aiohttp.ClientError, asyncio.TimeoutError):
                if attempt == self.retries:
                    raise
                await asyncio.sleep(self.backoff_seconds * 2**attempt)
        raise AssertionError("unreachable")

    async def _synthesize_once(self, text: str, voice_name: str, rate: str) -> Synthesis:
        communicate = edge_tts.Communicate(text, voice_name, rate=rate, boundary="WordBoundary")
        audio = bytearray()
        words: list[WordBoundary] = []
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio += chunk["data"]
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                words.append(
                    WordBoundary(
                        text=chunk["text"],
                        start=start,
                        end=start + chunk["duration"] / TICKS_PER_SECOND,
                    )
                )
        return Synthesis(text=text, voice=voice_name, rate=rate, audio=bytes(audio), words=words)


def resolve_voice(voice: str) -> str:
    """Accept a short name ("denise") or a full Azure voice name."""
    if voice in VOICES:
        return VOICES[voice]
    if voice in VOICES.values():
        return voice
    raise ValueError(f"Unknown voice {voice!r}; expected one of {sorted(VOICES)}")


def check_rate(rate: str) -> str:
    """Return ``rate`` unchanged if it is a valid offset like "+0%" or "-25%"."""
    if not RATE_PATTERN.match(rate):
        raise ValueError(f"Bad rate {rate!r}; expected a signed percentage like '+0%' or '-25%'")
    return rate


def main() -> None:
    # Windows consoles default to cp1252, which mangles some French punctuation.
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Synthesise French text and show word timings.")
    parser.add_argument("text")
    parser.add_argument("--voice", default=DEFAULT_VOICE, help=f"one of {sorted(VOICES)}")
    parser.add_argument("--rate", default=NORMAL_RATE, help="speaking-rate offset, e.g. --rate=-25%% (with the =)")
    parser.add_argument("--out", type=Path, help="write the MP3 here")
    args = parser.parse_args()

    result = asyncio.run(EdgeTTSBackend().synthesize(args.text, args.voice, args.rate))
    print(f"{result.voice} @ {result.rate}: {len(result.audio):,} bytes")
    for word in result.words:
        print(f"  {word.start:6.3f}–{word.end:6.3f}s  {word.text}")
    if args.out:
        args.out.write_bytes(result.audio)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
