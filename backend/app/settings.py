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

    @property
    def cors_allow_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_allow_origins_raw.split(",") if origin.strip()]


settings = Settings()
