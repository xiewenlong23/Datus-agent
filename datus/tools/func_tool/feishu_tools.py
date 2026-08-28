# Copyright 2025-present DatusAI, Inc.
# Licensed under the Apache License, Version 2.0.
# See http://www.apache.org/licenses/LICENSE-2.0 for details.

"""Per-user Feishu (Lark) tools — act under the logged-in web user's identity.

Each call shells out to the official ``lark-cli`` with the *current session
user's* user access token (UAT) injected through the ``LARKSUITE_CLI_*``
environment variables. The CLI's env credential provider takes precedence
over its keychain, so the token never touches the shared machine keychain
and every subprocess provably runs as the session user. The LLM never sees
the token — it is resolved and injected at call time from the local user
store (which transparently refreshes expired UATs).

A tight command allow-list (create doc / send message) keeps the exposed
surface small; every invocation is audit-logged with the acting user.
"""

import asyncio
import json
import os
import shutil
import time
from typing import List, Optional, Tuple

from datus.storage.feishu_user_store import get_valid_uat
from datus.tools.func_tool.base import FuncToolResult, trans_to_function_tool
from datus.utils.loggings import get_logger

logger = get_logger(__name__)

_CLI_TIMEOUT_SECONDS = 180
_AUDIT_CMD_CHARS = 400

_NOT_AUTHORIZED = (
    "当前用户尚未完成飞书授权(或授权已失效),无法以该用户身份操作飞书。"
    "请让用户在前端重新登录飞书并完成授权,然后重试。"
)


def _find_lark_cli() -> Optional[str]:
    return shutil.which("lark-cli")


def _maybe_env(value: str) -> str:
    if value and value.startswith("${") and value.endswith("}"):
        return os.environ.get(value[2:-1], "")
    return value


def _credentials_from_api_config(api_config: Optional[dict]) -> Optional[Tuple[str, str]]:
    kwargs = ((api_config or {}).get("auth_provider") or {}).get("kwargs") or {}
    app_id = _maybe_env(str(kwargs.get("app_id") or ""))
    app_secret = _maybe_env(str(kwargs.get("app_secret") or ""))
    if not app_id or not app_secret:
        return None
    return app_id, app_secret


def _load_feishu_app_credentials(agent_config=None) -> Optional[Tuple[str, str]]:
    """Read app_id/app_secret from the auth provider's api_config kwargs.

    Prefers the already-loaded ``agent_config.api_config``; falls back to
    re-reading agent.yml so the tools also work in contexts without a node.
    """
    if agent_config is not None:
        creds = _credentials_from_api_config(getattr(agent_config, "api_config", None))
        if creds:
            return creds
    try:
        from datus.configuration.agent_config_loader import load_agent_config

        return _credentials_from_api_config(load_agent_config().api_config)
    except Exception as e:
        logger.warning(f"FeishuTools: could not read app credentials: {e}")
        return None


class FeishuTools:
    """Feishu operations executed as the current session user via lark-cli."""

    permission_category: str = "tools"

    def __init__(self, user_id: Optional[str], agent_config=None):
        self._user_id = user_id or ""
        self._agent_config = agent_config
        self._cli = _find_lark_cli()

    def _require_ready(self) -> Optional[FuncToolResult]:
        if not self._user_id:
            return FuncToolResult(success=0, error="当前会话没有登录用户身份,无法以用户身份操作飞书。")
        if not self._cli:
            return FuncToolResult(success=0, error="未找到 lark-cli,请先安装: npx @larksuite/cli@latest install")
        creds = _load_feishu_app_credentials(self._agent_config)
        if creds is None:
            return FuncToolResult(success=0, error="agent.yml 未配置飞书应用凭据(api.auth_provider.kwargs.app_id/app_secret)。")
        return None

    async def _run_lark_cli(self, argv: List[str], stdin_text: Optional[str] = None) -> FuncToolResult:
        blocked = self._require_ready()
        if blocked is not None:
            return blocked
        app_id, app_secret = _load_feishu_app_credentials(self._agent_config)

        uat = await get_valid_uat(self._user_id, app_id, app_secret)
        if not uat:
            return FuncToolResult(success=0, error=_NOT_AUTHORIZED)

        env = {
            **os.environ,
            "LARKSUITE_CLI_APP_ID": app_id,
            "LARKSUITE_CLI_APP_SECRET": app_secret,
            "LARKSUITE_CLI_USER_ACCESS_TOKEN": uat,
            "LARKSUITE_CLI_BRAND": "feishu",
            "LARKSUITE_CLI_DEFAULT_AS": "user",
        }
        cmd_display = " ".join(argv)[:_AUDIT_CMD_CHARS]
        started = time.time()
        try:
            proc = await asyncio.create_subprocess_exec(
                self._cli,
                *argv,
                env=env,
                stdin=asyncio.subprocess.PIPE if stdin_text is not None else None,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            out, err = await asyncio.wait_for(
                proc.communicate(input=stdin_text.encode("utf-8") if stdin_text is not None else None),
                timeout=_CLI_TIMEOUT_SECONDS,
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
            except Exception:
                pass
            logger.warning(f"feishu_tool_audit user={self._user_id} cmd={cmd_display} TIMEOUT after {_CLI_TIMEOUT_SECONDS}s")
            return FuncToolResult(success=0, error=f"飞书操作超时(超过 {_CLI_TIMEOUT_SECONDS}s),请重试或缩小操作范围。")
        except FileNotFoundError:
            return FuncToolResult(success=0, error="lark-cli 执行失败: 二进制不存在。")

        stdout = out.decode("utf-8", errors="replace")
        stderr = err.decode("utf-8", errors="replace")
        ok = False
        detail = ""
        try:
            envelope = json.loads(stdout)
            ok = bool(envelope.get("ok"))
            if ok:
                detail = json.dumps(envelope.get("data") or {}, ensure_ascii=False)[:1500]
            else:
                err_obj = envelope.get("error") or {}
                detail = f"{err_obj.get('type', '')} {err_obj.get('message', '')}".strip()
        except (json.JSONDecodeError, TypeError):
            ok = proc.returncode == 0
            detail = (stdout or stderr)[:1500]

        logger.info(
            f"feishu_tool_audit user={self._user_id} cmd={cmd_display} "
            f"exit={proc.returncode} ok={ok} took={time.time() - started:.1f}s"
        )
        if not ok:
            return FuncToolResult(success=0, error=f"飞书操作失败: {detail or stderr[:500] or f'exit={proc.returncode}'}")
        return FuncToolResult(success=1, result=detail)

    async def feishu_create_doc(self, title: str, content: str) -> FuncToolResult:
        """Create a Feishu cloud document (云文档) under the current user's identity.

        Use this when the user asks to create/write a Feishu document or
        report. The document is created in the user's "我的空间" (My Space)
        and the result includes the document URL the user can open.

        Args:
            title: Document title (1-100 chars), e.g. "Q3 销售周报".
            content: Document body in Markdown (headings, lists, tables
                supported). Plain Markdown, NOT DocxXML.

        Returns:
            JSON with the created document's token and url on success.
        """
        title = (title or "").strip()
        content = content or ""
        if not title:
            return FuncToolResult(success=0, error="title 不能为空")
        if not content.strip():
            return FuncToolResult(success=0, error="content 不能为空")
        return await self._run_lark_cli(
            ["docs", "+create", "--doc-format", "markdown", "--title", title, "--content", "-", "--parent-position", "my_library"],
            stdin_text=content,
        )

    async def feishu_send_message(self, target: str, text: str) -> FuncToolResult:
        """Send a Feishu message to a chat or a person, as the current user.

        Use this when the user asks to send/notify a Feishu message. The
        message is sent under the user's own identity (not a bot).

        Args:
            target: Recipient — a chat id ("oc_...") or a person's open_id
                ("ou_..."). If the user names a person by name instead of an
                ID, ask the user for the recipient's chat/user ID first; do
                not guess IDs.
            text: Message text (plain text).

        Returns:
            JSON with the sent message's id on success.
        """
        target = (target or "").strip()
        text = (text or "").strip()
        if not text:
            return FuncToolResult(success=0, error="text 不能为空")
        if target.startswith("oc_"):
            recipient_flag = "--chat-id"
        elif target.startswith("ou_"):
            recipient_flag = "--user-id"
        else:
            return FuncToolResult(success=0, error='target 必须是群聊 ID(oc_ 开头)或用户 open_id(ou_ 开头)')
        return await self._run_lark_cli(["im", "+messages-send", recipient_flag, target, "--text", text])

    def available_tools(self):
        return [trans_to_function_tool(self.feishu_create_doc), trans_to_function_tool(self.feishu_send_message)]
