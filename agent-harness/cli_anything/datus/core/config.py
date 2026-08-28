"""Datus configuration resolution and read-only parsing.

Mirrors Datus's own config resolution order:
    ``--config``  >  ``./conf/agent.yml``  >  ``{home}/conf/agent.yml``

The lightweight path (datasources / subagents / active model) reads ``agent.yml``
directly and never constructs a full :class:`~datus.configuration.agent_config.AgentConfig`
— that would initialize LanceDB backends and embedding machinery that pure
database work does not need.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import yaml

from cli_anything.datus.utils.datus_backend import datus_import


@dataclass
class ResolvedConfig:
    """Where Datus state lives for this invocation."""

    home: str
    config_path: Optional[str]  # None -> not found; commands that need it fail loudly

    @property
    def config_exists(self) -> bool:
        return bool(self.config_path and os.path.isfile(self.config_path))


def default_home() -> str:
    return os.path.expanduser(os.environ.get("DATUS_HOME", "~/.datus"))


def resolve_config(home: Optional[str] = None, config: Optional[str] = None) -> ResolvedConfig:
    """Resolve the Datus home and agent.yml path (Datus resolution order)."""
    home = os.path.expanduser(home or default_home())
    if config:
        config = os.path.abspath(os.path.expanduser(config))
    else:
        local = os.path.abspath("conf/agent.yml")
        home_cfg = os.path.join(home, "conf", "agent.yml")
        if os.path.isfile(local):
            config = local
        elif os.path.isfile(home_cfg):
            config = home_cfg
        else:
            config = None
    return ResolvedConfig(home=home, config_path=config)


def load_agent_section(config_path: str) -> Dict[str, Any]:
    """Return the top-level ``agent:`` mapping of an agent.yml ({} if absent)."""
    if not config_path or not os.path.isfile(config_path):
        raise FileNotFoundError(
            f"agent.yml not found at {config_path!r}. Pass --config PATH or --home PATH."
        )
    with open(config_path, "r", encoding="utf-8") as f:
        doc = yaml.safe_load(f) or {}
    agent = doc.get("agent") or {}
    if not isinstance(agent, dict):
        raise ValueError(f"Malformed agent section in {config_path}")
    return agent


def _datasource_section(agent: Dict[str, Any]) -> Dict[str, Any]:
    services = agent.get("services") or {}
    return services.get("datasources") or {}


def list_datasource_specs(agent: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Datasources as plain dicts: name, type, default, uri/host/port/database."""
    out: List[Dict[str, Any]] = []
    for name, spec in _datasource_section(agent).items():
        spec = spec or {}
        row = {"name": name, "type": spec.get("type", "")}
        for key in ("uri", "path_pattern", "host", "port", "database", "default"):
            if spec.get(key) is not None:
                row[key] = spec.get(key)
        out.append(row)
    return out


def default_datasource_name(agent: Dict[str, Any]) -> Optional[str]:
    """Datasource marked ``default: true``; else the sole entry; else None."""
    section = _datasource_section(agent)
    if not section:
        return None
    for name, spec in section.items():
        if (spec or {}).get("default"):
            return name
    if len(section) == 1:
        return next(iter(section))
    return None


def build_datasources(config_path: str) -> Dict[str, Any]:
    """``{name: DbConfig}`` for every configured datasource (real Datus types).

    Uses :meth:`DbConfig.filter_kwargs` — the same normalizer Datus's own
    datasource manager uses — so sqlite/duckdb URIs, server fields and ``extra``
    keys are handled identically to the first-party TUI.
    """
    from cli_anything.datus.utils.datus_backend import ensure_datus

    ensure_datus()
    cfg_mod = datus_import("configuration.agent_config")
    DbConfig = cfg_mod.DbConfig

    agent = load_agent_section(config_path)
    result: Dict[str, Any] = {}
    for name, spec in _datasource_section(agent).items():
        if not spec:
            continue
        try:
            result[name] = DbConfig.filter_kwargs(DbConfig, dict(spec))
        except Exception as exc:
            raise ValueError(f"Invalid datasource {name!r} in {config_path}: {exc}") from exc
    return result


def resolve_datasource(
    agent: Dict[str, Any],
    explicit: Optional[str] = None,
    session_datasource: Optional[str] = None,
) -> str:
    """Datasource resolution: explicit > session > default > unique > loud error."""
    names = list(_datasource_section(agent).keys())
    if not names:
        raise ValueError(
            f"No datasources configured in {agent and 'agent.yml'}. "
            "Add one with: cli-anything-datus datasource add NAME --type sqlite --uri PATH"
        )
    for candidate in (explicit, session_datasource):
        if candidate:
            if candidate in names:
                return candidate
            raise ValueError(
                f"Datasource {candidate!r} not configured. Available: {', '.join(names)}"
            )
    default = default_datasource_name(agent)
    if default:
        return default
    raise ValueError(f"Multiple datasources configured, pick one with --datasource: {', '.join(names)}")


def get_active_model(agent: Dict[str, Any]) -> Dict[str, Any]:
    """The active LLM model: ``agent.target`` (alias or {provider, model})."""
    target = agent.get("target")
    models = agent.get("models") or {}
    if isinstance(target, dict):
        return {"target": target.get("provider"), "model": target.get("model"), "kind": "provider"}
    if isinstance(target, str) and target in models:
        spec = models[target] or {}
        return {
            "target": target,
            "model": spec.get("model"),
            "base_url": spec.get("base_url"),
            "kind": "custom",
        }
    return {"target": target, "model": None, "kind": "unknown"}


def list_subagent_specs(agent: Dict[str, Any]) -> List[Dict[str, Any]]:
    """``agent.agentic_nodes`` entries as plain dicts."""
    out: List[Dict[str, Any]] = []
    for name, spec in (agent.get("agentic_nodes") or {}).items():
        spec = spec or {}
        scoped = spec.get("scoped_context") or {}
        out.append(
            {
                "name": name,
                "system_prompt": spec.get("system_prompt"),
                "description": spec.get("agent_description", ""),
                "tools": spec.get("tools", ""),
                "scoped_context": {k: v for k, v in scoped.items() if v},
            }
        )
    return out


def project_name_for(root: Optional[str] = None) -> str:
    """Best-effort Datus project name (like Datus's PathManager).

    Datus derives its project name from the project root (CWD by default); this
    mirrors that so ``status show`` / the session show a stable project label.
    """
    base = (root or os.getcwd()).rstrip("/")
    name = os.path.basename(base) or "default"
    sanitized = "".join(c if c.isalnum() or c in "._-" else "-" for c in name)
    return sanitized or "default"
