from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from database import User, get_current_user, get_db, hash_password, token_for, verify_password

router = APIRouter(prefix="/api", tags=["Authentication"])


class RegisterPayload(BaseModel):
    username: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    checkboss: bool = False


class LoginPayload(BaseModel):
    username: str
    password: str


def _register(data: RegisterPayload, db: Session):
    existing = db.query(User).filter(User.username == data.username).first()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.")

    user = User(
        username=data.username,
        password_hash=hash_password(data.password),
        checkboss=bool(data.checkboss),
    )
    db.add(user)
    try:
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "That username is already taken.")

    return {"token": token_for(user), "username": user.username, "checkboss": user.checkboss}


def _login(data: LoginPayload, db: Session):
    user = db.query(User).filter(User.username == data.username).first()
    if user is None or not verify_password(data.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Username or password is incorrect.")

    return {"token": token_for(user), "username": user.username, "checkboss": user.checkboss}


@router.post("/register", status_code=201)
def register(data: RegisterPayload, db: Session = Depends(get_db)):
    return _register(data, db)


@router.post("/auth/register", status_code=201)
def auth_register(data: RegisterPayload, db: Session = Depends(get_db)):
    return _register(data, db)


@router.post("/login")
def login(data: LoginPayload, db: Session = Depends(get_db)):
    return _login(data, db)


@router.post("/auth/login")
def auth_login(data: LoginPayload, db: Session = Depends(get_db)):
    return _login(data, db)


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return {"id": user.id, "username": user.username, "checkboss": user.checkboss}


@router.post("/me/checkboss")
def toggle_checkboss(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.checkboss = not user.checkboss
    db.commit()
    return {"id": user.id, "username": user.username, "checkboss": user.checkboss}
