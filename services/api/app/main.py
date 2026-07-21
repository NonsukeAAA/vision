from __future__ import annotations

import io
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from .config import Settings, get_settings
from .force_uncensored import (
    force_uncensored_caption,
    force_uncensored_tags,
)
from .joy_caption import JoyCaptioner
from .schemas import HealthResponse, OutputMode, TagResponse, TagScore
from .wd_tagger import WdTagger, tags_to_prompt

settings = get_settings()
wd_tagger = WdTagger(settings)
joy_captioner = JoyCaptioner(settings)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Eager-load WD (lighter). Joy loads on first request if enabled.
    try:
        wd_tagger.ensure_loaded()
    except Exception:
        # Allow health to report not-ready; first /tag may retry.
        pass
    yield


app = FastAPI(title="vision", version="0.1.0", lifespan=lifespan)

origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if "*" not in settings.cors_origins else ["*"],
    allow_origin_regex=r"https://.*\.github\.io",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _resolve_device() -> str:
    if settings.mock_inference:
        return "mock"
    if joy_captioner.ready:
        return joy_captioner.device
    return "cpu"


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        wd_ready=wd_tagger.ready,
        joy_ready=joy_captioner.ready,
        joy_available=joy_captioner.available and settings.enable_joy,
        device=_resolve_device(),
        mock=settings.mock_inference,
        models={
            "wd": settings.wd_repo,
            "joy": settings.joy_repo,
        },
    )


@app.post("/tag", response_model=TagResponse)
async def tag_image(
    file: Annotated[UploadFile, File(...)],
    mode: Annotated[str, Form()] = OutputMode.hybrid.value,
    threshold: Annotated[float, Form()] = 0.35,
    character_threshold: Annotated[float, Form()] = 0.85,
    include_rating: Annotated[bool, Form()] = False,
    enable_joy: Annotated[bool, Form()] = True,
    enable_wd: Annotated[bool, Form()] = True,
) -> TagResponse:
    try:
        output_mode = OutputMode(mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid mode: {mode}") from exc

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Unsupported image") from exc

    tags: list[TagScore] = []
    caption: str | None = None
    source: dict[str, str] = {}

    if enable_wd and output_mode in (OutputMode.booru, OutputMode.hybrid):
        try:
            tags = wd_tagger.tag(
                image,
                threshold=threshold,
                character_threshold=character_threshold,
                include_rating=include_rating,
            )
            source["wd"] = "ok"
        except Exception as exc:
            source["wd"] = f"error: {exc}"
            if output_mode == OutputMode.booru and not enable_joy:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

    run_joy = enable_joy and settings.enable_joy and (
        output_mode in (OutputMode.caption, OutputMode.hybrid)
        or (output_mode == OutputMode.booru and not tags)
    )
    if run_joy:
        try:
            if output_mode == OutputMode.booru:
                caption = joy_captioner.caption(image, booru_tags=True)
            else:
                caption = joy_captioner.caption(image, booru_tags=False)
            source["joy"] = "ok"
        except Exception as exc:
            source["joy"] = f"error: {exc}"
            if output_mode == OutputMode.caption:
                raise HTTPException(status_code=500, detail=str(exc)) from exc

    if output_mode == OutputMode.booru:
        if tags:
            tags = force_uncensored_tags(tags)
            prompt = tags_to_prompt(tags)
        else:
            prompt = caption or ""
            if caption and not tags:
                # Parse joy booru-ish string into chips
                tags = [
                    TagScore(tag=part.strip(), score=0.5, category="general")
                    for part in caption.split(",")
                    if part.strip()
                ]
                tags = force_uncensored_tags(tags)
                prompt = tags_to_prompt(tags)
            else:
                prompt = force_uncensored_caption(prompt) or "uncensored"
    elif output_mode == OutputMode.caption:
        caption = force_uncensored_caption(caption)
        prompt = caption or "uncensored"
    else:
        if tags:
            tags = force_uncensored_tags(tags)
        caption = force_uncensored_caption(caption)
        tag_part = tags_to_prompt(tags)
        if caption and tag_part:
            prompt = f"{caption}\n\n{tag_part}"
        else:
            prompt = caption or tag_part or "uncensored"

    return TagResponse(
        mode=output_mode,
        tags=tags,
        prompt=prompt,
        caption=caption,
        source=source,
        device=_resolve_device(),
        mock=settings.mock_inference,
    )


def create_app(_settings: Settings | None = None) -> FastAPI:
    return app