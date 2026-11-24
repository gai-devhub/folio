from __future__ import annotations

import json
import io
import zipfile
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import MAX_UPLOAD, OrganizeJob, User, get_current_user, get_db
from services.archive_store import archive_path, save_archive
from services.organizer import (
    IMAGE_EXTENSIONS,
    THUMBNAILS_DIR,
    build_zip,
    chat_with_document,
    extract_text,
    generate_thumbnail_from_bytes,
    generate_thumbnail_from_path,
    organize_file_records,
    summarize_document,
)
from services.pdf_preview import render_pdf_page

router = APIRouter(prefix="/api", tags=["Organize"])


class ArchiveDownloadRequest(BaseModel):
    job_ids: list[int]


@router.get("/organize/archives")
def list_organized_archives(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    jobs = (
        db.query(OrganizeJob)
        .filter(OrganizeJob.user_id == user.id)
        .order_by(OrganizeJob.created_at.desc())
        .all()
    )
    return {
        "batches": [
            {
                "id": job.id,
                "date": job.created_at.isoformat(),
                "file_count": job.file_count,
                "archive_available": archive_path(job.id, db).is_file(),
            }
            for job in jobs
        ]
    }


@router.post("/organize/archives/download")
def download_organized_archives(
    req: ArchiveDownloadRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    requested_ids = list(dict.fromkeys(req.job_ids))
    if not requested_ids:
        raise HTTPException(400, "Choose at least one organized batch to download.")

    jobs = (
        db.query(OrganizeJob)
        .filter(OrganizeJob.user_id == user.id, OrganizeJob.id.in_(requested_ids))
        .order_by(OrganizeJob.created_at.asc())
        .all()
    )
    available = [job for job in jobs if archive_path(job.id, db).is_file()]
    if not available:
        raise HTTPException(404, "There are no saved ZIP files for this date range yet.")

    combined = io.BytesIO()
    with zipfile.ZipFile(combined, "w", zipfile.ZIP_DEFLATED) as output:
        for job in available:
            batch_label = job.created_at.strftime("%Y-%m-%d")
            batch_folder = f"Batch_{batch_label}_{job.id}"
            try:
                with zipfile.ZipFile(archive_path(job.id, db), "r") as source:
                    for item in source.infolist():
                        if item.is_dir():
                            continue
                        output.writestr(f"{batch_folder}/{item.filename}", source.read(item))
            except (OSError, zipfile.BadZipFile) as exc:
                raise HTTPException(500, f"Could not read the saved ZIP for batch {job.id}.") from exc
    combined.seek(0)
    return StreamingResponse(combined, media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=organized-files.zip",
    })


@router.get("/file/thumbnail")
def get_file_thumbnail(
    filename: str,
    folder: str | None = None,
    path: str | None = None,
):
    safe_name = f"{filename}.png"
    cached = THUMBNAILS_DIR / safe_name
    if cached.exists() and cached.stat().st_size > 500:
        return FileResponse(cached, media_type="image/png")

    import os
    candidates = []
    if path:
        base = Path(path)
        candidates.extend([base / (folder or "") / filename, base / filename])
    if folder:
        desktop = Path.home() / "Desktop"
        downloads = Path.home() / "Downloads"
        candidates.extend([
            desktop / folder / filename,
            downloads / folder / filename,
            desktop / filename,
            downloads / filename,
        ])

    for c in candidates:
        if c.exists() and c.is_file():
            res = generate_thumbnail_from_path(c)
            if res and os.path.exists(res):
                return FileResponse(res, media_type="image/png")

    desktop = Path.home() / "Desktop"
    try:
        found = list(desktop.glob(f"**/{filename}"))
        if found:
            res = generate_thumbnail_from_path(found[0])
            if res and os.path.exists(res):
                return FileResponse(res, media_type="image/png")
    except Exception:
        pass

    raise HTTPException(404, f"Thumbnail not found for {filename}")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    filename: str
    folder: str | None = ""
    content: str | None = ""
    message: str
    history: list[ChatMessage] | None = None
    assistant_mode: Literal["auto", "gil_v1", "gil_v2"] = "auto"
    thinking_level: Literal["low", "medium", "high"] = "medium"
    custom_instructions: str | None = None
    attachment_context: str | None = None


@router.post("/file/chat")
def chat_document(req: ChatRequest, _: User = Depends(get_current_user)):
    history_dicts = [{"role": h.role, "content": h.content} for h in (req.history or [])]
    reply = chat_with_document(
        filename=req.filename,
        content=req.content or "",
        message=req.message,
        history=history_dicts,
        folder=req.folder or "",
        assistant_mode=req.assistant_mode,
        thinking_level=req.thinking_level,
        custom_instructions=req.custom_instructions or "",
        attachment_context=req.attachment_context or "",
    )
    return {"reply": reply, "filename": req.filename}


class SummarizeRequest(BaseModel):
    filename: str
    folder: str | None = ""
    text: str | None = None
    custom_instructions: str | None = None


@router.post("/file/summarize")
def summarize_text(req: SummarizeRequest, _: User = Depends(get_current_user)):
    return summarize_document(req.filename, req.text or "", req.folder or "", custom_instructions=req.custom_instructions or "")


@router.post("/file/preview")
async def preview_uploaded_file(
    file: UploadFile = File(...),
    folder: str = "",
    custom_instructions: str = Form(""),
    _: User = Depends(get_current_user)
):
    content = await file.read(15 * 1024 * 1024)
    filename = file.filename or "file"
    ext = Path(filename).suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        return summarize_document(filename, folder=folder, image_bytes=content, custom_instructions=custom_instructions)
    text = extract_text(filename, content)
    return summarize_document(filename, text=text, folder=folder, custom_instructions=custom_instructions)


@router.post("/file/pdf-page")
async def render_uploaded_pdf_page(
    file: UploadFile = File(...),
    page: int = Form(0),
    _: User = Depends(get_current_user),
):
    filename = file.filename or "document.pdf"
    if Path(filename).suffix.lower() != ".pdf":
        raise HTTPException(415, "This preview endpoint accepts PDF files only.")
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(413, "PDF exceeds the 50 MB preview limit.")
    try:
        image, page_count = render_pdf_page(content, page)
    except IndexError as exc:
        raise HTTPException(404, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    return Response(
        image,
        media_type="image/png",
        headers={"X-PDF-Page-Count": str(page_count), "Cache-Control": "no-store"},
    )


async def read_uploads(files: list[UploadFile]) -> list[tuple[str, bytes]]:
    if not files:
        raise HTTPException(400, "Choose at least one file.")
    payloads = []
    total = 0
    for upload in files:
        name = Path(upload.filename or "file").name
        content = await upload.read(MAX_UPLOAD + 1)
        total += len(content)
        if len(content) > MAX_UPLOAD or total > MAX_UPLOAD:
            raise HTTPException(413, "Upload limit is 50 MB per request.")
        payloads.append((name, content))
    return payloads


@router.post("/organize")
async def organize_uploads(
    files: Annotated[list[UploadFile], File()],
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    payloads = await read_uploads(files)
    for name, content in payloads:
        try:
            generate_thumbnail_from_bytes(name, content)
        except Exception:
            pass
    folders, manifest = organize_file_records(payloads)
    archive = build_zip(folders, manifest)
    summary = [{"name": name, "count": len(entries)} for name, entries in folders.items()]
    manifest_headers = [{"name": m["name"], "folder": m["folder"], "reason": m["reason"]} for m in manifest]
    job = OrganizeJob(
        user_id=user.id,
        job_type="upload",
        file_count=len(payloads),
        folder_count=len(folders),
        summary_json=json.dumps(summary),
    )
    db.add(job)
    db.flush()
    save_archive(job.id, archive.getvalue(), db)
    db.commit()
    archive.seek(0)
    return StreamingResponse(archive, media_type="application/zip", headers={
        "Content-Disposition": "attachment; filename=organized-files.zip",
        "X-Organized-Count": str(len(payloads)),
        "X-Folder-Count": str(len(folders)),
        "X-Organization-Summary": json.dumps(summary),
        "X-Organization-Manifest": json.dumps(manifest_headers),
    })


@router.post("/organize/preview")
async def preview_organize(
    files: Annotated[list[UploadFile], File()],
    _: User = Depends(get_current_user),
):
    payloads = await read_uploads(files)
    for name, content in payloads:
        try:
            generate_thumbnail_from_bytes(name, content)
        except Exception:
            pass
    folders, manifest = organize_file_records(payloads)
    summary = [{"name": name, "count": len(entries)} for name, entries in folders.items()]
    return {"total_files": len(payloads), "folder_count": len(folders), "folders": summary, "manifest": manifest}
