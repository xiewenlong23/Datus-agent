import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MessageSquarePlus, Search, Trash2 } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { loadSessions, deleteSession } from '../../services/sessions'

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const minute = 60_000
  const hour = 60 * minute
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * hour && d.toDateString() === new Date().toDateString()) {
    return `${Math.floor(diff / hour)} 小时前`
  }
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

export default function SessionListPanel() {
  const navigate = useNavigate()
  const location = useLocation()
  const { sessions, setSessions, removeSession, sessionListVersion, selectedAgent, streamingSessions } = useChatStore()
  const [query, setQuery] = useState('')
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const activeSessionId = useMemo(
    () => new URLSearchParams(location.search).get('session'),
    [location.search]
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    loadSessions({ subagentId: selectedAgent, limit: 50 }).then(list => {
      if (!cancelled) {
        setSessions(list)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [sessionListVersion, selectedAgent, setSessions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sessions
    return sessions.filter(s =>
      (s.userQuery || '').toLowerCase().includes(q) || s.sessionId.toLowerCase().includes(q)
    )
  }, [sessions, query])

  const handleSelect = (sessionId: string) => {
    if (sessionId === activeSessionId) return
    navigate(`/chat?session=${encodeURIComponent(sessionId)}`)
  }

  const handleNew = () => {
    navigate('/chat')
  }

  const handleDelete = async (sessionId: string) => {
    const ok = await deleteSession(sessionId)
    if (ok) {
      removeSession(sessionId)
      if (sessionId === activeSessionId) {
        const next = sessions.find(s => s.sessionId !== sessionId)
        if (next) handleSelect(next.sessionId)
        else handleNew()
      }
    }
    setConfirmId(null)
  }

  return (
    <div className="session-panel">
      <div className="session-panel-header">
        <button className="session-new-btn" onClick={handleNew}>
          <MessageSquarePlus size={15} />
          新对话
        </button>
      </div>

      <div className="session-search">
        <Search size={13} className="session-search-icon" />
        <input
          className="session-search-input"
          placeholder="搜索会话…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="session-list">
        {loading && sessions.length === 0 && (
          <div className="session-empty">加载中…</div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="session-empty">{query ? '没有匹配的会话' : '暂无历史会话'}</div>
        )}
        {filtered.map(s => (
          <div
            key={s.sessionId}
            className={`session-item${s.sessionId === activeSessionId ? ' active' : ''}${streamingSessions[s.sessionId] ? ' streaming' : ''}`}
            onClick={() => handleSelect(s.sessionId)}
          >
            {streamingSessions[s.sessionId] && <span className="session-streaming-dot" aria-label="运行中" />}
            <div className="session-item-main">
              <div className="session-item-title">{s.userQuery || s.sessionId}</div>
              <div className="session-item-time">{formatTime(s.lastUpdated || s.createdAt)}</div>
            </div>
            {confirmId === s.sessionId ? (
              <div className="session-item-confirm" onClick={e => e.stopPropagation()}>
                <button className="session-confirm-btn danger" onClick={() => handleDelete(s.sessionId)}>删除</button>
                <button className="session-confirm-btn" onClick={() => setConfirmId(null)}>取消</button>
              </div>
            ) : (
              <button
                className="session-delete-btn"
                title="删除会话"
                onClick={e => { e.stopPropagation(); setConfirmId(s.sessionId) }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
