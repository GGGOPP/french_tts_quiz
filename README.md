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

## Deployment

`.github/workflows/deploy.yml` runs the web tests, builds `web/` and publishes it to GitHub Pages on every push to `main`. Vite's base is the repo's name, so the site is served at `https://gggopp.github.io/<repo>/`. One-time setup in the repo: Settings → Pages → Source: **GitHub Actions**.

This repo belongs to the **GGGOPP** account, not the machine's global git account. A fresh clone needs the repo-local settings again:

```sh
git config user.name GGGOPP
git config user.email 357542562+GGGOPP@users.noreply.github.com
git config credential.username GGGOPP   # Git Credential Manager picks this account's token
```

## Status

Core app done (cloze, dictée, meaning and production modes, start screen, summary); LLM grading, learn mode and numbers to come. See `.ai/PLAN.md`.
