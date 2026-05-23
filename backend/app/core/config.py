from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[3]
ENV_FILE = ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    mineru_api_token: str = ""
    mineru_base_url: str = "https://mineru.net/api"

    ark_key: str = ""
    ark_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_multi_model_list: str = "doubao-seed-2-0-pro-260215"
    ark_image_gen_model: str = "doubao-seedream-5-0-260128"

    jwt_secret: str = "yanxi-dev-secret-change-in-prod"
    jwt_expire_hours: int = 72

    data_dir: Path = ROOT / "backend" / "data"
    db_path: Path = ROOT / "backend" / "yanxi.db"

    @property
    def model_list(self) -> list[str]:
        return [m.strip() for m in self.ark_multi_model_list.split(",") if m.strip()]


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
