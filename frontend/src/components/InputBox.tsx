import { useState, useCallback, KeyboardEvent } from 'react'
import { useChatStore } from '../stores/chatStore'
import type { TaskTemplate } from '../stores/chatStore'
import { useSSE } from '../hooks/useSSE'

interface InputBoxProps {
  template: TaskTemplate
}

export default function InputBox({ template }: InputBoxProps) {
  const [text, setText] = useState('')
  const { isStreaming, addMessage, setIsStreaming, appendToLastMessage } = useChatStore()

  const { connect: connectSSE } = useSSE({
    onEvent: useCallback((event, data) => {
      if (event === 'assistant_delta' || event === 'message') {
        const text = typeof data === 'string' ? data : (data.text || data.content || '')
        if (text) appendToLastMessage(text)
      }
    }, [appendToLastMessage]),
    onError: useCallback((error: Error) => {
      appendToLastMessage(`\n\n**错误**: ${error.message}`)
      setIsStreaming(false)
    }, [appendToLastMessage, setIsStreaming]),
    onDone: useCallback(() => {
      setIsStreaming(false)
    }, [setIsStreaming]),
    maxRetries: 3,
  })

  const canSend = text.trim().length > 0 && !isStreaming

  const handleSend = useCallback(async () => {
    const content = text.trim()
    if (!content) return

    setText('')
    setIsStreaming(true)

    // Add user message
    addMessage({
      id: `user-${Date.now()}`,
      role: 'user',
      content: [{ type: 'markdown', payload: { content } }],
      timestamp: new Date().toISOString(),
    })

    // Add placeholder assistant message for streaming
    const assistantId = `assistant-${Date.now()}`
    addMessage({
      id: assistantId,
      role: 'assistant',
      content: [{ type: 'markdown', payload: { content: '' } }],
      timestamp: new Date().toISOString(),
    })

    // Connect to SSE stream
    const {
      outputOptions, currentTaskType, sessionId,
      selectedAgent, selectedDatasource, selectedModel, planMode,
    } = useChatStore.getState()
    connectSSE('/api/v1/chat/stream', {
      message: content,
      session_id: sessionId || null,
      task_type: currentTaskType || null,
      subagent_id: selectedAgent || null,
      datasource: selectedDatasource || null,
      model: selectedModel || null,
      plan_mode: planMode,
      output_options: Object.keys(outputOptions).length > 0 ? outputOptions : null,
    })
  }, [text, addMessage, setIsStreaming, connectSSE])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-input-container">
      <textarea
        className="chat-textarea"
        rows={1}
        placeholder={template.inputPlaceholder}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        onInput={e => {
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = Math.min(el.scrollHeight, 200) + 'px'
        }}
      />
      <div className="chat-input-actions">
        <div className="chat-input-left">
          <button className="icon-btn" title="上传文件">📎</button>
          <button className="icon-btn" title="@ 引用">@</button>
        </div>
        <button
          className="send-btn"
          disabled={!canSend}
          onClick={handleSend}
        >
          {isStreaming ? '生成中...' : '发送'}
        </button>
      </div>
    </div>
  )
}