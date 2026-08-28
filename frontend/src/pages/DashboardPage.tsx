import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Database, Bot, Library, ArrowRight, Sparkles, Globe, MessageSquare } from 'lucide-react'
import { DashboardSkeleton } from '../components/Skeleton'

interface SystemStatus {
  agentCount: number | null
  datasourceConnected: boolean | null
  datasourceCount: number | null
  modelCount: number | null
  kbBuilt: boolean | null
  kbTopicCount: number | null
  loading: boolean
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const [status, setStatus] = useState<SystemStatus>({
    agentCount: null,
    datasourceConnected: null,
    datasourceCount: null,
    modelCount: null,
    kbBuilt: null,
    kbTopicCount: null,
    loading: true,
  })

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/agent/list').then(r => r.json()).then(
        d => d.data?.agents?.length || 0
      ).catch(() => null),
      fetch('/api/v1/catalog/list').then(r => r.json()).then(d => {
        const dbs = d.data?.databases || []
        return {
          count: dbs.length,
          connected: dbs.some((db: any) => db.connection_status === 'connected'),
        }
      }).catch(() => ({ count: null, connected: null })),
      fetch('/api/v1/models').then(r => r.json()).then(
        d => d.data?.models?.length || 0
      ).catch(() => null),
      fetch('/api/v1/kb/topics').then(r => r.json()).then(d => {
        const topics = d.data?.topics || d.data || []
        return {
          built: Array.isArray(topics) && topics.length > 0,
          count: Array.isArray(topics) ? topics.length : 0,
        }
      }).catch(() => ({ built: null, count: null })),
    ]).then(([agentCount, dsInfo, modelCount, kbInfo]) => {
      setStatus({
        agentCount: agentCount as number | null,
        datasourceConnected: dsInfo ? (dsInfo as any).connected : null,
        datasourceCount: dsInfo ? (dsInfo as any).count : null,
        modelCount: modelCount as number | null,
        kbBuilt: (kbInfo as any)?.built ?? null,
        kbTopicCount: (kbInfo as any)?.count ?? null,
        loading: false,
      })
    })
  }, [])

  const coreScenarios = [
    {
      icon: MessageSquare,
      title: '对话查询',
      desc: '用自然语言提问，智能生成分析结果',
      path: '/chat?task=data-analysis',
      accent: '#06b6d4',
    },
    {
      icon: Database,
      title: '数据库问数',
      desc: '选好库表，用自然语言查询数据',
      path: '/chat?task=db-query',
      accent: '#10b981',
    },
    {
      icon: Globe,
      title: '数据采集',
      desc: '输入网址，自动采集结构化数据',
      path: '/chat?task=data-collection',
      accent: '#f59e0b',
    },
  ]

  const samplePrompts = [
    { text: '统计近30天各品类销售额和同比变化', task: 'data-analysis' },
    { text: '找出客户流失率最高的渠道和原因', task: 'db-query' },
    { text: '生成一份月度经营分析报告', task: 'data-analysis' },
    { text: '分析最近一周的异常订单', task: 'db-query' },
  ]

  return (
    <>
      {status.loading ? (
        <DashboardSkeleton />
      ) : (
    <div className="dashboard-page">
      <div className="dashboard-header">
        <h1>Datus Agent</h1>
        <p className="dashboard-subtitle">
          用自然语言与数据对话
        </p>
      </div>

      {/* System Status */}
      <div className="dashboard-section">
        <div className="dashboard-status">
          {/* Data Source Card */}
          <div className="dashboard-status-item" onClick={() => navigate('/data-connection')} style={{ cursor: 'pointer' }}>
            <span className="dashboard-status-label">
              <Database size={14} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent)' }} />
              数据源
            </span>
            <span className="dashboard-status-value">
              {status.loading ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>检查中…</span>
              ) : status.datasourceCount !== null ? (
                <>
                  <span className={`status-badge ${status.datasourceConnected ? 'connected' : 'warning'}`}>
                    {status.datasourceConnected ? '已连接' : '异常'}
                  </span>
                  <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {status.datasourceCount} 个
                  </span>
                </>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>未配置</span>
              )}
            </span>
          </div>

          {/* Agent Card */}
          <div className="dashboard-status-item" onClick={() => navigate('/settings')} style={{ cursor: 'pointer' }}>
            <span className="dashboard-status-label">
              <Bot size={14} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent)' }} />
              智能体
            </span>
            <span className="dashboard-status-value">
              {status.loading ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>检查中…</span>
              ) : status.agentCount !== null ? (
                <span>
                  <span className="status-badge connected">{status.agentCount} 个可用</span>
                  {status.modelCount !== null && (
                    <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {status.modelCount} 个模型
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>未知</span>
              )}
            </span>
          </div>

          {/* Knowledge Base Card */}
          <div className="dashboard-status-item" onClick={() => navigate('/knowledge-base')} style={{ cursor: 'pointer' }}>
            <span className="dashboard-status-label">
              <Library size={14} style={{ marginRight: 4, verticalAlign: -2, color: 'var(--accent)' }} />
              知识库
            </span>
            <span className="dashboard-status-value">
              {status.loading ? (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>检查中…</span>
              ) : status.kbBuilt !== null ? (
                <span>
                  <span className={`status-badge ${status.kbBuilt ? 'connected' : 'warning'}`}>
                    {status.kbBuilt ? '已构建' : '未构建'}
                  </span>
                  {status.kbTopicCount !== null && status.kbTopicCount > 0 && (
                    <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {status.kbTopicCount} 个主题
                    </span>
                  )}
                </span>
              ) : (
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>未知</span>
              )}
            </span>
          </div>
        </div>
      </div>

      {/* Quick Start - Core Scenarios */}
      <div className="dashboard-section">
        <h2 className="dashboard-section-title">快速开始</h2>
        <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {coreScenarios.map(scenario => (
            <div
              key={scenario.title}
              className="dashboard-card"
              style={{ '--card-color': scenario.accent } as React.CSSProperties}
              onClick={() => navigate(scenario.path)}
            >
              <div className="dashboard-card-icon">
                <scenario.icon size={24} style={{ color: scenario.accent }} />
              </div>
              <div className="dashboard-card-title">{scenario.title}</div>
              <div className="dashboard-card-desc">{scenario.desc}</div>
              <div className="dashboard-card-arrow"><ArrowRight size={16} /></div>
            </div>
          ))}
        </div>
      </div>

      {/* Sample Prompts */}
      <div className="dashboard-section">
        <h2 className="dashboard-section-title">试试这样问</h2>
        <div className="dashboard-prompts">
          {samplePrompts.map((p, i) => (
            <button
              key={i}
              className="dashboard-prompt-btn"
              onClick={() => navigate(`/chat?task=${p.task}`)}
            >
              <Sparkles size={13} style={{ marginRight: 6, verticalAlign: -2, opacity: 0.6 }} />
              {p.text}
            </button>
          ))}
        </div>
      </div>
    </div>
      )}
    </>
  )
}