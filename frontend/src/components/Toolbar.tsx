import { useEffect, useState } from 'react'
import { useChatStore } from '../stores/chatStore'

interface AgentInfo {
  id: string
  name: string
  type: string
  description: string
}

interface CatalogInfo {
  name: string
  type?: string
  description?: string
}

interface ModelInfo {
  provider: string
  id: string
  model: string
  name?: string
  context_length?: number
}

export function fetchAgents(): Promise<AgentInfo[]> {
  return fetch('/api/v1/agent/list')
    .then(r => r.json())
    .then(d => (d.data?.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description || '',
    })))
    .catch(() => [])
}

export function fetchCatalogs(): Promise<CatalogInfo[]> {
  return fetch('/api/v1/catalog/list')
    .then(r => r.json())
    .then(d => {
      const cats = d.data?.catalogs || d.data || []
      if (Array.isArray(cats)) return cats.map((c: any) => ({
        name: c.name || c.catalog_name || String(c),
        type: c.type,
        description: c.description,
      }))
      return []
    })
    .catch(() => [])
}

export function fetchModels(): Promise<ModelInfo[]> {
  return fetch('/api/v1/models')
    .then(r => r.json())
    .then(d => (d.data?.models || []).map((m: any) => ({
      provider: m.provider,
      id: m.id,
      model: m.model,
      name: m.name,
      context_length: m.context_length,
    })))
    .catch(() => [])
}

const AGENT_ICONS: Record<string, string> = {
  gen_sql: '🗄️',
  gen_report: '📄',
  gen_visual_report: '📊',
  gen_visual_dashboard: '📈',
  ask_metrics: '📐',
  gen_table: '🔧',
  gen_job: '🚀',
  gen_skill: '🛠️',
  gen_sql_summary: '🗂️',
  semantic_modeling: '🧠',
  explore: '🔍',
}

export default function Toolbar() {
  const {
    selectedAgent, setSelectedAgent,
    selectedDatasource, setSelectedDatasource,
    selectedModel, setSelectedModel,
    planMode, setPlanMode,
  } = useChatStore()

  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [catalogs, setCatalogs] = useState<CatalogInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])

  useEffect(() => {
    fetchAgents().then(setAgents)
    fetchCatalogs().then(setCatalogs)
    fetchModels().then(setModels)
  }, [])

  // Auto-select defaults on first load
  useEffect(() => {
    if (!selectedAgent && agents.length > 0) setSelectedAgent(agents[0].id)
  }, [agents, selectedAgent, setSelectedAgent])

  useEffect(() => {
    if (!selectedDatasource && catalogs.length > 0) setSelectedDatasource(catalogs[0].name)
  }, [catalogs, selectedDatasource, setSelectedDatasource])

  useEffect(() => {
    if (!selectedModel && models.length > 0) {
      setSelectedModel(models[0].provider + '/' + models[0].model)
    }
  }, [models, selectedModel, setSelectedModel])

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <span className="toolbar-label">🤖 Agent</span>
        <select
          className="toolbar-select"
          value={selectedAgent || ''}
          onChange={e => setSelectedAgent(e.target.value || null)}
        >
          <option value="">默认</option>
          {agents.map(a => (
            <option key={a.id} value={a.id}>
              {AGENT_ICONS[a.id] || '🤖'} {a.name}
            </option>
          ))}
        </select>

        <span className="toolbar-label">💾 DB</span>
        <select
          className="toolbar-select"
          value={selectedDatasource || ''}
          onChange={e => setSelectedDatasource(e.target.value || null)}
        >
          <option value="">默认</option>
          {catalogs.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="toolbar-group">
        <span className="toolbar-label">🧠 Model</span>
        <select
          className="toolbar-select toolbar-select-wide"
          value={selectedModel || ''}
          onChange={e => setSelectedModel(e.target.value || null)}
        >
          <option value="">默认</option>
          {models.map(m => (
            <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
              {m.name || m.model}
            </option>
          ))}
        </select>

        <span className="toolbar-label">📋 规划模式</span>
        <label className="toolbar-switch">
          <input
            type="checkbox"
            checked={planMode}
            onChange={e => setPlanMode(e.target.checked)}
          />
          <span className="toolbar-switch-slider" />
        </label>
        <span className={`toolbar-plan-state${planMode ? ' on' : ''}`}>
          {planMode ? '开启' : '关闭'}
        </span>
      </div>
    </div>
  )
}