from __future__ import annotations

import shutil
import time
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class CleanupService:
    """Handle cleanup of stored data."""

    projects_root: Path

    def delete_project(self, project_id: str) -> None:
        """Delete a single project directory."""
        path = self.projects_root / project_id
        if path.exists():
            shutil.rmtree(path)

    def delete_all_projects(self) -> int:
        """Delete all projects and return count deleted."""
        if not self.projects_root.exists():
            return 0

        deleted = 0
        for item in self.projects_root.iterdir():
            if item.is_dir():
                shutil.rmtree(item)
                deleted += 1
        return deleted

    def delete_projects_older_than_hours(self, older_than_hours: int) -> int:
        """Delete projects older than a given age in hours and return count."""
        if older_than_hours <= 0:
            return 0
        if not self.projects_root.exists():
            return 0

        now = time.time()
        threshold_s = older_than_hours * 3600
        deleted = 0

        for item in self.projects_root.iterdir():
            if not item.is_dir():
                continue
            age_s = now - item.stat().st_mtime
            if age_s >= threshold_s:
                shutil.rmtree(item)
                deleted += 1

        return deleted
