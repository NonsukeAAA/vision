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

_MONO_COMIC_EXACT = frozenset(
    {
        "monochrome",
        "grayscale",
        "greyscale",
        "comic",
        "manga",
        "4koma",
        "multiple 4koma",
        "black and white",
        "lineart",
        "line art",
        "sketch",
        "sepia",
        "high contrast",
        "limited palette",
        "comic panel",
        "manga panel",
        "speech bubble",
        "thought bubble",
        "spoken heart",
        "emphasis lines",
        "speed lines",
        "action lines",
        "halftone",
        "screentones",
        "screentone",
        "ben day dots",
        "faux traditional media",
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


def is_mono_comic_style_tag(tag: str) -> bool:
    n = normalize_tag(tag)
    if not n:
        return False
    if n in _MONO_COMIC_EXACT:
        return True
    compact = n.replace(" ", "")
    if re.fullmatch(r"\d+koma", compact) or compact.endswith("koma"):
        return True
    if "monochrome" in n or "grayscale" in n or "greyscale" in n:
        return True
    if "speech bubble" in n or "thought bubble" in n:
        return True
    if "screentone" in n or "halftone" in n:
        return True
    if "comic panel" in n or "manga panel" in n:
        return True
    if n.startswith("comic ") or n.endswith(" comic") or " comic " in n:
        return True
    return False


def should_drop_output_tag(tag: str) -> bool:
    return is_censor_related_tag(tag) or is_mono_comic_style_tag(tag)


def force_uncensored_tags(tags: list[TagScore]) -> list[TagScore]:
    """Drop censor / monochrome-comic tags and force `uncensored` at the front."""
    filtered = [t for t in tags if not should_drop_output_tag(t.tag)]
    without = [t for t in filtered if normalize_tag(t.tag) != "uncensored"]
    return [TagScore(tag="uncensored", score=1.0, category="general"), *without]


def force_uncensored_prompt(prompt: str) -> str:
    parts = [p.strip() for p in prompt.split(",") if p.strip()]
    parts = [
        p
        for p in parts
        if not should_drop_output_tag(p) and normalize_tag(p) != "uncensored"
    ]
    return ", ".join(["uncensored", *parts])


_CAPTION_NOISE_RE = re.compile(
    r"\b(mosaic|censor(?:ed|ing| bar)?|bar censor|pixelated|"
    r"monochrome|grayscale|greyscale|comic|manga|4koma|lineart|sketch|"
    r"speech bubble|screentone|halftone)\b",
    re.IGNORECASE,
)


def force_uncensored_caption(caption: str | None) -> str | None:
    if caption is None:
        return None
    cleaned = _CAPTION_NOISE_RE.sub("", caption)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,.")
    if not cleaned:
        return "uncensored"
    if re.search(r"\buncensored\b", cleaned, re.IGNORECASE):
        return cleaned
    return f"{cleaned} uncensored."
