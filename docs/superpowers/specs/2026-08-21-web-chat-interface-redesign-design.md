# Web Chat Interface Redesign

Date: 2026-08-21

## Overview

Redesign the Datus Agent web interface (`datus web`), replacing the current CDN-loaded React UMD chatbot component with a self-contained React + Vite frontend that mirrors the task-template-driven chat experience seen on tabtabai.com/chat.

## Goals

- Deliver a modern, multi-task-type chat workbench with sidebar navigation, task type panels, and SSE streaming
- Add backend API support for task templates, file upload, output options, and enhanced session management
- Keep the single-repository, single-command startup model (`datus web`)

## Architecture

### Repository Layout

```
datus-agent/
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── router.tsx
│   │   ├── layouts/
│   │   │   └── ChatLayout.tsx
│   │   ├── pages/
│   │   │   ├── ChatPage.tsx
│   │   │   ├── DataConnectionPage.tsx
│   │   │   ├── SkillShopPage.tsx
│   │   │   └── KnowledgeBasePage.tsx
│   │   ├── components/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TaskPanel.tsx
│   │   │   ├── ChatArea.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── InputBox.tsx
│   │   │   ├── TemplateCard.tsx
│   │   │   ├── SessionHistory.tsx
│   │   │   ├── OutputOptions.tsx
│   │   │   └── FileUpload.tsx
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   ├── chat.ts
│   │   │   ├── templates.ts
│   │   │   └── sessions.ts
│   │   ├── hooks/
│   │   │   ├── useSSE.ts
│   │   │   └── useTemplates.ts
│   │   ├── stores/
│   │   │   └── chatStore.ts
│   │   └── styles/
│   │       └── globals.css
│   ├── public/
│   │   └── favicon.svg
│   └── dist/                   # build output
├── datus/
│   ├── cli/web/
│   │   ├── chatbot.py          # modified: serve frontend/dist/ in production
│   │   └── templates/index.html # removed or replaced
│   ├── api/
│   │   ├── routes/
│   │   │   └── template_routes.py  # NEW
│   │   ├── services/
│   │   │   └── template_service.py # NEW
│   │   └── models/
│   │       └── template_models.py  # NEW
│   └── conf/
│       └── templates/              # NEW
│           ├── contract-review.yaml
│           ├── data-analysis.yaml
│           ├── db-query.yaml
│           ├── data-collection.yaml
│           └── contract-writing.yaml
└── tests/
    ├── api/
    │   ├── test_template_service.py # NEW
    │   └── test_upload.py           # NEW
    └── web/
        └── test_web_app.py          # NEW
```

## Module 1: Project Structure

**Approved.** Frontend lives in `frontend/` at the project root. Vite dev server proxies `/api` to `localhost:8000`. Production build outputs to `frontend/dist/`, served by FastAPI static file mount in `create_web_app()`.

Four routes: `/chat`, `/data-connection`, `/skill-shop`, `/knowledge-base`.

## Module 2: Backend API Extensions

### Task Templates

```
POST /api/v1/templates/list  → list all templates
GET  /api/v1/templates/{id}  → get single template detail
```

Template model:
```yaml
id: db-query
name: 数据库问数
description: 关联数据库，用自然语言查询并出报告
heading: 关联数据库，把问题直接问出来
subtitle: 不用写 SQL，选好库表就能查数、做分析，并产出带洞察与建议的报告。
inputPlaceholder: 描述你想查什么或分析什么。例如「统计近 12 个月各品类的销售额与同比变化，并输出一份分析报告」
fileUpload: false
outputOptions:
  - key: depth
    label: 分析深度
    options:
      - value: standard
        label: 标准
      - value: deep
        label: 深度
      - value: concise
        label: 简洁
  - key: format
    label: 输出格式
    options:
      - value: markdown
        label: 文本（Markdown）
      - value: table_chart
        label: 表格 + 图表
      - value: report
        label: 完整报告
quickActions:
  - title: 经营大盘与同比拆解
    tags: [出报告]
    description: 按月汇总核心指标，拆到品类与渠道并给出结论
    prompt: 统计近12个月各品类的销售额与同比变化，并输出一份分析报告
  - title: 销量 TOP 商品明细
    tags: [即问即答]
    description: 一句话查询，直接返回结果表并导出 CSV
    prompt: 查询销量前10的商品及销售额
  - title: 客户留存与流失诊断
    tags: [含建议]
    description: 按注册月分群算留存，定位流失环节与原因
    prompt: 分析客户留存情况，按注册月分群，定位流失环节与原因
  - title: 异常订单排查
    tags: [归因]
    description: 定位异常记录，逐层下钻到时间、渠道与商品
    prompt: 排查最近30天的异常订单，按时间、渠道、商品维度定位原因
```

Templates are loaded from `datus/conf/templates/*.yaml` at service startup.

### Session Management Enhancement

`ChatSessionItemInfo` adds:
- `task_type: string` — the template id this session belongs to
- `preview: string` — session summary text

```
PUT /api/v1/chat/sessions/{session_id}/task_type  → set session task type
```

### File Upload

```
POST /api/v1/upload  → upload file, return file URL
DELETE /api/v1/upload/{file_id} → delete uploaded file
```

- Allowed formats: PDF, Word, plain text, CSV, Excel, images
- Max size: 200 pages per file for documents, 50MB for data files
- Storage: `{output_dir}/uploads/`
- Files are scanned and injected into the chat context

### Output Options

`StreamChatInput` extends with optional `output_options` field:
```json
{
  "output_options": {
    "depth": "standard",
    "format": "markdown"
  }
}
```

## Module 3: Frontend UI Components

### Layout

Two-column layout: left sidebar (240px, dark) + main content area.

### Sidebar

- Logo + app name at top
- Nav links: New Task, Data Connection, Skill Shop, Knowledge Base
- Separator + All Tasks session history list (loaded from API)
- User avatar + name at bottom

### TaskPanel

- Card list between sidebar and main area
- Each card: icon + name + short description
- Active state highlighting, click to switch task type

### ChatArea

Two states:
- **Initial state**: heading + subtitle + input box + output options + quick action cards + file upload area
- **Conversation state**: scrollable message list, fixed input box at bottom

### MessageBubble

- User messages: right-aligned
- Assistant messages: left-aligned, Markdown rendered with code highlighting and tables
- SSE streaming: typewriter effect for incremental token rendering

### InputBox

- Multi-line textarea, Enter to send, Shift+Enter for newline
- Send button enabled when non-empty
- Optional file attachment

### OutputOptions

- Depth: standard / deep / concise
- Format: text (Markdown) / table + chart / full report
- Tag button group, multi-select

### TemplateCard

- Grid layout cards
- Each card: title + tags + description
- Click to auto-fill input or trigger conversation

### State Management

Zustand store:
- `currentTaskType`, `messages`, `sessionId`, `sessions`, `isStreaming`

### Routes

```
/chat                     → chat workbench (default)
/chat?task=db-query       → specific task type
/chat?session=xxx         → resume specific session
/data-connection          → data source management
/skill-shop               → skill marketplace
/knowledge-base           → knowledge base
```

## Module 4: Data Flow & Error Handling

### SSE Chat Flow

```
POST /api/v1/chat/stream → SSE stream
Events:
  user_message     → render right-aligned user bubble
  assistant_delta  → append to assistant bubble (typewriter)
  tool_call        → show tool progress card (e.g. "querying database...")
  sql_query        → SQL code block
  sql_result       → result table
  final_response   → full Markdown render
  end              → stop streaming, mark session complete
  error            → show error in assistant bubble + retry button
```

### Session Recovery

```
GET /api/v1/chat/history?session_id=xxx → messages[]
→ render as message bubbles
→ if session still running → POST /resume → continue SSE
→ user sends new message → POST /stream → continue
```

### Error Handling

| Scenario | Behavior |
|----------|----------|
| SSE disconnected | Show "connection lost, reconnecting..." banner, auto-retry with exponential backoff (max 3) |
| Error event from backend | Show error in assistant bubble + error code + retry button |
| Network error on send | Red warning beside input: "Send failed, check network" |
| Session not found / deleted | Show "session expired", auto-create new session |
| File upload failed | Show specific failure reason (format/size/network) |
| Stop generation | POST /api/v1/chat/stop, cancel streaming task |
| Timeout (no response 60s) | Show "response timeout", retry available |
| Auth failure (401) | Redirect to login page |

### Caching

- Template config: localStorage, TTL 24h
- Session history: on-demand paginated loading (offset/limit)
- Message rendering: in-memory cache for parsed Markdown + tables
- Static assets: Vite fingerprinted, long-cache

## Module 5: Testing & Integration

### Backend Tests

- `tests/api/test_template_service.py` — template YAML loading, list/detail API, 404
- `tests/api/test_chat_sessions.py` — task_type field, update task_type
- `tests/api/test_upload.py` — success, format/size rejection
- `tests/api/test_chat_stream_options.py` — output_options field parsing
- `tests/web/test_web_app.py` — Vite dist static file mount, root HTML response

### Frontend Tests (Vitest + Testing Library)

- `Sidebar.test.tsx` — nav rendering, active state
- `TemplateCard.test.tsx` — click fills input
- `MessageBubble.test.tsx` — SSE incremental rendering
- `useSSE.test.ts` — reconnection, error handling (mocked EventSource)
- `chatStore.test.ts` — state transitions

### CI Integration

- GitHub Actions: add frontend build check job (`cd frontend && npm ci && npm run build`)
- Lint: frontend ESLint + prettier, backend ruff (existing)

### Delivery Phases

| Phase | Scope |
|-------|-------|
| P1 | Frontend scaffold + routing + layout (Sidebar/TaskPanel/ChatArea static) |
| P2 | Backend template API + YAML config + session task_type field |
| P3 | SSE chat integration (streaming render + reconnection) + session history recovery |
| P4 | File upload + output options + quick action cards |
| P5 | Production build integration (FastAPI mounts dist/) + tests + CI |

## Spec Self-Review

- [x] No placeholders or TODOs
- [x] Internal consistency: all modules reference the same API endpoints, data model, and routing
- [x] Scope check: focused on a single deliverable (web interface redesign), decomposed into 5 phases
- [x] Ambiguity check: all requirements are explicit — tech stack (React + Vite + Zustand), file structure, API shape, error handling, testing strategy