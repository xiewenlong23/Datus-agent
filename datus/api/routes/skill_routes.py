"""
API routes for listing available skills (Skill Shop).
"""

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from datus.api.models.base_models import Result
from datus.api.services.skill_service import SkillInfo, SkillService

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])

_skill_service: SkillService | None = None


def set_skill_service(service: SkillService) -> None:
    """Set the global skill service (called during app init)."""
    global _skill_service
    _skill_service = service


def get_skill_service() -> SkillService:
    """Get (or lazily create) the skill service."""
    global _skill_service
    if _skill_service is None:
        _skill_service = SkillService()
    return _skill_service


@router.get("/list")
async def list_skills() -> Result[Dict[str, Any]]:
    """List all discovered skills."""
    skills = get_skill_service().list_skills()
    return Result(
        success=True,
        data={"skills": [s.to_dict() for s in skills], "total": len(skills)},
    )


@router.get("/{skill_name}")
async def get_skill(skill_name: str) -> Result[Dict[str, Any]]:
    """Get a single skill's metadata by name."""
    skill = get_skill_service().get_skill(skill_name)
    if skill is None:
        raise HTTPException(status_code=404, detail=f"Skill '{skill_name}' not found")
    return Result(success=True, data=skill.to_dict())