"""Bake-off run + page, with a fake backend (no network)."""

import asyncio

import pytest

from french_tts.bakeoff import (
    BAKEOFF_RATES,
    BAKEOFF_VOICES,
    ITEMS,
    Item,
    build_page,
    cell_file,
    rate_slug,
    run_bakeoff,
)
from french_tts.clip import duration
from french_tts.tts import VOICES, Synthesis


class EchoBackend:
    """Returns a tone (with trailing silence) and records each request.

    Text containing "échec" raises, to check one bad cell doesn't sink the run.
    """

    def __init__(self, audio: bytes) -> None:
        self.audio = audio
        self.calls: list[tuple[str, str, str]] = []

    async def synthesize(self, text: str, voice: str, rate: str = "+0%") -> Synthesis:
        self.calls.append((text, voice, rate))
        if "échec" in text:
            raise RuntimeError("service unavailable")
        return Synthesis(text=text, voice=voice, rate=rate, audio=self.audio, words=[])


def test_defaults_are_valid():
    assert set(BAKEOFF_VOICES) <= set(VOICES)
    assert len(BAKEOFF_RATES) == len(set(BAKEOFF_RATES)) == 2
    assert 18 <= len(ITEMS) <= 25
    assert len({item.french for item in ITEMS}) == len(ITEMS)
    assert all(item.french and item.english and item.why for item in ITEMS)


@pytest.mark.parametrize(("rate", "slug"), [("+0%", "p0"), ("-25%", "m25"), ("+10%", "p10")])
def test_rate_slug(rate, slug):
    assert rate_slug(rate) == slug


def test_cell_file_names():
    assert cell_file(0, "denise", "-25%") == "audio/01_denise_m25.mp3"


def test_run_bakeoff_writes_clips_and_page(tmp_path, make_mp3):
    tone = make_mp3("if(between(t,0.1,1.0),0.3*sin(2*PI*440*t),0)", 2.0)
    backend = EchoBackend(tone)
    items = [Item("C'est <bon> & beau.", "It's good.", "html escaping"), Item("échec", "-", "error cell")]
    voices = ["denise", "henri"]
    rates = ["+0%", "-25%"]
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "stale.mp3").write_bytes(b"old")

    cells = asyncio.run(run_bakeoff(backend, items, voices, rates, tmp_path, concurrency=2))

    assert len(cells) == len(items) * len(voices) * len(rates)
    assert {(v, r) for _t, v, r in backend.calls} == {(v, r) for v in voices for r in rates}
    assert not (tmp_path / "audio" / "stale.mp3").exists()

    ok = [c for c in cells if c.item_index == 0]
    failed = [c for c in cells if c.item_index == 1]
    for c in ok:
        assert c.error is None
        audio = (tmp_path / c.file).read_bytes()
        # Trailing silence was trimmed: tone ends at 1.0 s, clip was 2.0 s.
        assert c.seconds == pytest.approx(duration(audio))
        assert c.seconds < 1.5
    assert all(c.file is None and "service unavailable" in c.error for c in failed)

    page = build_page(items, cells, voices, rates)
    assert "C&#x27;est &lt;bon&gt; &amp; beau." in page and "<bon>" not in page
    assert page.count("<audio") == len(ok)
    assert 'src="audio/01_henri_m25.mp3"' in page
    assert "slow -25%" in page and "normal +0%" in page
    assert f"{len(failed)} failed" in page
