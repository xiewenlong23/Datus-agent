"""Natural-language → SQL through the REAL Datus agent framework.

This is the "true backend" path: it drives Datus's ``GenSQLAgenticNode`` (or a
named subagent) with the LLM configured in ``agent.yml``. The agent's tools
(``list_tables``, ``describe_table``, ``execute_sql``, ...) run for real against
the real database. The harness never re-implements SQL generation.

After the agent returns SQL, if the statement is read-only the harness re-runs
it through the real ``DBManager`` so the JSON output includes the answer rows.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

from cli_anything.datus.core import config as cfg
from cli_anything.datus.core import db
from cli_anything.datus.utils.datus_backend import datus_import, ensure_datus


class QueryError(RuntimeError):
    """The Datus agent ran but produced no usable SQL (e.g. LLM unavailable)."""


def _explain_text(response: Optional[str]) -> Optional[str]:
    """Strip the 'Explanation: ... Tables used: ...' wrapper to the core text."""
    if not response:
        return None
    return response.strip()


def ask(
    question: str,
    config_path: str,
    home: Optional[str] = None,
    datasource: Optional[str] = None,
    subagent: Optional[str] = None,
    limit: Optional[int] = 50,
) -> Dict[str, Any]:
    """Run one NL→SQL query through the real Datus agent.

    Returns a JSON-safe dict:
        {datasource, subagent, question, sql, explanation,
         columns, rows, row_count, returned_rows, truncated, executed,
         tokens_used, error}
    """
    ensure_datus()

    # Resolve the datasource the same way the rest of the CLI does.
    agent = cfg.load_agent_section(config_path)
    ds = cfg.resolve_datasource(agent, explicit=datasource, session_datasource=None)

    loader_mod = datus_import("configuration.agent_config_loader")
    factory_mod = datus_import("agent.node.node_factory")

    agent_config = loader_mod.load_agent_config(
        reload=True,
        create_if_missing=False,
        config=config_path,
        home=home,
        datasource=ds,
        permission_mode="normal",
    )
    # Headless posture: use the configured ("normal") profile rather than
    # forcing "dangerous" — SELECT auto-allowed, writes ASK→fail-fast.
    # (Mirrors datus.cli.print_mode line 66.)
    try:
        agent_config.workflow_permission_profile = "normal"
    except Exception:
        pass

    node = factory_mod.create_interactive_node(
        subagent or "gen_sql",
        agent_config,
        node_id_suffix="_harness",
        execution_mode="workflow",
    )
    node.input = factory_mod.create_node_input(user_message=question, node=node)

    out: Dict[str, Any] = {
        "datasource": ds,
        "subagent": subagent or "gen_sql",
        "question": question,
        "sql": None,
        "explanation": None,
        "columns": [],
        "rows": [],
        "row_count": 0,
        "returned_rows": 0,
        "truncated": False,
        "executed": False,
        "tokens_used": None,
        "error": None,
    }

    # node.execute() may either raise (e.g. no model configured) or return a
    # result whose ``error`` is set (e.g. LLM connection failure). Handle both.
    agent_error: Optional[str] = None
    try:
        result = node.execute()
        sql = getattr(result, "sql", None)
        out["explanation"] = _explain_text(getattr(result, "response", None))
        out["tokens_used"] = getattr(result, "tokens_used", None)
        agent_error = getattr(result, "error", None)
    except Exception as exc:  # DatusException / model-not-configured / hard LLM error
        sql = None
        agent_error = f"{type(exc).__name__}: {exc}"

    out["sql"] = sql

    if not (sql or "").strip():
        raise QueryError(
            agent_error
            or "The Datus agent did not produce SQL. Verify a working LLM model is "
            "configured (agent.target / agent.models in agent.yml) and reachable."
        )

    # Re-execute read-only SQL through the real DB layer to surface answer rows.
    if db.is_read_only_sql(sql):
        try:
            res = db.execute_sql(config_path, ds, sql, limit=limit)
            if res.get("success"):
                out.update(
                    {
                        "columns": res["columns"],
                        "rows": res["rows"],
                        "row_count": res["row_count"],
                        "returned_rows": res["returned_rows"],
                        "truncated": res["truncated"],
                        "executed": True,
                    }
                )
            else:
                out["error"] = res.get("error")
        except Exception as exc:
            out["error"] = f"Re-execution failed: {type(exc).__name__}: {exc}"

    return out
