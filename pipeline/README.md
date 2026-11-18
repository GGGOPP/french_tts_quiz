# french-tts pipeline

An offline build step that takes the French items in `../data/` and turns them into audio for the app:

- It generates two clips per item with edge-tts, one at normal speed and one slow.
- It clips and normalises the audio with ffmpeg.
- It writes the MP3s and `items.json` into `../web/public/`.
- It runs a Whisper check that flags bad clips.

## Setup

You need [uv](https://docs.astral.sh/uv/) and `ffmpeg` on PATH. uv installs Python 3.12 and the dependencies:

```sh
cd pipeline
uv sync
```

Run a module with `uv run python -m french_tts.<module>`. Modules are added to this table as they are built.

| Module | What it does |
|---|---|
| `config` | Defaults chosen at the bake-off: items alternate between **denise** and **henri**, the normal rate is `+0%` and the slow rate is `-25%`. An item's `voice` override in the YAML takes precedence. |
| `tts` | The TTS backend interface and its edge-tts implementation. It returns MP3 bytes and per-word timings in seconds. `rate` is a signed percentage (`-25%` is 25% slower). The voices are `denise`, `eloise` and `vivienne` (female) and `henri` and `remy` (male). Try it: `uv run python -m french_tts.tts "Je voudrais un café." --voice henri --rate=-25% --out sample.mp3`. The `=` is needed: without it, argparse reads `-25%` as a flag. |
| `clip` | Post-processing with ffmpeg. It can cut at a timestamp, keeping a 40 ms lead-in and a click-free fade. It trims trailing silence, keeping 150 ms. It normalises loudness to -18 LUFS in two passes. Try it: `uv run python -m french_tts.clip in.mp3 out.mp3`. |
| `bakeoff` | Renders 22 sentences that are hard for French TTS (liaison, elision, silent `-ent`, `plus`/`tous`, 70–99, digits) in each voice at each rate, through `process_clip`. It writes `bakeoff_out/index.html`, a table of players with clip lengths and a per-column total. The defaults are denise, henri, vivienne and remy at `+0%` and `-25%`. Override them with `--voices=denise,henri --rates=+0%,-20%,-30%`. |

## Tests

```sh
uv run pytest
```

The tests need no network: edge-tts is replaced by a fake, and the clip tests use synthetic tones from ffmpeg.
