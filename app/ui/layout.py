import streamlit as st

from app.core.config import AppConfig
from app.core.ffprobe_client import FfprobeClient
from app.core.file_storage import TempFileStorage
from app.core.file_validation import FileValidator
from app.ui.uploader import FileUploader


class AppLayout:
    """Render the Streamlit UI layout."""

    def __init__(self, config: AppConfig) -> None:
        """Initialize layout with configuration."""
        self._config = config
        self._storage = TempFileStorage(config)
        self._validator = FileValidator(config.max_upload_mb)
        self._ffprobe = FfprobeClient()
        self._uploader = FileUploader(
            storage=self._storage,
            validator=self._validator,
            ffprobe=self._ffprobe,
        )

    def configure_page(self) -> None:
        """Configure Streamlit page settings."""
        st.set_page_config(
            page_title=self._config.app_title,
            page_icon=self._config.app_icon,
            layout=self._config.page_layout,
        )

    def render(self) -> None:
        """Render full application layout."""
        st.title(f"{self._config.app_icon} {self._config.app_title}")
        st.caption("Upload an audio file to inspect it before cutting.")
        self._uploader.render()
