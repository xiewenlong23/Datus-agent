"""Feishu QR-code login routes + current-user endpoints.

- ``GET  /api/v1/auth/feishu/login``    — 302 to Feishu's QR-code authorize page
- ``GET  /api/v1/auth/feishu/callback`` — exchange code, persist user, set cookie
- ``GET  /api/v1/auth/me``              — who is logged in (drives the frontend gate)
- ``POST /api/v1/auth/logout``          — clear the session cookie

These routes are intentionally NOT behind ``ServiceDep`` auth: the callback
arrives without a cookie (that is what it mints), and ``/me`` must report
"not logged in" rather than fail.
"""

from typing import Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from datus.api.auth.feishu_auth import (
    FEISHU_AUTHORIZE_URL,
    FEISHU_OIDC_TOKEN_URL,
    FEISHU_USER_INFO_URL,
    FeishuConfig,
    make_cookie_value,
    make_state,
    parse_cookie_value,
    verify_state,
)
from datus.api.deps import ServiceDep, get_auth_provider
from datus.storage.feishu_user_store import get_user, upsert_user, upsert_user_token
from datus.utils.loggings import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

_FEISHU_TIMEOUT = 15.0

# Scopes requested at web login. Everything beyond contact:user.base:readonly
# exists so agent tools can act AS the logged-in user via lark-cli (create
# cloud docs, send messages). These scopes must be enabled for the app in the
# Feishu developer console — unenabled ones are simply not granted, and
# `offline_access` is what makes the refresh token come back.
FEISHU_LOGIN_SCOPES = (
    "contact:user.base:readonly",
    "offline_access",
    "docx:document:create",
    "docx:document:write_only",
    "docs:document.content:read",
    "drive:file:upload",
    "drive:drive.metadata:readonly",
    "im:message",
    "im:message:send_as_user",
    "im:chat:read",
)


def _feishu_config() -> Optional[FeishuConfig]:
    provider = get_auth_provider()
    cfg = getattr(provider, "feishu_config", None)
    if cfg is None or not cfg.enabled:
        return None
    return cfg


def _login_redirect(cfg: FeishuConfig, error: Optional[str] = None) -> RedirectResponse:
    from urllib.parse import quote

    url = cfg.frontend_url
    if error:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}login_error={quote(error)}"
    return RedirectResponse(url, status_code=302)


@router.get("/feishu/login", summary="Start Feishu QR-code login")
async def feishu_login():
    cfg = _feishu_config()
    if cfg is None:
        return JSONResponse(status_code=503, content={"detail": "Feishu auth is not configured"})
    from urllib.parse import quote

    target = (
        f"{FEISHU_AUTHORIZE_URL}?client_id={quote(cfg.app_id)}"
        f"&redirect_uri={quote(cfg.redirect_uri, safe='')}"
        f"&response_type=code"
        f"&state={quote(make_state(), safe='')}"
        f"&scope={quote(' '.join(FEISHU_LOGIN_SCOPES), safe='')}"
    )
    return RedirectResponse(target, status_code=302)


@router.get("/feishu/callback", summary="Feishu OAuth callback")
async def feishu_callback(request: Request, svc: ServiceDep, code: str = "", state: str = "") -> RedirectResponse:
    cfg = _feishu_config()
    if cfg is None:
        return JSONResponse(status_code=503, content={"detail": "Feishu auth is not configured"})
    if not code:
        return _login_redirect(cfg, error="missing_code")
    if not verify_state(state):
        return _login_redirect(cfg, error="bad_state")

    # 1. Exchange the authorization code for a user access token.
    #    v3 token endpoint is form-encoded (not JSON) and requires redirect_uri
    #    to match the authorize request exactly; errors come back as
    #    {"error", "error_description"} instead of {"code": != 0}.
    try:
        async with httpx.AsyncClient(timeout=_FEISHU_TIMEOUT) as client:
            token_resp = await client.post(
                FEISHU_OIDC_TOKEN_URL,
                data={
                    "grant_type": "authorization_code",
                    "client_id": cfg.app_id,
                    "client_secret": cfg.app_secret,
                    "code": code,
                    "redirect_uri": cfg.redirect_uri,
                },
            )
            token_data = token_resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.error(f"Feishu token exchange failed: {e}")
        return _login_redirect(cfg, error="token_exchange_failed")
    if token_data.get("error") or token_data.get("code", 0) not in (0, None):
        logger.error(f"Feishu token exchange rejected: {token_data}")
        return _login_redirect(cfg, error="token_rejected")
    access_token = token_data.get("access_token") or (token_data.get("data") or {}).get("access_token")
    if not access_token:
        return _login_redirect(cfg, error="no_access_token")
    # The v3 token response may already embed identity fields; fall back to them
    # if the user_info endpoint below rejects the token.
    token_profile = {k: v for k, v in token_data.items() if k in ("open_id", "union_id", "name", "en_name", "email", "tenant_key", "avatar_url")}

    # 2. Fetch the user's profile.
    profile: dict = {}
    try:
        async with httpx.AsyncClient(timeout=_FEISHU_TIMEOUT) as client:
            info_resp = await client.get(FEISHU_USER_INFO_URL, headers={"Authorization": f"Bearer {access_token}"})
            info_data = info_resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.error(f"Feishu user info fetch failed: {e}")
        info_data = {}
    if info_data.get("code", 0) == 0:
        profile = info_data.get("data") or {}
    else:
        logger.warning(f"Feishu user info rejected ({info_data}); falling back to token-response identity fields")
    open_id = profile.get("open_id") or token_profile.get("open_id")
    if not open_id:
        return _login_redirect(cfg, error="no_open_id")

    # 2b. Persist the OAuth token pair so agent tools can act as this user.
    #     The refresh token only exists when `offline_access` was granted;
    #     without it the UAT still works until it expires on its own.
    refresh_token = token_data.get("refresh_token") or (token_data.get("data") or {}).get("refresh_token")
    expires_in = token_data.get("expires_in")
    if expires_in is None:
        expires_in = (token_data.get("data") or {}).get("expires_in")
    granted_scope = token_data.get("scope") or (token_data.get("data") or {}).get("scope")
    try:
        upsert_user_token(open_id, access_token, refresh_token=refresh_token, expires_in=expires_in, scopes=granted_scope)
        logger.info(f"Feishu tokens stored for {open_id} (refresh_token={'yes' if refresh_token else 'no'}, scopes={granted_scope or 'n/a'})")
    except Exception as e:
        # Non-fatal: login still succeeds; tools that need a UAT will report
        # "not authorized" until the user logs in again.
        logger.error(f"Failed to store Feishu tokens for {open_id}: {e}")

    # 3. Persist the user (upsert; refreshes name/avatar/last_login).
    avatar = profile.get("avatar") or {}
    user = upsert_user(
        {
            "open_id": open_id,
            "union_id": profile.get("union_id") or token_profile.get("union_id"),
            "name": profile.get("name") or token_profile.get("name"),
            "en_name": profile.get("en_name") or token_profile.get("en_name"),
            "email": profile.get("email") or token_profile.get("email"),
            "avatar_url": avatar.get("avatar_240") or avatar.get("avatar_480") or avatar.get("avatar_1024") or token_profile.get("avatar_url"),
            "tenant_key": profile.get("tenant_key") or token_profile.get("tenant_key"),
        }
    )

    # 4. First login on this machine claims the legacy (flat) sessions.
    _claim_legacy_sessions(svc, open_id)

    # 5. Mint the session cookie and go back to the app.
    resp = RedirectResponse(cfg.frontend_url, status_code=302)
    resp.set_cookie(
        cfg.cookie_name,
        make_cookie_value(open_id, user.get("name") or ""),
        max_age=cfg.cookie_max_age,
        httponly=True,
        samesite="lax",
        path="/",
    )
    logger.info(f"Feishu login complete: {open_id}")
    return resp


@router.get("/me", summary="Current logged-in user")
async def auth_me(request: Request):
    provider = get_auth_provider()
    cfg = getattr(provider, "feishu_config", None)
    if cfg is None or not cfg.enabled:
        # Feishu login not configured: legacy single-user mode, no gate.
        return {"authenticated": False, "feishu_enabled": False, "user": None}

    payload = parse_cookie_value(request.cookies.get(cfg.cookie_name))
    if not payload:
        return {"authenticated": False, "feishu_enabled": True, "user": None}
    user = get_user(payload["open_id"])
    if not user:
        return {"authenticated": False, "feishu_enabled": True, "user": None}
    return {
        "authenticated": True,
        "feishu_enabled": True,
        "user": {
            "open_id": user["open_id"],
            "name": user.get("name") or "",
            "en_name": user.get("en_name") or "",
            "email": user.get("email") or "",
            "avatar_url": user.get("avatar_url") or "",
        },
    }


@router.post("/logout", summary="Log out (clear session cookie)")
async def auth_logout():
    resp = JSONResponse({"ok": True})
    cookie_name = "datus_user"
    provider = get_auth_provider()
    cfg = getattr(provider, "feishu_config", None)
    if cfg is not None:
        cookie_name = cfg.cookie_name
    resp.delete_cookie(cookie_name, path="/")
    return resp


# ---------------------------------------------------------------------------
# Legacy session claim
# ---------------------------------------------------------------------------


def _claim_legacy_sessions(svc, open_id: str) -> None:
    """Move flat (pre-login) session files into the new user's scope dir.

    Before Feishu login all sessions were stored flat under the project
    session dir (anonymous scope). The first user to log in takes ownership
    of that legacy data; later users start with their own empty scope dir.
    Best-effort: any failure is logged and never blocks login.
    """
    import shutil
    from pathlib import Path

    try:
        session_dir = Path(svc.agent_config.session_dir)
        scope_dir = session_dir / open_id
        if scope_dir.exists():
            return  # this user already owns a scope dir (or someone claimed first)
        if not session_dir.is_dir():
            return
        legacy = [
            p
            for p in session_dir.iterdir()
            if p.name.startswith("chat_session_")
            and (p.is_dir() or p.suffix == ".db" or p.name.endswith((".db-wal", ".db-shm")) or p.name.endswith(".sysprompt.json"))
        ]
        if not legacy:
            return
        scope_dir.mkdir(parents=True, exist_ok=True)
        moved = 0
        for p in legacy:
            try:
                shutil.move(str(p), str(scope_dir / p.name))
                moved += 1
            except OSError as e:
                logger.warning(f"Legacy session claim: could not move {p.name}: {e}")
        logger.info(f"Legacy session claim: moved {moved} entries into scope dir for {open_id}")
    except Exception:
        logger.exception(f"Legacy session claim failed for {open_id}")
