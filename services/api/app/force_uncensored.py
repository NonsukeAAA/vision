from __future__ import annotations

import re

from .schemas import TagScore

_CENSOR_EXACT = frozenset(
    {
        "censored",
        "mosaic",
        "pixelated",
        "pixelation",
    }
)


def normalize_tag(tag: str) -> str:
    return re.sub(r"\s+", " ", tag.strip().lower().replace("_", " "))


def is_censor_related_tag(tag: str) -> bool:
    n = normalize_tag(tag)
    if not n:
        return False
    if n == "uncensored" or n.startswith("uncensor"):
        return False
    if n in _CENSOR_EXACT:
        return True
    if "censor" in n or "mosaic" in n or "pixelat" in n:
        return True
    return False


def force_uncensored_tags(tags: list[TagScore]) -> list[TagScore]:
    """Drop mosaic/censor tags and force `uncensored` at the front."""
    filtered = [t for t in tags if not is_censor_related_tag(t.tag)]
    without = [t for t in filtered if normalize_tag(t.tag) != "uncensored"]
    return [TagScore(tag="uncensored", score=1.0, category="general"), *without]


def force_uncensored_prompt(prompt: str) -> str:
    parts = [p.strip() for p in prompt.split(",") if p.strip()]
    parts = [
        p
        for p in parts
        if not is_censor_related_tag(p) and normalize_tag(p) != "uncensored"
    ]
    return ", ".join(["uncensored", *parts])


_CAPTION_CENSOR_RE = re.compile(
    r"\b(mosaic|censor(?:ed|ing| bar)?|bar censor|pixelated)\b",
    re.IGNORECASE,
)


def force_uncensored_caption(caption: str | None) -> str | None:
    if caption is None:
        return None
    cleaned = _CAPTION_CENSOR_RE.sub("", caption)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,.")
    if not cleaned:
        return "uncensored"
    if re.search(r"\buncensored\b", cleaned, re.IGNORECASE):
        return cleaned
    return f"{cleaned} uncensored."
