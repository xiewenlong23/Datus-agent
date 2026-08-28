import { useEffect, useState } from 'react'

interface KbTopic {
  id: string
  name: string
  description: string
  icon: string
  item_count: number
}

interface KbSearchResult {
  topic: string
  title: string
  snippet: string
  relevance: number
}

const TOPIC_NAMES: Record<string, string> = {
  metadata: 'Schema 元数据',
  semantic_model: '语义模型',
  metrics: '业务指标',
  reference_sql: 'Reference SQL',
  platform_docs: '平台文档',
}

function fetchTopics(): Promise<KbTopic[]> {
  return fetch('/api/v1/kb/topics')
    .then(r => r.json())
    .then(d => (d.data?.topics || []))
    .catch(() => [])
}

function searchKb(query: string, topic?: string): Promise<KbSearchResult[]> {
  return fetch('/api/v1/kb/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topic: topic || undefined, limit: 30 }),
  })
    .then(r => r.json())
    .then(d => (d.data?.results || []))
    .catch(() => [])
}

/** Wrap query keyword occurrences in <mark> for visual highlight. */
function highlight(text: string, query: string): React.ReactNode {
  const q = query.trim()
  if (!q || !text) return text
  const terms = q.split(/\s+/).filter(t => t.length > 1)
  if (terms.length === 0) return text
  const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  const parts = text.split(pattern)
  return parts.map((part, i) =>
    pattern.test(part) ? <mark key={i} className="kb-highlight">{part}</mark> : part
  )
}

export default function KnowledgeBasePage() {
  const [topics, setTopics] = useState<KbTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KbSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

  // Bootstrap state
  const [showBootstrap, setShowBootstrap] = useState(false)
  const [bootstrapStage, setBootstrapStage] = useState<string>('')
  const [bootstrapProgress, setBootstrapProgress] = useState(0)
  const [bootstrapMessage, setBootstrapMessage] = useState('')
  const [bootstrapActive, setBootstrapActive] = useState(false)

  useEffect(() => {
    fetchTopics().then(list => {
      setTopics(list)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSearch = async () => {
    if (!query.trim()) return
    setSearching(true)
    setSearched(true)
    const res = await searchKb(query, activeTopic || undefined)
    setResults(res)
    setSearching(false)
  }

  const switchTopic = (topicId: string | null) => {
    setActiveTopic(topicId)
    setSearched(false)
    setResults([])
  }

  const totalCount = topics.reduce((sum, t) => sum + t.item_count, 0)

  const handleBootstrap = async (includeDocs: boolean) => {
    setBootstrapActive(true)
    setBootstrapStage('Initializing...')
    setBootstrapProgress(0)
    setBootstrapMessage('Starting KB bootstrap...')

    try {
      // Use the bootstrap stream API
      const response = await fetch('/api/v1/kb/bootstrap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: [],
          include_platform_docs: includeDocs,
        }),
      })

      if (!response.ok) {
        throw new Error('Bootstrap failed')
      }

      // Handle SSE stream
      const reader = response.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.slice(5))
                setBootstrapStage(data.stage || 'Processing')
                setBootstrapProgress(data.progress || 0)
                setBootstrapMessage(data.message || '')
              } catch (e) {
                console.error('Failed to parse SSE data:', e)
              }
            }
          }
        }
      }

      setBootstrapActive(false)
      setBootstrapStage('Completed')
      setBootstrapProgress(100)
      setBootstrapMessage('Knowledge base bootstrapped successfully')

      // Refresh topics
      const updatedTopics = await fetchTopics()
      setTopics(updatedTopics)
    } catch (error) {
      setBootstrapActive(false)
      setBootstrapStage('Failed')
      setBootstrapMessage(String(error))
    }
  }

  if (loading) {
    return (
      <div className="standalone-page kb-page">
        <div className="kb-header">
          <div className="skeleton" style={{ width: 160, height: 28 }} />
          <div className="skeleton" style={{ width: 240, height: 14, marginTop: 8 }} />
        </div>
        <div className="skeleton-panel" style={{ marginTop: 16 }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: 8 }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="standalone-page kb-page">
      <div className="kb-header">
        <h1>知识库</h1>
        <p>集中式的数据资产与文档存储库</p>
        <p className="kb-stats">
          共 {topics.length} 个分类 · 已索引 {totalCount} 个条目
        </p>
      </div>

      {/* Bootstrap Section */}
      <div className="kb-bootstrap-section">
        {!bootstrapActive ? (
          <>
            <div className="kb-bootstrap-actions">
              <button className="kb-bootstrap-btn" onClick={() => setShowBootstrap(!showBootstrap)}>
                {showBootstrap ? '收起' : '引导构建'}
              </button>
              {totalCount === 0 && (
                <span className="kb-bootstrap-hint-text">
                  构建知识库以启用智能查询和文档检索
                </span>
              )}
            </div>

            {showBootstrap && (
              <div className="kb-bootstrap-form">
                <div className="kb-form-group">
                  <label>包含平台文档</label>
                  <select className="kb-form-select">
                    <option value="true">是，包含平台文档</option>
                    <option value="false">否，仅构建数据资产</option>
                  </select>
                </div>
                <div className="kb-form-actions">
                  <button className="kb-bootstrap-start-btn" onClick={() => handleBootstrap(true)}>
                    开始构建
                  </button>
                  <button className="kb-bootstrap-cancel-btn" onClick={() => setShowBootstrap(false)}>
                    取消
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="kb-bootstrap-progress">
            <div className="kb-progress-bar">
              <div
                className="kb-progress-fill"
                style={{ width: `${bootstrapProgress}%` }}
              />
            </div>
            <div className="kb-progress-text">
              {bootstrapStage}: {bootstrapMessage} ({bootstrapProgress}%)
            </div>
          </div>
        )}
      </div>

      {/* Topic Cards */}
      <div className="kb-topic-grid">
        {topics.map(topic => (
          <div
            key={topic.id}
            className={`kb-topic-card${activeTopic === topic.id ? ' active' : ''}`}
            onClick={() => switchTopic(activeTopic === topic.id ? null : topic.id)}
          >
            <div className="kb-topic-icon">{topic.icon}</div>
            <div className="kb-topic-info">
              <div className="kb-topic-name">{topic.name}</div>
              <div className="kb-topic-desc">{topic.description}</div>
            </div>
            <span className="kb-topic-count">{topic.item_count}</span>
          </div>
        ))}
      </div>

      {/* Search Bar */}
      <div className="kb-search-bar">
        <input
          type="text"
          className="kb-search-input"
          placeholder={activeTopic
            ? `搜索 ${TOPIC_NAMES[activeTopic] || activeTopic}...`
            : '搜索知识库（表、指标、参考 SQL、语义模型）...'}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleSearch() }}
        />
        <button className="kb-search-btn" onClick={handleSearch} disabled={searching || !query.trim()}>
          {searching ? '搜索中...' : '搜索'}
        </button>
      </div>

      {/* Filter */}
      {activeTopic && (
        <div className="kb-active-filter">
          当前筛选: <strong>{TOPIC_NAMES[activeTopic] || activeTopic}</strong>
          <button className="kb-clear-filter" onClick={() => switchTopic(null)}>清除</button>
        </div>
      )}

      {/* Results */}
      {searched && (
        <div className="kb-results">
          {results.length === 0 ? (
            <div className="kb-empty">没有找到匹配的结果。知识库可能尚未构建，或关键词太具体。</div>
          ) : (
            results.map((r, i) => (
              <div key={i} className="kb-result-item">
                <span className="kb-result-topic">{TOPIC_NAMES[r.topic] || r.topic}</span>
                <div className="kb-result-title">{highlight(r.title || '(无标题)', query)}</div>
                <div className="kb-result-snippet">{highlight(r.snippet, query)}</div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Bootstrap Hint (when empty) */}
      {!searched && totalCount === 0 && (
        <div className="kb-bootstrap-hint">
          <p>📌 知识库尚未构建。</p>
          <p>
            数据表元数据、指标、语义模型和 Reference SQL 需要先初始化。
            你可以通过点击上方的"引导构建"按钮或使用 CLI 运行 <code>bootstrap-kb</code> 命令构建知识库。
          </p>
        </div>
      )}
    </div>
  )
}