from dataclasses import dataclass


@dataclass(frozen=True)
class AudioMetadata:
    """Represent audio metadata extracted from ffprobe."""

    duration_seconds: float
    codec_name: str | None
    bitrate_bps: int | None
    sample_rate_hz: int | None
    channels: int | None

    def duration_hms(self) -> str:
        """Format duration in HH:MM:SS."""
        total = int(round(self.duration_seconds))
        hours = total // 3600
        minutes = (total % 3600) // 60
        seconds = total % 60
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
