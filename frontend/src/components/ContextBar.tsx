import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../stores/chatStore'
import { fetchAgents, fetchCatalogs, fetchModels } from '../services/meta'
import type { AgentInfo, CatalogInfo, ModelInfo } from '../services/meta'
import { Bot, Database, Sparkles, ChevronDown } from 'lucide-react'

const AGENT_ICONS: Record<string, string> = {
  gen_sql: '🗄️',
  gen_report: '📄',
  gen_visual_report: '📊',
  gen_visual_dashboard: '📈',
  gen_dashboard: '🎛️',
  ask_metrics: '📐',
  gen_metrics: '📏',
  gen_table: '🔧',
  gen_job: '🚀',
  gen_skill: '🛠️',
  gen_sql_summary: '🗂️',
  gen_semantic_model: '🧠',
  scheduler: '⏰',
}

const AGENT_LABELS: Record<string, string> = {
  gen_sql: 'SQL 生成',
  gen_report: '报告生成',
  gen_visual_report: '可视化报告',
  gen_visual_dashboard: '可视化仪表盘',
  gen_dashboard: 'BI 仪表盘',
  ask_metrics: '指标问答',
  gen_metrics: '指标定义',
  gen_table: '建表',
  gen_job: '数据管道',
  gen_skill: '技能构建',
  gen_sql_summary: 'SQL 摘要',
  gen_semantic_model: '语义模型',
  scheduler: '定时调度',
}

const AGENT_DESC: Record<string, string> = {
  gen_sql: '具备深度专业知识的专用 SQL 生成',
  gen_report: '灵活的报告生成，支持可配置工具',
  gen_visual_report: '在 reports/ 下产出自包含的可视化报告',
  gen_visual_dashboard: '生成参数化、可按筛选条件实时重查的可视化仪表盘',
  gen_dashboard: '在 BI 平台（Superset/Grafana）上创建和管理仪表盘',
  ask_metrics: '基于已有语义指标回答 KPI、趋势、分组指标和归因问题',
  gen_metrics: '定义 MetricFlow 指标（SQL / 自然语言 / 批量提取）',
  gen_table: '数据库建表（CTAS 或自然语言描述）',
  gen_job: '数据管道执行（单库 ETL 和跨库迁移，含对数校验）',
  gen_skill: 'skill 创建与优化',
  gen_sql_summary: '总结和分类 SQL 查询',
  gen_semantic_model: '从表结构生成 MetricFlow 语义模型 YAML',
  scheduler: '创建和管理定时调度任务',
}

function Pill({ icon, label, active, onClick, children }: {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <div style={{ position: 'relative' }}>
      <button className={`context-pill${active ? ' active' : ''}`} onClick={onClick}>
        <span className="context-pill-icon">{icon}</span>
        <span className="context-pill-label">{label}</span>
        <span className="context-pill-arrow"><ChevronDown size={12} /></span>
      </button>
      {children}
    </div>
  )
}

function Popover({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])
  return <div className="context-popover" ref={ref}>{children}</div>
}

export default function ContextBar() {
  const {
    selectedAgent, setSelectedAgent,
    selectedDatasource, setSelectedDatasource,
    selectedModel, setSelectedModel,
    planMode, setPlanMode,
  } = useChatStore()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [catalogs, setCatalogs] = useState<CatalogInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [currentModel, setCurrentModel] = useState('')
  const [openPopover, setOpenPopover] = useState<string | null>(null)

  useEffect(() => {
    fetchAgents().then(setAgents)
    fetchCatalogs().then(setCatalogs)
    fetchModels().then(({ models, current }) => {
      setModels(models)
      setCurrentModel(current)
    })
  }, [])

  // Auto-select defaults. Agent stays null (= Main Agent, like the original
  // chatbot) until the user explicitly picks a subagent.
  useEffect(() => {
    if (!selectedDatasource && catalogs.length > 0) setSelectedDatasource(catalogs[0].name)
  }, [catalogs, selectedDatasource, setSelectedDatasource])

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(currentModel || `${models[0].provider}/${models[0].id}`)
    }
  }, [models, selectedModel, setSelectedModel, currentModel])

  const agentLabel = AGENT_LABELS[selectedAgent || ''] || agents.find(a => a.id === selectedAgent)?.name || selectedAgent || 'Main Agent'
  const dsLabel = selectedDatasource || '默认'
  const modelLabel = models.find(m => `${m.provider}/${m.id}` === selectedModel)?.name ||
    models.find(m => `${m.provider}/${m.id}` === selectedModel)?.model ||
    selectedModel || '默认'

  return (
    <div className="context-bar">
      {/* Agent pill */}
      <Pill
        icon={<Bot size={14} />}
        label={agentLabel}
        onClick={() => setOpenPopover(openPopover === 'agent' ? null : 'agent')}
      >
        {openPopover === 'agent' && (
          <Popover onClose={() => setOpenPopover(null)}>
            <button
              className={`context-popover-item${!selectedAgent ? ' active' : ''}`}
              onClick={() => { setSelectedAgent(null); setOpenPopover(null) }}
            >
              Main Agent
            </button>
            {agents.map(a => (
              <button
                key={a.id}
                className={`context-popover-item${selectedAgent === a.id ? ' active' : ''}`}
                onClick={() => { setSelectedAgent(a.id); setOpenPopover(null) }}
                style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                  <span>{AGENT_ICONS[a.id] || '🤖'}</span>
                  <span style={{ fontWeight: 600 }}>{AGENT_LABELS[a.id] || a.name}</span>
                  {a.type === 'builtin' && <span className="agent-builtin-tag">builtin</span>}
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                    {a.id}
                  </span>
                </span>
                <span className="context-popover-desc">
                  {AGENT_DESC[a.id] || a.description || ''}
                </span>
              </button>
            ))}
          </Popover>
        )}
      </Pill>

      {/* Datasource pill */}
      <Pill
        icon={<Database size={14} />}
        label={dsLabel}
        onClick={() => setOpenPopover(openPopover === 'ds' ? null : 'ds')}
      >
        {openPopover === 'ds' && (
          <Popover onClose={() => setOpenPopover(null)}>
            <button
              className={`context-popover-item${!selectedDatasource ? ' active' : ''}`}
              onClick={() => { setSelectedDatasource(null); setOpenPopover(null) }}
            >
              默认
            </button>
            {catalogs.map(c => (
              <button
                key={c.name}
                className={`context-popover-item${selectedDatasource === c.name ? ' active' : ''}`}
                onClick={() => { setSelectedDatasource(c.name); setOpenPopover(null) }}
              >
                {c.name}
              </button>
            ))}
          </Popover>
        )}
      </Pill>

      {/* Model pill */}
      <Pill
        icon={<Sparkles size={14} />}
        label={modelLabel}
        onClick={() => setOpenPopover(openPopover === 'model' ? null : 'model')}
      >
        {openPopover === 'model' && (
          <Popover onClose={() => setOpenPopover(null)}>
            <button
              className={`context-popover-item${!selectedModel ? ' active' : ''}`}
              onClick={() => { setSelectedModel(null); setOpenPopover(null) }}
            >
              默认
            </button>
            {models.map(m => (
              <button
                key={`${m.provider}/${m.id}`}
                className={`context-popover-item${selectedModel === `${m.provider}/${m.id}` ? ' active' : ''}`}
                onClick={() => { setSelectedModel(`${m.provider}/${m.id}`); setOpenPopover(null) }}
              >
                {m.name || m.model}
              </button>
            ))}
          </Popover>
        )}
      </Pill>

      {/* Plan mode toggle */}
      <div className="context-plan-toggle" style={{ marginLeft: 'auto' }}>
        <span className="context-pill-label">规划模式</span>
        <button
          className={`context-plan-toggle${planMode ? ' on' : ''}`}
          onClick={() => setPlanMode(!planMode)}
          style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: '0 4px' }}
          aria-label={planMode ? '关闭规划模式' : '开启规划模式'}
        >
          <span className="plan-dot" />
          <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)' }}>
            {planMode ? '开启' : '关闭'}
          </span>
        </button>
      </div>
    </div>
  )
}