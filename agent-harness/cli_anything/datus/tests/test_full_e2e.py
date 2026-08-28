"""E2E tests for cli-anything-datus — real Datus backend.

Three layers:
1. **Real DB layer** (in-process ``core.db``): real ``DBManager``/connector
   against the bundled ``california_schools.sqlite``.
2. **Real agent loop** (in-process ``core.query``): real Datus
   ``GenSQLAgenticNode`` + Datus's first-party ``MockLLMModel`` (only the LLM
   decision is mocked; ``execute_sql`` runs for real against the real DB).
3. **CLI subprocess** (``TestCLISubprocess``): the installed
   ``cli-anything-datus`` command, resolved via ``_resolve_cli`` — no hardcoded
   paths, no ``cwd``. Runs green under ``CLI_ANYTHING_FORCE_INSTALLED=1``.

No graceful degradation: the real ``datus`` package and the sample SQLite are
required; if missing, tests fail loudly.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys

import pytest

from cli_anything.datus.core import db
from cli_anything.datus.core import query as querymod

# The installed command name.
CLI_NAME = "cli-anything-datus"


def _resolve_cli(name: str):
    """Resolve the installed CLI command; fall back to ``python -m`` for dev.

    Set env ``CLI_ANYTHING_FORCE_INSTALLED=1`` to require the installed command.
    """
    import shutil

    force = os.environ.get("CLI_ANYTHING_FORCE_INSTALLED", "").strip() == "1"
    path = shutil.which(name)
    if path:
        print(f"[_resolve_cli] Using installed command: {path}")
        return [path]
    if force:
        raise RuntimeError(f"{name} not found in PATH. Install with: pip install -e .")
    module = "cli_anything.datus.datus_cli"
    print(f"[_resolve_cli] Falling back to: {sys.executable} -m {module}")
    return [sys.executable, "-m", module]


class _Runner:
    """Thin wrapper to run the installed CLI with a JSON-friendly helper."""

    BASE = _resolve_cli(CLI_NAME)

    def __init__(self, config: str, home: str, project: str):
        self.config = config
        self.home = home
        self.project = project

    def run(self, args, check=True, use_json=False):
        cmd = list(self.BASE)
        if use_json:
            cmd.append("--json")
        cmd += [
            "--config", self.config,
            "--home", self.home,
            "--project", self.project,
        ]
        cmd += args
        return subprocess.run(cmd, capture_output=True, text=True, check=check)

    def run_ok_json(self, args, **kw):
        r = self.run(args, use_json=True, check=True, **kw)
        return json.loads(r.stdout)


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — Real DB layer (in-process)
# ─────────────────────────────────────────────────────────────────────────────


class TestRealDBLayer:
    def test_connection(self, agent_config_file):
        out = db.test_connection(agent_config_file, "california_schools")
        assert out["connected"] is True
        assert out["database"] == "california_schools"

    def test_list_tables(self, agent_config_file):
        out = db.list_tables(agent_config_file, "california_schools")
        assert set(out["tables"]) == {"frpm", "satscores", "schools"}
        assert out["count"] == 3

    def test_schema_has_expected_column(self, agent_config_file):
        out = db.get_schema(agent_config_file, "california_schools", table="schools")
        cols = {c["name"] for c in out["tables"][0]["columns"]}
        assert "CDSCode" in cols
        # CDSCode is the primary key
        pk = [c for c in out["tables"][0]["columns"] if c["name"] == "CDSCode"]
        assert pk and pk[0]["pk"] is True

    def test_execute_sql_count(self, agent_config_file):
        out = db.execute_sql(agent_config_file, "california_schools", "SELECT COUNT(*) AS n FROM schools")
        assert out["success"] is True
        assert out["columns"] == ["n"]
        assert out["rows"] == [[17686]]
        assert out["error"] is None
        print(f"\n  [DB] SELECT COUNT(*) FROM schools -> {out['rows'][0][0]} rows")

    def test_execute_sql_bad_column_errors(self, agent_config_file):
        out = db.execute_sql(agent_config_file, "california_schools", "SELECT nope_col FROM schools")
        assert out["success"] is False
        assert out["error"]
        assert "no such column" in out["error"]

    def test_execute_sql_limit_truncates(self, agent_config_file):
        out = db.execute_sql(
            agent_config_file, "california_schools",
            "SELECT CDSCode FROM schools", limit=5,
        )
        assert out["success"] is True
        assert out["returned_rows"] == 5
        assert out["truncated"] is True
        assert out["row_count"] > 5

    def test_add_datasource_roundtrip(self, agent_config_file, tmp_path, california_db):
        # Add a *copy* of the sample db as a new datasource, then query it.
        import shutil

        copy = tmp_path / "demo_copy.sqlite"
        shutil.copyfile(california_db, str(copy))
        out = db.add_datasource(agent_config_file, "demo_copy", "sqlite", uri=str(copy))
        assert out["overwritten"] is False
        tables = db.list_tables(agent_config_file, "demo_copy")
        assert set(tables["tables"]) == {"frpm", "satscores", "schools"}
        q = db.execute_sql(agent_config_file, "demo_copy", "SELECT COUNT(*) AS n FROM schools")
        assert q["success"] is True and q["rows"] == [[17686]]
        print(f"\n  [DB] new datasource 'demo_copy' -> {tables['tables']}")


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Real agent loop (in-process, Datus first-party MockLLMModel)
# ─────────────────────────────────────────────────────────────────────────────


class TestRealAgentLoop:
    def test_nl_to_sql_count(self, agent_config_file, tmp_home, mock_llm_create):
        """Scripted LLM calls execute_sql for real; verify real rows returned."""
        from tests.unit_tests.mock_llm_model import (
            MockToolCall,
            build_tool_then_response,
        )

        mock_llm_create.reset(responses=[
            build_tool_then_response(
                tool_calls=[MockToolCall(
                    name="execute_sql",
                    arguments='{"sql": "SELECT COUNT(*) AS n FROM schools"}',
                )],
                content=(
                    '{"sql": "SELECT COUNT(*) AS n FROM schools", '
                    '"tables": ["schools"], "explanation": "Count all schools."}'
                ),
            ),
        ])

        out = querymod.ask(
            "How many schools are there?",
            config_path=agent_config_file,
            home=tmp_home,
            datasource="california_schools",
            limit=10,
        )
        # The tool ran for real against the real SQLite.
        assert mock_llm_create.tool_results, "execute_sql tool was not executed"
        assert mock_llm_create.tool_results[0]["tool"] == "execute_sql"
        assert mock_llm_create.tool_results[0]["executed"] is True

        assert out["sql"] == "SELECT COUNT(*) AS n FROM schools"
        assert out["executed"] is True
        assert out["rows"] == [[17686]]
        assert out["error"] is None
        print(f"\n  [AGENT] NL->SQL generated: {out['sql']}  ->  rows={out['rows']}")

    def test_nl_to_sql_surfaces_explanation(self, agent_config_file, tmp_home, mock_llm_create):
        from tests.unit_tests.mock_llm_model import (
            MockToolCall,
            build_tool_then_response,
        )

        mock_llm_create.reset(responses=[
            build_tool_then_response(
                tool_calls=[MockToolCall(
                    name="execute_sql",
                    arguments='{"sql": "SELECT COUNT(*) AS n FROM schools"}',
                )],
                content=(
                    '{"sql": "SELECT COUNT(*) AS n FROM schools", '
                    '"tables": ["schools"], "explanation": "Counts rows in schools."}'
                ),
            ),
        ])
        out = querymod.ask(
            "How many schools?", config_path=agent_config_file,
            home=tmp_home, datasource="california_schools",
        )
        assert "Counts rows in schools" in out["explanation"]

    def test_query_error_when_no_sql(self, agent_config_file, tmp_home, mock_llm_create):
        """Scripted LLM that answers without SQL -> clean QueryError (no hang)."""
        from tests.unit_tests.mock_llm_model import build_simple_response

        mock_llm_create.reset(responses=[build_simple_response("I cannot answer that.")])
        with pytest.raises(querymod.QueryError):
            querymod.ask(
                "nonsense?", config_path=agent_config_file,
                home=tmp_home, datasource="california_schools",
            )


# ─────────────────────────────────────────────────────────────────────────────
# Layer 3 — CLI subprocess (installed command)
# ─────────────────────────────────────────────────────────────────────────────


class TestCLISubprocess:
    @pytest.fixture
    def runner(self, agent_config_file, tmp_home, session_file):
        return _Runner(agent_config_file, tmp_home, session_file)

    def test_help(self, runner):
        r = runner.run(["--help"], use_json=False)
        assert r.returncode == 0
        for group in ("status", "datasource", "sql", "query", "context", "session", "repl"):
            assert group in r.stdout

    def test_status_show_json(self, runner):
        data = runner.run_ok_json(["status", "show"])
        assert data["config_found"] is True
        assert data["datasource_count"] == 1
        assert data["default_datasource"] == "california_schools"
        assert data["datus_version"]

    def test_status_datasources_json(self, runner):
        data = runner.run_ok_json(["status", "datasources"])
        assert data["items"][0]["name"] == "california_schools"
        assert data["default"] == "california_schools"

    def test_datasource_tables_json(self, runner):
        data = runner.run_ok_json(["datasource", "tables"])
        assert set(data["tables"]) == {"frpm", "satscores", "schools"}
        print(f"\n  [CLI] datasource tables -> {data['tables']}")

    def test_datasource_schema_json(self, runner):
        data = runner.run_ok_json(["datasource", "schema", "--table", "schools"])
        cols = [c["name"] for c in data["tables"][0]["columns"]]
        assert "CDSCode" in cols

    def test_sql_run_json(self, runner):
        data = runner.run_ok_json(["sql", "run", "SELECT COUNT(*) AS n FROM schools"])
        assert data["success"] is True
        assert data["rows"] == [[17686]]
        print(f"\n  [CLI] sql run -> {data['rows']}")

    def test_sql_run_error(self, runner):
        r = runner.run(["sql", "run", "SELECT bad_col FROM schools"], use_json=True, check=False)
        assert r.returncode != 0
        data = json.loads(r.stdout)
        assert "error" in data

    def test_datasource_use_persists_session(self, runner):
        runner.run_ok_json(["datasource", "use", "california_schools"])
        # Auto-save should have written the session file.
        assert os.path.isfile(runner.project)
        data = runner.run_ok_json(["session", "show"])
        assert data["datasource"] == "california_schools"
        assert data["home"] == runner.home

    def test_session_lifecycle(self, runner):
        # Empty history
        h = runner.run_ok_json(["session", "history"])
        assert h["count"] == 0
        # Clear on empty is a no-op (still succeeds)
        c = runner.run_ok_json(["session", "clear"])
        assert c["cleared"] == 0
        # Undo with nothing to undo -> ok False
        u = runner.run_ok_json(["session", "undo"])
        assert u["ok"] is False

    def test_query_ask_error_path(self, runner):
        """query ask against the unreachable mock LLM -> clean JSON error, no hang."""
        r = runner.run(
            ["query", "ask", "How many schools?"], use_json=True, check=False,
        )
        data = json.loads(r.stdout)
        # Either a clean error (LLM unreachable) — the expected case here.
        assert "error" in data or "sql" in data
        if "sql" not in data or not data.get("sql"):
            assert r.returncode != 0
            assert data["error"]

    def test_full_workflow(self, runner):
        """Realistic agent-onboarding pipeline, end to end via the installed CLI."""
        # 1. Confirm Datus + config
        show = runner.run_ok_json(["status", "show"])
        assert show["config_found"] is True
        # 2. Discover datasource
        dss = runner.run_ok_json(["status", "datasources"])
        ds = dss["default"]
        # 3. Discover tables
        tables = runner.run_ok_json(["datasource", "tables", ds])
        assert "schools" in tables["tables"]
        # 4. Read schema
        schema = runner.run_ok_json(["datasource", "schema", ds, "--table", "schools"])
        assert any(c["name"] == "CDSCode" for c in schema["tables"][0]["columns"])
        # 5. Sanity-check data
        q = runner.run_ok_json(["sql", "run", "SELECT COUNT(*) AS n FROM schools"])
        assert q["rows"] == [[17686]]
        # 6. Pin the datasource in the session
        runner.run_ok_json(["datasource", "use", ds])
        sess = runner.run_ok_json(["session", "show"])
        assert sess["datasource"] == ds
        print(f"\n  [CLI] full workflow OK on datasource '{ds}'")


# ─────────────────────────────────────────────────────────────────────────────
# Output-verification guard: ensure the sample DB is what we think it is.
# ─────────────────────────────────────────────────────────────────────────────


class TestSampleDatabaseIntegrity:
    def test_sample_db_has_expected_shape(self, california_db):
        import sqlite3

        con = sqlite3.connect(f"file:{california_db}?mode=ro", uri=True)
        try:
            cur = con.cursor()
            tables = {r[0] for r in cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )}
            assert {"frpm", "satscores", "schools"} <= tables
            n = cur.execute("SELECT COUNT(*) FROM schools").fetchone()[0]
            assert n == 17686
        finally:
            con.close()
        print(f"\n  [SAMPLE] california_schools.sqlite verified (schools={n})")
