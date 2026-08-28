/**
 * SSE / message contract types, mirroring datus/api/models/cli_models.py.
 * Field names on the wire are kept as-is (camelCase inside content payloads,
 * snake_case at the envelope level).
 */

export type MessageRole = 'user' | 'assistant'

export interface IMessageContent {
  /** markdown | code | csv | thinking | error | call-tool | call-tool-result |
   *  user-interaction | artifact | subagent-complete | init-settings | drag-helper */
  type: string
  payload: Record<string, any>
}

export interface AtContextData {
  table_paths: string[]
  metric_paths: string[]
  sql_paths: string[]
  knowledge_paths: string[]
}

export interface SSEMessagePayload {
  message_id: string
  role: MessageRole
  content: IMessageContent[]
  depth: number
  parent_action_id?: string | null
  at_context?: AtContextData | null
}

/**
 * One question inside a ``user-interaction`` block (payload.interactionKey /
 * payload.requests[i]). Mirrors datus.schemas.interaction_event.InteractionEvent
 * as built by action_sse_converter._build_interaction_content.
 */
export interface UserInteractionRequest {
  title: string
  content: string
  options: { key: string; title: string }[] | null
  defaultChoice?: string | null
  contentType?: string
  allowFreeText?: boolean
  multiSelect?: boolean
}

export interface UserInteractionPayload {
  interactionKey: string
  actionType?: string
  requests: UserInteractionRequest[]
  /** Present once the user has answered: one inner array of answer values per request. */
  answered?: string[][]
}

export type SSEMessageOpType = 'createMessage' | 'appendMessage' | 'updateMessage'

export interface SSEMessageData {
  type: SSEMessageOpType
  payload: SSEMessagePayload
}

export interface SSESessionData {
  session_id: string
  llm_session_id?: string | null
}

export interface SSEEndData {
  session_id: string
  llm_session_id?: string | null
  total_events: number
  action_count: number
  duration: number
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  session_total_tokens: number
  context_length: number
}

export interface SSEErrorData {
  error: string
  error_type: string
  session_id?: string | null
  llm_session_id?: string | null
}

export interface SSEUsageData {
  session_id: string
  depth: number
  parent_action_id?: string | null
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  last_call_input_tokens: number
  context_length: number
  delta?: {
    requests: number
    input_tokens: number
    output_tokens: number
    total_tokens: number
    cached_tokens: number
    reasoning_tokens: number
  }
}

export type SSEEventName = 'session' | 'message' | 'usage' | 'ping' | 'end' | 'error'

export interface StreamChatRequest {
  message: string
  session_id?: string | null
  subagent_id?: string | null
  model?: string | null
  datasource?: string | null
  catalog?: string | null
  database?: string | null
  db_schema?: string | null
  plan_mode?: boolean
  task_type?: string | null
  output_options?: Record<string, string> | null
  stream_response?: boolean
  source?: string
}
