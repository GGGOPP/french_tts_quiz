"""Bake-off: render tricky French sentences in every voice and rate, side by side.

Writes ``bakeoff_out/index.html`` (a table of audio players, one row per
sentence, one column per voice × rate) plus the clips in ``bakeoff_out/audio/``.
Every clip goes through ``process_clip`` (trim + loudness-normalise), exactly as
the real pipeline will, so voices are compared at the same volume.
Open the page in a browser, listen, and pick the voices and the slow rate
(plan step 5).

    uv run python -m french_tts.bakeoff
    uv run python -m french_tts.bakeoff --voices=denise,henri --rates=+0%,-20%,-30%

(``--rates=…`` needs the ``=``: argparse would read a bare ``-20%`` as a flag.)
"""

from __future__ import annotations

import argparse
import asyncio
import html
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from french_tts.clip import duration, process_clip
from french_tts.config import NORMAL_RATE, SLOW_RATE
from french_tts.tts import VOICES, EdgeTTSBackend, TTSBackend, check_rate

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "bakeoff_out"

# Eloise is left out: Azure lists fr-FR-EloiseNeural as a child voice.
BAKEOFF_VOICES: tuple[str, ...] = ("denise", "henri", "vivienne", "remy")
BAKEOFF_RATES: tuple[str, ...] = (NORMAL_RATE, SLOW_RATE)

VOICE_NOTES: dict[str, str] = {
    "denise": "female",
    "eloise": "female, child",
    "henri": "male",
    "remy": "male, multilingual",
    "vivienne": "female, multilingual",
}


@dataclass(frozen=True)
class Item:
    french: str
    english: str
    why: str  # what makes it a hard case for TTS (‿ marks a liaison, | marks none)


ITEMS: list[Item] = [
    Item("Les amis arrivent ce soir.", "The friends are arriving this evening.",
         "liaison les‿amis [z]; silent -ent in arrivent"),
    Item("Ils ont deux enfants.", "They have two children.",
         "ils‿ont [z] (vs ils sont [s]); deux‿enfants [z]"),
    Item("Ils sont en retard.", "They are late.",
         "ils sont [s], the pair of ils‿ont"),
    Item("Elles aiment le chocolat.", "They like chocolate.",
         "elles‿aiment [z]; silent -ent"),
    Item("Souvent, ils dînent ensemble.", "They often have dinner together.",
         "-ent spoken in souvent, silent in dînent"),
    Item("Nous avons un grand appartement.", "We have a big flat.",
         "nous‿avons [z]; grand‿appartement [t]"),
    Item("C'est un petit hôtel.", "It's a small hotel.",
         "elision c'; c'est‿un [t]; petit‿hôtel [t] (mute h)"),
    Item("Je mange des haricots.", "I'm eating green beans.",
         "aspirated h: des | haricots, no liaison"),
    Item("J'habite à Lyon depuis l'année dernière.", "I've lived in Lyon since last year.",
         "elision j', l'; mute h in habite"),
    Item("Est-ce que tu as faim ?", "Are you hungry?",
         "est-ce que question; [ɛs kə]"),
    Item("Qu'est-ce que vous faites ce week-end ?", "What are you doing this weekend?",
         "qu'est-ce que; vous faites; English loanword"),
    Item("Vous êtes français ?", "Are you French?",
         "vous‿êtes [z]; rising intonation, no question word"),
    Item("Il n'y a plus de pain.", "There's no more bread.",
         "negative plus: s silent [ply]"),
    Item("En plus, il fait froid.", "What's more, it's cold.",
         "en plus: s spoken [plys]"),
    Item("Ils sont tous là.", "They're all here.",
         "pronoun tous: s spoken [tus]"),
    Item("J'achète six œufs et dix pommes.", "I'm buying six eggs and ten apples.",
         "six‿œufs [z]; dix pommes, x silent"),
    Item("Il a soixante-dix-sept ans.", "He is seventy-seven.",
         "70s: soixante-dix-sept; sept‿ans [t]"),
    Item("Ça fait quatre-vingt-dix-neuf euros.", "That's ninety-nine euros.",
         "90s; neuf euros [f] (not [v] as in neuf ans)"),
    Item("Le train part à vingt et une heures.", "The train leaves at 9 pm.",
         "vingt‿et [t]; une‿heure"),
    Item("Le magasin ferme à 19 h 30.", "The shop closes at 7:30 pm.",
         "digits: does the voice read « dix-neuf heures trente »?"),
    Item("Je suis né en 1995.", "I was born in 1995.",
         "a year in digits: « mille neuf cent quatre-vingt-quinze »"),
    Item("Tu peux répéter, s'il te plaît ?", "Can you say that again, please?",
         "s'il te plaît; question intonation"),
]


@dataclass(frozen=True)
class Cell:
    item_index: int
    voice: str
    rate: str
    file: str | None  # path relative to the page, None if rendering failed
    seconds: float | None
    error: str | None


def rate_slug(rate: str) -> str:
    """File-name-safe form of a rate: "+0%" → "p0", "-25%" → "m25"."""
    check_rate(rate)
    return ("p" if rate[0] == "+" else "m") + rate[1:-1]


def cell_file(item_index: int, voice: str, rate: str) -> str:
    return f"audio/{item_index + 1:02d}_{voice}_{rate_slug(rate)}.mp3"


async def run_bakeoff(
    backend: TTSBackend,
    items: list[Item],
    voices: list[str],
    rates: list[str],
    out_dir: Path,
    concurrency: int = 4,
) -> list[Cell]:
    """Render every item × voice × rate into ``out_dir/audio``.

    A failure in one cell is recorded on the page rather than aborting the run.
    """
    (out_dir / "audio").mkdir(parents=True, exist_ok=True)
    for stale in (out_dir / "audio").glob("*.mp3"):
        stale.unlink()
    semaphore = asyncio.Semaphore(concurrency)
    jobs = [(i, v, r) for i in range(len(items)) for v in voices for r in rates]
    done = 0

    async def one(i: int, voice: str, rate: str) -> Cell:
        nonlocal done
        text = items[i].french
        async with semaphore:
            try:
                synthesis = await backend.synthesize(text, voice, rate)
                audio = await asyncio.to_thread(process_clip, synthesis.audio)
                rel = cell_file(i, voice, rate)
                (out_dir / rel).write_bytes(audio)
                seconds = await asyncio.to_thread(duration, audio)
                cell = Cell(i, voice, rate, rel, seconds, None)
            except Exception as exc:  # noqa: BLE001 - shown on the page instead
                cell = Cell(i, voice, rate, None, None, f"{type(exc).__name__}: {exc}")
        done += 1
        status = "FAILED" if cell.error else "ok"
        print(f"[{done:3d}/{len(jobs)}] {status:6s} {text} · {voice} · {rate}")
        return cell

    return await asyncio.gather(*(one(i, v, r) for i, v, r in jobs))


def build_page(items: list[Item], cells: list[Cell], voices: list[str], rates: list[str]) -> str:
    by_key = {(c.item_index, c.voice, c.rate): c for c in cells}
    columns = [(v, r) for v in voices for r in rates]
    esc = html.escape

    def rate_label(rate: str) -> str:
        if rate == NORMAL_RATE:
            return f"normal {rate}"
        if rate == SLOW_RATE:
            return f"slow {rate}"
        return rate

    head_voices = "".join(
        f'<th colspan="{len(rates)}" class="voice">{esc(v)}'
        f'<span class="note">{esc(VOICE_NOTES.get(v, ""))}</span></th>'
        for v in voices
    )
    head_rates = "".join(f"<th>{esc(rate_label(r))}</th>" for _v, r in columns)

    rows = []
    for i, item in enumerate(items):
        tds = []
        for v, r in columns:
            cell = by_key.get((i, v, r))
            if cell is None:
                tds.append("<td></td>")
            elif cell.file is None:
                tds.append(f'<td class="error">{esc(cell.error or "")}</td>')
            else:
                tds.append(
                    f'<td><audio controls preload="none" src="{esc(cell.file)}"></audio>'
                    f'<span class="secs">{cell.seconds:.2f}s</span></td>'
                )
        rows.append(
            f'<tr><th class="item"><span class="fr" lang="fr">{esc(item.french)}</span>'
            f'<span class="en">{esc(item.english)}</span>'
            f'<span class="why">{esc(item.why)}</span></th>{"".join(tds)}</tr>'
        )

    # Total spoken time per column: compares pace across voices and how much
    # slower each rate really is.
    totals = []
    for v, r in columns:
        secs = [c.seconds for c in cells if c.voice == v and c.rate == r and c.seconds is not None]
        totals.append(f"<td>{sum(secs):.1f}s</td>" if secs else "<td></td>")

    failures = sum(1 for c in cells if c.error)
    summary = f"{len(items)} sentences × {len(voices)} voices × {len(rates)} rates"
    if failures:
        summary += f" · <strong>{failures} failed</strong>"

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TTS bake-off</title>
<link rel="icon" href="data:,">
<style>
  :root {{ color-scheme: light dark; font: 15px/1.4 system-ui, 'Segoe UI', sans-serif; }}
  body {{ margin: 0; padding: 1.5rem 1rem; }}
  h1 {{ margin: 0 0 .25rem; font-size: 1.4rem; }}
  p {{ margin: 0 0 1rem; max-width: 50rem; }}
  .wrap {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; }}
  th, td {{ border: 1px solid #8884; padding: .4rem .5rem; vertical-align: middle; }}
  thead th {{ position: sticky; top: 0; background: Canvas; }}
  th.voice {{ text-transform: capitalize; }}
  .note {{ display: block; font-weight: normal; font-size: .8rem; opacity: .7; text-transform: none; }}
  th.item {{ text-align: left; min-width: 15rem; max-width: 20rem; }}
  .fr {{ display: block; font-size: 1.1rem; }}
  .en, .why {{ display: block; font-weight: normal; font-size: .85rem; opacity: .75; }}
  .why {{ font-style: italic; }}
  td {{ white-space: nowrap; }}
  audio {{ height: 2rem; width: 11rem; vertical-align: middle; }}
  .secs {{ font-size: .8rem; opacity: .7; margin-left: .3rem; }}
  td.error {{ color: #c33; white-space: normal; max-width: 14rem; font-size: .8rem; }}
  tbody tr:nth-child(odd) {{ background: #8881; }}
  tfoot td, tfoot th {{ font-size: .85rem; opacity: .8; }}
</style>
</head>
<body>
<h1>TTS bake-off</h1>
<p>{summary}. Each clip is trimmed and loudness-normalised the same way the app's clips will be.
In the notes, ‿ marks a liaison that should be heard and | marks one that must not be.
Listen for wrong liaisons, spoken <i>-ent</i> endings, numbers, and whether the slow rate
stays natural. Starting one player stops the others.</p>
<div class="wrap">
<table>
<thead>
<tr><th rowspan="2">Sentence</th>{head_voices}</tr>
<tr>{head_rates}</tr>
</thead>
<tbody>
{chr(10).join(rows)}
</tbody>
<tfoot>
<tr><th>Total spoken time</th>{"".join(totals)}</tr>
</tfoot>
</table>
</div>
<script>
  // Only one clip plays at a time, so quick comparisons don't overlap.
  document.addEventListener('play', (e) => {{
    for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause();
  }}, true);
</script>
</body>
</html>
"""


def _voice_list(value: str) -> list[str]:
    voices = [v.strip() for v in value.split(",") if v.strip()]
    unknown = [v for v in voices if v not in VOICES]
    if unknown:
        raise argparse.ArgumentTypeError(f"unknown voice(s) {unknown}; use short names from {sorted(VOICES)}")
    return voices


def _rate_list(value: str) -> list[str]:
    return [check_rate(r.strip()) for r in value.split(",") if r.strip()]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[union-attr]

    parser = argparse.ArgumentParser(description="Render the TTS comparison page.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--concurrency", type=int, default=4, help="parallel TTS requests")
    parser.add_argument(
        "--voices", type=_voice_list, default=list(BAKEOFF_VOICES),
        help=f"comma-separated, from {sorted(VOICES)} (default: {','.join(BAKEOFF_VOICES)})",
    )
    parser.add_argument(
        "--rates", type=_rate_list, default=list(BAKEOFF_RATES),
        help=f"comma-separated, with the = (default: --rates={','.join(BAKEOFF_RATES)})",
    )
    args = parser.parse_args()

    started = time.perf_counter()
    cells = asyncio.run(
        run_bakeoff(EdgeTTSBackend(), ITEMS, args.voices, args.rates, args.out, args.concurrency)
    )
    page = args.out / "index.html"
    page.write_text(build_page(ITEMS, cells, args.voices, args.rates), encoding="utf-8")
    failures = sum(1 for c in cells if c.error)
    print(f"{len(cells) - failures}/{len(cells)} clips in {time.perf_counter() - started:.0f}s")
    print(f"open {page}")


if __name__ == "__main__":
    main()
