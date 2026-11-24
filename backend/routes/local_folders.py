from __future__ import annotations

import json
import mimetypes
import os
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import OrganizeJob, User, get_current_user, get_db
from services.archive_store import save_archive
from services.organizer import (
    IMAGE_EXTENSIONS,
    build_zip,
    extract_text,
    generate_thumbnail_from_path,
    organize_file_records,
    summarize_document,
)
from services.pdf_preview import render_pdf_page

router = APIRouter(prefix="/api/local", tags=["Local Folders"])


class ScanRequest(BaseModel):
    path: str | None = None


class OrganizeRequest(BaseModel):
    path: str | None = None
    dry_run: bool = False


def resolve_path(target: str | None) -> Path:
    home = Path.home()
    if not target or target.strip().lower() in {"desktop", "~/desktop"}:
        return home / "Desktop"
    if target.strip().lower() in {"downloads", "~/downloads"}:
        return home / "Downloads"
    if target.strip().lower() in {"documents", "~/documents"}:
        return home / "Documents"
    return Path(os.path.expanduser(target.strip())).resolve()


@router.post("/scan")
def scan_directory(req: ScanRequest, _: User = Depends(get_current_user)):
    target = resolve_path(req.path)
    if not target.exists() or not target.is_dir():
        raise HTTPException(404, f"Directory not found: {target}")

    loose_files = []
    for entry in target.iterdir():
        # Only files sitting directly in target directory (not in subfolders already, not hidden)
        if entry.is_file() and not entry.name.startswith("."):
            try:
                stat = entry.stat()
                loose_files.append({
                    "name": entry.name,
                    "path": str(entry.resolve()),
                    "size": stat.st_size,
                    "extension": entry.suffix.lower(),
                })
            except Exception:
                continue

    loose_files.sort(key=lambda x: str(x["name"]).lower())
    return {
        "target_path": str(target),
        "unorganized_count": len(loose_files),
        "files": loose_files,
    }


@router.post("/organize")
def organize_local_folder(req: OrganizeRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    target = resolve_path(req.path)
    if not target.exists() or not target.is_dir():
        raise HTTPException(404, f"Directory not found: {target}")

    loose_files = []
    for entry in target.iterdir():
        if entry.is_file() and not entry.name.startswith("."):
            loose_files.append(entry)

    if not loose_files:
        return {"target_path": str(target), "moved_count": 0, "folder_count": 0, "folders": [], "manifest": [], "dry_run": req.dry_run}

    payloads = []
    file_map = {}
    for entry in loose_files[:150]:
        file_map[entry.name] = entry
        try:
            with open(entry, "rb") as f:
                content = f.read(10 * 1024 * 1024)
            payloads.append((entry.name, content))
        except Exception:
            continue

    folders, manifest = organize_file_records(payloads)

    moved_count = 0
    if not req.dry_run:
        for folder_name, entries in folders.items():
            dest_dir = target / folder_name
            dest_dir.mkdir(parents=True, exist_ok=True)
            for file_name, _ in entries:
                src = file_map.get(file_name)
                if src and src.exists():
                    dest = dest_dir / file_name
                    if dest.exists():
                        c = 1
                        while dest.exists():
                            dest = dest_dir / f"{src.stem}_{c}{src.suffix}"
                            c += 1
                    try:
                        shutil.move(str(src), str(dest))
                        moved_count += 1
                        try:
                            generate_thumbnail_from_path(dest)
                        except Exception:
                            pass
                    except Exception:
                        pass
    else:
        moved_count = len(payloads)

    summary = [{"name": f, "count": len(entries)} for f, entries in folders.items()]

    if not req.dry_run and moved_count > 0:
        try:
            job = OrganizeJob(
                user_id=user.id,
                job_type="local_folder",
                source_path=str(target),
                file_count=moved_count,
                folder_count=len(folders),
                summary_json=json.dumps(summary),
            )
            db.add(job)
            db.flush()
            save_archive(job.id, build_zip(folders, manifest).getvalue(), db)
            db.commit()
        except Exception:
            db.rollback()

    return {
        "target_path": str(target),
        "moved_count": moved_count,
        "folder_count": len(folders),
        "folders": summary,
        "manifest": manifest,
        "dry_run": req.dry_run,
    }


class LocalFilePreviewRequest(BaseModel):
    path: str | None = None
    filename: str
    folder: str | None = ""
    custom_instructions: str | None = None


class LocalPdfPageRequest(LocalFilePreviewRequest):
    page: int = 0


@router.post("/file/pdf-page")
def render_local_pdf_page(
    req: LocalPdfPageRequest,
    _: User = Depends(get_current_user),
):
    home = Path.home()
    target_dir = resolve_path(req.path)
    candidates = [
        target_dir / (req.folder or "") / req.filename,
        target_dir / req.filename,
        home / "Downloads" / (req.folder or "") / req.filename,
        home / "Downloads" / req.filename,
        home / "Desktop" / (req.folder or "") / req.filename,
        home / "Desktop" / req.filename,
        home / "Documents" / (req.folder or "") / req.filename,
        home / "Documents" / req.filename,
    ]
    found_path = next((path for path in candidates if path.is_file()), None)
    if found_path is None:
        raise HTTPException(404, f"File {req.filename} not found on local disk.")
    if found_path.suffix.lower() != ".pdf":
        raise HTTPException(415, "This preview endpoint accepts PDF files only.")
    if found_path.stat().st_size > 50 * 1024 * 1024:
        raise HTTPException(413, "PDF exceeds the 50 MB preview limit.")
    try:
        image, page_count = render_pdf_page(found_path.read_bytes(), req.page)
    except IndexError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        image,
        media_type="image/png",
        headers={"X-PDF-Page-Count": str(page_count), "Cache-Control": "no-store"},
    )


@router.post("/file/open")
def open_local_file(
    req: LocalFilePreviewRequest,
    _: User = Depends(get_current_user),
):
    home = Path.home()
    target_dir = resolve_path(req.path)
    candidates = [
        target_dir / (req.folder or "") / req.filename,
        target_dir / req.filename,
        home / "Downloads" / (req.folder or "") / req.filename,
        home / "Downloads" / req.filename,
        home / "Desktop" / (req.folder or "") / req.filename,
        home / "Desktop" / req.filename,
        home / "Documents" / (req.folder or "") / req.filename,
        home / "Documents" / req.filename,
    ]
    found_path = next((path for path in candidates if path.is_file()), None)
    if found_path is None:
        raise HTTPException(404, f"File {req.filename} not found on local disk.")

    media_type = mimetypes.guess_type(found_path.name)[0] or "application/octet-stream"
    return FileResponse(
        found_path,
        media_type=media_type,
        filename=found_path.name,
        content_disposition_type="inline",
    )


@router.post("/file/preview")
def preview_local_file(req: LocalFilePreviewRequest, _: User = Depends(get_current_user)):
    home = Path.home()
    target_dir = resolve_path(req.path)

    candidate_paths = [
        target_dir / (req.folder or "") / req.filename,
        target_dir / req.filename,
        home / "Downloads" / (req.folder or "") / req.filename,
        home / "Downloads" / req.filename,
        home / "Desktop" / (req.folder or "") / req.filename,
        home / "Desktop" / req.filename,
        home / "Documents" / (req.folder or "") / req.filename,
        home / "Documents" / req.filename,
    ]

    found_path = None
    for p in candidate_paths:
        if p.exists() and p.is_file():
            found_path = p
            break

    if not found_path:
        raise HTTPException(404, f"File {req.filename} not found on local disk.")

    try:
        with open(found_path, "rb") as f:
            content = f.read(15 * 1024 * 1024)
        ext = found_path.suffix.lower()
        if ext in IMAGE_EXTENSIONS:
            return summarize_document(found_path.name, folder=req.folder or "", image_bytes=content, custom_instructions=req.custom_instructions or "")
        text = extract_text(found_path.name, content)
        return summarize_document(found_path.name, text=text, folder=req.folder or "", custom_instructions=req.custom_instructions or "")
    except Exception as exc:
        raise HTTPException(500, f"Could not read file {req.filename}: {exc}")
