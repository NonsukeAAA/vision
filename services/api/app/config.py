from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VISION_", env_file=".env", extra="ignore")

    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = "http://127.0.0.1:5173,http://localhost:5173,https://*.github.io"

    model_dir: Path = Path.home() / ".cache" / "vision" / "models"
    wd_repo: str = "SmilingWolf/wd-eva02-large-tagger-v3"
    joy_repo: str = "fancyfeast/llama-joycaption-beta-one-hf-llava"

    device: str = "auto"  # auto | cpu | cuda
    enable_joy: bool = True
    mock_inference: bool = False
    default_threshold: float = 0.35
    character_threshold: float = 0.85


@lru_cache
def get_settings() -> Settings:
    return Settings()