import { create } from 'zustand'
import type {
  AtContextData,
  IMessageContent,
  SSEEndData,
  SSEMessageData,
  SSEMessagePayload,
  SSEUsageData,
} from '../types/chat'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: IMessageContent[]
  depth: number
  parentActionId?: string | null
  atContext?: AtContextData | null
  timestamp: string
}

export interface SessionInfo {
  sessionId: string
  userQuery: string
  taskType?: string
  createdAt: string
  lastUpdated: string
  totalTurns: number
}

export interface TurnUsage {
  requests: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens: number
  contextLength: number
  sessionTotalTokens: number
}

const EMPTY: ChatMessage[] = []

/** Key of the slice that back a null (new-chat) viewport. */
function viewKey(sessionId: string | null): string {
  return sessionId ?? ''
}

/** Content types whose payload.content is incrementally concatenated on appendMessage. */
const MERGEABLE_TYPES = new Set(['markdown', 'thinking', 'error'])

function sameCodeKind(a: IMessageContent, b: IMessageContent): boolean {
  return (a.payload?.codeType || a.payload?.code_type) === (b.payload?.codeType || b.payload?.code_type)
}

function appendBlocks(existing: IMessageContent[], incoming: IMessageContent[]): IMessageContent[] {
  const result = [...existing]
  for (const block of incoming) {
    const last = result[result.length - 1]
    const mergeable =
      last &&
      last.type === block.type &&
      (MERGEABLE_TYPES.has(block.type) || (block.type === 'code' && sameCodeKind(last, block))) &&
      typeof block.payload?.content === 'string'
    if (mergeable) {
      result[result.length - 1] = {
        ...last,
        payload: { ...last.payload, content: (last.payload.content || '') + block.payload.content },
      }
    } else {
      result.push(block)
    }
  }
  return result
}

function payloadToMessage(payload: SSEMessagePayload): ChatMessage {
  return {
    id: String(payload.message_id),
    role: payload.role === 'user' ? 'user' : 'assistant',
    content: Array.isArray(payload.content) ? payload.content : [],
    depth: payload.depth ?? 0,
    parentActionId: payload.parent_action_id ?? null,
    atContext: payload.at_context ?? null,
    timestamp: new Date().toISOString(),
  }
}

function applyMessageOp(messages: ChatMessage[], op: SSEMessageData): ChatMessage[] {
  const { type, payload } = op
  if (!payload || payload.message_id == null) return messages
  const id = String(payload.message_id)
  const idx = messages.findIndex(m => m.id === id)

  if (type === 'createMessage') {
    if (idx >= 0) return messages
    // Adopt the server-side id for an optimistically added user message
    // (or a history user bubble re-emitted by a replay) instead of rendering
    // a duplicate bubble.
    if (payload.role === 'user') {
      const last = messages[messages.length - 1]
      const serverText = (payload.content || []).map(b => b.payload?.content || '').join('')
      if (last?.role === 'user') {
        const localText = last.content.map(b => b.payload?.content || '').join('')
        if (!serverText || localText.trim() === serverText.trim()) {
          const copy = [...messages]
          copy[copy.length - 1] = { ...last, id, content: payload.content?.length ? payload.content : last.content }
          return copy
        }
      }
    }
    return [...messages, payloadToMessage(payload)]
  }

  if (type === 'appendMessage') {
    if (idx < 0) return [...messages, payloadToMessage(payload)]
    const target = messages[idx]
    const next = { ...target, content: appendBlocks(target.content, payload.content || []) }
    const copy = [...messages]
    copy[idx] = next
    return copy
  }

  // updateMessage: replace the full content of the message
  if (idx < 0) return [...messages, payloadToMessage(payload)]
  const copy = [...messages]
  copy[idx] = { ...messages[idx], content: Array.isArray(payload.content) ? payload.content : [] }
  return copy
}

function withErrorBlock(messages: ChatMessage[], errMsg: string): ChatMessage[] {
  const errorBlock: IMessageContent = { type: 'error', payload: { content: errMsg } }
  const last = messages[messages.length - 1]
  if (last && last.role === 'assistant') {
    const copy = [...messages]
    copy[copy.length - 1] = { ...last, content: appendBlocks(last.content, [errorBlock]) }
    return copy
  }
  return [
    ...messages,
    {
      id: `error-${Date.now()}`,
      role: 'assistant' as const,
      content: [errorBlock],
      depth: 0,
      timestamp: new Date().toISOString(),
    },
  ]
}

interface ChatState {
  // ── Viewport (the session the user is looking at) ──────────────────────
  sessionId: string | null
  setSessionId: (id: string | null) => void
  /** Mirror of the viewport slice — kept in sync by the slice writers below. */
  messages: ChatMessage[]
  /** Mirror of streamingSessions[viewport]. */
  isStreaming: boolean
  /** Mirror of turnUsageBySession[viewport]. */
  turnUsage: TurnUsage | null
  /** Mirror of turnDurationBySession[viewport]. */
  turnDuration: number | null

  // ── Per-session slices (single source of truth) ────────────────────────
  // Keyed by session id; '' is the not-yet-named new chat. Slices of
  // background sessions keep updating while the user views another session.
  sessionCaches: Record<string, ChatMessage[]>
  streamingSessions: Record<string, boolean>
  turnUsageBySession: Record<string, TurnUsage>
  turnDurationBySession: Record<string, number | null>

  addMessage: (message: ChatMessage) => void
  /** Replace a slice wholesale (history load). */
  setMessagesFor: (key: string, messages: ChatMessage[]) => void
  /** Reset the not-yet-named new-chat slice and viewport. */
  clearNewChat: () => void

  /**
   * Single entry point for every SSE frame. *targetKey* is the session the
   * event belongs to (the subscription owns the routing) — events for
   * background sessions update their own slice without touching the viewport.
   */
  applySSEEvent: (targetKey: string, event: string, data: any) => void

  /**
   * Drop the (partially persisted) tail of the current turn so a from-event-0
   * replay can rebuild it without duplicating what history already showed.
   * The turn's own user bubble (the last root user message) is kept.
   */
  beginTurnReplay: (key: string) => void

  setSessionStreaming: (key: string, on: boolean) => void

  // ── Current task type sent along with stream requests ──────────────────
  currentTaskType: string | null
  setCurrentTaskType: (type: string | null) => void

  // ── Session history list (left panel) ──────────────────────────────────
  sessions: SessionInfo[]
  setSessions: (sessions: SessionInfo[]) => void
  prependSession: (session: SessionInfo) => void
  removeSession: (sessionId: string) => void
  /** Bumped whenever the session list should be refetched. */
  sessionListVersion: number

  // ── Output options / toolbar selections ────────────────────────────────
  outputOptions: Record<string, string>
  setOutputOption: (key: string, value: string) => void
  resetOutputOptions: () => void

  selectedAgent: string | null
  setSelectedAgent: (agent: string | null) => void
  selectedDatasource: string | null
  setSelectedDatasource: (ds: string | null) => void
  selectedModel: string | null
  setSelectedModel: (model: string | null) => void
  planMode: boolean
  setPlanMode: (enabled: boolean) => void
}

/** Apply fn to the slice at *key*, keeping the viewport mirror in sync. */
function slicePatch(
  state: ChatState,
  key: string,
  fn: (msgs: ChatMessage[]) => ChatMessage[],
): Partial<ChatState> {
  const cur = state.sessionCaches[key] || EMPTY
  const next = fn(cur)
  if (next === cur) return {}
  const patch: Partial<ChatState> = { sessionCaches: { ...state.sessionCaches, [key]: next } }
  if (viewKey(state.sessionId) === key) patch.messages = next
  return patch
}

function streamingPatch(state: ChatState, key: string, on: boolean): Partial<ChatState> {
  if (!!state.streamingSessions[key] === on) return {}
  const patch: Partial<ChatState> = { streamingSessions: { ...state.streamingSessions, [key]: on } }
  if (viewKey(state.sessionId) === key) patch.isStreaming = on
  return patch
}

export const useChatStore = create<ChatState>((set) => ({
  sessionId: null,
  setSessionId: (id) =>
    set(state => {
      const key = viewKey(id)
      return {
        sessionId: id,
        messages: state.sessionCaches[key] || EMPTY,
        isStreaming: !!state.streamingSessions[key],
        turnUsage: state.turnUsageBySession[key] ?? null,
        turnDuration: state.turnDurationBySession[key] ?? null,
      }
    }),
  messages: EMPTY,
  isStreaming: false,
  turnUsage: null,
  turnDuration: null,

  sessionCaches: {},
  streamingSessions: {},
  turnUsageBySession: {},
  turnDurationBySession: {},

  addMessage: (message) =>
    set(state => slicePatch(state, viewKey(state.sessionId), msgs => [...msgs, message])),

  setMessagesFor: (key, messages) =>
    set(state => {
      const patch: Partial<ChatState> = { sessionCaches: { ...state.sessionCaches, [key]: messages } }
      if (viewKey(state.sessionId) === key) patch.messages = messages
      return patch
    }),

  clearNewChat: () =>
    set(state => {
      const caches = { ...state.sessionCaches }
      delete caches['']
      const streaming = { ...state.streamingSessions }
      delete streaming['']
      return {
        sessionCaches: caches,
        streamingSessions: streaming,
        sessionId: null,
        messages: EMPTY,
        isStreaming: false,
        turnUsage: null,
        turnDuration: null,
      }
    }),

  applySSEEvent: (targetKey, event, data) =>
    set(state => {
      const key = targetKey
      switch (event) {
        case 'session': {
          const sid = data?.session_id
          if (!sid || sid === key) return {}
          // A new chat just received its server-assigned id: rename the
          // slice (and the viewport, if that's what's showing it).
          const caches = { ...state.sessionCaches }
          if (caches[key]) {
            caches[sid] = caches[key]
            delete caches[key]
          }
          const streaming = { ...state.streamingSessions }
          if (streaming[key]) {
            streaming[sid] = true
            delete streaming[key]
          }
          const patch: Partial<ChatState> = {
            sessionCaches: caches,
            streamingSessions: streaming,
            sessionListVersion: state.sessionListVersion + 1,
          }
          if (viewKey(state.sessionId) === key) {
            patch.sessionId = sid
            patch.messages = caches[sid]
          }
          return patch
        }
        case 'message':
          return slicePatch(state, key, msgs => applyMessageOp(msgs, data as SSEMessageData))
        case 'usage': {
          const u = data as SSEUsageData
          if (u.depth && u.depth > 0) return {}
          const tu: TurnUsage = {
            requests: u.requests ?? 0,
            inputTokens: u.input_tokens ?? 0,
            outputTokens: u.output_tokens ?? 0,
            totalTokens: u.total_tokens ?? 0,
            cachedTokens: u.cached_tokens ?? 0,
            contextLength: u.context_length ?? 0,
            sessionTotalTokens: u.last_call_input_tokens ?? 0,
          }
          const patch: Partial<ChatState> = {
            turnUsageBySession: { ...state.turnUsageBySession, [key]: tu },
          }
          if (viewKey(state.sessionId) === key) patch.turnUsage = tu
          return patch
        }
        case 'end': {
          const e = data as SSEEndData
          const tu: TurnUsage = {
            requests: e.requests ?? 0,
            inputTokens: e.input_tokens ?? 0,
            outputTokens: e.output_tokens ?? 0,
            totalTokens: e.total_tokens ?? 0,
            cachedTokens: e.cached_tokens ?? 0,
            contextLength: e.context_length ?? 0,
            sessionTotalTokens: e.session_total_tokens ?? 0,
          }
          const patch: Partial<ChatState> = {
            ...streamingPatch(state, key, false),
            turnUsageBySession: { ...state.turnUsageBySession, [key]: tu },
            turnDurationBySession: { ...state.turnDurationBySession, [key]: e.duration ?? null },
            sessionListVersion: state.sessionListVersion + 1,
          }
          if (viewKey(state.sessionId) === key) {
            patch.turnUsage = tu
            patch.turnDuration = e.duration ?? null
          }
          return patch
        }
        case 'error': {
          const base = slicePatch(state, key, msgs => withErrorBlock(msgs, data?.error || 'Unknown error'))
          return {
            ...base,
            ...streamingPatch(state, key, false),
            sessionListVersion: state.sessionListVersion + 1,
          }
        }
        default:
          return {}
      }
    }),

  beginTurnReplay: key =>
    set(state => {
      const cur = state.sessionCaches[key] || EMPTY
      let cut = cur.length
      for (let i = cur.length - 1; i >= 0; i--) {
        if (cur[i].role === 'user' && cur[i].depth === 0) {
          cut = i + 1
          break
        }
      }
      if (cut >= cur.length) return {}
      return slicePatch(state, key, () => cur.slice(0, cut))
    }),

  setSessionStreaming: (key, on) => set(state => streamingPatch(state, key, on)),

  currentTaskType: null,
  setCurrentTaskType: (type) => set({ currentTaskType: type }),

  sessions: [],
  setSessions: (sessions) => set({ sessions }),
  prependSession: (session) =>
    set(state => ({
      sessions: [session, ...state.sessions.filter(s => s.sessionId !== session.sessionId)],
    })),
  removeSession: (sessionId) =>
    set(state => ({ sessions: state.sessions.filter(s => s.sessionId !== sessionId) })),
  sessionListVersion: 0,

  outputOptions: {},
  setOutputOption: (key, value) => set(state => ({
    outputOptions: { ...state.outputOptions, [key]: value },
  })),
  resetOutputOptions: () => set({ outputOptions: {} }),

  selectedAgent: null,
  setSelectedAgent: (agent) => set({ selectedAgent: agent }),
  selectedDatasource: null,
  setSelectedDatasource: (ds) => set({ selectedDatasource: ds }),
  selectedModel: null,
  setSelectedModel: (model) => set({ selectedModel: model }),
  planMode: false,
  setPlanMode: (enabled) => set({ planMode: enabled }),
}))
