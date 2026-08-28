import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface DatabaseInfo {
  name: string
  type: string
  uri: string
  current: boolean
  connection_status: string
  tables_count?: number
  last_accessed?: string
  error?: string
}

function fetchDatabases(): Promise<DatabaseInfo[]> {
  return fetch('/api/v1/catalog/list')
    .then(r => r.json())
    .then(d => (d.data?.databases || []))
    .catch(() => [])
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
  redshift: '🔴',
  oracle: '⚪',
  mssql: '🟦',
}

export default function DataConnectionPage() {
  const navigate = useNavigate()
  const [databases, setDatabases] = useState<DatabaseInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchDatabases().then(list => {
      setDatabases(list)
      setLoading(false)
    }).catch(() => {
      setError('加载数据源列表失败')
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="standalone-page">
        <div className="skeleton" style={{ width: 160, height: 28, marginBottom: 8 }} />
        <div className="skeleton" style={{ width: 240, height: 14, marginBottom: 16 }} />
        <div className="skeleton-panel">
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton" style={{ height: 80, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="standalone-page">
        <h1>数据源连接</h1>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    )
  }

  return (
    <div className="standalone-page">
      <h1>数据源连接</h1>
      <p>管理 Datus 可访问的数据库、数据仓库和 API 端点。配置连接后，Agent 可以自动查询、分析和生成数据。</p>
      <p className="kb-stats">已连接 {databases.length} 个数据源</p>

      {databases.length === 0 ? (
        <div className="kb-bootstrap-hint" style={{ marginTop: 8 }}>
          <p>📌 暂未配置数据源。</p>
          <p>在「设置」页面可以添加数据库连接，无需编辑配置文件或使用命令行。</p>
          <div style={{ marginTop: 12 }}>
            <button
              className="kb-bootstrap-start-btn"
              onClick={() => navigate('/settings')}
            >
              ⚙️ 前往设置页面添加
            </button>
          </div>
        </div>
      ) : (
        <>
          <div style={{ marginTop: 12, marginBottom: 12 }}>
            <button
              className="kb-bootstrap-start-btn"
              onClick={() => navigate('/settings')}
            >
              + 添加数据源
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14, marginTop: 8 }}>
            {databases.map(db => {
              const icon = DB_TYPE_ICONS[db.type] || '🗄️'
              const isConnected = db.connection_status === 'connected'
              return (
                <div
                  key={db.name}
                  className="quick-card"
                  style={{
                    border: isConnected ? '1px solid var(--accent)' : '1px solid var(--border)',
                    opacity: isConnected ? 1 : 0.6,
                  }}
                >
                  <div className="quick-card-title">
                    {icon} {db.name}
                    {db.current && <span className="quick-tag" style={{ background: 'var(--accent)', color: '#fff' }}>当前</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <span className="quick-tag">{db.type}</span>
                    <span className="quick-tag" style={{ color: isConnected ? 'var(--success)' : 'var(--danger)' }}>
                      {isConnected ? '已连接' : '异常'}
                    </span>
                  </div>
                  {db.error && (
                    <div className="error-banner" style={{ marginTop: 8, fontSize: 11, padding: '6px 8px' }}>
                      {db.error.split('\n')[0]}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 6 }}>
                    {db.last_accessed ? `最后访问: ${db.last_accessed.split('T')[0]}` : '未访问'}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}