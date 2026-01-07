import json
import subprocess
from pathlib import Path

from app.core.audio_metadata import AudioMetadata


class FfprobeError(RuntimeError):
    """Raised when ffprobe fails or returns invalid output."""


class FfprobeClient:
    """Extract audio metadata using ffprobe."""

    def __init__(self, executable: str = "ffprobe") -> None:
        """Initialize the client with an ffprobe executable name/path."""
        self._executable = executable

    def is_available(self) -> bool:
        """Return True if ffprobe is callable."""
        try:
            self._run(["-version"])
            return True
        except FfprobeError:
            return False

    def read_metadata(self, file_path: Path) -> AudioMetadata:
        """Read metadata from an audio file."""
        payload = self._probe_json(file_path)
        fmt = payload.get("format", {})
        streams = payload.get("streams", [])
        audio_stream = self._first_audio_stream(streams)

        duration = self._to_float(fmt.get("duration"))
        bitrate = self._to_int(fmt.get("bit_rate"))
        codec = audio_stream.get("codec_name") if audio_stream else None
        sample_rate = self._to_int(audio_stream.get("sample_rate")) if audio_stream else None
        channels = self._to_int(audio_stream.get("channels")) if audio_stream else None

        return AudioMetadata(
            duration_seconds=duration,
            codec_name=codec,
            bitrate_bps=bitrate,
            sample_rate_hz=sample_rate,
            channels=channels,
        )

    def _probe_json(self, file_path: Path) -> dict:
        """Run ffprobe and return parsed JSON."""
        args = [
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(file_path),
        ]
        output = self._run(args)
        try:
            return json.loads(output)
        except json.JSONDecodeError as exc:
            raise FfprobeError("ffprobe returned invalid JSON") from exc

    def _run(self, args: list[str]) -> str:
        """Execute ffprobe and return stdout."""
        cmd = [self._executable, *args]
        try:
            completed = subprocess.run(
                cmd,
                check=True,
                capture_output=True,
                text=True,
            )
            return completed.stdout.strip()
        except FileNotFoundError as exc:
            raise FfprobeError("ffprobe not found in PATH") from exc
        except subprocess.CalledProcessError as exc:
            stderr = (exc.stderr or "").strip()
            raise FfprobeError(f"ffprobe failed: {stderr}") from exc

    def _first_audio_stream(self, streams: list[dict]) -> dict | None:
        """Return the first audio stream dict if present."""
        for stream in streams:
            if stream.get("codec_type") == "audio":
                return stream
        return None

    def _to_float(self, value: object) -> float:
        """Convert a value to float or raise."""
        try:
            return float(value)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise FfprobeError("Missing or invalid duration from ffprobe") from exc

    def _to_int(self, value: object) -> int | None:
        """Convert a value to int when possible."""
        if value is None:
            return None
        try:
            return int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
