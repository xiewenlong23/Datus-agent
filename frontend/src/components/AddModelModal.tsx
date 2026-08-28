import { useEffect, useState } from 'react'

const PROVIDERS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'claude', label: 'Anthropic Claude' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'qwen', label: 'Qwen 通义' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'zhipu', label: 'Zhipu' },
  { value: 'custom', label: '自定义（OpenAI 兼容）' },
]

const MODEL_PRESETS: Record<string, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  claude: ['claude-sonnet-4-20250514', 'claude-3-5-sonnet-20241022', 'claude-3-7-sonnet-20250219', 'claude-3-5-haiku-20241022'],
  kimi: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
  qwen: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen2.5-72b-instruct'],
  minimax: ['abab6.5s-chat', 'abab6.5-chat'],
  glm: ['glm-4', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  zhipu: ['glm-4', 'glm-4-plus', 'glm-4-air', 'glm-4-flash'],
  custom: [],
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  deepseek: 'https://api.deepseek.com/v1',
  claude: 'https://api.anthropic.com',
  kimi: 'https://api.moonshot.cn/v1',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  minimax: 'https://api.minimaxi.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  zhipu: 'https://open.bigmodel.cn/api/paas/v4',
}

interface EditableModel {
  name: string
  type: string
  model: string
  api_key?: string
  base_url?: string
  isDefault: boolean
}

interface Props {
  onClose: () => void
  onSaved: () => void
  /** 传入要编辑的模型则进入编辑模式 */
  editModel?: EditableModel | null
}

export default function AddModelModal({ onClose, onSaved, editModel }: Props) {
  const isEdit = !!editModel
  // 编辑模式：仅当 type 是预设供应商且模型名在预设列表中时回显对应供应商，否则按自定义处理
  const initialProvider = (() => {
    if (!editModel) return 'openai'
    const known = PROVIDERS.some(p => p.value === editModel.type) ? editModel.type : 'custom'
    if (known !== 'custom' && (MODEL_PRESETS[known] || []).includes(editModel.model)) return known
    return 'custom'
  })()
  const [name, setName] = useState(editModel?.name || '')
  const [provider, setProvider] = useState(initialProvider)
  const [model, setModel] = useState(editModel?.model || '')
  const [apiKey, setApiKey] = useState(editModel?.api_key || '')
  const [baseUrl, setBaseUrl] = useState(editModel?.base_url || DEFAULT_BASE_URLS.openai)
  const [makeDefault, setMakeDefault] = useState(editModel?.isDefault || false)

  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    // 编辑模式下用户已填了 base_url，切换供应商时不覆盖
    if (!isEdit) setBaseUrl(DEFAULT_BASE_URLS[provider] || '')
  }, [provider])

  // Esc 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const providerPicked = provider !== 'custom'

  const buildConfig = () => {
    const cfg: Record<string, unknown> = {
      // 编辑自定义类型模型且未选预设供应商时，保持原有 type 不变
      type: providerPicked ? provider : (editModel?.type || 'openai'),
      model,
      api_key: apiKey || undefined,
    }
    if (baseUrl.trim()) cfg.base_url = baseUrl.trim()
    return cfg
  }

  const handleTest = async () => {
    if (!model) { setError('请填写模型名称'); return }
    setError('')
    setFeedback(null)
    setTesting(true)
    try {
      const res = await fetch('/api/v1/config/models/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildConfig()),
      })
      const data = await res.json()
      const inner = data?.data ?? {}
      if (inner.ok) {
        setFeedback({ ok: true, message: '✅ 连接成功，模型可用' })
      } else {
        setFeedback({ ok: false, message: `❌ 连接失败：${inner.message || '未知错误'}` })
      }
    } catch {
      setFeedback({ ok: false, message: '❌ 无法连接到测试接口，请检查服务是否在运行' })
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('请填写模型名称'); return }
    if (!apiKey) { setError('请填写 API Key'); return }
    setError('')
    setSaving(true)
    try {
      // 读取现有配置，新增或覆盖后全量写回
      const cfgRes = await fetch('/api/v1/config/agent')
      const cfgData = await cfgRes.json()
      const existing: Record<string, unknown> = cfgData?.data?.models || {}
      const currentTarget: string | null = cfgData?.data?.target || null
      const oldName = editModel?.name
      const trimmed = name.trim()

      const newModels: Record<string, unknown> = { ...existing, [trimmed]: buildConfig() }
      // 编辑模式下改了别名：移除旧 key
      if (oldName && oldName !== trimmed) delete newModels[oldName]

      const payload: Record<string, unknown> = { models: newModels }
      if (oldName && oldName !== trimmed && currentTarget === oldName) {
        // 默认模型被改名，target 跟随新名，避免悬空
        payload.target = trimmed
      } else if (makeDefault || Object.keys(existing).length === 0) {
        payload.target = trimmed
      }

      const res = await fetch('/api/v1/config/models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data?.success) {
        onSaved()
        onClose()
      } else {
        setError(data?.errorMessage || '保存失败，请重试')
      }
    } catch {
      setError('保存失败，请检查服务连接')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? '✏️ 修改 LLM 模型' : '➕ 添加 LLM 模型'}</h2>
          <button className="modal-close" onClick={onClose} aria-label="关闭">✕</button>
        </div>

        <div className="form-group">
          <label>模型名称 <span className="form-optional">（自己起的名字，如 gpt-4o-主模型）</span></label>
          <input
            className="form-input"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="例如 prod-gpt4o"
          />
          {isEdit && (
            <div className="form-hint">可修改别名；默认模型改名后仍保持默认</div>
          )}
        </div>

        <div className="form-group">
          <label>供应商</label>
          <select className="form-select" value={provider} onChange={e => setProvider(e.target.value)}>
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>模型名称（模型标识，如 gpt-4o）</label>
          <input
            className="form-input"
            list={`model-presets-${provider}`}
            value={model}
            onChange={e => setModel(e.target.value)}
            placeholder="例如 gpt-4o（可从下拉选择或手动输入）"
          />
          <datalist id={`model-presets-${provider}`}>
            {(MODEL_PRESETS[provider] || []).map(m => <option key={m} value={m} />)}
          </datalist>
        </div>

        <div className="form-group">
          <label>API Key</label>
          <input
            className="form-input"
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="sk-..."
          />
          <div className="form-hint">保存到服务端配置文件，仅需配置一次</div>
        </div>

        {(provider === 'custom' || isEdit) && (
          <div className="form-group">
            <label>Base URL <span className="form-optional">（可选）</span></label>
            <input
              className="form-input"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://your-endpoint/v1"
            />
          </div>
        )}

        <div className="form-group">
          <label className="form-checkbox">
            <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />
            设为默认模型（无已有默认模型时自动启用）
          </label>
        </div>

        {error && <div className="form-error">{error}</div>}
        {feedback && (
          <div className={`test-feedback ${feedback.ok ? 'success' : 'failure'}`}>
            {feedback.message}
          </div>
        )}

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={handleTest} disabled={testing || saving}>
            {testing && <span className="spinner" />}
            测试连接
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || testing}>
            {saving && <span className="spinner" />}
            {isEdit ? '保存修改' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}