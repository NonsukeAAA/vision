from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
from huggingface_hub import hf_hub_download
from PIL import Image

from .config import Settings
from .schemas import TagScore


def _pad_square(image: Image.Image, fill=(255, 255, 255)) -> Image.Image:
    w, h = image.size
    size = max(w, h)
    canvas = Image.new("RGB", (size, size), fill)
    canvas.paste(image, ((size - w) // 2, (size - h) // 2))
    return canvas


class WdTagger:
    """SmilingWolf WD EVA02-Large Tagger v3 (ONNX)."""

    TARGET = 448

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._session = None
        self._tags: list[tuple[str, int]] = []
        self.model_path: Path | None = None
        self.tags_path: Path | None = None

    @property
    def ready(self) -> bool:
        return self._session is not None and bool(self._tags)

    def ensure_loaded(self) -> None:
        if self.ready:
            return
        if self.settings.mock_inference:
            self._tags = [
                ("1girl", 0),
                ("smile", 0),
                ("outdoors", 0),
                ("looking_at_viewer", 0),
                ("blue_sky", 0),
            ]
            self._session = "mock"
            return

        import onnxruntime as ort

        model_dir = self.settings.model_dir / "wd-eva02-large-tagger-v3"
        model_dir.mkdir(parents=True, exist_ok=True)
        self.model_path = Path(
            hf_hub_download(
                self.settings.wd_repo,
                "model.onnx",
                local_dir=str(model_dir),
            )
        )
        self.tags_path = Path(
            hf_hub_download(
                self.settings.wd_repo,
                "selected_tags.csv",
                local_dir=str(model_dir),
            )
        )
        self._tags = self._load_tags(self.tags_path)
        providers = ["CPUExecutionProvider"]
        if self.settings.device in ("auto", "cuda"):
            available = ort.get_available_providers()
            if "CUDAExecutionProvider" in available and self.settings.device != "cpu":
                providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self._session = ort.InferenceSession(str(self.model_path), providers=providers)

    @staticmethod
    def _load_tags(path: Path) -> list[tuple[str, int]]:
        rows: list[tuple[str, int]] = []
        with path.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                name = row.get("name") or row.get("tag") or ""
                category = int(row.get("category", 0))
                rows.append((name, category))
        return rows

    def _preprocess(self, image: Image.Image) -> np.ndarray:
        rgb = image.convert("RGB")
        square = _pad_square(rgb)
        resized = square.resize((self.TARGET, self.TARGET), Image.Resampling.BICUBIC)
        arr = np.asarray(resized, dtype=np.float32)
        # WD v3 ONNX expects BGR
        arr = arr[:, :, ::-1]
        arr = np.expand_dims(arr, 0)
        return arr

    def tag(
        self,
        image: Image.Image,
        threshold: float = 0.35,
        character_threshold: float = 0.85,
        include_rating: bool = False,
    ) -> list[TagScore]:
        self.ensure_loaded()
        if self.settings.mock_inference:
            return [
                TagScore(tag=t.replace("_", " "), score=0.9 - i * 0.05, category="general")
                for i, (t, _) in enumerate(self._tags)
            ]

        tensor = self._preprocess(image)
        input_name = self._session.get_inputs()[0].name
        outputs = self._session.run(None, {input_name: tensor})
        probs = outputs[0][0].astype(np.float32)

        results: list[TagScore] = []
        category_map = {0: "general", 4: "character", 9: "rating"}
        for (name, cat), score in zip(self._tags, probs):
            label = category_map.get(cat, "general")
            if label == "rating" and not include_rating:
                continue
            cut = character_threshold if label == "character" else threshold
            if float(score) < cut:
                continue
            results.append(
                TagScore(
                    tag=name.replace("_", " "),
                    score=float(score),
                    category=label,
                )
            )
        results.sort(key=lambda t: t.score, reverse=True)
        return results


def tags_to_prompt(tags: list[TagScore]) -> str:
    return ", ".join(t.tag for t in tags)