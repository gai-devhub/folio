from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Generator
from urllib.parse import quote_plus

import jwt
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

# Load root .env
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

SECRET = os.getenv("ORGANIZER_SECRET", "folio-file-organizer-secret-key-at-least-32-chars-long")
MAX_UPLOAD = int(os.getenv("MAX_UPLOAD_BYTES", 50 * 1024 * 1024))
FRONTEND_ORIGINS = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173").split(",")
    if origin.strip()
]

# MySQL configuration
mysql_user = quote_plus(os.getenv("MYSQL_USER", "organizer"))
mysql_pass = quote_plus(os.getenv("MYSQL_PASSWORD", "organizer_dev_password"))
mysql_host = os.getenv("MYSQL_HOST", "127.0.0.1")
mysql_port = os.getenv("MYSQL_PORT", "3306")
mysql_db = quote_plus(os.getenv("MYSQL_DATABASE", "file_organizer"))

DEFAULT_MYSQL_URL = f"mysql+mysqlconnector://{mysql_user}:{mysql_pass}@{mysql_host}:{mysql_port}/{mysql_db}"
DEFAULT_SQLITE_PATH = BACKEND_DIR / "organizer.db"
DATABASE_URL = os.getenv("DATABASE_URL", DEFAULT_MYSQL_URL)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    checkboss: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


class OrganizeJob(Base):
    __tablename__ = "organize_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    job_type: Mapped[str] = mapped_column(String(50), default="upload")
    source_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_count: Mapped[int] = mapped_column(Integer, default=0)
    folder_count: Mapped[int] = mapped_column(Integer, default=0)
    summary_json: Mapped[str] = mapped_column(Text, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), nullable=False)


def _init_engine():
    global active_db_url, active_db_type
    active_db_url = DATABASE_URL
    active_db_type = "mysql" if DATABASE_URL.startswith("mysql") else "custom"
    return create_engine(DATABASE_URL, pool_pre_ping=True)


active_db_type = "mysql"
active_db_url = DATABASE_URL
engine = _init_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    """Create the application tables in MySQL; fail clearly if it is unavailable."""
    if str(engine.url).startswith("sqlite"):
        p = Path(str(engine.url).replace("sqlite:///", ""))
        p.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


# Password & Auth utilities
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${salt.hex()}${derived.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, salt_hex, digest_hex = stored.split("$", 2)
        if scheme != "scrypt":
            return False
        expected = bytes.fromhex(digest_hex)
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=bytes.fromhex(salt_hex),
            n=2**14,
            r=8,
            p=1,
            dklen=len(expected),
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False


def token_for(user: User) -> str:
    return jwt.encode({"sub": user.username}, SECRET, algorithm="HS256")


def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Please sign in to continue.")
    token = authorization[7:].strip()
    try:
        username = jwt.decode(token, SECRET, algorithms=["HS256"]).get("sub")
        if not username:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired.")

    user = db.query(User).filter(User.username == username).first()
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found.")
    return user
