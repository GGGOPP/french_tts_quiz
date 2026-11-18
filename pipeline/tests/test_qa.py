"""qa.py: numbers, normalisation, comparison, transcript cache, report page (no Whisper model)."""

import copy
from pathlib import Path

import pytest
import yaml

from french_tts.data import load_data
from french_tts.qa import (
    build_page,
    cardinal,
    check,
    compare,
    flagged,
    normalise,
    ordinal,
    sound_key,
    spell_numbers,
    word_diff,
)

TOPIC = {
    "topic": "Time",
    "items": [
        {"id": "time-01", "fr": "Le film commence à vingt heures trente.", "en": ["The film starts at 8:30 pm."], "level": "A1"},
        {"id": "time-02", "fr": "Ça fait douze euros cinquante.", "en": ["That's twelve fifty."], "level": "A1"},
        {"id": "time-03", "fr": "Elles parlent avec le serveur.", "en": ["They talk to the waiter."], "level": "A1"},
        {
            "id": "time-04",
            "fr": "Il est une heure.",
            "en": ["It's one o'clock."],
            "level": "A1",
            "tts_text": "Il est une heure !",
        },
    ],
}

IDS = [i["id"] for i in TOPIC["items"]]


class FakeTranscriber:
    """Hears ``heard[file name]``; counts calls."""

    name = "fake"

    def __init__(self, heard: dict[str, str]) -> None:
        self.heard = heard
        self.calls: list[str] = []

    def transcribe(self, path: Path) -> str:
        self.calls.append(path.name)
        return self.heard[path.name]


@pytest.fixture
def items(tmp_path):
    root = tmp_path / "data"
    (root / "topics").mkdir(parents=True)
    (root / "topics" / "time.yaml").write_text(
        yaml.safe_dump(copy.deepcopy(TOPIC), allow_unicode=True, sort_keys=False), encoding="utf-8"
    )
    return load_data(root).items


@pytest.fixture
def public(tmp_path, items):
    audio = tmp_path / "public" / "audio"
    audio.mkdir(parents=True)
    for item in items:
        for suffix in (".mp3", ".slow.mp3"):
            (audio / f"{item.id}{suffix}").write_bytes(f"{item.id}{suffix}".encode())  # distinct bytes
    return tmp_path / "public"


def all_heard(**overrides):
    """Every clip heard exactly as written, except the given file names."""
    heard = {f"{i['id']}{s}": i["fr"] for i in TOPIC["items"] for s in (".mp3", ".slow.mp3")}
    heard.update({k.replace("_", "-").replace("-slow", ".slow") + ".mp3": v for k, v in overrides.items()})
    return heard


@pytest.mark.parametrize(
    "n, words",
    [
        (0, "zéro"), (1, "un"), (16, "seize"), (17, "dix-sept"), (21, "vingt et un"), (22, "vingt-deux"),
        (61, "soixante et un"), (70, "soixante-dix"), (71, "soixante et onze"), (77, "soixante-dix-sept"),
        (80, "quatre-vingts"), (81, "quatre-vingt-un"), (91, "quatre-vingt-onze"), (99, "quatre-vingt-dix-neuf"),
        (100, "cent"), (101, "cent un"), (200, "deux cents"), (250, "deux cent cinquante"),
        (1000, "mille"), (1990, "mille neuf cent quatre-vingt-dix"), (2024, "deux mille vingt-quatre"),
        (80_000, "quatre-vingt mille"), (200_000, "deux cent mille"), (1_000_000, "un million"),
        (3_000_000, "trois millions"),
    ],
)
def test_cardinal(n, words):
    assert cardinal(n) == words


def test_ordinal():
    assert [ordinal(n) for n in (1, 2, 4, 5, 9, 11, 21)] == [
        "premier", "deuxième", "quatrième", "cinquième", "neuvième", "onzième", "vingt et unième",
    ]


@pytest.mark.parametrize(
    "heard, spelt",
    [
        ("à 14h30.", "à quatorze heures trente."),
        ("à 19 h 30", "à dix-neuf heures trente"),
        ("vers 21h", "vers vingt et une heures"),
        ("à 7h pendant", "à sept heures pendant"),  # the space after h stays
        ("à 9h pile", "à neuf heures pile"),
        ("à 1h.", "à une heure."),
        ("à 8h00", "à huit heures"),
        ("à 8 heures", "à huit heures"),  # a plain number before a word
        ("Ça fait 12,50 euros.", "Ça fait douze euros cinquante."),
        ("Ça fait 12,50€.", "Ça fait douze euros cinquante."),
        ("3 €", "trois euros"),
        ("Oui, 38,5.", "Oui, trente-huit et demi."),
        ("Oui, 38 et demi.", "Oui, trente-huit et demi."),
        ("en 1 995", "en mille neuf cent quatre-vingt-quinze"),
        ("le 1er mai", "le premier mai"),
        ("au 3e étage", "au troisième étage"),
        ("50 %", "cinquante pour cent"),
    ],
)
def test_spell_numbers(heard, spelt):
    assert spell_numbers(heard) == spelt


@pytest.mark.parametrize(
    "text, expected",
    [
        ("J'ai rendez-vous à 14h30 !", "j ai rendez vous a quatorze heures trente"),
        ("Qu’est-ce que c’est ?", "qu est ce que c est"),  # curly apostrophes
        ("Où est l'hôtel ?", "ou est l hotel"),
        ("Un œuf, s'il vous plaît.", "un oeuf s il vous plait"),
        ("Il a soixante-dix-sept ans.", "il a soixante dix sept ans"),
        ("Il est huit heures et quart.", "il est huit heures quinze"),
        ("Il est 8h15.", "il est huit heures quinze"),
        ("à une heure et demie", "a une heure trente"),
        ("trente-huit et demi", "trente huit et demi"),  # not a time
    ],
)
def test_normalise(text, expected):
    assert normalise(text) == expected


@pytest.mark.parametrize(
    "a, b",
    [
        ("Elles parlent.", "Elle parle."),
        ("Elle est allée au marché.", "Elle est allé au marché."),
        ("Vous allez manger.", "Vous allez mangé."),
        ("Je suis arrivée.", "Je suis arriver."),
        ("Ils partent en juin.", "Il part en juin."),
    ],
)
def test_silent_endings_sound_alike(a, b):
    assert sound_key(a) == sound_key(b)


def test_different_words_dont_sound_alike():
    assert sound_key("et") != sound_key("est")
    assert sound_key("Il a mangé.") != sound_key("Il a bougé.")
    assert sound_key("Je le vois.") != sound_key("Je la vois.")


def test_compare():
    assert compare(["Le film commence à vingt heures trente."], "Le film commence à 20h30.") == ("ok", 1.0)
    assert compare(["Ça fait douze euros cinquante."], "Ça fait 12,50 €.") == ("ok", 1.0)
    verdict, similarity = compare(["Elles parlent avec le serveur."], "Elle parle avec le serveur.")
    assert verdict == "close" and 0.8 < similarity < 1
    assert compare(["Elles parlent avec le serveur."], "Elle part avec le serveur.")[0] == "mismatch"
    assert compare(["Il est une heure."], "") == ("mismatch", 0.0)
    assert compare(["Il est deux heures et demie."], "Il est 2h30.")[0] == "ok"
    assert compare(["Tu fais quoi ce week-end ?"], "Tu fais quoi ce weekend ?")[0] == "ok"
    # A tts_text override counts as an expected text too.
    assert compare(["Il est 1 h.", "Il est une heure, pile."], "Il est une heure pile.")[0] == "ok"


def test_word_diff():
    assert word_diff("Elles parlent avec le serveur.", "Elle part avec le serveur") == [
        ("-", "elles parlent"), ("+", "elle part"), ("=", "avec le serveur"),
    ]
    assert word_diff("Il est midi.", "Il est midi et demi") == [("=", "il est midi"), ("+", "et demi")]


def test_check_flags_items_worst_first(items, public, tmp_path):
    (public / "audio" / "time-04.slow.mp3").unlink()  # a missing clip is flagged first
    heard = all_heard(time_03="Elle parle avec le serveur.", time_02_slow="Ça fait douze heures.")
    results = check(items, public, FakeTranscriber(heard), tmp_path / "qa.json")

    assert [r.item.id for r in results] == IDS
    assert [(r.item.id, r.verdict) for r in flagged(results)] == [
        ("time-04", "missing"), ("time-02", "mismatch"), ("time-03", "close"),
    ]
    time02 = {r.item.id: r for r in results}["time-02"]
    assert [(c.slow, c.verdict) for c in time02.clips] == [(False, "ok"), (True, "mismatch")]


def test_check_one_speed_only(items, public, tmp_path):
    fake = FakeTranscriber(all_heard())
    results = check(items, public, fake, tmp_path / "qa.json", speeds=(False,))
    assert all(len(r.clips) == 1 and not r.clips[0].slow for r in results)
    assert sorted(fake.calls) == sorted(f"{i}.mp3" for i in IDS)


def test_transcripts_are_cached_by_clip_bytes(items, public, tmp_path):
    cache = tmp_path / "qa.json"
    first = FakeTranscriber(all_heard())
    check(items, public, first, cache)
    assert len(first.calls) == 8

    second = FakeTranscriber(all_heard())
    results = check(items, public, second, cache)
    assert second.calls == []
    assert all(r.ok for r in results)

    (public / "audio" / "time-01.slow.mp3").write_bytes(b"regenerated clip")
    third = FakeTranscriber(all_heard())
    check(items, public, third, cache)
    assert third.calls == ["time-01.slow.mp3"]


def test_page_lists_flags_with_both_players_and_a_diff(items, public, tmp_path):
    heard = all_heard(time_03_slow="Elle part avec le serveur.")
    results = check(items, public, FakeTranscriber(heard), tmp_path / "qa.json")

    page = build_page(results, public, tmp_path / "qa_out")

    assert "1 of 4 items flagged (1 mismatch), from 8 clips" in page
    assert 'src="../public/audio/time-03.mp3"' in page
    assert 'src="../public/audio/time-03.slow.mp3"' in page
    assert "<del>elles parlent</del> <ins>elle part</ins>" in page
    assert "time-01" not in page


def test_load_audio_decodes_to_16khz_float(tmp_path, make_mp3):
    from french_tts.qa import load_audio

    clip = tmp_path / "tone.mp3"
    clip.write_bytes(make_mp3("0.5*sin(2*PI*440*t)", 1.0))
    samples = load_audio(clip)

    assert samples.dtype.name == "float32"
    assert abs(len(samples) - 16000) < 1600  # ~1 s at 16 kHz (mp3 padding aside)
    assert 0.3 < abs(samples).max() <= 1.0
