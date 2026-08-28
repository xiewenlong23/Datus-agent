"""Unit tests for the cli-anything-datus core modules (synthetic data).

These tests exercise the harness's own logic — session persistence/locking,
config parsing & datasource resolution, SQL result shaping, read-only SQL
detection — using synthetic data and, where a real Datus type is needed, the
installed ``datus`` package. No LLM is called.
"""

from __future__ import annotations

import json
import os
import threading

import pytest
import yaml

from cli_anything.datus.core import config as cfg
from cli_anything.datus.core import db
from cli_anything.datus.core import query as querymod
from cli_anything.datus.core.session import Session

# ─────────────────────────────────────────────────────────────────────────────
# core/session.py
# ─────────────────────────────────────────────────────────────────────────────


class TestSessionLoad:
    def test_load_missing_path_returns_empty(self, tmp_path):
        sess = Session.load(str(tmp_path / "nope.json"))
        assert sess.history == []
        assert sess.project_path is None
        assert sess.datasource is None

    def test_load_none_path_returns_empty(self):
        sess = Session.load(None)
        assert sess.history == []
        assert sess.project_path is None

    def test_load_existing_restores_fields(self, tmp_path):
        path = tmp_path / "s.json"
        path.write_text(
            json.dumps(
                {
                    "version": 1,
                    "datasource": "ds1",
                    "subagent": "sa",
                    "history": [{"id": "qa_1", "question": "q"}],
                    "undo_stack": [[{"id": "qa_0"}]],
                    "redo_stack": [],
                }
            )
        )
        sess = Session.load(str(path))
        assert sess.datasource == "ds1"
        assert sess.subagent == "sa"
        assert sess.history[0]["question"] == "q"
        assert len(sess.undo_stack) == 1
        assert sess.project_path == str(path)


class TestSessionPersist:
    def test_append_query_increments_history(self):
        sess = Session()
        e1 = sess.append_query("q1", sql="SELECT 1")
        e2 = sess.append_query("q2")
        assert len(sess.history) == 2
        assert e1["id"] != e2["id"]
        assert sess.history[0]["sql"] == "SELECT 1"
        assert sess.modified is True

    def test_save_writes_valid_json(self, tmp_path):
        sess = Session()
        sess.project_path = str(tmp_path / "s.json")
        sess.append_query("q1", sql="SELECT 1", rows=[[1]], columns=["n"], row_count=1)
        sess.save_session()
        data = json.loads((tmp_path / "s.json").read_text())
        assert data["version"] == 1
        assert data["history"][0]["sql"] == "SELECT 1"
        assert data["history"][0]["rows"] == [[1]]

    def test_save_is_idempotent(self, tmp_path):
        sess = Session()
        sess.project_path = str(tmp_path / "s.json")
        sess.append_query("q1")
        sess.save_session()
        sess.save_session()  # second save overwrites, still valid
        data = json.loads((tmp_path / "s.json").read_text())
        assert len(data["history"]) == 1

    def test_save_clears_modified(self, tmp_path):
        sess = Session()
        sess.project_path = str(tmp_path / "s.json")
        sess.append_query("q1")
        assert sess.modified is True
        sess.save_session()
        assert sess.modified is False

    def test_save_without_path_is_noop(self, tmp_path):
        sess = Session()
        sess.append_query("q1")
        sess.save_session()  # no project_path -> nothing written
        assert not (tmp_path / "s.json").exists()

    def test_concurrent_saves_do_not_corrupt(self, tmp_path):
        """Two threads saving concurrently; final file must be valid JSON."""
        path = tmp_path / "s.json"

        def worker(n):
            sess = Session()
            sess.project_path = str(path)
            for i in range(20):
                sess.append_query(f"q-{n}-{i}")
                sess.save_session()

        t1 = threading.Thread(target=worker, args=(1,))
        t2 = threading.Thread(target=worker, args=(2,))
        t1.start(); t2.start(); t1.join(); t2.join()
        data = json.loads(path.read_text())  # raises if corrupted
        assert isinstance(data["history"], list)


class TestSessionUndoRedo:
    def test_clear_is_undoable(self):
        sess = Session()
        sess.append_query("q1")
        sess.append_query("q2")
        n = sess.clear_history()
        assert n == 2
        assert sess.history == []
        assert sess.undo() is True
        assert len(sess.history) == 2

    def test_redo_after_undo(self):
        sess = Session()
        sess.append_query("q1")
        sess.clear_history()
        assert sess.history == []
        sess.undo()
        assert len(sess.history) == 1
        sess.redo()  # re-applies the clear
        assert sess.history == []

    def test_undo_empty_stack_false(self):
        sess = Session()
        assert sess.undo() is False
        assert sess.redo() is False

    def test_new_mutation_clears_redo(self):
        sess = Session()
        sess.append_query("a")
        sess.append_query("b")
        sess.undo()                 # remove b -> history=[a], redo=[[a,b]]
        assert len(sess.history) == 1
        assert sess.redo() is True  # re-add b -> history=[a,b]
        assert len(sess.history) == 2
        sess.append_query("c")      # a new mutation clears the redo stack
        assert sess.redo() is False

    def test_undo_stack_capped(self):
        sess = Session()
        for i in range(60):
            sess.append_query(f"q{i}")
        assert len(sess.undo_stack) <= 50


class TestSessionSettings:
    def test_set_datasource_marks_modified_on_change(self):
        sess = Session()
        assert sess.set_datasource("a") is True
        assert sess.modified is True
        assert sess.set_datasource("a") is False  # no change -> not re-marked
        assert sess.set_datasource("b") is True

    def test_set_subagent(self):
        sess = Session()
        assert sess.set_subagent("sa") is True
        assert sess.subagent == "sa"

    def test_to_status_dict_counts(self):
        sess = Session()
        sess.append_query("q1")      # undo_stack=[[]]
        sess.clear_history()         # undo_stack=[[], [q1]]
        d = sess.to_status_dict()
        assert d["history_count"] == 0
        assert d["undo_depth"] == 2


# ─────────────────────────────────────────────────────────────────────────────
# core/config.py
# ─────────────────────────────────────────────────────────────────────────────


def _write_agent_yml(path, agent: dict) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump({"agent": agent}, sort_keys=False), encoding="utf-8")
    return str(path)


class TestResolveConfig:
    def test_explicit_config_wins(self, tmp_path):
        p = tmp_path / "custom.yml"
        p.write_text("agent: {}\n")
        rc = cfg.resolve_config(home=str(tmp_path), config=str(p))
        assert rc.config_path == str(p)
        assert rc.config_exists is True

    def test_home_fallback(self, tmp_path):
        home = tmp_path / "home"
        (home / "conf").mkdir(parents=True)
        (home / "conf" / "agent.yml").write_text("agent: {}\n")
        rc = cfg.resolve_config(home=str(home))
        assert rc.config_path == str(home / "conf" / "agent.yml")

    def test_nothing_found(self, tmp_path):
        rc = cfg.resolve_config(home=str(tmp_path))
        assert rc.config_path is None
        assert rc.config_exists is False

    def test_default_home_env(self, tmp_path, monkeypatch):
        monkeypatch.setenv("DATUS_HOME", str(tmp_path))
        assert cfg.default_home() == str(tmp_path)


class TestLoadAgentSection:
    def test_valid(self, tmp_path):
        p = _write_agent_yml(tmp_path / "a.yml", {"target": "mock"})
        agent = cfg.load_agent_section(p)
        assert agent["target"] == "mock"

    def test_missing_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            cfg.load_agent_section(str(tmp_path / "nope.yml"))

    def test_missing_config_path_raises(self):
        with pytest.raises(FileNotFoundError):
            cfg.load_agent_section(None)


class TestDatasourceSpecs:
    def test_list_specs(self, tmp_path):
        agent = {
            "services": {
                "datasources": {
                    "a": {"type": "sqlite", "uri": "/a.sqlite", "default": True},
                    "b": {"type": "duckdb", "uri": "/b.duckdb"},
                }
            }
        }
        specs = cfg.list_datasource_specs(agent)
        by_name = {s["name"]: s for s in specs}
        assert set(by_name) == {"a", "b"}
        assert by_name["a"]["default"] is True
        assert by_name["a"]["type"] == "sqlite"
        assert by_name["b"]["type"] == "duckdb"

    def test_default_true_wins(self, tmp_path):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a"},
            "b": {"type": "sqlite", "uri": "/b", "default": True},
        }}}
        assert cfg.default_datasource_name(agent) == "b"

    def test_sole_entry_is_default(self, tmp_path):
        agent = {"services": {"datasources": {"only": {"type": "sqlite", "uri": "/o"}}}}
        assert cfg.default_datasource_name(agent) == "only"

    def test_multiple_no_default_none(self, tmp_path):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a"}, "b": {"type": "sqlite", "uri": "/b"}}}}
        assert cfg.default_datasource_name(agent) is None

    def test_none_when_empty(self):
        assert cfg.default_datasource_name({}) is None


class TestResolveDatasource:
    def test_explicit_wins(self):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a"}, "b": {"type": "sqlite", "uri": "/b"}}}}
        assert cfg.resolve_datasource(agent, explicit="b") == "b"

    def test_session_used_when_no_explicit(self):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a", "default": True},
            "b": {"type": "sqlite", "uri": "/b"}}}}
        # session overrides default
        assert cfg.resolve_datasource(agent, explicit=None, session_datasource="b") == "b"

    def test_default_used(self):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a"}, "b": {"type": "sqlite", "uri": "/b", "default": True}}}}
        assert cfg.resolve_datasource(agent) == "b"

    def test_unique_used(self):
        agent = {"services": {"datasources": {"only": {"type": "sqlite", "uri": "/o"}}}}
        assert cfg.resolve_datasource(agent) == "only"

    def test_unknown_explicit_errors_listing_options(self):
        agent = {"services": {"datasources": {
            "a": {"type": "sqlite", "uri": "/a"}, "b": {"type": "sqlite", "uri": "/b"}}}}
        with pytest.raises(ValueError) as ei:
            cfg.resolve_datasource(agent, explicit="zzz")
        assert "a" in str(ei.value) and "b" in str(ei.value)

    def test_none_configured_errors(self):
        with pytest.raises(ValueError):
            cfg.resolve_datasource({}, explicit=None, session_datasource=None)


class TestActiveModel:
    def test_custom_alias(self):
        agent = {"target": "m1", "models": {"m1": {"model": "gpt-x", "base_url": "http://h"}}}
        m = cfg.get_active_model(agent)
        assert m["kind"] == "custom"
        assert m["model"] == "gpt-x"

    def test_provider_target(self):
        agent = {"target": {"provider": "openai", "model": "gpt-4"}}
        m = cfg.get_active_model(agent)
        assert m["kind"] == "provider"
        assert m["target"] == "openai"
        assert m["model"] == "gpt-4"

    def test_unknown(self):
        m = cfg.get_active_model({"target": "ghost"})
        assert m["kind"] == "unknown"


class TestProjectName:
    def test_uses_root_basename(self):
        assert cfg.project_name_for("/home/user") == "user"

    def test_sanitizes_odd_chars(self):
        assert cfg.project_name_for("/tmp/My Project!") == "My-Project-"

    def test_empty_falls_back(self):
        assert cfg.project_name_for("/") == "default"

    def test_defaults_to_cwd(self, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        assert cfg.project_name_for() == tmp_path.name


# ─────────────────────────────────────────────────────────────────────────────
# core/db.py
# ─────────────────────────────────────────────────────────────────────────────


class TestReadOnlySQL:
    @pytest.mark.parametrize(
        "sql",
        [
            "SELECT * FROM t",
            "  select 1",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "EXPLAIN SELECT 1",
            "PRAGMA table_info(t)",
            "VALUES (1), (2)",
            "SELECT 1 -- comment",
            "SELECT 1;",
        ],
    )
    def test_read_only_true(self, sql):
        assert db.is_read_only_sql(sql) is True

    @pytest.mark.parametrize(
        "sql",
        [
            "INSERT INTO t VALUES (1)",
            "UPDATE t SET a=1",
            "DELETE FROM t",
            "DROP TABLE t",
            "CREATE TABLE t (a int)",
            "ALTER TABLE t ADD b int",
            "TRUNCATE TABLE t",
            "MERGE INTO t USING s ON 1=1",
            "",
            "   ",
            "SELECT * FROM t; DELETE FROM t",  # write keyword present
        ],
    )
    def test_read_only_false(self, sql):
        assert db.is_read_only_sql(sql) is False


class TestShapeRows:
    def test_basic(self):
        class R:
            sql_return = [{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]
            row_count = 2
        out = db._shape_rows(R(), None)
        assert out["columns"] == ["a", "b"]
        assert out["rows"] == [[1, "x"], [2, "y"]]
        assert out["row_count"] == 2
        assert out["truncated"] is False

    def test_limit_truncates(self):
        class R:
            sql_return = [{"a": i} for i in range(10)]
            row_count = 10
        out = db._shape_rows(R(), 3)
        assert out["rows"] == [[0], [1], [2]]
        assert out["truncated"] is True
        assert out["returned_rows"] == 3

    def test_empty_result(self):
        class R:
            sql_return = []
            row_count = 0
        out = db._shape_rows(R(), None)
        assert out["columns"] == []
        assert out["rows"] == []

    def test_none_return(self):
        class R:
            sql_return = None
            row_count = None
        out = db._shape_rows(R(), None)
        assert out["rows"] == []


class TestAddDatasource:
    def test_add_sqlite(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources: {}\n")
        out = db.add_datasource(str(p), "demo", "sqlite", uri="/tmp/x.sqlite")
        assert out["overwritten"] is False
        doc = yaml.safe_load(p.read_text())
        assert doc["agent"]["services"]["datasources"]["demo"] == {"type": "sqlite", "uri": "/tmp/x.sqlite"}

    def test_duplicate_refused_without_force(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources:\n      demo: {type: sqlite, uri: /a}\n")
        with pytest.raises(ValueError):
            db.add_datasource(str(p), "demo", "sqlite", uri="/b")

    def test_force_overwrites(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources:\n      demo: {type: sqlite, uri: /a}\n")
        out = db.add_datasource(str(p), "demo", "sqlite", uri="/b", force=True)
        assert out["overwritten"] is True
        doc = yaml.safe_load(p.read_text())
        assert doc["agent"]["services"]["datasources"]["demo"]["uri"] == "/b"

    def test_missing_config_errors(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            db.add_datasource(str(tmp_path / "nope.yml"), "x", "sqlite", uri="/a")

    def test_sqlite_requires_uri(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources: {}\n")
        with pytest.raises(ValueError):
            db.add_datasource(str(p), "x", "sqlite")

    def test_server_requires_host(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources: {}\n")
        with pytest.raises(ValueError):
            db.add_datasource(str(p), "x", "mysql")

    def test_server_datasource(self, tmp_path):
        p = tmp_path / "agent.yml"
        p.write_text("agent:\n  services:\n    datasources: {}\n")
        db.add_datasource(str(p), "pg", "postgres", host="db", port=5432,
                          username="u", password="p", database="d")
        doc = yaml.safe_load(p.read_text())
        spec = doc["agent"]["services"]["datasources"]["pg"]
        assert spec["host"] == "db" and spec["port"] == 5432 and spec["database"] == "d"


# ─────────────────────────────────────────────────────────────────────────────
# core/db.py — build_datasources (needs real datus types)
# ─────────────────────────────────────────────────────────────────────────────


class TestBuildDatasources:
    def test_builds_dbconfig_objects(self, agent_config_file):
        pytest.importorskip("datus")
        dss = cfg.build_datasources(agent_config_file)
        assert "california_schools" in dss
        assert dss["california_schools"].type == "sqlite"


# ─────────────────────────────────────────────────────────────────────────────
# core/query.py
# ─────────────────────────────────────────────────────────────────────────────


class TestQueryError:
    def test_query_error_is_exception(self):
        assert issubclass(querymod.QueryError, Exception)

    def test_explain_text_strips_none(self):
        assert querymod._explain_text(None) is None
        assert querymod._explain_text("  hi  ") == "hi"
