"""
API routes for listing available skills (Skill Shop).
"""

from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException

from datus.api.models.base_models import Result
from datus.api.services.skill_service import get_skill_service, set_skill_service

router = APIRouter(prefix="/api/v1/skills", tags=["skills"])


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