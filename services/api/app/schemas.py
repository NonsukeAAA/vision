from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class OutputMode(str, Enum):
    booru = "booru"
    caption = "caption"
    hybrid = "hybrid"


class TagScore(BaseModel):
    tag: str
    score: float
    category: str = "general"  # general | character | rating


class TagRequestOptions(BaseModel):
    mode: OutputMode = OutputMode.hybrid
    threshold: float = Field(default=0.35, ge=0.05, le=0.95)
    character_threshold: float = Field(default=0.85, ge=0.05, le=0.99)
    include_rating: bool = False
    enable_joy: bool = True
    enable_wd: bool = True


class TagResponse(BaseModel):
    mode: OutputMode
    tags: list[TagScore] = Field(default_factory=list)
    prompt: str = ""
    caption: str | None = None
    source: dict[str, Any] = Field(default_factory=dict)
    device: str = "cpu"
    mock: bool = False


class HealthResponse(BaseModel):
    status: str = "ok"
    wd_ready: bool = False
    joy_ready: bool = False
    joy_available: bool = False
    device: str = "cpu"
    mock: bool = False
    models: dict[str, str] = Field(default_factory=dict)