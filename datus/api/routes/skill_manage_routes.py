"""
API routes for skill management (create, install, remove, publish, update, login, logout).
"""

import json
import os
import re
import subprocess
import yaml
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from datus.api.deps import ServiceDep
from datus.api.models.base_models import Result
from datus.api.services.skill_service import get_skill_service

router = APIRouter(prefix="/api/v1/skills", tags=["skill-management"])

# Skill management state file
_SKILL_STATE_DIR = os.path.expanduser("~/.datus/skill-state")
_SKILL_LOGIN_FILE = os.path.join(_SKILL_STATE_DIR, "marketplace.json")

# User skills directory (same as SkillService default)
_USER_SKILLS_DIR = Path.home() / ".datus" / "skills"

_SAFE_SKILL_NAME_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]*$")


class SkillCreateInput(BaseModel):
    """Input for creating a user skill."""

    name: str = Field(..., description="Skill name (alphanumeric, underscore, hyphen)")
    description: str = Field("", description="One-line skill description")
    prompt: str = Field(..., description="Skill instructions / prompt body")
    tags: List[str] = Field(default_factory=list, description="Skill tags")
    version: str = Field("1.0.0", description="Skill version")


class SkillInstallInput(BaseModel):
    """Input for skill install."""
    name: str = Field(..., description="Skill name to install")
    source: str = Field("marketplace", description="Source: marketplace or local")
    version: Optional[str] = Field(None, description="Specific version to install")


class SkillRemoveInput(BaseModel):
    """Input for skill removal."""
    name: str = Field(..., description="Skill name to remove")


class SkillPublishInput(BaseModel):
    """Input for skill publish."""
    skill_path: str = Field(..., description="Path to skill directory")


class SkillUpdateInput(BaseModel):
    """Input for skill update."""
    name: str = Field(..., description="Skill name to update")


@router.post("/create")
async def create_skill(request: SkillCreateInput) -> Result[Dict[str, Any]]:
    """Create a user skill in ~/.datus/skills/<name>/SKILL.md."""
    name = request.name.strip()
    if not _SAFE_SKILL_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid skill name. Only alphanumeric characters, underscores, and hyphens are allowed.",
        )

    svc = get_skill_service()
    if svc.get_skill(name):
        return Result(
            success=False,
            errorCode="SKILL_EXISTS",
            errorMessage=f"Skill '{name}' already exists",
        )

    skill_dir = _USER_SKILLS_DIR / name
    try:
        skill_dir.mkdir(parents=True, exist_ok=True)
        frontmatter = {
            "name": name,
            "description": request.description.strip(),
            "version": request.version,
            "tags": [t.strip() for t in request.tags if t.strip()],
            "user_invocable": True,
        }
        content = [
            "---",
            yaml.safe_dump(frontmatter, allow_unicode=True, sort_keys=False).rstrip(),
            "---",
            "",
            request.prompt.strip(),
            "",
        ]
        skill_file = skill_dir / "SKILL.md"
        skill_file.write_text("\n".join(content), encoding="utf-8")
        svc.reload()
        return Result(success=True, data={"name": name, "created": True, "path": str(skill_dir)})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SkillLoginInput(BaseModel):
    """Input for marketplace login."""
    token: str = Field(..., description="Marketplace authentication token")


class SkillSearchInput(BaseModel):
    """Input for skill search."""
    query: str = Field(..., description="Search query")
    tags: Optional[List[str]] = Field(None, description="Filter by tags")


@router.post("/install")
async def install_skill(request: SkillInstallInput) -> Result[Dict[str, Any]]:
    """Install a skill from marketplace or local source."""
    try:
        # Check if skill exists
        svc = get_skill_service()
        existing = svc.get_skill(request.name)
        if existing:
            return Result(
                success=False,
                errorCode="SKILL_EXISTS",
                errorMessage=f"Skill '{request.name}' is already installed",
            )

        # Execute install command
        if request.source == "local":
            cmd = [
                "datus-cli", "skill", "install", "--source", request.name,
            ]
        else:
            cmd = [
                "datus-cli", "skill", "install", request.name,
            ]
            if request.version:
                cmd.extend(["--version", request.version])

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr or "Install failed")

        svc.reload()
        return Result(success=True, data={"name": request.name, "installed": True})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Install timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/remove")
async def remove_skill(request: SkillRemoveInput) -> Result[Dict[str, Any]]:
    """Remove a user-installed skill."""
    try:
        svc = get_skill_service()
        skill = svc.get_skill(request.name)
        if not skill:
            return Result(
                success=False,
                errorCode="SKILL_NOT_FOUND",
                errorMessage=f"Skill '{request.name}' not found",
            )

        # Remove user-installed skill directory
        if skill.directory.startswith(str(os.path.expanduser("~/.datus"))):
            import shutil
            shutil.rmtree(skill.directory, ignore_errors=True)
            svc.reload()
            return Result(success=True, data={"name": request.name, "removed": True})
        else:
            return Result(
                success=False,
                errorCode="SYSTEM_SKILL",
                errorMessage="Cannot remove system skills",
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/publish")
async def publish_skill(request: SkillPublishInput) -> Result[Dict[str, Any]]:
    """Publish a skill to marketplace."""
    try:
        cmd = ["datus-cli", "skill", "publish", request.skill_path]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr or "Publish failed")
        return Result(success=True, data={"published": True, "path": request.skill_path})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Publish timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/update")
async def update_skill(request: SkillUpdateInput) -> Result[Dict[str, Any]]:
    """Update a skill to latest version."""
    try:
        cmd = ["datus-cli", "skill", "update", request.name]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            raise HTTPException(status_code=400, detail=result.stderr or "Update failed")

        svc = get_skill_service()
        svc.reload()
        return Result(success=True, data={"name": request.name, "updated": True})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Update timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/login")
async def login_marketplace(request: SkillLoginInput) -> Result[Dict[str, Any]]:
    """Authenticate with marketplace."""
    try:
        os.makedirs(_SKILL_STATE_DIR, exist_ok=True)
        with open(_SKILL_LOGIN_FILE, "w") as f:
            json.dump({"token": request.token, "expires": "24h"}, f)
        return Result(success=True, data={"logged_in": True})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/logout")
async def logout_marketplace() -> Result[Dict[str, Any]]:
    """Clear marketplace authentication."""
    try:
        if os.path.exists(_SKILL_LOGIN_FILE):
            os.remove(_SKILL_LOGIN_FILE)
        return Result(success=True, data={"logged_out": True})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/marketplace/login-status")
async def get_login_status() -> Result[Dict[str, Any]]:
    """Check marketplace login status."""
    try:
        if os.path.exists(_SKILL_LOGIN_FILE):
            with open(_SKILL_LOGIN_FILE) as f:
                state = json.load(f)
            return Result(success=True, data={"logged_in": True, "expires": state.get("expires")})
        return Result(success=True, data={"logged_in": False})
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/search")
async def search_marketplace(request: SkillSearchInput) -> Result[Dict[str, Any]]:
    """Search marketplace for skills."""
    try:
        cmd = ["datus-cli", "skill", "search", request.query]
        if request.tags:
            for tag in request.tags:
                cmd.extend(["--tag", tag])
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            return Result(success=False, errorCode="SEARCH_FAILED", errorMessage=result.stderr)

        # Parse search results
        skills = []
        for line in result.stdout.strip().split("\n"):
            if line.startswith("Name:"):
                parts = line.split()
                if len(parts) >= 2:
                    skills.append({"name": parts[1], "version": parts[2] if len(parts) > 2 else "latest"})
        return Result(success=True, data={"skills": skills, "total": len(skills)})
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Search timed out")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))