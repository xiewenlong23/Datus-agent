import { useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useChatStore, type SessionInfo } from '../stores/chatStore'
import { loadSessions } from '../services/sessions'

const NAV_ITEMS = [
  { to: '/chat', label: 'New Task', icon: '✚' },
  { to: '/data-connection', label: 'Data Connection', icon: '🔌' },
  { to: '/skill-shop', label: 'Skill Shop', icon: '🛍️' },
  { to: '/knowledge-base', label: 'Knowledge Base', icon: '📚' },
]

const TASK_TYPE_ICONS: Record<string, string> = {
  'contract-review': '📄',
  'contract-writing': '✏️',
  'data-analysis': '📊',
  'db-query': '🗄️',
  'data-collection': '🕷️',
}

export default function Sidebar() {
  const navigate = useNavigate()
  const { sessions, setSessions, sessionId, setCurrentTaskType } = useChatStore()

  useEffect(() => {
    loadSessions().then(sessions => {
      setSessions(sessions)
    }).catch(() => {
      // Silently fail for now; sessions will retry on demand
    })
  }, [setSessions])

  const handleSessionClick = (session: SessionInfo) => {
    if (session.taskType) {
      setCurrentTaskType(session.taskType)
    }
    navigate(`/chat?session=${session.sessionId}`)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img className="sidebar-logo-img" src="/favicon.svg" alt="Datus" />
        <span>Datus</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-link-icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.label === 'New Task' && <span className="sidebar-badge">⌘K</span>}
          </NavLink>
        ))}
      </nav>

      <hr className="sidebar-separator" />
      <div className="sidebar-section-title">All Tasks</div>

      <div className="sidebar-sessions">
        {sessions.length === 0 ? (
          <div className="session-empty">暂无历史任务</div>
        ) : (
          sessions.map(session => (
            <div
              key={session.sessionId}
              className={`session-item${session.sessionId === sessionId ? ' active' : ''}`}
              onClick={() => handleSessionClick(session)}
            >
              <span className="session-item-type">
                {TASK_TYPE_ICONS[session.taskType || ''] || '💬'}
              </span>
              <span className="session-item-text">{session.userQuery}</span>
            </div>
          ))
        )}
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">👤</div>
        <div>
          <div className="sidebar-user-name">User</div>
          <div className="sidebar-user-status">未登录</div>
        </div>
      </div>
    </aside>
  )
}