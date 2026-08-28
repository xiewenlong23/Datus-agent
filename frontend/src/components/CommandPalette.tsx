import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Search, History, Cable, Puzzle, Library,
  Settings, MessageSquare, Command, ArrowRight, Sparkles, Terminal,
} from 'lucide-react'

interface Command {
  id: string
  label: string
  description?: string
  icon?: React.ReactNode
  action: () => void
  keywords?: string[]
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()

  // Toggle on ⌘K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  const commands: Command[] = [
    {
      id: 'dashboard',
      label: '首页',
      description: '返回首页',
      icon: <LayoutDashboard size={15} />,
      action: () => { navigate('/dashboard'); setOpen(false) },
      keywords: ['home', 'dashboard', '首页'],
    },
    {
      id: 'new-chat',
      label: '新建对话',
      description: '开始一个新的对话',
      icon: <MessageSquare size={15} />,
      action: () => { navigate('/chat'); setOpen(false) },
      keywords: ['new', 'chat', '对话', '新建'],
    },
    {
      id: 'data-analysis',
      label: '数据分析',
      description: '进入数据分析任务',
      icon: <Sparkles size={15} />,
      action: () => { navigate('/chat?task=data-analysis'); setOpen(false) },
      keywords: ['data', 'analysis', '分析', '数据'],
    },
    {
      id: 'db-query',
      label: '数据库问数',
      description: '用自然语言查询数据库',
      icon: <Search size={15} />,
      action: () => { navigate('/chat?task=db-query'); setOpen(false) },
      keywords: ['db', 'database', 'sql', 'query', '数据库', '查询'],
    },
    {
      id: 'data-collection',
      label: '数据采集',
      description: '从网页采集结构化数据',
      icon: <Terminal size={15} />,
      action: () => { navigate('/chat?task=data-collection'); setOpen(false) },
      keywords: ['crawl', 'scrape', 'collect', '采集'],
    },
    {
      id: 'data-explorer',
      label: '数据探索',
      description: '浏览表结构、字段信息',
      icon: <Search size={15} />,
      action: () => { navigate('/data-explorer'); setOpen(false) },
      keywords: ['explore', 'browse', '探索', '浏览'],
    },
    {
      id: 'sessions',
      label: '会话历史',
      description: '查看所有对话记录',
      icon: <History size={15} />,
      action: () => { navigate('/sessions'); setOpen(false) },
      keywords: ['history', 'sessions', '历史', '会话'],
    },
    {
      id: 'data-connection',
      label: '数据源',
      description: '管理数据源连接',
      icon: <Cable size={15} />,
      action: () => { navigate('/data-connection'); setOpen(false) },
      keywords: ['datasource', 'connection', '数据源', '连接'],
    },
    {
      id: 'skill-shop',
      label: '技能市场',
      description: '浏览和管理技能',
      icon: <Puzzle size={15} />,
      action: () => { navigate('/skill-shop'); setOpen(false) },
      keywords: ['skills', 'market', '技能', '市场'],
    },
    {
      id: 'knowledge-base',
      label: '知识库',
      description: '搜索和构建知识库',
      icon: <Library size={15} />,
      action: () => { navigate('/knowledge-base'); setOpen(false) },
      keywords: ['kb', 'knowledge', '知识库'],
    },
    {
      id: 'settings',
      label: '设置',
      description: '配置模型、数据源和系统',
      icon: <Settings size={15} />,
      action: () => { navigate('/settings'); setOpen(false) },
      keywords: ['settings', 'config', '设置', '配置'],
    },
  ]

  const filtered = query.trim()
    ? commands.filter(c => {
        const q = query.toLowerCase()
        return c.label.toLowerCase().includes(q) ||
          c.description?.toLowerCase().includes(q) ||
          c.keywords?.some(k => k.toLowerCase().includes(q))
      })
    : commands

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIdx]) {
        filtered[selectedIdx].action()
      }
    }
  }

  const handleItemClick = useCallback((cmd: Command) => {
    cmd.action()
  }, [])

  if (!open) return null

  return (
    <div className="cmd-palette-overlay" onClick={() => setOpen(false)}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-palette-input-wrap">
          <Command size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="输入命令或搜索页面..."
            value={query}
            onChange={e => { setQuery(e.target.value); setSelectedIdx(0) }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="cmd-palette-kbd">ESC</kbd>
        </div>
        <div className="cmd-palette-list">
          {filtered.length === 0 ? (
            <div className="cmd-palette-empty">没有匹配的命令</div>
          ) : (
            filtered.map((cmd, i) => (
              <button
                key={cmd.id}
                className={`cmd-palette-item${i === selectedIdx ? ' active' : ''}`}
                onClick={() => handleItemClick(cmd)}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span className="cmd-palette-item-icon">{cmd.icon}</span>
                <div className="cmd-palette-item-info">
                  <div className="cmd-palette-item-label">{cmd.label}</div>
                  {cmd.description && (
                    <div className="cmd-palette-item-desc">{cmd.description}</div>
                  )}
                </div>
                <ArrowRight size={13} className="cmd-palette-item-arrow" />
              </button>
            ))
          )}
        </div>
        <div className="cmd-palette-footer">
          <span>
            <kbd>↑</kbd><kbd>↓</kbd> 导航
          </span>
          <span>
            <kbd>Enter</kbd> 确认
          </span>
        </div>
      </div>
    </div>
  )
}