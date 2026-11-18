"""Load and validate the content in ``data/`` (format: ``data/README.md``).

    data/topics/<slug>.yaml    topic: <title>, items: [...]
    data/grammar/<point>.yaml  point, title, level, rule, items: [...]

``load_data()`` returns a ``Dataset`` or raises ``DataError`` listing every
problem it found, each prefixed with the file and item id, so one run shows
everything that needs fixing. ``generate.py`` builds the audio and
``items.json`` from the same ``Dataset``.

Run as a script to check the repo's data and print a summary:

    uv run python -m french_tts.data [DATA_DIR]
"""

from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from french_tts.tts import VOICES

DEFAULT_DATA = Path(__file__).resolve().parents[3] / "data"

LEVELS = ("A1", "A2", "B1")
REGISTERS = ("formal", "informal")  # formal: vous is expected; informal: tu
SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")  # ids, topic and point names

BLANK_RE = re.compile(r"\{([^{}]*)\}")

TOPIC_FILE_KEYS = {"topic", "items"}
GRAMMAR_FILE_KEYS = {"point", "title", "level", "rule", "items"}
ITEM_KEYS = {
    "id", "fr", "en", "alt_fr", "level", "grammar", "register",
    "explain", "notes", "voice", "tts_text",
}


class DataError(Exception):
    def __init__(self, problems: list[str]):
        self.problems = problems
        super().__init__(f"{len(problems)} problem(s) in data:\n" + "\n".join(problems))


@dataclass(frozen=True)
class Blank:
    answers: tuple[str, ...]  # accepted forms; the first one is spoken
    hint: str | None


@dataclass(frozen=True)
class Item:
    id: str
    fr: str  # as written, cloze markup included
    text: str  # fr with each blank filled by its first answer
    blanks: tuple[Blank, ...]
    en: tuple[str, ...]
    alt_fr: tuple[str, ...]
    level: str
    grammar: tuple[str, ...]  # a grammar-file item's own point comes first
    topic: str | None  # topic slug (topic items)
    point: str | None  # grammar point (grammar items)
    register: str | None
    explain: str | None
    notes: str | None
    voice: str | None
    tts_text: str | None
    source: str  # e.g. "topics/restaurant.yaml"

    @property
    def speech(self) -> str:
        """The text sent to TTS: the ``tts_text`` override, else ``text``."""
        return self.tts_text or self.text


@dataclass(frozen=True)
class Topic:
    slug: str
    title: str
    source: str


@dataclass(frozen=True)
class GrammarPoint:
    point: str
    title: str
    level: str
    rule: str
    source: str


@dataclass(frozen=True)
class Dataset:
    topics: tuple[Topic, ...]
    points: tuple[GrammarPoint, ...]
    items: tuple[Item, ...]  # topic files, then grammar files, each sorted by name, in file order


def parse_cloze(fr: str) -> tuple[str, tuple[Blank, ...]]:
    """Split ``"Elle {est allée|aller} au marché."`` into the full sentence and its blanks.

    A blank is ``{answer|hint}``; ``answer`` may list alternatives separated by
    ``/`` and the hint is optional. Raises ``ValueError`` on malformed markup.
    """
    text: list[str] = []
    blanks: list[Blank] = []
    pos = 0
    for match in BLANK_RE.finditer(fr):
        text.append(_outside(fr[pos : match.start()]))
        body = match.group(1)
        answer, has_hint, hint = body.partition("|")
        if "|" in hint:
            raise ValueError(f"more than one '|' in {{{body}}}")
        answers = tuple(a.strip() for a in answer.split("/"))
        if not all(answers):
            raise ValueError(f"empty answer in {{{body}}}")
        if len(set(answers)) != len(answers):
            raise ValueError(f"repeated answer in {{{body}}}")
        hint = hint.strip()
        if has_hint and not hint:
            raise ValueError(f"empty hint in {{{body}}}")
        blanks.append(Blank(answers, hint or None))
        text.append(answers[0])
        pos = match.end()
    text.append(_outside(fr[pos:]))
    return "".join(text), tuple(blanks)


def _outside(segment: str) -> str:
    if "{" in segment or "}" in segment:
        raise ValueError("unbalanced or nested braces")
    if "|" in segment:
        raise ValueError("'|' outside a blank")
    return segment


class _Loader(yaml.SafeLoader):
    """SafeLoader that rejects duplicate mapping keys instead of keeping the last one."""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in seen:
                raise yaml.constructor.ConstructorError(
                    None, None, f"duplicate key {key!r}", key_node.start_mark
                )
            seen.add(key)
        return super().construct_mapping(node, deep)


class _Checker:
    """Collects problems while reading one file's raw YAML into typed values."""

    def __init__(self, problems: list[str], where: str):
        self.problems = problems
        self.where = where

    def at(self, where: str) -> _Checker:
        return _Checker(self.problems, f"{self.where}: {where}")

    def error(self, message: str) -> None:
        self.problems.append(f"{self.where}: {message}")

    def keys(self, data: dict, allowed: set[str], required: set[str]) -> None:
        for key in sorted(set(data) - allowed, key=str):
            self.error(f"unknown key {key!r}")
        for key in sorted(required - set(data)):
            self.error(f"missing {key!r}")

    def text(self, data: dict, key: str, *, multiline: bool = False) -> str | None:
        """A non-empty string field, or None if absent or invalid."""
        if key not in data:
            return None
        value = data[key]
        if not isinstance(value, str):
            hint = " (quote it: YAML reads yes/no/on/off as booleans)" if isinstance(value, bool) else ""
            self.error(f"{key} must be a string, got {type(value).__name__} {value!r}{hint}")
            return None
        if multiline:
            value = value.strip()
        elif "\n" in value or value != value.strip():
            self.error(f"{key} must be one line with no surrounding spaces: {value!r}")
            return None
        if not value:
            self.error(f"{key} is empty")
            return None
        return value

    def text_list(self, data: dict, key: str) -> tuple[str, ...]:
        if key not in data:
            return ()
        value = data[key]
        if not isinstance(value, list):
            self.error(f"{key} must be a list, got {type(value).__name__} {value!r}")
            return ()
        texts = tuple(t for i in range(len(value)) if (t := self.text({f"{key}[{i}]": value[i]}, f"{key}[{i}]")))
        if len(texts) == len(value):
            for dup, n in Counter(texts).items():
                if n > 1:
                    self.error(f"{key} repeats {dup!r}")
        return texts

    def choice(self, data: dict, key: str, options: tuple[str, ...]) -> str | None:
        value = self.text(data, key)
        if value is not None and value not in options:
            self.error(f"{key} must be one of {', '.join(options)}, got {value!r}")
            return None
        return value

    def french(self, key: str, value: str | None) -> None:
        """Typography shared by every French field."""
        if value is None:
            return
        if "’" in value:
            self.error(f"{key} uses a curly apostrophe; write ' instead: {value!r}")
        if "  " in value:
            self.error(f"{key} has a double space: {value!r}")
        if "' " in value:
            self.error(f"{key} has a space after an apostrophe: {value!r}")

    def capital(self, key: str, value: str | None, *, listed: bool = False) -> None:
        """Entries start like a sentence. In a list this also catches ``[Yes, please]``,
        which YAML splits at the comma into two entries."""
        if value and value[0].islower():
            why = " (a comma inside [...] splits an entry: quote it)" if listed else ""
            self.error(f"{key} starts with a lowercase letter: {value!r}{why}")


def _items(check: _Checker, raw: Any) -> list[dict]:
    if not isinstance(raw, list):
        check.error(f"items must be a list, got {type(raw).__name__}")
        return []
    good = []
    for i, entry in enumerate(raw):
        if isinstance(entry, dict):
            good.append(entry)
        else:
            check.error(f"items[{i}] must be a mapping, got {type(entry).__name__} {entry!r}")
    return good


def _label(raw: dict) -> str:
    item_id = raw.get("id")
    return item_id if isinstance(item_id, str) else f"item {item_id!r}"


def _read_item(
    check: _Checker,
    raw: dict,
    *,
    source: str,
    topic: str | None = None,
    point: str | None = None,
    default_level: str | None = None,
) -> tuple[Item | None, tuple[str, ...]]:
    """Check one item. Returns the item (None if invalid) and its raw grammar tags for the cross-file check."""
    check = check.at(_label(raw))
    errors_before = len(check.problems)

    required = {"id", "fr", "en"} | ({"explain"} if point else set()) | (set() if default_level else {"level"})
    check.keys(raw, ITEM_KEYS, required)

    item_id = check.text(raw, "id")
    if item_id is not None and not SLUG_RE.match(item_id):
        check.error(f"id must be lowercase letters, digits and single hyphens: {item_id!r}")

    fr = check.text(raw, "fr")
    check.french("fr", fr)
    text, blanks = fr, ()
    if fr is not None:
        try:
            text, blanks = parse_cloze(fr)
        except ValueError as exc:
            check.error(f"fr: {exc}: {fr!r}")
        else:
            check.capital("fr", text)
            if blanks and "' " in text:
                check.error(
                    "fr has a space after an apostrophe once the blanks are filled"
                    f" (write {{l'|it}}ai, not {{l'|it}} ai): {text!r}"
                )
            if point and not blanks:
                check.error("a grammar drill needs at least one {blank} in fr")

    en = check.text_list(raw, "en")
    for answer in en:
        check.capital("en", answer, listed=True)
    if "en" in raw and isinstance(raw["en"], list) and not raw["en"]:
        check.error("en is empty")

    alt_fr = check.text_list(raw, "alt_fr")
    for alt in alt_fr:
        check.french("alt_fr", alt)
        check.capital("alt_fr", alt, listed=True)
        if "{" in alt or "}" in alt:
            check.error(f"alt_fr is plain French, without blanks: {alt!r}")
        elif alt == text:
            check.error(f"alt_fr repeats fr: {alt!r}")

    tts_text = check.text(raw, "tts_text")
    check.french("tts_text", tts_text)
    check.capital("tts_text", tts_text)
    if tts_text is not None and ("{" in tts_text or "}" in tts_text):
        check.error(f"tts_text is plain French, without blanks: {tts_text!r}")

    level = check.choice(raw, "level", LEVELS) or default_level
    register = check.choice(raw, "register", REGISTERS)
    voice = check.choice(raw, "voice", tuple(VOICES))

    tags = check.text_list(raw, "grammar")
    for tag in tags:
        if tag == point:
            check.error(f"grammar repeats the file's own point {tag!r}; it is implied")

    explain = check.text(raw, "explain", multiline=True)
    notes = check.text(raw, "notes", multiline=True)

    if len(check.problems) > errors_before:
        return None, tags
    item = Item(
        id=item_id, fr=fr, text=text, blanks=blanks, en=en, alt_fr=alt_fr, level=level,
        grammar=((point,) if point else ()) + tags, topic=topic, point=point,
        register=register, explain=explain, notes=notes, voice=voice, tts_text=tts_text,
        source=source,
    )
    return item, tags


def _yaml_files(folder: Path, rel: str, problems: list[str]) -> list[Path]:
    if not folder.is_dir():
        return []
    for other in sorted(folder.iterdir()):
        if other.suffix != ".yaml" and other.name != ".gitkeep":
            problems.append(f"{rel}/{other.name}: not a .yaml file (only *.yaml is read)")
    return sorted(folder.glob("*.yaml"))


def _read_yaml(path: Path, rel: str, problems: list[str]) -> dict | None:
    try:
        data = yaml.load(path.read_text(encoding="utf-8"), Loader=_Loader)
    except (yaml.YAMLError, UnicodeDecodeError) as exc:
        problems.append(f"{rel}: invalid YAML: {exc}")
        return None
    if not isinstance(data, dict):
        problems.append(f"{rel}: must be a mapping at the top level")
        return None
    return data


def load_data(data_dir: Path = DEFAULT_DATA) -> Dataset:
    """Read and check every topic and grammar file. Raises ``DataError`` listing all problems."""
    if not data_dir.is_dir():
        raise DataError([f"{data_dir}: no such directory"])
    problems: list[str] = []
    topics: list[Topic] = []
    points: list[GrammarPoint] = []
    items: list[Item] = []
    # (checker for the item, its id if it is a string, its grammar tags, file) for the cross-file checks
    read: list[tuple[_Checker, str | None, tuple[str, ...], str]] = []

    def read_items(check, data, source, **where):
        for raw in _items(check, data.get("items", [])):
            item, tags = _read_item(check, raw, source=source, **where)
            item_id = raw.get("id")
            read.append((check.at(_label(raw)), item_id if isinstance(item_id, str) else None, tags, source))
            if item:
                items.append(item)

    for path in _yaml_files(data_dir / "topics", "topics", problems):
        rel = f"topics/{path.name}"
        check = _Checker(problems, rel)
        if not SLUG_RE.match(path.stem):
            check.error("file name must be lowercase letters, digits and single hyphens")
        data = _read_yaml(path, rel, problems)
        if data is None:
            continue
        check.keys(data, TOPIC_FILE_KEYS, TOPIC_FILE_KEYS)
        title = check.text(data, "topic")
        if title:
            topics.append(Topic(path.stem, title, rel))
        read_items(check, data, rel, topic=path.stem)

    for path in _yaml_files(data_dir / "grammar", "grammar", problems):
        rel = f"grammar/{path.name}"
        check = _Checker(problems, rel)
        data = _read_yaml(path, rel, problems)
        if data is None:
            continue
        check.keys(data, GRAMMAR_FILE_KEYS, GRAMMAR_FILE_KEYS)
        point = check.text(data, "point")
        if point is not None and point != path.stem:
            check.error(f"point {point!r} must match the file name {path.stem!r}")
            point = None
        title = check.text(data, "title")
        level = check.choice(data, "level", LEVELS)
        rule = check.text(data, "rule", multiline=True)
        if point and title and level and rule:
            points.append(GrammarPoint(point, title, level, rule, rel))
        if point and level:
            read_items(check, data, rel, point=point, default_level=level)

    known = {p.point for p in points}
    for check, _, tags, _ in read:
        for tag in tags:
            if tag not in known:
                check.error(f"unknown grammar point {tag!r} (no grammar/{tag}.yaml)")

    seen: dict[str, str] = {}
    for check, item_id, _, source in read:
        if item_id is None:
            continue
        if item_id in seen:
            check.error(f"duplicate id, also in {seen[item_id]}")
        else:
            seen[item_id] = source

    if problems:
        raise DataError(problems)
    return Dataset(tuple(topics), tuple(points), tuple(items))


def summary(data: Dataset) -> str:
    levels = Counter(item.level for item in data.items)
    cloze = sum(1 for item in data.items if item.blanks)
    by_level = ", ".join(f"{lvl} {levels[lvl]}" for lvl in LEVELS)
    return (
        f"{len(data.items)} items ({cloze} cloze; {by_level}) "
        f"in {len(data.topics)} topics and {len(data.points)} grammar points"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Check the quiz data and print a summary.")
    parser.add_argument("data_dir", nargs="?", type=Path, default=DEFAULT_DATA)
    args = parser.parse_args()
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # the Windows console default mangles accents
    try:
        data = load_data(args.data_dir)
    except DataError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    print(f"OK: {summary(data)}")


if __name__ == "__main__":
    main()
