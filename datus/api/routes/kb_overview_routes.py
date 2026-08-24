"""
API routes for knowledge base overview and search.
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query

from datus.api.deps import ServiceDep
from datus.api.models.base_models import Result
from datus.api.services.kb_overview_service import KbOverviewService, KB_TOPICS

router = APIRouter(prefix="/api/v1/kb", tags=["knowledge-base"])

_kb_overview_service: Optional[KbOverviewService] = None


def set_kb_overview_service(service: KbOverviewService) -> None:
    global _kb_overview_service
    _kb_overview_service = service


def get_kb_overview_service() -> KbOverviewService:
    if _kb_overview_service is None:
        raise RuntimeError("KbOverviewService not initialized")
    return _kb_overview_service


@router.get("/topics")
async def list_kb_topics(svc: ServiceDep) -> Result[Dict[str, Any]]:
    """List knowledge base topics with item counts."""
    service = KbOverviewService(svc.agent_config)
    topics = service.get_topics()
    return Result(success=True, data={"topics": topics})


@router.post("/search")
async def search_kb(
    body: dict,
    svc: ServiceDep,
) -> Result[Dict[str, Any]]:
    """Search the knowledge base."""
    query = body.get("query", "")
    topic = body.get("topic")
    limit = min(int(body.get("limit", 20)), 100)
    if not query.strip():
        return Result(success=True, data={"results": [], "total": 0})
    service = KbOverviewService(svc.agent_config)
    results = service.search(query, topic=topic, limit=limit)
    return Result(success=True, data={"results": results, "total": len(results)})