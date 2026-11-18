"""Whisper round-trip check: does each clip say the sentence it should?

Both clips of every item (``<id>.mp3`` and ``<id>.slow.mp3`` in
``web/public/audio/``) are transcribed by faster-whisper (``small``, CPU,
``language="fr"``) and compared with the item's French:

- ``ok``: equal once accents, case, punctuation, apostrophes and hyphens are
  ignored, with digits in the transcript read as French number words
  (Whisper writes ``14h30``, ``12,50 €``, ``1990`` for what the data spells out).
- ``close``: equal by sound only, the words differing in silent endings
  (parle / parlent, allé / allée / aller). Whisper has to guess these, so a
  ``close`` clip is almost always fine.
- ``mismatch``: Whisper heard different words. Listen to these first.
- ``missing``: the clip file isn't there (run ``generate``).

A flag is a prompt to listen, not proof the clip is wrong: Whisper mishears too.
And because accents are ignored it can't catch a wrong vowel quality. Fixing a
clip is the same as for ``generate``: set the item's ``tts_text`` / ``voice``
in the YAML, re-run ``generate``, then re-run this.

Writes ``qa_out/index.html``: one row per flagged item, worst first, with both
players, what Whisper heard and a word diff. Transcripts are cached in
``.cache/qa.json`` by (model, clip bytes), so a re-run only transcribes clips
that changed.

    uv run python -m french_tts.qa
    uv run python -m french_tts.qa --clips normal     # skip the slow clips (half the time)
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

import numpy as np

from french_tts.data import DEFAULT_DATA, DataError, Item, load_data
from french_tts.generate import DEFAULT_WEB_PUBLIC, PIPELINE_DIR, audio_file, item_voice

DEFAULT_MODEL = "small"
DEFAULT_TRANSCRIPT_CACHE = PIPELINE_DIR / ".cache" / "qa.json"
DEFAULT_OUT = PIPELINE_DIR / "qa_out"


# --- Transcription -----------------------------------------------------------


class Transcriber(Protocol):
    name: str  # part of the cache key: a different model means new transcripts

    def transcribe(self, path: Path) -> str: ...


class WhisperTranscriber:
    """faster-whisper on the CPU. The model (~500 MB for ``small``) downloads on first use."""

    def __init__(self, model: str = DEFAULT_MODEL) -> None:
        self.name = f"whisper-{model}"
        self._model_name = model
        self._model = None

    def transcribe(self, path: Path) -> str:
        if self._model is None:
            os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")  # harmless on Windows
            from faster_whisper import WhisperModel  # slow import; only needed for real runs

            self._model = WhisperModel(
                self._model_name, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4
            )
        segments, _info = self._model.transcribe(
            load_audio(path),
            language="fr",
            beam_size=5,
            condition_on_previous_text=False,
            without_timestamps=True,
        )
        return " ".join(s.text.strip() for s in segments).strip()


def load_audio(path: Path) -> np.ndarray:
    """Decode to 16 kHz mono float32 with ffmpeg, the input Whisper expects.

    Done here rather than by faster-whisper, whose PyAV decoder breaks with
    PyAV 19 (``open() got an unexpected keyword argument 'metadata_errors'``).
    """
    raw = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
         "-f", "s16le", "-ac", "1", "-ar", "16000", "pipe:1"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.int16).astype(np.float32) / 32768.0


# --- French numbers ----------------------------------------------------------

_UNITS = (
    "zéro un deux trois quatre cinq six sept huit neuf dix onze douze treize quatorze quinze seize"
).split()
_TENS = {2: "vingt", 3: "trente", 4: "quarante", 5: "cinquante", 6: "soixante"}


def cardinal(n: int) -> str:
    """A non-negative integer in French words, traditional spelling (soixante-dix, quatre-vingts)."""
    if n < 0:
        return "moins " + cardinal(-n)
    if n <= 16:
        return _UNITS[n]
    if n < 20:
        return "dix-" + _UNITS[n - 10]
    if n < 70:
        tens, unit = divmod(n, 10)
        if unit == 0:
            return _TENS[tens]
        return _TENS[tens] + (" et un" if unit == 1 else "-" + _UNITS[unit])
    if n < 80:
        return "soixante et onze" if n == 71 else "soixante-" + cardinal(n - 60)
    if n < 100:
        return "quatre-vingts" if n == 80 else "quatre-vingt-" + cardinal(n - 80)
    if n < 1000:
        hundreds, rest = divmod(n, 100)
        head = "cent" if hundreds == 1 else cardinal(hundreds) + " cent"
        if rest == 0:
            return head + ("s" if hundreds > 1 else "")
        return head + " " + cardinal(rest)
    for size, word in ((1_000_000_000, "milliard"), (1_000_000, "million")):
        if n >= size:
            count, rest = divmod(n, size)
            head = f"{_multiplier(count)} {word}" + ("s" if count > 1 else "")
            return head + (" " + cardinal(rest) if rest else "")
    thousands, rest = divmod(n, 1000)
    head = "mille" if thousands == 1 else _multiplier(thousands) + " mille"
    return head + (" " + cardinal(rest) if rest else "")


def _multiplier(n: int) -> str:
    """Before mille/million, vingts and cents lose their s (quatre-vingt mille, deux cent mille)."""
    words = cardinal(n)
    return words[:-1] if words.endswith(("vingts", "cents")) else words


def ordinal(n: int) -> str:
    if n == 1:
        return "premier"
    words = cardinal(n)
    if words.endswith("cinq"):
        return words + "uième"
    if words.endswith("neuf"):
        return words[:-1] + "vième"
    return (words[:-1] if words.endswith("e") else words) + "ième"


def _hour(n: int) -> str:
    """Heure is feminine: une heure, vingt et une heures."""
    words = cardinal(n)
    return (words[:-2] + "une" if words.endswith("un") else words) + (" heure" if n <= 1 else " heures")


_NUMBER_PATTERNS: list[tuple[re.Pattern[str], object]] = [
    # thousands written with a space: "1 995" (normal, no-break or narrow no-break space)
    (re.compile(r"(?<=\d)[   ](?=\d{3}\b)"), ""),
    # times: 14h30, 8 h, 19 h 30
    (re.compile(r"\b(\d{1,2}) ?h(?: ?(\d{2}))?\b"),
     lambda m: _hour(int(m[1])) + (" " + cardinal(int(m[2])) if m[2] and int(m[2]) else "")),
    # prices: 12,50 €, 12,50 euros, 3 €
    (re.compile(r"\b(\d+),(\d{2}) ?(?:€|euros?\b)"),
     lambda m: f"{cardinal(int(m[1]))} euros {cardinal(int(m[2]))}"),
    (re.compile(r"\b(\d+) ?€"), lambda m: f"{cardinal(int(m[1]))} euros"),
    # 38,5 is how the data says "trente-huit et demi"; other decimals use virgule
    (re.compile(r"\b(\d+),5\b"), lambda m: f"{cardinal(int(m[1]))} et demi"),
    (re.compile(r"\b(\d+),(\d+)\b"), lambda m: f"{cardinal(int(m[1]))} virgule {cardinal(int(m[2]))}"),
    (re.compile(r"\b(\d+) ?%"), lambda m: f"{cardinal(int(m[1]))} pour cent"),
    # ordinals: 1er, 1re, 2e, 3ème
    (re.compile(r"\b1(?:er|re|ère)\b"), lambda m: "premier"),
    (re.compile(r"\b(\d+)(?:e|ème|eme)\b"), lambda m: ordinal(int(m[1]))),
    (re.compile(r"\d+"), lambda m: cardinal(int(m[0]))),
]


def spell_numbers(text: str) -> str:
    """Replace the digits in a transcript with French words, the way the data writes them."""
    for pattern, replacement in _NUMBER_PATTERNS:
        text = pattern.sub(replacement, text)  # type: ignore[arg-type]
    return text


# --- Comparison --------------------------------------------------------------


def normalise(text: str) -> str:
    """Numbers spelt out; accents, case, punctuation, apostrophes and hyphens dropped."""
    text = spell_numbers(text)
    decomposed = unicodedata.normalize("NFD", text)
    bare = "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()
    bare = bare.replace("œ", "oe").replace("æ", "ae")
    words = " ".join(re.sub(r"[^\w]|_", " ", bare).split())
    # Whisper writes "huit heures et quart" as 8h15, which spells back as "quinze".
    words = re.sub(r"\b(heures?) et quart\b", r"\1 quinze", words)
    return re.sub(r"\b(heures?) et demie?\b", r"\1 trente", words)


# Written endings that sound alike (all silent, or all [e]): parle/parles/parlent,
# allé/allée/allés/aller/allez (accents are already gone: allee, alles). Longest
# first. The (?<=..) keeps short words (et, es, le, ce) whole, so "et" and "est"
# still differ.
_SILENT_ENDING = re.compile(r"(?<=..)(?:ees|ent|ee|es|er|ez|e|s|x|t|d)$")


def _strip_silent(word: str) -> str:
    """Repeatedly, so "partent" and "part" both end up as "par"."""
    while (shorter := _SILENT_ENDING.sub("", word)) != word:
        word = shorter
    return word


def sound_key(text: str) -> str:
    """``normalise`` plus: silent or [e]-sounding endings dropped, then spaces and double letters."""
    words = [_strip_silent(w) for w in normalise(text).split()]
    return re.sub(r"(.)\1", r"\1", "".join(words))


Verdict = Literal["ok", "close", "mismatch", "missing"]
SEVERITY: dict[Verdict, int] = {"missing": 0, "mismatch": 1, "close": 2, "ok": 3}


def compare(expected: list[str], heard: str) -> tuple[Verdict, float]:
    """Compare a transcript with the expected texts (the item's French, and its tts_text if any).

    Returns the verdict and the similarity (0..1) of the normalised texts.
    """
    got = normalise(heard)
    targets = [normalise(e) for e in expected]
    # Spaces are ignored too: Whisper writes "weekend", "email" for week-end, e-mail.
    if got.replace(" ", "") in {t.replace(" ", "") for t in targets}:
        return "ok", 1.0
    similarity = max(difflib.SequenceMatcher(None, t, got).ratio() for t in targets) if got else 0.0
    if got and sound_key(heard) in {sound_key(e) for e in expected}:
        return "close", round(similarity, 2)
    return "mismatch", round(similarity, 2)


def word_diff(expected: str, heard: str) -> list[tuple[str, str]]:
    """The normalised words of both texts as (op, word) runs: op is "=", "-" (not heard) or "+" (extra)."""
    a, b = normalise(expected).split(), normalise(heard).split()
    out: list[tuple[str, str]] = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            out.append(("=", " ".join(a[i1:i2])))
            continue
        if i2 > i1:
            out.append(("-", " ".join(a[i1:i2])))
        if j2 > j1:
            out.append(("+", " ".join(b[j1:j2])))
    return out


# --- Checking ----------------------------------------------------------------


@dataclass(frozen=True)
class ClipCheck:
    file: str  # relative to web/public, e.g. "audio/resto-03.slow.mp3"
    slow: bool
    heard: str | None  # None: the clip is missing
    verdict: Verdict
    similarity: float


@dataclass(frozen=True)
class ItemCheck:
    item: Item
    clips: tuple[ClipCheck, ...]  # normal first, then slow (whichever were checked)

    @property
    def verdict(self) -> Verdict:
        return min((c.verdict for c in self.clips), key=SEVERITY.__getitem__)

    @property
    def similarity(self) -> float:
        return min(c.similarity for c in self.clips)

    @property
    def ok(self) -> bool:
        return self.verdict == "ok"


def expected_texts(item: Item) -> list[str]:
    """What the clip should say: the displayed French, and the spoken override if it has one."""
    return [item.text] + ([item.tts_text] if item.tts_text and item.tts_text != item.text else [])


def check(
    items: tuple[Item, ...] | list[Item],
    public_dir: Path,
    transcriber: Transcriber,
    cache_path: Path,
    *,
    speeds: tuple[bool, ...] = (False, True),
) -> list[ItemCheck]:
    """Transcribe each item's clips (cached by model + clip bytes) and compare them.

    ``speeds`` picks the clips: False is the normal one, True the slow one.
    """
    cache: dict[str, str] = json.loads(cache_path.read_text(encoding="utf-8")) if cache_path.exists() else {}
    results = []
    new = 0
    try:
        for n, item in enumerate(items, start=1):
            expected = expected_texts(item)
            clips = []
            for slow in speeds:
                rel = audio_file(item.id, slow=slow)
                path = public_dir / rel
                if not path.exists():
                    clips.append(ClipCheck(rel, slow, None, "missing", 0.0))
                    continue
                key = f"{transcriber.name}:{hashlib.sha256(path.read_bytes()).hexdigest()[:20]}"
                if key not in cache:
                    cache[key] = transcriber.transcribe(path)
                    new += 1
                    print(f"[{n:3d}/{len(items)}] {Path(rel).name:22s} {cache[key]}", flush=True)
                    if new % 50 == 0:  # checkpoint, so a long run that is stopped keeps its work
                        _save(cache_path, cache)
                clips.append(ClipCheck(rel, slow, cache[key], *compare(expected, cache[key])))
            results.append(ItemCheck(item, tuple(clips)))
    finally:  # keep finished transcripts even if interrupted
        if new:
            _save(cache_path, cache)
    return results


def _save(cache_path: Path, cache: dict[str, str]) -> None:
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = cache_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    tmp.replace(cache_path)


def flagged(results: list[ItemCheck]) -> list[ItemCheck]:
    """Every item not ok: missing, then mismatch, then close; each worst first."""
    return sorted((r for r in results if not r.ok), key=lambda r: (SEVERITY[r.verdict], r.similarity))


def summarise(flags: list[ItemCheck]) -> str:
    counts = {v: sum(r.verdict == v for r in flags) for v in ("missing", "mismatch", "close")}
    return ", ".join(f"{n} {v}" for v, n in counts.items() if n) or "none"


# --- Report page -------------------------------------------------------------

HEADINGS: dict[Verdict, str] = {
    "missing": "Missing clips: run generate",
    "mismatch": "Mismatches: Whisper heard different words. Listen to these first",
    "close": "Close: only silent endings differ (parle / parlent, allé / allée). Usually Whisper guessing",
}


def _diff_html(expected: str, heard: str) -> str:
    tags = {"=": "span", "-": "del", "+": "ins"}
    return " ".join(f"<{tags[op]}>{html.escape(words)}</{tags[op]}>" for op, words in word_diff(expected, heard))


def build_page(results: list[ItemCheck], public_dir: Path, out_dir: Path) -> str:
    flags = flagged(results)
    esc = html.escape
    rows = []
    previous = None
    for r in flags:
        if r.verdict != previous:
            rows.append(f'<tr class="group"><th colspan="4">{esc(HEADINGS[r.verdict])}</th></tr>')
            previous = r.verdict
        item = r.item
        sent = f"{item_voice(item)}"
        if item.tts_text:
            sent += f" · tts_text: {item.tts_text}"
        clips = []
        for c in r.clips:
            label = "slow" if c.slow else "normal"
            if c.heard is None:
                clips.append(f'<div class="clip"><b>{label}</b> <span class="missing">no clip</span></div>')
                continue
            src = Path(os.path.relpath(public_dir / c.file, out_dir)).as_posix()
            detail = (
                '<span class="same">heard as expected</span>' if c.verdict == "ok"
                else f'<span class="heard">{esc(c.heard)}</span><span class="diff">{_diff_html(item.text, c.heard)}</span>'
            )
            clips.append(
                f'<div class="clip v-{c.verdict}"><b>{label}</b> <span class="score">{c.similarity:.0%}</span>'
                f'<audio controls preload="none" src="{esc(src)}"></audio>{detail}</div>'
            )
        rows.append(
            f'<tr><td class="id">{esc(item.id)}<span class="meta">{esc(item.source)}</span></td>'
            f'<td><span class="fr">{esc(item.text)}</span><span class="en">{esc(item.en[0])}</span></td>'
            f'<td>{"".join(clips)}</td><td class="meta">{esc(sent)}</td></tr>'
        )
    n_clips = sum(len(r.clips) for r in results)
    summary = f"{len(flags)} of {len(results)} items flagged ({summarise(flags)}), from {n_clips} clips"
    body = (
        "<table><thead><tr><th>id</th><th>Expected</th><th>Clips: what Whisper heard</th><th>Voice</th></tr></thead>"
        f"<tbody>\n{chr(10).join(rows)}\n</tbody></table>"
        if flags else "<p>Nothing flagged.</p>"
    )
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Audio QA</title>
<style>
  :root {{ color-scheme: light dark; font: 15px/1.4 system-ui, 'Segoe UI', sans-serif; }}
  body {{ margin: 0; padding: 1.5rem 1rem; }}
  h1 {{ margin: 0 0 .25rem; font-size: 1.4rem; }}
  p {{ margin: 0 0 1rem; max-width: 52rem; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #8884; padding: .4rem .5rem; text-align: left; vertical-align: top; }}
  thead th {{ position: sticky; top: 0; background: Canvas; z-index: 1; }}
  .fr {{ display: block; font-size: 1.05rem; }}
  .en, .meta {{ display: block; font-size: .85rem; opacity: .7; }}
  .id {{ font-size: .85rem; white-space: nowrap; }}
  .clip {{ display: grid; grid-template-columns: 4rem 3rem auto; gap: .1rem .5rem; align-items: center; }}
  .clip + .clip {{ margin-top: .4rem; }}
  .clip .heard, .clip .diff, .clip .same {{ grid-column: 1 / -1; }}
  .clip .heard {{ font-size: .95rem; }}
  .clip .same {{ font-size: .85rem; opacity: .7; }}
  .diff {{ font-size: .85rem; opacity: .85; }}
  del {{ color: #c33; }}
  ins {{ color: #2a7; text-decoration: none; font-weight: 600; }}
  .score {{ font-size: .85rem; opacity: .75; }}
  .missing {{ color: #c33; }}
  audio {{ height: 2rem; width: 13rem; }}
  tbody tr:nth-child(odd) {{ background: #8881; }}
  tr.group th {{ background: Canvas; padding-top: 1rem; font-size: 1rem; }}
</style>
</head>
<body>
<h1>Audio QA</h1>
<p>{summary}, worst first in each group. Whisper's transcript is compared with the item's French
with accents, case, punctuation, apostrophes and hyphens ignored, and digits read as French words
(14h30 = quatorze heures trente). In the diff, <del>red</del> words weren't heard and <ins>green</ins>
ones were heard instead. A flag means "listen to this", not "this is wrong": Whisper mishears too, and
it can't catch a wrong vowel. To fix a clip, set the item's <code>tts_text</code> or <code>voice</code>
in its YAML file and re-run <code>generate</code>, then this check.</p>
{body}
<script>
  document.addEventListener('play', (e) => {{
    for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause();
  }}, true);
</script>
</body>
</html>
"""


def main() -> None:
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]  # the Windows console mangles accents

    parser = argparse.ArgumentParser(description="Flag clips whose Whisper transcript doesn't match the item.")
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--public", type=Path, default=DEFAULT_WEB_PUBLIC, help="web/public directory")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="where to write index.html")
    parser.add_argument("--cache", type=Path, default=DEFAULT_TRANSCRIPT_CACHE)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="faster-whisper model size")
    parser.add_argument("--clips", choices=("both", "normal", "slow"), default="both")
    args = parser.parse_args()

    started = time.perf_counter()
    try:
        data = load_data(args.data)
    except DataError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    speeds = {"both": (False, True), "normal": (False,), "slow": (True,)}[args.clips]
    results = check(data.items, args.public, WhisperTranscriber(args.model), args.cache, speeds=speeds)
    flags = flagged(results)

    args.out.mkdir(parents=True, exist_ok=True)
    page = args.out / "index.html"
    page.write_text(build_page(results, args.public, args.out), encoding="utf-8")

    print(f"\n{len(flags)} of {len(results)} items flagged: {summarise(flags)} ({time.perf_counter() - started:.0f}s)")
    for r in flags:
        heard = " | ".join("(no clip)" if c.heard is None else c.heard for c in r.clips if not c.verdict == "ok")
        print(f"  {r.verdict:8s} {r.similarity:4.0%}  {r.item.id:9s} {r.item.text}  →  {heard}")
    print(f"listen: open {page}")


if __name__ == "__main__":
    main()
