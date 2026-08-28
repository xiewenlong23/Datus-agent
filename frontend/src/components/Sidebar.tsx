import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Plus, Puzzle, Library,
  Settings, PanelLeftClose, PanelLeftOpen, Sun, Moon, LogOut,
} from 'lucide-react'
import SessionListPanel from './chat/SessionListPanel'
import { useThemeStore } from '../stores/themeStore'
import { useUserStore } from '../stores/userStore'
import { logout } from '../services/auth'

const NAV_ITEMS = [
  { to: '/dashboard', label: '首页', icon: LayoutDashboard },
  { to: '/chat', label: '新建任务', icon: Plus },
  { to: '/skill-shop', label: '技能市场', icon: Puzzle },
  { to: '/knowledge-base', label: '知识库', icon: Library },
  { to: '/settings', label: '设置', icon: Settings },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const { theme, toggle } = useThemeStore()
  const { feishuEnabled, user, clear } = useUserStore()
  const loggedIn = feishuEnabled && !!user

  const handleLogout = async () => {
    await logout()
    clear()
  }

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
      <div className="sidebar-top">
        <div className="sidebar-logo">
          <img className="sidebar-logo-img" src="/favicon.svg" alt="Datus" />
          <span>Datus</span>
        </div>
        <button
          className="sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <span className="sidebar-link-icon">
              <item.icon size={16} strokeWidth={1.8} />
            </span>
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-sessions">
        <SessionListPanel />
      </div>

      <div className="sidebar-user">
        {loggedIn && user!.avatar_url ? (
          <img className="sidebar-user-avatar sidebar-user-avatar-img" src={user!.avatar_url} alt="" />
        ) : (
          <div className="sidebar-user-avatar">{loggedIn ? (user!.name || 'U').slice(0, 1).toUpperCase() : 'U'}</div>
        )}
        {!collapsed && (
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{loggedIn ? user!.name || 'User' : 'User'}</div>
            <div className="sidebar-user-status">{loggedIn ? '飞书' : 'local'}</div>
          </div>
        )}
        {!collapsed && (
          <div className="sidebar-user-settings">
            <button
              onClick={toggle}
              title={theme === 'dark' ? '切换为白天模式' : '切换为夜间模式'}
              aria-label={theme === 'dark' ? '切换为白天模式' : '切换为夜间模式'}
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <button
              onClick={() => navigate('/settings')}
              title="设置"
              aria-label="设置"
            >
              <Settings size={15} />
            </button>
            {loggedIn && (
              <button
                onClick={() => void handleLogout()}
                title="退出登录"
                aria-label="退出登录"
              >
                <LogOut size={15} />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
