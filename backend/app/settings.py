from pydantic import Field
from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    frontend_base_url: str = "http://127.0.0.1:3000"
    api_prefix: str = "/api"
    job_store_path: str = str(Path(__file__).resolve().parent / "procurelink_jobs.sqlite3")
    cors_allow_origins_raw: str = Field(
        default="http://127.0.0.1:3000,http://localhost:3000",
        alias="BACKEND_CORS_ORIGINS",
    )

    # Langfuse configuration for cost tracking
    langfuse_secret_key: str = Field(
        default="",
        alias="LANGFUSE_SECRET_KEY",
    )
    langfuse_public_key: str = Field(
        default="",
        alias="LANGFUSE_PUBLIC_KEY",
    )
    langfuse_base_url: str = Field(
        default="https://cloud.langfuse.com",
        alias="LANGFUSE_BASE_URL",
    )

    @property
    def cors_allow_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins_raw.split(",") if origin.strip()]


settings = Settings()
