import streamlit as st

from app.core.audio_metadata import AudioMetadata
from app.core.ffprobe_client import FfprobeClient, FfprobeError
from app.core.file_storage import TempFileStorage
from app.core.file_validation import FileValidator


class FileUploader:
    """Render and manage the file upload UI."""

    def __init__(
        self,
        storage: TempFileStorage,
        validator: FileValidator,
        ffprobe: FfprobeClient,
    ) -> None:
        """Initialize uploader with storage, validation, and ffprobe."""
        self._storage = storage
        self._validator = validator
        self._ffprobe = ffprobe

    def render(self) -> None:
        """Render file uploader component."""
        self._render_clear_temp()

        if not self._ffprobe.is_available():
            st.error("ffprobe is not available. Install FFmpeg to enable audio inspection.")
            return

        uploaded_file = st.file_uploader(
            label="Upload an audio file",
            type=None,
            accept_multiple_files=False,
        )

        if uploaded_file is None:
            return

        file_path = self._save_and_validate(uploaded_file)
        if file_path is None:
            return

        metadata = self._read_metadata(file_path)
        if metadata is None:
            return

        self._render_success(uploaded_file.name, file_path, metadata)

    def _render_clear_temp(self) -> None:
        """Render a button to clear temporary files."""
        if st.button("Clear temp files"):
            self._storage.clear()
            st.success("Temporary files cleared")

    def _save_and_validate(self, uploaded_file) -> object | None:
        """Save upload and validate extension and size."""
        file_path = self._storage.save(
            filename=uploaded_file.name,
            content=uploaded_file.read(),
        )

        if not self._validator.validate_extension(file_path):
            file_path.unlink()
            st.error("Unsupported audio format")
            return None

        if not self._validator.validate_size(file_path):
            file_path.unlink()
            st.error("File is too large")
            return None

        return file_path

    def _read_metadata(self, file_path) -> AudioMetadata | None:
        """Read metadata using ffprobe and handle errors."""
        try:
            return self._ffprobe.read_metadata(file_path)
        except FfprobeError as exc:
            st.error(str(exc))
            return None

    def _render_success(self, original_name: str, file_path, metadata: AudioMetadata) -> None:
        """Render upload + metadata summary."""
        st.success("File uploaded, validated, and inspected successfully")

        st.write(
            {
                "original_name": original_name,
                "extension": file_path.suffix,
                "stored_path": str(file_path),
                "size_mb": round(file_path.stat().st_size / 1024 / 1024, 2),
            }
        )

        st.subheader("Audio metadata")
        st.write(
            {
                "duration_seconds": round(metadata.duration_seconds, 3),
                "duration_hms": metadata.duration_hms(),
                "codec_name": metadata.codec_name,
                "bitrate_bps": metadata.bitrate_bps,
                "sample_rate_hz": metadata.sample_rate_hz,
                "channels": metadata.channels,
            }
        )
