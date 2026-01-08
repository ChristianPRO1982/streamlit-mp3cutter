from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    app_name: str = "audio_splitter"
    data_dir: str = "data"
    host: str = "0.0.0.0"
    port: int = 8000


settings = Settings()
