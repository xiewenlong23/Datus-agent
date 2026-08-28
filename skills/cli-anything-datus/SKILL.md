---
name: cli-anything-datus
description: >-
  Datus 数据工程 agent(NL→SQL)的有状态 CLI 外壳。用于在不依赖图形界面的情况下,
  从命令行或 AI agent 驱动 Datus:检查数据源与表结构、对已配置的数据源执行 SQL、
  用自然语言提问让 Datus 生成 SQL(并返回答案行),或管理外壳会话(历史、撤销/重做、自动保存)。
---

# cli-anything-datus

[Datus](https://datus.ai) 数据工程 agent 的**有状态 CLI 外壳** —— 让你在(或让 AI agent 在)命令行中驱动 Datus,无需显示器和鼠标:检查数据源、执行 SQL、用自然语言提问并让 Datus 生成 SQL。

## 安装

CLI 是一个 PEP 420 命名空间包(`cli_anything.datus`),必须安装到**提供 `datus` 包的 Python 环境**中 —— 外壳在同进程内驱动 Datus API,不捆绑 Datus 本体:

```bash
cd <datus-repo>/agent-harness
pip install -e .        # 例如 ~/.datus/venv/bin/pip install -e .
```

**前提条件:**
- Python 3.12+
- 同一环境中可 `import datus`(例如 Datus 安装器创建的 `~/.datus/venv`)
- 带有 `conf/agent.yml` 的 Datus home(默认 `~/.datus`;可用 `--home` 或 `DATUS_HOME` 覆盖)

控制台命令为 `cli-anything-datus`。

## 用法

### 基础命令

```bash
# 查看帮助
cli-anything-datus --help

# 启动交互式 REPL(无子命令时的默认行为)
cli-anything-datus

# 查看安装 / 配置信息
cli-anything-datus status show

# 以 JSON 输出(供 agent 消费)
cli-anything-datus --json status datasources
```

### REPL 模式

不带子命令调用时,CLI 进入交互式 REPL 会话:

```bash
cli-anything-datus
# 交互式输入命令,支持 tab 补全与历史
# 例如 status / datasource / sql / ask / use / session / context / help
```

## 命令分组

### Cli

cli-anything-datus —— 从命令行驱动 Datus NL→SQL agent。

| 命令 | 说明 |
|---------|-------------|
| `repl` | 交互式 REPL(无子命令时默认进入)。 |

### Status

查看 Datus 安装与配置(无需数据库 / LLM)。

| 命令 | 说明 |
|---------|-------------|
| `show` | 显示 home、配置、项目、当前模型与数据源数量。 |
| `datasources` | 列出已配置的数据源。 |
| `subagents` | 列出已配置的 subagent(agent.agentic_nodes)。 |

### Datasource

检查与管理 Datus 数据源(真实数据库连接)。

| 命令 | 说明 |
|---------|-------------|
| `list` | 列出已配置的数据源。 |
| `tables` | 列出数据源中的表(连接真实数据库)。 |
| `schema` | 显示数据源的表 / 列结构。 |
| `test` | 测试数据源连通性。 |
| `add` | 向 agent.yml 添加数据源(唯一会写 Datus 自有状态的命令)。 |
| `use` | 设置当前会话的活动数据源(自动保存)。 |

### Sql

对数据源执行原始 SQL(无需 LLM)。

| 命令 | 说明 |
|---------|-------------|
| `run` | 执行 SQL 语句,以 JSON / 表格返回结果行。 |

### Query

通过真实 Datus agent 实现自然语言 → SQL(需要已配置的 LLM)。

| 命令 | 说明 |
|---------|-------------|
| `ask` | 用自然语言提问;返回 SQL + 答案行。 |

### Context

检查 Datus 知识库状态(agent.yml + ./subject YAML)。

| 命令 | 说明 |
|---------|-------------|
| `subagents` | 列出 subagent 及其作用域上下文。 |
| `reference-sql` | 列出 ./subject/sql_summaries 下的参考 SQL 产物。 |
| `semantic-models` | 列出 ./subject/semantic_models 下的语义模型产物。 |

### Session

管理外壳会话状态(自动保存的状态文件)。

| 命令 | 说明 |
|---------|-------------|
| `show` | 显示当前会话状态。 |
| `history` | 显示最近的提问 → SQL 历史。 |
| `clear` | 清空历史(可撤销,自动保存)。 |
| `undo` | 撤销上一次历史变更。 |
| `redo` | 重做一次历史变更。 |

## 示例

### 自然语言提问(真实 Datus agent 循环)

```bash
cli-anything-datus --json query ask "有多少所学校?"
# → {"sql": "SELECT COUNT(*) AS n FROM schools", "explanation": "...",
#    "rows": [[17686]], "row_count": 1, "executed": true, ...}
```

需要 agent.yml 中配置了可用的 LLM。agent 生成的只读 SQL 会经真实 DB
层重新执行,因此答案行会直接返回。

### 检查数据源后执行 SQL(无需 LLM)

```bash
cli-anything-datus datasource tables
cli-anything-datus datasource schema schools
cli-anything-datus --json sql run "SELECT CDSCode, SchoolName FROM schools LIMIT 5" --limit 5
```

### 管理会话历史

```bash
cli-anything-datus session history --limit 10
cli-anything-datus session undo    # 自动保存到 ./.datus-cli/session.json
```

### 添加数据源(唯一写 Datus 自有状态的命令)

```bash
cli-anything-datus datasource add mydb --type sqlite --uri /path/to/db.sqlite
# 重名会被拒绝,除非加 --force
```

## 状态管理

CLI 维护以下会话状态:

- **自动保存**:`./.datus-cli/session.json`(项目本地)通过 `@cli.result_callback()` 在退出时写入;`--dry-run` 跳过保存。
- **撤销 / 重做**:最多 50 层历史(`session undo` / `session redo`)。
- **活动数据源**:`datasource use NAME` 为该项目后续命令固定数据源(显式 `--datasource` 始终优先)。
- **Datus 自有状态**:`~/.datus/conf/agent.yml` 只会被 `datasource add` 写入(幂等;覆盖已有条目需 `--force`)。

## 输出格式

所有命令支持双输出模式:

- **人类可读**(默认):表格、颜色、格式化文本
- **机器可读**(`--json`):供 agent 消费的结构化 JSON

```bash
# 人类可读输出
cli-anything-datus datasource tables

# agent 用 JSON 输出
cli-anything-datus --json datasource tables
```

## AI Agent 使用守则

以编程方式使用本 CLI 时:

1. **始终使用 `--json`** 获取可解析输出。
2. **检查退出码** —— 0 成功;1 命令 / agent 错误;2 缺少 Datus 后端。
3. **失败时**,`--json` 输出为单个 `{"error": "…"}` 对象,包含原因(`status` / `datasource` / `sql` 无需 LLM;`query ask` 额外需要可达的 LLM)。
4. **优先用 flag 而非改状态**:用 `--home` / `--config` / `--datasource` / `--subagent` 定向,而不是修改状态。
5. **核对结果**:查看 `sql run` JSON 中的 `success` / `row_count`;失败语句以非零码退出。

## 更多信息

- 完整文档:包内 README.md
- 测试覆盖:包内 TEST.md(97 个测试,100% 通过)
- 方法论:cli-anything-plugin 中的 HARNESS.md

## 版本

1.0.0
