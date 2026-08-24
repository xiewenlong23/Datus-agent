# Web Chat Integration: Agent/DB/LLM/Plan Mode + Skill Shop + Knowledge Base

Date: 2026-08-24

## Overview

Integrate existing backend capabilities into the new web frontend:
- Add toolbar controls for Agent selection, database selection, LLM model switching, and plan mode
- Remove contract-review and contract-writing task templates
- Fix Skill Shop and Knowledge Base pages with real backend APIs

## Phase A: Toolbar Controls

### Position

Toolbar spans the top of the ChatPage, above the task panel + chat area:

```
┌──────────────────────────────────────────────────────────────┐
│  🤖 Agent: [gen_sql ▼]  💾 DB: [demo ▼]                    │
│  🧠 Model: [claude/glm-5.2 ▼]  📋 规划模式 [关闭]         │
├──────────────────────────────────────────────────────────────┤
│  [TaskPanel]  │  [ChatArea]                                 │
└──────────────────────────────────────────────────────────────┘
```

### Backend APIs Consumed

| Control | Endpoint | Field on StreamChatInput |
|---------|----------|--------------------------|
| Agent list | `GET /api/v1/agent/list` | `subagent_id` |
| Database list | `GET /api/v1/catalog/list` | `datasource` |
| Model list | `GET /api/v1/models` | `model` (format: `provider/model`) |
| Plan mode | toggle | `plan_mode` (bool) |

### Frontend Components

- `Toolbar.tsx` — new component rendered at top of ChatPage
- Each dropdown fetches from the corresponding API on mount
- Selection stored in Zustand chatStore (new fields: `selectedAgent`, `selectedDatasource`, `selectedModel`, `planMode`)
- On send, these values are passed to `POST /api/v1/chat/stream`

### Template Cleanup

Delete `datus/conf/templates/contract-review.yaml` and `datus/conf/templates/contract-writing.yaml`.

## Phase B: Skill Shop

### Backend API (new)

```
GET /api/v1/skills/list → list all discovered skills from skills.directories
```

Response:
```json
{
  "success": true,
  "data": {
    "skills": [
      {
        "name": "build-kb",
        "description": "构建知识库",
        "tags": ["knowledge", "setup"],
        "version": "1.0",
        "directory": "~/.datus/skills/build-kb",
        "allowed_commands": ["python:scripts/*.py"],
        "permission": "allow"
      }
    ]
  }
}
```

### Frontend

- `SkillShopPage.tsx` — fetch skills from API, display as card grid
- Each card: name, description, tags, version, permission badge
- Click to view details in a modal/side panel

## Phase C: Knowledge Base

### Backend API (new)

```
POST /api/v1/kb/search → search knowledge base
```
Request: `{ "query": "sales metrics", "topic": "metrics", "limit": 20 }`
Response: list of search results with title, snippet, topic, relevance

```
GET /api/v1/kb/topics → list knowledge base topics/categories
```
Response: `{ "topics": ["platform_docs", "metadata", "semantic_model", "metrics", "reference_sql", "sql_templates"] }`

### Frontend

- `KnowledgeBasePage.tsx` — topic tabs + search bar + results list
- Tab switches between knowledge base categories
- Search input queries `POST /api/v1/kb/search`

## Implementation Order

1. Phase A: Toolbar + template deletion
2. Phase B: Skill Shop API + frontend
3. Phase C: Knowledge Base API + frontend
4. Build, test, commit