"""Persistent ZIP storage for organized batches."""

from pathlib import Path
from hashlib import sha256

ARCHIVES_DIR = Path(__file__).resolve().parent.parent / "organized_archives"
ARCHIVES_DIR.mkdir(parents=True, exist_ok=True)


def archive_path(job_id: int, db) -> Path:
    database_url = db.get_bind().url.render_as_string(hide_password=True)
    namespace = sha256(database_url.encode("utf-8")).hexdigest()[:16]
    return ARCHIVES_DIR / namespace / f"{job_id}.zip"


def save_archive(job_id: int, content: bytes, db) -> Path:
    path = archive_path(job_id, db)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_suffix(".zip.tmp")
    temporary_path.write_bytes(content)
    temporary_path.replace(path)
    return path
