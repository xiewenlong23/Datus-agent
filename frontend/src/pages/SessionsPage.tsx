import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadSessions } from '../services/sessions'
import type { SessionInfo } from '../stores/chatStore'

const TASK_TYPE_ICONS: Record<string, string> = {
  'data-analysis': '📊',
  'db-query': '🗄️',
  'data-collection': '🕷️',
}

const TASK_LABELS: Record<string, string> = {
  'data-analysis': '数据分析',
  'db-query': '数据库问数',
  'data-collection': '数据采集',
}

const AGENT_LABELS: Record<string, string> = {
  gen_report: '报告生成',
  gen_visual_report: '可视化报告',
  gen_visual_dashboard: '仪表盘生成',
  gen_sql: 'SQL 查询',
  gen_sql_summary: 'SQL 摘要',
  gen_table: '表格生成',
  gen_job: '任务编排',
  gen_skill: '技能构建',
  ask_metrics: '指标问答',
  semantic_modeling: '语义建模',
  explore: '数据探索',
}

function sessionTitle(s: SessionInfo): string {
  if (s.userQuery) return s.userQuery
  const prefix = s.sessionId.split('_session_')[0] || ''
  return AGENT_LABELS[prefix] || `会话 ${s.sessionId.slice(-6)}`
}

function sessionTaskLabel(s: SessionInfo): string {
  if (TASK_LABELS[s.taskType || '']) return TASK_LABELS[s.taskType || '']
  const prefix = s.sessionId.split('_session_')[0] || ''
  return AGENT_LABELS[prefix] || '对话'
}

function sessionIcon(s: SessionInfo): string {
  return TASK_TYPE_ICONS[s.taskType || ''] || '💬'
}

function formatSessionTime(s: SessionInfo): string {
  const ts = s.lastUpdated || s.createdAt
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export default function SessionsPage() {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterTask, setFilterTask] = useState<string>('all')

  useEffect(() => {
    loadSessions().then(list => {
      setSessions(list)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const filteredSessions = sessions.filter(s => {
    const matchesSearch = !searchTerm || s.userQuery.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesTask = filterTask === 'all' || s.taskType === filterTask
    return matchesSearch && matchesTask
  })

  const handleSessionClick = (session: SessionInfo) => {
    navigate(`/chat?session=${session.sessionId}`)
  }

  if (loading) {
    return (
      <div className="standalone-page">
        <div className="skeleton" style={{ width: 160, height: 28, marginBottom: 8 }} />
        <div className="skeleton-panel" style={{ marginTop: 8 }}>
          {[0, 1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div className="skeleton skeleton-line" style={{ width: '60%' }} />
                <div className="skeleton skeleton-line" style={{ width: '35%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="sessions-page">
      <div className="sessions-header">
        <h1>会话历史</h1>
        <p>查看所有对话记录和结果</p>
      </div>

      {/* Filters */}
      <div className="sessions-filters">
        <div className="sessions-search">
          <input
            type="text"
            className="sessions-search-input"
            placeholder="搜索任务内容..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="sessions-filter-tabs">
          <button
            className={`sessions-filter-tab${filterTask === 'all' ? ' active' : ''}`}
            onClick={() => setFilterTask('all')}
          >
            全部
          </button>
          {Object.entries(TASK_TYPE_ICONS).map(([key, icon]) => (
            <button
              key={key}
              className={`sessions-filter-tab${filterTask === key ? ' active' : ''}`}
              onClick={() => setFilterTask(key)}
            >
              {icon} {key}
            </button>
          ))}
        </div>
      </div>

      {/* Session List */}
      {filteredSessions.length === 0 ? (
        <div className="sessions-empty">
          <p>暂无历史任务</p>
          <button className="sessions-new-btn" onClick={() => navigate('/chat')}>
            开始新任务
          </button>
        </div>
      ) : (
        <div className="sessions-list">
          {filteredSessions.map(session => (
<div
                key={session.sessionId}
                className="sessions-item"
                onClick={() => handleSessionClick(session)}
              >
                <div className="sessions-item-icon">
                  {sessionIcon(session)}
                </div>
                <div className="sessions-item-content">
                  <div className="sessions-item-title">{sessionTitle(session)}</div>
                  <div className="sessions-item-meta">
                    <span className="sessions-item-task">{sessionTaskLabel(session)}</span>
                    <span className="sessions-item-time">
                      {formatSessionTime(session)}
                    </span>
                    <span className="sessions-item-turns">{session.totalTurns} 轮</span>
                  </div>
                </div>
                <div className="sessions-item-arrow">→</div>
              </div>
          ))}
        </div>
      )}
    </div>
  )
}