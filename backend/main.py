"""Folio FastAPI entry point. Run `uvicorn main:app --reload` from backend/."""
from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

import database
from database import FRONTEND_ORIGINS, get_db, init_db
from routes.auth import router as auth_router
from routes.dashboard import router as dashboard_router
from routes.local_folders import router as local_folders_router
from routes.organize import router as organize_router


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Folio File Organizer API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "X-Organized-Count",
        "X-Folder-Count",
        "X-Organization-Summary",
        "X-Organization-Manifest",
        "X-PDF-Page-Count",
    ],
)

app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(local_folders_router)
app.include_router(organize_router)


@app.get("/api/health", tags=["Health"])
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.exception("MySQL health check failed")
        raise HTTPException(status_code=503, detail="MySQL is unavailable. Check the database service and connection settings.") from exc
    return {
        "status": "ok",
        "database": database.active_db_type,
        "connected": True,
    }
logger = logging.getLogger("folio.api")

