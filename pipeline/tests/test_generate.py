"""generate.py: voices, caching, overrides, failures, orphans and items.json (no network)."""

import asyncio
import copy
import json
from collections import Counter
from dataclasses import replace

import pytest
import yaml

from french_tts.config import ITEM_VOICES, NORMAL_RATE, SLOW_RATE
from french_tts.data import load_data
from french_tts.generate import (
    build_items_json,
    cloze_parts,
    generate_audio,
    item_clips,
    item_voice,
)
from french_tts.tts import Synthesis, WordBoundary

TOPIC = {
    "topic": "Café & restaurant",
    "items": [
        {
            "id": "resto-01",
            "fr": "Je voudrais un café, s'il vous plaît.",
            "en": ["I would like a coffee, please."],
            "alt_fr": ["Je voudrais un café, s'il te plaît."],
            "level": "A1",
            "grammar": ["passe-compose-etre"],
            "register": "formal",
            "notes": "Polite request.",
        },
        {"id": "resto-02", "fr": "L'addition, s'il vous plaît.", "en": ["The bill, please."], "level": "A1", "voice": "henri"},
    ],
}

GRAMMAR = {
    "point": "passe-compose-etre",
    "title": "Passé composé with être",
    "level": "A2",
    "rule": "Verbs of movement take être.\n",
    "items": [
        {
            "id": "pce-01",
            "fr": "Hier, elle {est allée|aller} au marché.",
            "en": ["Yesterday she went to the market."],
            "explain": "aller takes être; feminine subject → allée",
        },
        {
            "id": "pce-02",
            "fr": "Ils {sont arrivés/sont venus|arriver} {hier}.",
            "en": ["They arrived yesterday."],
            "explain": "Plural subject → -s.",
            "tts_text": "Ils sont arrivés hier !",
        },
    ],
}

IDS = ["resto-01", "resto-02", "pce-01", "pce-02"]


class RecordingBackend:
    """Returns a tone and records every call; text containing ``fail_text`` at ``fail_rate`` raises."""

    def __init__(self, audio: bytes, fail_text: str | None = None, fail_rate: str | None = None) -> None:
        self.audio = audio
        self.fail_text = fail_text
        self.fail_rate = fail_rate
        self.calls: list[tuple[str, str, str]] = []

    async def synthesize(self, text: str, voice: str, rate: str = NORMAL_RATE) -> Synthesis:
        self.calls.append((text, voice, rate))
        if self.fail_text and self.fail_text in text and self.fail_rate in (None, rate):
            raise RuntimeError("service unavailable")
        words = [WordBoundary(w, 0.3 * n, 0.3 * n + 0.2) for n, w in enumerate(text.split())]
        return Synthesis(text=text, voice=voice, rate=rate, audio=self.audio, words=words)


@pytest.fixture(scope="module")
def tone(make_mp3) -> bytes:
    return make_mp3("if(between(t,0.1,1.0),0.3*sin(2*PI*440*t),0)", 1.5)


@pytest.fixture
def make_data(tmp_path):
    """Write TOPIC and GRAMMAR (optionally edited) under tmp_path/data and load them."""

    def build(topic_edit=None, grammar_edit=None):
        topic, grammar = copy.deepcopy(TOPIC), copy.deepcopy(GRAMMAR)
        if topic_edit:
            topic_edit(topic)
        if grammar_edit:
            grammar_edit(grammar)
        root = tmp_path / "data"
        for rel, body in (("topics/restaurant.yaml", topic), ("grammar/passe-compose-etre.yaml", grammar)):
            path = root / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(yaml.safe_dump(body, allow_unicode=True, sort_keys=False), encoding="utf-8")
        return load_data(root)

    return build


def run(items, backend, tmp_path, **kwargs):
    return asyncio.run(
        generate_audio(items, backend, tmp_path / "public" / "audio", tmp_path / "cache", delay=0, **kwargs)
    )


def audio_names(tmp_path):
    return sorted(p.name for p in (tmp_path / "public" / "audio").iterdir())


def test_item_voice_is_stable_balanced_and_overridable(make_data):
    data = make_data()
    by_id = {item.id: item for item in data.items}
    assert item_voice(by_id["resto-02"]) == "henri"  # the YAML override wins
    assert item_voice(by_id["resto-01"]) in ITEM_VOICES
    assert item_voice(by_id["resto-01"]) == item_voice(by_id["resto-01"])

    # Over many ids both voices get a fair share.
    fake = [replace(by_id["resto-01"], id=f"x-{n}") for n in range(400)]
    counts = Counter(item_voice(item) for item in fake)
    assert set(counts) == set(ITEM_VOICES)
    assert min(counts.values()) > 150


def test_item_clips_share_text_and_voice_and_differ_in_rate(make_data):
    pce02 = {i.id: i for i in make_data().items}["pce-02"]
    normal, slow = item_clips(pce02)
    assert (normal.rate, slow.rate) == (NORMAL_RATE, SLOW_RATE)
    assert normal.text == slow.text == "Ils sont arrivés hier !"  # tts_text is what gets spoken
    assert normal.voice == slow.voice
    assert (normal.file, slow.file) == ("audio/pce-02.mp3", "audio/pce-02.slow.mp3")
    assert normal.cache_key != slow.cache_key


def test_generates_both_clips_per_item_then_uses_the_cache(make_data, tmp_path, tone):
    data = make_data()
    backend = RecordingBackend(tone)

    first = run(data.items, backend, tmp_path)
    assert len(first.generated) == 8 and not first.failed
    assert audio_names(tmp_path) == sorted(f"{i}{suffix}" for i in IDS for suffix in (".mp3", ".slow.mp3"))
    for name in audio_names(tmp_path):
        assert (tmp_path / "public" / "audio" / name).stat().st_size > 0
    # Spoken text has the blanks filled in; overrides reach the backend.
    assert ("Hier, elle est allée au marché.", item_voice(data.items[2]), SLOW_RATE) in backend.calls
    assert ("L'addition, s'il vous plaît.", "henri", NORMAL_RATE) in backend.calls

    backend.calls.clear()
    second = run(data.items, backend, tmp_path)
    assert backend.calls == []
    assert len(second.cached) == 8 and not second.generated

    forced = run(data.items, backend, tmp_path, force=True)
    assert len(backend.calls) == 8 and len(forced.generated) == 8


def test_changing_an_item_regenerates_only_its_clips(make_data, tmp_path, tone):
    backend = RecordingBackend(tone)
    run(make_data().items, backend, tmp_path)
    backend.calls.clear()

    def retext(topic):
        topic["items"][0]["tts_text"] = "Je voudrais un café, s'il vous plaît !"

    report = run(make_data(topic_edit=retext).items, backend, tmp_path)

    assert sorted(report.generated) == ["audio/resto-01.mp3", "audio/resto-01.slow.mp3"]
    assert {(text, rate) for text, _, rate in backend.calls} == {
        ("Je voudrais un café, s'il vous plaît !", NORMAL_RATE),
        ("Je voudrais un café, s'il vous plaît !", SLOW_RATE),
    }


def test_removes_orphaned_clips_but_not_subfolders(make_data, tmp_path, tone):
    backend = RecordingBackend(tone)
    run(make_data().items, backend, tmp_path)
    num = tmp_path / "public" / "audio" / "num"
    num.mkdir()
    (num / "97.mp3").write_bytes(b"number clip")

    def drop_second(topic):
        del topic["items"][1]

    report = run(make_data(topic_edit=drop_second).items, backend, tmp_path)

    assert report.removed == ["resto-02.mp3", "resto-02.slow.mp3"]
    assert "resto-02.mp3" not in audio_names(tmp_path)
    assert (num / "97.mp3").exists()


def test_failed_slow_clip_drops_the_whole_item(make_data, tmp_path, tone):
    data = make_data()
    audio = tmp_path / "public" / "audio"
    audio.mkdir(parents=True)
    # Stale clips from an earlier run must not survive the failure.
    (audio / "pce-01.mp3").write_bytes(b"old")
    (audio / "pce-01.slow.mp3").write_bytes(b"old")

    report = run(data.items, RecordingBackend(tone, fail_text="marché", fail_rate=SLOW_RATE), tmp_path)

    assert list(report.failed) == ["pce-01"]
    assert "service unavailable" in report.failed["pce-01"]
    assert SLOW_RATE in report.failed["pce-01"]
    assert not (audio / "pce-01.mp3").exists() and not (audio / "pce-01.slow.mp3").exists()
    assert report.ok(data.items) == {"resto-01", "resto-02", "pce-02"}
    items_json = build_items_json(data, report.ok(data.items))
    assert [i["id"] for i in items_json["items"]] == ["resto-01", "resto-02", "pce-02"]

    # The next run retries only the failed item's clips (the normal one is cached already).
    retry_backend = RecordingBackend(tone)
    retry = run(data.items, retry_backend, tmp_path)
    assert retry.generated == ["audio/pce-01.slow.mp3"] and not retry.failed
    assert (audio / "pce-01.mp3").exists()


def test_cloze_parts():
    assert cloze_parts("Ils {sont arrivés/sont venus|arriver} {hier}.") == [
        "Ils ",
        {"answers": ["sont arrivés", "sont venus"], "hint": "arriver"},
        " ",
        {"answers": ["hier"]},
        ".",
    ]
    assert cloze_parts("{Je|I} pars.") == ["", {"answers": ["Je"], "hint": "I"}, " pars."]


def test_items_json_shape(make_data):
    data = make_data()
    out = build_items_json(data, {i.id for i in data.items})

    assert out["version"] == 1
    assert out["topics"] == [{"id": "restaurant", "title": "Café & restaurant"}]
    assert out["grammarPoints"] == [
        {
            "id": "passe-compose-etre",
            "title": "Passé composé with être",
            "level": "A2",
            "rule": "Verbs of movement take être.",
        }
    ]
    items = {i["id"]: i for i in out["items"]}
    assert items["resto-01"] == {
        "id": "resto-01",
        "fr": "Je voudrais un café, s'il vous plaît.",
        "en": ["I would like a coffee, please."],
        "altFr": ["Je voudrais un café, s'il te plaît."],
        "level": "A1",
        "topic": "restaurant",
        "grammar": ["passe-compose-etre"],
        "register": "formal",
        "notes": "Polite request.",
        "audio": "audio/resto-01.mp3",
        "audioSlow": "audio/resto-01.slow.mp3",
    }
    assert items["pce-01"] == {
        "id": "pce-01",
        "fr": "Hier, elle est allée au marché.",
        "cloze": ["Hier, elle ", {"answers": ["est allée"], "hint": "aller"}, " au marché."],
        "en": ["Yesterday she went to the market."],
        "altFr": [],
        "level": "A2",
        "point": "passe-compose-etre",
        "grammar": ["passe-compose-etre"],
        "explain": "aller takes être; feminine subject → allée",
        "audio": "audio/pce-01.mp3",
        "audioSlow": "audio/pce-01.slow.mp3",
    }
    # tts_text is a pipeline detail: the app shows fr, never the spoken override.
    assert items["pce-02"]["fr"] == "Ils sont arrivés hier."
    json.dumps(out, ensure_ascii=False)  # serialisable


def test_real_data_builds_items_json():
    data = load_data()
    out = build_items_json(data, {i.id for i in data.items})
    assert len(out["items"]) == len(data.items) > 600
    # Every cloze rebuilds to the spoken sentence.
    for entry in out["items"]:
        if "cloze" in entry:
            rebuilt = "".join(p if isinstance(p, str) else p["answers"][0] for p in entry["cloze"])
            assert rebuilt == entry["fr"], entry["id"]
    # Clip cache keys are unique, so no two clips can overwrite each other in the cache.
    keys = [c.cache_key for item in data.items for c in item_clips(item)]
    duplicate = [k for k, n in Counter(keys).items() if n > 1]
    assert not duplicate
