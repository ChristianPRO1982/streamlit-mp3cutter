from fastapi import APIRouter, HTTPException, Query

from app.core.config import settings
from app.services.cleanup import CleanupService
from app.storage.paths import StoragePaths

router = APIRouter()


@router.delete("/projects/{project_id}")
def delete_project(project_id: str) -> dict[str, str]:
    """Delete a single project and its files."""
    storage = StoragePaths(settings.data_dir)
    service = CleanupService(storage.projects_root)

    path = storage.projects_root / project_id
    if not path.exists():
        raise HTTPException(status_code=404, detail="Project not found")

    service.delete_project(project_id)
    return {"status": "deleted", "project_id": project_id}


@router.delete("/projects")
def delete_all_projects() -> dict[str, str]:
    """Delete all projects."""
    storage = StoragePaths(settings.data_dir)
    service = CleanupService(storage.projects_root)

    service.delete_all_projects()
    return {"status": "all_projects_deleted"}


@router.delete("/cleanup/projects")
def delete_old_projects(
    older_than_hours: int = Query(168, ge=1, le=24 * 365),
) -> dict[str, int]:
    """Delete projects older than a TTL expressed in hours."""
    storage = StoragePaths(settings.data_dir)
    service = CleanupService(storage.projects_root)

    deleted = service.delete_projects_older_than_hours(older_than_hours)
    return {"deleted": deleted}
