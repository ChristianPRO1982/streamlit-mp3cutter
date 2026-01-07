from pathlib import Path
from uuid import uuid4

from app.core.config import AppConfig


class TempFileStorage:
    """Handle temporary storage of uploaded files."""

    def __init__(self, config: AppConfig) -> None:
        """Initialize storage with application configuration."""
        self._base_dir = config.temp_dir()
        self._base_dir.mkdir(exist_ok=True)

    def save(self, filename: str, content: bytes) -> Path:
        """Save uploaded file content to a temporary location."""
        safe_name = f"{uuid4().hex}_{filename}"
        file_path = self._base_dir / safe_name
        file_path.write_bytes(content)
        return file_path

    def clear(self) -> None:
        """Remove all temporary files."""
        for file in self._base_dir.glob("*"):
            if file.is_file():
                file.unlink()
