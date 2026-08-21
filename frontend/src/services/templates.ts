import api from './api'
import type { TaskTemplate } from '../stores/chatStore'

export async function fetchTemplates(): Promise<TaskTemplate[]> {
  const response: any = await api.post('/templates/list')
  return response.data?.templates || []
}

export async function fetchTemplate(id: string): Promise<TaskTemplate | null> {
  try {
    const response: any = await api.get(`/templates/${id}`)
    return response.data || null
  } catch {
    return null
  }
}