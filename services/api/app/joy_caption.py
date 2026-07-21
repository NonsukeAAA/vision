from __future__ import annotations

from typing import Any

from PIL import Image

from .config import Settings

# Scene / expression focused caption prompt (JoyCaption instruction style)
SCENE_EXPRESSION_PROMPT = (
    "Write a long descriptive caption for this image in a formal tone. "
    "Emphasize facial expression, emotion, gaze, body language, atmosphere, "
    "lighting, background scenery, and spatial composition in precise detail."
)

BOORU_TAG_PROMPT = (
    "Generate only comma-separated Danbooru tags (lowercase with spaces). "
    "Strict order: character, then general tags. Include counts (1girl), appearance, "
    "clothing, accessories, pose, expression, actions, background. "
    "Never use censored, mosaic, bar censor, or any censoring tags. "
    "Always include the tag uncensored. "
    "Use precise Danbooru-style tags. No extra text."
)


class JoyCaptioner:
    """JoyCaption Beta One — local VLM for detailed scene/expression captions."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._processor = None
        self._model = None
        self._torch = None
        self.device = "cpu"

    @property
    def ready(self) -> bool:
        return self._model is not None or self.settings.mock_inference

    @property
    def available(self) -> bool:
        if self.settings.mock_inference:
            return True
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401

            return True
        except ImportError:
            return False

    def ensure_loaded(self) -> None:
        if self._model is not None or self.settings.mock_inference:
            return
        if not self.settings.enable_joy:
            raise RuntimeError("JoyCaption is disabled")

        import torch
        from transformers import AutoProcessor, LlavaForConditionalGeneration

        self._torch = torch
        if self.settings.device == "cuda" or (
            self.settings.device == "auto" and torch.cuda.is_available()
        ):
            self.device = "cuda"
            dtype = torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            device_map = "cuda"
        else:
            self.device = "cpu"
            dtype = torch.float32
            device_map = "cpu"

        self._processor = AutoProcessor.from_pretrained(self.settings.joy_repo)
        self._model = LlavaForConditionalGeneration.from_pretrained(
            self.settings.joy_repo,
            torch_dtype=dtype,
            device_map=device_map,
        )
        self._model.eval()

    def caption(self, image: Image.Image, *, booru_tags: bool = False) -> str:
        self.ensure_loaded()
        prompt = BOORU_TAG_PROMPT if booru_tags else SCENE_EXPRESSION_PROMPT

        if self.settings.mock_inference:
            if booru_tags:
                return (
                    "1girl, smile, closed mouth, looking at viewer, soft lighting, "
                    "detailed background, outdoors, emotional atmosphere"
                )
            return (
                "A person stands in a softly lit scene, expression calm yet attentive, "
                "eyes directed toward the viewer. The background scenery is detailed, "
                "with layered depth, ambient light, and a quiet emotional atmosphere."
            )

        assert self._processor is not None and self._model is not None and self._torch is not None
        torch = self._torch
        rgb = image.convert("RGB")
        convo = [
            {"role": "system", "content": "You are a helpful image captioner."},
            {"role": "user", "content": prompt},
        ]
        convo_string = self._processor.apply_chat_template(
            convo, tokenize=False, add_generation_prompt=True
        )
        assert isinstance(convo_string, str)
        inputs = self._processor(text=[convo_string], images=[rgb], return_tensors="pt")
        target = self.device
        inputs = {k: v.to(target) if hasattr(v, "to") else v for k, v in inputs.items()}
        if "pixel_values" in inputs and self.device == "cuda":
            inputs["pixel_values"] = inputs["pixel_values"].to(
                dtype=self._model.dtype
            )

        with torch.inference_mode():
            generate_ids = self._model.generate(
                **inputs,
                max_new_tokens=512,
                do_sample=True,
                temperature=0.6,
                top_p=0.9,
                use_cache=True,
            )[0]
        trimmed = generate_ids[inputs["input_ids"].shape[1] :]
        text = self._processor.tokenizer.decode(
            trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )
        return text.strip()

    def status(self) -> dict[str, Any]:
        return {
            "ready": self.ready,
            "available": self.available,
            "device": self.device,
            "repo": self.settings.joy_repo,
        }