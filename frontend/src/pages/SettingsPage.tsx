import { useEffect, useState } from 'react'
import AddModelModal from '../components/AddModelModal'
import AddDatasourceModal from '../components/AddDatasourceModal'

interface ModelEntry {
  name: string
  type: string
  model: string
  api_key?: string
  base_url?: string
  isDefault: boolean
}

interface DatasourceEntry {
  name: string
  type: string
  connection_status: string
  isCurrent: boolean
  error?: string
}

const DB_TYPE_ICONS: Record<string, string> = {
  clickhouse: '🏔️',
  postgresql: '🐘',
  mysql: '🗄️',
  mariadb: '🗄️',
  duckdb: '🦆',
  sqlite: '🗃️',
  snowflake: '❄️',
  starrocks: '⭐',
  doris: '🎯',
  bigquery: '🔷',
  databricks: '🔷',
}

async function fetchConfigAgent(): Promise<{ models: Record<string, any>; datasources: Record<string, any>; target: string | null; current_datasource: string | null }> {
  const res = await fetch('/api/v1/config/agent')
  const d = await res.json()
  const data = d?.data || {}
  return {
    models: data.models || {},
    datasources: data.datasources || {},
    target: data.target || null,
    current_datasource: data.current_datasource || null,
  }
}

async function fetchCatalogStatus(): Promise<Record<string, string>> {
  const res = await fetch('/api/v1/catalog/list')
  const d = await res.json()
  const dbs = d?.data?.databases || []
  const map: Record<string, string> = {}
  for (const db of dbs) {
    map[db.name] = db.connection_status || 'unknown'
  }
  return map
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'models' | 'datasources'>('models')
  const [loading, setLoading] = useState(true)

  const [models, setModels] = useState<ModelEntry[]>([])
  const [datasources, setDatasources] = useState<DatasourceEntry[]>([])

  const [showAddModel, setShowAddModel] = useState(false)
  const [editingModel, setEditingModel] = useState<ModelEntry | null>(null)
  const [showAddDatasource, setShowAddDatasource] = useState(false)

  const [testingModel, setTestingModel] = useState<string | null>(null)
  const [testingDs, setTestingDs] = useState<string | null>(null)
  const [testFeedback, setTestFeedback] = useState<{ name: string; ok: boolean; message: string } | null>(null)

  const loadData = async () => {
    setLoading(true)
    try {
      const [config, catalogStatus] = await Promise.all([
        fetchConfigAgent(),
        fetchCatalogStatus(),
      ])

      // Build model entries
      const target = config.target
      const modelEntries: ModelEntry[] = Object.entries(config.models).map(([name, cfg]: [string, any]) => ({
        name,
        type: cfg.type || '',
        model: cfg.model || '',
        api_key: cfg.api_key || '',
        base_url: cfg.base_url || '',
        isDefault: name === target,
      }))
      // Sort: default first, then alphabetically
      modelEntries.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setModels(modelEntries)

      // Build datasource entries
      const dsEntries: DatasourceEntry[] = Object.entries(config.datasources).map(([name, cfg]: [string, any]) => ({
        name,
        type: cfg.type || '',
        connection_status: catalogStatus[name] || 'unknown',
        isCurrent: name === config.current_datasource,
        error: (cfg as any).error,
      }))
      dsEntries.sort((a, b) => {
        if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      setDatasources(dsEntries)
    } catch {
      // Silently fail — page shows empty state
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  if (loading) {
    return (
      <div className="standalone-page">
        <p>加载配置中...</p>
      </div>
    )
  }

  return (
    <div className="settings-page">
      <div className="settings-header">
        <h1>设置</h1>
        <p>管理 LLM 模型和数据源连接。所有配置保存后会即时生效。</p>
      </div>

      {/* Tabs */}
      <div className="settings-tabs">
        <button
          className={`settings-tab${activeTab === 'models' ? ' active' : ''}`}
          onClick={() => setActiveTab('models')}
        >
          🧠 LLM 模型
        </button>
        <button
          className={`settings-tab${activeTab === 'datasources' ? ' active' : ''}`}
          onClick={() => setActiveTab('datasources')}
        >
          🗄️ 数据源
        </button>
      </div>

      {/* Models Tab */}
      {activeTab === 'models' && (
        <div className="settings-content">
          <div className="settings-section">
            <h2 className="settings-section-title">已配置模型 ({models.length})</h2>
            {models.length === 0 ? (
              <div className="settings-empty">
                <p>暂未配置 LLM 模型</p>
                <p className="settings-hint">点击下方「添加模型」按钮，配置您的 API Key 和模型参数。</p>
              </div>
            ) : (
              <div className="settings-list">
                {models.map(m => (
                  <div key={m.name} className="settings-item">
                    <div className="settings-item-icon">🧠</div>
                    <div className="settings-item-info">
                      <div className="settings-item-title">
                        {m.name}
                        {m.isDefault && <span className="settings-current-badge">默认</span>}
                      </div>
                      <div className="settings-item-subtitle">
                        {m.type} · {m.model}
                        {m.api_key ? ' · 🔑 已配置' : ' · ⚠️ 未配置 Key'}
                      </div>
                    </div>
                    <div className="settings-item-actions">
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={async () => {
                          setTestingModel(m.name)
                          setTestFeedback(null)
                          try {
                            const res = await fetch('/api/v1/config/models/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                type: m.type,
                                model: m.model,
                                api_key: m.api_key || undefined,
                                base_url: m.base_url || undefined,
                              }),
                            })
                            const data = await res.json()
                            const inner = data?.data ?? {}
                            setTestFeedback({
                              name: m.name,
                              ok: inner.ok,
                              message: inner.ok ? '✅ 连接成功' : `❌ ${inner.message || '失败'}`,
                            })
                          } catch {
                            setTestFeedback({ name: m.name, ok: false, message: '❌ 测试接口不可用' })
                          } finally {
                            setTestingModel(null)
                          }
                        }}
                        disabled={testingModel === m.name}
                      >
                        {testingModel === m.name ? <><span className="spinner" />测试中</> : '测试连接'}
                      </button>
                      <button
                        className="btn btn-sm btn-secondary"
                        onClick={() => setEditingModel(m)}
                      >
                        修改
                      </button>
                      {!m.isDefault && (
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={async () => {
                            try {
                              await fetch('/api/v1/config/models', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ target: m.name }),
                              })
                              loadData()
                            } catch {}
                          }}
                        >
                          设为默认
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-danger"
                        onClick={async () => {
                          const config = await fetchConfigAgent()
                          const { [m.name]: _, ...rest } = config.models
                          const payload: Record<string, any> = { models: rest }
                          if (m.isDefault && Object.keys(rest).length > 0) {
                            payload.target = Object.keys(rest)[0]
                          }
                          try {
                            await fetch('/api/v1/config/models', {
                              method: 'PUT',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify(payload),
                            })
                            loadData()
                          } catch {}
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {testFeedback && (
            <div className={`test-feedback ${testFeedback.ok ? 'success' : 'failure'}`}>
              {testFeedback.message}
            </div>
          )}

          <div className="settings-section">
            <div className="settings-actions">
              <button className="settings-action-btn primary" onClick={() => setShowAddModel(true)}>
                + 添加模型
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Datasources Tab */}
      {activeTab === 'datasources' && (
        <div className="settings-content">
          <div className="settings-section">
            <h2 className="settings-section-title">已配置数据源 ({datasources.length})</h2>
            {datasources.length === 0 ? (
              <div className="settings-empty">
                <p>暂未配置数据源</p>
                <p className="settings-hint">点击下方「添加数据源」按钮，填写数据库连接信息。</p>
              </div>
            ) : (
              <div className="settings-list">
                {datasources.map(ds => {
                  const icon = DB_TYPE_ICONS[ds.type] || '🗄️'
                  const isConnected = ds.connection_status === 'connected'
                  return (
                    <div key={ds.name} className="settings-item">
                      <div className="settings-item-icon">{icon}</div>
                      <div className="settings-item-info">
                        <div className="settings-item-title">
                          {ds.name}
                          {ds.isCurrent && <span className="settings-current-badge">当前</span>}
                        </div>
                        <div className="settings-item-subtitle">{ds.type}</div>
                      </div>
                      <div className={`settings-item-status ${isConnected ? 'connected' : 'disconnected'}`}>
                        {isConnected ? '已连接' : '异常'}
                      </div>
                      <div className="settings-item-actions">
                        <button
                          className="btn btn-sm btn-secondary"
                          onClick={async () => {
                            setTestingDs(ds.name)
                            setTestFeedback(null)
                            try {
                              // Fetch full config so we can send the complete datasource config
                              const fullConfig = await fetchConfigAgent()
                              const dsConfig = fullConfig.datasources[ds.name] || {}
                              const res = await fetch('/api/v1/config/datasources/test', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(dsConfig),
                              })
                              const data = await res.json()
                              const inner = data?.data ?? {}
                              setTestFeedback({
                                name: ds.name,
                                ok: inner.ok,
                                message: inner.ok ? '✅ 连接成功' : `❌ ${inner.message || '失败'}`,
                              })
                            } catch {
                              setTestFeedback({ name: ds.name, ok: false, message: '❌ 测试接口不可用' })
                            } finally {
                              setTestingDs(null)
                            }
                          }}
                          disabled={testingDs === ds.name}
                        >
                          {testingDs === ds.name ? <><span className="spinner" />测试中</> : '测试连接'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          onClick={async () => {
                            const config = await fetchConfigAgent()
                            const { [ds.name]: _, ...rest } = config.datasources
                            try {
                              await fetch('/api/v1/config/datasources', {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ datasources: rest }),
                              })
                              loadData()
                            } catch {}
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {testFeedback && (
            <div className={`test-feedback ${testFeedback.ok ? 'success' : 'failure'}`}>
              {testFeedback.message}
            </div>
          )}

          <div className="settings-section">
            <div className="settings-actions">
              <button className="settings-action-btn primary" onClick={() => setShowAddDatasource(true)}>
                + 添加数据源
              </button>
            </div>
          </div>
        </div>
      )}

      {(showAddModel || editingModel) && (
        <AddModelModal
          editModel={editingModel || undefined}
          onClose={() => {
            setShowAddModel(false)
            setEditingModel(null)
          }}
          onSaved={loadData}
        />
      )}
      {showAddDatasource && <AddDatasourceModal onClose={() => setShowAddDatasource(false)} onSaved={loadData} />}
    </div>
  )
}