# cli-anything-datus — Test Plan & Results

This document is the test plan (written **before** implementation) and the test
results (appended after execution), per the HARNESS SOP.

**Backend under test:** the real Datus framework (`datus` package, v0.3.9) —
`DBManager`/`BaseSqlConnector` for the database layer and `GenSQLAgenticNode`
for NL→SQL. Only the LLM's *decision step* is mocked in deterministic agent
tests, using Datus's own first-party double
(`tests/unit_tests/mock_llm_model.py::MockLLMModel`); every tool
(`execute_sql`, `list_tables`, `describe_table`) executes **for real** against a
real SQLite database.

**Test database:** the bundled sample
`datus/sample_data/california_schools/california_schools.sqlite` (3 tables:
`frpm`, `satscores`, `schools`; 17,686 school rows).

**Isolation:** all tests use `tmp_path` Datus homes and a generated test
`agent.yml`. They never read or write the user's live `~/.datus`.

---

## Part 1 — Test Inventory Plan

| File | Purpose | Planned tests |
|---|---|---|
| `test_core.py` | Unit tests — synthetic data, no Datus import where avoidable | ~30 |
| `test_full_e2e.py` | E2E — real Datus DB layer, real agent loop, CLI subprocess | ~22 |

**Layers**
1. **Unit** (`test_core.py`): session persistence/locking/undo-redo, config
   parsing & datasource resolution, SQL result shaping, read-only detection,
   agent.yml datasource add.
2. **E2E — real DB layer** (`test_full_e2e.py`): real `DBManager` against the
   real bundled SQLite. `sql run`, `datasource tables/schema/test`.
3. **E2E — real agent loop** (`test_full_e2e.py`): real `create_interactive_node`
   + `MockLLMModel` (Datus first-party) + real SQLite; verifies generated SQL
   executes for real.
4. **CLI subprocess** (`test_full_e2e.py::TestCLISubprocess`): drives the
   installed `cli-anything-datus` via `_resolve_cli()` (no hardcoded paths, no
   `cwd`). Runs green under `CLI_ANYTHING_FORCE_INSTALLED=1`.

---

## Part 2 — Unit Test Plan (`test_core.py`)

### `core/session.py`
- `Session.load` of a missing/None path → empty session (no crash).
- `Session.load` of an existing JSON → fields restored (history, datasource,
  undo/redo stacks).
- `append_query` increments history, sets a unique id, marks modified.
- `save_session` writes a valid JSON file with the expected keys.
- `save_session` is idempotent (second save overwrites, still valid JSON).
- `mark_modified`/`modified` flag transitions; `save_session` clears it.
- `clear_history` returns count, empties history, is undoable.
- `undo` restores prior history; `redo` re-applies; empty stacks → False.
- undo/redo editor rule: a new mutation clears the redo stack.
- undo stack is capped (50) and doesn't grow unboundedly.
- `set_datasource`/`set_subagent` mark modified only on change.
- `to_status_dict` reflects history/undo/redo counts.
- **Concurrent save** (lock): two threads saving don't corrupt the file
  (final content is valid JSON).

### `core/config.py`
- `resolve_config`: explicit `--config` wins; `./conf/agent.yml` beats home;
  home fallback; nothing found → `config_path is None`.
- `load_agent_section` on a valid file → the `agent` mapping.
- `load_agent_section` on a missing file → `FileNotFoundError`.
- `list_datasource_specs` returns name/type/default/uri per entry.
- `default_datasource_name`: `default: true` wins; sole entry is default;
  multiple without default → None.
- `resolve_datasource`: explicit > session > default > unique; unknown
  explicit → error listing options; none configured → error.
- `get_active_model` for a custom alias target and a `{provider, model}` target.
- `project_name_for` sanitizes CWD names.

### `core/db.py`
- `is_read_only_sql`: SELECT/WITH/EXPLAIN/PRAGMA/VALUES → True;
  INSERT/UPDATE/DELETE/DROP/CREATE/ALTER → False; empty → False.
- `is_read_only_sql` with a leading comment/whitespace and trailing `;`.
- `_shape_rows`: list-of-dicts → `{columns, rows, row_count}`; limit truncates
  and sets `truncated`; empty result → empty columns/rows.
- `add_datasource`: writes a sqlite entry to agent.yml; refuses duplicate
  without `--force`; `--force` overwrites; missing config → error; server
  datasource requires `--host`; sqlite requires `--uri`.

### `core/query.py`
- `QueryError` is raised when the agent returns no SQL (simulated result).

> Config/DB unit tests that need the real `datus` types (`DbConfig`,
> `DBManager`) are guarded by `pytest.importorskip("datus")` — but in this
> environment datus is always present, so they run.

---

## Part 3 — E2E Test Plan (`test_full_e2e.py`)

### Real DB layer (in-process `core.db`)
- `test_connection` → `connected: True`, database name present.
- `list_tables` → exactly `{frpm, satscores, schools}`.
- `get_schema(table="schools")` → includes `CDSCode` column, `pk` flagged.
- `execute_sql("SELECT COUNT(*) AS n FROM schools")` → success, `rows == [[17686]]`.
- `execute_sql` with a bad column → `success: False`, non-null `error`.
- `execute_sql` `--limit` truncates a multi-row result and sets `truncated`.
- `add_datasource` + `list_tables` on the newly added datasource (round-trip).

### Real agent loop (in-process `core.query`, Datus `MockLLMModel`)
- `test_nl_to_sql_count`: scripted LLM calls `execute_sql(COUNT)` → the tool
  runs for real; result `sql` is the expected string, `executed: True`,
  `rows == [[17686]]`, `error is None`. **Prints the artifact path.**
- `test_nl_to_sql_explanation`: the explanation text is surfaced.
- `test_query_error_no_sql`: scripted LLM returns no SQL → `QueryError` raised
  (proves the clean-failure path without a live LLM).

### CLI subprocess (installed `cli-anything-datus` via `_resolve_cli`)
- `test_help`: `--help` exits 0 and lists the command groups.
- `test_status_show_json`: `--json status show` → valid JSON with
  `datus_version`, `config_found: true`.
- `test_status_datasources_json`: lists the configured datasource.
- `test_datasource_tables_json`: returns the 3 real tables.
- `test_datasource_schema_json`: `--table schools` → `CDSCode` column present.
- `test_sql_run_json`: real SQL → `success: true`, `rows == [[17686]]`.
- `test_sql_run_error`: bad SQL → `{"error": ...}`, non-zero exit.
- `test_datasource_use_session`: `datasource use` then `session show`
  reflects the active datasource (auto-save created the session file).
- `test_session_lifecycle`: `query`-less history is empty; `session clear` on
  empty is a no-op; undo/redo report correctly.
- `test_query_ask_error_path`: `query ask` with the unreachable mock LLM →
  `{"error": ...}` JSON, non-zero exit (wiring + clean failure, no hang).
- **Full one-shot workflow** (`test_full_workflow`): `status` →
  `datasource tables` → `sql run` (verify real rows) → `datasource use` →
  `session show` — the realistic "agent explores a database" pipeline.

> **Note on live LLM:** the deterministic agent E2E uses Datus's first-party
> `MockLLMModel` (real agent + real tools + real DB). A live-LLM `query ask`
> is intentionally *not* in the default suite so the 100% pass rate does not
> depend on an external endpoint; `query ask` with a real model is documented
> in the README and demonstrated separately.

---

## Part 4 — Realistic Workflow Scenarios

### Workflow A — "Agent onboards to a new database"
1. `status show` → confirm Datus version + config found.
2. `status datasources` → see the available datasource.
3. `datasource tables <ds>` → discover `frpm`, `satscores`, `schools`.
4. `datasource schema <ds> --table schools` → read the column names.
5. `sql run "SELECT COUNT(*) FROM schools"` → sanity-check the data (17,686).
6. `query ask "How many schools are there?"` → NL→SQL, verify the generated
   SQL matches the manual query and the rows agree.

**Verified:** table names, schema columns, real row counts, and that the
agent's generated SQL executes to the same answer as the hand-written SQL.

### Workflow B — "Session state & undo"
1. `datasource use california_schools` → session auto-saves.
2. `session show` → active datasource recorded.
3. (after a `query ask`) `session history` → the Q&A is recorded.
4. `session clear` → history emptied (auto-saved).
5. `session undo` → history restored.

**Verified:** the session file on disk reflects each mutation; undo reverses
`clear`; the file stays valid JSON throughout.

### Workflow C — "Add a datasource end-to-end"
1. `datasource add demo --type sqlite --uri <copy of sample db>` → writes
   agent.yml.
2. `datasource list` → `demo` appears.
3. `datasource tables demo` → connects to the new file, lists tables.
4. `sql run "SELECT 1" --datasource demo` → executes on the new datasource.

**Verified:** the new entry persists in agent.yml, is idempotent (duplicate
refused), and is immediately queryable through the real DB layer.

---

## Part 5 — Results

### Invocation

```
CLI_ANYTHING_FORCE_INSTALLED=1 ~/.datus/venv/bin/python -m pytest cli_anything/datus/tests/ -vv --tb=no
```

Notes:
- `-vv` is required to get per-test names because `pytest.ini` sets
  `addopts = --import-mode=importlib -q`; a single `-v` is cancelled by `-q`.
- `CLI_ANYTHING_FORCE_INSTALLED=1` proves the subprocess layer drives the
  **installed** command (`/Users/xiewenlong/.local/bin/cli-anything-datus`),
  not a path constructed inside the test process.
- Datus runs from the real repo checkout at
  `/Users/xiewenlong/Documents/code/Datus-agent` (in-process, editable install
  in `~/.datus/venv`). No external LLM endpoint is contacted: the
  NL→SQL tests use Datus's first-party `MockLLMModel` (real agent loop, real
  tools, real SQLite DB).

### 1. Test Results — full output

```
============================= test session starts ==============================
platform darwin -- Python 3.12.13, pytest-9.1.1, pluggy-1.6.0 -- /Users/xiewenlong/.datus/venv/bin/python
cachedir: .pytest_cache
rootdir: /Users/xiewenlong/Documents/code/Datus-agent/agent-harness
configfile: pytest.ini
plugins: anyio-4.14.1
[_resolve_cli] Using installed command: /Users/xiewenlong/.local/bin/cli-anything-datus
collected 97 items

cli_anything/datus/tests/test_core.py::TestSessionLoad::test_load_missing_path_returns_empty PASSED [  1%]
cli_anything/datus/tests/test_core.py::TestSessionLoad::test_load_none_path_returns_empty PASSED [  2%]
cli_anything/datus/tests/test_core.py::TestSessionLoad::test_load_existing_restores_fields PASSED [  3%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_append_query_increments_history PASSED [  4%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_save_writes_valid_json PASSED [  5%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_save_is_idempotent PASSED [  6%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_save_clears_modified PASSED [  7%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_save_without_path_is_noop PASSED [  8%]
cli_anything/datus/tests/test_core.py::TestSessionPersist::test_concurrent_saves_do_not_corrupt PASSED [  9%]
cli_anything/datus/tests/test_core.py::TestSessionUndoRedo::test_clear_is_undoable PASSED [ 10%]
cli_anything/datus/tests/test_core.py::TestSessionUndoRedo::test_redo_after_undo PASSED [ 11%]
cli_anything/datus/tests/test_core.py::TestSessionUndoRedo::test_undo_empty_stack_false PASSED [ 12%]
cli_anything/datus/tests/test_core.py::TestSessionUndoRedo::test_new_mutation_clears_redo PASSED [ 13%]
cli_anything/datus/tests/test_core.py::TestSessionUndoRedo::test_undo_stack_capped PASSED [ 14%]
cli_anything/datus/tests/test_core.py::TestSessionSettings::test_set_datasource_marks_modified_on_change PASSED [ 15%]
cli_anything/datus/tests/test_core.py::TestSessionSettings::test_set_subagent PASSED [ 16%]
cli_anything/datus/tests/test_core.py::TestSessionSettings::test_to_status_dict_counts PASSED [ 17%]
cli_anything/datus/tests/test_core.py::TestResolveConfig::test_explicit_config_wins PASSED [ 18%]
cli_anything/datus/tests/test_core.py::TestResolveConfig::test_home_fallback PASSED [ 19%]
cli_anything/datus/tests/test_core.py::TestResolveConfig::test_nothing_found PASSED [ 20%]
cli_anything/datus/tests/test_core.py::TestResolveConfig::test_default_home_env PASSED [ 21%]
cli_anything/datus/tests/test_core.py::TestLoadAgentSection::test_valid PASSED [ 22%]
cli_anything/datus/tests/test_core.py::TestLoadAgentSection::test_missing_raises PASSED [ 23%]
cli_anything/datus/tests/test_core.py::TestLoadAgentSection::test_missing_config_path_raises PASSED [ 24%]
cli_anything/datus/tests/test_core.py::TestDatasourceSpecs::test_list_specs PASSED [ 25%]
cli_anything/datus/tests/test_core.py::TestDatasourceSpecs::test_default_true_wins PASSED [ 26%]
cli_anything/datus/tests/test_core.py::TestDatasourceSpecs::test_sole_entry_is_default PASSED [ 27%]
cli_anything/datus/tests/test_core.py::TestDatasourceSpecs::test_multiple_no_default_none PASSED [ 28%]
cli_anything/datus/tests/test_core.py::TestDatasourceSpecs::test_none_when_empty PASSED [ 29%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_explicit_wins PASSED [ 30%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_session_used_when_no_explicit PASSED [ 31%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_default_used PASSED [ 32%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_unique_used PASSED [ 34%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_unknown_explicit_errors_listing_options PASSED [ 35%]
cli_anything/datus/tests/test_core.py::TestResolveDatasource::test_none_configured_errors PASSED [ 36%]
cli_anything/datus/tests/test_core.py::TestActiveModel::test_custom_alias PASSED [ 37%]
cli_anything/datus/tests/test_core.py::TestActiveModel::test_provider_target PASSED [ 38%]
cli_anything/datus/tests/test_core.py::TestActiveModel::test_unknown PASSED [ 39%]
cli_anything/datus/tests/test_core.py::TestProjectName::test_uses_root_basename PASSED [ 40%]
cli_anything/datus/tests/test_core.py::TestProjectName::test_sanitizes_odd_chars PASSED [ 41%]
cli_anything/datus/tests/test_core.py::TestProjectName::test_empty_falls_back PASSED [ 42%]
cli_anything/datus/tests/test_core.py::TestProjectName::test_defaults_to_cwd PASSED [ 43%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[SELECT * FROM t] PASSED [ 44%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[  select 1] PASSED [ 45%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[WITH x AS (SELECT 1) SELECT * FROM x] PASSED [ 46%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[EXPLAIN SELECT 1] PASSED [ 47%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[PRAGMA table_info(t)] PASSED [ 48%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[VALUES (1), (2)] PASSED [ 49%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[SELECT 1 -- comment] PASSED [ 50%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_true[SELECT 1;] PASSED [ 51%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[INSERT INTO t VALUES (1)] PASSED [ 52%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[UPDATE t SET a=1] PASSED [ 53%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[DELETE FROM t] PASSED [ 54%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[DROP TABLE t] PASSED [ 55%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[CREATE TABLE t (a int)] PASSED [ 56%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[ALTER TABLE t ADD b int] PASSED [ 57%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[TRUNCATE TABLE t] PASSED [ 58%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[MERGE INTO t USING s ON 1=1] PASSED [ 59%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[] PASSED [ 60%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[   ] PASSED [ 61%]
cli_anything/datus/tests/test_core.py::TestReadOnlySQL::test_read_only_false[SELECT * FROM t; DELETE FROM t] PASSED [ 62%]
cli_anything/datus/tests/test_core.py::TestShapeRows::test_basic PASSED  [ 63%]
cli_anything/datus/tests/test_core.py::TestShapeRows::test_limit_truncates PASSED [ 64%]
cli_anything/datus/tests/test_core.py::TestShapeRows::test_empty_result PASSED [ 65%]
cli_anything/datus/tests/test_core.py::TestShapeRows::test_none_return PASSED [ 67%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_add_sqlite PASSED [ 68%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_duplicate_refused_without_force PASSED [ 69%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_force_overwrites PASSED [ 70%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_missing_config_errors PASSED [ 71%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_sqlite_requires_uri PASSED [ 72%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_server_requires_host PASSED [ 73%]
cli_anything/datus/tests/test_core.py::TestAddDatasource::test_server_datasource PASSED [ 74%]
cli_anything/datus/tests/test_core.py::TestBuildDatasources::test_builds_dbconfig_objects PASSED [ 75%]
cli_anything/datus/tests/test_core.py::TestQueryError::test_query_error_is_exception PASSED [ 76%]
cli_anything/datus/tests/test_core.py::TestQueryError::test_explain_text_strips_none PASSED [ 77%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_connection PASSED [ 78%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_list_tables PASSED [ 79%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_schema_has_expected_column PASSED [ 80%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_execute_sql_count PASSED [ 81%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_execute_sql_bad_column_errors PASSED [ 82%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_execute_sql_limit_truncates PASSED [ 83%]
cli_anything/datus/tests/test_full_e2e.py::TestRealDBLayer::test_add_datasource_roundtrip PASSED [ 84%]
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count PASSED [ 85%]
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_surfaces_explanation PASSED [ 86%]
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_query_error_when_no_sql PASSED [ 87%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_help PASSED [ 88%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_status_show_json PASSED [ 89%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_status_datasources_json PASSED [ 90%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_datasource_tables_json PASSED [ 91%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_datasource_schema_json PASSED [ 92%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_sql_run_json PASSED [ 93%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_sql_run_error PASSED [ 94%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_datasource_use_persists_session PASSED [ 95%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_session_lifecycle PASSED [ 96%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_query_ask_error_path PASSED [ 97%]
cli_anything/datus/tests/test_full_e2e.py::TestCLISubprocess::test_full_workflow PASSED [ 98%]
cli_anything/datus/tests/test_full_e2e.py::TestSampleDatabaseIntegrity::test_sample_db_has_expected_shape PASSED [100%]

=============================== warnings summary ===============================
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/schemas/action_history.py:46: PydanticDeprecatedSince20: Support for class-based `config` is deprecated, use ConfigDict instead. ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/schemas/agent_models.py:61: PydanticDeprecatedSince20: ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/schemas/batch_events.py:62: PydanticDeprecatedSince20: ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/tools/permission/permission_config.py:90: PydanticDeprecatedSince20: ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/tools/permission/permission_config.py:171: PydanticDeprecatedSince20: ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/tools/permission/permission_config.py:253: PydanticDeprecatedSince20: ...
cli_anything/datus/tests/test_full_e2e.py::TestRealAgentLoop::test_nl_to_sql_count
  /Users/xiewenlong/Documents/code/Datus-agent/datus/tools/skill_tools/skill_config.py:270: PydanticDeprecatedSince20: ...

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
======================= 97 passed, 7 warnings in 22.22s ========================
```

All 7 warnings are `PydanticDeprecatedSince20` emitted **from inside Datus's
own source** (schemas/permission classes), not from the harness. They do not
affect behavior.

### 2. Summary Statistics

| Metric | Value |
| --- | --- |
| Total tests | **97** |
| Passed | **97** |
| Failed / Error / Skipped | 0 / 0 / 0 |
| Pass rate | **100%** |
| Duration | ~22 s (wall clock, single machine) |
| Unit tests (`test_core.py`) | 75 |
| E2E tests (`test_full_e2e.py`) | 22 |
| Subprocess tests (installed CLI) | 11 |
| Warnings | 7 (all Datus-internal Pydantic deprecations) |

### 3. Coverage Notes

**Real-software coverage (HARNESS rule #1).** Every E2E layer drives the real
Datus code, never a reimplementation:

- `TestRealDBLayer` (7): the real `datus.tools.db_tools.db_manager.DBManager`
  + real `sqlite3` connector against the real
  `datus/sample_data/california_schools/california_schools.sqlite` file.
  Real tables listed, real schema introspection (`CDSCode` PK), real query
  execution (`COUNT(*) = 17686`), real error path (bad column), real
  `datasource add` → agent.yml → reconnect roundtrip.
- `TestRealAgentLoop` (3): the real Datus agent workflow
  (`load_agent_config` → `create_interactive_node` → `node.execute()`) with
  Datus's first-party `MockLLMModel`. Only the LLM *decision* is scripted —
  the agent loop, permission system, and the `execute_sql` tool all run for
  real, so the test asserts `tool_results[0]["executed"] is True` and the
  real answer rows `[[17686]]` come back through the real DB layer.
- `TestCLISubprocess` (11): the installed `cli-anything-datus` binary (via
  `~/.local/bin` shim → `~/.datus/venv/bin`) run as a real subprocess with
  `--json`. Session persistence (`.datus-cli/session.json`), auto-save on
  `datasource use`, undo/redo/clear, the `query ask` error path (no LLM →
  clean JSON error, exit 1, no hang), and a full multi-command workflow.

**What the unit layer covers (75 tests):** session load/save/persistence
(including concurrent-save lock correctness), undo/redo invariants (stack
cap, redo cleared on new mutation), config resolution order, agent.yml
parsing, datasource spec extraction and resolution (explicit > session >
default > unique > loud error), active-model detection, project-name
sanitization, the read-only SQL classifier (18 parametrized cases incl.
multi-statement traps), row-shaping/limit truncation, and
`datasource add` idempotency/force semantics.

**Intentionally not covered:** a live-LLM `query ask` success path (depends
on an external model endpoint; would make the 100% pass-rate flaky). The
equivalent code path is fully exercised by `TestRealAgentLoop` with the
mocked LLM decision, and the live endpoint's error path is exercised by
`test_query_ask_error_path`. The interactive TUI/Streamlit/MCP front-ends of
Datus are out of scope by design — the harness is itself a front-end over the
same in-process API, and Datus has no external process/binary to drive.
