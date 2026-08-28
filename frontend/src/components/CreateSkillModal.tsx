import { useState } from 'react'

interface CreateSkillModalProps {
  onClose: () => void
  onCreated: () => void
}

export default function CreateSkillModal({ onClose, onCreated }: CreateSkillModalProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [prompt, setPrompt] = useState('')
  const [version, setVersion] = useState('1.0.0')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    if (!name.trim()) { setError('请填写技能名称'); return }
    if (!prompt.trim()) { setError('请填写技能指令内容'); return }
    setError('')

    const tagList = tags
      .split(/[,，\s]+/)
      .map(t => t.trim())
      .filter(Boolean)

    setCreating(true)
    try {
      const res = await fetch('/api/v1/skills/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          prompt: prompt.trim(),
          tags: tagList,
          version: version.trim() || '1.0.0',
        }),
      })
      const data = await res.json()
      if (data?.success) {
        onCreated()
        onClose()
      } else {
        setError(data?.errorMessage || data?.detail || '创建失败，请重试')
      }
    } catch {
      setError('创建失败，请检查服务连接')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🛠️ 创建技能</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="form-group">
          <label>技能名称</label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如 my-custom-skill（字母数字下划线连字符）"
          />
        </div>

        <div className="form-group">
          <label>描述</label>
          <input
            className="form-input"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="一句话描述这个技能能做什么"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>标签（逗号分隔）</label>
            <input
              className="form-input"
              value={tags}
              onChange={e => setTags(e.target.value)}
              placeholder="data-engineering, analysis"
            />
          </div>
          <div className="form-group">
            <label>版本</label>
            <input
              className="form-input"
              value={version}
              onChange={e => setVersion(e.target.value)}
              placeholder="1.0.0"
            />
          </div>
        </div>

        <div className="form-group">
          <label>指令内容（告诉 Agent 如何使用这个技能）</label>
          <textarea
            className="form-input form-textarea"
            rows={10}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder={'请描述触发时机和使用步骤，例如：\n\n当用户需要统计每日销售额时：\n1. 查询订单明细表\n2. 按日期分组汇总金额\n3. 输出趋势图'}
          />
        </div>

        {error && <div className="form-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose} disabled={creating}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
            {creating && <span className="spinner" />}
            创建
          </button>
        </div>
      </div>
    </div>
  )
}