"""
Service for loading and serving task templates from YAML configuration files.
"""

import os
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from datus.api.models.template_models import TaskTemplate
from datus.utils.loggings import get_logger

logger = get_logger(__name__)

# Default templates directory relative to project root
_DEFAULT_TEMPLATES_DIR = Path(__file__).parent.parent.parent / "conf" / "templates"


class TemplateService:
    """Loads and serves task template configurations."""

    def __init__(self, templates_dir: Optional[str] = None) -> None:
        self._templates_dir = Path(templates_dir) if templates_dir else _DEFAULT_TEMPLATES_DIR
        self._templates: Dict[str, TaskTemplate] = {}
        self._load_templates()

    def _load_templates(self) -> None:
        """Load all YAML template files from the templates directory."""
        if not self._templates_dir.exists():
            logger.warning(f"Templates directory not found: {self._templates_dir}")
            return

        for yaml_file in sorted(self._templates_dir.glob("*.yaml")):
            try:
                with open(yaml_file, encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data and "id" in data:
                    template = TaskTemplate(**data)
                    self._templates[template.id] = template
                    logger.debug(f"Loaded template: {template.id} ({template.name})")
                else:
                    logger.warning(f"Skipping invalid template file: {yaml_file}")
            except Exception as e:
                logger.error(f"Failed to load template {yaml_file}: {e}")

    def list_templates(self) -> List[TaskTemplate]:
        """Return all loaded templates."""
        return list(self._templates.values())

    def get_template(self, template_id: str) -> Optional[TaskTemplate]:
        """Return a single template by ID, or None if not found."""
        return self._templates.get(template_id)

    def reload(self) -> None:
        """Reload all templates from disk."""
        self._templates.clear()
        self._load_templates()