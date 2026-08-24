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

export default function KnowledgeBasePage() {
  const [topics, setTopics] = useState<KbTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTopic, setActiveTopic] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<KbSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)

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

  if (loading) {
    return (
      <div className="standalone-page">
        <p>知识库加载中...</p>
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

      {activeTopic && (
        <div className="kb-active-filter">
          当前筛选: <strong>{TOPIC_NAMES[activeTopic] || activeTopic}</strong>
          <button className="kb-clear-filter" onClick={() => switchTopic(null)}>清除</button>
        </div>
      )}

      {searched && (
        <div className="kb-results">
          {results.length === 0 ? (
            <div className="kb-empty">没有找到匹配的结果。知识库可能尚未构建，或关键词太具体。</div>
          ) : (
            results.map((r, i) => (
              <div key={i} className="kb-result-item">
                <span className="kb-result-topic">{TOPIC_NAMES[r.topic] || r.topic}</span>
                <div className="kb-result-title">{r.title || '(无标题)'}</div>
                <div className="kb-result-snippet">{r.snippet}</div>
              </div>
            ))
          )}
        </div>
      )}

      {!searched && totalCount === 0 && (
        <div className="kb-bootstrap-hint">
          <p>📌 知识库尚未构建。</p>
          <p>
            数据表元数据、指标、语义模型和 Reference SQL 需要先初始化。
            你可以通过 CLI 运行 <code>bootstrap-kb</code> 命令构建知识库。
          </p>
        </div>
      )}
    </div>
  )
}