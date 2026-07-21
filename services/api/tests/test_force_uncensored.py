from __future__ import annotations

from app.force_uncensored import (
    force_uncensored_caption,
    force_uncensored_prompt,
    force_uncensored_tags,
    is_censor_related_tag,
)
from app.schemas import TagScore


def test_strips_mosaic_and_censor_tags() -> None:
    tags = [
        TagScore(tag="1girl", score=0.9, category="general"),
        TagScore(tag="mosaic censoring", score=0.8, category="general"),
        TagScore(tag="bar censor", score=0.7, category="general"),
        TagScore(tag="censored", score=0.6, category="general"),
        TagScore(tag="smile", score=0.5, category="general"),
    ]
    out = force_uncensored_tags(tags)
    names = [t.tag for t in out]
    assert names[0] == "uncensored"
    assert "mosaic censoring" not in names
    assert "bar censor" not in names
    assert "censored" not in names
    assert "1girl" in names
    assert "smile" in names


def test_keeps_uncensored_only_once() -> None:
    tags = [
        TagScore(tag="uncensored", score=0.4, category="general"),
        TagScore(tag="1girl", score=0.9, category="general"),
    ]
    out = force_uncensored_tags(tags)
    assert [t.tag for t in out].count("uncensored") == 1
    assert out[0].tag == "uncensored"
    assert out[0].score == 1.0


def test_is_censor_related() -> None:
    assert is_censor_related_tag("bar_censor")
    assert is_censor_related_tag("mosaic")
    assert not is_censor_related_tag("uncensored")
    assert not is_censor_related_tag("1girl")


def test_force_prompt() -> None:
    assert force_uncensored_prompt("1girl, censored, smile") == "uncensored, 1girl, smile"


def test_force_caption() -> None:
    text = force_uncensored_caption("A scene with mosaic and bar censor details.")
    assert text is not None
    assert "mosaic" not in text.lower()
    assert "uncensored" in text.lower()
