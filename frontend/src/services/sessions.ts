import api from './api'
import type { ChatMessage, SessionInfo } from '../stores/chatStore'

export async function loadSessions(): Promise<SessionInfo[]> {
  try {
    const response: any = await api.get('/chat/sessions')
    if (response.success && response.data?.sessions) {
      return response.data.sessions.map((s: any) => ({
        sessionId: s.session_id,
        userQuery: s.user_query || '',
        taskType: s.task_type || '',
        createdAt: s.created_at || '',
        lastUpdated: s.last_updated || '',
        totalTurns: s.total_turns || 0,
      }))
    }
    return []
  } catch {
    return []
  }
}

export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  try {
    const response: any = await api.get(`/chat/history?session_id=${sessionId}`)
    if (response.success && response.data?.messages) {
      return response.data.messages.map((m: any) => ({
        id: m.message_id || `msg-${Date.now()}`,
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content || [],
        timestamp: m.created_at || new Date().toISOString(),
      }))
    }
    return []
  } catch {
    return []
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const response: any = await api.delete(`/chat/sessions/${sessionId}`)
    return response.success === true
  } catch {
    return false
  }
}