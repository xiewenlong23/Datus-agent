"""cli-anything-datus — a stateful CLI harness for the Datus data engineering agent.

Works as one-shot subcommands (for agents / scripting) and, with no subcommand,
drops into an interactive REPL. Every command supports ``--json`` for machine
readable output. The harness drives the REAL Datus framework in-process.

Run ``cli-anything-datus --help`` for the full command tree.
"""

from __future__ import annotations

import functools
import json
import os
import sys
from typing import Any, Callable, Dict, List, Optional

import click

from cli_anything.datus import __version__
from cli_anything.datus.core import config as cfg
from cli_anything.datus.core import context as ctxmod
from cli_anything.datus.core import db
from cli_anything.datus.core import query as querymod
from cli_anything.datus.core.session import Session, default_session_path
from cli_anything.datus.utils.datus_backend import DatusBackendError, datus_version
from cli_anything.datus.utils.repl_skin import ReplSkin

_repl_mode = False
_ACTIVE_SESSION: Optional[Session] = None


# ── output / error helpers ───────────────────────────────────────────────────


def _report(ctx: click.Context, message: str, code: int) -> None:
    """Emit an error (JSON or human) and exit with ``code``."""
    if ctx.obj.get("json"):
        click.echo(json.dumps({"error": message}, indent=2))
    else:
        skin = ctx.obj.get("skin")
        if skin is not None:
            skin.error(message)
        else:
            click.echo(f"error: {message}", err=True)
    sys.exit(code)


def _emit(ctx: click.Context, data: Dict[str, Any], human: Optional[Callable] = None) -> None:
    if ctx.obj.get("json"):
        click.echo(json.dumps(data, indent=2, default=str))
    elif human is not None:
        human(ctx.obj["skin"], data)
    else:
        click.echo(json.dumps(data, indent=2, default=str))


def run(ctx: click.Context, fn: Callable, *args: Any, human: Optional[Callable] = None, **kwargs: Any) -> Dict[str, Any]:
    """Run a core function, map exceptions to clean errors, and emit the result."""
    try:
        data = fn(*args, **kwargs)
    except DatusBackendError as exc:
        _report(ctx, str(exc), 2)
    except querymod.QueryError as exc:
        _report(ctx, str(exc), 1)
    except (ValueError, FileNotFoundError) as exc:
        _report(ctx, str(exc), 1)
    except Exception as exc:  # noqa: BLE001 — surface anything with a clean message
        _report(ctx, f"{type(exc).__name__}: {exc}", 1)
    _emit(ctx, data, human=human)
    return data


def _resolve_ds(ctx: click.Context) -> str:
    agent = cfg.load_agent_section(ctx.obj["config"])
    return cfg.resolve_datasource(
        agent,
        explicit=ctx.obj["datasource"],
        session_datasource=ctx.obj["session"].datasource,
    )


def _require_config(ctx: click.Context) -> str:
    if not ctx.obj["config"] or not os.path.isfile(ctx.obj["config"]):
        _report(ctx, "No agent.yml found. Pass --config PATH or --home PATH (default ~/.datus).", 1)
    return ctx.obj["config"]


# ── human renderers ──────────────────────────────────────────────────────────


def _h_status(skin, data):
    skin.status("Datus version", str(data.get("datus_version", "-")))
    skin.status("Home", str(data.get("home", "-")))
    skin.status("agent.yml", data.get("config") or "(not found)")
    skin.status("Project", str(data.get("project", "-")))
    model = data.get("active_model") or {}
    if model.get("model"):
        skin.status("Active model", f"{model.get('target')} → {model.get('model')}")
    skin.status("Datasources", str(data.get("datasource_count", 0)))
    if data.get("default_datasource"):
        skin.status("Default datasource", str(data["default_datasource"]))
    if data.get("error"):
        skin.warning(data["error"])


def _h_datasources(skin, data):
    if not data["items"]:
        skin.warning("No datasources configured.")
        return
    rows = [[d["name"], str(d.get("type", "")), "yes" if d.get("default") else ""] for d in data["items"]]
    skin.table(["name", "type", "default"], rows)
    if data.get("default"):
        skin.info(f"Default: {data['default']}")


def _h_tables(skin, data):
    skin.status("Datasource", f"{data['datasource']} ({data.get('database') or '?'})")
    for t in data["tables"]:
        skin.hint(f"  {t}")
    skin.info(f"{data['count']} table(s)")


def _h_schema(skin, data):
    for tbl in data["tables"]:
        skin.section(f"{tbl['table']}")
        rows = [[c["name"], str(c.get("type") or ""), "PK" if c.get("pk") else "", "null" if c.get("nullable") else ""]
                for c in tbl["columns"]]
        skin.table(["column", "type", "key", "null"], rows)


def _h_test(skin, data):
    if data["connected"]:
        skin.success(f"Connected to {data['datasource']} (database: {data.get('database') or '?'})")
    else:
        skin.error(f"Could not connect to {data['datasource']}")


def _h_sql(skin, data):
    if not data.get("success"):
        skin.error(data.get("error") or "SQL execution failed")
        return
    skin.status("Rows", f"{data.get('row_count', 0)}" + (" (truncated)" if data.get("truncated") else ""))
    if data.get("columns"):
        skin.table(data["columns"], [[str(c) for c in row] for row in data["rows"]])
    else:
        skin.hint("(no columns returned)")


def _h_query(skin, data):
    skin.status("Datasource", str(data.get("datasource")))
    if data.get("sql"):
        skin.section("SQL")
        for line in str(data["sql"]).splitlines():
            skin.hint(line)
    if data.get("explanation"):
        skin.info(data["explanation"])
    if data.get("executed") and data.get("columns"):
        skin.status("Rows", f"{data.get('row_count', 0)}" + (" (truncated)" if data.get("truncated") else ""))
        skin.table(data["columns"], [[str(c) for c in row] for row in data["rows"]])
    if data.get("error"):
        skin.error(data["error"])


def _h_subagents(skin, data):
    if not data["items"]:
        skin.warning("No subagents configured.")
        return
    rows = [[d["name"], str(d.get("system_prompt") or ""), str(d.get("tools") or "")[:40]] for d in data["items"]]
    skin.table(["name", "prompt", "tools"], rows)


def _h_refsql(skin, data):
    if not data["items"]:
        skin.warning("No reference-SQL artifacts found under ./subject/sql_summaries")
        return
    rows = [[d["name"], str(d.get("subject_tree") or ""), d.get("file", "")] for d in data["items"]]
    skin.table(["name", "subject", "file"], rows)


def _h_semmodels(skin, data):
    if not data["items"]:
        skin.warning("No semantic-model artifacts found under ./subject/semantic_models")
        return
    rows = [[d["name"], str(d.get("kind") or ""), d.get("file", "")] for d in data["items"]]
    skin.table(["name", "kind", "file"], rows)


def _h_session(skin, data):
    skin.status("Session file", str(data.get("session_file") or "(none)"))
    skin.status("Datasource", str(data.get("datasource") or "-"))
    skin.status("Subagent", str(data.get("subagent") or "-"))
    skin.status("History", f"{data.get('history_count', 0)} entries")
    skin.status("Undo / redo", f"{data.get('undo_depth', 0)} / {data.get('redo_depth', 0)}")


def _h_history(skin, data):
    if not data["items"]:
        skin.warning("History is empty.")
        return
    for e in data["items"]:
        skin.section(f"[{e.get('ts','')}] {e.get('question','')[:60]}")
        if e.get("sql"):
            skin.hint(f"  SQL: {e['sql']}")
        if e.get("row_count") is not None:
            skin.status("rows", str(e.get("row_count")))
        if e.get("error"):
            skin.error(str(e["error"]))


def _h_clear(skin, data):
    skin.success(f"Cleared {data.get('cleared', 0)} history entry(ies). (undo to restore)")


def _h_undoredo(skin, data):
    if data.get("ok"):
        skin.success(f"{data.get('op','op')} applied — history now {data.get('history_count',0)} entries")
    else:
        skin.warning(f"Nothing to {data.get('op','op')}")


# ── CLI group ────────────────────────────────────────────────────────────────


@click.group(invoke_without_command=True)
@click.option("--json", "use_json", is_flag=True, help="Output as JSON")
@click.option("--home", "home", type=str, default=None, help="Datus home directory (default ~/.datus)")
@click.option("--config", "config_path", type=str, default=None, help="Path to agent.yml")
@click.option("--project", "project_path", type=str, default=None, help="Harness session file path")
@click.option("--datasource", "datasource", type=str, default=None, help="Datasource name")
@click.option("--subagent", "subagent", type=str, default=None, help="Subagent for `query ask`")
@click.option("--dry-run", "dry_run", is_flag=True, default=False, help="Skip auto-saving session changes")
@click.version_option(__version__, prog_name="cli-anything-datus")
@click.pass_context
def cli(ctx, use_json, home, config_path, project_path, datasource, subagent, dry_run):
    """cli-anything-datus — drive the Datus NL→SQL agent from the command line."""
    global _ACTIVE_SESSION
    ctx.ensure_object(dict)

    resolved = cfg.resolve_config(home=home, config=config_path)
    session_path = project_path or default_session_path()
    session = Session.load(session_path)
    session.project_path = session_path  # save target; only written when modified
    session.bind(
        home=resolved.home,
        config=resolved.config_path,
        project=cfg.project_name_for(),
    )
    _ACTIVE_SESSION = session

    ctx.obj.update(
        {
            "json": use_json,
            "home": resolved.home,
            "config": resolved.config_path,
            "datasource": datasource,
            "subagent": subagent,
            "dry_run": dry_run,
            "session": session,
            "skin": ReplSkin("datus", version=__version__),
        }
    )
    if ctx.invoked_subcommand is None:
        ctx.invoke(repl)


@cli.result_callback()
def _auto_save_on_exit(result, use_json, home, config_path, project_path, datasource, subagent, dry_run, **kwargs):
    """Auto-save the session after one-shot commands if state was modified."""
    if _repl_mode:
        return
    if dry_run:
        return
    sess = _ACTIVE_SESSION
    if sess is not None and sess.project_path and sess.modified:
        try:
            sess.save_session()
        except Exception as exc:  # noqa: BLE001
            click.echo(f"Warning: auto-save failed: {exc}", err=True)


# ── status ───────────────────────────────────────────────────────────────────


@cli.group()
def status():
    """Inspect the Datus installation and configuration (no DB/LLM needed)."""


@status.command("show")
@click.pass_context
def status_show(ctx):
    """Show home, config, project, active model, and datasource count."""
    o = ctx.obj
    data = {
        "home": o["home"],
        "config": o["config"],
        "config_found": bool(o["config"] and os.path.isfile(o["config"])),
        "project": cfg.project_name_for(),
        "datus_version": datus_version(),
        "active_model": None,
        "datasource_count": 0,
        "default_datasource": None,
        "error": None,
    }
    try:
        agent = cfg.load_agent_section(o["config"]) if data["config_found"] else {}
        data["active_model"] = cfg.get_active_model(agent)
        data["datasource_count"] = len(cfg.list_datasource_specs(agent))
        data["default_datasource"] = cfg.default_datasource_name(agent)
    except (FileNotFoundError, ValueError) as exc:
        data["error"] = str(exc)
    _emit(ctx, data, human=_h_status)


@status.command("datasources")
@click.pass_context
def status_datasources(ctx):
    """List configured datasources."""
    _require_config(ctx)
    agent = cfg.load_agent_section(ctx.obj["config"])
    data = {"items": cfg.list_datasource_specs(agent), "default": cfg.default_datasource_name(agent)}
    run(ctx, lambda: data, human=_h_datasources)


@status.command("subagents")
@click.pass_context
def status_subagents(ctx):
    """List configured subagents (agent.agentic_nodes)."""
    _require_config(ctx)
    run(ctx, ctxmod.list_subagents, ctx.obj["config"], human=_h_subagents)


# ── datasource ───────────────────────────────────────────────────────────────


@cli.group()
def datasource():
    """Introspect and manage Datus datasources (real DB connections)."""


@datasource.command("list")
@click.pass_context
def datasource_list(ctx):
    """List configured datasources."""
    _require_config(ctx)
    agent = cfg.load_agent_section(ctx.obj["config"])
    data = {"items": cfg.list_datasource_specs(agent), "default": cfg.default_datasource_name(agent)}
    run(ctx, lambda: data, human=_h_datasources)


@datasource.command("tables")
@click.argument("name", required=False)
@click.pass_context
def datasource_tables(ctx, name):
    """List tables in a datasource (connects to the real database)."""
    _require_config(ctx)
    o = ctx.obj
    agent = cfg.load_agent_section(o["config"])
    ds = cfg.resolve_datasource(agent, explicit=name or o["datasource"], session_datasource=o["session"].datasource)
    run(ctx, db.list_tables, o["config"], ds, human=_h_tables)


@datasource.command("schema")
@click.argument("name", required=False)
@click.option("--table", "table", type=str, default=None, help="Only this table")
@click.pass_context
def datasource_schema(ctx, name, table):
    """Show table/column schema for a datasource."""
    _require_config(ctx)
    o = ctx.obj
    agent = cfg.load_agent_section(o["config"])
    ds = cfg.resolve_datasource(agent, explicit=name or o["datasource"], session_datasource=o["session"].datasource)
    run(ctx, db.get_schema, o["config"], ds, table, human=_h_schema)


@datasource.command("test")
@click.argument("name", required=False)
@click.pass_context
def datasource_test(ctx, name):
    """Test connectivity to a datasource."""
    _require_config(ctx)
    o = ctx.obj
    agent = cfg.load_agent_section(o["config"])
    ds = cfg.resolve_datasource(agent, explicit=name or o["datasource"], session_datasource=o["session"].datasource)
    run(ctx, db.test_connection, o["config"], ds, human=_h_test)


@datasource.command("add")
@click.argument("name")
@click.option("--type", "ds_type", required=True, help="sqlite|duckdb|mysql|postgres|...")
@click.option("--uri", "uri", type=str, default=None, help="File URI (sqlite/duckdb)")
@click.option("--host", "host", type=str, default=None)
@click.option("--port", "port", type=int, default=None)
@click.option("--username", "username", type=str, default=None)
@click.option("--password", "password", type=str, default=None)
@click.option("--database", "database", type=str, default=None)
@click.option("--force", "force", is_flag=True, default=False, help="Overwrite an existing entry")
@click.pass_context
def datasource_add(ctx, name, ds_type, uri, host, port, username, password, database, force):
    """Add a datasource to agent.yml (the only write to Datus-owned state)."""
    _require_config(ctx)
    data = run(
        ctx,
        db.add_datasource,
        ctx.obj["config"], name, ds_type, uri=uri, host=host, port=port,
        username=username, password=password, database=database, force=force,
    )
    if ctx.obj["json"]:
        return
    ctx.obj["skin"].success(f"Datasource '{name}' ({ds_type}) written to {ctx.obj['config']}")


@datasource.command("use")
@click.argument("name")
@click.pass_context
def datasource_use(ctx, name):
    """Set the active datasource for this session (auto-saved)."""
    _require_config(ctx)
    agent = cfg.load_agent_section(ctx.obj["config"])
    names = [d["name"] for d in cfg.list_datasource_specs(agent)]
    if name not in names:
        _report(ctx, f"Datasource {name!r} not configured. Available: {', '.join(names) or '(none)'}", 1)
    changed = ctx.obj["session"].set_datasource(name)
    data = {"datasource": name, "changed": changed}
    _emit(ctx, data, human=lambda s, d: s.success(f"Active datasource set to {name}"))


# ── sql ──────────────────────────────────────────────────────────────────────


@cli.group()
def sql():
    """Execute raw SQL against a datasource (no LLM)."""


@sql.command("run")
@click.argument("statement")
@click.option("--limit", "limit", type=int, default=100, show_default=True,
              help="Max rows to return (0 = no limit)")
@click.pass_context
def sql_run(ctx, statement, limit):
    """Run a SQL statement and return rows as JSON/table."""
    _require_config(ctx)
    ds = _resolve_ds(ctx)
    lim = None if limit == 0 else limit
    data = run(ctx, db.execute_sql, ctx.obj["config"], ds, statement, lim, human=_h_sql)
    # A failed statement is a loud failure (non-zero exit), not a silent success.
    if data and data.get("success") is False:
        sys.exit(1)
    return data


# ── query (NL→SQL, real agent + LLM) ─────────────────────────────────────────


@cli.group()
def query():
    """Natural-language → SQL via the real Datus agent (requires a configured LLM)."""


@query.command("ask")
@click.argument("question")
@click.option("--limit", "limit", type=int, default=50, show_default=True,
              help="Max answer rows to include (0 = no limit)")
@click.pass_context
def query_ask(ctx, question, limit):
    """Ask a data question in natural language; returns SQL + answer rows."""
    global _ACTIVE_SESSION
    _require_config(ctx)
    o = ctx.obj
    ds = _resolve_ds(ctx)
    lim = None if limit == 0 else limit
    data = run(ctx, querymod.ask, question, o["config"], o["home"], ds, o["subagent"], lim, human=_h_query)
    if data:
        o["session"].append_query(
            data["question"], data.get("sql"), data.get("explanation"),
            data.get("rows"), data.get("columns"), data.get("row_count"), data.get("error"),
        )
    return data


# ── context (read-only KB introspection) ─────────────────────────────────────


@cli.group()
def context():
    """Inspect Datus knowledge-base state (agent.yml + ./subject YAML)."""


@context.command("subagents")
@click.pass_context
def context_subagents(ctx):
    """List subagents with their scoped context."""
    _require_config(ctx)
    run(ctx, ctxmod.list_subagents, ctx.obj["config"], human=_h_subagents)


@context.command("reference-sql")
@click.pass_context
def context_reference_sql(ctx):
    """List reference-SQL artifacts under ./subject/sql_summaries."""
    run(ctx, ctxmod.list_reference_sql, os.getcwd(), human=_h_refsql)


@context.command("semantic-models")
@click.pass_context
def context_semantic_models(ctx):
    """List semantic-model artifacts under ./subject/semantic_models."""
    run(ctx, ctxmod.list_semantic_models, os.getcwd(), human=_h_semmodels)


# ── session (harness state) ──────────────────────────────────────────────────


@cli.group()
def session():
    """Manage the harness conversation session (auto-saved state file)."""


@session.command("show")
@click.pass_context
def session_show(ctx):
    """Show the current session state."""
    run(ctx, lambda: ctx.obj["session"].to_status_dict(), human=_h_session)


@session.command("history")
@click.option("--limit", "limit", type=int, default=20, show_default=True, help="Max entries")
@click.pass_context
def session_history(ctx, limit):
    """Show recent question→SQL history."""
    items = ctx.obj["session"].history[-limit:] if limit and limit > 0 else ctx.obj["session"].history
    run(ctx, lambda: {"items": items, "count": len(items)}, human=_h_history)


@session.command("clear")
@click.pass_context
def session_clear(ctx):
    """Clear history (undoable, auto-saved)."""
    n = ctx.obj["session"].clear_history()
    run(ctx, lambda: {"cleared": n}, human=_h_clear)


@session.command("undo")
@click.pass_context
def session_undo(ctx):
    """Undo the last history mutation."""
    ok = ctx.obj["session"].undo()
    run(ctx, lambda: {"ok": ok, "op": "undo", "history_count": len(ctx.obj["session"].history)}, human=_h_undoredo)


@session.command("redo")
@click.pass_context
def session_redo(ctx):
    """Redo a history mutation."""
    ok = ctx.obj["session"].redo()
    run(ctx, lambda: {"ok": ok, "op": "redo", "history_count": len(ctx.obj["session"].history)}, human=_h_undoredo)


# ── REPL (default when no subcommand) ────────────────────────────────────────

_REPL_COMMANDS = {
    "help": "Show this help",
    "status": "Show Datus status (home, model, datasources)",
    "datasource <list|tables [NAME]|schema [NAME]|test [NAME]>": "Introspect datasources",
    "sql <SQL>": "Run raw SQL against the active datasource",
    "ask <QUESTION>": "Natural-language → SQL via the Datus agent",
    "use <DATASOURCE>": "Set the active datasource",
    "session <show|history|clear|undo|redo>": "Manage the conversation session",
    "context <subagents|reference-sql|semantic-models>": "Inspect the knowledge base",
    "exit / quit": "Leave the REPL",
}


@cli.command()
@click.pass_context
def repl(ctx):
    """Interactive REPL (default when no subcommand is given)."""
    global _repl_mode
    _repl_mode = True
    o = ctx.obj
    skin = o["skin"]
    session = o["session"]
    skin.print_banner()
    pt = skin.create_prompt_session()
    try:
        while True:
            try:
                line = skin.get_input(pt, project_name=session.project or "", modified=session.modified)
            except (EOFError, KeyboardInterrupt):
                line = "exit"
            line = line.strip()
            if not line:
                continue
            if line in ("exit", "quit"):
                break
            try:
                _repl_dispatch(o, line)
            except DatusBackendError as exc:
                skin.error(str(exc))
            except (ValueError, FileNotFoundError) as exc:
                skin.error(str(exc))
            except Exception as exc:  # noqa: BLE001
                skin.error(f"{type(exc).__name__}: {exc}")
    finally:
        _repl_mode = False
        skin.print_goodbye()


def _repl_dispatch(o: Dict[str, Any], line: str) -> None:
    skin = o["skin"]
    session = o["session"]
    parts = line.split(None, 1)
    cmd = parts[0]
    arg = parts[1] if len(parts) > 1 else ""

    if cmd == "help":
        skin.help(_REPL_COMMANDS)
    elif cmd == "status":
        agent = cfg.load_agent_section(o["config"])
        data = {
            "home": o["home"], "config": o["config"],
            "project": cfg.project_name_for(),
            "datus_version": datus_version(),
            "active_model": cfg.get_active_model(agent),
            "datasource_count": len(cfg.list_datasource_specs(agent)),
            "default_datasource": cfg.default_datasource_name(agent),
        }
        _h_status(skin, data)
    elif cmd == "datasource":
        _repl_datasource(o, arg)
    elif cmd == "sql":
        ds = _repl_resolve_ds(o)
        _h_sql(skin, db.execute_sql(o["config"], ds, arg, 100))
    elif cmd == "ask":
        ds = _repl_resolve_ds(o)
        data = querymod.ask(arg, o["config"], o["home"], ds, o["subagent"], 50)
        session.append_query(data["question"], data.get("sql"), data.get("explanation"),
                             data.get("rows"), data.get("columns"), data.get("row_count"), data.get("error"))
        _h_query(skin, data)
    elif cmd == "use":
        agent = cfg.load_agent_section(o["config"])
        names = [d["name"] for d in cfg.list_datasource_specs(agent)]
        if arg not in names:
            skin.error(f"Datasource {arg!r} not configured. Available: {', '.join(names) or '(none)'}")
            return
        session.set_datasource(arg)
        skin.success(f"Active datasource set to {arg}")
    elif cmd == "session":
        _repl_session(o, arg)
    elif cmd == "context":
        _repl_context(o, arg)
    else:
        skin.error(f"Unknown command: {cmd}. Type 'help'.")


def _repl_resolve_ds(o: Dict[str, Any]) -> str:
    agent = cfg.load_agent_section(o["config"])
    return cfg.resolve_datasource(
        agent, explicit=o["datasource"], session_datasource=o["session"].datasource
    )


def _repl_datasource(o: Dict[str, Any], arg: str) -> None:
    skin = o["skin"]
    parts = arg.split()
    sub = parts[0] if parts else "list"
    if sub == "list":
        agent = cfg.load_agent_section(o["config"])
        _h_datasources(skin, {"items": cfg.list_datasource_specs(agent), "default": cfg.default_datasource_name(agent)})
    elif sub in ("tables", "schema", "test"):
        name = parts[1] if len(parts) > 1 else None
        agent = cfg.load_agent_section(o["config"])
        ds = cfg.resolve_datasource(agent, explicit=name or o["datasource"], session_datasource=o["session"].datasource)
        if sub == "tables":
            _h_tables(skin, db.list_tables(o["config"], ds))
        elif sub == "schema":
            _h_schema(skin, db.get_schema(o["config"], ds))
        else:
            _h_test(skin, db.test_connection(o["config"], ds))
    else:
        skin.error(f"Unknown datasource subcommand: {sub}")


def _repl_session(o: Dict[str, Any], arg: str) -> None:
    skin = o["skin"]
    session = o["session"]
    parts = arg.split()
    sub = parts[0] if parts else "show"
    if sub == "show":
        _h_session(skin, session.to_status_dict())
    elif sub == "history":
        _h_history(skin, {"items": session.history[-20:], "count": len(session.history)})
    elif sub == "clear":
        _h_clear(skin, {"cleared": session.clear_history()})
    elif sub == "undo":
        _h_undoredo(skin, {"ok": session.undo(), "op": "undo", "history_count": len(session.history)})
    elif sub == "redo":
        _h_undoredo(skin, {"ok": session.redo(), "op": "redo", "history_count": len(session.history)})
    else:
        skin.error(f"Unknown session subcommand: {sub}")


def _repl_context(o: Dict[str, Any], arg: str) -> None:
    skin = o["skin"]
    sub = arg or "subagents"
    if sub == "subagents":
        _h_subagents(skin, ctxmod.list_subagents(o["config"]))
    elif sub == "reference-sql":
        _h_refsql(skin, ctxmod.list_reference_sql(os.getcwd()))
    elif sub == "semantic-models":
        _h_semmodels(skin, ctxmod.list_semantic_models(os.getcwd()))
    else:
        skin.error(f"Unknown context subcommand: {sub}")


def main() -> None:
    cli(obj={})


if __name__ == "__main__":
    main()
