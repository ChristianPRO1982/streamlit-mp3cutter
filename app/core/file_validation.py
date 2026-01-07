from pathlib import Path


class FileValidator:
    """Validate uploaded files before processing."""

    def __init__(self, max_size_mb: int) -> None:
        """Initialize validator with size constraints."""
        self._max_size_bytes = max_size_mb * 1024 * 1024
        self._allowed_extensions = {
            ".mp3",
            ".wav",
            ".m4a",
            ".aac",
            ".ogg",
            ".flac",
        }

    def validate_size(self, file_path: Path) -> bool:
        """Check if file size is within allowed limits."""
        return file_path.stat().st_size <= self._max_size_bytes

    def validate_extension(self, file_path: Path) -> bool:
        """Check if file extension is allowed."""
        return file_path.suffix.lower() in self._allowed_extensions
