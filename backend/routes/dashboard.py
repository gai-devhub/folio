from __future__ import annotations

import json
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import OrganizeJob, User, get_current_user, get_db

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


@router.get("/stats")
def get_dashboard_stats(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    jobs = (
        db.query(OrganizeJob)
        .filter(OrganizeJob.user_id == user.id)
        .order_by(OrganizeJob.created_at.desc())
        .limit(10)
        .all()
    )

    total_files = sum(job.file_count for job in jobs)
    total_folders = sum(job.folder_count for job in jobs)

    recent_folders = []
    for job in jobs[:5]:
        try:
            items = json.loads(job.summary_json)
            if isinstance(items, list):
                for f in items:
                    if isinstance(f, dict):
                        recent_folders.append(f)
        except Exception:
            continue

    return {
        "username": user.username,
        "checkboss": user.checkboss,
        "total_organized_files": total_files,
        "total_folders_created": total_folders,
        "total_jobs": len(jobs),
        "recent_folders": recent_folders[:10],
    }
