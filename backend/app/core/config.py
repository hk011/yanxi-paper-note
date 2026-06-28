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
    deepseek_key: str = ""
    deepseek_url: str = "https://api.deepseek.com"
    deepseek_model: str = ""
    ark_image_gen_model: str = "doubao-seedream-5-0-260128"
    # 小节配图提示词优化（多模态，需支持 input_image）
    ark_figure_optimizer_model: str = "doubao-seed-2-0-lite-260428"

    sensenova_api_key: str = ""
    sensenova_api_url: str = "https://token.sensenova.cn/v1"
    sensenova_model: str = "sensenova-u1-fast"

    # 千帆百度搜索 MCP（streamableHttp），供自定义模型联网搜索
    web_search_mcp_server: str = "https://qianfan.baidubce.com/v2/tools/web-search/mcp"
    web_search_mcp_server_key: str = ""

    jwt_secret: str = "yanxi-dev-secret-change-in-prod"
    jwt_expire_hours: int = 72

    # QwenPaw Skill / CLI：设置后可用 X-Yanxi-Api-Key 头调用 /api/skill/*
    yanxi_api_key: str = ""
    yanxi_username: str = "qwenpaw"

    data_dir: Path = ROOT / "backend" / "data"
    db_path: Path = ROOT / "backend" / "yanxi.db"

    @property
    def model_list(self) -> list[str]:
        return [m.strip() for m in self.ark_multi_model_list.split(",") if m.strip()]

    @property
    def deepseek_model_list(self) -> list[str]:
        return [m.strip() for m in self.deepseek_model.split(",") if m.strip()]

    @property
    def deepseek_enabled(self) -> bool:
        return bool(
            self.deepseek_key.strip()
            and self.deepseek_url.strip()
            and self.deepseek_model_list
        )


def get_settings() -> Settings:
    """每次读取 .env，便于开发时修改 MCP 等配置后无需重启进程。"""
    s = Settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s
