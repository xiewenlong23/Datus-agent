import { create } from 'zustand'

export interface OutputOptionValue {
  value: string
  label: string
}

export interface OutputOptionGroup {
  key: string
  label: string
  options: OutputOptionValue[]
}

export interface QuickAction {
  title: string
  tags: string[]
  description: string
  prompt: string
}

export interface TaskTemplate {
  id: string
  name: string
  description: string
  heading: string
  subtitle: string
  inputPlaceholder: string
  fileUpload: boolean
  outputOptions: OutputOptionGroup[]
  quickActions: QuickAction[]
}

export interface MessageContent {
  type: 'markdown' | 'sql' | 'table' | 'tool_call'
  payload: Record<string, unknown>
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: MessageContent[]
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

interface ChatState {
  // Current task
  currentTaskType: string | null
  setCurrentTaskType: (type: string) => void

  // Templates
  templates: TaskTemplate[]
  setTemplates: (templates: TaskTemplate[]) => void

  // Chat session
  sessionId: string | null
  setSessionId: (id: string | null) => void
  messages: ChatMessage[]
  addMessage: (message: ChatMessage) => void
  appendToLastMessage: (text: string) => void
  clearMessages: () => void
  isStreaming: boolean
  setIsStreaming: (streaming: boolean) => void

  setMessages: (messages: ChatMessage[]) => void

  // Session history
  sessions: SessionInfo[]
  setSessions: (sessions: SessionInfo[]) => void

  // Output options
  outputOptions: Record<string, string>
  setOutputOption: (key: string, value: string) => void
  resetOutputOptions: () => void

  // Toolbar selections
  selectedAgent: string | null
  setSelectedAgent: (agent: string | null) => void
  selectedDatasource: string | null
  setSelectedDatasource: (ds: string | null) => void
  selectedModel: string | null
  setSelectedModel: (model: string | null) => void
  planMode: boolean
  setPlanMode: (enabled: boolean) => void
}

export const useChatStore = create<ChatState>((set) => ({
  currentTaskType: null,
  setCurrentTaskType: (type) => set({ currentTaskType: type }),

  templates: [],
  setTemplates: (templates) => set({ templates }),

  sessionId: null,
  setSessionId: (id) => set({ sessionId: id }),
  messages: [],
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  appendToLastMessage: (text) => set((state) => {
    const msgs = [...state.messages]
    const last = msgs[msgs.length - 1]
    if (last && last.role === 'assistant') {
      const lastContent = last.content[last.content.length - 1]
      if (lastContent && lastContent.type === 'markdown') {
        lastContent.payload = {
          content: (lastContent.payload.content as string || '') + text,
        }
      }
    }
    return { messages: msgs }
  }),
  setMessages: (messages: ChatMessage[]) => set({ messages }),
  clearMessages: () => set({ messages: [] }),
  isStreaming: false,
  setIsStreaming: (streaming) => set({ isStreaming: streaming }),

  sessions: [],
  setSessions: (sessions) => set({ sessions }),

  outputOptions: {},
  setOutputOption: (key, value) => set((state) => ({
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