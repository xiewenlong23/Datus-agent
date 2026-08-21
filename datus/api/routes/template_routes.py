"""
API routes for task templates.
"""

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from datus.api.models.template_models import TemplateListResponse, TaskTemplate

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])

# Global template service instance (set by app lifespan)
_template_service = None


def set_template_service(service) -> None:
    """Set the global template service instance (called during app init)."""
    global _template_service
    _template_service = service


def get_template_service():
    """Get the current template service instance."""
    if _template_service is None:
        from datus.api.services.template_service import TemplateService
        set_template_service(TemplateService())
    return _template_service


@router.post("/list", response_model=TemplateListResponse)
async def list_templates():
    """List all available task templates."""
    service = get_template_service()
    templates = service.list_templates()
    return TemplateListResponse(templates=templates)


@router.get("/{template_id}", response_model=TaskTemplate)
async def get_template(template_id: str):
    """Get a single task template by ID."""
    service = get_template_service()
    template = service.get_template(template_id)
    if template is None:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    return template