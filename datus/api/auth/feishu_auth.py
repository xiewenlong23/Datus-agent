"""Feishu (Lark) QR-code login — cookie auth provider.

Flow:
  1. Frontend redirects the browser to ``GET /api/v1/auth/feishu/login``.
  2. The backend 302s to Feishu's authorize page (which shows the QR code);
     the user scans it with the Feishu mobile app.
  3. Feishu redirects back to the callback with a one-time ``code``; the
     callback exchanges it for a user access token, fetches the user's
     profile, persists it in the local user store, and sets a signed
     ``datus_user`` cookie.
  4. Every subsequent request is identified by that cookie: the provider
     resolves the Feishu ``open_id`` and uses it as ``AppContext.user_id``,
     which ``SessionManager`` treats as the per-user session scope.

When no valid cookie is present the provider falls back to the default
``X-Datus-User-Id`` header behaviour so CLI / local tooling keeps working.

Config (``api.auth_provider`` in agent.yml)::

    api:
      auth_provider:
        class: datus.api.auth.feishu_auth.FeishuCookieAuthProvider
        kwargs:
          app_id: cli_xxx
          app_secret: xxx
          redirect_uri: http://localhost:8501/api/v1/auth/feishu/callback
          frontend_url: http://localhost:5173
"""

from __future__ import annotations

import base64
import hmac
import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional

from fastapi import Request

from datus.api.auth.context import AppContext
from datus.api.auth.header_context_provider import HeaderContextProvider
from datus.api.auth.provider import EvictCallback
from datus.utils.loggings import get_logger

logger = get_logger(__name__)

# Feishu "login with Feishu" (web app) endpoints
# v3 OAuth endpoints (v1 OIDC flow is deprecated; it rejects every code with 20014)
FEISHU_AUTHORIZE_URL = "https://passport.feishu.cn/suite/passport/oauth/authorize"
FEISHU_OIDC_TOKEN_URL = "https://accounts.feishu.cn/oauth/v3/token"
FEISHU_USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info"

DEFAULT_COOKIE_NAME = "datus_user"
DEFAULT_FRONTEND_URL = "http://localhost:5173"
COOKIE_MAX_AGE_SECONDS = 30 * 24 * 3600  # 30 days


# Fallback when ~/.datus is not writable: process-lifetime secret only.
_ephemeral_secret: bytes = secrets.token_bytes(32)


def _load_secret() -> bytes:
    """Stable per-installation HMAC secret (created once, survives restarts)."""
    path = Path.home() / ".datus" / ".feishu_auth_secret"
    try:
        if path.exists():
            return path.read_bytes()
        path.parent.mkdir(parents=True, exist_ok=True)
        raw = secrets.token_urlsafe(32).encode("utf-8")
        path.write_bytes(raw)
        os.chmod(path, 0o600)
        return raw
    except OSError as e:
        logger.warning(f"Could not persist Feishu auth secret at {path}: {e}; using a process-lifetime secret")
        return _ephemeral_secret


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64url_decode(text: str) -> bytes:
    pad = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + pad)


def _sign(secret: bytes, payload: bytes) -> str:
    return _b64url_encode(hmac.new(secret, payload, "sha256").digest())


def make_cookie_value(open_id: str, name: str) -> str:
    """Signed cookie payload: base64url(JSON) + '.' + HMAC-SHA256."""
    secret = _load_secret()
    payload = _b64url_encode(
        json.dumps({"open_id": open_id, "name": name}, ensure_ascii=False).encode("utf-8")
    )
    return f"{payload}.{_sign(secret, payload.encode('ascii'))}"


def parse_cookie_value(value: Optional[str]) -> Optional[Dict[str, str]]:
    """Verify the signature and return the payload, or ``None`` when invalid."""
    if not value or "." not in value:
        return None
    payload_b64, _, sig = value.partition(".")
    secret = _load_secret()
    expected = _sign(secret, payload_b64.encode("ascii"))
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict) or not data.get("open_id"):
        return None
    return data


def make_state() -> str:
    """Signed one-purpose nonce for the OAuth redirect (state parameter)."""
    nonce = secrets.token_urlsafe(16)
    return f"{nonce}.{_sign(_load_secret(), nonce.encode('ascii'))}"


def verify_state(state: str) -> bool:
    if not state or "." not in state:
        return False
    nonce, _, sig = state.partition(".")
    return hmac.compare_digest(sig, _sign(_load_secret(), nonce.encode("ascii")))


def _maybe_env(value: str) -> str:
    """Resolve a ``${ENV_VAR}`` reference from the environment (empty if unset)."""
    if value and value.startswith("${") and value.endswith("}"):
        return os.environ.get(value[2:-1], "")
    return value


@dataclass
class FeishuConfig:
    app_id: str
    app_secret: str
    redirect_uri: str
    frontend_url: str
    cookie_name: str
    cookie_max_age: int

    @property
    def enabled(self) -> bool:
        return bool(self.app_id and self.app_secret)


class FeishuCookieAuthProvider(HeaderContextProvider):
    """Cookie-first auth provider with Feishu login.

    A valid signed cookie identifies the user (``open_id``). Without one the
    request falls back to the inherited ``X-Datus-User-Id`` header handling,
    then to anonymous — preserving the previous local behaviour.
    """

    def __init__(
        self,
        app_id: str = "",
        app_secret: str = "",
        redirect_uri: str = "",
        frontend_url: str = DEFAULT_FRONTEND_URL,
        cookie_name: str = DEFAULT_COOKIE_NAME,
        cookie_max_age: int = COOKIE_MAX_AGE_SECONDS,
    ) -> None:
        super().__init__()
        # Allow ``app_secret: ${LARK_APP_SECRET}`` in agent.yml to keep the
        # secret out of the config file.
        app_id = _maybe_env(app_id)
        app_secret = _maybe_env(app_secret)
        self.feishu_config = FeishuConfig(
            app_id=app_id,
            app_secret=app_secret,
            redirect_uri=redirect_uri,
            frontend_url=frontend_url.rstrip("/") or DEFAULT_FRONTEND_URL,
            cookie_name=cookie_name,
            cookie_max_age=cookie_max_age,
        )
        if self.feishu_config.enabled:
            logger.info("Feishu cookie auth provider enabled (app_id=%s)", app_id)
        else:
            logger.info("Feishu cookie auth provider inactive (no app credentials); header fallback only")

    async def authenticate(self, request: Request) -> AppContext:
        value = request.cookies.get(self.feishu_config.cookie_name)
        payload = parse_cookie_value(value)
        if payload:
            open_id = str(payload["open_id"])
            return AppContext(user_id=open_id, project_id=None, config=None, policy_context={})
        # No (valid) cookie: keep the previous header-based behaviour.
        return await super().authenticate(request)

    def on_evict(self, callback: EvictCallback) -> None:
        super().on_evict(callback)
