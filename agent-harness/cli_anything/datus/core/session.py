"""Harness-owned stateful session (the one persistent project file we own).

Tracks the active datasource/subagent and the question→SQL conversation
history. Supports:

* exclusive-locking JSON saves (``_locked_save_json`` — open ``"r+"``, ``flock``,
  truncate inside the lock; see guides/session-locking.md)
* dirty tracking for one-shot auto-save
* undo/redo over history mutations
"""

from __future__ import annotations

import fcntl
import json
import os
import time
import uuid
from typing import Any, Dict, List, Optional

SESSION_VERSION = 1


def _utcnow() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _locked_save_json(path: str, data: Dict[str, Any]) -> None:
    """Atomically write JSON with exclusive file locking."""
    try:
        f = open(path, "r+")  # no truncation on open
    except FileNotFoundError:
        os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
        f = open(path, "w")  # first save — file doesn't exist yet
    with f:
        locked = False
        try:
            fcntl.flock(f.fileno(), fcntl.LOCK_EX)
            locked = True
        except (ImportError, OSError):
            pass  # Windows / unsupported FS — proceed unlocked
        try:
            f.seek(0)
            f.truncate()  # truncate INSIDE the lock
            json.dump(data, f, indent=2)
            f.flush()
        finally:
            if locked:
                fcntl.flock(f.fileno(), fcntl.LOCK_UN)


def default_session_path() -> str:
    return os.path.join(os.getcwd(), ".datus-cli", "session.json")


class Session:
    """In-memory session state, optionally backed by a JSON file on disk."""

    def __init__(self) -> None:
        self.project_path: Optional[str] = None
        self.home: Optional[str] = None
        self.config: Optional[str] = None
        self.project: Optional[str] = None
        self.datasource: Optional[str] = None
        self.subagent: Optional[str] = None
        self.created_at: Optional[str] = None
        self.updated_at: Optional[str] = None
        self.history: List[Dict[str, Any]] = []
        self.undo_stack: List[Dict[str, Any]] = []
        self.redo_stack: List[Dict[str, Any]] = []
        self._modified = False

    # ── loading ──────────────────────────────────────────────────────────

    @classmethod
    def load(cls, path: Optional[str]) -> "Session":
        """Load a session from disk (empty session if path is None/missing)."""
        sess = cls()
        if not path or not os.path.isfile(path):
            return sess
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        sess._apply(data, path)
        return sess

    def _apply(self, data: Dict[str, Any], path: str) -> None:
        self.project_path = path
        self.home = data.get("home")
        self.config = data.get("config")
        self.project = data.get("project")
        self.datasource = data.get("datasource")
        self.subagent = data.get("subagent")
        self.created_at = data.get("created_at")
        self.updated_at = data.get("updated_at")
        self.history = list(data.get("history") or [])
        self.undo_stack = list(data.get("undo_stack") or [])
        self.redo_stack = list(data.get("redo_stack") or [])

    # ── dirty tracking / persistence ─────────────────────────────────────

    def mark_modified(self) -> None:
        self._modified = True
        self.updated_at = _utcnow()

    def save_session(self) -> None:
        """Persist to disk (no-op without a project_path). Clears dirty flag."""
        if not self.project_path:
            return
        _locked_save_json(self.project_path, self._to_dict())
        self._modified = False

    @property
    def modified(self) -> bool:
        return self._modified

    def _to_dict(self) -> Dict[str, Any]:
        return {
            "version": SESSION_VERSION,
            "home": self.home,
            "config": self.config,
            "project": self.project,
            "datasource": self.datasource,
            "subagent": self.subagent,
            "created_at": self.created_at or _utcnow(),
            "updated_at": self.updated_at or _utcnow(),
            "history": self.history,
            "undo_stack": self.undo_stack,
            "redo_stack": self.redo_stack,
        }

    # ── history mutations (undoable) ─────────────────────────────────────

    def append_query(
        self,
        question: str,
        sql: Optional[str] = None,
        explanation: Optional[str] = None,
        rows: Optional[List[List[Any]]] = None,
        columns: Optional[List[str]] = None,
        row_count: Optional[int] = None,
        error: Optional[str] = None,
    ) -> Dict[str, Any]:
        entry = {
            "id": f"qa_{uuid.uuid4().hex[:8]}",
            "ts": _utcnow(),
            "kind": "query",
            "question": question,
            "sql": sql,
            "explanation": explanation,
            "columns": columns,
            "rows": rows,
            "row_count": row_count if row_count is not None else (len(rows) if rows else 0),
            "error": error,
        }
        self._snapshot()
        self.history.append(entry)
        self.mark_modified()
        return entry

    def _snapshot(self) -> None:
        """Push current history onto undo stack (clears redo — standard editor rule)."""
        self.undo_stack.append(list(self.history))
        if len(self.undo_stack) > 50:
            self.undo_stack.pop(0)
        self.redo_stack.clear()

    def clear_history(self) -> int:
        if not self.history:
            return 0
        self._snapshot()
        count = len(self.history)
        self.history = []
        self.mark_modified()
        return count

    def undo(self) -> bool:
        if not self.undo_stack:
            return False
        self.redo_stack.append(list(self.history))
        self.history = self.undo_stack.pop()
        self.mark_modified()
        return True

    def redo(self) -> bool:
        if not self.redo_stack:
            return False
        self.undo_stack.append(list(self.history))
        self.history = self.redo_stack.pop()
        self.mark_modified()
        return True

    # ── session settings ─────────────────────────────────────────────────

    def bind(self, home: Optional[str] = None, config: Optional[str] = None, project: Optional[str] = None) -> None:
        """Record invocation context (home/config/project).

        This is NOT a mutation: it never marks the session dirty, so read-only
        commands do not trigger an auto-save / file creation. The context is
        simply carried along and persisted the next time a real mutation saves.
        """
        if home is not None:
            self.home = home
        if config is not None:
            self.config = config
        if project is not None:
            self.project = project
        if (home or config or project):
            self.created_at = self.created_at or _utcnow()

    def set_datasource(self, name: str) -> bool:
        if self.datasource == name:
            return False
        self.datasource = name
        self.mark_modified()
        return True

    def set_subagent(self, name: Optional[str]) -> bool:
        if self.subagent == name:
            return False
        self.subagent = name
        self.mark_modified()
        return True

    def to_status_dict(self) -> Dict[str, Any]:
        return {
            "session_file": self.project_path,
            "home": self.home,
            "config": self.config,
            "project": self.project,
            "datasource": self.datasource,
            "subagent": self.subagent,
            "history_count": len(self.history),
            "undo_depth": len(self.undo_stack),
            "redo_depth": len(self.redo_stack),
            "modified": self._modified,
        }
