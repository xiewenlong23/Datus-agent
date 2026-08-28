# cli-anything-datus

A **stateful CLI harness** for the [Datus](https://datus.ai) data engineering
agent — it lets you (or an AI agent) drive Datus from the command line without a
display or mouse: introspect datasources, run SQL, and ask natural-language
questions that Datus turns into SQL.

The harness does **not** reimplement Datus. It drives the **real Datus Python
framework in-process** (the same `DBManager` / agent nodes the first-party TUI
uses). Datus is a **hard dependency**.

## What it does

| Command | What | Backend | LLM? |
|---|---|---|---|
| `status show / datasources / subagents` | Inspect config | `agent.yml` | No |
| `datasource list / tables / schema / test / add / use` | Introspect & manage datasources | real `DBManager` | No |
| `sql run "SELECT ..."` | Execute raw SQL | real `DBManager` | No |
| `query ask "How many schools?"` | Natural-language → SQL + rows | real Datus agent | **Yes** |
| `context subagents / reference-sql / semantic-models` | Inspect the knowledge base | `agent.yml` + `./subject/` | No |
| `session show / history / clear / undo / redo` | Conversation state | session JSON | No |

No subcommand → interactive **REPL**. Every command supports `--json`.

## Prerequisites

1. **Python ≥ 3.12**
2. **Datus** installed in that Python environment:
   ```bash
   pip install datus-agent
   # or the official one-liner (creates ~/.datus/venv + shims in ~/.local/bin):
   curl -fsSL https://raw.githubusercontent.com/datus-ai/datus-agent/main/install.sh | sh
   ```
3. A configured Datus `agent.yml` (datasources + an LLM model). Datus's
   interactive `datus` command walks you through this (`/model`,
   `/datasource`). The harness reads the same config.

## Installation

Install the harness into the **same environment** that provides `datus`
(must be Python ≥ 3.12):

```bash
cd /path/to/Datus-agent/agent-harness
~/.datus/venv/bin/pip install -e .        # if using the one-liner venv
# or: pip install -e .                    # if datus is in your active env
```

This creates the `cli-anything-datus` console script. If that environment's
`bin/` is not on your `PATH` (e.g. `~/.datus/venv/bin`), add a shim to a
directory that is (Datus's own installer does exactly this):

```bash
cat > ~/.local/bin/cli-anything-datus <<'SH'
#!/bin/sh
exec "$HOME/.datus/venv/bin/cli-anything-datus" "$@"
SH
chmod +x ~/.local/bin/cli-anything-datus
```

Verify:

```bash
which cli-anything-datus
cli-anything-datus --help
```

## Usage

### Introspect before you act

```bash
cli-anything-datus status show
cli-anything-datus status datasources
cli-anything-datus datasource tables california_schools
cli-anything-datus datasource schema california_schools --table schools
```

### Run SQL (no LLM)

```bash
cli-anything-datus --datasource california_schools \
    sql run "SELECT COUNT(*) AS n FROM schools" --json
```

### Ask a data question (real Datus agent + LLM)

```bash
cli-anything-datus --datasource california_schools \
    query ask "How many schools are there?" --json
```

Returns the generated SQL, an explanation, and (for read-only statements) the
answer rows. Each `query ask` appends to the session history.

### Machine-readable output

Every command honors `--json` (a global flag, place it before the subcommand):

```bash
cli-anything-datus --json sql run "SELECT 1"
```

### One-shot vs REPL

One-shot (for agents / scripts): pass a subcommand. Interactive: run with no
subcommand to enter the REPL.

### Session state & auto-save

`query ask`, `datasource use`, and `session clear/undo/redo` mutate the
harness session file (default `./.datus-cli/session.json`). Mutations are
**auto-saved on exit** for one-shot commands; `--dry-run` skips the save; the
REPL never auto-saves. `--project PATH` overrides the session file location.

### Pointing at a specific install

`--home PATH` (Datus home, default `~/.datus`) and `--config PATH`
(`agent.yml`) select which Datus installation the harness drives. Resolution
order for the config: `--config` → `./conf/agent.yml` → `~/.datus/conf/agent.yml`.

## Running the tests

```bash
cd /path/to/Datus-agent/agent-harness
CLI_ANYTHING_FORCE_INSTALLED=1 ~/.datus/venv/bin/python -m pytest \
    cli_anything/datus/tests/ -v -s
```

See `cli_anything/datus/tests/TEST.md` for the full plan and results.

## Layout

```
cli_anything/                     # PEP 420 namespace (NO __init__.py)
└── datus/
    ├── datus_cli.py              # Click CLI + REPL
    ├── core/                     # config, db, query, context, session
    ├── utils/datus_backend.py    # imports the real datus package
    ├── utils/repl_skin.py        # unified terminal skin
    ├── skills/SKILL.md           # agent-facing skill (packaged copy)
    └── tests/                    # TEST.md, test_core.py, test_full_e2e.py
```
