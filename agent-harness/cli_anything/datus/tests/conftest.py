"""Shared fixtures for the cli-anything-datus test suite.

Isolation guarantees:
* Every test that touches Datus state uses a ``tmp_path``-rooted Datus home and a
  generated test ``agent.yml`` — the user's live ``~/.datus`` is never read or
  written.
* The real backend (the ``datus`` package) is imported from the environment it
  is installed in; if it is missing, E2E tests fail loudly (no graceful
  degradation).
* The Datus repo's first-party mock LLM is imported from the repo root so the
  agent E2E tests exercise the real agent loop with a deterministic LLM double.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

# ── Locate the Datus repo root (this harness lives in <repo>/agent-harness) ──

REPO_ROOT = Path(__file__).resolve().parents[4]
CALIFORNIA_SCHOOLS_DB = (
    REPO_ROOT / "datus" / "sample_data" / "california_schools" / "california_schools.sqlite"
)

# ── Resolve the `datus` name collision (test-only) ────────────────────────────
# This harness's subpackage is named ``cli_anything.datus`` — the same leaf name
# as the real top-level ``datus`` package. Under pytest, the installed
# ``cli_anything.datus`` can be cached in ``sys.modules`` as (or shadow) the
# bare name ``datus`` during collection, so a later ``import datus`` resolves to
# the harness subpackage instead of the real Datus framework. A clean
# (non-pytest) ``import datus`` resolves to the real package, so we pin it here:
# drop any cached ``datus*`` modules, put the repo root first on ``sys.path``,
# and force-load the real Datus so it is the canonical ``datus`` for the whole
# session. This must run before any test or harness code imports ``datus``.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
for _key in [k for k in sys.modules if k == "datus" or k.startswith("datus.")]:
    del sys.modules[_key]
import datus  # noqa: E402,F401  -> loads and caches the REAL Datus package
import datus.configuration.agent_config  # noqa: E402,F401  (eager, fails fast)

# Make ``tests.unit_tests.mock_llm_model`` (Datus's first-party mock LLM)
# importable from the repo root.
assert str(REPO_ROOT) in sys.path


def require_datus():
    """Import datus, failing loudly (with a clear message) if unavailable."""
    try:
        import datus  # noqa: F401
    except Exception as exc:  # pragma: no cover - environment guard
        pytest.fail(
            "The Datus package is not importable; the real backend is required "
            f"for E2E tests. ({type(exc).__name__}: {exc})\n"
            "Install it with: pip install datus-agent"
        )


@pytest.fixture(scope="session")
def california_db() -> str:
    """Path to the bundled sample SQLite (read-only; 3 tables)."""
    require_datus()
    if not CALIFORNIA_SCHOOLS_DB.is_file():
        pytest.fail(f"Sample database not found at {CALIFORNIA_SCHOOLS_DB}")
    return str(CALIFORNIA_SCHOOLS_DB)


def write_test_agent_yaml(path: Path, db_path: str, model_block: dict | None = None) -> str:
    """Write a minimal, isolated agent.yml pointing at ``db_path``.

    The default model is a local mock endpoint (``http://localhost:0``) so any
    accidental live LLM call fails fast instead of hitting a real service.
    Built as a dict and serialized with ``yaml.safe_dump`` (no fragile string
    templating).
    """
    if model_block is None:
        model_block = {
            "mock": {
                "type": "openai",
                "api_key": "k",
                "model": "m",
                "base_url": "http://localhost:0",
            }
        }
    doc = {
        "agent": {
            "target": "mock",
            "language": "en",
            "models": model_block,
            "services": {
                "datasources": {
                    "california_schools": {"type": "sqlite", "uri": db_path, "default": True},
                },
                "semantic_layer": {},
                "bi_platforms": {},
                "schedulers": {},
            },
            "agentic_nodes": {
                "gen_sql": {"system_prompt": "gen_sql", "tools": "db_tools.*", "max_turns": 5},
                "chat": {"system_prompt": "chat", "tools": "db_tools.*,context_search_tools.*", "max_turns": 5},
            },
        }
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=False)
    return str(path)


@pytest.fixture
def tmp_home(tmp_path) -> str:
    home = tmp_path / "datus_home"
    home.mkdir()
    return str(home)


@pytest.fixture
def agent_config_file(tmp_path, california_db) -> str:
    """A generated, isolated agent.yml (datasource -> sample SQLite, mock model)."""
    return write_test_agent_yaml(tmp_path / "agent.yml", california_db)


@pytest.fixture
def session_file(tmp_path) -> str:
    return str(tmp_path / "session.json")


@pytest.fixture
def mock_llm_create():
    """Patch Datus's model factory to return a scripted MockLLMModel.

    Yields the MockLLMModel instance so tests can ``reset(responses=[...])`` to
    script the LLM's decisions. Only the LLM decision is mocked — tools run for
    real (Datus's own first-party test pattern).
    """
    from unittest.mock import patch

    from tests.unit_tests.mock_llm_model import MockLLMModel

    mock = MockLLMModel()
    with patch("datus.models.base.LLMBaseModel.create_model", return_value=mock):
        yield mock
