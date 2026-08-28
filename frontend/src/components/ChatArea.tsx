import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import MessageBubble from './MessageBubble'
import InputBox from './InputBox'
import WelcomeScreen from './chat/WelcomeScreen'

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function ChatArea() {
  const { messages, isStreaming, sessionId, turnUsage, turnDuration } = useChatStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const hasMessages = messages.length > 0
  const showWelcome = !sessionId && !hasMessages
  const lastIsUser = messages.length > 0 && messages[messages.length - 1].role === 'user'

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, isStreaming])

  if (showWelcome) {
    return (
      <div className="chat-area">
        <WelcomeScreen />
      </div>
    )
  }

  return (
    <div className="chat-area">
      <div className="messages-container" ref={scrollRef}>
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isStreaming && lastIsUser && (
          <div className="message assistant">
            <div className="message-body">
              <div className="assistant-thinking"><span className="dot" />思考中<span className="dot" /><span className="dot" /></div>
            </div>
          </div>
        )}
      </div>

      <div className="chat-input-dock">
        {isStreaming && (
          <div className="streaming-status">
            正在生成中…
            {turnUsage && turnUsage.totalTokens > 0 && (
              <span className="streaming-usage">↑{formatTokens(turnUsage.inputTokens)} ↓{formatTokens(turnUsage.outputTokens)}</span>
            )}
          </div>
        )}
        {!isStreaming && turnUsage && turnUsage.totalTokens > 0 && (
          <div className="streaming-status done">
            本轮 {turnUsage.requests} 次调用 · 共 {formatTokens(turnUsage.totalTokens)} tokens
            {turnDuration != null && ` · ${turnDuration.toFixed(1)}s`}
          </div>
        )}
        <InputBox />
      </div>
    </div>
  )
}
