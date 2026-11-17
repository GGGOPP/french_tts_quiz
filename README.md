# French TTS Quiz

A personal French practice app for A1–A2 level, focused on grammar, listening and English → French production. Exercises are built on sentences and phrases, not single words:

- **Grammar cloze:** fill in the missing form (`Hier, elle ___ (aller) au marché.`).
- **Dictée:** hear a French sentence, type it.
- **Listen → meaning:** hear French, type the English.
- **English → French:** type the French for an English prompt.
- **Numbers & time:** hear a number, time or date, type it in digits.

All audio is generated ahead of time by a Python pipeline (edge-tts) and served as static files. Answers that can't be checked mechanically (English → French and listen → meaning) are graded by an LLM through OpenRouter, using a key stored on the device; without one, you mark yourself.

## Layout

| Path | What it is |
|---|---|
| `.ai/PLAN.md` | Build plan: steps with statuses |
| `data/` | The content: topic sentences, grammar points (rule cards and cloze drills), the LLM grader test set |
| `pipeline/` | Python (uv) build step: TTS → normal and slow MP3s + `items.json`, plus a Whisper QA check |
| `web/` | Vite + TypeScript static app, deployed to GitHub Pages |

## Status

Scaffolding. See `.ai/PLAN.md`.
