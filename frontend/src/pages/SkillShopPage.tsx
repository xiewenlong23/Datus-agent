import { useEffect, useState } from 'react'
import CreateSkillModal from '../components/CreateSkillModal'

interface SkillInfo {
  name: string
  description: string
  tags: string[]
  version: string
  directory: string
  frontmatter: Record<string, unknown>
  userInvocable: boolean
  source: string // 'project' or 'user'
}

function fetchSkills(): Promise<SkillInfo[]> {
  return fetch('/api/v1/skills/list')
    .then(r => r.json())
    .then(d => (d.data?.skills || []).map((s: any) => ({
      name: s.name,
      description: s.description,
      tags: s.tags || [],
      version: s.version || '',
      directory: s.directory || '',
      frontmatter: s.frontmatter || {},
      userInvocable: s.frontmatter?.user_invocable || false,
      source: s.directory?.includes('/.datus/skills/') ? 'user' : 'project',
    })))
    .catch(() => [])
}

function fetchSkillDetail(name: string): Promise<SkillInfo | null> {
  return fetch(`/api/v1/skills/${encodeURIComponent(name)}`)
    .then(r => r.json())
    .then(d => {
      if (d.data) {
        return {
          ...d.data,
          userInvocable: d.data.frontmatter?.user_invocable || false,
          source: d.data.directory?.includes('/.datus/skills/') ? 'user' : 'project',
        }
      }
      return null
    })
    .catch(() => null)
}

function removeSkill(name: string): Promise<boolean> {
  return fetch('/api/v1/skills/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
    .then(r => r.json())
    .then(d => d.success)
    .catch(() => false)
}

function updateSkill(name: string): Promise<boolean> {
  return fetch('/api/v1/skills/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
    .then(r => r.json())
    .then(d => d.success)
    .catch(() => false)
}

function publishSkill(skillPath: string): Promise<boolean> {
  return fetch('/api/v1/skills/publish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill_path: skillPath }),
  })
    .then(r => r.json())
    .then(d => d.success)
    .catch(() => false)
}

/** Map skill name to a friendly emoji icon. */
function skillIcon(name: string): string {
  const lower = name.toLowerCase()
  if (lower.includes('kb') || lower.includes('knowledge') || lower.includes('build-kb')) return '📚'
  if (lower.includes('metric')) return '📐'
  if (lower.includes('semantic')) return '🧩'
  if (lower.includes('dashboard') || lower.includes('grafana') || lower.includes('bi-')) return '📊'
  if (lower.includes('migration') || lower.includes('transfer')) return '🔄'
  if (lower.includes('table')) return '🔧'
  if (lower.includes('init')) return '🚀'
  if (lower.includes('memory')) return '🧠'
  if (lower.includes('session')) return '🗂️'
  if (lower.includes('extract')) return '⛏️'
  if (lower.includes('scheduler') || lower.includes('airflow')) return '⏰'
  return '🛠️'
}

export default function SkillShopPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<SkillInfo | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // Show notification
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message })
    setTimeout(() => setNotification(null), 3000)
  }

  useEffect(() => {
    fetchSkills().then(list => {
      setSkills(list)
      setLoading(false)
    }).catch(() => {
      setError('加载技能列表失败')
      setLoading(false)
    })
  }, [])

  const handleSelect = (name: string) => {
    setDetailLoading(true)
    setSelected(null)
    fetchSkillDetail(name).then(detail => {
      setSelected(detail)
      setDetailLoading(false)
    }).catch(() => {
      setDetailLoading(false)
    })
  }

  const handleRemove = async (skillName: string) => {
    if (!confirm(`确定要移除 ${skillName} 吗？`)) return
    const success = await removeSkill(skillName)
    if (success) {
      showNotification('success', `已移除 ${skillName}`)
      const updated = await fetchSkills()
      setSkills(updated)
      setSelected(null)
    } else {
      showNotification('error', '移除失败')
    }
  }

  const handleUpdate = async (skillName: string) => {
    const success = await updateSkill(skillName)
    if (success) {
      showNotification('success', `已更新 ${skillName}`)
      const updated = await fetchSkills()
      setSkills(updated)
      if (selected?.name === skillName) {
        handleSelect(skillName)
      }
    } else {
      showNotification('error', '更新失败')
    }
  }

  const handlePublish = async () => {
    if (!selected) return
    const success = await publishSkill(selected.directory)
    if (success) {
      showNotification('success', `已发布 ${selected.name}`)
    } else {
      showNotification('error', '发布失败')
    }
  }

  if (error) {
    return (
      <div className="standalone-page">
        <p className="skill-shop-error">{error}</p>
      </div>
    )
  }
  if (loading) {
    return (
      <div className="standalone-page skill-shop">
        <div className="skill-shop-main">
          <div className="skill-shop-header">
            <div className="skeleton" style={{ width: 160, height: 28 }} />
            <div className="skeleton" style={{ width: 280, height: 14, marginTop: 8 }} />
          </div>
          <div className="skill-grid">
            {[0, 1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton" style={{ height: 150, borderRadius: 8 }} />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="standalone-page skill-shop">
      {/* Notification */}
      {notification && (
        <div className={`skill-notification ${notification.type}`}>
          {notification.message}
        </div>
      )}

      <div className="skill-shop-main">
        <div className="skill-shop-header">
          <h1>技能市场</h1>
          <p>浏览、创建和管理 Datus 技能，让 Agent 获得更强的数据工程能力</p>
          <div className="skill-shop-header-actions">
            <span className="skill-shop-count">共 {skills.length} 个技能</span>
            <button className="skill-create-btn" onClick={() => setShowCreateModal(true)}>
              + 创建技能
            </button>
          </div>
        </div>

        {/* Skill Grid */}
        <div className="skill-grid">
          {skills.map(skill => (
            <div
              key={skill.name}
              className="skill-card"
              onClick={() => handleSelect(skill.name)}
            >
              <div className="skill-card-icon">{skillIcon(skill.name)}</div>
              <div className="skill-card-title">{skill.name}</div>
              {skill.tags.length > 0 && (
                <div className="skill-card-tags">
                  {skill.tags.slice(0, 4).map((tag, i) => (
                    <span key={i} className="skill-tag">{tag}</span>
                  ))}
                </div>
              )}
              <div className="skill-card-desc">{skill.description.slice(0, 120)}...</div>
              <div className="skill-card-footer">
                <span className="skill-version">v{skill.version || '—'}</span>
                <span className={`skill-status ${skill.userInvocable ? '' : 'system'}`}>
                  {skill.userInvocable ? '可用' : '系统'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="skill-detail-panel">
          <div className="skill-detail-header">
            <h2>{skillIcon(selected.name)} {selected.name}</h2>
            <button className="icon-btn" onClick={() => setSelected(null)}>✕</button>
          </div>
          <p className="skill-detail-desc">{selected.description}</p>
          <div className="skill-detail-meta">
            <div><strong>版本:</strong> v{selected.version || '—'}</div>
            <div><strong>路径:</strong> {selected.directory}</div>
            <div><strong>来源:</strong> {selected.source === 'project' ? '项目内置' : '用户安装'}</div>
            <div><strong>状态:</strong> {selected.userInvocable ? '用户可调用的技能' : '系统内部技能'}</div>
          </div>
          {selected.tags.length > 0 && (
            <div className="skill-detail-tags">
              {selected.tags.map((tag, i) => (
                <span key={i} className="skill-tag">{tag}</span>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="skill-detail-actions">
            {selected.source === 'project' ? (
              <button className="skill-action-btn skill-action-update" onClick={() => handleUpdate(selected.name)}>
                更新版本
              </button>
            ) : (
              <>
                <button className="skill-action-btn skill-action-update" onClick={() => handleUpdate(selected.name)}>
                  更新
                </button>
                <button className="skill-action-btn skill-action-publish" onClick={handlePublish}>
                  发布到市场
                </button>
                <button className="skill-action-btn skill-action-remove" onClick={() => handleRemove(selected.name)}>
                  移除
                </button>
              </>
            )}
          </div>

          {selected.frontmatter && Object.keys(selected.frontmatter).length > 0 && (
            <div className="skill-detail-frontmatter">
              <strong>Frontmatter</strong>
              <pre>{JSON.stringify(selected.frontmatter, null, 2)}</pre>
            </div>
          )}
        </div>
      )}
      {detailLoading && (
        <div className="skill-detail-panel">
          <p>加载详情中...</p>
        </div>
      )}

      {showCreateModal && <CreateSkillModal onClose={() => setShowCreateModal(false)} onCreated={() => { fetchSkills().then(setSkills) }} />}
    </div>
  )
}