export interface StreamChatParams {
  message: string
  sessionId?: string
  subagentId?: string
  outputOptions?: Record<string, string>
}

export async function streamChat(
  params: StreamChatParams,
  onEvent: (event: string, data: any) => void,
  onError: (error: Error) => void,
  onDone: () => void,
): Promise<AbortController> {
  const controller = new AbortController()

  try {
    const response = await fetch('/api/v1/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: params.message,
        session_id: params.sessionId || null,
        subagent_id: params.subagentId || null,
        output_options: params.outputOptions || {},
      }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error')
      onError(new Error(`HTTP ${response.status}: ${errorText}`))
      return controller
    }

    const reader = response.body?.getReader()
    if (!reader) {
      onError(new Error('No response body'))
      return controller
    }

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6))
            // Try to determine event type from data
            if (data.event) {
              onEvent(data.event, data.data || data)
            } else if (data.content) {
              onEvent('assistant_delta', data)
            } else {
              onEvent('message', data)
            }
          } catch {
            // Non-JSON data line, skip
          }
        }
      }
    }

    onDone()
  } catch (error: any) {
    if (error.name === 'AbortError') return controller
    onError(error)
  }

  return controller
}