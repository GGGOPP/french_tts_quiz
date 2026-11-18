"""Generate the quiz's audio and ``items.json`` from the YAML in ``data/``.

For every item (``data.load_data()``): pick the voice (the item's ``voice``
override, else one of ``config.ITEM_VOICES``), synthesise ``Item.speech`` at the
normal and the slow rate, run each clip through ``clip.process_clip`` (trim +
loudness-normalise), and write

    web/public/audio/<id>.mp3        normal speed
    web/public/audio/<id>.slow.mp3   slow replay (config.SLOW_RATE)

Finally write ``web/public/items.json``, the file the app loads.

Clips are cached in ``pipeline/.cache/audio/`` under a hash of
(CACHE_VERSION, text, voice, rate), so a re-run only synthesises clips whose
settings changed. Fixing a bad clip is: set the item's ``tts_text`` / ``voice``
in the YAML, re-run. Bump ``CACHE_VERSION`` after changing how clips are
processed (e.g. ``clip.py`` settings) to regenerate everything.

An item whose clips fail (after the backend's own retries) is reported and left
out of ``items.json``, so the app never shows an item without audio; re-running
retries only the failed clips.

    uv run python -m french_tts.generate
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from french_tts.clip import process_clip
from french_tts.config import ITEM_VOICES, NORMAL_RATE, SLOW_RATE
from french_tts.data import BLANK_RE, DEFAULT_DATA, DataError, Dataset, Item, load_data
from french_tts.tts import EdgeTTSBackend, TTSBackend

PIPELINE_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = PIPELINE_DIR.parent
DEFAULT_WEB_PUBLIC = REPO_DIR / "web" / "public"
DEFAULT_CACHE = PIPELINE_DIR / ".cache" / "audio"

CACHE_VERSION = 1  # bump to invalidate every cached clip
ITEMS_JSON_VERSION = 1  # bump when the shape of items.json changes


def item_voice(item: Item) -> str:
    """The item's ``voice`` override, else one of ``ITEM_VOICES`` chosen from a hash of its id.

    Hashing the id (rather than alternating by position) keeps an item's voice
    stable when items are added, removed or reordered, so the cache stays valid.
    Over hundreds of items the split is close to even.
    """
    if item.voice:
        return item.voice
    digest = hashlib.sha256(item.id.encode("utf-8")).digest()
    return ITEM_VOICES[digest[0] % len(ITEM_VOICES)]


@dataclass(frozen=True)
class Clip:
    item_id: str
    text: str  # sent to the TTS engine
    voice: str
    rate: str
    file: str  # relative to web/public, e.g. "audio/resto-03.slow.mp3"

    @property
    def cache_key(self) -> str:
        payload = json.dumps([CACHE_VERSION, self.text, self.voice, self.rate], ensure_ascii=False)
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:20]


def audio_file(item_id: str, *, slow: bool = False) -> str:
    return f"audio/{item_id}.slow.mp3" if slow else f"audio/{item_id}.mp3"


def item_clips(item: Item) -> tuple[Clip, Clip]:
    """The normal and the slow clip of one item, same text and voice."""
    voice = item_voice(item)
    return (
        Clip(item.id, item.speech, voice, NORMAL_RATE, audio_file(item.id)),
        Clip(item.id, item.speech, voice, SLOW_RATE, audio_file(item.id, slow=True)),
    )


@dataclass
class Report:
    generated: list[str] = field(default_factory=list)  # clip files synthesised this run
    cached: list[str] = field(default_factory=list)  # clip files copied from the cache
    failed: dict[str, str] = field(default_factory=dict)  # item id -> first error
    removed: list[str] = field(default_factory=list)  # orphaned mp3s deleted from the output

    def ok(self, items: tuple[Item, ...] | list[Item]) -> set[str]:
        return {item.id for item in items if item.id not in self.failed}


async def generate_audio(
    items: tuple[Item, ...] | list[Item],
    backend: TTSBackend,
    audio_dir: Path,
    cache_dir: Path,
    *,
    concurrency: int = 4,
    delay: float = 0.2,
    force: bool = False,
) -> Report:
    """Make sure both clips of every item are up to date in ``audio_dir``.

    ``concurrency`` caps parallel TTS requests and each worker pauses ``delay``
    seconds after a request, to stay polite to the free edge-tts service.
    """
    audio_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    report = Report()
    semaphore = asyncio.Semaphore(concurrency)
    out = audio_dir.parent  # Clip.file is relative to web/public

    to_generate: list[Clip] = []
    for item in items:
        for clip in item_clips(item):
            cached = cache_dir / f"{clip.cache_key}.mp3"
            if cached.exists() and not force:
                _write_if_changed(out / clip.file, cached.read_bytes())
                report.cached.append(clip.file)
            else:
                to_generate.append(clip)

    done = 0

    async def one(clip: Clip) -> None:
        nonlocal done
        async with semaphore:
            try:
                synthesis = await backend.synthesize(clip.text, clip.voice, clip.rate)
                audio = await asyncio.to_thread(process_clip, synthesis.audio)
                _write_if_changed(cache_dir / f"{clip.cache_key}.mp3", audio)
                _write_if_changed(out / clip.file, audio)
                report.generated.append(clip.file)
                status = "ok"
            except Exception as exc:  # noqa: BLE001 - reported at the end, other clips carry on
                report.failed.setdefault(clip.item_id, f"{clip.rate}: {type(exc).__name__}: {exc}")
                status = "FAILED"
            done += 1
            print(f"[{done:4d}/{len(to_generate)}] {status:6s} {clip.file}  {clip.voice} {clip.rate}  {clip.text}")
            if delay:
                await asyncio.sleep(delay)

    await asyncio.gather(*(one(c) for c in to_generate))

    # Items that were deleted or renamed leave orphaned clips behind. Only the
    # top level is swept: audio/num/ (numbers mode) is managed separately.
    wanted = {Path(c.file).name for item in items for c in item_clips(item)}
    for path in sorted(audio_dir.glob("*.mp3")):
        if path.name not in wanted:
            path.unlink()
            report.removed.append(path.name)
    # A failed item must not keep a stale clip (of either speed) from an earlier run.
    for item_id in report.failed:
        for slow in (False, True):
            (out / audio_file(item_id, slow=slow)).unlink(missing_ok=True)

    return report


def cloze_parts(fr: str) -> list[str | dict[str, Any]]:
    """``"Elle {est allée|aller} au marché."`` → ``["Elle ", {answers, hint}, " au marché."]``.

    Text runs and blanks alternate, starting and ending with a (possibly empty)
    text run, so the app needs no markup parser of its own.
    """
    pieces = re.split(BLANK_RE, fr)  # odd indices are the blank bodies
    parts: list[str | dict[str, Any]] = []
    for i, piece in enumerate(pieces):
        if i % 2 == 0:
            parts.append(piece)
            continue
        answer, _, hint = piece.partition("|")
        blank: dict[str, Any] = {"answers": [a.strip() for a in answer.split("/")]}
        if hint.strip():
            blank["hint"] = hint.strip()
        parts.append(blank)
    return parts


def item_entry(item: Item) -> dict[str, Any]:
    entry: dict[str, Any] = {"id": item.id, "fr": item.text}
    if item.blanks:
        entry["cloze"] = cloze_parts(item.fr)
    entry["en"] = list(item.en)
    entry["altFr"] = list(item.alt_fr)
    entry["level"] = item.level
    if item.topic:
        entry["topic"] = item.topic
    if item.point:
        entry["point"] = item.point
    entry["grammar"] = list(item.grammar)
    for key in ("register", "explain", "notes"):
        if (value := getattr(item, key)) is not None:
            entry[key] = value
    entry["audio"] = audio_file(item.id)
    entry["audioSlow"] = audio_file(item.id, slow=True)
    return entry


def build_items_json(data: Dataset, ok_ids: set[str]) -> dict[str, Any]:
    """The app's data: every topic and grammar point (rule cards show even without
    drills), then one entry per item that has both clips, in ``load_data`` order."""
    return {
        "version": ITEMS_JSON_VERSION,
        "topics": [{"id": t.slug, "title": t.title} for t in data.topics],
        "grammarPoints": [
            {"id": p.point, "title": p.title, "level": p.level, "rule": p.rule} for p in data.points
        ],
        "items": [item_entry(item) for item in data.items if item.id in ok_ids],
    }


def _write_if_changed(path: Path, data: bytes) -> None:
    """Write ``data`` unless the file already holds exactly that (keeps git and mtimes quiet)."""
    if path.exists() and path.read_bytes() == data:
        return
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # the Windows console mangles accents

    parser = argparse.ArgumentParser(description="Generate quiz audio and items.json from data/.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--out", type=Path, default=DEFAULT_WEB_PUBLIC, help="web/public directory")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--concurrency", type=int, default=4, help="parallel TTS requests")
    parser.add_argument("--delay", type=float, default=0.2, help="pause after each request (seconds)")
    parser.add_argument("--force", action="store_true", help="ignore the cache and regenerate every clip")
    args = parser.parse_args()

    started = time.perf_counter()
    try:
        data = load_data(args.data)
    except DataError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    report = asyncio.run(
        generate_audio(
            data.items,
            EdgeTTSBackend(),
            args.out / "audio",
            args.cache,
            concurrency=args.concurrency,
            delay=args.delay,
            force=args.force,
        )
    )
    items_json = build_items_json(data, report.ok(data.items))
    out_json = args.out / "items.json"
    _write_if_changed(out_json, (json.dumps(items_json, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    voices = Counter(item_voice(item) for item in data.items)
    print(
        f"{len(data.items)} items: {len(report.generated)} clips generated, {len(report.cached)} cached, "
        f"{len(report.failed)} items failed, {len(report.removed)} orphaned clips removed "
        f"({time.perf_counter() - started:.0f}s)"
    )
    print("voices: " + ", ".join(f"{v} {n}" for v, n in voices.most_common()))
    print(f"wrote {out_json} ({len(items_json['items'])} items)")
    if report.failed:
        print("\nFailed items (left out of items.json; re-run to retry just these):")
        for item_id, error in report.failed.items():
            print(f"  {item_id}: {error}")
        sys.exit(1)


if __name__ == "__main__":
    main()
