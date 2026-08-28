"""Backend bridge to the REAL Datus software.

The Datus agent framework (``datus`` Python package) is a hard dependency of this
harness. This module is the single place that imports it, so every import error
surfaces as a clear :class:`DatusBackendError` with install instructions instead
of a raw traceback.

Two access levels are exposed:

* :func:`ensure_datus` — verify the package is importable (fail loudly).
* :func:`datus_import` — import and return a submodule of ``datus``.
"""

from __future__ import annotations

import importlib
from typing import Any

_INSTALL_HELP = (
    "Datus is not installed. The cli-anything-datus harness drives the real Datus\n"
    "agent framework and cannot work without it. Install it (Python >= 3.12):\n"
    "\n"
    "  pip install datus-agent\n"
    "\n"
    "or use the official one-liner installer (creates a dedicated venv at\n"
    "~/.datus/venv and drops shims into ~/.local/bin):\n"
    "\n"
    "  curl -fsSL https://raw.githubusercontent.com/datus-ai/datus-agent/main/install.sh | sh\n"
    "\n"
    "Then install THIS harness into the same environment that provides datus:\n"
    "\n"
    "  ~/.datus/venv/bin/pip install -e /path/to/agent-harness\n"
)


class DatusBackendError(RuntimeError):
    """Raised when the Datus backend is missing or unusable."""


def ensure_datus() -> None:
    """Import ``datus`` once, raising a clear error with install help on failure."""
    try:
        importlib.import_module("datus")
    except Exception as exc:  # ImportError, ModuleNotFoundError, or broken dep
        raise DatusBackendError(
            f"Failed to import the Datus package ({type(exc).__name__}: {exc}).\n\n" + _INSTALL_HELP
        ) from exc


def datus_import(submodule: str) -> Any:
    """Import ``datus.<submodule>`` (e.g. ``"configuration.agent_config"``).

    Wraps any import failure in :class:`DatusBackendError` with install help.
    """
    try:
        return importlib.import_module(f"datus.{submodule}")
    except Exception as exc:
        if isinstance(exc, DatusBackendError):
            raise
        raise DatusBackendError(
            f"Failed to import datus.{submodule} ({type(exc).__name__}: {exc}).\n\n" + _INSTALL_HELP
        ) from exc


def datus_version() -> str:
    """Best-effort Datus package version string."""
    try:
        mod = importlib.import_module("datus")
        return str(getattr(mod, "__version__", "unknown"))
    except Exception:
        return "unknown"
