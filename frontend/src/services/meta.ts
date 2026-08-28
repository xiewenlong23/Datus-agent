import api from './api'

export interface AgentInfo {
  id: string
  name: string
  type: string
  description: string
}

export interface CatalogInfo {
  name: string
  type?: string
  description?: string
}

export interface ModelInfo {
  provider: string
  id: string
  model: string
  name?: string
  context_length?: number
}

export async function fetchAgents(): Promise<AgentInfo[]> {
  try {
    const d: any = await api.get('/agent/list')
    return (d.data?.agents || []).map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      description: a.description || '',
    }))
  } catch {
    return []
  }
}

export async function fetchCatalogs(): Promise<CatalogInfo[]> {
  try {
    const d: any = await api.get('/catalog/list')
    const dbs = d.data?.databases || []
    if (Array.isArray(dbs)) {
      return dbs.map((db: any) => ({
        name: db.name || String(db),
        type: db.type,
        description: db.description,
      }))
    }
    return []
  } catch {
    return []
  }
}

export async function fetchModels(): Promise<{ models: ModelInfo[]; current: string }> {
  try {
    const d: any = await api.get('/models')
    return {
      models: (d.data?.models || []).map((m: any) => ({
        provider: m.provider,
        id: m.id,
        model: m.model,
        name: m.name,
        context_length: m.context_length,
      })),
      current: d.data?.current_model || '',
    }
  } catch {
    return { models: [], current: '' }
  }
}

export async function saveSuccessStory(input: {
  session_id: string
  sql: string
  user_message: string
  subagent_id?: string
  session_link?: string
}): Promise<{ csvPath: string } | null> {
  try {
    const d: any = await api.post('/success-stories', input)
    if (d.success) return { csvPath: d.data?.csv_path || '' }
    return null
  } catch {
    return null
  }
}
