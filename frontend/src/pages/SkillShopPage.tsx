import { useEffect, useState } from 'react'

interface SkillInfo {
  name: string
  description: string
  tags: string[]
  version: string
  directory: string
  frontmatter: Record<string, unknown>
}

interface SkillDetail extends SkillInfo {
  frontmatter: Record<string, unknown>
}

function fetchSkills(): Promise<SkillInfo[]> {
  return fetch('/api/v1/skills/list')
    .then(r => r.json())
    .then(d => (d.data?.skills || []))
    .catch(() => [])
}

function fetchSkillDetail(name: string): Promise<SkillDetail | null> {
  return fetch(`/api/v1/skills/${encodeURIComponent(name)}`)
    .then(r => r.json())
    .then(d => d.data || null)
    .catch(() => null)
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
  const [selected, setSelected] = useState<SkillDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

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

  if (loading) {
    return (
      <div className="standalone-page">
        <p>技能加载中...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="standalone-page">
        <h1>技能市场</h1>
        <p style={{ color: 'var(--danger)' }}>{error}</p>
      </div>
    )
  }

  return (
    <div className="standalone-page skill-shop">
      <div className="skill-shop-main">
        <div className="skill-shop-header">
          <h1>技能市场</h1>
          <p>浏览可复用的 Datus 技能，让 Agent 获得更强的数据工程能力</p>
          <p className="skill-shop-count">共 {skills.length} 个技能</p>
        </div>

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
                <span className="skill-status">可用</span>
              </div>
            </div>
          ))}
        </div>
      </div>

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
          </div>
          {selected.tags.length > 0 && (
            <div className="skill-detail-tags">
              {selected.tags.map((tag, i) => (
                <span key={i} className="skill-tag">{tag}</span>
              ))}
            </div>
          )}
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
    </div>
  )
}