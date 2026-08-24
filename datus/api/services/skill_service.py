"""
Service for listing available skills by scanning skill directories.
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

from datus.utils.loggings import get_logger

logger = get_logger(__name__)

# Default skill directories: project resources + user home
_PROJECT_SKILLS = Path(__file__).parent.parent.parent / "resources" / "skills"
_USER_SKILLS = Path.home() / ".datus" / "skills"


class SkillInfo:
    """Metadata for a single skill."""

    def __init__(
        self,
        name: str,
        description: str,
        tags: List[str],
        version: str,
        directory: str,
        frontmatter: Dict[str, Any],
    ) -> None:
        self.name = name
        self.description = description
        self.tags = tags
        self.version = version
        self.directory = directory
        self.frontmatter = frontmatter

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "tags": self.tags,
            "version": self.version,
            "directory": self.directory,
            "frontmatter": self.frontmatter,
        }


def _parse_frontmatter(content: str) -> Dict[str, Any]:
    """Parse YAML frontmatter from a SKILL.md file."""
    if not content.startswith("---"):
        return {}
    parts = content.split("---", 2)
    if len(parts) < 3:
        return {}
    try:
        meta = yaml.safe_load(parts[1])
        return meta if isinstance(meta, dict) else {}
    except Exception as e:
        logger.debug(f"Failed to parse skill frontmatter: {e}")
        return {}


def _scan_directory(directory: Path, found: Dict[str, SkillInfo]) -> None:
    """Scan a directory for SKILL.md files and add them to found."""
    if not directory.is_dir():
        return
    for skill_file in sorted(directory.rglob("SKILL.md")):
        try:
            content = skill_file.read_text(encoding="utf-8")
            meta = _parse_frontmatter(content)
        except Exception as e:
            logger.debug(f"Failed to read skill {skill_file}: {e}")
            continue

        name = str(meta.get("name") or skill_file.parent.name)
        description = str(meta.get("description") or "")
        tags = meta.get("tags") or []
        if not isinstance(tags, list):
            tags = []
        tags = [str(t) for t in tags]
        version = str(meta.get("version") or "")

        skill = SkillInfo(
            name=name,
            description=description,
            tags=tags,
            version=version,
            directory=str(skill_file.parent),
            frontmatter=meta,
        )
        # Project skills take precedence over user-installed ones with same name
        found[name] = skill


class SkillService:
    """List skills from configured directories."""

    def __init__(self, project_dir: Optional[str] = None, user_dir: Optional[str] = None) -> None:
        self._project_dir = Path(project_dir) if project_dir else _PROJECT_SKILLS
        self._user_dir = Path(user_dir) if user_dir else _USER_SKILLS
        self._skills: Optional[List[SkillInfo]] = None

    def list_skills(self) -> List[SkillInfo]:
        """Return all discovered skills (cached)."""
        if self._skills is None:
            found: Dict[str, SkillInfo] = {}
            _scan_directory(self._user_dir, found)
            _scan_directory(self._project_dir, found)
            self._skills = [found[k] for k in sorted(found.keys())]
        return self._skills

    def get_skill(self, name: str) -> Optional[SkillInfo]:
        """Return a single skill by name."""
        for s in self.list_skills():
            if s.name == name:
                return s
        return None

    def reload(self) -> None:
        self._skills = None