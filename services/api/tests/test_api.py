from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image

# Force mock before app import side effects in tests via env
import os

os.environ["VISION_MOCK_INFERENCE"] = "1"
os.environ["VISION_ENABLE_JOY"] = "1"

from app.config import get_settings
from app.main import app

get_settings.cache_clear()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("VISION_MOCK_INFERENCE", "1")
    get_settings.cache_clear()
    # Re-bind settings on module singletons
    from app import main as main_mod
    from app.config import get_settings as gs
    from app.joy_caption import JoyCaptioner
    from app.wd_tagger import WdTagger

    settings = gs()
    main_mod.settings = settings
    main_mod.wd_tagger = WdTagger(settings)
    main_mod.joy_captioner = JoyCaptioner(settings)
    return TestClient(main_mod.app)


def _png_bytes() -> bytes:
    img = Image.new("RGB", (64, 64), color=(120, 180, 90))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_health(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["mock"] is True


def test_tag_hybrid(client: TestClient) -> None:
    res = client.post(
        "/tag",
        files={"file": ("sample.png", _png_bytes(), "image/png")},
        data={"mode": "hybrid", "threshold": "0.35", "enable_joy": "true", "enable_wd": "true"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "hybrid"
    assert data["prompt"]
    assert data["tags"]
    assert data["caption"]


def test_tag_booru(client: TestClient) -> None:
    res = client.post(
        "/tag",
        files={"file": ("sample.png", _png_bytes(), "image/png")},
        data={"mode": "booru", "enable_joy": "false", "enable_wd": "true"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["mode"] == "booru"
    assert "," in data["prompt"] or data["tags"]
    assert data["tags"][0]["tag"] == "uncensored"
    assert "uncensored" in data["prompt"]
    assert not any(
        t["tag"] in {"censored", "mosaic censoring", "bar censor"} for t in data["tags"]
    )
