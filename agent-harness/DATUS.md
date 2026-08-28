# Datus — CLI Harness SOP

**Software:** Datus (open-source data engineering agent, NL→SQL)
**Version analyzed:** 0.3.9 (local checkout, editable-installed)
**Harness CLI:** `cli-anything-datus` → package `cli_anything.datus`
**Methodology:** [HARNESS.md](../../.zcode/cli/plugins/marketplaces/cli-anything/cli-anything-plugin/HARNESS.md)

This document is the Datus-specific analysis and standard operating procedure for
building and using the `cli-anything-datus` harness. It follows the general SOP in
HARNESS.md; this file records what is specific to Datus.

---

## 1. What Datus Is (and why it is different from GIMP/Blender)

Most cli-anything targets are C++ GUI apps whose logic lives in a separate engine
(MLT, ImageMagick) exposed through a binary (`melt`, `gimp -i -b ...`). Datus is
different in one important way:

> **The "GUI" (the `datus` TUI REPL, the Streamlit web chatbot, the FastAPI server,
> the MCP server) is a front-end over a Python agent framework. The backend engine
> *is* the `datus` Python package itself.**

Therefore the harness does **not** shell out to an external binary. The "real
software" is the Datus Python API, invoked **in-process**:

| Datus capability | Real backend used by the harness | LLM needed? |
|---|---|---|
| Connect / introspect a datasource | `datus.tools.db_tools.db_manager.DBManager` + `BaseSqlConnector` (`datus_db_core`) | No |
| Execute raw SQL, list tables, read schema | `BaseSqlConnector.execute_query / get_tables / get_schema / test_connection` | No |
| Natural-language → SQL (the agent) | `load_agent_config()` → `create_interactive_node("gen_sql", ...)` → `node.execute()` | Yes (or `MockLLMModel` in tests) |
| Subagents / scoped context | `agent.agentic_nodes` section of `agent.yml` | No (read-only) |
| Reference SQL / semantic models | `./subject/` YAML artifacts on disk | No (read-only) |

The LLM is an **external service dependency** of the agent (configured in
`agent.yml`). The harness never reimplements NL→SQL; it drives the real Datus
agent node. Only the LLM's *decision step* is replaced by Datus's own first-party
test double (`tests/unit_tests/mock_llm_model.py::MockLLMModel`) in deterministic
tests — every tool (`execute_sql`, `list_tables`, `describe_table`) still executes
for real against the real database.

### The #1 rule, applied

- **Use the real Datus framework** for all database and agent work — never
  re-implement SQL generation or a database driver in this harness.
- **Datus is a hard dependency.** `utils/datus_backend.py` does `import datus`
  and raises a clear `DatusBackendError` with install instructions
  (`pip install datus-agent`, or the one-liner installer) when missing.
- **No graceful degradation.** Commands that need Datus fail loudly if it is not
  importable; E2E tests fail (not skip) when the real backend is unavailable.

---

## 2. Datus State Model (what the harness reads and writes)

### Global state — the Datus home (`~/.datus` by default, overridable with `--home`)

| Path | Owner | Used by harness |
|---|---|---|
| `~/.datus/conf/agent.yml` | Datus | **Read** (datasources, models, subagents) and **write** (`datasource add` appends to `agent.services.datasources`) |
| `~/.datus/data/{project}/datus_db/` | Datus (LanceDB + SQLite RDB) | Not touched by the harness (KB vector store) |
| `~/.datus/sessions/{project}/` | Datus | Not touched (Datus's own chat session DBs) |

### Project state — next to the working directory

| Path | Owner | Used by harness |
|---|---|---|
| `./.datus/config.yml` | Datus | Not touched (Datus project overrides) |
| `./subject/sql_summaries/*.yml` | Datus agent | **Read** (`context reference-sql`) |
| `./subject/semantic_models/{ds}/*.yml` | Datus agent | **Read** (`context semantic-models`) |

### Harness-owned state — the session file

The harness owns **one** persistent project file: the **session JSON**
(default `./.datus-cli/session.json`, override with `--project`). It tracks:

```json
{
  "version": 1,
  "home": "~/.datus",
  "config": "/abs/path/agent.yml",
  "project": "<datus project name>",
  "datasource": "california_schools",
  "subagent": null,
  "created_at": "2026-08-27T00:00:00Z",
  "updated_at": "2026-08-27T00:00:00Z",
  "history": [
    {
      "id": "qa_0001",
      "ts": "...",
      "kind": "query",
      "question": "How many schools are there?",
      "sql": "SELECT COUNT(*) FROM schools",
      "explanation": "...",
      "row_count": 1,
      "rows": [["900"]],
      "error": null
    }
  ],
  "undo_stack": [],
  "redo_stack": []
}
```

Mutating commands (`query ask`, `datasource use`, `subagent use`, `session clear`)
mark the session dirty and it is **auto-saved on exit** (see §6). `--dry-run`
suppresses the save. Undo/redo operate on history mutations.

Session saves use the `_locked_save_json` exclusive-locking pattern
(open `"r+"`, `flock`, truncate inside the lock) — see
`guides/session-locking.md`.

---

## 3. Headless Execution (how the harness invokes the real software)

### 3.1 Lightweight path — datasource & SQL (no LLM, no AgentConfig)

Parsing the full `AgentConfig` initializes LanceDB backends and embedding
machinery. For pure database work the harness skips that: it reads
`services.datasources` straight from `agent.yml`, builds
`datus.configuration.agent_config.DbConfig` objects (via
`DbConfig.filter_kwargs`, the same normalizer Datus's own datasource manager
uses), and constructs a `DBManager` directly.

```python
dm = DBManager(datasources)          # {name: DbConfig}
conn = dm.first_conn("california_schools")
conn.test_connection()               # bool
conn.get_tables()                    # ["frpm", "satscores", "schools"]
conn.get_schema(table_name="schools")
res = conn.execute_query("SELECT COUNT(*) FROM schools")   # ExecuteSQLResult
```

Config resolution order (identical to Datus): `--config` → `./conf/agent.yml`
→ `~/.datus/conf/agent.yml`.

### 3.2 Heavy path — NL→SQL agent (full AgentConfig + LLM)

```python
cfg = load_agent_config(config=<resolved>, home=<home>,
                        datasource=<ds>, permission_mode="normal")
node = create_interactive_node(subagent or "gen_sql", cfg,
                               node_id_suffix="_harness",
                               execution_mode="workflow")   # headless: ASK fails fast
node.input = create_node_input(user_message=question, node=node)
result = node.execute()           # GenSQLNodeResult: .sql, .response
```

- `execution_mode="workflow"` is the headless posture: permission ASKs fail fast
  instead of prompting. With `permission_mode="normal"`, SELECT / metadata
  statements are auto-allowed, which is exactly what a read-only `query ask`
  needs.
- After the agent returns SQL, the harness re-executes it through the **real**
  `DBManager` when the statement is read-only (`SELECT`/`WITH`/`EXPLAIN`),
  so `query ask` returns the answer rows in its JSON output (limited to
  `--limit`, default 50). Non-read statements are never re-executed.
- The LLM comes from the configured `agent.target`/`agent.models` in
  `agent.yml` (provider model or custom OpenAI-compatible endpoint).

### 3.3 Deterministic tests — Datus's first-party mock LLM

`tests/unit_tests/mock_llm_model.py` (in the Datus repo) provides
`MockLLMModel`, which scripts the LLM's *decisions* while executing the **real**
tools. The harness E2E suite drives the real agent loop this way:

```python
from tests.unit_tests.mock_llm_model import MockLLMModel, build_tool_then_response, MockToolCall
mock = MockLLMModel(responses=[build_tool_then_response(
    tool_calls=[MockToolCall("execute_sql", arguments='{"sql": "SELECT COUNT(*) FROM schools"}')],
    content='{"sql": "SELECT COUNT(*) FROM schools", "tables": ["schools"], "explanation": "..."}',
)])
with patch("datus.models.base.LLMBaseModel.create_model", return_value=mock):
    ...  # real node, real tools, real SQLite — only the LLM decision is mocked
```

This is the exact pattern Datus's own unit-test suite uses ("NO MOCK EXCEPT LLM").
It keeps the E2E suite deterministic and network-independent while still
invoking the real Datus agent framework, real tools, and a real database.

---

## 4. CLI Architecture

### Interaction model

Both modes, per HARNESS: one-shot subcommands for scripting/agents, and a
stateful REPL as the **default** when no subcommand is given
(`invoke_without_command=True`). Unified terminal skin via `ReplSkin`
(copied from the plugin).

### Command groups

| Group | Commands | Backend | Notes |
|---|---|---|---|
| `status` | `show`, `datasources`, `subagents` | agent.yml read | Cheap introspection, no DB/LLM |
| `datasource` | `list`, `tables [NAME]`, `schema [NAME] [--table T]`, `test [NAME]`, `add NAME --type T --uri U [--host H --port P --username U --password P --database D]`, `use NAME` | DBManager / agent.yml | `use` mutates the session (auto-save) |
| `sql` | `run SQL [--datasource N] [--limit N]` | DBManager | Real SQL execution, JSON rows |
| `query` | `ask QUESTION [--datasource N] [--subagent S] [--limit N]` | Datus agent + LLM | The NL→SQL core; appends to session history |
| `context` | `subagents`, `reference-sql`, `semantic-models` | agent.yml + `./subject/` YAML | Read-only KB introspection |
| `session` | `show`, `history [--limit N]`, `clear`, `undo`, `redo` | session file | State management |
| `repl` | (interactive) | all | Default when no subcommand |

### Global options

`--json` (machine output on every command), `--home PATH` (Datus home),
`--config PATH` (agent.yml), `--project PATH` (session file),
`--datasource NAME`, `--subagent NAME`, `--dry-run` (skip auto-save).

Datasource resolution: `--datasource` → session file → `default: true` in
agent.yml → the single configured datasource → loud error listing options.

### Output format

- `--json`: one JSON object per command on stdout. Stable keys:
  `sql run` → `{datasource, database, sql, columns, rows, row_count, truncated}`;
  `query ask` → `{datasource, subagent, question, sql, explanation, columns, rows,
  row_count, truncated, tokens_used?, error}`; lists → `{items: [...]}`.
- Human: ReplSkin tables/messages. Errors go to stderr with `✗` and an
  actionable message (including install instructions when Datus is missing).

### Error handling

- `DatusBackendError` (raised by `datus_backend.ensure_datus()`) → exit 2 with
  install instructions.
- Unknown datasource → exit 1 listing available datasources.
- SQL error → exit 1 with the database error text.
- Agent error (e.g. no model configured) → exit 1 with the Datus exception text.

---

## 5. Testing Strategy (summary — full plan in `tests/TEST.md`)

1. **Unit** (`test_core.py`): session load/save/lock/undo/redo, config parsing
   & datasource resolution, SQL result shaping, read-only statement detection —
   synthetic data, no Datus import required where avoidable.
2. **E2E — real DB layer** (`test_full_e2e.py`): real `DBManager` against the
   real bundled `california_schools.sqlite` (3 tables). `sql run`,
   `datasource tables/schema/test`. Verifies real rows and schema columns.
3. **E2E — real agent loop** (`test_full_e2e.py`): real
   `create_interactive_node("gen_sql")` + `MockLLMModel` (Datus first-party) +
   real SQLite. Verifies the generated SQL executes for real and the result
   object is well-formed. Prints artifact paths.
4. **CLI subprocess** (`test_full_e2e.py::TestCLISubprocess`):
   `_resolve_cli("cli-anything-datus")` — never a hardcoded path, no `cwd`.
   Tests `--help`, `--json`, `status`, `datasource`, `sql run` (real rows),
   `session` lifecycle, and a full one-shot workflow. Runs green under
   `CLI_ANYTHING_FORCE_INSTALLED=1`.
5. **Round-trip / agent test**: the subprocess workflow *is* the agent test —
   an external agent can drive `cli-anything-datus --json ...` end-to-end.

**No graceful degradation:** every E2E test requires the real Datus package and
the real SQLite file; missing either fails the test with a clear message.

---

## 6. Auto-Save + `--dry-run` (required for session-based CLIs)

The main Click group carries `--dry-run`; a `@cli.result_callback()` auto-saves
the session when (and only when) a one-shot command mutated it
(`sess._modified and sess.project_path and not repl_mode and not dry_run`).
REPL mode never auto-saves. `--dry-run` executes the command, prints output,
and skips the write. See `guides/auto-save-dry-run.md`.

---

## 7. Installation & PATH

- The harness installs into the **Datus venv** (`~/.datus/venv`, Python 3.12) —
  the only environment where `import datus` works:
  `~/.datus/venv/bin/pip install -e ./agent-harness`.
- `~/.datus/venv/bin` is not on PATH, so a shim is placed in `~/.local/bin`
  (the Datus-installer pattern used by `datus` itself):
  `~/.local/bin/cli-anything-datus` → `exec ~/.datus/venv/bin/cli-anything-datus "$@"`.
- `which cli-anything-datus` → the shim; `shutil.which()` in tests resolves it.
- `cli_anything/` has **no** `__init__.py` (PEP 420 namespace);
  `cli_anything/datus/` **has** one. `setup.py` uses
  `find_namespace_packages(include=["cli_anything.*"])`.

---

## 8. Safety Rules for Working on a Live Datus Install

This machine has a **live** `~/.datus` with real credentials and data.

1. Tests **never** write to `~/.datus`. They use `tmp_path` homes with a copy of
   the bundled sample SQLite and a generated test `agent.yml`.
2. The harness defaults to the user's real home for *production* commands (that
   is the point), but read-only commands are safe by construction; the only
   write to Datus-owned state is `datasource add`, which is explicit and
   idempotent (refuses to overwrite an existing entry without `--force`).
3. `query ask` runs under `permission_mode="normal"` + `execution_mode="workflow"`
   (SELECT auto-allowed, writes ASK→fail-fast) and the harness only re-executes
   read-only statements. No DDL/DML is ever issued by the harness itself.
