"""Real Datus database layer (datasource introspection + raw SQL execution).

Uses the genuine Datus ``DBManager`` / ``BaseSqlConnector`` (``datus_db_core``) —
the same code path the first-party TUI and agent use. No LLM and no full
``AgentConfig`` (no LanceDB/embedding init) is needed for this path.
"""

from __future__ import annotations

import copy
import os
import re
from typing import Any, Dict, List, Optional

import yaml

from cli_anything.datus.core import config as cfg
from cli_anything.datus.utils.datus_backend import datus_import, ensure_datus

# Statement heads that are safe to auto-execute (read-only). Anything else is
# never re-run by the harness.
_READONLY_HEADS = re.compile(
    r"^\s*(?:SELECT|WITH|EXPLAIN|PRAGMA|VALUES)\b", re.IGNORECASE
)
_WRITE_KEYWORDS = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|MERGE|GRANT|REVOKE|ATTACH|DETACH)\b",
    re.IGNORECASE,
)


def is_read_only_sql(sql: str) -> bool:
    """True if the statement looks read-only (no write/DDL keywords anywhere)."""
    s = (sql or "").strip().rstrip(";").strip()
    if not s:
        return False
    if not _READONLY_HEADS.match(s):
        return False
    # A read-only head is not enough if a write keyword appears (e.g. a
    # subquery is fine, but we err on the safe side for DML/DDL keywords).
    return _WRITE_KEYWORDS.search(s) is None


def _get_connector(config_path: str, datasource: str) -> Any:
    ensure_datus()
    datus_import("tools.db_tools")  # trigger connector registration
    from cli_anything.datus.utils.datus_backend import datus_import as di

    dbm_mod = di("tools.db_tools.db_manager")
    db_configs = cfg.build_datasources(config_path)
    if datasource not in db_configs:
        names = ", ".join(db_configs) or "(none)"
        raise ValueError(f"Datasource {datasource!r} not configured. Available: {names}")
    manager = dbm_mod.DBManager(db_configs)
    return manager.first_conn(datasource)


def test_connection(config_path: str, datasource: str) -> Dict[str, Any]:
    conn = _get_connector(config_path, datasource)
    ok = bool(conn.test_connection())
    return {"datasource": datasource, "connected": ok, "database": getattr(conn, "database_name", None)}


def list_tables(config_path: str, datasource: str) -> Dict[str, Any]:
    conn = _get_connector(config_path, datasource)
    tables = list(conn.get_tables() or [])
    return {
        "datasource": datasource,
        "database": getattr(conn, "database_name", None),
        "tables": tables,
        "count": len(tables),
    }


def get_schema(config_path: str, datasource: str, table: Optional[str] = None) -> Dict[str, Any]:
    conn = _get_connector(config_path, datasource)
    tables = [table] if table else list(conn.get_tables() or [])
    out: List[Dict[str, Any]] = []
    for t in tables:
        cols = conn.get_schema(table_name=t) or []
        out.append(
            {
                "table": t,
                "columns": [
                    {
                        "name": c.get("name") or c.get("column_name"),
                        "type": c.get("type"),
                        "nullable": c.get("nullable"),
                        "pk": bool(c.get("pk")),
                    }
                    for c in cols
                ],
            }
        )
    return {
        "datasource": datasource,
        "database": getattr(conn, "database_name", None),
        "tables": out,
    }


def _shape_rows(result: Any, limit: Optional[int]) -> Dict[str, Any]:
    """Convert an ExecuteSQLResult (list-of-dicts) to {columns, rows, row_count}."""
    rows_dicts: List[Dict[str, Any]] = result.sql_return or []
    columns = list(rows_dicts[0].keys()) if rows_dicts else []
    rows = [[row.get(c) for c in columns] for row in rows_dicts]
    total = len(rows)
    truncated = False
    if limit is not None and limit >= 0:
        if total > limit:
            rows = rows[:limit]
            truncated = True
    return {
        "columns": columns,
        "rows": rows,
        "row_count": result.row_count if result.row_count is not None else total,
        "returned_rows": len(rows),
        "truncated": truncated,
    }


def execute_sql(
    config_path: str,
    datasource: str,
    sql: str,
    limit: Optional[int] = None,
) -> Dict[str, Any]:
    """Run raw SQL through the real Datus connector. Returns a JSON-safe dict."""
    conn = _get_connector(config_path, datasource)
    result = conn.execute_query(sql, result_format="list")
    out: Dict[str, Any] = {
        "datasource": datasource,
        "database": getattr(conn, "database_name", None),
        "sql": sql,
        "success": bool(getattr(result, "success", False)),
        "error": getattr(result, "error", None),
    }
    if out["success"]:
        out.update(_shape_rows(result, limit))
    else:
        out.update({"columns": [], "rows": [], "row_count": 0, "returned_rows": 0, "truncated": False})
    return out


# ── agent.yml datasource mutation (the only write to Datus-owned state) ──────

def _load_full_config(config_path: str) -> Dict[str, Any]:
    with open(config_path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def add_datasource(
    config_path: str,
    name: str,
    ds_type: str,
    uri: Optional[str] = None,
    host: Optional[str] = None,
    port: Optional[int] = None,
    username: Optional[str] = None,
    password: Optional[str] = None,
    database: Optional[str] = None,
    force: bool = False,
) -> Dict[str, Any]:
    """Add a datasource to ``agent.services.datasources`` in agent.yml.

    Idempotent: refuses to overwrite an existing entry unless ``force``.
    File datasources (sqlite/duckdb) use ``uri``; server datasources use
    host/port/username/password/database.
    """
    if not os.path.isfile(config_path):
        raise FileNotFoundError(f"agent.yml not found at {config_path!r}")

    doc = _load_full_config(config_path)
    agent = doc.setdefault("agent", {})
    services = agent.setdefault("services", {})
    datasources: Dict[str, Any] = services.setdefault("datasources", {})

    if name in datasources and not force:
        raise ValueError(
            f"Datasource {name!r} already exists. Re-run with --force to overwrite."
        )

    spec: Dict[str, Any] = {"type": ds_type}
    if ds_type in ("sqlite", "duckdb"):
        if not uri:
            raise ValueError(f"--uri is required for {ds_type} datasources")
        spec["uri"] = uri
    else:
        if not host:
            raise ValueError(f"--host is required for {ds_type} datasources")
        spec["host"] = host
        if port is not None:
            spec["port"] = port
        if username is not None:
            spec["username"] = username
        if password is not None:
            spec["password"] = password
        if database is not None:
            spec["database"] = database

    datasources[name] = spec
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False, allow_unicode=True)

    return {"datasource": name, "type": ds_type, "config_path": config_path, "overwritten": bool(force)}
