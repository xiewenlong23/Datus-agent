"""Unit tests for session manager task_type support."""

import os
import tempfile

import pytest

from datus.api.models.cli_models import StreamChatInput, ChatSessionItemInfo
from datus.models.session_manager import SessionManager


@pytest.fixture()
def session_mgr() -> SessionManager:
    tmp = tempfile.mkdtemp()
    return SessionManager(session_dir=tmp)


def _create_session_db(session_mgr: SessionManager, sid: str) -> None:
    """Create a bare session database via AdvancedSQLiteSession."""
    from agents.extensions.memory import AdvancedSQLiteSession

    db_path = os.path.join(session_mgr.session_dir, f"{sid}.db")
    session = AdvancedSQLiteSession(session_id=sid, db_path=db_path, create_tables=True)
    session_mgr._sessions[sid] = session


def test_set_and_get_task_type(session_mgr: SessionManager):
    sid = "chat_session_tasktype_test"
    _create_session_db(session_mgr, sid)
    assert session_mgr.set_session_task_type(sid, "db-query") is True
    info = session_mgr.get_session_info(sid)
    assert info.get("task_type") == "db-query"


def test_set_task_type_nonexistent_db(session_mgr: SessionManager):
    assert session_mgr.set_session_task_type("nonexistent", "data-analysis") is False


def test_get_task_type_legacy_session(session_mgr: SessionManager):
    """Legacy sessions (without task_type column) should return None, not error."""
    sid = "legacy_session_test"
    _create_session_db(session_mgr, sid)
    info = session_mgr.get_session_info(sid)
    # task_type is optional; key may be absent or None
    assert info.get("task_type") is None or "task_type" not in info


def test_stream_chat_input_output_options():
    inp = StreamChatInput(message="test", output_options={"depth": "standard", "format": "markdown"}, task_type="db-query")
    assert inp.output_options == {"depth": "standard", "format": "markdown"}
    assert inp.task_type == "db-query"


def test_chat_session_item_info_task_type():
    item = ChatSessionItemInfo(session_id="s1", created_at="", last_updated="", task_type="data-analysis")
    assert item.task_type == "data-analysis"


def test_chat_session_item_info_task_type_omitted():
    item = ChatSessionItemInfo(session_id="s1", created_at="", last_updated="")
    assert item.task_type is None