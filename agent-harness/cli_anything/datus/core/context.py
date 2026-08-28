"""Read-only introspection of Datus knowledge-base state.

Reads Datus's *native* on-disk artifacts — the ``agent.yml`` subagent
definitions and the ``./subject/`` YAML knowledge base — without initializing
vector stores or embedding models.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List

import yaml

from cli_anything.datus.core import config as cfg

# Fields worth surfacing from a reference-SQL YAML artifact.
_REF_SQL_FIELDS = ("name", "sql", "summary", "subject_tree", "tags", "search_text")


def list_subagents(config_path: str) -> Dict[str, Any]:
    """Subagents from ``agent.agentic_nodes`` (with scoped context)."""
    agent = cfg.load_agent_section(config_path)
    items = cfg.list_subagent_specs(agent)
    return {"count": len(items), "items": items}


def _iter_yaml_files(root: str) -> List[str]:
    if not os.path.isdir(root):
        return []
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if fn.lower().endswith((".yaml", ".yml")):
                found.append(os.path.join(dirpath, fn))
    return found


def list_reference_sql(project_root: str) -> Dict[str, Any]:
    """Reference-SQL artifacts under ``{project_root}/subject/sql_summaries``."""
    root = os.path.join(project_root, "subject", "sql_summaries")
    items: List[Dict[str, Any]] = []
    for path in _iter_yaml_files(root):
        try:
            with open(path, "r", encoding="utf-8") as f:
                doc = yaml.safe_load(f) or {}
        except yaml.YAMLError:
            continue
        entries = doc if isinstance(doc, list) else [doc]
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            item = {
                "file": os.path.relpath(path, project_root),
                "name": entry.get("name") or os.path.splitext(os.path.basename(path))[0],
            }
            for field in ("sql", "summary", "subject_tree", "tags", "search_text"):
                if entry.get(field):
                    item[field] = entry[field]
            items.append(item)
    return {"count": len(items), "items": items}


def list_semantic_models(project_root: str) -> Dict[str, Any]:
    """Semantic-model YAML artifacts under ``{project_root}/subject/semantic_models``."""
    root = os.path.join(project_root, "subject", "semantic_models")
    items: List[Dict[str, Any]] = []
    for path in _iter_yaml_files(root):
        try:
            with open(path, "r", encoding="utf-8") as f:
                doc = yaml.safe_load(f) or {}
        except yaml.YAMLError:
            doc = {}
        models = doc.get("models") if isinstance(doc, dict) else None
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict):
                    items.append(
                        {
                            "file": os.path.relpath(path, project_root),
                            "name": m.get("name") or m.get("model") or os.path.splitext(os.path.basename(path))[0],
                            "kind": m.get("kind") or m.get("type"),
                            "description": m.get("description") or m.get("summary"),
                        }
                    )
        else:
            items.append(
                {
                    "file": os.path.relpath(path, project_root),
                    "name": os.path.splitext(os.path.basename(path))[0],
                    "top_level_keys": sorted(doc.keys()) if isinstance(doc, dict) else None,
                }
            )
    return {"count": len(items), "items": items}
