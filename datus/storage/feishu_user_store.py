"""Persistent local user store for Feishu logins.

Users are Feishu identities (``open_id``), shared across projects on this
machine, so the store lives at ``~/.datus/users.db` (not per-project).
One SQLite file, one connection per call — same pattern as the session
manager, safe for the server's thread pool.

The store also persists each user's OAuth tokens (user access token +
refresh token) obtained at web login. Agent tools that act *as that user*
(e.g. the lark-cli backed feishu tools) call :func:`get_valid_uat`, which
transparently refreshes an expired access token via the refresh token and
persists the rotation.

Kept in ``datus.storage`` (not ``datus.api``) so the agent/tool layer can
import it without crossing into the FastAPI layer.
"""

import asyncio
import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, Optional

import httpx

from datus.utils.loggings import get_logger
from datus.utils.time_utils import now_utc_iso

logger = get_logger(__name__)

# v3 OAuth token endpoint (authorization_code + refresh_token grants).
FEISHU_TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token"

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    open_id        TEXT PRIMARY KEY,
    union_id       TEXT,
    name           TEXT,
    en_name        TEXT,
    email          TEXT,
    avatar_url     TEXT,
    first_login_at TEXT NOT NULL,
    last_login_at  TEXT NOT NULL,
    access_token   TEXT,
    refresh_token  TEXT,
    token_expires_at INTEGER,
    granted_scopes TEXT,
    extra          TEXT
);
"""

# Columns added after the store existed; applied on connect for upgrades.
_TOKEN_COLUMNS = (
    ("access_token", "TEXT"),
    ("refresh_token", "TEXT"),
    ("token_expires_at", "INTEGER"),
    ("granted_scopes", "TEXT"),
)

# User profile fields copied from the Feishu user_info payload into the store.
_PROFILE_FIELDS = ("open_id", "union_id", "name", "en_name", "email", "avatar_url")


def _db_path() -> Path:
    return Path.home() / ".datus" / "users.db"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.executescript(_SCHEMA)
    existing = {row["name"] for row in conn.execute("PRAGMA table_info(users)")}
    for column, column_type in _TOKEN_COLUMNS:
        if column not in existing:
            conn.execute(f"ALTER TABLE users ADD COLUMN {column} {column_type}")
    conn.commit()
    return conn


def upsert_user(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or refresh a user's profile; returns the stored row."""
    now = now_utc_iso()
    row = {field: (profile.get(field) or "") for field in _PROFILE_FIELDS}
    if not row.get("open_id"):
        raise ValueError("user profile is missing open_id")
    extra = {k: v for k, v in profile.items() if k not in _PROFILE_FIELDS and v not in (None, "")}
    with _connect() as conn:
        existing = conn.execute("SELECT first_login_at FROM users WHERE open_id = ?", (row["open_id"],)).fetchone()
        first_login = existing["first_login_at"] if existing else now
        conn.execute(
            """
            INSERT INTO users (open_id, union_id, name, en_name, email, avatar_url, first_login_at, last_login_at, extra)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(open_id) DO UPDATE SET
                union_id = excluded.union_id,
                name = excluded.name,
                en_name = excluded.en_name,
                email = excluded.email,
                avatar_url = excluded.avatar_url,
                last_login_at = excluded.last_login_at,
                extra = excluded.extra
            """,
            (
                row["open_id"],
                row["union_id"],
                row["name"],
                row["en_name"],
                row["email"],
                row["avatar_url"],
                first_login,
                now,
                json.dumps(extra, ensure_ascii=False) if extra else None,
            ),
        )
    logger.info(f"Feishu user stored: {row['open_id']} ({row['name'] or 'unnamed'})")
    return get_user(row["open_id"]) or {}


def get_user(open_id: str) -> Optional[Dict[str, Any]]:
    """Return the stored profile for *open_id*, or ``None``."""
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE open_id = ?", (open_id,)).fetchone()
    if row is None:
        return None
    data = dict(row)
    try:
        data["extra"] = json.loads(data.get("extra") or "{}")
    except json.JSONDecodeError:
        data["extra"] = {}
    return data


def list_users() -> list[Dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute("SELECT open_id, name, email, last_login_at FROM users ORDER BY last_login_at DESC").fetchall()
    return [dict(r) for r in rows]


def upsert_user_token(
    open_id: str,
    access_token: str,
    refresh_token: Optional[str] = None,
    expires_in: Optional[float] = None,
    scopes: Optional[str] = None,
) -> None:
    """Persist (or rotate) a user's OAuth tokens.

    ``refresh_token`` is only overwritten when a fresh value is supplied —
    the server may omit it on some refresh responses, and wiping a still-
    valid rotation in that case would strand the user.
    """
    expires_at = int(time.time()) + int(expires_in) if expires_in else None
    with _connect() as conn:
        if refresh_token:
            conn.execute(
                "UPDATE users SET access_token = ?, refresh_token = ?, token_expires_at = ?, granted_scopes = ? WHERE open_id = ?",
                (access_token, refresh_token, expires_at, scopes, open_id),
            )
        else:
            conn.execute(
                "UPDATE users SET access_token = ?, token_expires_at = ?, granted_scopes = ? WHERE open_id = ?",
                (access_token, expires_at, scopes, open_id),
            )


def _token_fields(token_data: Dict[str, Any]) -> Dict[str, Any]:
    """Read token fields from either OAuth2 JSON or the legacy {code, data} envelope."""
    data = token_data.get("data") if isinstance(token_data.get("data"), dict) else {}
    return {
        "access_token": token_data.get("access_token") or data.get("access_token"),
        "refresh_token": token_data.get("refresh_token") or data.get("refresh_token"),
        "expires_in": token_data.get("expires_in") if token_data.get("expires_in") is not None else data.get("expires_in"),
        "scope": token_data.get("scope") or data.get("scope"),
    }


_refresh_locks: Dict[str, asyncio.Lock] = {}


async def get_valid_uat(
    open_id: str,
    client_id: str,
    client_secret: str,
    skew_seconds: int = 300,
) -> Optional[str]:
    """Return a non-expired user access token for *open_id*.

    Transparently refreshes an expired token via its refresh token (v3
    ``grant_type=refresh_token``) and persists the rotation. Returns
    ``None`` when the user has never stored a token pair or the refresh
    fails — callers should surface that as "user not authorized yet".
    """
    user = get_user(open_id)
    if not user or not user.get("access_token") or not user.get("refresh_token"):
        return None
    expires_at = user.get("token_expires_at")
    if expires_at and expires_at > time.time() + skew_seconds:
        return user["access_token"]

    # Serialize refreshes per user: a second concurrent refresh would be
    # rejected (the old refresh token was already consumed) and could
    # otherwise clobber the winner's persisted token.
    lock = _refresh_locks.setdefault(open_id, asyncio.Lock())
    async with lock:
        user = get_user(open_id)
        if not user or not user.get("refresh_token"):
            return None
        expires_at = user.get("token_expires_at")
        if expires_at and expires_at > time.time() + skew_seconds:
            return user["access_token"]

        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    FEISHU_TOKEN_URL,
                    data={
                        "grant_type": "refresh_token",
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "refresh_token": user["refresh_token"],
                        "access_token": user.get("access_token") or "",
                    },
                )
                token_data = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            logger.warning(f"Feishu token refresh failed for {open_id}: {e}")
            if user.get("token_expires_at") and user["token_expires_at"] > time.time():
                return user["access_token"]
            return None

        if token_data.get("error") or token_data.get("code", 0) not in (0, None):
            detail = token_data.get("error_description") or token_data
            logger.warning(f"Feishu token refresh rejected for {open_id}: {detail}")
            if token_data.get("error") == "invalid_grant":
                # The refresh token may already have been rotated by a login
                # that raced us; re-read and use the fresh pair if valid.
                fresh = get_user(open_id)
                if fresh and fresh.get("token_expires_at") and fresh["token_expires_at"] > time.time() + skew_seconds:
                    return fresh["access_token"]
            return None

        fields = _token_fields(token_data)
        if not fields["access_token"]:
            logger.warning(f"Feishu token refresh returned no access_token for {open_id}")
            return None
        upsert_user_token(
            open_id,
            fields["access_token"],
            refresh_token=fields["refresh_token"],
            expires_in=fields["expires_in"],
            scopes=fields["scope"],
        )
        logger.info(f"Feishu token refreshed for {open_id}")
        return fields["access_token"]
