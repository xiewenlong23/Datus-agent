"""
Service for knowledge base browsing and search.
"""

from typing import Any, Dict, List, Optional

from datus.api.models.kb_models import KbComponent
from datus.configuration.agent_config import AgentConfig
from datus.storage.metric.store import MetricRAG
from datus.storage.reference_sql import ReferenceSqlRAG
from datus.storage.schema_metadata import create_metadata_rag
from datus.storage.semantic_model.store import SemanticModelRAG
from datus.utils.loggings import get_logger

logger = get_logger(__name__)

# Topics that can be shown in the KB UI
KB_TOPICS = [
    {
        "id": "metadata",
        "name": "Schema 元数据",
        "description": "数据库表定义、列信息、样本数据与统计信息",
        "icon": "🗄️",
        "component": KbComponent.METADATA,
    },
    {
        "id": "semantic_model",
        "name": "语义模型",
        "description": "维度、度量、实体关系等语义信息",
        "icon": "🧩",
        "component": KbComponent.SEMANTIC_MODEL,
    },
    {
        "id": "metrics",
        "name": "业务指标",
        "description": "标准化业务 KPI，含指标定义与主题树分类",
        "icon": "📐",
        "component": KbComponent.METRICS,
    },
    {
        "id": "reference_sql",
        "name": "Reference SQL",
        "description": "沉淀历史查询、LLM 摘要、查询模式与最佳实践",
        "icon": "📄",
        "component": KbComponent.REFERENCE_SQL,
    },
    {
        "id": "platform_docs",
        "name": "平台文档",
        "description": "按平台与版本组织的官方文档分块",
        "icon": "📚",
        "component": None,
    },
]


class KbOverviewService:
    """Lightweight service for KB overview and search, wrapping the RAG stores."""

    def __init__(self, agent_config: AgentConfig) -> None:
        self.agent_config = agent_config
        self._topic_counts: Optional[Dict[str, int]] = None

    def _count_store(self, store: Any, method: str = "search_all") -> int:
        """Try to count items in a store."""
        try:
            result = getattr(store, method)()
            if result is None:
                return 0
            if isinstance(result, list):
                return len(result)
            if hasattr(result, "__len__"):
                return len(result)
            return 0
        except Exception as e:
            logger.debug(f"KB count failed: {e}")
            return 0

    def get_topics(self) -> List[Dict[str, Any]]:
        """Return all KB topics with item counts."""
        topics = []
        for topic in KB_TOPICS:
            topics.append({
                "id": topic["id"],
                "name": topic["name"],
                "description": topic["description"],
                "icon": topic["icon"],
                "item_count": self._get_topic_count(topic["id"]),
            })
        return topics

    def _get_topic_count(self, topic_id: str) -> int:
        """Get item count for a topic."""
        try:
            if topic_id == "metadata":
                rag = create_metadata_rag(agent_config=self.agent_config)
                return self._count_store(rag)
            elif topic_id == "semantic_model":
                rag = SemanticModelRAG(agent_config=self.agent_config)
                return self._count_store(rag, "search_all")
            elif topic_id == "metrics":
                rag = MetricRAG(agent_config=self.agent_config)
                return self._count_store(rag, "search_all")
            elif topic_id == "reference_sql":
                rag = ReferenceSqlRAG(agent_config=self.agent_config)
                return self._count_store(rag, "search_all_reference_sql")
            elif topic_id == "platform_docs":
                return 0  # Not indexed in this datasource
        except Exception as e:
            logger.debug(f"KB topic count error for {topic_id}: {e}")
        return 0

    def search(self, query: str, topic: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        """Search across KB topics."""
        results = []
        topics_to_search = [t for t in KB_TOPICS if topic is None or t["id"] == topic]
        for t in topics_to_search:
            try:
                if t["id"] == "reference_sql":
                    rag = ReferenceSqlRAG(agent_config=self.agent_config)
                    items = rag.search_reference_sql(query, limit=limit)
                    if items:
                        for item in items:
                            results.append({
                                "topic": t["id"],
                                "title": item.get("title", item.get("name", "")),
                                "snippet": item.get("description", str(item)[:200]),
                                "relevance": 1.0,
                            })
                elif t["id"] == "metrics":
                    rag = MetricRAG(agent_config=self.agent_config)
                    items = rag.search(query, top_n=limit)
                    if items:
                        for item in items:
                            results.append({
                                "topic": t["id"],
                                "title": item.get("name", str(item)[:100]),
                                "snippet": item.get("description", str(item)[:200]),
                                "relevance": 1.0,
                            })
                elif t["id"] == "metadata":
                    rag = create_metadata_rag(agent_config=self.agent_config)
                    items = rag.search_similar(query, top_n=limit)
                    if items:
                        for item in items:
                            results.append({
                                "topic": t["id"],
                                "title": item.get("table_name", item.get("name", "")),
                                "snippet": item.get("description", str(item)[:200]),
                                "relevance": 1.0,
                            })
                elif t["id"] == "semantic_model":
                    rag = SemanticModelRAG(agent_config=self.agent_config)
                    items = rag.search_all(query, top_n=limit)
                    if items:
                        for item in items:
                            results.append({
                                "topic": t["id"],
                                "title": item.get("name", str(item)[:100]),
                                "snippet": item.get("description", str(item)[:200]),
                                "relevance": 1.0,
                            })
            except Exception as e:
                logger.debug(f"KB search error for {t['id']}: {e}")
        return results[:limit]