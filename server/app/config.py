from pydantic_settings import BaseSettings
from pathlib import Path


class Settings(BaseSettings):
    # 项目信息
    APP_NAME: str = "Home Accountant"
    APP_VERSION: str = "0.1.0"
    DEBUG: bool = True

    # 数据库
    DATABASE_DIR: Path = Path(__file__).resolve().parent.parent / "data"
    DATABASE_NAME: str = "home_accountant.db"

    @property
    def DATABASE_URL(self) -> str:
        self.DATABASE_DIR.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.DATABASE_DIR / self.DATABASE_NAME}"

    # JWT
    JWT_SECRET_KEY: str = "dev-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 天

    # CORS
    CORS_ORIGINS: list[str] = ["http://localhost:8081", "http://localhost:19006", "http://localhost:3000"]

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
