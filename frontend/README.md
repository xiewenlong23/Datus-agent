# Datus Agent Web 前端

Datus Agent 的 Web 端前端模块(Vite + React + TypeScript)。它为 Datus 后端(`datus --web`)提供完整的可视化工作台:多会话并行对话、Agent 执行过程实时可视化、子代理过程展示、数据源/模型/技能/知识库管理。

> 设计蓝图见 [`docs/frontend-redesign/README.md`](../docs/frontend-redesign/README.md)(《前端 UI 重构设计文档 v1.0》)。

---

## 目录

1. [设计要点](#1-设计要点)
2. [实现要点](#2-实现要点)
3. [安装部署](#3-安装部署)
4. [使用说明](#4-使用说明)
5. [与后端的接口](#5-与后端的接口)

---

## 1. 设计要点

### 1.1 产品定位:数据智能工作台

Datus 不是普通聊天机器人,而是**数据智能工作台 (Data Workbench)**:用自然语言与数据对话,让 Agent 完成数据分析、SQL 查询、报告/仪表盘生成等任务,并获得可追溯的过程。核心设计原则:**精密、可信、透明**。

### 1.2 设计语言:精密仪器

从三个参考意象提取设计元素(金融数据终端 / IDE 工作台 / 实验室控制台):

- **深色画布为主**(默认主题),高信息密度,色彩只用于数据与状态本身;
- **设计 Token 体系**:深海军蓝背景(`#0f172a`)、青金石蓝主色(`#06b6d4`)、语义色(琥珀=数据高亮、绿=成功、红=错误);
- **字体分工**:Inter(UI/正文)、JetBrains Mono(SQL/代码/指标)、Plus Jakarta Sans(大标题);
- **Lucide SVG 线框图标**(1.5px 描边),替代早期 emoji;
- 支持**明/暗双主题**(右下角切换,`data-theme` 属性 + `localStorage` 记忆)。

### 1.3 多会话并行模型(参考 hermes-studio)

对话过程的设计参考了 hermes agent 的前端 hermes-web-ui(现已更名 hermes-studio)的会话模型,实现"多 session 并行运行、切换查看无感":

| 机制 | 说明 |
|---|---|
| **每 session 独立消息切片** | store 中 `sessionCaches[sessionId]` 各自持有消息数组;切换会话只是换视口指针,零请求、零闪烁 |
| **后台会话持续更新** | 每个运行中的会话保持一条 SSE 订阅(模块级,跨 React 视图存活);不在当前查看的会话,事件照样落入它自己的切片 |
| **断线重放 (resume)** | 刷新页面/切回一个运行中的会话时,通过 `POST /chat/resume` 从事件 0 重放整个内存中的回合(后端任务在客户端断连后继续运行并缓冲事件),一次拿到完整状态 |
| **重放防重** | 重放开始前截断当前回合已部分落库的尾部消息(`beginTurnReplay`),历史 + 重放不会双重渲染 |
| **看门狗 + 退避重连** | 连接 45s 无事件判死(运行中任务每 10s 有 ping),按 1s → 3s → 5s 退避自动重挂 |

### 1.4 Agent 执行过程可视化

"过程透明"是本模块的核心体验:

- **步骤时间线**:每个 assistant 消息渲染为可折叠的步骤卡——思考(thinking)、工具调用(call-tool,含参数/结果/耗时)、代码/SQL、CSV 表格、错误、产物卡片(报告/仪表盘);
- **子代理 (subagent) 过程**:主 agent 的 `task` 调用会派生子 agent(explore、gen_visual_report 等),子 agent 的每一步实时转发为 `depth=1` + `parent_action_id` 的消息,前端渲染为带"子代理"标签、左侧色条嵌套的过程块;刷新页面后由后端把子 agent 会话数据库合并回主历史,过程不丢失;
- **Agent 主动提问 (ask_user)**:渲染为可交互的问题卡片(选项 + 自由输入),用户作答后后端解阻塞继续执行;
- **暂停/停止**:流式过程中可一键停止(`POST /chat/stop`);
- **用量透明**:每回合底部显示 LLM 调用次数、tokens(输入/输出/缓存)、耗时。

### 1.5 页面结构

| 路由 | 页面 | 职责 |
|---|---|---|
| `/dashboard` | 首页 | 快速开始、示例问题、会话入口(默认落地页) |
| `/chat` | 对话 | 主工作台:输入、ContextBar、消息流、会话切换 |
| `/data-explorer` | 数据探索 | 浏览数据库/表结构/列信息 |
| `/data-connection` | 数据源连接 | 数据源的增删与连接测试 |
| `/sessions` | 会话历史 | 全部会话列表(含子 agent 会话),可打开/删除 |
| `/skill-shop` | 技能市场 | 技能浏览、查看、创建、发布、删除 |
| `/knowledge-base` | 知识库 | 知识库主题/条目浏览与检索 |
| `/settings` | 设置 | 模型与数据源配置管理(含连通性测试) |
| (登录页) | 登录 | 后端配置了飞书登录时作为门控,扫码登录 |

全局还有 **⌘K / Ctrl+K 命令面板**(页面跳转、新建任务、设置等)和可收起的侧边导航。

---

## 2. 实现要点

### 2.1 技术栈

| 类别 | 选型 |
|---|---|
| 构建 | Vite 5 + TypeScript 5.5(`tsc -b` 严格模式) |
| 框架 | React 18 + react-router-dom 6(BrowserRouter) |
| 状态 | zustand(无 Redux 样板,store 即模块单例) |
| HTTP | axios(API 封装于 `services/api.ts`)+ 原生 fetch(SSE / 认证) |
| 渲染 | react-markdown + remark-gfm(表格/任务列表)、react-syntax-highlighter(SQL/代码高亮) |
| 图标/字体 | lucide-react、@fontsource(Inter / JetBrains Mono / Plus Jakarta Sans,本地打包无外部字体请求) |
| 样式 | 单文件 CSS + 设计 Token 变量(`styles/globals.css`),`data-theme` 切换明暗 |

### 2.2 目录结构

```
frontend/
├── index.html
├── vite.config.ts            # dev server(5173)+ /api 代理(8501)
├── package.json              # datus-agent-web
└── src/
    ├── main.tsx              # 入口:字体、BrowserRouter、全局样式
    ├── App.tsx               # 路由 + 飞书登录门控
    ├── layouts/ChatLayout.tsx
    ├── pages/                # 9 个页面(见 1.5)
    ├── components/
    │   ├── Sidebar.tsx       # 导航、主题切换、退出登录
    │   ├── CommandPalette.tsx# ⌘K 命令面板
    │   ├── ChatArea.tsx      # 消息流容器
    │   ├── MessageBubble.tsx # 单条消息渲染(用户/助手/子代理)
    │   ├── InputBox.tsx      # 输入框 + 斜杠技能命令
    │   ├── ContextBar.tsx    # agent/数据源/模型/规划模式选择
    │   ├── MarkdownRenderer.tsx / AddDatasourceModal / AddModelModal / CreateSkillModal
    │   └── chat/
    │       ├── AssistantSteps.tsx      # 步骤时间线(工具行/思考/子代理)
    │       ├── UserInteractionCard.tsx # ask_user 提问卡片
    │       ├── CodeCard.tsx / CsvTable.tsx / SessionListPanel.tsx / WelcomeScreen.tsx
    ├── stores/
    │   ├── chatStore.ts      # 核心状态(见 2.3)
    │   ├── userStore.ts      # 登录态
    │   └── themeStore.ts     # 明暗主题
    ├── services/
    │   ├── api.ts            # axios 实例(统一前缀 /api/v1)
    │   ├── auth.ts           # 飞书登录/登出/当前用户
    │   ├── chat.ts           # SSE 订阅管理器(见 2.4)
    │   ├── sessions.ts       # 会话列表/历史/删除
    │   └── meta.ts           # agent/数据目录/模型元数据
    ├── types/chat.ts         # SSE 事件/消息载荷类型
    └── styles/globals.css    # 设计 Token + 全部样式
```

### 2.3 状态管理:chatStore

`chatStore` 是整个对话体验的中枢,分两层:

- **视口层**(`sessionId` / `messages` / `isStreaming` / `turnUsage` / `turnDuration`):当前查看会话的镜像,由切片写入时自动同步;
- **切片层**(按 session id 键控,是唯一的真源):
  - `sessionCaches`:每会话消息数组;
  - `streamingSessions`:每会话流式状态;
  - `turnUsageBySession` / `turnDurationBySession`:每回合用量/耗时。

关键方法:

- `applySSEEvent(key, event, data)`:所有 SSE 帧的唯一入口。事件按 `key`(所属会话)路由到对应切片——**后台会话的事件不触碰视口**;`session` 事件负责把新会话的切片从 `''`(未命名)重命名为服务端分配的 session id;
- `applyMessageOp`:`createMessage` / `appendMessage` / `updateMessage` 三种操作,`markdown`/`thinking`/`error` 与同类型 `code` 块做增量拼接;
- `beginTurnReplay(key)`:重放前把切片截断到最后一条根级用户消息,保证重放不重复;
- 消息模型 `ChatMessage = { id, role, content: Block[], depth, parentActionId, atContext, timestamp }`,内容块类型:`markdown` / `thinking` / `code` / `csv` / `call-tool` / `call-tool-result` / `user-interaction` / `artifact` / `subagent-complete` / `error`。

渲染约定(`MessageBubble`):

- `call-tool-result` 块从不单独渲染,`attachCallToolResult` 在历史加载时把结果按 `callToolId` 挂回调用块;
- `depth > 0` 的消息加"子代理"标签与左侧色条(`.message.subagent`);
- 尾部连续的 markdown/code 块视为最终答案,其余收进可折叠步骤卡。

### 2.4 SSE 订阅管理器(services/chat.ts)

后端把每回合作为后台任务运行,事件写入内存缓冲,**客户端断连不影响任务继续**。前端对应地维护"每会话至多一条订阅"(同一任务的缓冲只有一个共享游标,两个消费者会互相饿死;不同会话是不同任务,可并发消费):

```
sendChat(body)          POST /chat/stream     发起回合,注册为会话订阅
attachSessionStream(sid) POST /chat/resume    从事件 0 重放(幂等,重复调用无副作用)
stopSessionStream(key)   POST /chat/stop      停止 + 断开本地订阅
detachSessionStream(key) 仅断本地订阅(新发送取代过期重放时)
```

实现细节:

- **为什么不用 EventSource**:SSE 走 POST 且需要 `stream_response`/`source` 等字段,故用 `fetch` + 手动解析 `id:` / `event:` / `data:` 帧;
- **新会话重命名**:`session` 事件到达时先让 store 重命名切片,再重命名管理器槽位,期间事件不丢;
- **resume 的两种应答**:有活动任务 → `text/event-stream` 重放流;无任务 → 普通 JSON(`TASK_NOT_FOUND`),按"无任务"处理不重试;
- **看门狗**:15s 巡检一次;首事件前 25s、首事件后 45s 无事件即判连接死亡,abort 后按 `[1s, 3s, 5s]` 退避重挂,超过 3 次放弃;
- **重放去重**:resume 流的第一个真实事件(非 ping)触发 `beginTurnReplay`,截断已部分落库的回合尾部,再由重放事件干净地重建(含子代理步骤)。

### 2.5 认证(飞书登录)

- 启动时 `GET /auth/me`:`feishu_enabled && !authenticated` → 整站门控到登录页;**后端未配置登录或不可达时不门控**(优雅降级,匿名使用,会话按无用户 scope 隔离);
- 登录:整页跳转 `/auth/feishu/login` → 飞书扫码 → 回调写 cookie 后回到前端;`?login_error=` 参数展示失败原因;
- 登出:侧边栏"退出登录"→ `POST /auth/logout` 清 cookie + 本地状态复位;
- 登录用户的 open_id 作为后端会话目录的 scope,实现**多用户数据隔离**;带用户身份的飞书工具(建文档/发消息)也以该身份运行。

### 2.6 输入与上下文

- **斜杠命令**(`InputBox`):输入 `/` 弹出 `user_invocable` 技能列表(来自 `GET /skills/list`),选择后以技能名发起对话;
- **ContextBar**(输入框上方):Agent 类型选择(13 种:SQL 生成、可视化报告、BI 仪表盘、指标问答、定时调度……)、数据目录/数据源选择、模型选择、规划模式开关;选择随每次发送请求提交(`subagent_id` / 数据源 / `model` / `plan_mode`);
- **@ 上下文**:消息模型支持 `at_context`(表/指标/SQL/知识路径),后端运行期解析,带上下文的消息气泡上方以 chip 展示;
- **发送体**:`{ session_id?, content, subagent_id, model, plan_mode, stream_response: true, source: 'web', ... }`。

---

## 3. 安装部署

### 3.1 前置条件

- Node.js ≥ 18(推荐 20+);
- Datus 后端可启动:从**仓库根目录** `/path/to/Datus-agent` 运行
  `~/.datus/venv/bin/datus --web --port 8501`
  (注意:不要用 `pip install datus-agent` 替代仓库代码;模型定义在 `~/.datus/conf/agent.yml`,前端不改动它)。

### 3.2 开发模式

```bash
cd frontend
npm install        # 首次
npm run dev        # → http://localhost:5173
```

Vite dev server 监听 5173,并把 `/api` 前缀的请求代理到 `http://localhost:8501`(见 `vite.config.ts`),因此浏览器里所有请求同源、cookie 无跨域问题。后端启动后打开 5173 即可。

其他脚本:

```bash
npm run build      # tsc 类型检查 + 产物输出到 dist/
npm run preview    # 本地预览构建产物
npm run lint       # ESLint(react-hooks / react-refresh 规则)
```

### 3.3 生产部署

前端是纯静态 SPA,`npm run build` 产出 `frontend/dist/`。部署 = **任意静态文件服务 + 把 `/api` 反向代理到后端**。以 nginx 为例:

```nginx
server {
    listen 80;
    server_name datus.example.com;

    root /var/www/datus/dist;        # 即 frontend/dist 的内容
    index index.html;

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反向代理(与 Vite dev 代理保持一致)
    location /api/ {
        proxy_pass http://127.0.0.1:8501;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        # SSE 需要关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
    }
}
```

> SSE 长连接务必关闭 `proxy_buffering` 并放宽 `proxy_read_timeout`,否则流式过程会卡顿或中断。

### 3.4 飞书登录配置(可选)

登录由后端 `~/.datus/conf/agent.yml` 的 `agent.api.auth_provider` 控制,前端零配置自动适配:

| 配置项 | 说明 |
|---|---|
| `app_id` / `app_secret` | 飞书企业自建应用凭证(支持 `${ENV}` 环境变量引用) |
| `redirect_uri` | 必须是**后端**地址,如 `http://<backend-host>:8501/api/v1/auth/feishu/callback`;需与飞书开发者后台的回调地址完全一致 |
| `frontend_url` | 登录成功后跳回的前端地址,如 `http://<frontend-host>`;生产部署时务必改成实际域名 |

不配置(或配置缺失)时前端自动进入匿名模式:功能可用,但会话不做用户隔离,以用户身份运行的飞书工具不可用。

---

## 4. 使用说明

### 4.1 登录与全局

- 首次访问(后端已配置飞书登录):展示登录页,手机飞书扫码授权后进入工作台;
- 左侧边栏:首页 / 新建任务 / 技能市场 / 知识库 / 设置,底部为主题切换与退出登录;
- **⌘K / Ctrl+K** 打开命令面板,快速跳转页面或新建任务;
- 会话列表常驻侧边,显示各会话最近问题与更新时间,**带运行中状态指示**——运行中的会话可以切走,它继续在后台跑,切回时进度无缝延续。

### 4.2 对话(主流程)

1. 在输入框描述需求,例如"威海九龙城门店 2026 年 5 月蔬菜的销售情况";
2. 发送前可在 **ContextBar** 选择:Agent 类型(默认综合对话,或指定 SQL 生成/可视化报告等)、数据源、模型、是否开启规划模式(先出计划再执行);
3. 输入 `/` 直接调用某个技能(如报告、SQL 摘要);
4. 执行过程中实时看到:思考 → 工具调用(含 SQL 与结果表格)→ 子代理过程(带"子代理"标签的嵌套步骤)→ 最终答案/报告卡片;
5. Agent 主动提问时(ask_user)出现交互卡片,点选或填写后继续;
6. 需要打断时点**停止**按钮;
7. 回合结束后底部显示本回合 LLM 调用次数、token 用量与耗时;
8. 中途刷新页面或从其他标签页切回,进行中的回合自动重连续上,不丢过程。

### 4.3 子代理过程

主 Agent 处理复杂任务时会派生子代理(如 explore 检索知识库、gen_visual_report 生成可视化报告)。其完整执行过程以嵌套步骤块展示在主对话中;刷新后过程依然保留(后端将子代理会话合并进历史返回)。

### 4.4 其余页面

- **数据探索**:库 → 表 → 列三级浏览,快速了解可查数据;
- **数据源连接 / 设置**:管理模型与数据源(添加、连通性测试、删除);
- **会话历史**:按时间浏览全部会话(含子 agent 会话),点击打开、可删除;
- **技能市场**:浏览可用技能(描述/标签/来源),支持查看、创建、更新、发布、删除;
- **知识库**:浏览主题与条目,支持检索。

### 4.5 常见问题

| 现象 | 说明/处理 |
|---|---|
| 刷新页面后,正在跑的会话"卡住" | 页面会自动 resume 重放;若后端刚重启导致任务丢失,界面停留在历史状态,重新发送即可 |
| 切换会话看不到最新内容 | 正常情况下不会(切片持续更新);若遇到,强制刷新浏览器让页面重新拉历史 |
| 流式中途长时间无事件 | 看门狗会在 ~45s 判死并按退避自动重挂,无需手动干预 |
| 登录失败 | 检查 agent.yml 的 `redirect_uri` 是否与飞书后台完全一致、应用版本是否已发布所需权限 |
| 匿名模式 vs 登录模式 | 登录后会话按用户隔离并启用用户身份工具;两者数据互不可见 |

---

## 5. 与后端的接口

前端使用的所有后端接口(统一前缀 `/api/v1`,SSE 除外均经 axios 封装):

| 接口 | 方法 | 用途 |
|---|---|---|
| `/auth/me` | GET | 当前登录态(`feishu_enabled` / `authenticated` / 用户信息) |
| `/auth/feishu/login` | GET(整页跳转) | 飞书扫码授权 |
| `/auth/feishu/callback` | GET | 授权回调(后端内部) |
| `/auth/logout` | POST | 登出 |
| `/chat/stream` | POST (SSE) | 发起回合并流式返回事件 |
| `/chat/resume` | POST (SSE) | 从 `from_event_id` 重放某会话的进行中回合 |
| `/chat/stop` | POST | 停止进行中回合 |
| `/chat/user_interaction` | POST | 回答 ask_user 提问 |
| `/chat/history?session_id=` | GET | 会话历史(含合并后的子代理过程) |
| `/chat/sessions` | GET | 会话列表(`subagent_id` / 分页参数) |
| `/chat/sessions/{id}` | DELETE | 删除会话 |
| `/agent/list` | GET | 可用 Agent 类型 |
| `/models` | GET | 可用模型 |
| `/config/agent` `/config/models` `/config/datasources`(+`/test`) | GET/POST/DELETE | Agent/模型/数据源配置管理与连通性测试 |
| `/catalog/list` | GET | 数据目录(数据源下的库表元数据) |
| `/database/tables` `/database/columns` | GET | 数据探索:表/列 |
| `/skills/list` `/skills/{name}` `/skills/create` `/skills/update` `/skills/publish` `/skills/remove` | GET/POST/DELETE | 技能管理 |
| `/kb/bootstrap` `/kb/topics` `/kb/search` | GET/POST | 知识库 |

**SSE 事件类型**(`chat/stream` / `chat/resume`):

- `session`:服务端分配的真实 session id(新会话首帧);
- `message`:消息操作,`data = { type: createMessage | appendMessage | updateMessage, payload: { message_id, role, content: Block[], depth, parent_action_id, at_context } }`;
- `usage`:每 LLM 次调用的 token 用量(仅 `depth==0` 计入主会话统计);
- `end`:回合结束(累计用量/耗时);
- `error`:错误(含停止、异常);
- `ping`:保活(10s 一次,供看门狗判活)。

---

*文档版本:v1.0(2026-08-27),与 `main` 分支 `frontend/` 现状同步。*
