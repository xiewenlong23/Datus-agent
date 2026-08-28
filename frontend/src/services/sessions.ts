import api from './api'
import type { ChatMessage } from '../stores/chatStore'
import type { SessionInfo } from '../stores/chatStore'

export interface LoadSessionsOptions {
  subagentId?: string | null
  offset?: number
  limit?: number
}

export async function loadSessions(options: LoadSessionsOptions = {}): Promise<SessionInfo[]> {
  try {
    const params = new URLSearchParams()
    if (options.subagentId) params.set('subagent_id', options.subagentId)
    params.set('offset', String(options.offset ?? 0))
    params.set('limit', String(options.limit ?? 50))
    const response: any = await api.get(`/chat/sessions?${params.toString()}`)
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

/**
 * Pair call-tool-result blocks with their call-tool blocks across the whole
 * history (mirrors the original chatbot's attachCallToolResult): history
 * emits tool call and tool result as separate messages, so the result payload
 * is attached directly onto the call block as `resultPayload`.
 */
function attachCallToolResult(messages: ChatMessage[]): void {
  const blocks = messages.flatMap(m => m.content)
  for (const b of blocks) {
    if (b.type !== 'call-tool-result') continue
    const id = String(b.payload?.callToolId ?? '')
    if (!id) continue
    const call = blocks.find(
      c => c.type === 'call-tool' && String(c.payload?.callToolId ?? '') === id,
    )
    if (call) call.payload = { ...call.payload, resultPayload: b.payload }
  }
}

/**
 * Load full history for a session. The backend returns the same
 * SSEMessagePayload shape used by the stream, so content blocks
 * (thinking / call-tool / code ...) are preserved and replayed as-is.
 */
export async function getChatHistory(sessionId: string): Promise<ChatMessage[]> {
  try {
    const response: any = await api.get(`/chat/history?session_id=${encodeURIComponent(sessionId)}`)
    if (response.success && response.data?.messages) {
      const messages: ChatMessage[] = (response.data.messages as any[]).map((m, idx) => ({
        id: String(m.message_id ?? `hist-${idx}`),
        role: (m.role === 'user' ? 'user' : 'assistant') as ChatMessage['role'],
        content: (Array.isArray(m.content) ? m.content : []) as ChatMessage['content'],
        depth: m.depth ?? 0,
        parentActionId: m.parent_action_id ?? null,
        atContext: m.at_context ?? null,
        timestamp: m.created_at || '',
      }))
      attachCallToolResult(messages)
      return messages
    }
    return []
  } catch {
    return []
  }
}

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const response: any = await api.delete(`/chat/sessions/${encodeURIComponent(sessionId)}`)
    return response.success === true
  } catch {
    return false
  }
}
