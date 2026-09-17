import base64
import hashlib
import hmac
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db import get_user_by_id


_SECRET = os.environ.get("SLM_AUTH_SECRET", "slm-dev-secret")  # dev-only default; set SLM_AUTH_SECRET in any real deployment
_TOKEN_TTL_HOURS = 24
_TOKEN_TTL_SECONDS = _TOKEN_TTL_HOURS * 60 * 60
_PBKDF2_ITERATIONS = 100_000
_bearer = HTTPBearer(auto_error=False)


def _hash_password_bcrypt(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _hash_password_pbkdf2(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${_PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def hash_password(password: str) -> str:
    return _hash_password_bcrypt(password)


def hash_password_legacy_pbkdf2(password: str) -> str:
    return _hash_password_pbkdf2(password)


def needs_password_rehash(password_hash: str) -> bool:
    return not password_hash.startswith("$2")


def verify_password(password: str, password_hash: str) -> bool:
    if password_hash.startswith("$2"):
        try:
            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
        except ValueError:
            return False

    try:
        if password_hash.startswith("pbkdf2_sha256$"):
            _, iteration_text, salt_hex, digest_hex = password_hash.split("$", 3)
            iterations = int(iteration_text)
        else:
            salt_hex, digest_hex = password_hash.split(":", 1)
            iterations = _PBKDF2_ITERATIONS
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def rehash_password(password: str) -> str:
    return _hash_password_bcrypt(password)


def verify_and_upgrade_password(password: str, user: dict[str, Any]) -> tuple[bool, str | None]:
    password_hash = user.get("password_hash", "")
    if not verify_password(password, password_hash):
        return False, None
    if needs_password_rehash(password_hash):
        return True, rehash_password(password)
    return True, None


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _unb64(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def build_token_payload(user: dict[str, Any], remember_me: bool = False) -> dict[str, Any]:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=_TOKEN_TTL_HOURS)
    return {
        "user_id": user["user_id"],
        "role": user["role"],
        "remember_me": remember_me,
        "exp": int(expires_at.timestamp()),
    }


def create_token(user: dict[str, Any], remember_me: bool = False) -> str:
    payload = build_token_payload(user, remember_me=remember_me)
    body = _b64(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    sig = hmac.new(_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def decode_token(token: str) -> dict[str, Any]:
    try:
        body, sig = token.split(".", 1)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token") from exc
    expected = hmac.new(_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid token")
    payload = json.loads(_unb64(body).decode("utf-8"))
    if payload["exp"] < int(datetime.now(timezone.utc).timestamp()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token expired")
    return payload


def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="missing token")
    payload = decode_token(credentials.credentials)
    user = get_user_by_id(payload["user_id"])
    if user is None or not user["is_active"]:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found")
    return user


def require_roles(*roles: str):
    def _checker(user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
        if user["role"] not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="forbidden")
        return user

    return _checker
