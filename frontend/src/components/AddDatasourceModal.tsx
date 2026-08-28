import { useEffect, useState } from 'react'

const DB_TYPES = [
  { value: 'postgresql', label: 'PostgreSQL', icon: '🐘' },
  { value: 'mysql', label: 'MySQL', icon: '🗄️' },
  { value: 'clickhouse', label: 'ClickHouse', icon: '🏔️' },
  { value: 'duckdb', label: 'DuckDB', icon: '🦆' },
  { value: 'sqlite', label: 'SQLite', icon: '🗃️' },
  { value: 'snowflake', label: 'Snowflake', icon: '❄️' },
  { value: 'starrocks', label: 'StarRocks', icon: '⭐' },
  { value: 'bigquery', label: 'BigQuery', icon: '🔷' },
  { value: 'databricks', label: 'Databricks', icon: '🔷' },
]

interface Props {
  onClose: () => void
  onSaved: () => void
}

export default function AddDatasourceModal({ onClose, onSaved }: Props) {
  const [dbType, setDbType] = useState('postgresql')

  // Common fields
  const [name, setName] = useState('')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [path, setPath] = useState('')

  // Snowflake-specific
  const [account, setAccount] = useState('')
  const [warehouse, setWarehouse] = useState('')

  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    const defaults: Record<string, string> = {
      postgresql: '5432',
      mysql: '3306',
      clickhouse: '8123',
      starrocks: '9030',
    }
    setPort(defaults[dbType] || '')
  }, [dbType])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const isFileType = dbType === 'sqlite' || dbType === 'duckdb'
  const isSnowflake = dbType === 'snowflake'

  const buildConfig = (): Record<string, unknown> => {
    if (isFileType) {
      return { type: dbType, path: path.trim() || undefined }
    }
    if (isSnowflake) {
      return {
        type: dbType,
        account: account.trim() || undefined,
        username: user.trim() || undefined,
        password: password.trim() || undefined,
        warehouse: warehouse.trim() || undefined,
        database: database.trim() || undefined,
      }
    }
    return {
      type: dbType,
      host: host.trim() || undefined,
      port: port.trim() ? parseInt(port.trim(), 10) : undefined,
      username: user.trim() || undefined,
      password: password.trim() || undefined,
      database: database.trim() || undefined,
    }
  }

  const handleTest = async () => {
    if (!name.trim()) { setError('请填写数据源名称'); return }
    setError('')
    setFeedback(null)
    setTesting(true)
    try {
      const res = await fetch('/api/v1/config/datasources/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConfig()),
      })
      const data = await res.json()
      const inner = data?.data ?? {}
      if (inner.ok) {
        setFeedback({ ok: true, message: '✅ 连接成功，数据源可用' })
      } else {
        setFeedback({ ok: false, message: `❌ 连接失败：${inner.message || '未知错误'}` })
      }
    } catch {
      setFeedback({ ok: false, message: '❌ 无法连接到测试接口，请检查服务是否在运行' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('请填写数据源名称'); return }
    setError('')
    setSaving(true)
    try {
      const cfgRes = await fetch('/api/v1/config/agent')
      const cfgData = await cfgRes.json()
      const existing: Record<string, unknown> = cfgData?.data?.datasources || {}

      const newDatasources: Record<string, unknown> = { ...existing, [name.trim()]: buildConfig() }

      const res = await fetch('/api/v1/config/datasources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ datasources: newDatasources }),
      })
      const data = await res.json()
      if (data?.success) {
        onSaved()
        onClose()
      } else {
        setError(data?.errorMessage || '保存失败，请重试')
      }
    } catch {
      setError('保存失败，请检查服务连接')
    } finally {
      setSaving(false)
    }
  }

  const selectedType = DB_TYPES.find(t => t.value === dbType)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>➕ 添加数据源</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="form-group">
          <label>数据库类型</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {DB_TYPES.map(t => (
              <button
                key={t.value}
                className="btn btn-sm"
                style={{
                  background: dbType === t.value ? 'var(--accent)' : 'var(--bg)',
                  color: dbType === t.value ? '#fff' : 'var(--text)',
                  borderColor: dbType === t.value ? 'var(--accent)' : 'var(--border)',
                }}
                onClick={() => setDbType(t.value)}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label>数据源名称</label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={`例如 ${selectedType?.label || 'my'}-数据库`}
          />
        </div>

        {isFileType ? (
          <div className="form-group">
            <label>文件路径</label>
            <input
              className="form-input"
              value={path}
              onChange={e => setPath(e.target.value)}
              placeholder={`/path/to/${dbType === 'sqlite' ? 'database.db' : 'database.duckdb'}`}
            />
            <div className="form-hint">输入数据库文件的绝对路径</div>
          </div>
        ) : isSnowflake ? (
          <>
            <div className="form-group">
              <label>Account</label>
              <input className="form-input" value={account} onChange={e => setAccount(e.target.value)} placeholder="xxx.snowflakecomputing.com" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>用户名</label>
                <input className="form-input" value={user} onChange={e => setUser(e.target.value)} />
              </div>
              <div className="form-group">
                <label>密码</label>
                <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>数据库</label>
                <input className="form-input" value={database} onChange={e => setDatabase(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Warehouse</label>
                <input className="form-input" value={warehouse} onChange={e => setWarehouse(e.target.value)} />
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="form-group" style={{ flex: 2 }}>
                <label>主机地址</label>
                <input className="form-input" value={host} onChange={e => setHost(e.target.value)} placeholder="localhost" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label>端口</label>
                <input className="form-input" value={port} onChange={e => setPort(e.target.value)} placeholder="5432" />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>用户名</label>
                <input className="form-input" value={user} onChange={e => setUser(e.target.value)} />
              </div>
              <div className="form-group">
                <label>密码</label>
                <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>数据库名</label>
              <input className="form-input" value={database} onChange={e => setDatabase(e.target.value)} />
            </div>
          </>
        )}

        {error && <div className="form-error">{error}</div>}
        {feedback && (
          <div className={`test-feedback ${feedback.ok ? 'success' : 'failure'}`}>
            {feedback.message}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing || saving}>
            {testing && <span className="spinner" />}
            测试连接
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || testing}>
            {saving && <span className="spinner" />}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}