"""Tests for data.py: the cloze parser, the loader, and every validation rule."""

import copy
import textwrap

import pytest
import yaml

from french_tts.data import DEFAULT_DATA, Blank, DataError, load_data, parse_cloze

TOPIC = {
    "topic": "Café & restaurant",
    "items": [
        {
            "id": "resto-01",
            "fr": "Je voudrais un café, s'il vous plaît.",
            "en": ["I would like a coffee, please.", "I'd like a coffee, please."],
            "alt_fr": ["Je voudrais un café, s'il te plaît."],
            "level": "A1",
            "grammar": ["passe-compose-etre"],
            "register": "formal",
            "notes": "Polite request.",
        },
        {
            "id": "resto-02",
            "fr": "L'addition, s'il vous plaît.",
            "en": ["The bill, please."],
            "level": "A1",
            "voice": "henri",
        },
    ],
}

GRAMMAR = {
    "point": "passe-compose-etre",
    "title": "Passé composé with être",
    "level": "A2",
    "rule": "Verbs of movement take être.\nThe participle agrees with the subject.\n",
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
            "level": "A1",
            "tts_text": "Ils sont arrivés hier.",
        },
    ],
}


def write_yaml(root, rel, data):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    text = data if isinstance(data, str) else yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    path.write_text(textwrap.dedent(text), encoding="utf-8")


@pytest.fixture
def make_data(tmp_path):
    """Write the valid TOPIC and GRAMMAR files, each optionally changed by a callback, and load them."""

    def build(topic_edit=None, grammar_edit=None):
        topic, grammar = copy.deepcopy(TOPIC), copy.deepcopy(GRAMMAR)
        if topic_edit:
            topic_edit(topic)
        if grammar_edit:
            grammar_edit(grammar)
        write_yaml(tmp_path, "topics/restaurant.yaml", topic)
        write_yaml(tmp_path, "grammar/passe-compose-etre.yaml", grammar)
        return load_data(tmp_path)

    return build


def problems_of(build, **edits):
    with pytest.raises(DataError) as info:
        build(**edits)
    return info.value.problems


# --- parse_cloze -------------------------------------------------------------


def test_parse_cloze_plain_sentence():
    assert parse_cloze("Bonjour !") == ("Bonjour !", ())


def test_parse_cloze_blanks_alternatives_and_hints():
    text, blanks = parse_cloze("Ils {sont arrivés / sont venus|arriver} {hier} à {midi|time}.")
    assert text == "Ils sont arrivés hier à midi."
    assert blanks == (
        Blank(("sont arrivés", "sont venus"), "arriver"),
        Blank(("hier",), None),
        Blank(("midi",), "time"),
    )


@pytest.mark.parametrize(
    ("fr", "message"),
    [
        ("Elle {est allée au marché.", "unbalanced"),
        ("Elle est allée} au marché.", "unbalanced"),
        ("Elle {est {allée}} au marché.", "unbalanced"),
        ("Elle {} au marché.", "empty answer"),
        ("Elle {est allée//va|aller} au marché.", "empty answer"),
        ("Elle {est allée|} au marché.", "empty hint"),
        ("Elle {est allée|aller|go} au marché.", "more than one '|'"),
        ("Elle {va/va|aller} au marché.", "repeated answer"),
        ("Elle va | au marché.", "'|' outside"),
    ],
)
def test_parse_cloze_rejects_bad_markup(fr, message):
    with pytest.raises(ValueError, match=message):
        parse_cloze(fr)


# --- loading -----------------------------------------------------------------


def test_valid_data_loads(make_data):
    data = make_data()
    [topic] = data.topics
    assert (topic.slug, topic.title, topic.source) == ("restaurant", "Café & restaurant", "topics/restaurant.yaml")
    [point] = data.points
    assert point.point == "passe-compose-etre"
    assert point.rule == "Verbs of movement take être.\nThe participle agrees with the subject."
    assert [item.id for item in data.items] == ["resto-01", "resto-02", "pce-01", "pce-02"]

    resto1, resto2, pce1, pce2 = data.items
    assert resto1.topic == "restaurant" and resto1.point is None
    assert resto1.grammar == ("passe-compose-etre",)
    assert resto1.register == "formal"
    assert resto1.blanks == ()
    assert resto1.text == resto1.speech == resto1.fr
    assert resto2.voice == "henri"
    assert resto2.grammar == resto2.alt_fr == ()

    assert pce1.point == "passe-compose-etre" and pce1.topic is None
    assert pce1.grammar == ("passe-compose-etre",)
    assert pce1.level == "A2"  # from the file
    assert pce1.text == pce1.speech == "Hier, elle est allée au marché."
    assert pce2.level == "A1"  # item override
    assert pce2.text == "Ils sont arrivés hier."
    assert pce2.speech == "Ils sont arrivés hier."


def test_missing_subfolders_mean_no_data(tmp_path):
    data = load_data(tmp_path)
    assert data.items == data.topics == data.points == ()


def test_missing_data_dir(tmp_path):
    with pytest.raises(DataError, match="no such directory"):
        load_data(tmp_path / "nope")


def test_repo_data_is_valid():
    load_data(DEFAULT_DATA)


# --- validation --------------------------------------------------------------


def item_edit(**changes):
    """Change the file's first item; a value of ``...`` deletes that key."""

    def edit(data):
        item = data["items"][0]
        for key, value in changes.items():
            if value is ...:
                del item[key]
            else:
                item[key] = value

    return edit


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (item_edit(id=...), "missing 'id'"),
        (item_edit(level=...), "missing 'level'"),
        (item_edit(en=...), "missing 'en'"),
        (item_edit(en=[]), "en is empty"),
        (item_edit(en="I'd like a coffee."), "en must be a list"),
        (item_edit(en=["Yes", "Yes"]), "en repeats 'Yes'"),
        (item_edit(en=[True]), "quote it"),
        (item_edit(en=[""]), "en[0] is empty"),
        (item_edit(id="Resto_01"), "id must be lowercase"),
        (item_edit(fr=12), "fr must be a string, got int"),
        (item_edit(fr=" Bonjour."), "one line"),
        (item_edit(fr="Bonjour.\nSalut."), "one line"),
        (item_edit(fr="Je voudrais un café,  merci."), "double space"),
        (item_edit(fr="Je voudrais un café, s’il vous plaît."), "curly apostrophe"),
        (item_edit(fr="Je {voudrais un café."), "fr: unbalanced"),
        (item_edit(fr="Il {l'|it} a bu."), "space after an apostrophe once the blanks are filled"),
        (item_edit(alt_fr=["Il l' a bu."]), "alt_fr has a space after an apostrophe"),
        (item_edit(alt_fr=["Je voudrais un café, s'il vous plaît."]), "alt_fr repeats fr"),
        (item_edit(alt_fr=["Je {voudrais} un café."]), "alt_fr is plain French"),
        (item_edit(tts_text="Je {voudrais} un café."), "tts_text is plain French"),
        (item_edit(level="B2"), "level must be one of A1, A2, B1"),
        (item_edit(register="polite"), "register must be one of formal, informal"),
        (item_edit(voice="nestoras"), "voice must be one of"),
        (item_edit(grammar=["subjonctif"]), "unknown grammar point 'subjonctif'"),
        (item_edit(grammar="passe-compose-etre"), "grammar must be a list"),
        (item_edit(alt_fr_typo=["x"]), "unknown key 'alt_fr_typo'"),
        (item_edit(notes=""), "notes is empty"),
        (item_edit(en=["I'd like a coffee", "please."]), "en starts with a lowercase letter: 'please.' (a comma"),
        (item_edit(alt_fr=["je voudrais un café."]), "alt_fr starts with a lowercase letter"),
        (item_edit(fr="je voudrais un café."), "fr starts with a lowercase letter"),
    ],
)
def test_topic_item_problems(make_data, edit, message):
    problems = problems_of(make_data, topic_edit=edit)
    assert any(message in p for p in problems), problems
    assert all(p.startswith("topics/restaurant.yaml: ") for p in problems)


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (item_edit(explain=...), "missing 'explain'"),
        (item_edit(fr="Hier, elle est allée au marché."), "needs at least one {blank}"),
        (item_edit(grammar=["passe-compose-etre"]), "it is implied"),
        (item_edit(level="C1"), "level must be one of"),
        (lambda g: g.update(point="passe-compose"), "must match the file name"),
        (lambda g: g.update(level="B2"), "level must be one of"),
        (lambda g: g.update(rule="  \n"), "rule is empty"),
        (lambda g: g.pop("title"), "missing 'title'"),
        (lambda g: g.update(items="pce-01"), "items must be a list"),
        (lambda g: g["items"].append("pce-03"), "items[2] must be a mapping"),
        (lambda g: g.update(extra=1), "unknown key 'extra'"),
    ],
)
def test_grammar_file_problems(make_data, edit, message):
    problems = problems_of(make_data, grammar_edit=edit)
    assert any(message in p for p in problems), problems


def test_problem_names_the_item(make_data):
    [problem] = problems_of(make_data, grammar_edit=item_edit(voice="eve"))
    assert problem.startswith("grammar/passe-compose-etre.yaml: pce-01: voice must be one of")


def test_all_problems_are_reported_together(make_data):
    problems = problems_of(
        make_data, topic_edit=item_edit(level="B2"), grammar_edit=item_edit(explain=...)
    )
    assert len(problems) == 2


def test_duplicate_ids_across_files(make_data):
    problems = problems_of(make_data, grammar_edit=item_edit(id="resto-02"))
    assert problems == [
        "grammar/passe-compose-etre.yaml: resto-02: duplicate id, also in topics/restaurant.yaml"
    ]


def test_duplicate_id_is_reported_even_if_the_item_has_other_problems(make_data):
    problems = problems_of(make_data, grammar_edit=item_edit(id="resto-02", explain=...))
    assert "grammar/passe-compose-etre.yaml: resto-02: duplicate id, also in topics/restaurant.yaml" in problems


def test_items_may_be_empty_for_a_rule_card_only(make_data):
    data = make_data(grammar_edit=lambda g: g.update(items=[]))
    assert [p.point for p in data.points] == ["passe-compose-etre"]


def test_duplicate_yaml_keys_are_rejected(tmp_path):
    write_yaml(
        tmp_path,
        "topics/greetings.yaml",
        """\
        topic: Greetings
        items:
          - id: greet-01
            fr: Bonjour.
            en: [Hello.]
            en: [Good morning.]
            level: A1
        """,
    )
    with pytest.raises(DataError, match="duplicate key 'en'"):
        load_data(tmp_path)


def test_yaml_booleans_are_caught(tmp_path):
    write_yaml(
        tmp_path,
        "topics/greetings.yaml",
        """\
        topic: Greetings
        items:
          - id: greet-01
            fr: Non.
            en: [No]
            level: A1
        """,
    )
    with pytest.raises(DataError, match=r"en\[0\] must be a string, got bool False \(quote it"):
        load_data(tmp_path)


def test_file_level_problems(tmp_path):
    write_yaml(tmp_path, "topics/Bad_Name.yaml", {"topic": "X", "items": []})
    write_yaml(tmp_path, "topics/notes.yml", {"topic": "X", "items": []})
    write_yaml(tmp_path, "topics/list.yaml", "- a\n- b\n")
    write_yaml(tmp_path, "topics/broken.yaml", "topic: [unclosed\n")
    (tmp_path / "topics" / ".gitkeep").touch()
    with pytest.raises(DataError) as info:
        load_data(tmp_path)
    problems = info.value.problems
    assert "topics/Bad_Name.yaml: file name must be lowercase letters, digits and single hyphens" in problems
    assert "topics/notes.yml: not a .yaml file (only *.yaml is read)" in problems
    assert "topics/list.yaml: must be a mapping at the top level" in problems
    assert any(p.startswith("topics/broken.yaml: invalid YAML") for p in problems)
    assert len(problems) == 4
